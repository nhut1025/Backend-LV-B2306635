from __future__ import annotations

import argparse
from collections import defaultdict
import json
import os
import sys
from pathlib import Path

import pandas as pd

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

RECOMMENDER_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(RECOMMENDER_ROOT / "src"))

from recommender.algorithms.content_based import recommend_content_based
from recommender.algorithms.popularity import recommend_popularity
from recommender.database import get_db_connection
from recommender.evaluation import (
    INTERACTION_COLUMNS,
    random_baseline_metrics,
    ranking_metrics,
)


def _read_interactions(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file dữ liệu: {path}")
    data = pd.read_csv(path)
    missing = [column for column in INTERACTION_COLUMNS if column not in data.columns]
    if missing:
        raise ValueError(f"{path} thiếu cột: {', '.join(missing)}")
    if data.empty:
        raise ValueError(f"{path} không có dòng dữ liệu.")

    for column in ("bill_id", "dish_id", "quantity"):
        numeric = pd.to_numeric(data[column], errors="coerce")
        if numeric.isna().any():
            raise ValueError(f"{path}: cột {column} có giá trị không hợp lệ.")
        if column in ("bill_id", "dish_id") and (
            (numeric <= 0).any() or (numeric % 1 != 0).any()
        ):
            raise ValueError(f"{path}: cột {column} phải chứa số nguyên dương.")
        if column == "quantity" and (numeric <= 0).any():
            raise ValueError(f"{path}: quantity phải lớn hơn 0.")
        data[column] = numeric.astype("int64") if column != "quantity" else numeric

    user_ids = pd.to_numeric(data["user_id"], errors="coerce")
    invalid_users = data["user_id"].notna() & user_ids.isna()
    if invalid_users.any() or (user_ids.dropna() <= 0).any() or (
        user_ids.dropna() % 1 != 0
    ).any():
        raise ValueError(f"{path}: user_id phải rỗng hoặc là số nguyên dương.")
    data["user_id"] = user_ids.astype("Int64")

    paid_at = pd.to_datetime(data["paid_at"], errors="coerce")
    if paid_at.isna().any():
        raise ValueError(f"{path}: paid_at có giá trị không hợp lệ.")
    data["paid_at"] = paid_at
    return data[INTERACTION_COLUMNS]


def _load_catalog() -> tuple[str, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SELECT DATABASE() AS database_name")
        database_name = cursor.fetchone()["database_name"]
        cursor.execute("SELECT id, name, category_id, is_available FROM dishes")
        dishes = pd.DataFrame(
            cursor.fetchall(),
            columns=["id", "name", "category_id", "is_available"],
        )
        cursor.execute("SELECT dish_id, ingredient_id FROM dish_ingredients")
        ingredients = pd.DataFrame(
            cursor.fetchall(),
            columns=["dish_id", "ingredient_id"],
        )
        cursor.execute(
            "SELECT user_id, ingredient_id FROM user_excluded_ingredients"
        )
        excluded = pd.DataFrame(
            cursor.fetchall(),
            columns=["user_id", "ingredient_id"],
        )
        return database_name, dishes, ingredients, excluded
    finally:
        cursor.close()
        connection.close()


def _ranking_by_user(rows: list[dict]) -> dict[int, list[int]]:
    result: defaultdict[int, list[tuple[int, int]]] = defaultdict(list)
    for row in rows:
        user_id = row.get("user_id")
        if user_id is None or pd.isna(user_id):
            continue
        result[int(user_id)].append((int(row["rank_order"]), int(row["dish_id"])))
    return {
        user_id: [dish_id for _, dish_id in sorted(ranked)]
        for user_id, ranked in result.items()
    }


def _average_metrics(
    rankings: dict[int, list[int]],
    relevant_by_user: dict[int, set[int]],
    seen_by_user: dict[int, set[int]],
    k_values: list[int],
    global_ranking: list[int] | None = None,
    exclude_seen: bool = True,
) -> dict[int, dict[str, float]]:
    averages = {}
    for k in k_values:
        per_user = []
        for user_id, relevant in relevant_by_user.items():
            ranked = (
                global_ranking
                if global_ranking is not None
                else rankings.get(user_id, [])
            )
            eligible_ranked = [
                dish_id
                for dish_id in ranked
                if not exclude_seen or dish_id not in seen_by_user.get(user_id, set())
            ]
            per_user.append(ranking_metrics(eligible_ranked, relevant, k))
        averages[k] = {
            metric: sum(row[metric] for row in per_user) / len(per_user)
            for metric in ("precision", "recall", "ndcg")
        }
    return averages


def _average_random_metrics(
    available_ids: set[int],
    relevant_by_user: dict[int, set[int]],
    seen_by_user: dict[int, set[int]],
    k_values: list[int],
    exclude_seen: bool = True,
) -> dict[int, dict[str, float]]:
    averages = {}
    for k in k_values:
        per_user = [
            random_baseline_metrics(
                available_ids - seen_by_user.get(user_id, set())
                if exclude_seen else available_ids,
                relevant,
                k,
            )
            for user_id, relevant in relevant_by_user.items()
        ]
        averages[k] = {
            metric: sum(row[metric] for row in per_user) / len(per_user)
            for metric in ("precision", "recall", "ndcg")
        }
    return averages


def _env_float(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        return float(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} phải là số hợp lệ.") from error


def _recommend_models_for_split(
    interactions: pd.DataFrame,
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    user_ids: set[int],
    limit: int,
    exclude_ordered: bool,
) -> tuple[dict[str, list[dict]], pd.DataFrame]:
    orders = interactions.loc[
        interactions["user_id"].notna(),
        ["user_id", "dish_id", "quantity"],
    ].copy()
    orders["user_id"] = orders["user_id"].astype("int64")
    orders["dish_id"] = orders["dish_id"].astype("int64")
    feedback = pd.DataFrame(columns=["user_id", "dish_id", "sentiment"])
    excluded = pd.DataFrame(columns=["user_id", "ingredient_id"])
    available_count = int(dishes["is_available"].astype(bool).sum())
    popularity_rows = recommend_popularity(
        interactions[["bill_id", "dish_id"]],
        dishes,
        top_n=max(1, available_count),
    )
    content_rows = recommend_content_based(
        dishes,
        dish_ingredients,
        orders,
        feedback,
        excluded,
        limit=limit,
        category_weight=_env_float("CONTENT_BASED_CATEGORY_WEIGHT", 1.5),
        like_bonus=_env_float("CONTENT_BASED_LIKE_BONUS", 2.0),
        dislike_penalty=_env_float("CONTENT_BASED_DISLIKE_PENALTY", 2.0),
        min_score=_env_float("CONTENT_BASED_MIN_SCORE", 0.05),
        active_user_ids=user_ids,
        exclude_ordered=exclude_ordered,
        preferred=pd.DataFrame(columns=["user_id", "ingredient_id"]),
        preferred_weight=_env_float("CONTENT_BASED_PREFERRED_WEIGHT", 1.5),
    )
    return (
        {
            "popularity": popularity_rows,
            "content_based": content_rows,
        },
        orders,
    )


def evaluate(
    train: pd.DataFrame,
    test: pd.DataFrame,
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    k_values: list[int],
    evaluation_scope: str = "both",
    excluded: pd.DataFrame | None = None,
) -> tuple[
    dict[str, dict[str, dict[int, dict[str, float]]]],
    dict[str, int],
]:
    if set(train["bill_id"]) & set(test["bill_id"]):
        raise ValueError("Một bill xuất hiện đồng thời trong train và test.")
    if evaluation_scope not in {"new", "all", "both"}:
        raise ValueError("evaluation_scope phải là new, all hoặc both.")
    if dishes.empty:
        raise ValueError("Database hiện tại không có món ăn.")
    if excluded is None:
        excluded = pd.DataFrame(columns=["user_id", "ingredient_id"])

    menu_ids = set(pd.to_numeric(dishes["id"], errors="coerce").dropna().astype(int))
    available_ids = set(
        pd.to_numeric(
            dishes.loc[dishes["is_available"].astype(bool), "id"],
            errors="coerce",
        ).dropna().astype(int)
    )
    if not available_ids:
        raise ValueError("Database hiện tại không có món nào đang bán.")
    split_dish_ids = set(train["dish_id"]) | set(test["dish_id"])
    missing_dish_ids = split_dish_ids - menu_ids
    if missing_dish_ids:
        raise ValueError(
            "CSV có dish_id không tồn tại trong database hiện tại: "
            + ", ".join(str(item) for item in sorted(missing_dish_ids)[:10])
        )

    test_users = set(test["user_id"].dropna().astype(int))
    train_orders = train.loc[
        train["user_id"].notna(),
        ["user_id", "dish_id", "quantity"],
    ].copy()
    train_orders["user_id"] = train_orders["user_id"].astype("int64")
    train_orders["dish_id"] = train_orders["dish_id"].astype("int64")
    train_user_ids = set(train_orders["user_id"])
    known_test_users = test_users & train_user_ids
    if not known_test_users:
        raise ValueError("Không có khách test nào có bill trong train.")

    seen_by_user: defaultdict[int, set[int]] = defaultdict(set)
    for row in train_orders.itertuples(index=False):
        seen_by_user[int(row.user_id)].add(int(row.dish_id))

    relevant_by_scope: dict[str, dict[int, set[int]]] = {"new": {}, "all": {}}
    test_customers = test.loc[test["user_id"].notna()]
    for user_id, rows in test_customers.groupby("user_id"):
        customer_id = int(user_id)
        if customer_id not in known_test_users:
            continue
        relevant_all = set(rows["dish_id"].astype(int)) & available_ids
        relevant_new = relevant_all - seen_by_user.get(customer_id, set())
        if relevant_all:
            relevant_by_scope["all"][customer_id] = relevant_all
        if relevant_new:
            relevant_by_scope["new"][customer_id] = relevant_new
    requested_scopes = (
        ["new", "all"] if evaluation_scope == "both" else [evaluation_scope]
    )
    if not any(relevant_by_scope[scope] for scope in requested_scopes):
        raise ValueError(
            "Không có khách test đủ điều kiện và món liên quan để đánh giá "
            "trong phạm vi đã chọn."
        )

    limit = max(30, max(k_values))
    excluded = pd.DataFrame(columns=["user_id", "ingredient_id"])
    model_rows_all, train_orders = _recommend_models_for_split(
        train,
        dishes,
        dish_ingredients,
        known_test_users,
        limit,
        exclude_ordered=False,
    )
    model_rows_new, _ = _recommend_models_for_split(
        train,
        dishes,
        dish_ingredients,
        known_test_users,
        limit,
        exclude_ordered=True,
    )
    popularity_ranking = [
        int(row["dish_id"]) for row in model_rows_all["popularity"]
    ]

    metrics_by_scope = {}
    evaluated_by_scope = {}
    for scope in requested_scopes:
        relevant_by_user = relevant_by_scope[scope]
        evaluated_by_scope[scope] = len(relevant_by_user)
        if not relevant_by_user:
            metrics_by_scope[scope] = {}
            continue

        exclude_seen = scope == "new"
        model_rows = model_rows_new if exclude_seen else model_rows_all
        metrics_by_scope[scope] = {
            "random": _average_random_metrics(
                available_ids,
                relevant_by_user,
                seen_by_user,
                k_values,
                exclude_seen=exclude_seen,
            ),
            "popularity": _average_metrics(
                {},
                relevant_by_user,
                seen_by_user,
                k_values,
                global_ranking=popularity_ranking,
                exclude_seen=exclude_seen,
            ),
            "content_based": _average_metrics(
                _ranking_by_user(model_rows["content_based"]),
                relevant_by_user,
                seen_by_user,
                k_values,
                exclude_seen=exclude_seen,
            ),
        }
    counts = {
        "test_customers": len(test_users),
        "known_test_customers": len(known_test_users),
        "evaluated_customers_new": evaluated_by_scope.get("new", 0),
        "evaluated_customers_all": evaluated_by_scope.get("all", 0),
        "cold_start_customers": len(test_users - train_user_ids),
        "walk_in_test_bills": int(
            test.loc[test["user_id"].isna(), "bill_id"].nunique()
        ),
    }
    return metrics_by_scope, counts


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Đánh giá recommender bằng CSV train/test theo thời gian."
    )
    parser.add_argument(
        "--train",
        type=Path,
        default=RECOMMENDER_ROOT / "data" / "train.csv",
        help="Đường dẫn train.csv.",
    )
    parser.add_argument(
        "--test",
        type=Path,
        default=RECOMMENDER_ROOT / "data" / "test.csv",
        help="Đường dẫn test.csv.",
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=RECOMMENDER_ROOT / "data" / "split_metadata.json",
        help="Metadata của lần chia train/test.",
    )
    parser.add_argument(
        "--k",
        type=int,
        nargs="+",
        default=[5, 10],
        help="Các cutoff K cần đánh giá (mặc định: 5 10).",
    )
    parser.add_argument(
        "--evaluation-scope",
        choices=("new", "all", "both"),
        default="both",
        help="Đánh giá món mới, mọi món gồm cả món gọi lại, hoặc cả hai (mặc định: both).",
    )
    args = parser.parse_args()
    if not args.k or any(k < 1 for k in args.k) or len(set(args.k)) != len(args.k):
        parser.error("--k phải gồm các số nguyên dương không trùng nhau.")

    train = _read_interactions(args.train)
    test = _read_interactions(args.test)
    database_name, dishes, dish_ingredients, excluded = _load_catalog()
    if not args.metadata.is_file():
        raise FileNotFoundError(
            f"Không tìm thấy {args.metadata}; hãy tạo lại train/test trước khi đánh giá."
        )
    with args.metadata.open(encoding="utf-8") as file:
        metadata = json.load(file)
    split_database = metadata.get("database")
    if split_database != database_name:
        raise ValueError(
            f"Train/test được tạo từ database={split_database or '(không có metadata)'}, "
            f"nhưng catalog hiện tại là {database_name}. Hãy tạo lại train/test với DB_NAME phù hợp."
        )
    metrics_by_scope, counts = evaluate(
        train,
        test,
        dishes,
        dish_ingredients,
        args.k,
        evaluation_scope=args.evaluation_scope,
        excluded=excluded,
    )

    print(f"Database danh mục: {database_name}")
    if metadata.get("excluded_bill_count"):
        print(f"Bill đã loại khỏi snapshot: {metadata['excluded_bill_count']}.")
    print(f"Train: {train['bill_id'].nunique()} bill; test: {test['bill_id'].nunique()} bill.")
    print(
        f"Khách test có lịch sử train: {counts['known_test_customers']}/"
        f"{counts['test_customers']}."
    )
    print(
        f"khách cold-start: {counts['cold_start_customers']}; "
        f"bill walk-in test bỏ khỏi metric cá nhân: {counts['walk_in_test_bills']}."
    )
    scope_labels = {
        "new": "Chỉ món mới (đã gọi trong train bị loại)",
        "all": "Cho phép gọi lại món đã gọi (mọi món test)",
    }
    for scope, metrics in metrics_by_scope.items():
        evaluated = counts[f"evaluated_customers_{scope}"]
        print(f"\n{scope_labels[scope]} — khách được tính metric: {evaluated}.")
        if not metrics:
            print("Không có khách/món test đủ điều kiện trong phạm vi này.")
            continue
        print("Metric macro-average trên khách hàng:")
        print("model           " + "  ".join(
            f"{metric}@{k: <2}" for k in args.k for metric in ("P", "R", "NDCG")
        ))
        for model_name, model_metrics in metrics.items():
            values = []
            for k in args.k:
                row = model_metrics[k]
                values.extend(
                    (row["precision"], row["recall"], row["ndcg"])
                )
            print(
                f"{model_name:<15} "
                + "  ".join(f"{value:.4f}" for value in values)
            )
        random_metrics = metrics["random"]
        for model_name in ("popularity", "content_based"):
            lifts = []
            for k in args.k:
                for metric in ("precision", "recall", "ndcg"):
                    baseline = random_metrics[k][metric]
                    score = metrics[model_name][k][metric]
                    if baseline > 0:
                        lifts.append(f"{metric}@{k}={score / baseline:.2f}x")
            print(f"{model_name} so với đoán ngẫu nhiên: " + ", ".join(lifts))
    print(
        "\nEvaluator chỉ tính món hiện đang bán; chỉ phạm vi “món mới” loại "
        "món từng gọi trong train. Script không ghi dữ liệu vào database."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Không thể đánh giá train/test: {error}")
        raise SystemExit(1) from error

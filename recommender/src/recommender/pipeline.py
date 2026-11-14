from __future__ import annotations

import argparse
import os
from typing import Sequence

import pandas as pd

from recommender.algorithms.content_based import recommend_content_based
from recommender.algorithms.popularity import recommend_popularity
from recommender.database import get_db_connection
from recommender.dataset import (
    load_content_based_dataset,
    load_popularity_dataset,
    replace_global_recommendations,
    replace_user_recommendations,
)


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        return int(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} phải là số nguyên.") from error


def _env_float(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        return float(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} phải là số hợp lệ.") from error


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    normalized = raw_value.strip().lower()
    if normalized in ("1", "true", "yes"):
        return True
    if normalized in ("0", "false", "no"):
        return False
    raise ValueError(f"{name} phải là true hoặc false.")


def _active_user_ids(dataset: dict) -> set[int]:
    return set(dataset["users"]["id"].astype(int))


def _recommend_content_based(
    dataset: dict,
    user_ids: set[int] | None = None,
    limit: int | None = None,
    exclude_ordered: bool | None = None,
    excluded: pd.DataFrame | None = None,
) -> list[dict]:
    if exclude_ordered is None:
        exclude_ordered = _env_bool("CONTENT_BASED_EXCLUDE_ORDERED", True)
    return recommend_content_based(
        dataset["dishes"],
        dataset["ingredients"],
        dataset["orders"],
        dataset["feedback"],
        dataset["excluded"] if excluded is None else excluded,
        limit=limit or _env_int("CONTENT_BASED_LIMIT", 8),
        category_weight=_env_float("CONTENT_BASED_CATEGORY_WEIGHT", 1.5),
        like_bonus=_env_float("CONTENT_BASED_LIKE_BONUS", 2.0),
        dislike_penalty=_env_float("CONTENT_BASED_DISLIKE_PENALTY", 2.0),
        min_score=_env_float("CONTENT_BASED_MIN_SCORE", 0.05),
        active_user_ids=user_ids,
        exclude_ordered=exclude_ordered,
        preferred=dataset["preferred"],
        preferred_weight=_env_float("CONTENT_BASED_PREFERRED_WEIGHT", 1.5),
    )


def _update_personalized_model(
    model_name: str,
    loader,
    recommender,
    user_id: int | None = None,
) -> dict[str, int]:
    connection = get_db_connection()
    try:
        connection.start_transaction()
        dataset = loader(connection, user_id=user_id)
        if user_id is not None and dataset["users"].empty:
            raise ValueError(
                f"Không tìm thấy tài khoản khách đang hoạt động có id={user_id}."
            )
        user_ids = {user_id} if user_id is not None else _active_user_ids(dataset)
        recommendations = recommender(dataset, user_ids)
        replace_user_recommendations(
            connection,
            model_name,
            recommendations,
            user_id=user_id,
        )
        connection.commit()
        return {
            "users": len(dataset["users"]),
            "users_with_recommendations": len(
                {row["user_id"] for row in recommendations}
            ),
            "rows": len(recommendations),
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def update_popularity_recommendations() -> int:
    connection = get_db_connection()
    try:
        connection.start_transaction()
        dataset = load_popularity_dataset(connection)
        available_count = int(dataset["dishes"]["is_available"].astype(bool).sum())
        recommendations = recommend_popularity(
            dataset["items"],
            dataset["dishes"],
            top_n=max(1, available_count),
        )
        replace_global_recommendations(connection, "popularity", recommendations)
        connection.commit()
        return len(recommendations)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def update_content_based_recommendations(user_id: int | None = None) -> dict[str, int]:
    return _update_personalized_model(
        "content_based",
        load_content_based_dataset,
        _recommend_content_based,
        user_id,
    )


def _preview_user(user_id: int) -> list[dict]:
    connection = get_db_connection()
    try:
        loaded = load_content_based_dataset(connection, user_id=user_id)
        if loaded["users"].empty:
            raise ValueError(
                f"Không tìm thấy tài khoản khách đang hoạt động có id={user_id}."
            )
        rows = _recommend_content_based(loaded, {user_id})
        names = loaded["dishes"].set_index("id")["name"].to_dict()
        for row in rows:
            print(
                f'{row["rank_order"]}. {names[row["dish_id"]]} '
                f'(id={row["dish_id"]}) - {row["score"]:.4f}'
            )
        if not rows:
            print("Không có món phù hợp để gợi ý.")
        return rows
    finally:
        connection.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cập nhật mô hình gợi ý món.")
    parser.add_argument("--user", type=int, help="xem thử gợi ý cá nhân, không ghi database")
    parser.add_argument(
        "--model",
        choices=("content_based",),
        default="content_based",
        help="mô hình cá nhân cần xem cùng với --user",
    )
    parser.add_argument(
        "--refresh-user",
        type=int,
        help="cập nhật riêng gợi ý content-based cho khách, có ghi database",
    )
    args = parser.parse_args(argv)
    if sum(
        value is not None
        for value in (args.user, args.refresh_user)
    ) > 1:
        parser.error("--user và --refresh-user không thể dùng cùng lúc.")
    if args.user is not None:
        if args.user < 1:
            parser.error("--user phải là số nguyên dương.")
        _preview_user(args.user)
        return 0
    if args.refresh_user is not None:
        if args.refresh_user < 1:
            parser.error("--refresh-user phải là số nguyên dương.")
        result = update_content_based_recommendations(args.refresh_user)
        print(
            f'[content_based] khách id={args.refresh_user}: '
            f'{result["rows"]} gợi ý đã cập nhật.'
        )
        return 0

    popularity_count = update_popularity_recommendations()
    print(f"Đã cập nhật {popularity_count} gợi ý popularity.")
    result = update_content_based_recommendations()
    print(
        f'[content_based] {result["users"]} khách, '
        f'{result["users_with_recommendations"]} khách có gợi ý, '
        f'{result["rows"]} dòng đã ghi.'
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Không thể cập nhật gợi ý: {error}")
        raise SystemExit(1) from error

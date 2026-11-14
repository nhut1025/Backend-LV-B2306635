from __future__ import annotations

from collections.abc import Sequence
import math
from typing import Any

import pandas as pd

INTERACTION_COLUMNS = ["bill_id", "user_id", "dish_id", "quantity", "paid_at"]


def ranking_metrics(
    recommendations: Sequence[int],
    relevant_items: set[int],
    k: int,
) -> dict[str, float]:
    """Calculate precision, recall, and NDCG at k for one user's ranking."""
    if not isinstance(k, int) or isinstance(k, bool) or k < 1:
        raise ValueError("k phải là số nguyên dương.")
    if not relevant_items:
        raise ValueError("Cần ít nhất một món liên quan để tính metric.")

    unique_recommendations = list(dict.fromkeys(int(item) for item in recommendations))[:k]
    relevant = {int(item) for item in relevant_items}
    hits = [item for item in unique_recommendations if item in relevant]
    dcg = sum(
        1 / math.log2(rank + 2)
        for rank, item in enumerate(unique_recommendations)
        if item in relevant
    )
    ideal_count = min(len(relevant), k)
    ideal_dcg = sum(1 / math.log2(rank + 2) for rank in range(ideal_count))

    return {
        "precision": len(hits) / k,
        "recall": len(hits) / len(relevant),
        "ndcg": dcg / ideal_dcg,
    }


def random_baseline_metrics(
    candidate_items: set[int],
    relevant_items: set[int],
    k: int,
) -> dict[str, float]:
    """Return exact expected ranking metrics for a uniform random ranking."""
    if not isinstance(k, int) or isinstance(k, bool) or k < 1:
        raise ValueError("k phải là số nguyên dương.")
    candidates = {int(item) for item in candidate_items}
    relevant = {int(item) for item in relevant_items}
    if not candidates:
        raise ValueError("Cần ít nhất một món có thể gợi ý.")
    if not relevant or not relevant.issubset(candidates):
        raise ValueError("Các món liên quan phải thuộc tập món có thể gợi ý.")

    n_candidates = len(candidates)
    n_ranked = min(k, n_candidates)
    expected_hits = n_ranked * len(relevant) / n_candidates
    expected_dcg = (len(relevant) / n_candidates) * sum(
        1 / math.log2(rank + 2) for rank in range(n_ranked)
    )
    ideal_dcg = sum(
        1 / math.log2(rank + 2) for rank in range(min(k, len(relevant)))
    )
    return {
        "precision": expected_hits / k,
        "recall": expected_hits / len(relevant),
        "ndcg": expected_dcg / ideal_dcg,
    }


def split_by_time(
    interactions: pd.DataFrame,
    train_ratio: float = 0.8,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Split whole bills by paid date; the newest dates become the test set."""
    if not math.isfinite(train_ratio) or not 0 < train_ratio < 1:
        raise ValueError("train_ratio phải nằm giữa 0 và 1.")
    missing = [column for column in INTERACTION_COLUMNS if column not in interactions.columns]
    if missing:
        raise ValueError(f"interactions thiếu cột: {', '.join(missing)}")

    data = interactions[INTERACTION_COLUMNS].copy()
    data["paid_at"] = pd.to_datetime(data["paid_at"], errors="coerce")
    data["quantity"] = pd.to_numeric(data["quantity"], errors="coerce")
    data = data.dropna(subset=["bill_id", "dish_id", "quantity", "paid_at"])
    data = data[data["quantity"] > 0]
    if data.empty:
        raise ValueError("Không có dòng bill hợp lệ để chia train/test.")

    bill_dates = data[["bill_id", "paid_at"]].drop_duplicates("bill_id")
    bill_dates["day"] = bill_dates["paid_at"].dt.normalize()
    dates = bill_dates["day"].drop_duplicates().sort_values().reset_index(drop=True)
    if len(dates) < 2:
        raise ValueError(
            "Cần bill ở ít nhất hai ngày thanh toán khác nhau để chia theo thời gian."
        )

    split_index = min(max(int(len(dates) * train_ratio), 1), len(dates) - 1)
    cutoff = dates.iloc[split_index]
    train_days = set(dates.iloc[:split_index])
    train_bill_ids = set(bill_dates.loc[bill_dates["day"].isin(train_days), "bill_id"])
    test_bill_ids = set(bill_dates.loc[~bill_dates["day"].isin(train_days), "bill_id"])

    train = data[data["bill_id"].isin(train_bill_ids)].sort_values(
        ["paid_at", "bill_id", "dish_id"]
    ).reset_index(drop=True)
    test = data[data["bill_id"].isin(test_bill_ids)].sort_values(
        ["paid_at", "bill_id", "dish_id"]
    ).reset_index(drop=True)
    train_users = set(train["user_id"].dropna())
    test_users = set(test["user_id"].dropna())
    known_test_users = train_users & test_users

    metadata = {
        "split_method": "chronological_by_paid_date",
        "train_ratio_by_unique_date": train_ratio,
        "cutoff_date": cutoff.date().isoformat(),
        "train_start": train["paid_at"].min().isoformat(),
        "train_end": train["paid_at"].max().isoformat(),
        "test_start": test["paid_at"].min().isoformat(),
        "test_end": test["paid_at"].max().isoformat(),
        "train_bill_count": int(train["bill_id"].nunique()),
        "test_bill_count": int(test["bill_id"].nunique()),
        "train_interaction_count": int(len(train)),
        "test_interaction_count": int(len(test)),
        "train_customer_count": len(train_users),
        "test_customer_count": len(test_users),
        "test_customers_with_train_history": len(known_test_users),
        "test_cold_start_customer_count": len(test_users - train_users),
        "walk_in_test_bill_count": int(
            test.loc[test["user_id"].isna(), "bill_id"].nunique()
        ),
    }
    return train, test, metadata

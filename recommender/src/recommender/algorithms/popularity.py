from __future__ import annotations

from typing import Any

import pandas as pd

from recommender.algorithms.validators import (
    clean_positive_rows,
    require_columns,
    validate_positive_integer,
)

MODEL_NAME = "popularity"


def recommend_popularity(
    items: pd.DataFrame,
    dishes: pd.DataFrame,
    top_n: int = 20,
) -> list[dict[str, Any]]:
    """Xếp món đang bán theo số bill đã thanh toán có chứa món đó."""
    validate_positive_integer(top_n, "top_n")
    require_columns(dishes, ("id", "is_available"), "dishes")
    valid_items = clean_positive_rows(
        items,
        "items",
        ("bill_id", "dish_id"),
    )
    available_ids = set(
        clean_positive_rows(dishes[dishes["is_available"].astype(bool)], "dishes", ("id",))[
            "id"
        ]
    )
    valid_items = valid_items[valid_items["dish_id"].isin(available_ids)]
    if valid_items.empty:
        return []

    counts = (
        valid_items.drop_duplicates(["bill_id", "dish_id"])
        .groupby("dish_id")
        .size()
    )
    dish_counts = {
        dish_id: int(counts.get(dish_id, 0))
        for dish_id in available_ids
    }
    ranked = sorted(
        dish_counts.items(),
        key=lambda item: (-item[1], int(item[0])),
    )[:top_n]
    return [
        {
            "user_id": None,
            "dish_id": int(dish_id),
            "score": float(count),
            "rank_order": rank,
        }
        for rank, (dish_id, count) in enumerate(ranked, start=1)
    ]

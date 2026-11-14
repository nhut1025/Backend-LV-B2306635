from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd

from recommender.algorithms.validators import (
    clean_feedback,
    clean_positive_rows,
    require_columns,
    validate_non_negative,
    validate_positive_integer,
    validate_score_threshold,
)


def build_history(
    orders: pd.DataFrame,
    feedback: pd.DataFrame,
    like_bonus: float = 2.0,
    dislike_penalty: float = 2.0,
) -> tuple[dict[int, dict[int, float]], dict[int, set[int]]]:
    """Tạo trọng số lịch sử và tập món khách đã thực sự gọi."""
    validate_non_negative(like_bonus, "like_bonus")
    validate_non_negative(dislike_penalty, "dislike_penalty")

    clean_orders = clean_positive_rows(
        orders,
        "orders",
        ("user_id", "dish_id"),
        quantity_column="quantity",
    )
    clean_reviews = clean_feedback(feedback)

    history: defaultdict[int, defaultdict[int, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    ordered: defaultdict[int, set[int]] = defaultdict(set)

    for row in clean_orders.itertuples(index=False):
        history[row.user_id][row.dish_id] += float(np.log1p(row.quantity))
        ordered[row.user_id].add(row.dish_id)

    for row in clean_reviews.itertuples(index=False):
        weight = like_bonus if row.sentiment == "like" else -dislike_penalty
        history[row.user_id][row.dish_id] += weight

    return (
        {user_id: dict(items) for user_id, items in history.items()},
        {user_id: set(items) for user_id, items in ordered.items()},
    )


def top_dishes(
    scores: np.ndarray,
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    ordered: set[int],
    excluded: set[int],
    limit: int = 8,
    min_score: float = 0.05,
) -> list[tuple[int, float]]:
    """Lọc món không hợp lệ rồi trả top theo điểm giảm dần."""
    validate_positive_integer(limit, "limit")
    validate_score_threshold(min_score)
    require_columns(
        dishes,
        ("id", "is_available"),
        "dishes",
    )
    require_columns(
        dish_ingredients,
        ("dish_id", "ingredient_id"),
        "dish_ingredients",
    )
    if len(scores) != len(dishes):
        raise ValueError("Số điểm phải bằng số món trong dishes.")

    ingredients_by_dish: defaultdict[int, set[int]] = defaultdict(set)
    clean_ingredients = clean_positive_rows(
        dish_ingredients,
        "dish_ingredients",
        ("dish_id", "ingredient_id"),
    )
    for row in clean_ingredients.itertuples(index=False):
        ingredients_by_dish[row.dish_id].add(row.ingredient_id)

    result: list[tuple[int, float]] = []
    for score, dish in zip(scores, dishes.itertuples(index=False)):
        dish_id = int(dish.id)
        numeric_score = float(score)
        if not bool(dish.is_available) or dish_id in ordered:
            continue
        if not np.isfinite(numeric_score) or numeric_score < min_score:
            continue
        if ingredients_by_dish.get(dish_id, set()) & excluded:
            continue
        result.append((dish_id, numeric_score))

    result.sort(key=lambda item: (-item[1], item[0]))
    return result[:limit]


def excluded_by_user(excluded: pd.DataFrame) -> dict[int, set[int]]:
    require_columns(excluded, ("user_id", "ingredient_id"), "excluded")
    clean = clean_positive_rows(
        excluded,
        "excluded",
        ("user_id", "ingredient_id"),
    )
    result: defaultdict[int, set[int]] = defaultdict(set)
    for row in clean.itertuples(index=False):
        result[row.user_id].add(row.ingredient_id)
    return dict(result)


def recommendation_rows(
    user_id: int,
    scores: list[tuple[int, float]],
) -> list[dict[str, Any]]:
    return [
        {
            "user_id": int(user_id),
            "dish_id": dish_id,
            "score": score,
            "rank_order": rank,
        }
        for rank, (dish_id, score) in enumerate(scores, start=1)
    ]

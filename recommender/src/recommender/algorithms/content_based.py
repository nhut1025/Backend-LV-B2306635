from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from recommender.algorithms.common import (
    build_history,
    excluded_by_user,
    recommendation_rows,
    top_dishes,
)
from recommender.algorithms.validators import (
    clean_positive_rows,
    require_columns,
    validate_non_negative,
    validate_positive_integer,
    validate_score_threshold,
)

MODEL_NAME = "content_based"


def _build_features(
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    category_weight: float = 1.5,
) -> tuple[np.ndarray, dict[int, int]]:
    """Mỗi món là vector nguyên liệu 0/1 và danh mục có trọng số."""
    require_columns(
        dishes,
        ("id", "category_id"),
        "dishes",
    )
    require_columns(
        dish_ingredients,
        ("dish_id", "ingredient_id"),
        "dish_ingredients",
    )
    if category_weight <= 0 or not np.isfinite(category_weight):
        raise ValueError("category_weight phải là số dương.")

    dish_ids = dishes["id"].tolist()
    ingredients = clean_positive_rows(
        dish_ingredients,
        "dish_ingredients",
        ("dish_id", "ingredient_id"),
    )
    ingredient_matrix = pd.crosstab(
        ingredients["dish_id"],
        ingredients["ingredient_id"],
    ).clip(upper=1)
    ingredient_matrix = ingredient_matrix.reindex(dish_ids, fill_value=0)
    ingredient_feature_indices = {
        int(ingredient_id): index
        for index, ingredient_id in enumerate(ingredient_matrix.columns)
    }
    ingredient_matrix.columns = [
        f"ingredient_{column}" for column in ingredient_matrix.columns
    ]

    category_matrix = pd.get_dummies(
        dishes["category_id"],
        dtype=float,
    )
    category_matrix.index = dish_ids
    category_matrix.columns = [
        f"category_{column}" for column in category_matrix.columns
    ]
    category_matrix *= category_weight

    features = pd.concat(
        [ingredient_matrix.astype(float), category_matrix],
        axis=1,
    ).to_numpy(dtype=float)
    return features, ingredient_feature_indices


def build_features(
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    category_weight: float = 1.5,
) -> np.ndarray:
    features, _ = _build_features(dishes, dish_ingredients, category_weight)
    return features


def recommend_content_based(
    dishes: pd.DataFrame,
    dish_ingredients: pd.DataFrame,
    orders: pd.DataFrame,
    feedback: pd.DataFrame,
    excluded: pd.DataFrame,
    limit: int = 8,
    category_weight: float = 1.5,
    like_bonus: float = 2.0,
    dislike_penalty: float = 2.0,
    min_score: float = 0.05,
    active_user_ids: set[int] | None = None,
    exclude_ordered: bool = True,
    preferred: pd.DataFrame | None = None,
    preferred_weight: float = 1.5,
) -> list[dict[str, Any]]:
    """Gợi ý món theo lịch sử và nguyên liệu khách yêu thích."""
    validate_positive_integer(limit, "limit")
    validate_non_negative(like_bonus, "like_bonus")
    validate_non_negative(dislike_penalty, "dislike_penalty")
    validate_non_negative(preferred_weight, "preferred_weight")
    validate_score_threshold(min_score)
    require_columns(
        dishes,
        ("id", "name", "category_id", "is_available"),
        "dishes",
    )

    menu = dishes.reset_index(drop=True)
    features, ingredient_feature_indices = _build_features(
        menu,
        dish_ingredients,
        category_weight,
    )
    if menu.empty or features.shape[1] == 0:
        return []

    if preferred is None:
        preferred = pd.DataFrame(columns=["user_id", "ingredient_id"])
    clean_preferred = clean_positive_rows(
        preferred,
        "preferred",
        ("user_id", "ingredient_id"),
    )
    preferred_by_user: dict[int, set[int]] = {}
    for row in clean_preferred.itertuples(index=False):
        preferred_by_user.setdefault(row.user_id, set()).add(row.ingredient_id)

    histories, ordered = build_history(
        orders,
        feedback,
        like_bonus,
        dislike_penalty,
    )
    excluded_users = excluded_by_user(excluded)
    user_ids = set(histories) | set(preferred_by_user)
    if active_user_ids is not None:
        user_ids &= active_user_ids
    dish_ids = menu["id"].tolist()
    row_by_dish = {int(dish_id): index for index, dish_id in enumerate(dish_ids)}

    rows = []
    for user_id in sorted(user_ids):
        history = histories.get(user_id, {})
        profile = np.zeros(features.shape[1], dtype=float)
        for dish_id, weight in history.items():
            row_index = row_by_dish.get(dish_id)
            if row_index is not None:
                profile += weight * features[row_index]
        for ingredient_id in (
            preferred_by_user.get(user_id, set())
            - excluded_users.get(user_id, set())
        ):
            feature_index = ingredient_feature_indices.get(ingredient_id)
            if feature_index is not None:
                profile[feature_index] += preferred_weight
        if not np.any(profile):
            continue

        scores = cosine_similarity(profile.reshape(1, -1), features)[0]
        top = top_dishes(
            scores,
            menu,
            dish_ingredients,
            ordered.get(user_id, set()) if exclude_ordered else set(),
            excluded_users.get(user_id, set()),
            limit,
            min_score,
        )
        rows.extend(recommendation_rows(user_id, top))
    return rows

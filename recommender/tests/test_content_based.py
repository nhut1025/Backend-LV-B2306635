from __future__ import annotations

import unittest

import pandas as pd

from recommender.algorithms.content_based import (
    build_features,
    recommend_content_based,
)


class ContentBasedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dishes = pd.DataFrame(
            [
                (1, "Món đã gọi", 10, True),
                (2, "Món tương tự", 10, True),
                (3, "Món có nguyên liệu loại trừ", 20, True),
                (4, "Món hết hàng", 10, False),
            ],
            columns=["id", "name", "category_id", "is_available"],
        )
        self.ingredients = pd.DataFrame(
            [(1, 100), (2, 100), (3, 200), (4, 100)],
            columns=["dish_id", "ingredient_id"],
        )
        self.orders = pd.DataFrame(
            [(7, 1, 1)],
            columns=["user_id", "dish_id", "quantity"],
        )
        self.feedback = pd.DataFrame(
            columns=["user_id", "dish_id", "sentiment"],
        )
        self.excluded = pd.DataFrame(
            [(7, 200)],
            columns=["user_id", "ingredient_id"],
        )

    def test_builds_category_and_ingredient_features(self) -> None:
        features = build_features(self.dishes, self.ingredients)

        self.assertEqual(features.shape[0], len(self.dishes))
        self.assertGreater(features.shape[1], 0)

    def test_recommends_similar_available_dishes_and_applies_filters(self) -> None:
        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders,
            self.feedback,
            self.excluded,
            min_score=0,
            active_user_ids={7},
        )

        self.assertEqual([row["dish_id"] for row in result], [2])
        self.assertEqual(result[0]["rank_order"], 1)
        self.assertEqual(result[0]["user_id"], 7)

    def test_dislike_reduces_the_customer_profile(self) -> None:
        feedback = pd.DataFrame(
            [(7, 1, "dislike")],
            columns=["user_id", "dish_id", "sentiment"],
        )
        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders,
            feedback,
            self.excluded.iloc[0:0],
            min_score=0.01,
            active_user_ids={7},
        )

        self.assertEqual(result, [])

    def test_can_include_previously_ordered_dishes_for_repeat_evaluation(self) -> None:
        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders,
            self.feedback,
            self.excluded.iloc[0:0],
            min_score=0,
            active_user_ids={7},
            exclude_ordered=False,
        )

        self.assertIn(1, [row["dish_id"] for row in result])

    def test_filters_invalid_orders_feedback_and_inactive_customers(self) -> None:
        orders = pd.DataFrame(
            [(7, 1, 1), (8, 1, 0), (9, 1, None)],
            columns=["user_id", "dish_id", "quantity"],
        )
        feedback = pd.DataFrame(
            [(8, 2, "invalid")],
            columns=["user_id", "dish_id", "sentiment"],
        )
        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            orders,
            feedback,
            self.excluded.iloc[0:0],
            min_score=0,
            active_user_ids={7},
        )

        self.assertEqual({row["user_id"] for row in result}, {7})

    def test_returns_empty_list_for_empty_menu(self) -> None:
        dishes = self.dishes.iloc[0:0].copy()

        result = recommend_content_based(
            dishes,
            self.ingredients,
            self.orders,
            self.feedback,
            self.excluded,
        )

        self.assertEqual(result, [])

    def test_recommends_for_customer_with_preferred_ingredients_and_no_history(self) -> None:
        preferred = pd.DataFrame(
            [(8, 100)],
            columns=["user_id", "ingredient_id"],
        )

        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders.iloc[0:0],
            self.feedback,
            self.excluded.iloc[0:0],
            preferred=preferred,
            active_user_ids={8},
        )

        self.assertEqual([row["dish_id"] for row in result], [1, 2])
        self.assertTrue(all(row["user_id"] == 8 for row in result))

    def test_excluded_ingredient_overrides_preferred_ingredient(self) -> None:
        preferred = pd.DataFrame(
            [(8, 200)],
            columns=["user_id", "ingredient_id"],
        )
        excluded = pd.DataFrame(
            [(8, 200)],
            columns=["user_id", "ingredient_id"],
        )

        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders.iloc[0:0],
            self.feedback,
            excluded,
            preferred=preferred,
            active_user_ids={8},
        )

        self.assertEqual(result, [])

    def test_customer_without_history_or_preferences_gets_no_rows(self) -> None:
        result = recommend_content_based(
            self.dishes,
            self.ingredients,
            self.orders.iloc[0:0],
            self.feedback,
            self.excluded.iloc[0:0],
            active_user_ids={8},
        )

        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()

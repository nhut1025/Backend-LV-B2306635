from __future__ import annotations

import unittest

import pandas as pd

from recommender.algorithms.popularity import recommend_popularity


class PopularityTests(unittest.TestCase):
    def test_counts_each_available_dish_once_per_bill(self) -> None:
        items = pd.DataFrame(
            [
                (1, 10),
                (1, 10),
                (2, 10),
                (2, 11),
            ],
            columns=["bill_id", "dish_id"],
        )
        dishes = pd.DataFrame(
            [(10, True), (11, False), (12, True)],
            columns=["id", "is_available"],
        )

        result = recommend_popularity(
            items,
            dishes,
            top_n=10,
        )

        self.assertEqual(
            [(row["dish_id"], row["score"]) for row in result],
            [(10, 2.0), (12, 0.0)],
        )
        self.assertEqual([row["rank_order"] for row in result], [1, 2])

    def test_ties_are_ranked_by_dish_id(self) -> None:
        items = pd.DataFrame(
            [
                (2, 20),
                (1, 10),
            ],
            columns=["bill_id", "dish_id"],
        )
        dishes = pd.DataFrame(
            [(20, True), (10, True)],
            columns=["id", "is_available"],
        )

        result = recommend_popularity(
            items,
            dishes,
        )

        self.assertEqual([row["dish_id"] for row in result], [10, 20])
        self.assertEqual([row["rank_order"] for row in result], [1, 2])

    def test_returns_empty_for_empty_items(self) -> None:
        items = pd.DataFrame(columns=["bill_id", "dish_id"])
        dishes = pd.DataFrame([(10, True)], columns=["id", "is_available"])

        self.assertEqual(recommend_popularity(items, dishes), [])


if __name__ == "__main__":
    unittest.main()

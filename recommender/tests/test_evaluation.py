from __future__ import annotations

import unittest
import math
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluate_train_test import evaluate
from recommender.evaluation import (
    random_baseline_metrics,
    ranking_metrics,
    split_by_time,
)


class RankingMetricTests(unittest.TestCase):
    def test_computes_precision_recall_and_ndcg_at_k(self) -> None:
        metrics = ranking_metrics([20, 40, 10], {10, 20, 30}, k=2)

        self.assertAlmostEqual(metrics["precision"], 0.5)
        self.assertAlmostEqual(metrics["recall"], 1 / 3)
        self.assertAlmostEqual(
            metrics["ndcg"],
            1 / (1 + 1 / math.log2(3)),
        )

    def test_deduplicates_recommendations_before_scoring(self) -> None:
        metrics = ranking_metrics([10, 10, 20], {10, 20}, k=2)

        self.assertEqual(metrics["precision"], 1.0)
        self.assertEqual(metrics["recall"], 1.0)
        self.assertEqual(metrics["ndcg"], 1.0)

    def test_requires_positive_k_and_relevant_items(self) -> None:
        with self.assertRaisesRegex(ValueError, "số nguyên dương"):
            ranking_metrics([10], {10}, k=0)
        with self.assertRaisesRegex(ValueError, "ít nhất một món"):
            ranking_metrics([10], set(), k=1)

    def test_random_baseline_is_expected_score_over_available_candidates(self) -> None:
        metrics = random_baseline_metrics({10, 20, 30, 40}, {10, 20}, k=2)

        self.assertAlmostEqual(metrics["precision"], 0.5)
        self.assertAlmostEqual(metrics["recall"], 0.5)
        self.assertAlmostEqual(
            metrics["ndcg"],
            (0.5 * (1 + 1 / math.log2(3)))
            / (1 + 1 / math.log2(3)),
        )


class TimeSplitTests(unittest.TestCase):
    def test_splits_whole_bills_and_keeps_newest_dates_for_test(self) -> None:
        interactions = pd.DataFrame(
            [
                (1, 10, 100, 1, "2026-01-01 10:00:00"),
                (1, 10, 101, 2, "2026-01-01 10:00:00"),
                (2, 10, 100, 1, "2026-01-02 10:00:00"),
                (3, 10, 102, 1, "2026-01-03 10:00:00"),
                (4, 10, 100, 1, "2026-01-04 10:00:00"),
                (5, None, 103, 1, "2026-01-05 10:00:00"),
            ],
            columns=["bill_id", "user_id", "dish_id", "quantity", "paid_at"],
        )

        train, test, metadata = split_by_time(interactions, train_ratio=0.6)

        self.assertEqual(set(train["bill_id"]), {1, 2, 3})
        self.assertEqual(set(test["bill_id"]), {4, 5})
        self.assertFalse(set(train["bill_id"]) & set(test["bill_id"]))
        self.assertEqual(metadata["test_customers_with_train_history"], 1)
        self.assertEqual(metadata["walk_in_test_bill_count"], 1)

    def test_ignores_invalid_quantity_rows(self) -> None:
        interactions = pd.DataFrame(
            [
                (1, 10, 100, 1, "2026-01-01 10:00:00"),
                (2, 10, 100, 0, "2026-01-02 10:00:00"),
                (3, 10, 100, 1, "2026-01-03 10:00:00"),
            ],
            columns=["bill_id", "user_id", "dish_id", "quantity", "paid_at"],
        )

        train, test, _ = split_by_time(interactions, train_ratio=0.5)

        self.assertEqual(set(train["bill_id"]), {1})
        self.assertEqual(set(test["bill_id"]), {3})

    def test_requires_at_least_two_distinct_paid_dates(self) -> None:
        interactions = pd.DataFrame(
            [(1, 10, 100, 1, "2026-01-01 10:00:00")],
            columns=["bill_id", "user_id", "dish_id", "quantity", "paid_at"],
        )

        with self.assertRaisesRegex(ValueError, "ít nhất hai ngày"):
            split_by_time(interactions)


class EvaluationScopeTests(unittest.TestCase):
    def test_repeat_scope_scores_items_seen_in_training(self) -> None:
        train = pd.DataFrame(
            [(1, 7, 1, 1, "2026-01-01 10:00:00")],
            columns=["bill_id", "user_id", "dish_id", "quantity", "paid_at"],
        )
        test = pd.DataFrame(
            [(2, 7, 1, 1, "2026-01-02 10:00:00")],
            columns=["bill_id", "user_id", "dish_id", "quantity", "paid_at"],
        )
        dishes = pd.DataFrame(
            [(1, "Món quen", 10, True), (2, "Món khác", 10, True)],
            columns=["id", "name", "category_id", "is_available"],
        )
        ingredients = pd.DataFrame(
            [(1, 100), (2, 100)],
            columns=["dish_id", "ingredient_id"],
        )

        metrics, counts = evaluate(
            train,
            test,
            dishes,
            ingredients,
            [1],
            evaluation_scope="both",
        )

        self.assertEqual(counts["evaluated_customers_new"], 0)
        self.assertEqual(counts["evaluated_customers_all"], 1)
        self.assertEqual(metrics["new"], {})
        self.assertEqual(metrics["all"]["popularity"][1]["precision"], 1.0)
        self.assertIn("content_based", metrics["all"])
        self.assertNotIn("co_occurrence", metrics["all"])
        self.assertNotIn("hybrid", metrics["all"])


if __name__ == "__main__":
    unittest.main()

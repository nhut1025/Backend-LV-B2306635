from __future__ import annotations

import unittest
from typing import Any

from recommender.dataset import (
    load_content_based_dataset,
    load_popularity_dataset,
    replace_global_recommendations,
    replace_user_recommendations,
)


class FakeCursor:
    def __init__(self) -> None:
        self.statements: list[tuple[str, Any]] = []
        self.batch: tuple[str, Any] | None = None

    def execute(self, query: str, params: Any) -> None:
        self.statements.append((query, params))

    def executemany(self, query: str, values: Any) -> None:
        self.batch = (query, values)

    def close(self) -> None:
        pass


class FakeConnection:
    def __init__(self) -> None:
        self.fake_cursor = FakeCursor()

    def cursor(self) -> FakeCursor:
        return self.fake_cursor


class FakeReadCursor:
    def __init__(self, results: list[list[dict[str, Any]]] | None = None) -> None:
        self.results = results or [
            [{"bill_id": 1, "dish_id": 8}],
            [{"id": 8, "is_available": 1}],
        ]
        self.result_index = -1
        self.statements: list[tuple[str, Any]] = []

    def execute(self, query: str, params: Any = ()) -> None:
        self.statements.append((query, params))
        self.result_index += 1

    def fetchall(self) -> list[dict[str, Any]]:
        return self.results[self.result_index]

    def close(self) -> None:
        pass


class FakeReadConnection:
    def __init__(self) -> None:
        self.fake_cursor = FakeReadCursor()

    def cursor(self, dictionary: bool = False) -> FakeReadCursor:
        return self.fake_cursor


class DatasetTests(unittest.TestCase):
    def test_loads_popularity_inputs_as_dataframes(self) -> None:
        dataset = load_popularity_dataset(FakeReadConnection())

        self.assertEqual(list(dataset["items"].columns), ["bill_id", "dish_id"])
        self.assertEqual(list(dataset["dishes"].columns), ["id", "is_available"])
        self.assertEqual(dataset["items"].iloc[0].to_dict(), {"bill_id": 1, "dish_id": 8})
        self.assertEqual(dataset["dishes"].iloc[0].to_dict(), {"id": 8, "is_available": 1})

    def test_loads_user_preferred_ingredients_with_customer_filter(self) -> None:
        cursor = FakeReadCursor(
            [
                [{"id": 8, "name": "Món", "category_id": 2, "is_available": 1}],
                [{"dish_id": 8, "ingredient_id": 9}],
                [],
                [],
                [],
                [{"user_id": 12, "ingredient_id": 9}],
                [{"id": 12}],
            ]
        )

        class Connection:
            def cursor(self, dictionary: bool = False) -> FakeReadCursor:
                return cursor

        dataset = load_content_based_dataset(Connection(), user_id=12)

        self.assertEqual(
            dataset["preferred"].iloc[0].to_dict(),
            {"user_id": 12, "ingredient_id": 9},
        )
        preferred_query, params = cursor.statements[5]
        self.assertIn("FROM user_preferred_ingredients", preferred_query)
        self.assertIn("WHERE user_id = %s", preferred_query)
        self.assertEqual(params, (12,))

    def test_replaces_only_the_global_rows_for_the_selected_model(self) -> None:
        connection = FakeConnection()
        recommendations = [
            {
                "user_id": None,
                "dish_id": 8,
                "model_name": "popularity",
                "score": 1.23456,
                "rank_order": 1,
            }
        ]

        replace_global_recommendations(connection, "popularity", recommendations)

        self.assertIn("user_id IS NULL", connection.fake_cursor.statements[0][0])
        self.assertEqual(connection.fake_cursor.statements[0][1], ("popularity",))
        self.assertEqual(
            connection.fake_cursor.batch[1],
            [(None, 8, "popularity", 1.2346, 1)],
        )

    def test_replaces_only_the_selected_user_rows(self) -> None:
        connection = FakeConnection()
        recommendations = [
            {
                "user_id": 12,
                "dish_id": 8,
                "score": 0.87654,
                "rank_order": 1,
            }
        ]

        replace_user_recommendations(
            connection,
            "content_based",
            recommendations,
            user_id=12,
        )

        self.assertEqual(
            connection.fake_cursor.statements[0][1],
            (12, "content_based"),
        )
        self.assertIn("user_id = %s", connection.fake_cursor.statements[0][0])
        self.assertEqual(
            connection.fake_cursor.batch[1],
            [(12, 8, "content_based", 0.8765, 1)],
        )


if __name__ == "__main__":
    unittest.main()

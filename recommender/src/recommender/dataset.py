from __future__ import annotations

from collections.abc import Sequence
import re
from typing import Any

import pandas as pd


def _query_frame(
    cursor: Any,
    query: str,
    columns: tuple[str, ...],
    params: tuple[Any, ...] = (),
) -> pd.DataFrame:
    cursor.execute(query, params)
    return pd.DataFrame(cursor.fetchall(), columns=columns)


def load_popularity_dataset(connection: Any) -> dict[str, pd.DataFrame]:
    cursor = connection.cursor(dictionary=True)
    try:
        items = _query_frame(
            cursor,
            """
            SELECT DISTINCT bi.bill_id, bi.dish_id
            FROM bill_items bi
            JOIN bills b ON b.id = bi.bill_id
            WHERE b.status = 'da_thanh_toan'
              AND b.payment_method IS NOT NULL
              AND bi.deleted_at IS NULL
            """,
            ("bill_id", "dish_id"),
        )
        dishes = _query_frame(
            cursor,
            "SELECT id, is_available FROM dishes",
            ("id", "is_available"),
        )
        return {"items": items, "dishes": dishes}
    finally:
        cursor.close()


def load_content_based_dataset(
    connection: Any, user_id: int | None = None
) -> dict[str, pd.DataFrame]:
    cursor = connection.cursor(dictionary=True)
    user_clause = "AND r.user_id = %s" if user_id is not None else ""
    review_user_clause = "AND br.user_id = %s" if user_id is not None else ""
    excluded_user_clause = "WHERE user_id = %s" if user_id is not None else ""
    preferred_user_clause = "WHERE user_id = %s" if user_id is not None else ""
    params = (user_id,) if user_id is not None else ()
    try:
        dishes = _query_frame(
            cursor,
            "SELECT id, name, category_id, is_available FROM dishes",
            ("id", "name", "category_id", "is_available"),
        )
        ingredients = _query_frame(
            cursor,
            "SELECT dish_id, ingredient_id FROM dish_ingredients",
            ("dish_id", "ingredient_id"),
        )
        orders = _query_frame(
            cursor,
            f"""
            SELECT r.user_id, bi.dish_id, bi.quantity
            FROM bills b
            JOIN reservations r ON r.id = b.reservation_id
            JOIN bill_items bi ON bi.bill_id = b.id
            WHERE b.status = 'da_thanh_toan'
              AND b.payment_method IS NOT NULL
              AND bi.deleted_at IS NULL
              AND bi.quantity > 0
              {user_clause}
            """,
            ("user_id", "dish_id", "quantity"),
            params,
        )
        feedback = _query_frame(
            cursor,
            f"""
            SELECT br.user_id, bi.dish_id, bri.sentiment
            FROM bill_review_items bri
            JOIN bill_reviews br ON br.id = bri.bill_review_id
            JOIN bills b ON b.id = br.bill_id
            JOIN reservations r ON r.id = b.reservation_id
                               AND r.user_id = br.user_id
            JOIN bill_items bi ON bi.id = bri.bill_item_id
            WHERE b.status = 'da_thanh_toan'
              AND b.payment_method IS NOT NULL
              AND bi.deleted_at IS NULL
              {review_user_clause}
            """,
            ("user_id", "dish_id", "sentiment"),
            params,
        )
        excluded = _query_frame(
            cursor,
            f"""
            SELECT user_id, ingredient_id
            FROM user_excluded_ingredients
            {excluded_user_clause}
            """,
            ("user_id", "ingredient_id"),
            params,
        )
        preferred = _query_frame(
            cursor,
            f"""
            SELECT user_id, ingredient_id
            FROM user_preferred_ingredients
            {preferred_user_clause}
            """,
            ("user_id", "ingredient_id"),
            params,
        )
        if user_id is None:
            users = _query_frame(
                cursor,
                "SELECT id FROM users WHERE role = 'customer' AND is_active = 1",
                ("id",),
            )
        else:
            users = _query_frame(
                cursor,
                "SELECT id FROM users WHERE id = %s AND role = 'customer' AND is_active = 1",
                ("id",),
                params,
            )
        return {
            "dishes": dishes,
            "ingredients": ingredients,
            "orders": orders,
            "feedback": feedback,
            "excluded": excluded,
            "preferred": preferred,
            "users": users,
        }
    finally:
        cursor.close()


def replace_global_recommendations(
    connection: Any,
    model_name: str,
    recommendations: Sequence[dict[str, Any]],
) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,49}", model_name):
        raise ValueError("Tên mô hình không hợp lệ.")

    cursor = connection.cursor()
    try:
        cursor.execute(
            "DELETE FROM dish_recommendations WHERE user_id IS NULL AND model_name = %s",
            (model_name,),
        )
        if recommendations:
            values = [
                (
                    row["user_id"],
                    int(row["dish_id"]),
                    model_name,
                    round(float(row["score"]), 4),
                    index,
                )
                for index, row in enumerate(recommendations, start=1)
            ]
            cursor.executemany(
                """
                INSERT INTO dish_recommendations
                    (user_id, dish_id, model_name, score, rank_order)
                VALUES (%s, %s, %s, %s, %s)
                """,
                values,
            )
    finally:
        cursor.close()


def replace_user_recommendations(
    connection: Any,
    model_name: str,
    recommendations: Sequence[dict[str, Any]],
    user_id: int | None = None,
) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,49}", model_name):
        raise ValueError("Tên mô hình không hợp lệ.")

    cursor = connection.cursor()
    try:
        if user_id is None:
            cursor.execute(
                "DELETE FROM dish_recommendations WHERE user_id IS NOT NULL AND model_name = %s",
                (model_name,),
            )
        else:
            cursor.execute(
                "DELETE FROM dish_recommendations WHERE user_id = %s AND model_name = %s",
                (user_id, model_name),
            )
        if recommendations:
            values = [
                (
                    int(row["user_id"]),
                    int(row["dish_id"]),
                    model_name,
                    round(float(row["score"]), 4),
                    int(row["rank_order"]),
                )
                for row in recommendations
            ]
            cursor.executemany(
                """
                INSERT INTO dish_recommendations
                    (user_id, dish_id, model_name, score, rank_order)
                VALUES (%s, %s, %s, %s, %s)
                """,
                values,
            )
    finally:
        cursor.close()

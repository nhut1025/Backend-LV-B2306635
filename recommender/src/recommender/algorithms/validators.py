from __future__ import annotations

import math
from typing import Iterable

import pandas as pd


def require_columns(
    dataframe: pd.DataFrame,
    required: Iterable[str],
    name: str,
) -> None:
    if not isinstance(dataframe, pd.DataFrame):
        raise TypeError(f"{name} phải là pandas DataFrame.")
    missing = [column for column in required if column not in dataframe.columns]
    if missing:
        raise ValueError(f"{name} thiếu cột: {', '.join(missing)}")


def validate_positive_integer(value: int, name: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} phải là số nguyên dương.")


def validate_non_negative(value: float, name: str) -> None:
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} phải là số không âm.")


def validate_score_threshold(value: float, name: str = "min_score") -> None:
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} phải nằm trong khoảng 0 đến 1.")


def clean_positive_rows(
    dataframe: pd.DataFrame,
    name: str,
    id_columns: Iterable[str],
    quantity_column: str | None = None,
) -> pd.DataFrame:
    columns = list(id_columns)
    if quantity_column is not None:
        columns.append(quantity_column)
    require_columns(dataframe, columns, name)

    clean = dataframe[columns].copy()
    for column in columns:
        clean[column] = pd.to_numeric(clean[column], errors="coerce")
    clean = clean.dropna(subset=columns)
    for column in id_columns:
        clean = clean[(clean[column] > 0) & (clean[column] % 1 == 0)]
        clean[column] = clean[column].astype("int64")
    if quantity_column is not None:
        clean = clean[clean[quantity_column] > 0]
    return clean.reset_index(drop=True)


def clean_feedback(dataframe: pd.DataFrame) -> pd.DataFrame:
    require_columns(dataframe, ("user_id", "dish_id", "sentiment"), "feedback")
    clean = dataframe[["user_id", "dish_id", "sentiment"]].copy()
    for column in ("user_id", "dish_id"):
        clean[column] = pd.to_numeric(clean[column], errors="coerce")
    clean = clean.dropna(subset=["user_id", "dish_id"])
    for column in ("user_id", "dish_id"):
        clean = clean[(clean[column] > 0) & (clean[column] % 1 == 0)]
        clean[column] = clean[column].astype("int64")
    return clean[clean["sentiment"].isin(("like", "dislike"))].reset_index(drop=True)

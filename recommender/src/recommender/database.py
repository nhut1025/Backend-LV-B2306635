from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import mysql.connector
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(BACKEND_ROOT / ".env")


def get_db_connection() -> Any:
    required = ("DB_HOST", "DB_USER", "DB_NAME")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Thiếu cấu hình database: {', '.join(missing)}")

    return mysql.connector.connect(
        host=os.environ["DB_HOST"],
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.environ["DB_USER"],
        password=os.getenv("DB_PASSWORD", ""),
        database=os.environ["DB_NAME"],
    )

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

RECOMMENDER_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(RECOMMENDER_ROOT / "src"))

from recommender.database import get_db_connection
from recommender.evaluation import INTERACTION_COLUMNS, split_by_time


def load_paid_interactions() -> tuple[list[dict], str]:
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SELECT DATABASE() AS database_name")
        database_name = cursor.fetchone()["database_name"]
        cursor.execute(
            """
            SELECT b.id AS bill_id,
                   r.user_id,
                   bi.dish_id,
                   bi.quantity,
                   b.paid_at
            FROM bills b
            JOIN bill_items bi ON bi.bill_id = b.id
            LEFT JOIN reservations r ON r.id = b.reservation_id
            WHERE b.status = 'da_thanh_toan'
              AND b.payment_method IS NOT NULL
              AND b.paid_at IS NOT NULL
              AND bi.deleted_at IS NULL
              AND bi.quantity > 0
            ORDER BY b.paid_at, b.id, bi.dish_id
            """
        )
        return cursor.fetchall(), database_name
    finally:
        cursor.close()
        connection.close()


def parse_bill_ids(value: str) -> set[int]:
    bill_ids: set[int] = set()
    for token in value.split(","):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", maxsplit=1)
            start, end = int(start_text), int(end_text)
            if start < 1 or end < start:
                raise ValueError("Mỗi khoảng bill phải có ID dương và đầu-cuối hợp lệ.")
            bill_ids.update(range(start, end + 1))
        else:
            bill_id = int(token)
            if bill_id < 1:
                raise ValueError("Bill ID cần loại phải là số nguyên dương.")
            bill_ids.add(bill_id)
    return bill_ids


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Tách bill đã thanh toán thành tập train/test theo paid_at."
    )
    parser.add_argument(
        "--train-ratio",
        type=float,
        default=0.8,
        help="Tỷ lệ ngày thanh toán cũ hơn dành cho train (mặc định 0.8).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=RECOMMENDER_ROOT / "data",
        help="Thư mục lưu train.csv, test.csv và split_metadata.json.",
    )
    parser.add_argument(
        "--exclude-bill-ids",
        default="",
        help="Loại bill khỏi snapshot, ví dụ --exclude-bill-ids 1-19,25.",
    )
    args = parser.parse_args()

    excluded_bill_ids = parse_bill_ids(args.exclude_bill_ids)
    raw_interactions, database_name = load_paid_interactions()
    interactions = pd.DataFrame(
        raw_interactions,
        columns=INTERACTION_COLUMNS,
    )
    excluded_mask = interactions["bill_id"].isin(excluded_bill_ids)
    excluded_bill_count = int(
        interactions.loc[excluded_mask, "bill_id"].nunique()
    )
    interactions = interactions.loc[~excluded_mask].copy()
    train, test, metadata = split_by_time(interactions, args.train_ratio)
    metadata["database"] = database_name
    metadata["excluded_bill_ids"] = sorted(excluded_bill_ids)
    metadata["excluded_bill_count"] = excluded_bill_count

    args.output_dir.mkdir(parents=True, exist_ok=True)
    train.to_csv(args.output_dir / "train.csv", index=False, columns=INTERACTION_COLUMNS)
    test.to_csv(args.output_dir / "test.csv", index=False, columns=INTERACTION_COLUMNS)
    with (args.output_dir / "split_metadata.json").open("w", encoding="utf-8") as file:
        json.dump(metadata, file, ensure_ascii=False, indent=2)

    print(f"Đã tạo tập train/test trong: {args.output_dir.resolve()}")
    print(f"Database nguồn: {database_name}")
    if excluded_bill_ids:
        print(
            f"Đã loại {excluded_bill_count} bill khỏi snapshot theo danh sách ID "
            "(không xóa khỏi database)."
        )
    print(f"Mốc bắt đầu test: {metadata['cutoff_date']}")
    print(
        f"Train: {metadata['train_bill_count']} bill, "
        f"{metadata['train_interaction_count']} dòng món."
    )
    print(
        f"Test: {metadata['test_bill_count']} bill, "
        f"{metadata['test_interaction_count']} dòng món."
    )
    print(
        f"Khách test có lịch sử train: "
        f"{metadata['test_customers_with_train_history']}/"
        f"{metadata['test_customer_count']}."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Không thể tạo tập train/test: {error}")
        raise SystemExit(1) from error

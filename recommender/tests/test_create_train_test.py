from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from create_train_test import parse_bill_ids


class ExcludedBillIdTests(unittest.TestCase):
    def test_parses_ids_and_inclusive_ranges(self) -> None:
        self.assertEqual(parse_bill_ids("1-3, 5,7-8"), {1, 2, 3, 5, 7, 8})

    def test_rejects_invalid_ranges_and_non_positive_ids(self) -> None:
        for value in ("0", "4-2", "1-x"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_bill_ids(value)


if __name__ == "__main__":
    unittest.main()

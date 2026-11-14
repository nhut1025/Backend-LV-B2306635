from __future__ import annotations

import sys
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from recommender.pipeline import main


if __name__ == "__main__":
    raise SystemExit(main())

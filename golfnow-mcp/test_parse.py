#!/usr/bin/env python3
"""
Offline parse tester — no browser needed.
1. Run workflow with "dump_raw" input checked to create debug_raw.json
2. Then run: python3 golfnow-mcp/test_parse.py
"""
import json
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(levelname)s %(message)s")

sys.path.insert(0, str(Path(__file__).parent))
from scraper import filter_and_sort, parse_tee_times_from_ttresults

raw_path = Path(__file__).parent / "debug_raw.json"
if not raw_path.exists():
    print("debug_raw.json not found — trigger the workflow with 'dump_raw' checked first.")
    sys.exit(1)

raw = json.loads(raw_path.read_text())
print(f"Top-level type: {type(raw).__name__}")
if isinstance(raw, dict):
    print(f"Keys: {list(raw.keys())}")

ttresults = raw.get("ttResults") if isinstance(raw, dict) else raw
if isinstance(ttresults, dict):
    print(f"ttResults: dict with {len(ttresults)} entries, converting to list")
    ttresults = list(ttresults.values())
elif isinstance(ttresults, list):
    print(f"ttResults: list with {len(ttresults)} items")
else:
    print(f"ttResults: unexpected type {type(ttresults)}")
    sys.exit(1)

if ttresults:
    print(f"\nFirst item keys: {list(ttresults[0].keys()) if isinstance(ttresults[0], dict) else type(ttresults[0])}")
    sample_keys = ["id", "name", "minPrice", "minDate", "hasHotDeal", "distance", "averageRating",
                   "isPriceRangeZero", "isTimeRangeZero", "numberOfReviews"]
    first = ttresults[0]
    for k in sample_keys:
        if k in first:
            print(f"  {k}: {first[k]}")

date_str = (date.today() + timedelta(days=(5 - date.today().weekday()) % 7 or 7)).isoformat()
print(f"\nParsing as date: {date_str}")

slots = parse_tee_times_from_ttresults(ttresults, date_str)
print(f"Raw slots: {len(slots)}")

results = filter_and_sort(slots)
print(f"After filter/sort: {len(results)}\n")

for r in results[:15]:
    hot = " HOT" if r["is_hot_deal"] else ""
    print(f"  {r['tee_time']:5}  £{r['price_gbp']:5.0f}  {r['course_name'][:40]:40}  "
          f"★{r['course_rating']:.1f}  {r['distance_miles'] or '?':.0f}mi{hot}")

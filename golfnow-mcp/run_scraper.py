#!/usr/bin/env python3
"""
Standalone runner — called by GitHub Actions to refresh api/golf-cache.json.
Usage: python3 golfnow-mcp/run_scraper.py > api/golf-cache.json
"""
import asyncio
import json
import logging
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Log to stderr so it shows in Actions without conflicting with stdout JSON
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

sys.path.insert(0, str(Path(__file__).parent))

from scraper import filter_and_sort, get_upcoming_weekends, scrape_date, scrape_raw


def eprint(*args):
    print(*args, file=sys.stderr, flush=True)


async def dump_raw(browser_auth: str) -> None:
    """Scrape one date, save raw API response to debug_raw.json, exit."""
    dates = get_upcoming_weekends(1)
    # Prefer the next Saturday; fall back to first available date
    date_str = next((d for d in dates if __import__('datetime').date.fromisoformat(d).weekday() == 5), dates[0])
    eprint(f"Dump mode: fetching raw response for {date_str}")
    raw = await scrape_raw(browser_auth=browser_auth, date_str=date_str)
    out = Path(__file__).parent / "debug_raw.json"
    out.write_text(json.dumps(raw, default=str, indent=2))
    eprint(f"Saved {out} ({out.stat().st_size} bytes)")


async def main():
    browser_auth = os.environ.get("BROWSER_AUTH", "")
    if not browser_auth:
        json.dump({"tee_times": [], "scraped_at": None, "error": "BROWSER_AUTH not set"}, sys.stdout)
        sys.exit(1)

    if "--dump" in sys.argv:
        await dump_raw(browser_auth)
        return

    dates = get_upcoming_weekends(1)  # just the next weekend (Sat + Sun)
    eprint(f"Dates to scrape: {dates}")

    all_results = []
    errors = []

    for date_str in dates:
        eprint(f"--- Scraping {date_str} ---")
        try:
            raw = await scrape_date(browser_auth=browser_auth, date_str=date_str, players=2)
            eprint(f"  Got {len(raw)} raw slots")
            all_results.extend(raw)
        except Exception as e:
            eprint(f"  ERROR ({type(e).__name__}): {e}")
            eprint(traceback.format_exc())
            errors.append(f"{date_str}: {type(e).__name__}: {e}")

    eprint(f"Total raw slots: {len(all_results)}")
    results = filter_and_sort(all_results, max_price=None, min_players=2)[:30]
    eprint(f"After filter/sort: {len(results)}")

    output = {
        "tee_times": results,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "error": "; ".join(errors) if errors and not results else None,
    }
    json.dump(output, sys.stdout, default=str, indent=2)
    eprint("Done.")


if __name__ == "__main__":
    asyncio.run(main())

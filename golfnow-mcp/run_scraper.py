#!/usr/bin/env python3
"""
Standalone runner — called by GitHub Actions to refresh api/golf-cache.json.
Usage: python3 golfnow-mcp/run_scraper.py > api/golf-cache.json
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from scraper import filter_and_sort, get_upcoming_weekends, scrape_date


async def main():
    browser_auth = os.environ.get("BROWSER_AUTH", "")
    if not browser_auth:
        json.dump({"tee_times": [], "scraped_at": None, "error": "BROWSER_AUTH not set"}, sys.stdout)
        sys.exit(1)

    dates = get_upcoming_weekends(4)
    all_results = []
    errors = []

    for date_str in dates:
        try:
            raw = await scrape_date(browser_auth=browser_auth, date_str=date_str, players=2)
            all_results.extend(raw)
        except Exception as e:
            errors.append(f"{date_str}: {e}")

    results = filter_and_sort(all_results, max_price=None, min_players=2)[:30]

    output = {
        "tee_times": results,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "error": "; ".join(errors) if errors and not results else None,
    }
    json.dump(output, sys.stdout, default=str, indent=2)


if __name__ == "__main__":
    asyncio.run(main())

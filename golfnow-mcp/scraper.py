"""
GolfNow UK scraping logic.
Imported by server.py — not intended to be run directly.
"""

import asyncio
import logging
from datetime import date, timedelta

from playwright.async_api import async_playwright

log = logging.getLogger(__name__)

BASE_URL = "https://www.golfnow.co.uk"

# Wimbledon coordinates
DEFAULT_LAT = 51.4161
DEFAULT_LNG = -0.2062
DEFAULT_RADIUS = 13
DEFAULT_TIME_MIN = 5
DEFAULT_TIME_MAX = 17
DEFAULT_HOLES = "eighteen"
DEFAULT_MIN_RATING = 3.0


def get_upcoming_weekends(num_weekends: int = 4) -> list[str]:
    """Return YYYY-MM-DD strings for the next N Saturdays and Sundays."""
    today = date.today()
    results: list[str] = []
    d = today
    while len(results) < num_weekends * 2:
        if d.weekday() in (5, 6):
            results.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return results


def _extract_list(raw: dict | list, *keys) -> list:
    """Try to extract a list from a dict using multiple candidate keys, or nested structures."""
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, dict):
        return []
    # Try top-level keys
    for k in keys:
        v = raw.get(k)
        if isinstance(v, list) and v:
            return v
    # Try one level of nesting
    for v in raw.values():
        if isinstance(v, dict):
            for k in keys:
                inner = v.get(k)
                if isinstance(inner, list) and inner:
                    return inner
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    return []


def parse_courses(raw: dict | list, min_rating: float = DEFAULT_MIN_RATING) -> list[dict]:
    """Extract course info from courses-near-me response."""
    if not raw:
        return []

    if isinstance(raw, dict):
        log.info(f"Courses response top-level keys: {list(raw.keys())}")

    courses_list = _extract_list(
        raw,
        "ttResults", "courses", "facilities", "results", "data",
        "teeTimeFacilities", "searchResults", "items", "records",
    )

    if not courses_list:
        log.warning(f"parse_courses: could not find course list in response (keys={list(raw.keys()) if isinstance(raw, dict) else type(raw).__name__})")
        return []

    log.info(f"parse_courses: {len(courses_list)} items, first keys={list(courses_list[0].keys()) if courses_list else '?'}")
    if courses_list:
        import json as _json
        log.info(f"first item sample: {_json.dumps(courses_list[0], default=str)[:600]}")

    parsed = []
    for c in courses_list:
        try:
            rating_raw = (
                c.get("averageRating") or c.get("starRating") or c.get("rating")
                or c.get("overallRating") or c.get("golfAdvisorRating") or 0
            )
            rating = float(rating_raw) if rating_raw else 0.0

            if 0 < rating < min_rating:
                continue

            # address may be a nested dict or a plain string
            addr = c.get("address") or {}
            if isinstance(addr, dict):
                address_str = ", ".join(filter(None, [
                    addr.get("line1") or addr.get("address1"),
                    addr.get("city") or addr.get("town"),
                    addr.get("stateProvince") or addr.get("county"),
                    addr.get("postalCode") or addr.get("postCode"),
                ]))
            else:
                address_str = str(addr)

            dist = c.get("distanceMiles") or c.get("distanceInMiles")
            if dist is None:
                d = c.get("distance")
                dist = d if isinstance(d, (int, float)) else None

            parsed.append({
                "facility_id": (
                    c.get("facilityId") or c.get("id")
                    or c.get("courseId") or c.get("facility", {}).get("id")
                ),
                "name": (
                    c.get("name") or c.get("facilityName")
                    or c.get("courseName") or "Unknown course"
                ),
                "address": address_str,
                "distance_miles": dist,
                "rating": rating,
                "review_count": (
                    c.get("numberOfReviews") or c.get("numberOfRatings")
                    or c.get("reviewCount") or c.get("ratingCount") or 0
                ),
                "holes": c.get("numberOfHoles") or 18,
            })
        except Exception as e:
            log.warning(f"Skipping malformed course: {e}")

    return parsed


def parse_tee_times(
    raw: dict | list,
    hot_deals_raw: dict | list | None,
    course: dict,
    date_str: str,
) -> list[dict]:
    """Flatten teeTimeGroups response into individual tee time records."""
    if not raw:
        return []

    hot_deal_ids: set = set()
    if hot_deals_raw:
        deals = (
            hot_deals_raw.get("hotDeals") or hot_deals_raw.get("teeTimes")
            or (hot_deals_raw if isinstance(hot_deals_raw, list) else [])
        )
        for d in deals:
            tid = d.get("teeTimeId") or d.get("id")
            if tid:
                hot_deal_ids.add(str(tid))

    groups = (
        raw.get("teeTimeGroups") or raw.get("groups")
        or raw.get("teeTimeSets")
        or (raw if isinstance(raw, list) else [])
    )

    if groups and isinstance(groups[0], dict) and (
        "time" in groups[0] or "teeTime" in groups[0]
    ):
        groups = [{"groupName": "All Times", "teeTimes": groups}]

    slots = []
    for group in groups:
        group_name = group.get("groupName") or group.get("name") or "All Times"
        time_slots = (
            group.get("teeTimes") or group.get("slots") or group.get("times") or []
        )

        for slot in time_slots:
            try:
                tee_time_id = str(
                    slot.get("teeTimeId") or slot.get("id")
                    or slot.get("reservationId") or ""
                )
                price_raw = (
                    slot.get("price") or slot.get("cost") or slot.get("lowestPrice")
                    or slot.get("totalCost") or slot.get("ratePrice") or 0
                )
                price_str = (
                    str(price_raw).replace("£", "").replace("$", "")
                    .replace(",", "").strip()
                )
                price = float(price_str) if price_str and price_str != "0" else 0.0

                time_str = (
                    slot.get("time") or slot.get("teeTime") or slot.get("startTime")
                    or slot.get("teeTimeLocalDateTime") or ""
                )
                if "T" in str(time_str):
                    time_str = str(time_str).split("T")[1][:5]

                is_hot_deal = bool(
                    slot.get("isHotDeal") or slot.get("hotDeal")
                    or "hot deal" in group_name.lower()
                    or tee_time_id in hot_deal_ids
                )

                slots.append({
                    "date": date_str,
                    "tee_time": time_str,
                    "course_name": course["name"],
                    "facility_id": course["facility_id"],
                    "course_rating": course["rating"],
                    "course_review_count": course["review_count"],
                    "course_address": course["address"],
                    "distance_miles": course["distance_miles"],
                    "holes": slot.get("holes") or slot.get("numberOfHoles") or course["holes"] or 18,
                    "max_players": (
                        slot.get("maxPlayers") or slot.get("players")
                        or slot.get("maxGolfers") or slot.get("spots") or 4
                    ),
                    "price_gbp": price,
                    "is_hot_deal": is_hot_deal,
                    "rate_type": (
                        slot.get("rateType") or slot.get("rateDescription") or group_name
                    ),
                    "booking_url": (
                        f"{BASE_URL}/tee-times/facility/{course['facility_id']}/tee-time/{tee_time_id}"
                        if tee_time_id
                        else f"{BASE_URL}/tee-times/facility/{course['facility_id']}/search"
                    ),
                    "scraped_date": date.today().isoformat(),
                })
            except Exception as e:
                log.debug(f"Skipping malformed slot: {e}")

    return slots


def filter_and_sort(
    results: list[dict],
    max_price: float | None = None,
    min_players: int = 2,
) -> list[dict]:
    """Filter by price/players and sort: hot deals first → cheapest → highest rated."""
    filtered = [
        r for r in results
        if r["price_gbp"] > 0
        and (max_price is None or r["price_gbp"] <= max_price)
        and r["max_players"] >= min_players
    ]
    filtered.sort(key=lambda r: (
        not r["is_hot_deal"],
        r["price_gbp"],
        -r["course_rating"],
        r["date"],
        r["tee_time"],
    ))
    return filtered


async def _wait_for_json(page, url_fragment: str, timeout_secs: int = 30) -> dict | list | None:
    """
    Register a response listener, wait for a response whose URL contains url_fragment,
    read its JSON immediately when it fires, then remove the listener.
    Reading inside the callback avoids 'No resource with given identifier found'.
    """
    result = {"data": None}
    event = asyncio.Event()

    async def handler(response):
        if url_fragment in response.url and response.status == 200 and not event.is_set():
            try:
                result["data"] = await response.json()
                log.info(f"Captured [{url_fragment}]: {response.url[:100]}")
                event.set()
            except Exception as e:
                log.debug(f"JSON read failed for {response.url[:80]}: {e}")

    page.on("response", handler)
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout_secs)
    except asyncio.TimeoutError:
        log.warning(f"Timed out waiting for [{url_fragment}] after {timeout_secs}s")
    finally:
        page.remove_listener("response", handler)

    return result["data"]


async def scrape_date(
    browser_auth: str,
    date_str: str,
    players: int = 2,
    lat: float = DEFAULT_LAT,
    lng: float = DEFAULT_LNG,
    radius: int = DEFAULT_RADIUS,
    time_min: int = DEFAULT_TIME_MIN,
    time_max: int = DEFAULT_TIME_MAX,
    holes: str = DEFAULT_HOLES,
    min_rating: float = DEFAULT_MIN_RATING,
) -> list[dict]:
    """Scrape all tee times near a location for a given date."""
    all_results: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(
            f"wss://{browser_auth}@brd.superproxy.io:9222"
        )
        try:
            page = await browser.new_page()
            page.set_default_navigation_timeout(120_000)
            await page.route(
                "**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,eot,css}",
                lambda route: route.abort(),
            )

            # Phase 1: get course list
            search_url = (
                f"{BASE_URL}/tee-times/search"
                f"#sortby=featured&view=course&holes={holes}"
                f"&timemax={time_max}&timemin={time_min}"
                f"&date={date_str}&players={players}"
                f"&lat={lat}&lng={lng}&radius={radius}"
            )

            # Start listener before navigation so we don't miss the response
            courses_task = asyncio.create_task(
                _wait_for_json(page, "courses-near-me", timeout_secs=35)
            )
            await page.goto(search_url, wait_until="domcontentloaded")
            raw_courses = await courses_task

            if raw_courses is None:
                return []

            courses = parse_courses(raw_courses, min_rating=min_rating)
            log.info(f"{date_str}: {len(courses)} courses")

            # Phase 2: tee times per course
            for course in courses:
                fid = course["facility_id"]
                if not fid:
                    continue

                facility_url = (
                    f"{BASE_URL}/tee-times/facility/{fid}/search"
                    f"#facilitytype=GolfCourse&holes={holes}"
                    f"&timemax={time_max}&timemin={time_min}"
                    f"&players={players}&date={date_str}"
                )

                tt_task = asyncio.create_task(
                    _wait_for_json(page, "teetimes-by-facility-group", timeout_secs=20)
                )
                await page.goto(facility_url, wait_until="domcontentloaded")
                raw_tt = await tt_task

                if raw_tt is None:
                    log.warning(f"  {course['name'][:40]}: no tee times response")
                    continue

                slots = parse_tee_times(raw_tt, None, course, date_str)
                all_results.extend(slots)
                log.info(f"  {course['name'][:45]}: {len(slots)} slots")
                await asyncio.sleep(0.3)

        finally:
            await browser.close()

    return all_results

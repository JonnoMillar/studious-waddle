"""
GolfNow UK scraping logic.
Imported by server.py — not intended to be run directly.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any

from playwright.async_api import Page, async_playwright

log = logging.getLogger(__name__)

BASE_URL = "https://www.golfnow.co.uk"

# Wimbledon coordinates
DEFAULT_LAT = 51.4161
DEFAULT_LNG = -0.2062
DEFAULT_RADIUS = 13   # miles
DEFAULT_TIME_MIN = 5  # 05:00
DEFAULT_TIME_MAX = 17  # 17:00
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


@asynccontextmanager
async def capture_response(page: Page, url_fragment: str, timeout: float = 15.0):
    """
    Context manager that captures the next JSON response whose URL contains url_fragment.
    Must wrap the page.goto() call so the listener is active before navigation starts.
    """
    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()

    async def handler(response):
        if url_fragment in response.url and response.status == 200 and not future.done():
            try:
                log.info(f"Captured [{url_fragment}]: {response.url[:100]}")
                future.set_result(await response.json())
            except Exception:
                pass

    page.on("response", handler)
    try:
        yield future
    finally:
        page.remove_listener("response", handler)


@asynccontextmanager
async def capture_response_any(page: Page, url_fragments: list[str], timeout: float = 20.0):
    """Like capture_response but matches any of the given URL fragments, min 2KB body."""
    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()

    async def handler(response):
        if response.status == 200 and not future.done():
            if any(f in response.url for f in url_fragments):
                try:
                    body = await response.body()
                    if len(body) < 2048:
                        log.debug(f"Skipping small response ({len(body)}B): {response.url[:80]}")
                        return
                    log.info(f"Captured ({len(body)}B): {response.url[:100]}")
                    future.set_result(await response.json())
                except Exception:
                    pass

    page.on("response", handler)
    try:
        yield future
    finally:
        page.remove_listener("response", handler)

    page.on("response", handler)
    try:
        yield future
    finally:
        page.remove_listener("response", handler)


def parse_courses(raw: dict | list, min_rating: float = DEFAULT_MIN_RATING) -> list[dict]:
    """Extract course info from courses-near-me response."""
    if not raw:
        return []

    courses_list = (
        raw.get("courses")
        or raw.get("facilities")
        or raw.get("results")
        or (raw if isinstance(raw, list) else [])
    )

    parsed = []
    for c in courses_list:
        try:
            rating_raw = (
                c.get("starRating") or c.get("rating")
                or c.get("overallRating") or c.get("golfAdvisorRating") or 0
            )
            rating = float(rating_raw) if rating_raw else 0.0

            if 0 < rating < min_rating:
                continue

            address_parts = filter(None, [
                c.get("address1") or c.get("address"),
                c.get("city") or c.get("town"),
                c.get("stateProvince") or c.get("county"),
                c.get("postalCode") or c.get("postCode"),
            ])

            parsed.append({
                "facility_id": (
                    c.get("facilityId") or c.get("id")
                    or c.get("courseId") or c.get("facility", {}).get("id")
                ),
                "name": (
                    c.get("name") or c.get("facilityName")
                    or c.get("courseName") or "Unknown course"
                ),
                "address": ", ".join(address_parts),
                "distance_miles": (
                    c.get("distanceMiles") or c.get("distance")
                    or c.get("distanceInMiles")
                ),
                "rating": rating,
                "review_count": (
                    c.get("numberOfRatings") or c.get("reviewCount")
                    or c.get("ratingCount") or 0
                ),
                "holes": c.get("numberOfHoles") or 18,
            })
        except Exception as e:
            log.debug(f"Skipping malformed course: {e}")

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

    # Detect flat list (some API versions skip the group wrapper)
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

    def is_courses_resp(r):
        u = r.url.lower()
        return r.status == 200 and any(f in u for f in [
            "courses-near-me", "facilities/search", "courses/search", "facilities?"
        ])

    def is_teetimes_resp(r):
        u = r.url.lower()
        return r.status == 200 and any(f in u for f in [
            "teetimes-by-facility-group", "tee-times", "teetime"
        ])

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

            async def log_api(response):
                ct = response.headers.get("content-type", "")
                if "json" in ct and "golfnow" in response.url:
                    log.info(f"API: {response.url[:120]}")
            page.on("response", log_api)

            # Phase 1: get course list
            search_url = (
                f"{BASE_URL}/tee-times/search"
                f"#sortby=featured&view=course&holes={holes}"
                f"&timemax={time_max}&timemin={time_min}"
                f"&date={date_str}&players={players}"
                f"&lat={lat}&lng={lng}&radius={radius}"
            )

            try:
                async with page.expect_response(is_courses_resp, timeout=35_000) as resp_info:
                    await page.goto(search_url, wait_until="domcontentloaded")
                raw_courses = await (await resp_info.value).json()
            except Exception as e:
                log.warning(f"{date_str}: courses API failed — {e}")
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

                try:
                    async with page.expect_response(is_teetimes_resp, timeout=20_000) as tt_info:
                        await page.goto(facility_url, wait_until="domcontentloaded")
                    raw_tt = await (await tt_info.value).json()
                except Exception as e:
                    log.warning(f"  {course['name'][:40]}: tee times failed — {e}")
                    continue

                # Hot deals optional — best-effort only
                raw_hd = None
                try:
                    async with page.expect_response(
                        lambda r: "hot-deals" in r.url and r.status == 200, timeout=6_000
                    ) as hd_info:
                        pass  # already on the page, hot-deals fires alongside tee times
                    raw_hd = await (await hd_info.value).json()
                except Exception:
                    pass

                slots = parse_tee_times(raw_tt, raw_hd, course, date_str)
                all_results.extend(slots)
                log.info(f"  {course['name'][:45]}: {len(slots)} slots")
                await asyncio.sleep(0.3)

        finally:
            await browser.close()

    return all_results

#!/usr/bin/env python3
"""
GolfNow MCP Server
==================
Exposes GolfNow UK tee time data as MCP tools for use in Claude Code projects.

Tools:
  golfnow_get_tee_times          — tee times for a specific date
  golfnow_get_weekend_briefing   — tee times for all upcoming weekends (briefing-ready)

Setup: see README.md
"""

import asyncio
import json
import logging
from typing import Optional

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict, field_validator

from scraper import (
    DEFAULT_LAT, DEFAULT_LNG, DEFAULT_MIN_RATING, DEFAULT_RADIUS,
    DEFAULT_TIME_MAX, DEFAULT_TIME_MIN,
    filter_and_sort, get_upcoming_weekends, scrape_date,
)

logging.basicConfig(level=logging.INFO)

mcp = FastMCP("golfnow_mcp")


# ── Input models ──────────────────────────────────────────────────────────────

class GetTeeTimesInput(BaseModel):
    """Input for fetching tee times on a specific date."""
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    date: str = Field(
        ...,
        description="Date to search in YYYY-MM-DD format (e.g. '2026-06-07')",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )
    players: int = Field(
        default=2,
        description="Number of golfers (1–4). Slots with fewer spots than this are excluded.",
        ge=1, le=4,
    )
    max_price: Optional[float] = Field(
        default=None,
        description="Maximum price per player in GBP (e.g. 30.0). Omit for no limit.",
        ge=0,
    )
    radius_miles: int = Field(
        default=DEFAULT_RADIUS,
        description="Search radius in miles from Wimbledon (default 13).",
        ge=1, le=50,
    )
    min_rating: float = Field(
        default=DEFAULT_MIN_RATING,
        description="Minimum course star rating to include (default 3.0, max 5.0).",
        ge=0, le=5,
    )

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        from datetime import datetime
        datetime.strptime(v, "%Y-%m-%d")  # raises ValueError if invalid
        return v


class GetWeekendBriefingInput(BaseModel):
    """Input for fetching tee times across upcoming weekends."""
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")

    num_weekends: int = Field(
        default=4,
        description="Number of upcoming weekends to check (default 4, max 8).",
        ge=1, le=8,
    )
    players: int = Field(
        default=2,
        description="Number of golfers (1–4).",
        ge=1, le=4,
    )
    max_price: Optional[float] = Field(
        default=None,
        description="Maximum price per player in GBP. Omit for no limit.",
        ge=0,
    )
    hot_deals_only: bool = Field(
        default=False,
        description="If true, only return Hot Deal slots.",
    )
    top_n: int = Field(
        default=20,
        description="Maximum number of results to return (default 20).",
        ge=1, le=100,
    )


# ── Formatters ────────────────────────────────────────────────────────────────

def _format_tee_times_markdown(results: list[dict], title: str) -> str:
    """Format tee times as a clean markdown briefing section."""
    if not results:
        return f"## {title}\n\nNo tee times found matching your filters.\n"

    lines = [f"## {title}", ""]

    current_date = None
    for r in results:
        if r["date"] != current_date:
            current_date = r["date"]
            from datetime import datetime
            dt = datetime.strptime(current_date, "%Y-%m-%d")
            day_label = dt.strftime("%A %-d %B")
            lines += ["", f"### {day_label}", ""]

        deal_badge = " 🔥 **HOT DEAL**" if r["is_hot_deal"] else ""
        dist = f"{r['distance_miles']:.1f}mi" if r["distance_miles"] else "?"
        lines.append(
            f"- **{r['tee_time']}** · {r['course_name']} ({dist}) · "
            f"£{r['price_gbp']:.2f} · ⭐ {r['course_rating']:.1f} · "
            f"{r['max_players']} players · "
            f"[Book]({r['booking_url']}){deal_badge}"
        )

    lines += ["", f"*{len(results)} tee time(s) found*"]
    return "\n".join(lines)


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool(
    name="golfnow_get_tee_times",
    annotations={
        "title": "Get GolfNow Tee Times",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def golfnow_get_tee_times(params: GetTeeTimesInput) -> str:
    """
    Fetch available golf tee times near Wimbledon for a specific date.

    Searches courses within the specified radius of Wimbledon (SW19),
    filters by player count, price, and rating, then returns results
    sorted with Hot Deals first, then cheapest, then highest rated.

    Args:
        params (GetTeeTimesInput): Validated input parameters containing:
            - date (str): Date in YYYY-MM-DD format
            - players (int): Number of golfers, 1–4 (default: 2)
            - max_price (Optional[float]): Max GBP per player (default: no limit)
            - radius_miles (int): Search radius from Wimbledon in miles (default: 13)
            - min_rating (float): Minimum course star rating (default: 3.0)

    Returns:
        str: Markdown-formatted list of available tee times, grouped by course,
             each with time, price, rating, distance, player capacity, and booking URL.
             Hot Deals are flagged prominently.

    Schema of each tee time in the result:
        - date (str): YYYY-MM-DD
        - tee_time (str): HH:MM (24h)
        - course_name (str): Full name of the golf course
        - course_rating (float): GolfNow star rating (0–5)
        - distance_miles (float): Distance from Wimbledon
        - price_gbp (float): Price per booking
        - max_players (int): Maximum spots in this slot
        - is_hot_deal (bool): Whether this is a GolfNow Hot Deal
        - booking_url (str): Direct URL to book the tee time

    Examples:
        - "What tee times are available this Saturday?" → date=next Saturday's date
        - "Find me cheap golf on Sunday for 4 people" → players=4, sorted cheapest first
        - "Any hot deals near Wimbledon?" → hot_deals_only available in get_weekend_briefing
    """
    try:
        raw = await scrape_date(
            date_str=params.date,
            players=params.players,
            radius=params.radius_miles,
            min_rating=params.min_rating,
        )

        results = filter_and_sort(raw, max_price=params.max_price, min_players=params.players)

        if not results:
            return (
                f"No tee times found near Wimbledon on {params.date} "
                f"for {params.players} player(s). "
                "Try a later date, lower min_rating, or wider radius."
            )

        return _format_tee_times_markdown(
            results,
            title=f"Tee Times — {params.date} ({params.players} players)",
        )

    except Exception as e:
        logging.error(f"golfnow_get_tee_times failed: {e}", exc_info=True)
        return f"Error fetching tee times: {e}"


@mcp.tool(
    name="golfnow_get_weekend_briefing",
    annotations={
        "title": "Get Weekend Golf Briefing",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def golfnow_get_weekend_briefing(params: GetWeekendBriefingInput) -> str:
    """
    Fetch the best tee times near Wimbledon across upcoming weekends — briefing-ready.

    Designed for daily briefing tools. Automatically selects the next N weekend
    dates (Saturdays and Sundays), scrapes all available tee times, and returns
    a clean markdown summary sorted by value: Hot Deals first, then cheapest,
    then highest rated.

    Args:
        params (GetWeekendBriefingInput): Validated input parameters containing:
            - num_weekends (int): Weekends ahead to check, 1–8 (default: 4)
            - players (int): Number of golfers, 1–4 (default: 2)
            - max_price (Optional[float]): Max GBP per player (default: no limit)
            - hot_deals_only (bool): Only show Hot Deal slots (default: False)
            - top_n (int): Max results to return (default: 20)

    Returns:
        str: Markdown briefing section, grouped by date, each entry showing:
             time, course name, distance, price, star rating, max players, booking link.
             Hot Deals are flagged with 🔥 HOT DEAL.

    Examples:
        - Daily briefing: "Add weekend golf options" → default params
        - Budget golf: max_price=20.0, hot_deals_only=True
        - Planning ahead: num_weekends=8 to see 8 weekends out
    """
    dates = get_upcoming_weekends(params.num_weekends)
    all_results: list[dict] = []

    for date_str in dates:
        try:
            raw = await scrape_date(
                date_str=date_str,
                players=params.players,
            )
            all_results.extend(raw)
        except Exception as e:
            logging.warning(f"Failed to scrape {date_str}: {e}")

    results = filter_and_sort(all_results, max_price=params.max_price, min_players=params.players)

    if params.hot_deals_only:
        results = [r for r in results if r["is_hot_deal"]]

    results = results[: params.top_n]

    return _format_tee_times_markdown(
        results,
        title=f"Weekend Golf near Wimbledon — next {params.num_weekends} weekends",
    )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()

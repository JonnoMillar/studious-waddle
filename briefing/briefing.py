#!/usr/bin/env python3
"""Daily briefing — markets, news, Premier League. Run: python3 briefing.py"""

import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import webbrowser
import tempfile
import os
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────

PORTFOLIO = {
    "AIAG": "AIAG.L",
    "All World": "VWRP.L",
    "US 500": "VUSA.L",
}

INDICES = {
    "FTSE 100": "^FTSE",
    "S&P 500": "^GSPC",
    "Bitcoin": "BTC-USD",
    "Gold": "GC=F",
}

# (url, max_items)
FEEDS = {
    "World": ("http://feeds.bbci.co.uk/news/rss.xml", 5),
    "Premier League": ("https://www.skysports.com/rss/12040", 5),
    "Tech": ("https://techcrunch.com/feed/", 4),
    "AI": ("https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", 4),
}

# ── Data fetching ──────────────────────────────────────────────────────────────

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


def fetch(url, timeout=8):
    req = urllib.request.Request(url, headers=HEADERS)
    return urllib.request.urlopen(req, timeout=timeout).read()


def get_yfinance_price(ticker):
    """Fetch latest price + % change via Yahoo Finance."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?interval=1d&range=2d"
    try:
        data = fetch(url)
        import json
        j = json.loads(data)
        result = j["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
        closes = [c for c in closes if c is not None]
        if len(closes) >= 2:
            change = ((closes[-1] - closes[-2]) / closes[-2]) * 100
            return {"price": closes[-1], "change": change}
        elif closes:
            return {"price": closes[-1], "change": 0.0}
    except Exception as e:
        return {"price": None, "change": 0.0, "error": str(e)}
    return {"price": None, "change": 0.0}


def get_all_prices(tickers_dict):
    return {name: get_yfinance_price(ticker) for name, ticker in tickers_dict.items()}


def parse_rss(url, limit):
    """Parse RSS or Atom feed, return list of {title, link} dicts."""
    try:
        data = fetch(url)
        root = ET.fromstring(data)
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        # RSS
        items = root.findall("./channel/item")
        if items:
            results = []
            for item in items[:limit]:
                title = item.findtext("title", "").strip()
                link = item.findtext("link", "#").strip()
                results.append({"title": title, "link": link})
            return results

        # Atom
        entries = root.findall("atom:entry", ns)
        if entries:
            results = []
            for entry in entries[:limit]:
                title = entry.findtext("atom:title", "", ns).strip()
                link_el = entry.find("atom:link", ns)
                link = link_el.get("href", "#") if link_el is not None else "#"
                results.append({"title": title, "link": link})
            return results

    except Exception:
        pass
    return []


def get_all_news(feeds):
    return {name: parse_rss(url, limit) for name, (url, limit) in feeds.items()}


# ── HTML generation ────────────────────────────────────────────────────────────

def fmt_price(price, ticker):
    if price is None:
        return "—"
    if "BTC" in ticker or price > 10000:
        return f"{price:,.0f}"
    if price > 10:
        return f"{price:,.2f}"
    return f"{price:.4f}"


def price_card(name, data, ticker=""):
    price = data.get("price")
    change = data.get("change", 0.0)
    color = "#22c55e" if change >= 0 else "#ef4444"
    arrow = "▲" if change >= 0 else "▼"
    sign = "+" if change >= 0 else ""
    price_str = fmt_price(price, ticker)
    change_html = f'<div class="change" style="color:{color}">{arrow} {sign}{change:.2f}%</div>' if price else ""

    return f"""<div class="card">
  <div class="label">{name}</div>
  <div class="value">{price_str}</div>
  {change_html}
</div>"""


def news_col(title, items):
    if not items:
        return f"""<div class="news-col">
  <div class="col-title">{title}</div>
  <p class="empty">No stories available</p>
</div>"""

    rows = "".join(
        f'<a class="story" href="{i["link"]}" target="_blank" rel="noopener">'
        f'<span>{i["title"]}</span>'
        f'</a>'
        for i in items
    )
    return f"""<div class="news-col">
  <div class="col-title">{title}</div>
  {rows}
</div>"""


def build_html(portfolio, indices, news):
    now = datetime.now()
    hour = now.hour
    greeting = "Good morning" if hour < 12 else ("Good afternoon" if hour < 17 else "Good evening")
    date_str = now.strftime("%A, %-d %B %Y")
    time_str = now.strftime("%H:%M")

    portfolio_cards = "\n".join(
        price_card(name, data, PORTFOLIO[name]) for name, data in portfolio.items()
    )
    index_cards = "\n".join(
        price_card(name, data, INDICES[name]) for name, data in indices.items()
    )
    news_cols = "\n".join(news_col(name, items) for name, items in news.items())

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Briefing</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

body {{
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0b0f1a;
  color: #e2e8f0;
  min-height: 100vh;
  padding: 40px 32px 60px;
  max-width: 1200px;
  margin: 0 auto;
}}

/* ── Header ── */
.header {{ margin-bottom: 40px; }}
.greeting {{ font-size: 30px; font-weight: 700; color: #f8fafc; letter-spacing: -0.5px; }}
.dateline {{ font-size: 14px; color: #475569; margin-top: 4px; }}

/* ── Section labels ── */
.section {{ margin-top: 36px; }}
.section-label {{
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #334155;
  margin-bottom: 14px;
}}

/* ── Cards ── */
.cards {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}}

.card {{
  background: #141b2d;
  border: 1px solid #1e2d45;
  border-radius: 14px;
  padding: 18px 20px;
  transition: border-color 0.15s;
}}
.card:hover {{ border-color: #2d4a6e; }}

.label {{ font-size: 12px; color: #475569; font-weight: 500; margin-bottom: 8px; }}
.value {{ font-size: 22px; font-weight: 600; color: #f1f5f9; font-variant-numeric: tabular-nums; }}
.change {{ font-size: 13px; font-weight: 500; margin-top: 5px; }}

/* ── News grid ── */
.news-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin-top: 14px;
}}

.news-col {{
  background: #141b2d;
  border: 1px solid #1e2d45;
  border-radius: 14px;
  padding: 22px;
}}

.col-title {{
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3b82f6;
  margin-bottom: 16px;
}}

.story {{
  display: block;
  padding: 9px 0;
  border-bottom: 1px solid #1e2d45;
  text-decoration: none;
  color: #94a3b8;
  font-size: 13.5px;
  line-height: 1.45;
  transition: color 0.15s;
}}
.story:last-child {{ border-bottom: none; padding-bottom: 0; }}
.story:first-child {{ padding-top: 0; }}
.story:hover {{ color: #f1f5f9; }}

.empty {{ color: #334155; font-size: 13px; }}

/* ── Footer ── */
.footer {{
  margin-top: 48px;
  font-size: 12px;
  color: #1e2d45;
  text-align: center;
}}
</style>
</head>
<body>

<div class="header">
  <div class="greeting">{greeting}, Jonno.</div>
  <div class="dateline">{date_str} &middot; Updated at {time_str}</div>
</div>

<div class="section">
  <div class="section-label">Your Portfolio</div>
  <div class="cards">{portfolio_cards}</div>
</div>

<div class="section">
  <div class="section-label">Markets</div>
  <div class="cards">{index_cards}</div>
</div>

<div class="section">
  <div class="section-label">Today's Briefing</div>
  <div class="news-grid">{news_cols}</div>
</div>

<div class="footer">briefing.py &middot; {date_str} &middot; {time_str}</div>

</body>
</html>"""


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Fetching market data...")
    portfolio = get_all_prices(PORTFOLIO)
    indices = get_all_prices(INDICES)

    print("Fetching news...")
    news = get_all_news(FEEDS)

    print("Building briefing...")
    html = build_html(portfolio, indices, news)

    out = os.path.join(tempfile.gettempdir(), "daily_briefing.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    webbrowser.open(f"file://{out}")
    print(f"Done — opened in browser ({out})")


if __name__ == "__main__":
    main()

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

# Units held for each fund
UNITS = {
    "AIAG": 74,
    "All World": 45,
    "US 500": 35.99,
}

INDICES = {
    "FTSE 100": "^FTSE",
    "S&P 500": "^GSPC",
    "Bitcoin": "BTC-USD",
    "Gold": "GC=F",
}

# (url, max_items)
# BBC World for news, BBC Sport for PL (more reliable than Sky), Ars Technica for
# in-depth tech, VentureBeat for focused AI industry coverage
FEEDS = {
    "World": ("https://feeds.bbci.co.uk/news/world/rss.xml", 5),
    "Premier League": ("https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml", 5),
    "Tech": ("https://feeds.arstechnica.com/arstechnica/index", 4),
    "AI": ("https://venturebeat.com/category/ai/feed/", 4),
}

# ── Company to Watch ───────────────────────────────────────────────────────────
# Rotates daily. Add/remove freely.

COMPANIES = [
    {"name": "Nvidia", "tag": "AI Infrastructure", "url": "nvidia.com",
     "what": "Designs the GPUs that power virtually all AI training and inference worldwide.",
     "why": "Controls the pick-and-shovel infrastructure of the AI boom — nearly every major AI model is trained on their chips."},
    {"name": "Anthropic", "tag": "AI Safety", "url": "anthropic.com",
     "what": "AI safety company building Claude, a family of large language models.",
     "why": "One of the few labs treating AI safety as a core research priority, not an afterthought."},
    {"name": "OpenAI", "tag": "AI", "url": "openai.com",
     "what": "Builds GPT models and ChatGPT, the most widely used AI products in the world.",
     "why": "Triggered the current AI wave — their moves set the pace for the entire industry."},
    {"name": "Palantir", "tag": "Data & AI", "url": "palantir.com",
     "what": "Builds data analytics and AI platforms for governments and large enterprises.",
     "why": "Quietly powers decision-making at the CIA, NHS, US Army and dozens of major corporations."},
    {"name": "Physical Intelligence", "tag": "Robotics", "url": "physicalintelligence.company",
     "what": "Building foundation models for robots — essentially GPT but for physical tasks.",
     "why": "If they succeed, a single AI model could control any robot body, transforming manufacturing and logistics."},
    {"name": "Figure AI", "tag": "Robotics", "url": "figure.ai",
     "what": "Developing humanoid robots designed to work alongside humans in warehouses and factories.",
     "why": "Humanoid robots that can do physical labour could address ageing workforce problems across the developed world."},
    {"name": "Waymo", "tag": "Autonomous Vehicles", "url": "waymo.com",
     "what": "Google's self-driving car division, operating fully driverless robotaxis in US cities.",
     "why": "The only company with a genuinely commercial robotaxi service — years ahead of competitors."},
    {"name": "Commonwealth Fusion Systems", "tag": "Energy", "url": "cfs.energy",
     "what": "Pursuing nuclear fusion using high-temperature superconducting magnets.",
     "why": "Could unlock near-limitless clean energy — their magnet breakthrough in 2021 was a genuine milestone."},
    {"name": "Helion Energy", "tag": "Energy", "url": "helionenergy.com",
     "what": "Private fusion company backed by Sam Altman, targeting commercial electricity by the late 2020s.",
     "why": "Has a contract to sell fusion power to Microsoft — the first fusion power purchase agreement ever signed."},
    {"name": "Anduril Industries", "tag": "Defence Tech", "url": "anduril.com",
     "what": "Silicon Valley defence company building autonomous systems, drones, and AI-powered surveillance.",
     "why": "Reshaping how Western militaries buy technology — moving from slow contractors to fast software-first companies."},
    {"name": "Mistral AI", "tag": "AI", "url": "mistral.ai",
     "what": "French AI lab building powerful open-weight language models competitive with GPT-4.",
     "why": "The leading European challenger in AI — important for anyone who thinks the US shouldn't have a monopoly on frontier AI."},
    {"name": "Groq", "tag": "AI Infrastructure", "url": "groq.com",
     "what": "Builds LPU inference chips that run AI models dramatically faster than GPUs.",
     "why": "Speed matters enormously for AI products — Groq can run Llama models 10x faster than standard GPU setups."},
    {"name": "Perplexity AI", "tag": "AI Search", "url": "perplexity.ai",
     "what": "AI-powered search engine that answers questions with cited sources rather than links.",
     "why": "The most credible threat to Google Search in two decades — growing extremely fast."},
    {"name": "Recursion Pharmaceuticals", "tag": "Biotech", "url": "recursion.com",
     "what": "Uses AI and robotics to run millions of biology experiments to discover new drugs.",
     "why": "Drug discovery takes 12+ years and costs billions — Recursion is trying to compress that to years and millions."},
    {"name": "Isomorphic Labs", "tag": "Biotech", "url": "isomorphiclabs.com",
     "what": "DeepMind spinout applying AlphaFold-style AI to drug design and discovery.",
     "why": "AlphaFold already solved protein folding — this is the next step: using that to actually build new medicines."},
    {"name": "Neuralink", "tag": "Biotech", "url": "neuralink.com",
     "what": "Developing implantable brain-computer interfaces that let paralysed patients control devices with thought.",
     "why": "First human patient is already using it — the long-term implications for human cognition are hard to overstate."},
    {"name": "xAI", "tag": "AI", "url": "x.ai",
     "what": "Elon Musk's AI company building Grok, a large language model integrated with X (Twitter).",
     "why": "Has access to real-time social data no other lab has — and Musk's resources mean they're scaling fast."},
    {"name": "Scale AI", "tag": "AI Infrastructure", "url": "scale.com",
     "what": "Provides the human-labelled training data that powers most major AI models.",
     "why": "Behind the scenes of almost every major AI product — the quality of AI depends heavily on the quality of its data."},
    {"name": "Cerebras Systems", "tag": "AI Infrastructure", "url": "cerebras.net",
     "what": "Makes wafer-scale processors — single chips the size of a dinner plate — for AI training.",
     "why": "Their chips can train models in hours that would take days on GPUs, targeting Nvidia's dominance."},
    {"name": "Hugging Face", "tag": "AI", "url": "huggingface.co",
     "what": "Open-source platform hosting tens of thousands of AI models, datasets, and tools.",
     "why": "The Github of AI — if open-source AI wins over closed models, Hugging Face sits at the centre of it."},
    {"name": "Stripe", "tag": "Fintech", "url": "stripe.com",
     "what": "Payments infrastructure powering online transactions for millions of businesses worldwide.",
     "why": "Processes hundreds of billions in payments annually — the hidden plumbing beneath most of the internet economy."},
    {"name": "Joby Aviation", "tag": "Transport", "url": "jobyaviation.com",
     "what": "Building electric air taxis for short urban and suburban flights.",
     "why": "Has FAA certification progress ahead of any competitor — electric air travel in cities could be closer than it sounds."},
    {"name": "Databricks", "tag": "AI Infrastructure", "url": "databricks.com",
     "what": "Data and AI platform used by enterprises to build, train, and deploy AI on their own data.",
     "why": "Every large company wants AI on their proprietary data — Databricks is the leading way to do that."},
    {"name": "Weaviate", "tag": "AI Infrastructure", "url": "weaviate.io",
     "what": "Open-source vector database that helps AI applications store and retrieve information by meaning.",
     "why": "Vector databases are the memory layer of AI — without them, LLMs forget everything between conversations."},
    {"name": "ElevenLabs", "tag": "AI", "url": "elevenlabs.io",
     "what": "AI voice synthesis platform capable of cloning voices and generating ultra-realistic speech.",
     "why": "Voice is the next major AI interface — and ElevenLabs is setting the quality bar for the entire industry."},
    {"name": "Cohere", "tag": "AI", "url": "cohere.com",
     "what": "Enterprise-focused AI company building LLMs for businesses that need data privacy and control.",
     "why": "Many companies can't send data to OpenAI or Google — Cohere fills that gap for regulated industries."},
    {"name": "Zipline", "tag": "Logistics", "url": "flyzipline.com",
     "what": "Autonomous drone delivery company operating at national scale in Rwanda, Ghana, and the US.",
     "why": "Already delivering blood and medicine by drone across entire countries — the logistics model actually works."},
    {"name": "Apptronik", "tag": "Robotics", "url": "apptronik.com",
     "what": "Building Apollo, a humanoid robot designed for logistics and manufacturing tasks.",
     "why": "Backed by Google and partnered with NASA — one of the more credible humanoid robotics players."},
]


def get_company_of_day():
    day = datetime.now().timetuple().tm_yday
    return COMPANIES[day % len(COMPANIES)]

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


def to_gbp(price, ticker):
    """LSE tickers are quoted in pence — divide by 100 for pounds."""
    if price is None:
        return None
    return price / 100 if ticker.endswith(".L") else price


def price_card(name, data, ticker="", units=None):
    raw_price = data.get("price")
    change = data.get("change", 0.0)
    price = to_gbp(raw_price, ticker)
    color = "#22c55e" if change >= 0 else "#ef4444"
    arrow = "▲" if change >= 0 else "▼"
    sign = "+" if change >= 0 else ""
    price_str = fmt_price(raw_price, ticker)

    holding_html = ""
    if units and price:
        value = units * price
        holding_html = f'<div class="holding">£{value:,.2f}</div>'

    change_html = f'<div class="change" style="color:{color}">{arrow} {sign}{change:.2f}%</div>' if raw_price else ""

    return f"""<div class="card">
  <div class="label">{name}</div>
  <div class="value">{price_str}</div>
  {holding_html}
  {change_html}
</div>"""


def company_card(company):
    return f"""<div class="company-card">
  <div class="company-tag">{company["tag"]}</div>
  <div class="company-name">{company["name"]}</div>
  <div class="company-what">{company["what"]}</div>
  <div class="company-why">{company["why"]}</div>
  <a class="company-link" href="https://{company["url"]}" target="_blank" rel="noopener">{company["url"]} →</a>
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


def build_html(portfolio, indices, news, company):
    now = datetime.now()
    hour = now.hour
    greeting = "Good morning" if hour < 12 else ("Good afternoon" if hour < 17 else "Good evening")
    date_str = now.strftime("%A, %d %B %Y").replace(" 0", " ")
    time_str = now.strftime("%H:%M")

    portfolio_cards = "\n".join(
        price_card(name, data, PORTFOLIO[name], UNITS.get(name)) for name, data in portfolio.items()
    )

    total = sum(
        (to_gbp(data["price"], PORTFOLIO[name]) or 0) * UNITS.get(name, 0)
        for name, data in portfolio.items()
    )
    total_html = f'<div class="total">Total <span>£{total:,.2f}</span></div>' if total else ""
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
.holding {{ font-size: 13px; color: #64748b; margin-top: 4px; font-variant-numeric: tabular-nums; }}
.total {{ font-size: 13px; color: #475569; margin-top: 14px; }}
.total span {{ color: #f1f5f9; font-weight: 600; font-size: 18px; margin-left: 6px; }}

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

/* ── Company card ── */
.company-card {{
  background: #141b2d;
  border: 1px solid #1e2d45;
  border-left: 3px solid #3b82f6;
  border-radius: 14px;
  padding: 24px 28px;
}}
.company-tag {{
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3b82f6;
  background: rgba(59,130,246,0.1);
  padding: 3px 10px;
  border-radius: 20px;
  margin-bottom: 12px;
}}
.company-name {{ font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 10px; }}
.company-what {{ font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 8px; }}
.company-why {{ font-size: 13.5px; color: #64748b; line-height: 1.6; margin-bottom: 16px; font-style: italic; }}
.company-link {{ font-size: 13px; color: #3b82f6; text-decoration: none; }}
.company-link:hover {{ color: #93c5fd; }}

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
  {total_html}
</div>

<div class="section">
  <div class="section-label">Markets</div>
  <div class="cards">{index_cards}</div>
</div>

<div class="section">
  <div class="section-label">Company to Watch</div>
  {company_card(company)}
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
    company = get_company_of_day()
    html = build_html(portfolio, indices, news, company)

    out = os.path.join(tempfile.gettempdir(), "daily_briefing.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    webbrowser.open(f"file://{out}")
    print(f"Done — opened in browser ({out})")


if __name__ == "__main__":
    main()

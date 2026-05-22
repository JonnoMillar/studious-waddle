#!/usr/bin/env python3
"""Daily briefing — markets, news, Premier League. Run: python3 briefing.py"""

import json
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
    "US 500": "VUSA.L",  # ETF proxy for Vanguard US 500 Stock Index — % change accurate, unit price differs
}

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

FEEDS = {
    "World": ("https://feeds.bbci.co.uk/news/world/rss.xml", 5),
    "Premier League": ("https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml", 4),
    "Tech": ("https://feeds.arstechnica.com/arstechnica/index", 4),
    "AI": ("https://venturebeat.com/category/ai/feed/", 4),
}

COMPANIES = [
    {"name": "Anthropic", "tag": "AI Safety", "url": "anthropic.com",
     "what": "AI safety company building Claude, a family of large language models.",
     "why": "One of the few labs treating safety as a core research priority — and building some of the world's most capable models alongside it."},
    {"name": "Palantir", "tag": "Data & AI", "url": "palantir.com",
     "what": "Builds data analytics and AI platforms for governments and large enterprises.",
     "why": "Quietly powers decision-making at the CIA, NHS, and US Army — most people have no idea how embedded it is."},
    {"name": "Physical Intelligence", "tag": "Robotics", "url": "physicalintelligence.company",
     "what": "Building foundation models for robots — essentially GPT but for physical tasks.",
     "why": "If they succeed, a single AI model could control any robot body, transforming manufacturing and logistics overnight."},
    {"name": "Figure AI", "tag": "Robotics", "url": "figure.ai",
     "what": "Developing humanoid robots designed to work alongside humans in warehouses and factories.",
     "why": "Humanoid robots that can do physical labour could address the ageing workforce problem across the developed world."},
    {"name": "Waymo", "tag": "Autonomous Vehicles", "url": "waymo.com",
     "what": "Google's self-driving car division, now operating fully driverless robotaxis in multiple US cities.",
     "why": "The only company with a genuinely commercial robotaxi service — years ahead of any serious competitor."},
    {"name": "Commonwealth Fusion Systems", "tag": "Energy", "url": "cfs.energy",
     "what": "Pursuing commercial nuclear fusion using high-temperature superconducting magnets.",
     "why": "Could unlock near-limitless clean energy — their 2021 magnet breakthrough was the most significant fusion milestone in decades."},
    {"name": "Helion Energy", "tag": "Energy", "url": "helionenergy.com",
     "what": "Private fusion company backed by Sam Altman, targeting commercial electricity by the late 2020s.",
     "why": "Has a signed contract to sell fusion power to Microsoft — the first fusion power purchase agreement in history."},
    {"name": "Anduril Industries", "tag": "Defence Tech", "url": "anduril.com",
     "what": "Silicon Valley defence company building autonomous systems, drones, and AI-powered surveillance.",
     "why": "Reshaping how Western militaries buy technology — from decade-long procurement cycles to fast, software-driven iteration."},
    {"name": "Mistral AI", "tag": "AI", "url": "mistral.ai",
     "what": "French AI lab releasing powerful open-weight models competitive with frontier closed models.",
     "why": "Europe's best answer to US AI dominance — and open-weight models are a genuine alternative to closed API products."},
    {"name": "Groq", "tag": "AI Infrastructure", "url": "groq.com",
     "what": "Builds LPU inference chips that run AI models dramatically faster than GPUs.",
     "why": "Speed is a real competitive edge in AI products — Groq runs large models 10× faster than standard GPU setups."},
    {"name": "Perplexity AI", "tag": "AI Search", "url": "perplexity.ai",
     "what": "AI-powered search engine that answers questions with cited sources rather than a list of links.",
     "why": "The most credible threat to Google Search in 20 years — growing fast and already preferred by millions."},
    {"name": "Recursion Pharmaceuticals", "tag": "Biotech", "url": "recursion.com",
     "what": "Uses AI and robotics to run millions of biology experiments and discover new drugs.",
     "why": "Drug discovery takes 12 years and costs billions — Recursion is compressing that timeline using software."},
    {"name": "Isomorphic Labs", "tag": "Biotech", "url": "isomorphiclabs.com",
     "what": "DeepMind spinout applying AlphaFold-style AI to drug design and molecular discovery.",
     "why": "AlphaFold solved protein structure — this is the next step: using that to actually build new medicines."},
    {"name": "Neuralink", "tag": "Biotech", "url": "neuralink.com",
     "what": "Developing implantable brain-computer interfaces that let paralysed patients control devices with thought.",
     "why": "First human patient is already using it — long-term implications for what it means to be human are enormous."},
    {"name": "xAI", "tag": "AI", "url": "x.ai",
     "what": "Elon Musk's AI company building Grok, trained on real-time X (Twitter) data.",
     "why": "Real-time social data gives it information no other lab has — and Musk's resources mean rapid scaling."},
    {"name": "Scale AI", "tag": "AI Infrastructure", "url": "scale.com",
     "what": "Provides the human-labelled training data that powers most major AI models.",
     "why": "Behind the scenes of almost every AI product you use — AI quality is only as good as its training data."},
    {"name": "Cerebras Systems", "tag": "AI Infrastructure", "url": "cerebras.net",
     "what": "Makes wafer-scale processors — single chips the size of a dinner plate — for AI training.",
     "why": "Can train models in hours that would take days on GPUs — a direct challenge to Nvidia's stranglehold."},
    {"name": "Tenstorrent", "tag": "AI Infrastructure", "url": "tenstorrent.com",
     "what": "Building open-source AI chips led by Jim Keller, the architect behind AMD Zen and Apple Silicon.",
     "why": "Open-source silicon could do to AI hardware what Linux did to software — one of the more credible Nvidia challengers."},
    {"name": "Shield AI", "tag": "Defence Tech", "url": "shield.ai",
     "what": "Builds Hivemind — AI pilot software that can fly military jets and drones without GPS or comms.",
     "why": "Autonomous AI pilots operating in GPS-denied environments represent a genuine step-change in military capability."},
    {"name": "Altos Labs", "tag": "Longevity", "url": "altoslabs.com",
     "what": "Biotech company researching cellular reprogramming to reverse the biological process of ageing.",
     "why": "Backed by Jeff Bezos and world-leading ageing scientists — if cellular reprogramming works, everything changes."},
    {"name": "Einride", "tag": "Transport", "url": "einride.tech",
     "what": "Swedish company operating electric autonomous freight trucks commercially in Europe and the US.",
     "why": "Unlike most AV companies still in testing, Einride is actually moving freight autonomously at commercial scale today."},
    {"name": "Insilico Medicine", "tag": "Biotech", "url": "insilico.com",
     "what": "AI drug discovery company with the first fully AI-designed drug now in Phase 2 clinical trials.",
     "why": "Proof that AI can design a drug from scratch that actually works in humans — a genuine historic first."},
    {"name": "Generate:Biomedicines", "tag": "Biotech", "url": "generatebiomedicines.com",
     "what": "Using generative AI to design entirely new proteins and medicines that don't exist anywhere in nature.",
     "why": "Applying the same generative revolution behind image and text AI to drug discovery — very early but potentially transformative."},
    {"name": "Etched", "tag": "AI Infrastructure", "url": "etched.com",
     "what": "Building a chip hardwired specifically for transformer models — the architecture behind every major LLM.",
     "why": "Purpose-built hardware can be 100× more efficient than general GPUs — a big bet that transformers are the permanent foundation of AI."},
    {"name": "Zipline", "tag": "Logistics", "url": "flyzipline.com",
     "what": "Autonomous drone delivery company operating at national scale in Rwanda, Ghana, and the US.",
     "why": "Already delivering blood and medicine by drone across entire countries — not a concept, a working business."},
    {"name": "Hadrian", "tag": "Manufacturing", "url": "hadrian.io",
     "what": "AI-powered precision manufacturing company making parts for aerospace and defence, fast.",
     "why": "US defence manufacturing is a critical bottleneck — Hadrian is using software to run factories like tech companies."},
    {"name": "Weaviate", "tag": "AI Infrastructure", "url": "weaviate.io",
     "what": "Open-source vector database that lets AI applications store and search information by meaning.",
     "why": "Vector databases are the memory layer of AI — without them, every AI conversation starts from scratch."},
    {"name": "ElevenLabs", "tag": "AI", "url": "elevenlabs.io",
     "what": "AI voice synthesis platform capable of cloning any voice and generating ultra-realistic speech.",
     "why": "Voice is the next major AI interface — ElevenLabs is setting the quality benchmark for the whole industry."},
    {"name": "Cohere", "tag": "AI", "url": "cohere.com",
     "what": "Enterprise AI company building LLMs for businesses that need data privacy and regulatory compliance.",
     "why": "Banks, hospitals, and governments can't send data to OpenAI — Cohere is built for exactly that constraint."},
    {"name": "Hugging Face", "tag": "AI", "url": "huggingface.co",
     "what": "Open-source platform hosting tens of thousands of AI models, datasets, and developer tools.",
     "why": "The GitHub of AI — if open-source wins over closed models, this sits at the centre of everything."},
    {"name": "Apptronik", "tag": "Robotics", "url": "apptronik.com",
     "what": "Building Apollo, a humanoid robot designed for logistics and manufacturing tasks.",
     "why": "Backed by Google, partnered with NASA — one of the more credible and well-resourced humanoid robotics plays."},
    {"name": "Joby Aviation", "tag": "Transport", "url": "jobyaviation.com",
     "what": "Building electric air taxis for short urban and suburban flights.",
     "why": "Further ahead on FAA certification than any competitor — urban electric flight could be a reality this decade."},
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
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?interval=1d&range=2d"
    try:
        j = json.loads(fetch(url))
        result = j["chart"]["result"][0]
        currency = result["meta"].get("currency", "")
        closes = [c for c in result["indicators"]["quote"][0]["close"] if c is not None]
        if len(closes) >= 2:
            change = ((closes[-1] - closes[-2]) / closes[-2]) * 100
            return {"price": closes[-1], "change": change, "currency": currency}
        elif closes:
            return {"price": closes[-1], "change": 0.0, "currency": currency}
    except Exception as e:
        return {"price": None, "change": 0.0, "currency": "", "error": str(e)}
    return {"price": None, "change": 0.0, "currency": ""}


def get_all_prices(tickers_dict):
    return {name: get_yfinance_price(ticker) for name, ticker in tickers_dict.items()}


def to_gbp(price, currency):
    """Yahoo Finance returns LSE prices in GBp (pence) — convert to pounds."""
    if price is None:
        return None
    return price / 100 if currency == "GBp" else price


def parse_rss(url, limit):
    try:
        root = ET.fromstring(fetch(url))
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall("./channel/item")
        if items:
            return [{"title": i.findtext("title", "").strip(), "link": i.findtext("link", "#").strip()}
                    for i in items[:limit]]
        entries = root.findall("atom:entry", ns)
        if entries:
            result = []
            for e in entries[:limit]:
                link_el = e.find("atom:link", ns)
                result.append({
                    "title": e.findtext("atom:title", "", ns).strip(),
                    "link": link_el.get("href", "#") if link_el is not None else "#",
                })
            return result
    except Exception:
        pass
    return []


def get_all_news(feeds):
    return {name: parse_rss(url, limit) for name, (url, limit) in feeds.items()}


def get_pl_fixtures():
    try:
        bootstrap = json.loads(fetch("https://fantasy.premierleague.com/api/bootstrap-static/"))
        teams = {t["id"]: t["name"] for t in bootstrap["teams"]}
        chelsea_id = next((t["id"] for t in bootstrap["teams"] if "Chelsea" in t["name"]), None)

        top_names = {
            "Arsenal", "Manchester City", "Liverpool", "Manchester United",
            "Chelsea", "Tottenham Hotspur", "Newcastle United", "Aston Villa",
        }
        top_ids = {t["id"] for t in bootstrap["teams"] if t["name"] in top_names}

        fixtures = json.loads(fetch("https://fantasy.premierleague.com/api/fixtures/?future=1"))
        upcoming = sorted(
            [f for f in fixtures if not f.get("finished", True) and f.get("kickoff_time")],
            key=lambda x: x["kickoff_time"],
        )

        chelsea_fix = next(
            (f for f in upcoming if chelsea_id and chelsea_id in (f["team_a"], f["team_h"])), None
        )
        top_fixes = [
            f for f in upcoming
            if f != chelsea_fix and f["team_a"] in top_ids and f["team_h"] in top_ids
        ][:3]

        result = []
        for f in ([chelsea_fix] if chelsea_fix else []) + top_fixes:
            if not f:
                continue
            home = teams.get(f["team_h"], "?")
            away = teams.get(f["team_a"], "?")
            try:
                dt = datetime.strptime(f["kickoff_time"], "%Y-%m-%dT%H:%M:%SZ")
                time_str = dt.strftime("%a %d %b · %H:%M")
            except Exception:
                time_str = "TBC"
            result.append({
                "home": home, "away": away, "time": time_str,
                "gw": f.get("event", ""),
                "chelsea": bool(chelsea_id and chelsea_id in (f["team_h"], f["team_a"])),
            })
        return result
    except Exception:
        return []


# ── HTML generation ────────────────────────────────────────────────────────────

def fmt_price(price, currency):
    if price is None:
        return "—"
    p = to_gbp(price, currency)
    prefix = "" if "BTC" in currency or p > 10000 else "£"
    if p > 10000:
        return f"{p:,.0f}"
    if p > 10:
        return f"{prefix}{p:,.2f}"
    return f"{prefix}{p:.4f}"


def price_card(name, data, units=None):
    raw = data.get("price")
    currency = data.get("currency", "")
    change = data.get("change", 0.0)
    price_gbp = to_gbp(raw, currency)
    color = "#22c55e" if change >= 0 else "#ef4444"
    arrow = "▲" if change >= 0 else "▼"
    sign = "+" if change >= 0 else ""

    holding_html = ""
    if units and price_gbp:
        holding_html = f'<div class="holding">£{units * price_gbp:,.2f}</div>'

    change_html = (
        f'<div class="change" style="color:{color}">{arrow} {sign}{change:.2f}%</div>'
        if raw else ""
    )

    return f"""<div class="card">
  <div class="label">{name}</div>
  <div class="value">{fmt_price(raw, currency)}</div>
  {holding_html}
  {change_html}
</div>"""


def portfolio_summary(portfolio):
    total = 0
    daily = 0
    for name, data in portfolio.items():
        p = to_gbp(data.get("price"), data.get("currency", ""))
        u = UNITS.get(name, 0)
        if p and u:
            val = p * u
            total += val
            daily += val * data.get("change", 0) / 100
    if not total:
        return ""
    color = "#22c55e" if daily >= 0 else "#ef4444"
    sign = "+" if daily >= 0 else ""
    return (
        f'<div class="total">Total <span>£{total:,.2f}</span>'
        f'<span class="daily-chg" style="color:{color}"> {sign}£{daily:,.2f} today</span></div>'
    )


def company_card(c):
    return f"""<div class="company-card">
  <div class="company-tag">{c["tag"]}</div>
  <div class="company-name">{c["name"]}</div>
  <div class="company-what">{c["what"]}</div>
  <div class="company-why">{c["why"]}</div>
  <a class="company-link" href="https://{c["url"]}" target="_blank" rel="noopener">{c["url"]} →</a>
</div>"""


def fixtures_html(fixtures):
    if not fixtures:
        return '<p class="empty">Fixtures unavailable</p>'
    rows = []
    for f in fixtures:
        cls = "fixture chelsea" if f.get("chelsea") else "fixture"
        gw = f'<span class="gw">GW{f["gw"]}</span>' if f.get("gw") else ""
        rows.append(f"""<div class="{cls}">
  <div class="fix-meta">{gw}<span class="fix-time">{f["time"]} (UTC)</span></div>
  <div class="fix-teams">{f["home"]} <em>vs</em> {f["away"]}</div>
</div>""")
    return "\n".join(rows)


def news_col(title, items):
    if not items:
        return f'<div class="news-col"><div class="col-title">{title}</div><p class="empty">Unavailable</p></div>'
    rows = "".join(
        f'<a class="story" href="{i["link"]}" target="_blank" rel="noopener">{i["title"]}</a>'
        for i in items
    )
    return f'<div class="news-col"><div class="col-title">{title}</div>{rows}</div>'


def build_html(portfolio, indices, news, fixtures, company):
    now = datetime.now()
    hour = now.hour
    greeting = "Good morning" if hour < 12 else ("Good afternoon" if hour < 17 else "Good evening")
    date_str = now.strftime("%A, %d %B %Y").replace(" 0", " ")
    time_str = now.strftime("%H:%M")

    portfolio_cards = "\n".join(
        price_card(name, data, UNITS.get(name)) for name, data in portfolio.items()
    )
    index_cards = "\n".join(price_card(name, data) for name, data in indices.items())
    news_cols = "\n".join(news_col(name, items) for name, items in news.items())
    total_html = portfolio_summary(portfolio)
    fix_html = fixtures_html(fixtures)

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

.header {{ margin-bottom: 40px; }}
.greeting {{ font-size: 30px; font-weight: 700; color: #f8fafc; letter-spacing: -0.5px; }}
.dateline {{ font-size: 14px; color: #475569; margin-top: 4px; }}

.section {{ margin-top: 36px; }}
.section-label {{
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: #334155; margin-bottom: 14px;
}}

.cards {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}}
.card {{
  background: #141b2d; border: 1px solid #1e2d45;
  border-radius: 14px; padding: 18px 20px; transition: border-color 0.15s;
}}
.card:hover {{ border-color: #2d4a6e; }}
.label {{ font-size: 12px; color: #475569; font-weight: 500; margin-bottom: 8px; }}
.value {{ font-size: 22px; font-weight: 600; color: #f1f5f9; font-variant-numeric: tabular-nums; }}
.holding {{ font-size: 13px; color: #64748b; margin-top: 4px; font-variant-numeric: tabular-nums; }}
.change {{ font-size: 13px; font-weight: 500; margin-top: 5px; }}

.total {{ font-size: 13px; color: #475569; margin-top: 14px; }}
.total span {{ color: #f1f5f9; font-weight: 600; font-size: 18px; margin-left: 6px; }}
.daily-chg {{ font-size: 14px; font-weight: 500; margin-left: 8px; }}

.fixtures-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
  margin-top: 14px;
}}
.fixture {{
  background: #141b2d; border: 1px solid #1e2d45;
  border-radius: 12px; padding: 14px 18px;
}}
.fixture.chelsea {{
  border-color: #1d4ed8; background: rgba(29,78,216,0.07);
}}
.fix-meta {{ display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }}
.gw {{
  font-size: 10px; font-weight: 700; color: #3b82f6;
  background: rgba(59,130,246,0.1); padding: 2px 7px; border-radius: 20px;
}}
.fix-time {{ font-size: 12px; color: #475569; }}
.fix-teams {{ font-size: 14px; color: #cbd5e1; font-weight: 500; }}
.fix-teams em {{ font-style: normal; color: #475569; margin: 0 5px; font-size: 12px; }}

.company-card {{
  background: #141b2d; border: 1px solid #1e2d45;
  border-left: 3px solid #3b82f6; border-radius: 14px; padding: 24px 28px;
}}
.company-tag {{
  display: inline-block; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: #3b82f6;
  background: rgba(59,130,246,0.1); padding: 3px 10px; border-radius: 20px; margin-bottom: 12px;
}}
.company-name {{ font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 10px; }}
.company-what {{ font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 8px; }}
.company-why {{ font-size: 13.5px; color: #64748b; line-height: 1.6; margin-bottom: 16px; font-style: italic; }}
.company-link {{ font-size: 13px; color: #3b82f6; text-decoration: none; }}
.company-link:hover {{ color: #93c5fd; }}

.news-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px; margin-top: 14px;
}}
.news-col {{
  background: #141b2d; border: 1px solid #1e2d45; border-radius: 14px; padding: 22px;
}}
.col-title {{
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: #3b82f6; margin-bottom: 16px;
}}
.story {{
  display: block; padding: 9px 0; border-bottom: 1px solid #1e2d45;
  text-decoration: none; color: #94a3b8; font-size: 13.5px;
  line-height: 1.45; transition: color 0.15s;
}}
.story:last-child {{ border-bottom: none; padding-bottom: 0; }}
.story:first-child {{ padding-top: 0; }}
.story:hover {{ color: #f1f5f9; }}
.empty {{ color: #334155; font-size: 13px; }}

.footer {{ margin-top: 48px; font-size: 12px; color: #1e2d45; text-align: center; }}
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
  <div class="section-label">Upcoming Fixtures</div>
  <div class="fixtures-grid">{fix_html}</div>
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

    print("Fetching fixtures...")
    fixtures = get_pl_fixtures()

    company = get_company_of_day()

    print("Building briefing...")
    html = build_html(portfolio, indices, news, fixtures, company)

    out = os.path.join(tempfile.gettempdir(), "daily_briefing.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    webbrowser.open(f"file://{out}")
    print(f"Done — opened in browser ({out})")


if __name__ == "__main__":
    main()

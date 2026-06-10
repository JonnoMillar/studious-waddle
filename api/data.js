import { readFileSync } from 'fs';
import { join }         from 'path';

const FEEDS = {
  "World":          ["https://feeds.bbci.co.uk/news/world/rss.xml", 5],
  "Premier League": ["https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml", 4],
  "Tech":           ["https://feeds.arstechnica.com/arstechnica/index", 5],
  "AI":             ["https://venturebeat.com/category/ai/feed/", 5],
};

function parseRSS(xml, limit) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const getVal = tag => {
      const rx = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const hit = block.match(rx);
      return hit ? hit[1].trim() : '';
    };
    const title   = getVal('title');
    const link    = getVal('link') || getVal('guid');
    const pubDate = getVal('pubDate');
    const rawDesc = getVal('description');
    const description = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#[0-9]+;/g, '')
      .replace(/\s+/g, ' ').trim().substring(0, 200);
    const noise = ['find out more', 'click here', 'read more', 'more stories', 'subscribe'];
    if (title && link && title.length > 18 && !noise.some(p => title.toLowerCase().startsWith(p))) {
      items.push({ title, link, pubDate, description });
    }
  }
  return items;
}

const TEAM_PRESTIGE = {
  'Arsenal': 10, 'Manchester City': 10, 'Liverpool': 10,
  'Chelsea': 9, 'Manchester United': 8, 'Tottenham Hotspur': 8,
  'Newcastle United': 7, 'Aston Villa': 7,
  'Brighton & Hove Albion': 5, 'West Ham United': 5,
  'Fulham': 4, 'Brentford': 4, 'Nottingham Forest': 4,
  'Everton': 3, 'Crystal Palace': 3,
  'Wolverhampton Wanderers': 3, 'Leicester City': 3,
};

// Fuzzy-match FPL team names to The Odds API team names
function normaliseTeamName(name) {
  return name.toLowerCase()
    .replace('manchester city', 'man city')
    .replace('manchester united', 'man united')
    .replace('tottenham hotspur', 'tottenham')
    .replace('wolverhampton wanderers', 'wolves')
    .replace('brighton & hove albion', 'brighton')
    .replace('nottingham forest', 'nottm forest')
    .replace(/\s+/g, ' ').trim();
}

async function fetchOdds() {
  const key = process.env.ODDS_API_KEY;
  if (!key) return {};
  try {
    const r = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=${key}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const games = await r.json();
    if (!Array.isArray(games)) return {};
    const map = {};
    for (const g of games) {
      let hBest = null, dBest = null, aBest = null;
      for (const bk of (g.bookmakers || [])) {
        const mkt = (bk.markets || []).find(m => m.key === 'h2h');
        if (!mkt) continue;
        for (const o of (mkt.outcomes || [])) {
          if (o.name === g.home_team && (hBest === null || o.price > hBest)) hBest = o.price;
          if (o.name === g.away_team && (aBest === null || o.price > aBest)) aBest = o.price;
          if (o.name === 'Draw'      && (dBest === null || o.price > dBest)) dBest = o.price;
        }
      }
      const key1 = `${normaliseTeamName(g.home_team)}|${normaliseTeamName(g.away_team)}`;
      map[key1] = { h: hBest, d: dBest, a: aBest };
    }
    return map;
  } catch (_) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const TICKERS = {
    // Portfolio
    'AIAG':      'AIAG.L',
    'All World': 'VWRP.L',
    'US 500':    'VUSA.L',
    // FX
    'FX_GBPUSD': 'GBPUSD=X',
    // Indices
    'FTSE 100':  '^FTSE',
    'S&P 500':   '^GSPC',
    'NASDAQ':    '^IXIC',
    'Nikkei':    '^N225',
    'Bitcoin':   'BTC-USD',
    'Gold':      'GC=F',
    // Emerging Tech Companies
    // All featured companies are private — no exchange-traded tickers.
    // Price chips are omitted in the UI for these; see renderCompanies() in index.html.
    'CrowdStrike': 'CRWD',
    'Palantir':    'PLTR',
  };

  const [priceEntries, newsEntries, fixtureResult, oddsMap] = await Promise.all([

    Promise.all(Object.entries(TICKERS).map(async ([name, ticker]) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }
        );
        const data     = await r.json();
        const result   = data.chart.result[0];
        const currency = result.meta.currency || '';
        const closes   = result.indicators.quote[0].close.filter(c => c != null);
        const last     = closes[closes.length - 1];
        const prev     = closes[closes.length - 2];
        return [name, { price: last, change: prev ? ((last - prev) / prev) * 100 : 0, currency }];
      } catch (_) {
        return [name, { price: null, change: null, currency: '' }];
      }
    })),

    Promise.all(Object.entries(FEEDS).map(async ([name, [url, limit]]) => {
      try {
        const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const xml = await r.text();
        return [name, parseRSS(xml, limit)];
      } catch (_) {
        return [name, []];
      }
    })),

    (async () => {
      try {
        const [bsRes, fixRes] = await Promise.all([
          fetch('https://fantasy.premierleague.com/api/bootstrap-static/'),
          fetch('https://fantasy.premierleague.com/api/fixtures/'),
        ]);
        const bootstrap = await bsRes.json();
        const allFix    = await fixRes.json();

        const teams     = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.name]));
        const teamCodes = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.code]));
        const chelseaId = bootstrap.teams.find(t => t.name.includes('Chelsea'))?.id;

        const currentEvent = bootstrap.current_event || bootstrap.events?.find(e => e.is_current)?.id;
        const gwFixes = allFix
          .filter(f => f.event === currentEvent && f.kickoff_time)
          .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time));

        const chelseaFix = gwFixes.find(f => chelseaId && (f.team_a === chelseaId || f.team_h === chelseaId));

        const otherFixes = gwFixes
          .filter(f => f !== chelseaFix)
          .map(f => ({
            ...f,
            prestige: (TEAM_PRESTIGE[teams[f.team_h]] || 2) + (TEAM_PRESTIGE[teams[f.team_a]] || 2),
          }))
          .sort((a, b) => b.prestige - a.prestige || a.kickoff_time.localeCompare(b.kickoff_time))
          .slice(0, 9);

        return [chelseaFix, ...otherFixes].filter(Boolean).map(f => ({
          home:      teams[f.team_h] || '?',
          away:      teams[f.team_a] || '?',
          homeCode:  teamCodes[f.team_h] || null,
          awayCode:  teamCodes[f.team_a] || null,
          kickoff:   f.kickoff_time,
          gw:        f.event,
          finished:  f.finished,
          started:   f.started,
          score:     f.team_h_score != null ? `${f.team_h_score}–${f.team_a_score}` : null,
          chelsea:   !!(chelseaId && (f.team_h === chelseaId || f.team_a === chelseaId)),
          homeNorm:  normaliseTeamName(teams[f.team_h] || ''),
          awayNorm:  normaliseTeamName(teams[f.team_a] || ''),
        }));
      } catch (_) { return []; }
    })(),

    fetchOdds(),
  ]);

  const prices = Object.fromEntries(priceEntries);

  // US 500: VUSA.L is the ETF proxy. % change is accurate; unit price differs from actual fund NAV.

  // Attach odds to fixtures
  const fixtures = fixtureResult.map(f => {
    const key1 = `${f.homeNorm}|${f.awayNorm}`;
    const key2 = `${f.awayNorm}|${f.homeNorm}`;
    const odds  = oddsMap[key1] || oddsMap[key2] || null;
    // if found via key2 (odds API has home/away swapped), flip h/a
    const flipped = !oddsMap[key1] && !!oddsMap[key2];
    return {
      ...f,
      odds: odds ? {
        h: flipped ? odds.a : odds.h,
        d: odds.d,
        a: flipped ? odds.h : odds.a,
      } : null,
    };
  });

  let golf = { tee_times: [], scraped_at: null, error: null };
  try {
    const cached = JSON.parse(readFileSync(join(process.cwd(), 'api/golf-cache.json'), 'utf8'));
    const times = cached.tee_times || [];
    // Sort by price then distance — show all available slots
    const sorted = [...times]
      .sort((a, b) => {
        const priceDiff = (a.price_gbp || 0) - (b.price_gbp || 0);
        if (priceDiff !== 0) return priceDiff;
        return (a.distance_miles || 0) - (b.distance_miles || 0);
      })
      .slice(0, 10);
    golf = { ...cached, tee_times: sorted };
  } catch (_) {}

  res.json({
    prices,
    news:     Object.fromEntries(newsEntries),
    fixtures,
    golf,
  });
}

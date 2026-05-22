const FEEDS = {
  "World":          ["https://feeds.bbci.co.uk/news/world/rss.xml", 5],
  "Premier League": ["https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml", 4],
  "Tech":           ["https://feeds.arstechnica.com/arstechnica/index", 4],
  "AI":             ["https://venturebeat.com/category/ai/feed/", 4],
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
    const title = getVal('title');
    const link  = getVal('link') || getVal('guid');
    if (title && link) items.push({ title, link });
  }
  return items;
}

// Prestige score used to rank "must-watch" fixtures
const TEAM_PRESTIGE = {
  'Arsenal': 10, 'Manchester City': 10, 'Liverpool': 10,
  'Chelsea': 9, 'Manchester United': 8, 'Tottenham Hotspur': 8,
  'Newcastle United': 7, 'Aston Villa': 7,
  'Brighton & Hove Albion': 5, 'West Ham United': 5,
  'Fulham': 4, 'Brentford': 4, 'Nottingham Forest': 4,
  'Everton': 3, 'Crystal Palace': 3,
  'Wolverhampton Wanderers': 3, 'Leicester City': 3,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const TICKERS = {
    // Portfolio holdings
    'AIAG':      'AIAG.L',
    'All World': 'VWRP.L',
    'US 500':    'VUSA.L',
    // Key indices
    'FTSE 100':  '^FTSE',
    'S&P 500':   '^GSPC',
    'Bitcoin':   'BTC-USD',
    'Gold':      'GC=F',
    // Individual stock movers
    'Nvidia':      'NVDA',
    'Apple':       'AAPL',
    'Tesla':       'TSLA',
    'Meta':        'META',
    'Amazon':      'AMZN',
    'Microsoft':   'MSFT',
    'Alphabet':    'GOOGL',
    'ARM':         'ARM',
    'Palantir':    'PLTR',
    'Broadcom':    'AVGO',
    'AMD':         'AMD',
    'CrowdStrike': 'CRWD',
  };

  const [priceEntries, newsEntries, fixtureResult] = await Promise.all([

    // Prices
    Promise.all(Object.entries(TICKERS).map(async ([name, ticker]) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }
        );
        const data = await r.json();
        const result   = data.chart.result[0];
        const currency = result.meta.currency || '';
        const closes   = result.indicators.quote[0].close.filter(c => c != null);
        const last = closes[closes.length - 1];
        const prev = closes[closes.length - 2];
        return [name, { price: last, change: prev ? ((last - prev) / prev) * 100 : 0, currency }];
      } catch (_) {
        return [name, { price: null, change: null, currency: '' }];
      }
    })),

    // News
    Promise.all(Object.entries(FEEDS).map(async ([name, [url, limit]]) => {
      try {
        const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const xml = await r.text();
        return [name, parseRSS(xml, limit)];
      } catch (_) {
        return [name, []];
      }
    })),

    // Fixtures
    (async () => {
      try {
        const [bsRes, fixRes] = await Promise.all([
          fetch('https://fantasy.premierleague.com/api/bootstrap-static/'),
          fetch('https://fantasy.premierleague.com/api/fixtures/?future=1'),
        ]);
        const bootstrap = await bsRes.json();
        const allFix    = await fixRes.json();

        const teams     = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.name]));
        const teamCodes = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.code]));
        const chelseaId = bootstrap.teams.find(t => t.name.includes('Chelsea'))?.id;

        const upcoming = allFix
          .filter(f => !f.finished && f.kickoff_time)
          .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time));

        const chelseaFix = upcoming.find(f => chelseaId && (f.team_a === chelseaId || f.team_h === chelseaId));

        // Rank all other fixtures by combined team prestige, then by date
        const otherFixes = upcoming
          .filter(f => f !== chelseaFix)
          .map(f => ({
            ...f,
            prestige: (TEAM_PRESTIGE[teams[f.team_h]] || 2) + (TEAM_PRESTIGE[teams[f.team_a]] || 2),
          }))
          .sort((a, b) => b.prestige - a.prestige || a.kickoff_time.localeCompare(b.kickoff_time))
          .slice(0, 9);

        const toFix = f => ({
          home:      teams[f.team_h] || '?',
          away:      teams[f.team_a] || '?',
          homeCode:  teamCodes[f.team_h] || null,
          awayCode:  teamCodes[f.team_a] || null,
          kickoff:   f.kickoff_time,
          gw:        f.event,
          chelsea:   !!(chelseaId && (f.team_h === chelseaId || f.team_a === chelseaId)),
        });

        return [chelseaFix, ...otherFixes].filter(Boolean).map(toFix);
      } catch (_) { return []; }
    })(),

  ]);

  res.json({
    prices:   Object.fromEntries(priceEntries),
    news:     Object.fromEntries(newsEntries),
    fixtures: fixtureResult,
  });
}

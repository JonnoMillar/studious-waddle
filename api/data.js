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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const TICKERS = {
    'AIAG':      'AIAG.L',
    'All World': 'VWRP.L',
    'US 500':    'VUSA.L',
    'FTSE 100':  '^FTSE',
    'S&P 500':   '^GSPC',
    'Bitcoin':   'BTC-USD',
    'Gold':      'GC=F',
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
        const chelseaId = bootstrap.teams.find(t => t.name.includes('Chelsea'))?.id;
        const topNames  = new Set(['Arsenal','Manchester City','Liverpool','Manchester United',
                                   'Chelsea','Tottenham Hotspur','Newcastle United','Aston Villa']);
        const topIds    = new Set(bootstrap.teams.filter(t => topNames.has(t.name)).map(t => t.id));

        const upcoming = allFix
          .filter(f => !f.finished && f.kickoff_time)
          .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time));

        const chelseaFix = upcoming.find(f => chelseaId && (f.team_a === chelseaId || f.team_h === chelseaId));
        const topFixes   = upcoming
          .filter(f => f !== chelseaFix && topIds.has(f.team_a) && topIds.has(f.team_h))
          .slice(0, 3);

        return [chelseaFix, ...topFixes].filter(Boolean).map(f => ({
          home:    teams[f.team_h] || '?',
          away:    teams[f.team_a] || '?',
          kickoff: f.kickoff_time,
          gw:      f.event,
          chelsea: !!(chelseaId && (f.team_h === chelseaId || f.team_a === chelseaId)),
        }));
      } catch (_) { return []; }
    })(),

  ]);

  res.json({
    prices:   Object.fromEntries(priceEntries),
    news:     Object.fromEntries(newsEntries),
    fixtures: fixtureResult,
  });
}

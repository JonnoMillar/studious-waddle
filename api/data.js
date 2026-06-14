import { readFileSync } from 'fs';
import { join }         from 'path';

const FEEDS = {
  "World":    [["https://feeds.bbci.co.uk/news/world/rss.xml"], 5],
  "Football": [["https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml", "https://www.fifa.com/rss/news"], 5],
  "Tech":     [["https://feeds.arstechnica.com/arstechnica/index"], 5],
  "AI":       [["https://techcrunch.com/category/artificial-intelligence/feed/", "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"], 5],
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

const TEAM_PRESTIGE = {};

// Fuzzy-match team names to The Odds API team names
function normaliseTeamName(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function fetchWcOdds() {
  const key = process.env.ODDS_API_KEY;
  if (!key) return {};
  try {
    const r = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=${key}`,
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
      const k = `${normaliseTeamName(g.home_team)}|${normaliseTeamName(g.away_team)}`;
      map[k] = { h: hBest, d: dBest, a: aBest };
    }
    return map;
  } catch (_) { return {}; }
}

function friendlySentence(title, startIso, multiDay) {
  const start   = new Date(startIso);
  const now     = new Date();
  const daysAway = Math.round((start - now) / 86400000);

  let when;
  if (daysAway <= 0)       when = 'today';
  else if (daysAway === 1) when = 'tomorrow';
  else if (daysAway < 14)  when = `in ${daysAway} days`;
  else                     when = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(daysAway > 300 ? { year: 'numeric' } : {}) });

  const t = title.toLowerCase();
  if (/\bfl(y|ight|ights)\b|departure|\barriv/.test(t)) {
    const loc = title.match(/to\s+([A-Z][a-zA-ZÀ-ÿ\s]+)/)?.[1]?.trim();
    return { emoji: '✈️', text: loc ? `You fly off to ${loc} ${when}!` : `Flight ${when}!` };
  }
  const PLACES = ['majorca','mallorca','ibiza','tenerife','lanzarote','marbella','barcelona',
    'madrid','paris','rome','amsterdam','lisbon','dubai','new york','los angeles','thailand',
    'bali','japan','australia','florida','miami','vegas','las vegas','mexico','cancun'];
  if (PLACES.some(p => t.includes(p))) {
    const place = title.replace(/holiday|trip|vacation/gi, '').trim();
    return { emoji: '☀️', text: `You head off to ${place} ${when}!` };
  }
  if (multiDay || /holiday|vacation|annual leave|day off|off work/.test(t)) {
    return { emoji: '🏖️', text: `Holiday: ${title} starts ${when}.` };
  }
  const bdayMatch = title.match(/(.+?)(?:'s)?\s*birthday/i);
  if (bdayMatch) return { emoji: '🎂', text: `${bdayMatch[1].trim()}'s birthday ${when}.` };
  if (/driving test/.test(t))            return { emoji: '🚗', text: `Driving test ${when}.` };
  if (/\bmot\b/.test(t))                 return { emoji: '🔧', text: `MOT ${when}.` };
  if (/dentist|dental/.test(t))          return { emoji: '🦷', text: `Dentist ${when}.` };
  if (/doctor|gp\b|appointment/.test(t)) return { emoji: '🏥', text: `${title} ${when}.` };
  return { emoji: '📅', text: `${title} · ${when}` };
}

async function fetchCalendar() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return [];
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return [];

    const now    = new Date().toISOString();
    const cutoff = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

    // Skip auto-generated calendars (UK public holidays, contacts birthday auto-calendar)
    const SKIP_CAL_IDS = new Set([
      'en.uk#holiday@group.v.calendar.google.com',
      '#contacts@group.v.calendar.google.com',
    ]);

    const calListRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const calList = await calListRes.json();
    const calIds  = (calList.items || []).map(c => c.id).filter(id => !SKIP_CAL_IDS.has(id));

    const allItems = (await Promise.all(
      calIds.map(async calId => {
        try {
          const r = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${now}&timeMax=${cutoff}&singleEvents=true&orderBy=startTime&maxResults=20`,
            { headers: { Authorization: `Bearer ${access_token}` } }
          );
          const d = await r.json();
          return d.items || [];
        } catch (_) { return []; }
      })
    )).flat();

    return allItems
      .filter(ev => ev.summary)
      .filter(ev => {
        const t = ev.summary.toLowerCase();
        // Skip booking confirmation events (accommodation details, flight refs)
        return !(t.includes('stay at ') || t.includes('apartment ') || (t.includes('flight') && t.includes('#')));
      })
      .sort((a, b) => {
        const da = new Date(a.start?.dateTime || a.start?.date || 0);
        const db = new Date(b.start?.dateTime || b.start?.date || 0);
        return da - db;
      })
      .map(ev => {
        const startIso = ev.start?.dateTime || ev.start?.date || null;
        const multiDay = ev.start?.date && ev.end?.date &&
                         ev.end.date !== ev.start.date &&
                         new Date(ev.end.date) - new Date(ev.start.date) > 86400000;
        const { emoji, text } = friendlySentence(ev.summary, startIso, multiDay);
        return { title: ev.summary, startIso, emoji, text };
      });
  } catch (_) { return []; }
}

// Inbox triage: unread mail that actually needs a reply (starred, important,
// or addressed directly to the user) — not a general unread count.
async function fetchInboxTriage() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;

    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?' + new URLSearchParams({
        q: 'is:unread in:inbox -category:promotions -category:social',
        maxResults: '10',
      }),
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const list = await listRes.json();
    const ids  = (list.messages || []).map(m => m.id);

    const messages = await Promise.all(ids.map(async id => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
          '?format=metadata&metadataHeaders=From&metadataHeaders=Subject',
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        return r.json();
      } catch (_) { return null; }
    }));

    const items = messages
      .filter(m => m && (m.labelIds || []).includes('IMPORTANT'))
      .map(m => {
        const headers = m.payload?.headers || [];
        const get     = name => headers.find(h => h.name === name)?.value || '';
        const from    = get('From').replace(/<.*>/, '').replace(/"/g, '').trim();
        const subject = get('Subject') || '(no subject)';
        return { from, subject };
      });

    return { count: items.length, items: items.slice(0, 3) };
  } catch (_) { return null; }
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

  const [priceEntries, newsEntries, wcResult, oddsMap, calendarEvents, inbox] = await Promise.all([

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

    Promise.all(Object.entries(FEEDS).map(async ([name, [urls, limit]]) => {
      try {
        const allItems = (await Promise.all(
          urls.map(async url => {
            try {
              const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (!r.ok) return [];
              return parseRSS(await r.text(), limit * 2);
            } catch (_) { return []; }
          })
        )).flat();

        // Dedupe by first 60 chars of lowercased title
        const seen = new Set();
        const deduped = allItems.filter(item => {
          const key = item.title.toLowerCase().slice(0, 60);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Sort newest first
        deduped.sort((a, b) => {
          const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
          const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
          return db - da;
        });

        return [name, deduped.slice(0, limit)];
      } catch (_) {
        return [name, []];
      }
    })),

    (async () => {
      try {
        const r = await fetch(
          'https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=200&language=en',
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const data = await r.json();
        const matches = data.Results || [];

        const norm = matches.map(m => ({
          id:        m.IdMatch,
          stageId:   m.IdStage,
          groupName: m.GroupName?.[0]?.Description || m.StageName?.[0]?.Description || '',
          stageName: m.StageName?.[0]?.Description || '',
          home:      m.Home?.TeamName?.[0]?.Description || m.PlaceHolderA || '?',
          away:      m.Away?.TeamName?.[0]?.Description || m.PlaceHolderB || '?',
          homeAbbr:  m.Home?.Abbreviation || '',
          awayAbbr:  m.Away?.Abbreviation || '',
          homeFlag:  m.Home?.Abbreviation ? `https://api.fifa.com/api/v3/picture/flags-sq-4/${m.Home.Abbreviation}` : '',
          awayFlag:  m.Away?.Abbreviation ? `https://api.fifa.com/api/v3/picture/flags-sq-4/${m.Away.Abbreviation}` : '',
          kickoff:   m.Date,
          homeScore: m.HomeTeamScore ?? null,
          awayScore: m.AwayTeamScore ?? null,
          homePens:  m.HomeTeamPenaltyScore ?? null,
          awayPens:  m.AwayTeamPenaltyScore ?? null,
          matchTime: m.MatchTime || null,
          stadium:   m.Stadium?.Name?.[0]?.Description || '',
          city:      m.Stadium?.CityName?.[0]?.Description || '',
          finished:  m.MatchStatus === 0 && m.HomeTeamScore !== null,
          live:      m.MatchStatus === 3,
          isEngland: !!(m.Home?.Abbreviation === 'ENG' || m.Away?.Abbreviation === 'ENG'),
        }));

        const upcoming = norm.filter(m => !m.finished && m.kickoff);
        const nextMatch = upcoming.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
        const currentStageId = nextMatch?.stageId || norm[0]?.stageId;
        const roundMatches = norm.filter(m => m.stageId === currentStageId);
        const england = roundMatches.find(m => m.isEngland) || null;

        return { matches: roundMatches, england, stageName: nextMatch?.stageName || '' };
      } catch (_) {
        // Fallback: openfootball static JSON
        try {
          const r2 = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json',
            { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const raw = await r2.json();
          const allMatches = (raw.rounds || []).flatMap(round =>
            (round.matches || []).map(m => ({
              id: `${m.team1}-${m.team2}-${m.date}`,
              stageId: round.name,
              groupName: m.group || round.name,
              stageName: round.name,
              home: m.team1, away: m.team2,
              homeAbbr: '', awayAbbr: '',
              homeFlag: '', awayFlag: '',
              kickoff: m.date && m.time ? `${m.date}T${m.time}:00Z` : m.date,
              homeScore: m.score?.ft?.[0] ?? null,
              awayScore: m.score?.ft?.[1] ?? null,
              homePens: m.score?.p?.[0] ?? null,
              awayPens: m.score?.p?.[1] ?? null,
              matchTime: null, stadium: m.ground || '', city: '',
              finished: !!(m.score?.ft), live: false,
              isEngland: m.team1 === 'England' || m.team2 === 'England',
            }))
          );
          const upcoming2 = allMatches.filter(m => !m.finished);
          const next2 = upcoming2.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
          const stage2 = next2?.stageId || allMatches[0]?.stageId;
          const round2 = allMatches.filter(m => m.stageId === stage2);
          return { matches: round2, england: round2.find(m => m.isEngland) || null, stageName: next2?.stageName || '' };
        } catch (__) { return { matches: [], england: null, stageName: '' }; }
      }
    })(),

    fetchWcOdds(),
    fetchCalendar(),
    fetchInboxTriage(),
  ]);

  const prices = Object.fromEntries(priceEntries);

  // US 500: VUSA.L is the ETF proxy. % change is accurate; unit price differs from actual fund NAV.

  // Attach WC odds to matches
  const wcFixtures = wcResult.matches.map(f => {
    const k1 = `${normaliseTeamName(f.home)}|${normaliseTeamName(f.away)}`;
    const k2 = `${normaliseTeamName(f.away)}|${normaliseTeamName(f.home)}`;
    const odds = oddsMap[k1] || oddsMap[k2] || null;
    const flipped = !oddsMap[k1] && !!oddsMap[k2];
    return {
      ...f,
      odds: odds ? {
        h: flipped ? odds.a : odds.h,
        d: odds.d,
        a: flipped ? odds.h : odds.a,
      } : null,
    };
  });
  const englandWithOdds = wcResult.england
    ? wcFixtures.find(m => m.id === wcResult.england.id) || wcResult.england
    : null;

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
    worldCup: {
      matches:   wcFixtures,
      england:   englandWithOdds,
      stageName: wcResult.stageName,
    },
    calendar: calendarEvents,
    golf,
    inbox,
  });
}

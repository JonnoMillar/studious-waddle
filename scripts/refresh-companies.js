#!/usr/bin/env node
/**
 * Refreshes the "Companies to Watch" cache.
 *
 * Ranks a pool of companies by how recently they've been in the news
 * (Google News RSS, no API key) and attaches a 30-day price sparkline for
 * any that are publicly traded (Yahoo Finance chart API, no API key).
 *
 * Run: node scripts/refresh-companies.js > api/companies-cache.json
 */

const _gfav = d => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;

const POOL = [
  { name: 'Figure AI',             tag: 'Robotics',       desc: 'Humanoid robots designed for industrial and commercial work', domain: 'figure.ai',                    initials: 'FA',  url: 'https://figure.ai' },
  { name: 'Physical Intelligence', tag: 'Embodied AI',    desc: 'Training AI systems to manipulate physical objects',          domain: 'physicalintelligence.company', initials: 'PI',  url: 'https://physicalintelligence.company' },
  { name: 'Commonwealth Fusion',   tag: 'Energy',         desc: 'Next-generation tokamak fusion for clean energy at scale',    domain: 'cfs.energy',                   initials: 'CFS', url: 'https://cfs.energy' },
  { name: 'Waymo',                 tag: 'Autonomy',       desc: 'The most miles driven autonomously of any robotaxi service',  domain: 'waymo.com',                    initials: 'W',   url: 'https://waymo.com' },
  { name: 'Mistral AI',            tag: 'LLMs',           desc: "Europe's leading open-weight AI foundation models",           domain: 'mistral.ai',                   initials: 'M',   url: 'https://mistral.ai' },
  { name: 'Groq',                  tag: 'AI Chips',       desc: 'LPU inference chips delivering industry-leading token speed', domain: 'groq.com',                     initials: 'G',   url: 'https://groq.com' },
  { name: 'Scale AI',              tag: 'AI Data',        desc: 'Data labelling and RLHF infrastructure powering frontier AI', domain: 'scale.com',                    initials: 'S',   url: 'https://scale.com' },
  { name: 'Neuralink',             tag: 'Brain-Computer', desc: 'Implantable neural interfaces for restoring and augmenting human capability', domain: 'neuralink.com', initials: 'NL', url: 'https://neuralink.com' },
  { name: 'Cursor',                tag: 'Code Editor',    desc: 'AI-native code editor that pairs with Claude and GPT-4',     domain: 'cursor.com',                   initials: 'C',   url: 'https://cursor.com' },
  { name: 'Anduril',               tag: 'Defense AI',     desc: 'Autonomous defense systems and AI-enabled military hardware', domain: 'anduril.com',                  initials: 'A',   url: 'https://anduril.com' },
  { name: 'OpenAI',                tag: 'LLMs',           desc: 'Creator of ChatGPT and the GPT family of foundation models',  domain: 'openai.com',                   initials: 'OAI', url: 'https://openai.com' },
  { name: 'Anthropic',             tag: 'LLMs',           desc: 'AI safety company behind the Claude family of models',        domain: 'anthropic.com',                initials: 'AN',  url: 'https://anthropic.com' },
  { name: 'Perplexity',            tag: 'AI Search',      desc: 'Answer engine combining web search with AI-generated summaries', domain: 'perplexity.ai',             initials: 'P',   url: 'https://perplexity.ai' },
  { name: 'xAI',                   tag: 'LLMs',           desc: "Elon Musk's AI company, developer of the Grok models",        domain: 'x.ai',                         initials: 'X',   url: 'https://x.ai' },
  { name: 'CrowdStrike',           tag: 'Cybersecurity',  desc: 'Cloud-native endpoint protection and threat intelligence',    domain: 'crowdstrike.com',              initials: 'CS',  url: 'https://crowdstrike.com', ticker: 'CRWD' },
  { name: 'Palantir',              tag: 'Data Analytics', desc: 'Big-data analytics platforms for government and enterprise',  domain: 'palantir.com',                 initials: 'PL',  url: 'https://palantir.com', ticker: 'PLTR' },
  { name: 'Rocket Lab',            tag: 'Space',          desc: 'Small-satellite launch provider and space systems manufacturer', domain: 'rocketlabusa.com',          initials: 'RL',  url: 'https://rocketlabusa.com', ticker: 'RKLB' },
];

async function fetchHeadline(name) {
  try {
    const r = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}&hl=en-GB&gl=GB&ceid=GB:en`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const xml = await r.text();
    const m = xml.match(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!m) return null;
    return { title: m[1].trim(), link: m[2].trim(), pubDate: m[3].trim() };
  } catch (_) { return null; }
}

async function fetchSparkline(ticker) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }
    );
    const d = await r.json();
    const closes = d.chart.result[0].indicators.quote[0].close.filter(c => c != null);
    return closes.length ? closes : null;
  } catch (_) { return null; }
}

async function main() {
  const enriched = await Promise.all(POOL.map(async c => {
    const [headline, sparkline] = await Promise.all([
      fetchHeadline(c.name),
      c.ticker ? fetchSparkline(c.ticker) : Promise.resolve(null),
    ]);
    return {
      name: c.name, tag: c.tag, desc: c.desc, url: c.url, initials: c.initials,
      logo: _gfav(c.domain), ticker: c.ticker || null,
      headline, sparkline,
    };
  }));

  // Rank by news recency — most recently covered companies float to the top.
  // Entries with no headline sink to the bottom but are still shown.
  const ranked = enriched
    .map(c => ({ ...c, _t: c.headline?.pubDate ? new Date(c.headline.pubDate).getTime() : 0 }))
    .sort((a, b) => b._t - a._t)
    .slice(0, 8)
    .map(({ _t, ...c }) => c);

  process.stdout.write(JSON.stringify({
    refreshed_at: new Date().toISOString(),
    companies: ranked,
  }, null, 2));
}

main();

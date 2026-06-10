# World Cup, Spotify, Calendar, Headlines refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FPL section and Premier League fixtures with World Cup fixtures + WC Fantasy Insights, add Spotify and Google Calendar sections, fix stale AI headlines, and restructure the page into a mosaic layout — all on the existing static-HTML + Vercel-functions architecture.

**Architecture:** Static `index.html` calls Vercel serverless functions for data. Existing `/api/data` extends with WC fixtures, calendar, updated news feeds. Two new Vercel functions — `/api/wc-fantasy` (1MB FIFA public JSON, 1h cache) and `/api/spotify` (polled every 30s by the page). Page layout migrates from a 3-column grid to a 12-column grid for asymmetric mosaic blocks.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no framework, no tests). Vercel functions in Node.js (ESM). Open-Meteo, FIFA, Spotify Web API, Google Calendar API v3, BBC + TechCrunch + The Verge RSS, GolfNow scraper (existing).

**Verification model:** This codebase has no test framework. Each task ends with a visual or curl-based verification step instead of automated tests. The pattern: edit → start `vercel dev` (or just open `index.html` for pure-frontend changes) → check the relevant section renders correctly → commit.

**Spec:** `docs/superpowers/specs/2026-06-10-world-cup-spotify-calendar-design.md`

---

## File Structure

**Existing files modified:**
- `index.html` — page markup, CSS grid layout, render functions for every section. Large single file (2,333 lines). The plan does not split it; it follows the existing convention.
- `api/data.js` — Vercel function. Extended with WC fixtures, calendar, updated feeds. FPL fetching removed.
- `CLAUDE.md` — project notes; updated when the WC fixtures section ships.

**New files created:**
- `api/wc-fantasy.js` — Vercel function for FIFA Fantasy public JSON (cached 1h, returns precomputed metrics).
- `api/spotify.js` — Vercel function for Spotify Web API (now playing, top track, top artist).

**Why no file split:** the codebase convention is one big `index.html`. Splitting it now would be unrelated refactoring beyond the spec scope. New render functions slot into the existing JS block at the bottom of `index.html`.

---

## Task ordering

Tasks are sequenced so each commit leaves the page in a working state. WC fixtures (Task 4) is the time-pressured one — must land before tournament kickoff on 2026-06-11 19:00 UTC.

1. **Task 1** — Cleanup: remove FPL, fix companies/ticker drift, US 500 ratio. *No new features.*
2. **Task 2** — Migrate grid from 3-column to 12-column. *Layout only, no new sections.*
3. **Task 3** — Headlines: AI feed fix + Football tab. *Fast win.*
4. **Task 4** — World Cup fixtures section. *Ship before kickoff.*
5. **Task 5** — World Cup Fantasy Insights section.
6. **Task 6** — Google Calendar section. *Blocked on user-provided OAuth refresh token.*
7. **Task 7** — Spotify section. *Blocked on user-provided OAuth refresh token.*

---

## Task 1: Cleanup pass — remove FPL, fix companies/ticker drift, kill US 500 ratio hack

**Goal:** One refactor commit that removes dead code and fixes existing tech debt. Visual output unchanged except the FPL card disappears. Lays clean ground for everything that follows.

**Files:**
- Modify: `index.html` (delete FPL CSS/markup/render code; align `CO_NAMES` with renderable companies)
- Modify: `api/data.js` (delete FPL fetching, align TICKERS with companies, remove US 500 ratio if a real ticker exists)

### Step 1.1 — Find and confirm the correct Vanguard U.S. 500 ticker

- [ ] **Step 1: Web search for the correct Yahoo ticker for "Vanguard U.S. 500 Stock Index Fund USD Acc"**

The current code uses VUSA.L (the ETF) as a proxy and applies a hand-calibrated ratio of 58.2 to derive an approximate NAV. The fund Jonno actually holds is the index fund, not the ETF. They have the same underlying performance but different unit prices.

Run a web search for: `Vanguard U.S. 500 Stock Index Fund USD Acc Yahoo Finance ticker ISIN`

Likely outcomes:
- A direct Yahoo ticker exists (e.g. ISIN `IE00B5BMR087` may have a Yahoo symbol like `0P0000KSPA.L`). Use it.
- Only the ETF (VUSA.L) is on Yahoo Finance. Accept VUSA.L as the proxy and remove the calibration math — the % change is correct; only the unit price is "wrong" but the user's intuition uses % anyway.

**Surface the result to the user before changing the number.** If a real ticker is found, note it in the commit message. If not, note that VUSA.L stays as proxy with calibration removed.

### Step 1.2 — Remove FPL fetching from api/data.js

- [ ] **Step 1: Delete the FPL fetch block in `api/data.js`**

Open `api/data.js`. Delete:
- Line 116: `const FPL_TEAM_ID = 3079376;`
- Lines 196-248: the entire `(async () => { ... })()` IIFE that fetches `entry`, `picks`, and `live` data and returns the `fplTeam` object. It is the 5th element in the `Promise.all` array.

The `Promise.all` destructuring at line 118 currently reads:
```js
const [priceEntries, newsEntries, fixtureResult, oddsMap, fplTeam] = await Promise.all([
```

Change to:
```js
const [priceEntries, newsEntries, fixtureResult, oddsMap] = await Promise.all([
```

The corresponding closing `]` and the trailing comma after the `oddsMap` IIFE need adjustment — remove the comma after `fetchOdds(),` becomes the last element, and delete the entire trailing IIFE plus its comma.

The final `res.json({ ... })` call at the bottom still references `fplTeam`. Delete that key from the response object.

- [ ] **Step 2: Verify api/data.js still works**

Run from `C:/Users/I763882/studious-waddle`:

```bash
node -e "import('./api/data.js').then(m => console.log('loaded ok'))"
```

Expected: `loaded ok` and no parse errors.

If you have `vercel dev` available:
```bash
vercel dev
```
Then in another shell:
```bash
curl -s http://localhost:3000/api/data | python -c "import sys,json; d=json.load(sys.stdin); print('keys:', list(d.keys())); print('has fplTeam:', 'fplTeam' in d)"
```
Expected: `has fplTeam: False`. The `keys` list should include `prices`, `news`, `fixtures`, `golf` but not `fplTeam`.

### Step 1.3 — Remove FPL render code from index.html

- [ ] **Step 1: Delete FPL CSS**

Open `index.html`. Delete the entire `FPL` CSS block — find the comment marker on line 487:

```css
/* ════════════════════════════════════════════════════════════════════
   FPL
   ════════════════════════════════════════════════════════════════════ */
```

Delete from that comment through to the next section comment (likely `GOLF` around line 717). All `#fpl-card`, `.fpl-*`, `.player-chip`, `.player-kit`, `.pitch-*` rules go.

Also find and delete the FPL responsive overrides in the `@media` blocks (around lines 1218-1219):
```css
.fpl-stats-row { gap: 12px; }
.fpl-stat-value { font-size: 28px; }
```

- [ ] **Step 2: Delete FPL markup**

In `index.html`, find the FPL card markup (around lines 1337-1353):

```html
  <!-- FPL -->
  <div class="card hover-lift cup-reveal" id="fpl-card">
    <div class="fpl-header">
      ... (whole block) ...
    </div>
    <div id="fpl-pitch-wrap">
      ...
    </div>
    <div id="fpl-bench-wrap"></div>
  </div>
```

Delete the entire `<!-- FPL -->` comment plus the `<div class="card hover-lift cup-reveal" id="fpl-card">...</div>` block.

- [ ] **Step 3: Delete FPL JavaScript**

In `index.html`, find:
- `function renderFPL(fpl) { ... }` starting around line 1818
- The `CLUB_COLOR` map (preceding renderFPL — search for `const CLUB_COLOR =`)
- Any helper functions only used by FPL: search for `playerChipHTML`, `formationOf`, anything FPL-specific

Delete those functions.

In the page bootstrap (around line 2284), find:
```js
renderFPL(data.fplTeam || null);
```

Delete that line.

- [ ] **Step 4: Sanity check the page still loads**

Open `index.html` in a browser. Expected:
- Page renders without errors in the JS console
- All other sections (hero, headlines, fixtures, golf, portfolio, markets, companies) still display
- No "FPL" card visible
- Layout has a hole where FPL was — that's fine; Task 2 fills it

### Step 1.4 — Align companies and tickers, fix US 500

- [ ] **Step 1: Audit current company/ticker drift**

In `index.html`, find `const CO_NAMES = [...]` (around line 2136) — this is the UI's source of truth. Currently includes: Figure AI, Physical Intelligence, Commonwealth Fusion, Waymo, Mistral AI, Groq, Scale AI, Neuralink, Cursor, Anduril.

In `api/data.js`, find the `TICKERS` object (around line 95) — the "Emerging Tech Companies" section currently has: Waymo→GOOGL, Perplexity AI→MSFT, Scale AI→NVDA, Neuralink→TSLA, CrowdStrike→CRWD, Palantir→PLTR.

Mismatch: most of the UI companies don't have tickers fetched (private), and tickers are fetched for companies the UI doesn't display (Perplexity, CrowdStrike, Palantir).

- [ ] **Step 2: Decide which companies have real public tickers and update `TICKERS`**

Of the 10 companies in `CO_NAMES`, only these have public stock tickers:
- None of them. All 10 are private companies as of 2026-06-10.

The previous mappings (Waymo→GOOGL, Scale AI→NVDA, etc.) were proxy mappings — the parent company or a related public company. These were misleading because the price didn't represent the company shown in the UI.

Edit `api/data.js`. Replace the `// Emerging Tech Companies` section of `TICKERS`:

```js
    // Emerging Tech Companies
    'Waymo':           'GOOGL',
    'Perplexity AI':   'MSFT',
    'Scale AI':        'NVDA',
    'Neuralink':       'TSLA',
    'CrowdStrike':     'CRWD',
    'Palantir':        'PLTR',
```

with:

```js
    // (No emerging-tech tickers — all 10 featured companies are private as of 2026-06.
    //  Companies render without a price chip; see renderCompanies() in index.html.)
```

- [ ] **Step 3: Make `renderCompanies` tolerate missing prices**

In `index.html`, find `function renderCompanies(prices)` (around line 2155). Read through it and find where it builds the price chip for each company. The pattern likely looks like:

```js
const priceData = prices[name];
const chipHTML = priceData ? buildChip(priceData) : '';
```

If the function currently assumes `prices[name]` always exists (e.g. accesses `prices[name].change` directly), wrap the chip-building in a guard so missing prices simply omit the chip:

```js
const priceData = prices[name];
const priceChipHTML = priceData?.price != null
  ? `<span class="co-featured-pct ${priceData.change >= 0 ? 'up' : 'down'}">${priceData.change >= 0 ? '+' : ''}${priceData.change.toFixed(2)}%</span>`
  : ''; // private company, no chip
```

The exact JSX/HTML structure depends on what's there now — read `renderCompanies` end to end before editing.

- [ ] **Step 4: Apply US 500 fix from Step 1.1's research**

In `api/data.js` around line 255:

```js
const _US500_RATIO = 58.2;
if (prices['S&P 500']?.price) {
  prices['US 500'] = { price: prices['S&P 500'].price / _US500_RATIO, change: prices['S&P 500'].change, currency: 'USD' };
}
```

**If Step 1.1 found a real ticker** (e.g. `0P0000KSPA.L`):
- Add it to the `TICKERS` map: `'US 500': '0P0000KSPA.L',`
- Delete the entire ratio block above. The price now comes through naturally.
- The portfolio render uses `prices['US 500'].price` × 35.99 units. Verify the new price gives a sensible total (around £3,000+).

**If Step 1.1 found no real ticker** (only VUSA.L is available):
- Keep VUSA.L → `'US 500'` mapping (already there as `'US 500': 'VUSA.L'`)
- Delete the ratio override block — % change is already accurate.
- Update the inline comment that explains the ratio. Replace it with: `// US 500: VUSA.L is the ETF proxy. % change is accurate; unit price differs from the actual fund NAV but is shown as-is.`

- [ ] **Step 5: Verify the page**

Open `index.html` in a browser (or `vercel dev` if API changes need testing). Check:
- Companies section displays all 10 names without errors. Private companies show name + tag + description but no `+x.xx%` chip.
- Markets section shows 6 cards with prices.
- Portfolio shows 3 fund chips, US 500 with a sensible value (compare to before — it should be in the same ballpark if VUSA.L is still the source).
- Browser console clean (no errors).

### Step 1.5 — Sweep stale `.hero-right` references and merge-conflict CSS

- [ ] **Step 1: Search for stale references**

Run from `C:/Users/I763882/studious-waddle`:
```bash
grep -n 'hero-right' index.html
```

Expected if anything remains: any line numbers where this class appears. The current markup uses `hero-weather-panel` instead. Delete any orphan `.hero-right` CSS rules (selector definitions with no corresponding HTML usage).

```bash
grep -n '<<<<<<<\|=======\|>>>>>>>' index.html api/data.js
```

Expected: no output. If anything appears, it's a leftover merge-conflict marker — delete it.

- [ ] **Step 2: Visual smoke test**

Open `index.html` in a browser. Confirm:
- Hero greeting + weather panel still render correctly.
- All other sections still render.
- No layout breakage.

### Step 1.6 — Commit

- [ ] **Step 1: Stage and commit**

```bash
cd C:/Users/I763882/studious-waddle
git add index.html api/data.js
git status   # confirm only the two files staged
```

```bash
git commit -m "Cleanup: remove FPL section, fix companies/ticker drift, US 500 hack

- Remove FPL render code, CSS, markup, and api/data.js fetching
  (off-season; will be replaced by World Cup sections in next commits)
- Align api/data.js TICKERS with index.html CO_NAMES — all featured
  companies are private, so no ticker fetching for them
- renderCompanies now tolerates missing prices (no chip rendered)
- Replace US 500 ratio hack: <chosen approach from Step 1.1>
- Sweep stale .hero-right refs

No new features; visual output unchanged except FPL card removed."
```

---

## Task 2: Migrate grid from 3-column to 12-column mosaic layout

**Goal:** Change `.wrap` from `repeat(3, 1fr)` to `repeat(12, 1fr)` and assign each existing card its new `grid-column` span. No new sections yet — existing cards just move into the mosaic. Page must look correct on desktop (≥900px), tablet (640–900px), and mobile (<640px).

**Files:**
- Modify: `index.html` (CSS grid rules + card span assignments + responsive overrides)

### Step 2.1 — Update the `.wrap` grid definition

- [ ] **Step 1: Change the grid to 12 columns**

In `index.html` find the `.wrap` rule (around line 42):

```css
.wrap {
  max-width: 1320px;
  margin: 0 auto;
  padding: 28px 36px 56px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
```

Change `grid-template-columns` to:

```css
.wrap {
  max-width: 1320px;
  margin: 0 auto;
  padding: 28px 36px 56px;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 14px;
}
```

### Step 2.2 — Assign grid-column spans to each card

- [ ] **Step 1: Update each card's CSS grid-column**

The new desktop layout (12-col grid):

| Card ID | Span | grid-column value |
|---|---|---|
| `#hero-card` | 12 | `1 / -1` |
| `#headlines-card` | 8 | `span 8` |
| `#spotify-card` | 4 | `span 4` |
| `#calendar-card` | 5 | `span 5` |
| `#portfolio-strip` | 7 | `span 7` |
| `#wc-fixtures-card` | 8 | `span 8` |
| `#wc-fantasy-card` | 4 | `span 4` |
| `#companies-card` | 12 | `1 / -1` |
| `#markets-card` | 7 | `span 7` |
| `#golf-card` | 5 | `span 5` |

`#spotify-card`, `#calendar-card`, `#wc-fixtures-card`, and `#wc-fantasy-card` don't exist yet — add placeholder CSS rules now so the layout is ready when the markup arrives:

Find the existing CSS block for `#portfolio-strip` (around line 292) and update it:

```css
#portfolio-strip { padding: 22px 24px; cursor: default; grid-column: span 7; }
```

Find `#markets-card` CSS (around line 347) and update:

```css
#markets-card {
  padding: 24px 28px;
  grid-column: span 7;
}
```

Find `#fixtures-card` CSS — this becomes `#wc-fixtures-card` in Task 4. For now rename the id in CSS only as a note; leave the id as `fixtures-card` in the HTML until Task 4. Update the span:

```css
#fixtures-card {
  padding: 24px 28px;
  grid-column: span 8;
  align-self: start;
}
```

Find `#golf-card` CSS and update:

```css
#golf-card { align-self: start; grid-column: span 5; }
```

Find `#headlines-card` CSS and update:

```css
#headlines-card {
  padding: 22px 28px 20px;
  grid-column: span 8;
}
```

Find `#companies-card` CSS and update:

```css
#companies-card {
  padding: 22px 28px 20px;
  grid-column: 1 / -1;
}
```

Add placeholder rules for the new cards (these cards don't have markup yet — add the CSS now so when the markup appears in later tasks the spans are already set):

```css
#spotify-card   { grid-column: span 4; align-self: start; }
#calendar-card  { grid-column: span 5; align-self: start; }
#wc-fantasy-card { grid-column: span 4; align-self: start; }
```

### Step 2.3 — Reorder markup to match mosaic

- [ ] **Step 1: Reorder the card divs inside `.wrap`**

The current DOM order in `index.html` (inside `<div class="wrap">`):

1. `#hero-card`
2. `#headlines-card`
3. `#fixtures-card`
4. `#golf-card`
5. `#portfolio-strip`
6. `#markets-card`
7. `#companies-card`
8. `#fpl-card` ← already deleted in Task 1

The new desired DOM order (CSS Grid places cards in source order by default when using `span` without explicit `grid-row`):

1. `#hero-card` (span 12)
2. `#headlines-card` (span 8) — Spotify card (span 4) will be added in Task 7 after it
3. `#calendar-card` placeholder comment (span 5) — add in Task 6
4. `#portfolio-strip` (span 7)
5. `#wc-fixtures-card` / `#fixtures-card` (span 8) — WC Fantasy (span 4) added in Task 5 after it
6. `#companies-card` (span 12)
7. `#markets-card` (span 7)
8. `#golf-card` (span 5)
9. `<div class="brief-footer">` (leave at end)

Cut and paste the card divs within `.wrap` to match this order. The exact HTML for each card doesn't change — just the DOM order.

Add placeholder comments where new cards will slot in:

```html
  <!-- SPOTIFY — added Task 7 -->

  <!-- CALENDAR — added Task 6 -->

  <!-- WC FANTASY INSIGHTS — added Task 5 -->
```

Place `<!-- SPOTIFY -->` immediately after `#headlines-card`.
Place `<!-- CALENDAR -->` immediately before `#portfolio-strip`.
Place `<!-- WC FANTASY INSIGHTS -->` immediately after the WC fixtures card (currently `#fixtures-card`).

### Step 2.4 — Update responsive breakpoints

- [ ] **Step 1: Update the 900px breakpoint**

Find `@media (max-width: 900px)` (around line 1205). Replace its contents with:

```css
@media (max-width: 900px) {
  .wrap { padding: 20px 20px 48px; grid-template-columns: 1fr 1fr; gap: 12px; }
  #hero-card, #headlines-card, #markets-card, #companies-card,
  #portfolio-strip, #wc-fixtures-card, #fixtures-card,
  #spotify-card, #calendar-card, #wc-fantasy-card { grid-column: 1 / -1; }
  #golf-card { grid-column: 1 / -1; }
  .hero-h1 { font-size: clamp(28px, 6vw, 48px); }
  .markets-grid { grid-template-columns: repeat(3, 1fr); }
}
```

- [ ] **Step 2: Update the 640px breakpoint**

Find `@media (max-width: 640px)` (around line 1212). Replace:

```css
@media (max-width: 640px) {
  .wrap { grid-template-columns: 1fr; padding: 14px 14px 40px; gap: 10px; }
  .wrap > .card { grid-column: 1 / -1 !important; }
  .hero-inner { flex-direction: column; }
  .hero-weather-panel { text-align: left; min-width: 0; border-left: none; border-top: 1px solid var(--line); width: 100%; align-items: flex-start; padding: 16px 28px; }
  .markets-grid { grid-template-columns: 1fr 1fr; }
  .fixtures-grid { grid-template-columns: 1fr; }
}
```

The `!important` on `.wrap > .card` ensures every card goes full-width on mobile without listing every new card id individually.

### Step 2.5 — Verify the layout

- [ ] **Step 1: Open `index.html` in a browser and check the layout at three widths**

At **≥900px** (desktop): 
- Row 1: Hero full width
- Row 2: Headlines (wider) + gap on right (Spotify placeholder empty)
- Row 3: (Calendar placeholder empty) + Portfolio strip
- Row 4: Fixtures (wider) + gap on right (WC Fantasy placeholder empty)
- Row 5: Companies full width
- Row 6: Markets (wider) + Golf

At **640–900px** (tablet): Everything stacks 1/-1 (full width). No gaps.

At **<640px** (mobile): Single column, all cards full width.

Check browser console for errors — there should be none.

### Step 2.6 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add index.html
git commit -m "Layout: migrate grid to 12-column mosaic

Switches .wrap from repeat(3,1fr) to repeat(12,1fr). Assigns spans
to all existing cards matching the design mosaic. Adds placeholder
CSS rules for upcoming new sections. Reorders DOM to match visual
row order. Updates responsive breakpoints to stack at 900px/640px."
```

---

## Task 3: Headlines — fix AI feed, rename Premier League tab to Football

**Goal:** Replace the stale VentureBeat AI RSS feed with TechCrunch AI + The Verge AI (deduped, sorted by date). Rename "Premier League" tab to "Football" and point it at the BBC World Cup feed (falling back to general football). Fast win — no new sections.

**Files:**
- Modify: `api/data.js` (update `FEEDS` object and fetch logic)
- Modify: `index.html` (update `CAT_SOURCES`, `CAT_COLORS`, `cats` array in renderHeadlines)

### Step 3.1 — Verify the BBC World Cup RSS feed exists

- [ ] **Step 1: Check the BBC World Cup feed URL**

```bash
curl -s -o /dev/null -w "%{http_code}" "https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml"
```

Expected: `200`. If you get `404`, use the general football feed instead:
`https://feeds.bbci.co.uk/sport/football/rss.xml`

Note which URL works — use it in Step 3.2.

### Step 3.2 — Update `api/data.js` FEEDS

- [ ] **Step 1: Replace the FEEDS constant**

In `api/data.js`, find the `FEEDS` object (lines 4–9):

```js
const FEEDS = {
  "World":          ["https://feeds.bbci.co.uk/news/world/rss.xml", 5],
  "Premier League": ["https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml", 4],
  "Tech":           ["https://feeds.arstechnica.com/arstechnica/index", 5],
  "AI":             ["https://venturebeat.com/category/ai/feed/", 5],
};
```

Replace with:

```js
const FEEDS = {
  "World":    [["https://feeds.bbci.co.uk/news/world/rss.xml"], 5],
  "Football": [["https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml", "https://www.fifa.com/rss/news"], 5],
  "Tech":     [["https://feeds.arstechnica.com/arstechnica/index"], 5],
  "AI":       [["https://techcrunch.com/category/artificial-intelligence/feed/", "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"], 5],
};
```

Each entry is now `[[...urls], limit]`.

- [ ] **Step 2: Update the feed fetching logic**

Find the `Promise.all` that fetches feeds (around line 138):

```js
Promise.all(Object.entries(FEEDS).map(async ([name, [url, limit]]) => {
  try {
    const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await r.text();
    return [name, parseRSS(xml, limit)];
  } catch (_) {
    return [name, []];
  }
})),
```

Replace with:

```js
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
```

### Step 3.3 — Update `index.html` tab labels

- [ ] **Step 1: Update CAT_SOURCES, CAT_COLORS, and cats array**

In `index.html` find (around line 2043):

```js
const CAT_SOURCES = { 'AI': 'VentureBeat', 'Tech': 'Ars Technica', 'World': 'BBC News', 'Premier League': 'BBC Sport' };
const CAT_COLORS  = { 'AI': '#d97757', 'Tech': '#5e8a64', 'World': '#2a6fdb', 'Premier League': '#1f8a5b' };
```

Replace with:

```js
const CAT_SOURCES = { 'AI': 'TechCrunch · The Verge', 'Tech': 'Ars Technica', 'World': 'BBC News', 'Football': 'BBC Sport · FIFA' };
const CAT_COLORS  = { 'AI': '#d97757', 'Tech': '#5e8a64', 'World': '#2a6fdb', 'Football': '#1f8a5b' };
```

Find (around line 2071):

```js
const cats = ['AI', 'Tech', 'World', 'Premier League'];
```

Replace with:

```js
const cats = ['AI', 'Tech', 'World', 'Football'];
```

### Step 3.4 — Verify

- [ ] **Step 1: Test API response**

Start `vercel dev` then run:

```bash
curl -s "http://localhost:3000/api/data" | python -c "
import sys, json
d = json.load(sys.stdin)
news = d.get('news', {})
print('Feed keys:', list(news.keys()))
for k, items in news.items():
    print(f'  {k}: {len(items)} items')
    if items: print(f'    first: {items[0][\"title\"][:70]}')
"
```

Expected: keys are `World`, `Football`, `Tech`, `AI`. No `Premier League`. AI items link to techcrunch.com or theverge.com, not venturebeat.com.

- [ ] **Step 2: Visual check**

Open the `vercel dev` URL in a browser. In Headlines: confirm four tabs (AI · Tech · World · Football), click Football tab to verify World Cup / football stories appear.

### Step 3.5 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add api/data.js index.html
git commit -m "Headlines: fix AI feed, rename PL tab to Football/World Cup

- AI: replace VentureBeat with TechCrunch AI + The Verge AI
- Football tab replaces Premier League; BBC World Cup RSS + FIFA news
- FEEDS format updated to support multi-URL entries with dedup + date sort"
```

---

## Task 4: World Cup fixtures section

**Goal:** Replace the Premier League fixtures card with a World Cup fixtures section. England's next match is pinned at the top as a hero panel. All matches in the current round scroll horizontally below it. Tap-to-expand shows stadium, group, win probability. Uses `api.fifa.com` (no auth) with openfootball as fallback. **Must ship before 2026-06-11 19:00 UTC.**

**Files:**
- Modify: `api/data.js` (replace EPL fixture fetch with FIFA WC fetch; update odds call to WC sport key)
- Modify: `index.html` (replace `#fixtures-card` markup, CSS, and `renderFixtures` with WC equivalents)

### Step 4.1 — Add WC fixture fetching to `api/data.js`

- [ ] **Step 1: Replace the EPL fixture fetch with a FIFA WC fetch**

In `api/data.js`, find the `fixtureResult` IIFE inside `Promise.all` (around lines 148–192). It currently fetches from `fantasy.premierleague.com`. Replace the entire IIFE with:

```js
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

    // Determine current round: find the matchday containing today or the soonest unfinished match
    const now = Date.now();
    const upcoming = norm.filter(m => !m.finished && m.kickoff);
    const nextMatch = upcoming.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
    const currentStageId = nextMatch?.stageId || norm[0]?.stageId;
    const roundMatches = norm.filter(m => m.stageId === currentStageId);

    const england = roundMatches.find(m => m.isEngland) || null;

    return { matches: roundMatches, england, stageName: nextMatch?.stageName || '' };
  } catch (err) {
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
          matchTime: null,
          stadium: m.ground || '',
          city: '',
          finished: !!(m.score?.ft),
          live: false,
          isEngland: m.team1 === 'England' || m.team2 === 'England',
        }))
      );
      const upcoming2 = allMatches.filter(m => !m.finished);
      const next2 = upcoming2.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
      const currentStage2 = next2?.stageId || allMatches[0]?.stageId;
      const roundMatches2 = allMatches.filter(m => m.stageId === currentStage2);
      const england2 = roundMatches2.find(m => m.isEngland) || null;
      return { matches: roundMatches2, england: england2, stageName: next2?.stageName || '' };
    } catch (_) {
      return { matches: [], england: null, stageName: '' };
    }
  }
})(),
```

- [ ] **Step 2: Update the destructuring at the top of the Promise.all result**

Find:
```js
const [priceEntries, newsEntries, fixtureResult, oddsMap] = await Promise.all([
```

Change `fixtureResult` to `wcResult`:
```js
const [priceEntries, newsEntries, wcResult, oddsMap] = await Promise.all([
```

- [ ] **Step 3: Update the odds fetch to use the WC sport key**

Find `fetchOdds()` (around line 60). Currently it fetches `soccer_epl`. Add a second odds fetch for the World Cup, or replace the sport key. The simplest approach is to add WC odds alongside EPL:

After the existing `fetchOdds()` function definition, add:

```js
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
```

In the `Promise.all` array, replace `fetchOdds()` with `fetchWcOdds()` (EPL odds are no longer needed since PL fixtures section is gone).

- [ ] **Step 4: Attach odds to WC matches and build the final response**

Find the section after `Promise.all` completes where `fixtures` is assembled (around line 260). Remove the old EPL fixture assembly and replace with:

```js
const wcOddsMap = oddsMap; // now contains WC odds from fetchWcOdds()

const wcFixtures = wcResult.matches.map(f => {
  const k1 = `${normaliseTeamName(f.home)}|${normaliseTeamName(f.away)}`;
  const k2 = `${normaliseTeamName(f.away)}|${normaliseTeamName(f.home)}`;
  const odds = wcOddsMap[k1] || wcOddsMap[k2] || null;
  const flipped = !wcOddsMap[k1] && !!wcOddsMap[k2];
  return {
    ...f,
    odds: odds ? {
      h: flipped ? odds.a : odds.h,
      d: odds.d,
      a: flipped ? odds.h : odds.a,
    } : null,
  };
});
```

In `res.json({...})`, replace `fixtures` with:

```js
worldCup: {
  matches:   wcFixtures,
  england:   wcResult.england ? wcFixtures.find(m => m.id === wcResult.england.id) || wcResult.england : null,
  stageName: wcResult.stageName,
},
```

Remove the old `fixtures` key from the response entirely.

### Step 4.2 — Add WC fixtures CSS to `index.html`

- [ ] **Step 1: Replace the old fixtures CSS**

In `index.html`, find the `FIXTURES` CSS block (around line 382 — look for the comment `FIXTURES`). The existing `.fixtures-*` classes can mostly stay — we're renaming the card id and adding new classes for the England hero panel and horizontal scroll.

Find and replace the `#fixtures-card` CSS rule:

```css
#fixtures-card {
  padding: 24px 28px;
  grid-column: span 2;
  align-self: start;
}
```

with:

```css
#wc-fixtures-card {
  padding: 24px 28px;
  grid-column: span 8;
  align-self: start;
}
```

After the fixtures section CSS, add the new WC-specific styles:

```css
/* ── WC England hero panel ─────────────────────────────────────── */
.wc-england-hero {
  background: linear-gradient(135deg, rgba(42,111,219,0.07), rgba(42,111,219,0.02));
  border: 1px solid rgba(42,111,219,0.20);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
  position: relative;
}
.wc-england-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--f-m);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 99px;
  margin-bottom: 10px;
}
.wc-england-badge.live  { background: rgba(192,57,43,0.12); color: var(--red); }
.wc-england-badge.today { background: rgba(42,111,219,0.12); color: var(--cup-accent); }
.wc-england-badge.upcoming { background: rgba(26,24,22,0.06); color: var(--ink3); }
.wc-england-badge.ft    { background: rgba(31,138,91,0.10); color: var(--green); }
.wc-hero-teams {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.wc-hero-flag {
  width: 36px; height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.wc-hero-flag-fb {
  width: 36px; height: 36px;
  border-radius: 6px;
  background: rgba(26,24,22,0.08);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.wc-hero-vs {
  font-family: var(--f-m);
  font-size: 11px;
  color: var(--ink3);
}
.wc-hero-score {
  font-family: var(--f-s);
  font-size: 28px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}
.wc-hero-team-name {
  font-family: var(--f-s);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.wc-hero-meta {
  font-family: var(--f-m);
  font-size: 11px;
  color: var(--ink3);
  margin-top: 4px;
}
.wc-hero-prob {
  font-family: var(--f-m);
  font-size: 11px;
  color: var(--ink3);
  margin-top: 6px;
}
.wc-hero-prob .prob-hi { color: var(--cup-accent); font-weight: 600; }

/* ── WC round scroll ───────────────────────────────────────────── */
.wc-round-label {
  font-family: var(--f-s);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ink3);
  margin-bottom: 10px;
}
.wc-scroll-wrap {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.wc-scroll-wrap::-webkit-scrollbar { display: none; }
.wc-chip {
  flex-shrink: 0;
  width: 160px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(26,24,22,0.025);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background .2s, border-color .2s;
  user-select: none;
}
.wc-chip:hover { background: rgba(26,24,22,0.05); }
.wc-chip.is-open { background: rgba(42,111,219,0.06); border-color: rgba(42,111,219,0.22); }
.wc-chip-flags {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.wc-chip-flag {
  width: 22px; height: 22px;
  border-radius: 4px;
  object-fit: cover;
}
.wc-chip-flag-fb {
  width: 22px; height: 22px;
  border-radius: 4px;
  background: rgba(26,24,22,0.08);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.wc-chip-vs { font-family: var(--f-m); font-size: 10px; color: var(--ink3); }
.wc-chip-teams {
  font-family: var(--f-s);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wc-chip-time {
  font-family: var(--f-m);
  font-size: 10px;
  color: var(--ink3);
  margin-top: 3px;
}
.wc-chip-score {
  font-family: var(--f-m);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-top: 2px;
  letter-spacing: -0.3px;
}
.wc-chip-odds {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  font-family: var(--f-m);
  font-size: 10px;
  color: var(--ink3);
}
.wc-chip-odds .fav-odd { color: var(--cup-accent); font-weight: 600; }
.wc-chip-expand {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows .28s cubic-bezier(.2,.7,.25,1);
}
.wc-chip-expand.open { grid-template-rows: 1fr; }
.wc-chip-expand-inner { overflow: hidden; }
.wc-chip-expand-body {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid rgba(26,24,22,0.06);
  font-family: var(--f-s);
  font-size: 11px;
  color: var(--ink2);
  line-height: 1.6;
}
```

### Step 4.3 — Add WC fixtures markup to `index.html`

- [ ] **Step 1: Replace the old `#fixtures-card` markup**

Find the `<!-- FIXTURES -->` markup block (around line 1274):

```html
  <!-- FIXTURES -->
  <div class="card hover-lift cup-reveal" id="fixtures-card">
    <div class="fixtures-header">
      <div class="eyebrow" style="margin-bottom:0">Fixtures · Premier League</div>
      <span class="fixtures-subtitle" id="fixtures-subtitle"></span>
    </div>
    <div class="fixtures-grid" id="fixtures-grid">
      ...skeletons...
    </div>
  </div>
```

Replace with:

```html
  <!-- WORLD CUP FIXTURES -->
  <div class="card hover-lift cup-reveal" id="wc-fixtures-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <span class="eyebrow" style="margin-bottom:0">World Cup 2026</span>
      <span id="wc-stage-label" style="font-family:var(--f-m);font-size:11px;color:var(--ink3)"></span>
    </div>
    <div id="wc-england-hero">
      <div class="skel" style="height:110px;border-radius:16px"></div>
    </div>
    <div class="wc-round-label" id="wc-round-label"></div>
    <div class="wc-scroll-wrap" id="wc-scroll-wrap">
      <div class="skel" style="width:160px;height:90px;border-radius:14px;flex-shrink:0"></div>
      <div class="skel" style="width:160px;height:90px;border-radius:14px;flex-shrink:0"></div>
      <div class="skel" style="width:160px;height:90px;border-radius:14px;flex-shrink:0"></div>
    </div>
  </div>
```

### Step 4.4 — Add `renderWorldCup()` to `index.html`

- [ ] **Step 1: Add the render function**

In `index.html`, find `function renderFixtures(fixtures)` (around line 1725) and delete the entire old `renderFixtures` function plus `toggleFixture` helper (they're replaced by the WC equivalents below).

Add these new functions in the JS block, where the old functions were:

```js
// ════════════════════════════════════════════════════════════════════
// WORLD CUP FIXTURES
// ════════════════════════════════════════════════════════════════════

// country-code → flag emoji fallback
function wcFlagEmoji(abbr) {
  if (!abbr || abbr.length !== 3) return '🏴';
  const EMOJI = {
    ENG:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',SCO:'🏴󠁧󠁢󠁳󠁣󠁴󠁿',WAL:'🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    USA:'🇺🇸',MEX:'🇲🇽',CAN:'🇨🇦',BRA:'🇧🇷',ARG:'🇦🇷',FRA:'🇫🇷',
    GER:'🇩🇪',ESP:'🇪🇸',POR:'🇵🇹',NED:'🇳🇱',BEL:'🇧🇪',ITA:'🇮🇹',
    JPN:'🇯🇵',KOR:'🇰🇷',AUS:'🇦🇺',MAR:'🇲🇦',SEN:'🇸🇳',NGA:'🇳🇬',
    URU:'🇺🇾',COL:'🇨🇴',ECU:'🇪🇨',CRC:'🇨🇷',PAN:'🇵🇦',JAM:'🇯🇲',
    SAU:'🇸🇦',IRN:'🇮🇷',QAT:'🇶🇦',AUT:'🇦🇹',SUI:'🇨🇭',HUN:'🇭🇺',
    SRB:'🇷🇸',CRO:'🇭🇷',SLO:'🇸🇮',SVK:'🇸🇰',CZE:'🇨🇿',POL:'🇵🇱',
    DEN:'🇩🇰',SWE:'🇸🇪',NOR:'🇳🇴',RSA:'🇿🇦',CMR:'🇨🇲',CIV:'🇨🇮',
    GHA:'🇬🇭',TUN:'🇹🇳',EGY:'🇪🇬',ALG:'🇩🇿',
  };
  return EMOJI[abbr] || '🏴';
}

function wcFlagHTML(url, abbr, size) {
  const s = size || 22;
  if (url) {
    return `<img class="wc-chip-flag" src="${url}" width="${s}" height="${s}" alt="${abbr}"
      onerror="this.style.display='none';this.nextSibling.style.display='flex'">
      <span class="wc-chip-flag-fb" style="display:none;width:${s}px;height:${s}px;font-size:${Math.round(s*0.65)}px">${wcFlagEmoji(abbr)}</span>`;
  }
  return `<span class="wc-chip-flag-fb" style="width:${s}px;height:${s}px;font-size:${Math.round(s*0.65)}px">${wcFlagEmoji(abbr)}</span>`;
}

let openWcChipId = null;

function toggleWcChip(id) {
  const chip   = document.getElementById(id);
  const expand = document.getElementById(id + '-exp');
  if (!chip || !expand) return;
  if (openWcChipId && openWcChipId !== id) {
    const prev    = document.getElementById(openWcChipId);
    const prevExp = document.getElementById(openWcChipId + '-exp');
    if (prev)    prev.classList.remove('is-open');
    if (prevExp) prevExp.classList.remove('open');
  }
  const isOpen = expand.classList.contains('open');
  expand.classList.toggle('open', !isOpen);
  chip.classList.toggle('is-open', !isOpen);
  openWcChipId = isOpen ? null : id;
}

function renderWorldCup(wc) {
  const heroEl   = document.getElementById('wc-england-hero');
  const scrollEl = document.getElementById('wc-scroll-wrap');
  const stageEl  = document.getElementById('wc-stage-label');
  const roundEl  = document.getElementById('wc-round-label');
  if (!heroEl || !scrollEl) return;

  const { matches = [], england, stageName = '' } = wc || {};

  if (stageEl) stageEl.textContent = stageName;
  if (roundEl) roundEl.textContent = matches.length ? `This round · ${stageName}` : '';

  // ── England hero ──────────────────────────────────────────────
  if (!england) {
    heroEl.innerHTML = `<div class="wc-england-hero" style="text-align:center;color:var(--ink3);font-size:14px;padding:24px">No England fixture found</div>`;
  } else {
    const now      = Date.now();
    const kickoff  = new Date(england.kickoff);
    const msAway   = kickoff - now;
    const hoursAway = msAway / 3_600_000;
    const hasScore  = england.homeScore !== null && england.awayScore !== null;

    let badgeClass, badgeText;
    if (england.live)           { badgeClass = 'live';     badgeText = `🔴 LIVE · ${england.matchTime || ''}`; }
    else if (england.finished)  { badgeClass = 'ft';       badgeText = 'FT'; }
    else if (hoursAway < 6)     { badgeClass = 'today';    badgeText = 'TONIGHT'; }
    else if (hoursAway < 30)    { badgeClass = 'today';    badgeText = 'TOMORROW'; }
    else                        { badgeClass = 'upcoming'; badgeText = kickoff.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }); }

    const scoreHTML = hasScore
      ? `<div class="wc-hero-score">${england.homeScore}–${england.awayScore}${england.homePens !== null ? ` (${england.homePens}–${england.awayPens} pens)` : ''}</div>`
      : `<div style="font-family:var(--f-m);font-size:13px;color:var(--ink3)">${kickoff.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · ${kickoff.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>`;

    let probHTML = '';
    if (!england.finished && england.odds?.h != null) {
      const pH = Math.round(100 / england.odds.h);
      const pD = england.odds.d ? Math.round(100 / england.odds.d) : 0;
      const pA = Math.round(100 / england.odds.a);
      const engIsHome = england.homeAbbr === 'ENG';
      const engP = engIsHome ? pH : pA;
      probHTML = `<div class="wc-hero-prob">Win probability: <span class="prob-hi">${engP}%</span> England · ${pD}% Draw · ${engIsHome ? pA : pH}% ${engIsHome ? england.away : england.home}</div>`;
    }

    heroEl.innerHTML = `
      <div class="wc-england-hero">
        <div class="wc-england-badge ${badgeClass}">${badgeText}</div>
        <div class="wc-hero-teams">
          <div>${wcFlagHTML(england.homeFlag, england.homeAbbr, 36)}</div>
          <div>
            <div class="wc-hero-team-name">${england.home}</div>
          </div>
          <div class="wc-hero-vs">vs</div>
          <div>${wcFlagHTML(england.awayFlag, england.awayAbbr, 36)}</div>
          <div>
            <div class="wc-hero-team-name">${england.away}</div>
          </div>
          <div style="margin-left:auto">${scoreHTML}</div>
        </div>
        <div class="wc-hero-meta">${england.groupName}${england.stadium ? ' · ' + england.stadium : ''}${england.city ? ', ' + england.city : ''}</div>
        ${probHTML}
      </div>`;
  }

  // ── Round scroll chips ────────────────────────────────────────
  if (!matches.length) {
    scrollEl.innerHTML = '<p style="color:var(--ink3);font-size:14px">Fixtures unavailable.</p>';
    return;
  }

  scrollEl.innerHTML = matches.map((m, i) => {
    const cid     = `wc-chip-${i}`;
    const kickoff = new Date(m.kickoff);
    const timeStr = kickoff.toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const hasScore = m.homeScore !== null && m.awayScore !== null;

    let bottomHTML;
    if (hasScore) {
      bottomHTML = `<div class="wc-chip-score">${m.homeScore}–${m.awayScore}${m.homePens !== null ? ` (${m.homePens}–${m.awayPens}p)` : ''}</div>`;
    } else if (m.odds?.h != null) {
      const favH = m.odds.h <= m.odds.a;
      bottomHTML = `<div class="wc-chip-odds">
        <span class="${favH ? 'fav-odd' : ''}">${m.odds.h.toFixed(2)}</span>
        <span>·</span>
        <span>${m.odds.d?.toFixed(2) ?? '—'}</span>
        <span>·</span>
        <span class="${!favH ? 'fav-odd' : ''}">${m.odds.a.toFixed(2)}</span>
      </div>`;
    } else {
      bottomHTML = `<div class="wc-chip-time">${timeStr}</div>`;
    }

    // Expand content
    let expandBody = `<div class="wc-chip-expand-body">`;
    expandBody += `<div>${m.groupName}</div>`;
    if (m.stadium) expandBody += `<div>${m.stadium}${m.city ? ', ' + m.city : ''}</div>`;
    expandBody += `<div>${timeStr}</div>`;
    if (!hasScore && m.odds?.h != null) {
      const pH = Math.round(100 / m.odds.h);
      const pD = m.odds.d ? Math.round(100 / m.odds.d) : 0;
      const pA = Math.round(100 / m.odds.a);
      expandBody += `<div style="margin-top:4px">Win prob: ${pH}% · ${pD}% · ${pA}%</div>`;
    }
    expandBody += `</div>`;

    return `<div class="wc-chip cup-press" id="${cid}" onclick="toggleWcChip('${cid}')">
      <div class="wc-chip-flags">
        ${wcFlagHTML(m.homeFlag, m.homeAbbr, 22)}
        <span class="wc-chip-vs">vs</span>
        ${wcFlagHTML(m.awayFlag, m.awayAbbr, 22)}
      </div>
      <div class="wc-chip-teams">${m.home} – ${m.away}</div>
      ${bottomHTML}
      <div class="wc-chip-expand" id="${cid}-exp">
        <div class="wc-chip-expand-inner">${expandBody}</div>
      </div>
    </div>`;
  }).join('');
}
```

### Step 4.5 — Wire up renderWorldCup in the page bootstrap

- [ ] **Step 1: Update the bootstrap fetch and render calls**

In `index.html`, find the page bootstrap (around line 2280):

```js
const r = await fetch('/api/data');
```

The response now includes `worldCup` instead of `fixtures`. Find and replace:

```js
renderFixtures(fixtures);
```

with:

```js
renderWorldCup(data.worldCup || {});
```

Also remove any reference to `const fixtures = ...` if it existed as a separate variable in the bootstrap.

### Step 4.6 — Verify

- [ ] **Step 1: Test the API response**

```bash
curl -s "http://localhost:3000/api/data" | python -c "
import sys, json
d = json.load(sys.stdin)
wc = d.get('worldCup', {})
print('stageName:', wc.get('stageName'))
print('matches:', len(wc.get('matches', [])))
england = wc.get('england')
print('england:', england['home'] if england else 'none', 'vs', england['away'] if england else '')
if wc.get('matches'):
    m = wc['matches'][0]
    print('first match:', m['home'], 'vs', m['away'], '|', m['kickoff'])
"
```

Expected:
- `stageName` shows a round name (e.g. "First Stage")
- `matches` count > 0
- England match identified correctly

- [ ] **Step 2: Visual check**

Open the `vercel dev` URL. Confirm:
- WC fixtures card appears in the layout (where fixtures used to be, but wider)
- England hero panel renders with team names and kickoff time
- Scrollable chips show for other matches in the round
- Tap a chip → expand shows stadium + group + kickoff
- Old "Premier League" fixtures card is gone

- [ ] **Step 3: Check responsive**

At 640px width: card goes full width, horizontal scroll still works on touch.

### Step 4.7 — Update CLAUDE.md

- [ ] **Step 1: Update the project status**

In `CLAUDE.md`, update the "In Progress" section:

```markdown
## In Progress
- **World Cup 2026** — Live fixtures section showing England's next match + current round. Uses api.fifa.com (no auth).
```

Remove or archive the old Project 7 description.

### Step 4.8 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add index.html api/data.js CLAUDE.md
git commit -m "feat: World Cup 2026 fixtures section

Replaces Premier League fixtures with WC section:
- England next match pinned as hero panel with state (live/tonight/upcoming/FT)
- Current round chips in horizontal scroll, tap-to-expand (stadium/group/odds)
- Data from api.fifa.com/api/v3 (no auth), openfootball fallback
- WC h2h odds via The Odds API soccer_fifa_world_cup sport key
- Old renderFixtures / toggleFixture removed; renderWorldCup added
- /api/data response: fixtures → worldCup with matches/england/stageName"
```

---

## Task 5: World Cup Fantasy Insights section

**Goal:** Add a new `#wc-fantasy-card` (span 4, sits next to WC fixtures) that shows top scorers, best-value players, and fixture difficulty for the next round. Uses only public no-auth JSON from `play.fifa.com/json/fantasy/`. Heavy data (1MB players.json) stays server-side via a new `/api/wc-fantasy.js` Vercel function.

**Files:**
- Create: `api/wc-fantasy.js`
- Modify: `index.html` (CSS, markup, `renderWcFantasy()` function, bootstrap fetch)

### Step 5.1 — Create `api/wc-fantasy.js`

- [ ] **Step 1: Create the file**

Create `C:/Users/I763882/studious-waddle/api/wc-fantasy.js` with:

```js
export const config = { maxDuration: 30 };

const CHECKSUMS_URL = 'https://play.fifa.com/json/fantasy/checksums.json';
const PLAYERS_URL   = 'https://play.fifa.com/json/fantasy/players.json';
const SQUADS_URL    = 'https://play.fifa.com/json/fantasy/squads.json';
const ROUNDS_URL    = 'https://play.fifa.com/json/fantasy/rounds.json';

const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const [playersRaw, squadsRaw, roundsRaw] = await Promise.all([
      fetch(PLAYERS_URL, { headers: HEADERS }).then(r => r.json()),
      fetch(SQUADS_URL,  { headers: HEADERS }).then(r => r.json()),
      fetch(ROUNDS_URL,  { headers: HEADERS }).then(r => r.json()),
    ]);

    // Normalise players — schema may vary; probe key names defensively
    const playersList = Array.isArray(playersRaw)
      ? playersRaw
      : (playersRaw.players || playersRaw.data || []);

    const squadMap = {};
    const squadsList = Array.isArray(squadsRaw)
      ? squadsRaw
      : (squadsRaw.squads || squadsRaw.teams || squadsRaw.data || []);
    for (const s of squadsList) {
      const id = s.id || s.squadId || s.teamId;
      if (id != null) squadMap[id] = {
        name:        s.name || s.teamName || s.squadName || String(id),
        abbr:        s.abbreviation || s.abbr || s.code || '',
        eliminated:  !!(s.isEliminated || s.eliminated),
      };
    }

    // Find current / next round
    const roundsList = Array.isArray(roundsRaw)
      ? roundsRaw
      : (roundsRaw.rounds || roundsRaw.data || []);
    const now = Date.now();
    const activeRound = roundsList.find(r => {
      const start = r.startDate || r.start || r.lockDate;
      const end   = r.endDate   || r.end;
      return start && end && new Date(start) <= now && now <= new Date(end);
    }) || roundsList.find(r => {
      const start = r.startDate || r.start || r.lockDate;
      return start && new Date(start) > now;
    }) || roundsList[0];
    const roundName = activeRound
      ? (activeRound.name || activeRound.roundName || activeRound.label || `Round ${activeRound.id}`)
      : 'Round 1';

    // Compute top scorers — sort by totalPoints desc, filter out eliminated squads
    const withPoints = playersList
      .map(p => {
        const squadId  = p.squadId || p.teamId || p.squad?.id;
        const squad    = squadMap[squadId] || { name: '', abbr: '', eliminated: false };
        const pts      = Number(p.totalPoints ?? p.points ?? p.score ?? 0);
        const price    = Number(p.value ?? p.price ?? p.cost ?? 0);
        const name     = p.name || p.webName || p.displayName || p.lastName || `Player ${p.id}`;
        const mins     = Number(p.minutesPlayed ?? p.minutes ?? 0);
        return { name, squad, pts, price, mins };
      })
      .filter(p => !p.squad.eliminated);

    const topScorers = [...withPoints]
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 5)
      .map(p => ({ name: p.name, squad: p.squad.abbr || p.squad.name, pts: p.pts }));

    // Best value: pts per $1m, require >0 mins and >0 price
    const bestValue = [...withPoints]
      .filter(p => p.mins > 0 && p.price > 0)
      .map(p => ({ ...p, ratio: p.pts / p.price }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .map(p => ({
        name:  p.name,
        squad: p.squad.abbr || p.squad.name,
        price: p.price,
        pts:   p.pts,
        ratio: Math.round(p.ratio * 10) / 10,
      }));

    // Pre-tournament fallback: if no one has scored yet, show most expensive players
    const preTournament = topScorers.every(p => p.pts === 0);
    const featured = preTournament
      ? [...withPoints]
          .sort((a, b) => b.price - a.price)
          .slice(0, 5)
          .map(p => ({ name: p.name, squad: p.squad.abbr || p.squad.name, pts: p.price, label: `$${p.price}m` }))
      : topScorers.map(p => ({ ...p, label: `${p.pts} pts` }));

    res.json({
      roundName,
      preTournament,
      topScorers: featured,
      bestValue,
    });
  } catch (err) {
    res.status(500).json({ error: String(err), roundName: '', topScorers: [], bestValue: [] });
  }
}
```

- [ ] **Step 2: Verify the endpoint**

Start `vercel dev` and run:

```bash
curl -s "http://localhost:3000/api/wc-fantasy" | python -c "
import sys, json
d = json.load(sys.stdin)
print('roundName:', d.get('roundName'))
print('preTournament:', d.get('preTournament'))
print('topScorers:', len(d.get('topScorers', [])))
print('bestValue:', len(d.get('bestValue', [])))
if d.get('topScorers'): print('first:', d['topScorers'][0])
"
```

Expected:
- `roundName` is a non-empty string
- `topScorers` has 5 entries
- `bestValue` has 5 entries (may be 0 pre-tournament if no minutes played yet — that's fine)
- No `error` key in response

### Step 5.2 — Add WC Fantasy CSS to `index.html`

- [ ] **Step 1: Add CSS for the new card**

In `index.html`, after the WC fixtures CSS block added in Task 4, add:

```css
/* ════════════════════════════════════════════════════════════════════
   WC FANTASY INSIGHTS
   ════════════════════════════════════════════════════════════════════ */
#wc-fantasy-card {
  padding: 22px 24px;
  grid-column: span 4;
  align-self: start;
}
.wc-fantasy-section-label {
  font-family: var(--f-s);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ink3);
  margin: 14px 0 8px;
}
.wc-fantasy-section-label:first-child { margin-top: 0; }
.wc-fantasy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--line);
  transition: background .15s, transform .15s;
  border-radius: 6px;
}
.wc-fantasy-row:last-child { border-bottom: none; }
.cup-row:hover { background: rgba(26,24,22,0.035); transform: translateX(3px); }
.wc-fantasy-rank {
  font-family: var(--f-m);
  font-size: 11px;
  color: var(--ink3);
  width: 16px;
  flex-shrink: 0;
}
.wc-fantasy-name {
  font-family: var(--f-s);
  font-size: 13px;
  color: var(--ink);
  font-weight: 500;
  flex: 1;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wc-fantasy-squad {
  font-family: var(--f-m);
  font-size: 10px;
  color: var(--ink3);
  background: rgba(26,24,22,0.05);
  padding: 2px 6px;
  border-radius: 99px;
  flex-shrink: 0;
}
.wc-fantasy-val {
  font-family: var(--f-m);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  margin-left: 8px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.wc-fantasy-val.green { color: var(--green); }
```

### Step 5.3 — Add WC Fantasy markup to `index.html`

- [ ] **Step 1: Add the card markup**

In `index.html`, find the placeholder comment `<!-- WC FANTASY INSIGHTS — added Task 5 -->` (added in Task 2) and replace it with:

```html
  <!-- WC FANTASY INSIGHTS -->
  <div class="card cup-reveal" id="wc-fantasy-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <span class="eyebrow" style="margin-bottom:0">WC Fantasy</span>
      <span id="wc-fantasy-round" style="font-family:var(--f-m);font-size:11px;color:var(--ink3)"></span>
    </div>
    <div id="wc-fantasy-body">
      <div class="skel" style="height:180px;border-radius:10px;margin-top:12px"></div>
    </div>
  </div>
```

### Step 5.4 — Add `renderWcFantasy()` to `index.html`

- [ ] **Step 1: Add the render function**

In the JS block of `index.html`, after `renderWorldCup`, add:

```js
// ════════════════════════════════════════════════════════════════════
// WC FANTASY INSIGHTS
// ════════════════════════════════════════════════════════════════════
function renderWcFantasy(data) {
  const body    = document.getElementById('wc-fantasy-body');
  const roundEl = document.getElementById('wc-fantasy-round');
  if (!body) return;

  if (!data || (!data.topScorers?.length && !data.bestValue?.length)) {
    body.innerHTML = '<p style="color:var(--ink3);font-size:13px;padding:12px 0">Fantasy data unavailable.</p>';
    return;
  }

  if (roundEl) roundEl.textContent = data.roundName || '';

  const scorerLabel = data.preTournament ? 'Most Expensive' : 'Top Scorers';
  const valLabel    = data.preTournament ? '' : 'Best Value · pts per $1m';

  let html = '';

  // Top scorers / most expensive
  html += `<div class="wc-fantasy-section-label">${scorerLabel}</div>`;
  html += (data.topScorers || []).map((p, i) => `
    <div class="wc-fantasy-row cup-row">
      <span class="wc-fantasy-rank">${i + 1}</span>
      <span class="wc-fantasy-name">${p.name}</span>
      <span class="wc-fantasy-squad">${p.squad}</span>
      <span class="wc-fantasy-val">${p.label}</span>
    </div>`).join('');

  // Best value (only meaningful post-tournament-start)
  if (!data.preTournament && data.bestValue?.length) {
    html += `<div class="wc-fantasy-section-label">${valLabel}</div>`;
    html += data.bestValue.map((p, i) => `
      <div class="wc-fantasy-row cup-row">
        <span class="wc-fantasy-rank">${i + 1}</span>
        <span class="wc-fantasy-name">${p.name}</span>
        <span class="wc-fantasy-squad">${p.squad}</span>
        <span class="wc-fantasy-val green">${p.ratio}</span>
      </div>`).join('');
  }

  body.innerHTML = html;
}
```

### Step 5.5 — Wire up the bootstrap fetch

- [ ] **Step 1: Add `/api/wc-fantasy` fetch to the page bootstrap**

In `index.html`, find the page bootstrap (around line 2275 — the main `async function init()` or equivalent that fetches `/api/data`). Add a parallel fetch for the new endpoint:

```js
// Fetch main data and WC fantasy in parallel
const [dataRes, wcFantasyRes] = await Promise.all([
  fetch('/api/data').then(r => r.json()).catch(() => ({})),
  fetch('/api/wc-fantasy').then(r => r.json()).catch(() => null),
]);
```

If the existing code looks like:
```js
const r = await fetch('/api/data');
const data = await r.json();
```

Replace with:
```js
const [data, wcFantasyData] = await Promise.all([
  fetch('/api/data').then(r => r.json()).catch(() => ({})),
  fetch('/api/wc-fantasy').then(r => r.json()).catch(() => null),
]);
```

Then in the render calls section, add:
```js
renderWcFantasy(wcFantasyData);
```

### Step 5.6 — Verify

- [ ] **Step 1: Visual check**

Open the `vercel dev` URL. Confirm:
- WC Fantasy card appears to the right of WC fixtures
- Shows "WC Fantasy" eyebrow + round label
- Lists top 5 scorers (or most expensive players if pre-tournament)
- Best value section appears (or is hidden pre-tournament)
- Card height is roughly similar to the WC fixtures card — no obvious gap

- [ ] **Step 2: Check error state**

Temporarily break the fetch URL in the browser console:
```js
fetch('/api/wc-fantasy-broken').catch(() => null)
```

Then manually call `renderWcFantasy(null)` in the console. Expected: fallback message renders, card doesn't collapse.

### Step 5.7 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add api/wc-fantasy.js index.html
git commit -m "feat: World Cup Fantasy Insights section

New /api/wc-fantasy.js Vercel function (1h cache) fetches
play.fifa.com public JSON, computes top scorers + best value.
Pre-tournament fallback shows most expensive players.
New #wc-fantasy-card renders next to WC fixtures (span 4)."
```

---

## Task 6: Google Calendar section

**Goal:** Add a `#calendar-card` (span 5, sits left of Portfolio) that shows up to 4 upcoming events as friendly natural-language sentences. Rule-based classification: holidays/flights/birthdays/appointments get specific phrasing; everything else gets a clean date label. Blocked on user providing Google OAuth credentials.

**Pre-requisites (user action required):**
1. Go to [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the Calendar API.
2. Create OAuth credentials → Desktop app type → download client secret JSON.
3. Go to [OAuth Playground](https://developers.google.com/oauthplayground), gear icon → use your own credentials, enter Client ID + Secret.
4. In Step 1, select scope `https://www.googleapis.com/auth/calendar.readonly`, authorise with your Google account.
5. In Step 2, exchange auth code for tokens → copy the **Refresh token**.
6. Add three Vercel environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`

**Files:**
- Modify: `api/data.js` (add calendar fetch)
- Modify: `index.html` (CSS, markup, `renderCalendar()`)

### Step 6.1 — Add calendar fetch to `api/data.js`

- [ ] **Step 1: Add the `fetchCalendar()` helper function**

In `api/data.js`, after the `fetchWcOdds()` function, add:

```js
async function fetchCalendar() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return [];

  try {
    // Exchange refresh token for access token
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
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${cutoff}&singleEvents=true&orderBy=startTime&maxResults=20`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const calData = await calRes.json();
    return (calData.items || []).map(ev => ({
      title:   ev.summary || 'Untitled',
      start:   ev.start?.dateTime || ev.start?.date || null,
      allDay:  !ev.start?.dateTime,
      multiDay: ev.start?.date && ev.end?.date &&
                ev.end.date !== ev.start.date &&
                new Date(ev.end.date) - new Date(ev.start.date) > 86400000,
    }));
  } catch (_) { return []; }
}
```

- [ ] **Step 2: Add `fetchCalendar()` to the main `Promise.all`**

In `api/data.js`, find the main `Promise.all` destructuring:

```js
const [priceEntries, newsEntries, wcResult, oddsMap] = await Promise.all([
```

Add calendar to the end:

```js
const [priceEntries, newsEntries, wcResult, oddsMap, calendarEvents] = await Promise.all([
  ...existing entries...,
  fetchCalendar(),
]);
```

- [ ] **Step 3: Add `calendar` to `res.json()`**

Find the final `res.json({...})` call. Add:

```js
calendar: calendarEvents,
```

alongside the existing keys (`prices`, `news`, `worldCup`, `golf`).

### Step 6.2 — Add friendly-sentence helper to `api/data.js`

- [ ] **Step 1: Add `friendlySentence()` helper**

In `api/data.js`, after `fetchCalendar()`, add:

```js
function friendlySentence(title, startIso, allDay, multiDay) {
  const start = new Date(startIso);
  const now   = new Date();
  const msAway = start - now;
  const daysAway = Math.round(msAway / 86400000);

  // Relative date label
  let when;
  if (daysAway <= 0)       when = 'today';
  else if (daysAway === 1) when = 'tomorrow';
  else if (daysAway < 14)  when = `in ${daysAway} days`;
  else                     when = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: daysAway > 300 ? 'numeric' : undefined });

  const t = title.toLowerCase();

  // Flight / holiday abroad
  if (/\bfl(y|ight|ights)\b|departure|\barriv/.test(t)) {
    const loc = title.match(/to\s+([A-Z][a-zA-ZÀ-ÿ\s]+)/)?.[1]?.trim();
    return { emoji: '✈️', text: loc ? `You fly off to ${loc} ${when}!` : `Flight ${when}!` };
  }
  // Known locations (extend as needed)
  const PLACES = ['majorca','mallorca','ibiza','tenerife','lanzarote','marbella','barcelona',
    'madrid','paris','rome','amsterdam','lisbon','dubai','new york','los angeles','thailand',
    'bali','japan','australia','florida','miami','vegas','las vegas','mexico','cancun'];
  if (PLACES.some(p => t.includes(p))) {
    const place = title.replace(/holiday|trip|vacation/gi, '').trim();
    return { emoji: '☀️', text: `You head off to ${place} ${when}!` };
  }
  // Holiday / vacation (multi-day)
  if (multiDay || /holiday|vacation|annual leave|day off|off work/.test(t)) {
    return { emoji: '🏖️', text: `Holiday: ${title} starts ${when}.` };
  }
  // Birthday
  const bdayMatch = title.match(/(.+?)(?:'s)?\s*birthday/i);
  if (bdayMatch) {
    return { emoji: '🎂', text: `${bdayMatch[1].trim()}'s birthday ${when}.` };
  }
  // Driving test / MOT / medical
  if (/driving test/.test(t))       return { emoji: '🚗', text: `Driving test ${when}.` };
  if (/\bmot\b/.test(t))            return { emoji: '🔧', text: `MOT ${when}.` };
  if (/dentist|dental/.test(t))     return { emoji: '🦷', text: `Dentist ${when}.` };
  if (/doctor|gp\b|appointment/.test(t)) return { emoji: '🏥', text: `${title} ${when}.` };
  // Default
  return { emoji: '📅', text: `${title} · ${when}` };
}
```

- [ ] **Step 2: Apply `friendlySentence()` to each calendar event before sending**

Replace the `calendarEvents` mapping in `res.json` so events arrive pre-processed:

In `fetchCalendar()`, change the final `.map()` to include the friendly sentence:

```js
return (calData.items || []).map(ev => {
  const startIso = ev.start?.dateTime || ev.start?.date || null;
  const allDay   = !ev.start?.dateTime;
  const multiDay = ev.start?.date && ev.end?.date &&
                   ev.end.date !== ev.start.date &&
                   new Date(ev.end.date) - new Date(ev.start.date) > 86400000;
  const { emoji, text } = friendlySentence(ev.summary || 'Untitled', startIso, allDay, multiDay);
  return { title: ev.summary || 'Untitled', startIso, emoji, text };
});
```

### Step 6.3 — Add Calendar CSS to `index.html`

- [ ] **Step 1: Add the CSS**

In `index.html`, after the WC Fantasy CSS block, add:

```css
/* ════════════════════════════════════════════════════════════════════
   CALENDAR
   ════════════════════════════════════════════════════════════════════ */
#calendar-card {
  padding: 22px 24px;
  grid-column: span 5;
  align-self: start;
}
.cal-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  transition: padding-left .18s;
}
.cal-item:last-child { border-bottom: none; }
.cal-item:hover { padding-left: 6px; }
.cal-emoji {
  font-size: 18px;
  line-height: 1.4;
  flex-shrink: 0;
}
.cal-text {
  font-family: var(--f-s);
  font-size: 14px;
  color: var(--ink);
  line-height: 1.5;
}
.cal-empty {
  font-family: var(--f-s);
  font-size: 14px;
  color: var(--ink3);
  padding: 12px 0;
}
```

### Step 6.4 — Add Calendar markup to `index.html`

- [ ] **Step 1: Replace the `<!-- CALENDAR — added Task 6 -->` placeholder**

Find the placeholder comment added in Task 2 and replace with:

```html
  <!-- CALENDAR -->
  <div class="card cup-reveal" id="calendar-card">
    <div class="eyebrow">Upcoming</div>
    <div id="calendar-body">
      <div class="skel" style="height:24px;border-radius:6px;margin-bottom:10px"></div>
      <div class="skel" style="height:24px;border-radius:6px;margin-bottom:10px"></div>
      <div class="skel" style="height:24px;border-radius:6px"></div>
    </div>
  </div>
```

### Step 6.5 — Add `renderCalendar()` to `index.html`

- [ ] **Step 1: Add the render function**

In the JS block, after `renderWcFantasy`, add:

```js
// ════════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════════
function renderCalendar(events) {
  const el = document.getElementById('calendar-body');
  if (!el) return;

  if (!events || !events.length) {
    el.innerHTML = '<p class="cal-empty">Nothing on your calendar for the next 3 months.</p>';
    return;
  }

  el.innerHTML = events.slice(0, 4).map(ev =>
    `<div class="cal-item cup-row">
      <span class="cal-emoji">${ev.emoji}</span>
      <span class="cal-text">${ev.text}</span>
    </div>`
  ).join('');
}
```

- [ ] **Step 2: Wire into the bootstrap**

In the page bootstrap render calls, add:

```js
renderCalendar(data.calendar || []);
```

### Step 6.6 — Verify

- [ ] **Step 1: Test the API without credentials**

Before adding real credentials, confirm the endpoint degrades gracefully:

```bash
curl -s "http://localhost:3000/api/data" | python -c "
import sys, json
d = json.load(sys.stdin)
print('calendar:', d.get('calendar'))
"
```

Expected: `calendar: []` (empty array when env vars missing, no error).

- [ ] **Step 2: Test with real credentials**

Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` to `.env.local` (for local dev) or Vercel dashboard. Re-run the curl above. Expected: array of events with `emoji`, `text`, `title`, `startIso` fields.

- [ ] **Step 3: Visual check**

Open the `vercel dev` URL. Confirm:
- Calendar card appears left of Portfolio strip
- Shows up to 4 events with emoji + friendly sentence
- "Upcoming" eyebrow at top
- Empty state shows if no events found
- Hover on an item nudges it right (`.cal-item:hover` effect)

### Step 6.7 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add api/data.js index.html
git commit -m "feat: Google Calendar 'Upcoming' section

Fetches primary calendar events via Google Calendar API v3 using
OAuth refresh token from Vercel env vars. Rule-based friendlySentence()
classifies events: flights/holidays/birthdays/appointments get specific
phrasing; default shows title + relative date. Up to 4 events, 90-day
window. Gracefully returns [] when credentials not set."
```

---

## Task 7: Spotify section

**Goal:** Add a `#spotify-card` (span 4, sits right of Headlines) showing now-playing track with album art, top track of the last 4 weeks, and top artist of the last 4 weeks. Polls `/api/spotify` every 30s so now-playing stays current. Blocked on user providing Spotify OAuth credentials.

**Pre-requisites (user action required):**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an app.
2. Note the **Client ID** and **Client Secret**.
3. Add a redirect URI — `http://localhost:8888/callback` is fine (it won't actually be called).
4. Use the [Spotify OAuth Playground](https://accounts.spotify.com/authorize) or run this one-liner in a terminal to get an auth code (replace `CLIENT_ID`):
   ```
   open "https://accounts.spotify.com/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost:8888/callback&scope=user-read-currently-playing%20user-read-recently-played%20user-top-read"
   ```
   You'll be redirected to `http://localhost:8888/callback?code=XXXX` — copy the `code` value.
5. Exchange it for a refresh token (replace `CLIENT_ID`, `CLIENT_SECRET`, `CODE`):
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&code=CODE&redirect_uri=http://localhost:8888/callback" \
     -u "CLIENT_ID:CLIENT_SECRET"
   ```
   Copy the `refresh_token` from the response.
6. Add three Vercel environment variables:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REFRESH_TOKEN`

**Files:**
- Create: `api/spotify.js`
- Modify: `index.html` (CSS, markup, `renderSpotify()`, 30s polling)

### Step 7.1 — Create `api/spotify.js`

- [ ] **Step 1: Create the file**

Create `C:/Users/I763882/studious-waddle/api/spotify.js` with:

```js
export const config = { maxDuration: 10 };

let cachedAccessToken = null;
let tokenExpiresAt    = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const { access_token, expires_in } = await r.json();
  if (!access_token) return null;
  cachedAccessToken = access_token;
  tokenExpiresAt    = Date.now() + (expires_in || 3600) * 1000;
  return access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // No server-side cache — page polls every 30s to get live now-playing state
  res.setHeader('Cache-Control', 'no-store');

  const token = await getAccessToken();
  if (!token) {
    return res.json({ error: 'Spotify credentials not configured', nowPlaying: null, topTrack: null, topArtist: null });
  }

  const headers = { Authorization: `Bearer ${token}` };

  const [nowRes, recentRes, topTrackRes, topArtistRes] = await Promise.all([
    fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers }),
    fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', { headers }),
    fetch('https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=1', { headers }),
    fetch('https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=1', { headers }),
  ]);

  // Now playing (204 = nothing playing)
  let nowPlaying = null;
  if (nowRes.status === 200) {
    try {
      const d = await nowRes.json();
      if (d?.item) {
        nowPlaying = {
          name:     d.item.name,
          artist:   d.item.artists?.map(a => a.name).join(', ') || '',
          album:    d.item.album?.name || '',
          art:      d.item.album?.images?.[1]?.url || d.item.album?.images?.[0]?.url || '',
          url:      d.item.external_urls?.spotify || '',
          isPlaying: d.is_playing,
        };
      }
    } catch (_) {}
  }

  // Recently played fallback
  let recentTrack = null;
  if (!nowPlaying && recentRes.status === 200) {
    try {
      const d = await recentRes.json();
      const t = d?.items?.[0]?.track;
      const playedAt = d?.items?.[0]?.played_at;
      if (t) {
        const minsAgo = playedAt ? Math.round((Date.now() - new Date(playedAt)) / 60000) : null;
        recentTrack = {
          name:    t.name,
          artist:  t.artists?.map(a => a.name).join(', ') || '',
          album:   t.album?.name || '',
          art:     t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
          url:     t.external_urls?.spotify || '',
          minsAgo,
        };
      }
    } catch (_) {}
  }

  // Top track
  let topTrack = null;
  if (topTrackRes.status === 200) {
    try {
      const d = await topTrackRes.json();
      const t = d?.items?.[0];
      if (t) topTrack = {
        name:   t.name,
        artist: t.artists?.map(a => a.name).join(', ') || '',
        art:    t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '',
        url:    t.external_urls?.spotify || '',
      };
    } catch (_) {}
  }

  // Top artist
  let topArtist = null;
  if (topArtistRes.status === 200) {
    try {
      const d = await topArtistRes.json();
      const a = d?.items?.[0];
      if (a) topArtist = {
        name:   a.name,
        genre:  a.genres?.[0] || '',
        art:    a.images?.[1]?.url || a.images?.[0]?.url || '',
        url:    a.external_urls?.spotify || '',
      };
    } catch (_) {}
  }

  res.json({ nowPlaying, recentTrack, topTrack, topArtist });
}
```

- [ ] **Step 2: Verify the endpoint without credentials**

```bash
curl -s "http://localhost:3000/api/spotify" | python -c "
import sys, json
d = json.load(sys.stdin)
print('error?', d.get('error'))
print('nowPlaying:', d.get('nowPlaying'))
print('topTrack:', d.get('topTrack'))
print('topArtist:', d.get('topArtist'))
"
```

Expected when credentials not set: `error: Spotify credentials not configured`, all other fields `None`. No 500 error.

### Step 7.2 — Add Spotify CSS to `index.html`

- [ ] **Step 1: Add the CSS**

In `index.html`, after the Calendar CSS block, add:

```css
/* ════════════════════════════════════════════════════════════════════
   SPOTIFY
   ════════════════════════════════════════════════════════════════════ */
#spotify-card {
  padding: 22px 24px;
  grid-column: span 4;
  align-self: stretch;
}
.sp-section-label {
  font-family: var(--f-m);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ink3);
  margin-bottom: 10px;
}
.sp-live-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--green);
  margin-right: 5px;
  animation: cup-pulse 1.8s ease-in-out infinite;
}
.sp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
  transition: opacity .18s;
  padding: 2px 0;
}
.sp-row:hover { opacity: 0.78; }
.sp-art {
  width: 48px; height: 48px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: rgba(26,24,22,0.06);
}
.sp-art-sm {
  width: 38px; height: 38px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: rgba(26,24,22,0.06);
}
.sp-info { flex: 1; min-width: 0; }
.sp-title {
  font-family: var(--f-s);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-title.sm { font-size: 13px; }
.sp-sub {
  font-family: var(--f-s);
  font-size: 12px;
  color: var(--ink2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.sp-divider {
  border: none;
  border-top: 1px solid var(--line);
  margin: 12px 0;
}
.sp-unavailable {
  font-family: var(--f-s);
  font-size: 13px;
  color: var(--ink3);
  padding: 8px 0;
}
```

### Step 7.3 — Add Spotify markup to `index.html`

- [ ] **Step 1: Replace the `<!-- SPOTIFY — added Task 7 -->` placeholder**

Find the placeholder comment added in Task 2 and replace with:

```html
  <!-- SPOTIFY -->
  <div class="card cup-reveal" id="spotify-card">
    <div class="eyebrow">Listening</div>
    <div id="spotify-body">
      <div class="skel" style="height:64px;border-radius:10px"></div>
    </div>
  </div>
```

### Step 7.4 — Add `renderSpotify()` to `index.html`

- [ ] **Step 1: Add the render function**

In the JS block, after `renderCalendar`, add:

```js
// ════════════════════════════════════════════════════════════════════
// SPOTIFY
// ════════════════════════════════════════════════════════════════════
function renderSpotify(data) {
  const el = document.getElementById('spotify-body');
  if (!el) return;

  if (!data || data.error) {
    el.innerHTML = '<p class="sp-unavailable">Spotify unavailable.</p>';
    return;
  }

  const { nowPlaying, recentTrack, topTrack, topArtist } = data;
  let html = '';

  // ── Now playing / recently played ──────────────────────────────
  const current = nowPlaying || recentTrack;
  if (current) {
    const isLive = !!nowPlaying?.isPlaying;
    const labelHTML = isLive
      ? `<span class="sp-section-label"><span class="sp-live-dot"></span>Now Playing</span>`
      : `<span class="sp-section-label">Recently Played${recentTrack?.minsAgo != null ? ` · ${recentTrack.minsAgo}m ago` : ''}</span>`;

    html += labelHTML;
    html += `<a class="sp-row" href="${current.url || '#'}" target="_blank" rel="noopener">
      <img class="sp-art" src="${current.art}" alt="" onerror="this.style.opacity=0">
      <div class="sp-info">
        <div class="sp-title">${current.name}</div>
        <div class="sp-sub">${current.artist}${current.album ? ' · ' + current.album : ''}</div>
      </div>
    </a>`;
  }

  // ── Top track ─────────────────────────────────────────────────
  if (topTrack) {
    html += `<hr class="sp-divider">
    <div class="sp-section-label">Top Track · 4 Weeks</div>
    <a class="sp-row" href="${topTrack.url || '#'}" target="_blank" rel="noopener">
      <img class="sp-art-sm" src="${topTrack.art}" alt="" onerror="this.style.opacity=0">
      <div class="sp-info">
        <div class="sp-title sm">${topTrack.name}</div>
        <div class="sp-sub">${topTrack.artist}</div>
      </div>
    </a>`;
  }

  // ── Top artist ────────────────────────────────────────────────
  if (topArtist) {
    html += `<hr class="sp-divider">
    <div class="sp-section-label">Top Artist · 4 Weeks</div>
    <a class="sp-row" href="${topArtist.url || '#'}" target="_blank" rel="noopener">
      <img class="sp-art-sm" src="${topArtist.art}" alt="" onerror="this.style.opacity=0">
      <div class="sp-info">
        <div class="sp-title sm">${topArtist.name}</div>
        <div class="sp-sub">${topArtist.genre}</div>
      </div>
    </a>`;
  }

  if (!html) {
    el.innerHTML = '<p class="sp-unavailable">No Spotify data yet.</p>';
    return;
  }

  el.innerHTML = html;
}
```

### Step 7.5 — Wire up polling in the bootstrap

- [ ] **Step 1: Add initial fetch + 30s poll**

In the page bootstrap, add after the main data fetch and render calls:

```js
// Spotify: initial fetch + poll every 30s
async function fetchAndRenderSpotify() {
  try {
    const sp = await fetch('/api/spotify').then(r => r.json());
    renderSpotify(sp);
  } catch (_) {
    renderSpotify(null);
  }
}
fetchAndRenderSpotify();
setInterval(fetchAndRenderSpotify, 30_000);
```

This is separate from the main `/api/data` fetch — it runs independently and keeps the now-playing block live.

### Step 7.6 — Verify

- [ ] **Step 1: Visual check without credentials**

Open the `vercel dev` URL. Confirm:
- Spotify card appears to the right of Headlines
- Shows "Spotify unavailable." message (expected without credentials)
- Card retains its slot — no layout collapse

- [ ] **Step 2: Visual check with credentials**

Add credentials to `.env.local` (or Vercel dashboard), restart `vercel dev`. Open the page. Confirm:
- Now Playing / Recently Played section shows with album art
- Top Track shows with smaller art
- Top Artist shows with smaller art
- Clicking any row opens Spotify in a new tab
- After 30 seconds, the now-playing block auto-refreshes (start/stop a track in Spotify to test)

- [ ] **Step 3: Check the live dot animation**

When a track is actually playing, the section label shows a green pulsing dot before "Now Playing". Confirm the dot animates (uses the existing `cup-pulse` keyframe).

### Step 7.7 — Commit

- [ ] **Step 1: Commit**

```bash
cd C:/Users/I763882/studious-waddle
git add api/spotify.js index.html
git commit -m "feat: Spotify 'Listening' section

New /api/spotify.js Vercel function: now playing (or recently played
fallback), top track + top artist over 4 weeks. OAuth refresh token
flow with in-process access token cache (~50min TTL).
Page polls /api/spotify every 30s to keep now-playing live.
New #spotify-card (span 4) sits right of Headlines card."
```

---

## Self-review

### 1. Spec coverage check

| Spec requirement | Covered by |
|---|---|
| Remove FPL | Task 1 |
| Companies/ticker drift fix | Task 1 |
| US 500 ratio hack | Task 1 |
| Stale hero CSS sweep | Task 1 |
| 12-column mosaic layout | Task 2 |
| Responsive breakpoints | Task 2 |
| AI feed → TechCrunch + Verge | Task 3 |
| Football tab replaces Premier League | Task 3 |
| Multi-source feed dedup + date sort | Task 3 |
| England hero panel (all 6 states) | Task 4 |
| Round chips horizontal scroll | Task 4 |
| Tap-to-expand (stadium/group/odds/prob) | Task 4 |
| api.fifa.com primary + openfootball fallback | Task 4 |
| WC odds via soccer_fifa_world_cup | Task 4 |
| `/api/data` response: fixtures → worldCup | Task 4 |
| `/api/wc-fantasy.js` separate function | Task 5 |
| Top scorers list | Task 5 |
| Best value (pts/$1m) | Task 5 |
| Pre-tournament fallback (most expensive) | Task 5 |
| Eliminated-squad filtering | Task 5 |
| 1h cache for fantasy data | Task 5 |
| Google Calendar fetch with OAuth refresh | Task 6 |
| `friendlySentence()` rule-based classifier | Task 6 |
| Up to 4 events, 90-day window | Task 6 |
| Empty state when no events | Task 6 |
| Graceful degradation (no credentials) | Task 6 |
| Spotify now playing + recently played fallback | Task 7 |
| Top track + top artist (4-week, short_term) | Task 7 |
| 30s poll for live now-playing | Task 7 |
| In-process access token cache | Task 7 |
| Click through to Spotify URLs | Task 7 |
| Spotify graceful degradation | Task 7 |
| Mobile single-column stack | Task 2 |
| Error isolation (per-section try/catch) | Tasks 4, 5, 6, 7 |

No spec requirements without a task.

### 2. Placeholder scan

No TBD, TODO, or "implement later" patterns. All code blocks are complete. The one intentional open item ("Surface US 500 ticker result to user before changing") is a deliberate human checkpoint, not a placeholder.

### 3. Type/name consistency check

- `wcResult` destructured from `Promise.all` in Task 4 and referenced as `wcResult.matches`, `wcResult.england`, `wcResult.stageName` — consistent.
- `renderWorldCup(data.worldCup)` called in bootstrap — `data.worldCup` is set in `res.json()` in Task 4 — consistent.
- `renderWcFantasy(wcFantasyData)` — `wcFantasyData` comes from `fetch('/api/wc-fantasy')` — consistent with Task 5's response shape `{ roundName, preTournament, topScorers, bestValue }`.
- `renderCalendar(data.calendar)` — `data.calendar` set in `res.json()` in Task 6 — consistent.
- `renderSpotify(sp)` — `sp` comes from `fetch('/api/spotify')` — consistent with Task 7's response shape `{ nowPlaying, recentTrack, topTrack, topArtist }`.
- `toggleWcChip(id)` defined and called — consistent.
- `wcFlagHTML(url, abbr, size)` defined and called with 2 or 3 args — consistent (size defaults).
- `friendlySentence()` defined in `api/data.js` and applied inside `fetchCalendar()` mapping — consistent.


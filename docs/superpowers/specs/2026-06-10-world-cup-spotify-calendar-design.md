# World Cup, Spotify, Calendar, Headlines refresh — design

**Date:** 2026-06-10
**Status:** Approved, ready for implementation plan
**Context:** World Cup 2026 starts 11 June. Adding World Cup fixtures + fantasy insights, Spotify "now playing" panel, Google Calendar friendly upcoming sentences, and fixing stale AI headlines. Replacing the FPL section (off-season) and Premier League fixtures (off-season). Restructuring page to a mosaic layout.

## Goals

1. Ship a usable World Cup fixtures section before kickoff tomorrow.
2. Add Spotify and Google Calendar sections that the user authenticates once and forgets.
3. Replace stale VentureBeat AI feed with current TechCrunch + Verge AI sources.
4. Replace Premier League content (out of season) with World Cup content. Restore PL when 2026/27 season starts.
5. Restructure the page into a mosaic layout — no big empty rows, varied block sizes on desktop, clean stack on mobile.
6. Hard rule: **fully automated**. No manual data entry anywhere. Sections that need credentials use OAuth refresh tokens stored as Vercel env vars, set up once.

## Non-goals

- Personal FIFA Fantasy team data (picks, score, captain). Recon confirmed no public API and the authenticated path is Akamai-gated. Skipped entirely; replaced with public-data fantasy insights.
- LLM summarisation of any section. Calendar friendly sentences use rule-based templates.
- Push notifications, real-time websockets, service workers — kept as static-ish page that refetches on load.
- Live in-match score push. Polling on page load + a 30s Spotify poll is sufficient.

## Architecture summary

The dashboard remains a static `index.html` calling Vercel serverless functions for data. New work adds:

- **`api/data.js` extensions**: World Cup fixtures (FIFA), AI/Football headlines feed swap, Google Calendar fetch, ticker map alignment.
- **`api/wc-fantasy.js`** (new): separate function for the ~1MB FIFA Fantasy public JSON, cached with longer TTL than the main `/api/data`.
- **`api/spotify.js`** (new): independent Spotify endpoint, polled every 30s by the page (separate from `/api/data` which fetches once on load).
- **No persistent storage**. Everything is fetched fresh per request, with response caching via Vercel's `s-maxage`.

Three new Vercel env vars sets needed (user provides via OAuth setup):
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

## Page layout (desktop, 12-column grid)

```
┌─────────────────────────────────────────────────────────────────────┐
│ HERO (greeting · date · weather panel right)            span 12     │
│  unchanged from current                                             │
├──────────────────────────────────────────────┬──────────────────────┤
│ HEADLINES (World · Football · Tech · AI)     │ SPOTIFY              │
│  span 8                                      │  span 4 — brick      │
│  carousel · ~280px tall                      │  now playing + art   │
├──────────────────────────┬───────────────────┴──────────────────────┤
│ CALENDAR                 │ PORTFOLIO STRIP                          │
│  span 5                  │  span 7 — 3 fund chips + total           │
├──────────────────────────┴───────┬──────────────────────────────────┤
│ WORLD CUP — England hero +       │ WC FANTASY INSIGHTS              │
│  scrollable round fixtures       │  top scorers · value picks       │
│  span 8                          │  span 4                          │
├──────────────────────────────────┴──────────────────────────────────┤
│ COMPANIES (carousel)                                    span 12     │
├──────────────────────────┬──────────────────────────────────────────┤
│ MARKETS                  │ GOLF                                     │
│  span 7 — 6 tiles 3×2    │  span 5                                  │
└──────────────────────────┴──────────────────────────────────────────┘
```

Mobile (≤768px) collapses to single column in the same logical order:

```
Hero → Headlines → Spotify → Calendar → Portfolio
→ World Cup → WC Fantasy → Companies → Markets → Golf
```

### Empty-space defense (row-by-row)

CSS Grid `align-items: stretch` is the default and prevents notching, but each pair is also content-balanced:

| Row | Left | Right | Balancing technique |
|---|---|---|---|
| 2 | Headlines (carousel ~280px) | Spotify (~280px) | Spotify uses `align-self: stretch`. Natural height match. |
| 3 | Calendar (max 4 items) | Portfolio (fixed: 3 chips + total) | Calendar bounded to 4 items. |
| 4 | WC fixtures (England hero + chips) | WC Fantasy (top 5 + 5) | Both list-shaped, similar growth. WC Fantasy gets internal scroll if needed. |
| 6 | Markets (3×2 fixed) | Golf (fixed) | Both fixed-content. |

Cards that are shorter than their row use `align-self: start` so they sit at the top of the row rather than stretching with internal whitespace; the row gets a clean bottom edge instead.

## Section 1 — Cleanup pass (pre-feature commit)

**Scope:** one focused commit before any new sections.

1. Remove FPL render code from `index.html`: `renderFPL()`, pitch CSS, club color map, shirt URL helpers, `#fpl-card` markup, the FPL data flow in the page bootstrap.
2. Remove FPL fetching from `api/data.js`: the `fplTeam` IIFE, `FPL_TEAM_ID` constant.
3. Fix companies/ticker drift: align `api/data.js` `TICKERS` map with `index.html` `CO_NAMES` list. Companies in the UI are the source of truth. Companies without public tickers (Figure AI, Physical Intelligence, Cursor, etc.) render without a price chip — the renderer must handle missing-ticker gracefully (no chip, no "—" placeholder).
4. US 500 ratio hack: search for the correct Yahoo ticker for "Vanguard U.S. 500 Stock Index Fund USD Acc". If a public ticker exists, swap to it and delete the `_US500_RATIO = 58.2` calibration. If not, accept VUSA.L as the proxy and remove only the calibration math (% change is already accurate; only unit price would drift). The result is surfaced before the change is committed.
5. Sweep stale `.hero-right` references and any merge-conflict CSS leftovers in the hero block.

This commit is a no-feature-change refactor. Visual output of the page should be unchanged except for the FPL section disappearing.

## Section 2 — World Cup fixtures section (span 8)

### Data source

Primary: `https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=200&language=en`

No auth, no key. Fetched server-side from `api/data.js`. 5-minute cache via existing `s-maxage=300` header.

Fallback: `https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json` if FIFA endpoint fails. Schema is different (date/time strings, ISO-3 country names) — implementation must normalise both shapes to the same internal record.

### Two-zone layout inside the section

```
┌─────────────────────────────────────────────────┐
│ ENGLAND'S NEXT MATCH (or "LIVE NOW" if playing) │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🦁 ENG vs USA                               │ │
│ │ Sat 14 Jun · 20:00 · Group F                │ │
│ │ Mercedes-Benz Stadium, Atlanta              │ │
│ │ Win prob: 52% · 28% · 20%  (if odds avail)  │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ THIS ROUND ▸ Group Stage · Matchday 1           │
│                                                 │
│ ◀ horizontal scroll ────────────────────────▶  │
│ [chip][chip][chip][chip][chip][chip][chip]…    │
└─────────────────────────────────────────────────┘
```

### England hero panel — pinned at top

State machine:
- **Pre-match, kickoff in <24h**: "TONIGHT" or "TOMORROW" badge, full match details.
- **Pre-match, >24h away**: standard match details, day/date/time pinned.
- **Live**: "LIVE · 67'" badge, current score, scorer list lazily fetched on tap.
- **Just finished (<6h)**: "FT 2–1" with score and brief stat.
- **No upcoming match (eliminated)**: "ENGLAND ELIMINATED" tombstone. Promote next biggest fixture (Brazil, Argentina, France, Germany, Spain, Portugal, Netherlands, Italy in priority order) to the hero slot using a prestige map.
- **Tournament not started yet**: "Kickoff: tomorrow at 19:00 UTC" countdown card until first match.

### Round chips below

Horizontal scroll, all matches in the current round.

Round detection logic:
- During group stage: walk fixtures, find the matchday containing today (or the soonest unfinished match). Show all fixtures with that matchday number.
- During knockouts: detect by `IdStage`. Show all fixtures in the same stage (R32, R16, QF, SF, Final).

Each chip mirrors the existing `.fixture-chip` pattern: flags, teams, time, score-or-odds, tap-to-expand.

### Tap-to-expand contents

- **Pre-match**: stadium name, city, group label, kickoff in user's local TZ (Europe/London — matches existing date formatting).
- **Live**: current score, match minute, recent goal scorers — lazily fetched from `https://api.fifa.com/api/v3/timelines/17/285023/{IdStage}/{IdMatch}` on tap so we don't pull all timelines upfront.
- **Finished**: full-time score with optional ET/penalty notation, full scorer list, stadium.

### Odds

Add a second `fetchOdds()` call to the existing The Odds API integration with sport key `soccer_fifa_world_cup`. Odds available only for matches with confirmed teams (group stage and locked knockout brackets). Placeholder fixtures ("Winner Group A vs Runner-up Group B") have no odds and the row hides.

### Flag images

FIFA returns `PictureUrl: "https://api.fifa.com/api/v3/picture/flags-{format}-{size}/MEX"`. Substitute `{format}=png` and `{size}=4` (~64px) at render time. Fallback to flag-emoji from country code if image fails.

### Empty/error states

- FIFA API down → fall back to openfootball JSON. Less detail (no live state, no FIFA team IDs) but schedule renders.
- Both down → "Fixtures unavailable" banner, matches existing pattern.

## Section 3 — World Cup Fantasy Insights (span 4)

### Data sources

All public no-auth JSON from `https://play.fifa.com/json/fantasy/`:
- `players.json` (~1MB): full player DB with prices, club, role, points
- `squads.json`: 32 nations with `isEliminated` flag
- `rounds.json`: schedule + current round
- `checksums.json`: version hashes for cache busting

### New function: `api/wc-fantasy.js`

Separate Vercel function from `/api/data`. Reasons:
1. The 1MB players.json should not slow down the main page bootstrap.
2. Fantasy data only changes between rounds — different cache TTL than markets/news/fixtures.

Cache strategy:
- Fetch `checksums.json` first; if checksums match the last cached version, return cached response immediately.
- On checksum change, refetch full dataset, compute the rendered metrics (top scorers, value picks, fixture difficulty), return only the trimmed subset to the page.
- TTL: 1 hour for the response cache.

The function returns a small JSON shape (~5KB) — the heavy 1MB stays server-side.

### Section content (in span-4 slot next to fixtures)

```
┌────────────────────────────────────┐
│ WC FANTASY · ROUND 1               │
├────────────────────────────────────┤
│ TOP SCORERS                        │
│ 1. Kane (ENG)        · 18 pts     │
│ 2. Mbappé (FRA)      · 15 pts     │
│ 3. Vinícius (BRA)    · 14 pts     │
│ 4. Bellingham (ENG)  · 13 pts     │
│ 5. Lautaro (ARG)     · 12 pts     │
├────────────────────────────────────┤
│ BEST VALUE · pts per $1m           │
│ 1. Saliba (FRA)   $5m  · 2.4      │
│ 2. ... (4 more)                    │
├────────────────────────────────────┤
│ NEXT ROUND TOP FIXTURES            │
│ FRA vs CRO  ★★★★ favorable        │
│ ENG vs USA  ★★★  balanced         │
└────────────────────────────────────┘
```

Static stack, no rotation — small section, all three blocks fit.

### Computed metrics

- **Top scorers**: sort all players by `total_points` (or current-round points if available). Top 5.
- **Best value**: `total_points / price` for players with >0 minutes. Top 5.
- **Fixture difficulty**: for next round, rank fixtures by aggregate FIFA ranking + a simple "favorable for fantasy" heuristic (mismatched teams = goals likely). Stars 1–5.

### Pre-tournament state

Before kickoff, no points exist. Replace top scorers with one of:
- **"Most-picked players"** if `selectedByPercentage` field exists in players.json (verified at implementation time)
- Otherwise **"Most expensive players"** as a proxy for who's expected to score.

### Eliminated nations

Dim or strike-through players from teams flagged `isEliminated: true` in squads.json. Keeps top scorers naturally rotating as knockouts progress.

## Section 4 — Spotify (span 4)

### Auth

OAuth refresh token in Vercel env vars. User provides:
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Server flow per request: exchange refresh token for access token (cached for ~50 min in process memory), call Spotify Web API endpoints.

### Endpoints

- `GET /me/player/currently-playing` — now playing (returns 204 if nothing).
- `GET /me/player/recently-played?limit=1` — fallback when nothing playing.
- `GET /me/top/tracks?time_range=short_term&limit=1` — top track over 4 weeks. Spotify exposes only `short_term` (4wk), `medium_term` (6mo), `long_term` (years).
- `GET /me/top/artists?time_range=short_term&limit=1` — top artist over 4 weeks.

Three calls per page load, parallelised. The token refresh adds one more call but only when access token expires.

### New function: `api/spotify.js`

Separate from `/api/data` because:
1. The page polls Spotify every 30s to update "now playing" — main data should not refetch that often.
2. Token refresh state can leak into the function's process memory without complicating the main handler.

### Render (in brick next to Headlines)

```
┌────────────────────────────────────┐
│ NOW PLAYING                  ●LIVE │
│ ┌────┐  Song Title                 │
│ │art │  Artist Name                │
│ │    │  Album · 2025               │
│ └────┘                             │
│ ──────────────────────────────     │
│ TOP TRACK · 4 WEEKS                │
│ ┌────┐  Track                      │
│ │art │  Artist                     │
│ └────┘                             │
│ ──────────────────────────────     │
│ TOP ARTIST · 4 WEEKS               │
│ ┌────┐  Artist                     │
│ │art │  Genre                      │
│ └────┘                             │
└────────────────────────────────────┘
```

### States

- Now playing exists → show track with `●LIVE` indicator.
- Nothing playing → header becomes "RECENTLY PLAYED · 23m ago" with last track and same artwork.
- Auth fails (refresh token expired/revoked) → "Spotify reconnect needed" message in the brick. Page does not break.
- All calls fail → brick shows single "Spotify unavailable" message; layout slot retained.

### Refresh

- Now playing block re-fetches `/api/spotify` every 30s while page is open.
- Top track / top artist re-fetch only on full page reload (they don't change minute-to-minute).

### Click behavior

- Click now playing → opens Spotify track URL in new tab.
- Click top track → same.
- Click top artist → same.

## Section 5 — Google Calendar (span 5)

### Auth

OAuth refresh token + client credentials in Vercel envs:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

User performs one-time OAuth dance via Google's OAuth Playground with `https://www.googleapis.com/auth/calendar.readonly` scope, hands over the resulting refresh token.

### Endpoint

`GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={now}&timeMax={now+90d}&singleEvents=true&orderBy=startTime&maxResults=20`

Fetched server-side as part of `/api/data`. 5-minute cache.

### Friendly sentence generation

Rule-based templates, not LLM. Cheap, predictable, easy to extend.

| Trigger keywords | Output template |
|---|---|
| "fly", "flight", airport code (3-letter all-caps), or known location ("Majorca", "Mallorca", "Spain", "Italy", etc.) | "You fly off to **{location}** in {N} days!" |
| "birthday" + a name | "**{name}**'s birthday in {N} days." |
| "driving test", "MOT", "dentist", "doctor" | "**{title}** in {N} days." |
| "holiday", "vacation", or multi-day event | "Holiday: **{title}** starts in {N} days." |
| Default fallback | "**{title}** · {relative date}" |

Location detection list lives in code; expand as needed. Order of rules matters — first match wins.

### Section content

```
┌────────────────────────────────────┐
│ UPCOMING                           │
├────────────────────────────────────┤
│ ☀️ You fly off to Majorca in 8     │
│    days!                           │
│ 🎂 Mum's birthday in 12 days.      │
│ 🚗 Driving test in 19 days.        │
│ 📅 Anthropic dinner · 27 Jul       │
└────────────────────────────────────┘
```

Up to 4 items max. Sort ascending by start time. If <4 events in next 90 days, show only what exists — do not pad.

### Date phrasing

- ≤24h: "today" / "tomorrow"
- 2–13 days: "in N days"
- 14–60 days: actual date "27 Jul"
- 60+ days: actual date with year if cross-year

### Empty state

"Nothing on your calendar for the next 3 months." (Realistic given the user's light schedule.)

### Refresh

5-min cache via `s-maxage`. Calendar does not change quickly enough to warrant aggressive polling.

## Section 6 — Headlines tabs change

### Changes

- **AI tab**: replace VentureBeat RSS with two parallel feeds:
  - `https://techcrunch.com/category/artificial-intelligence/feed/`
  - `https://www.theverge.com/ai-artificial-intelligence/rss/index.xml`
- **Premier League tab → Football tab**:
  - Primary: `https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml` (verify exists at implementation time; fall back to general football feed `https://feeds.bbci.co.uk/sport/football/rss.xml`).
  - Secondary: `https://www.fifa.com/rss/news` for FIFA's official news.
- **World tab**: unchanged (BBC).
- **Tech tab**: unchanged (Ars Technica).

### Multi-source dedupe

For tabs with two feeds (AI, Football):
1. Fetch both in parallel.
2. Concatenate items.
3. Dedupe by title using substring or Levenshtein <30% match.
4. Sort by `pubDate` descending.
5. Take top 5.

`api/data.js`'s existing `parseRSS()` already handles RSS/Atom variants — no parser changes needed.

### Tab colors

- AI: orange (existing)
- Tech: green (existing)
- World: blue (existing)
- Football: green (was Premier League green; same color, new label)

`CAT_SOURCES` and `CAT_COLORS` constants in `index.html` updated.

### Restoration plan post-tournament

When the World Cup ends and the 2026/27 PL season begins (mid-August), the Football tab can either stay (BBC general football covers PL too) or be relabeled back to Premier League with the original PL feed. Decision deferred to post-tournament.

## Cross-cutting concerns

### Error isolation

Every new section's data fetch is wrapped in try/catch — a single failure cannot break the page. The existing pattern in `api/data.js` (`Promise.all` with per-fetch try/catch returning `null`/`[]` on error) extends to all new fetches.

### Cache strategy summary

| Data | Cache TTL | Function |
|---|---|---|
| Markets, fixtures, news, calendar, weather | 5 min | `/api/data` |
| WC Fantasy public JSON | 1 hour (or until checksum changes) | `/api/wc-fantasy` |
| Spotify now playing + top | none (response not cached) | `/api/spotify` polled every 30s |
| Spotify access token | ~50 min in-process | within `/api/spotify` |

### Mobile breakpoint

Mosaic collapses to single column at ≤768px. All sections retain full content; only the layout changes. The horizontal-scroll WC fixtures stay horizontal-scroll on mobile (touch-friendly).

### Accessibility

- All flag images carry `alt` text with country name.
- Tap targets meet 44×44px minimum.
- Color is never the sole carrier of meaning (e.g. live match indicator pairs the dot with the word "LIVE").
- Keyboard navigation works for tab carousel and fixture expand chips (existing pattern preserved).

### Time zone

All dates render in Europe/London (where the user is). Existing `toLocaleDateString('en-GB', ...)` pattern continues throughout.

### `/api/data` response shape

The page is the only consumer, so breaking changes to `/api/data`'s response shape are acceptable when convenient. Concretely:

- Remove `fplTeam` field entirely.
- Replace `fixtures` (currently EPL fixtures) with `worldCup: { fixtures, currentRound, england }`.
- Add `calendar: { events: [...] }`.
- Other fields (`prices`, `news`, `golf`) keep their current shape.

`api/wc-fantasy.js` and `api/spotify.js` are net-new endpoints with their own shapes — no compatibility constraints.

## Sequencing

The work breaks into commits roughly in this order. Each is independently shippable:

1. **Cleanup pass** — Section 1. No new features. Removes FPL, fixes companies/ticker drift, US 500 hack, hero CSS.
2. **Page layout restructure** — implement the mosaic grid and re-flow existing sections into their new slots. No new sections yet; existing ones simply move.
3. **WC fixtures section** — Section 2. Replaces the PL fixtures slot. **Must ship before tomorrow.**
4. **Headlines tab rename + AI feed fix** — Section 6. Quick win, shippable any time.
5. **WC Fantasy Insights** — Section 3. Independent of all above.
6. **Calendar section** — Section 5. Blocked on user providing Google OAuth refresh token.
7. **Spotify section** — Section 4. Blocked on user providing Spotify OAuth credentials.

The first three close the time-pressure window. 4 is fast. 5 and 6 wait on user-side credential setup and ship as those land.

## Open items deferred to implementation

- Verify `https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml` exists. Fall back to general football feed if not.
- Verify `selectedByPercentage` (or equivalent) in `play.fifa.com/json/fantasy/players.json`. If absent, "Most-picked players" pre-tournament block becomes "Most expensive players" instead.
- Search for the correct Yahoo ticker for the user's actual Vanguard U.S. 500 fund (Section 1, point 4). Surface result before changing the number.
- Confirm The Odds API supports `soccer_fifa_world_cup` in current pricing tier; if rate-limited, drop odds for WC fixtures rather than block the section.

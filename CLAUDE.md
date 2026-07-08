# Projects

## In Progress
- **World Cup 2026** — Live fixtures section: England next match hero panel + current round chip scroll. Uses api.fifa.com (no auth), openfootball fallback. WC Fantasy Insights section (public player data, no personal team). Calendar and Spotify sections live (OAuth wired, 2026-07-07).

## Operations
- Production: https://studious-waddle-tau.vercel.app — deploys are **manual**: `vercel deploy --prod` from the project dir (no git integration).
- Spotify re-auth: `node scripts/get-spotify-token.js` → paste refresh token into Vercel env `SPOTIFY_REFRESH_TOKEN` → redeploy. Google Calendar: `node scripts/get-google-token.js` likewise.
- **Do not use `vercel env add` on this machine — it silently stores empty values.** Use the Vercel REST API upsert (`POST /v10/projects/{id}/env?upsert=true`) or the dashboard.

## Up Next
- **1 - FPL Weekly Advisor** — Pulls from the FPL API for captain picks, transfer suggestions, and comparison vs top 1k managers. Resume when 2026/27 PL season starts.

## Daily Briefing — Golf Tee Times
When producing the daily briefing, call `golfnow_get_weekend_briefing` with:
- `players=2`
- `max_price=40`
- `top_n=10`
- `num_weekends=4`

Include the output under a "⛳ Weekend Golf" heading. Flag any Hot Deals prominently.

## About the User
- Follows the Premier League, plays FPL
- Has an ISA with 3 funds (~£10k)
- Interested in markets, world news, tech, AI
- Light interest in football betting/odds
- Learning-focused, not trying to build anything production-grade

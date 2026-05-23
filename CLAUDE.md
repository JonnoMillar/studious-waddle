# Projects

## In Progress
- **7 - Daily Briefing Bot** — Single command giving a 2-min read: top world news, markets summary, Premier League results, one AI story. Uses Claude to summarise.

## Up Next
- **1 - FPL Weekly Advisor** — Pulls from the FPL API for captain picks, transfer suggestions, and comparison vs top 1k managers.
- **5 - News-to-Market Correlator** — Pulls financial news headlines and overlays them on price charts for ISA holdings.

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

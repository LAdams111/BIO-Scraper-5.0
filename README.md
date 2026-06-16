# BIO-Scraper-5.0

Basketball Reference bio scraper for [Hoop Central](https://hoopcentral-50-production.up.railway.app). Scrapes player profile fields (name, height, weight, position, birth date, hometown, country, jersey) and POSTs to Hoop Central's `/api/ingest/player-bio` endpoint.

Does **not** scrape stats, game logs, or season averages.

## Setup

```bash
cp .env.example .env
npm install
npm run build
```

## Usage

```bash
# Dry-run single player (no POST)
npm run scrape:dry-run -- --player-slug curryst01

# Live ingest single player
npm run scrape -- --player-slug curryst01

# Test backfill (5 players)
npm run scrape:dry-run -- --backfill --limit 5

# Full backfill with checkpoint resume
npm run scrape:backfill -- --resume
```

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `HOOP_CENTRAL_API_URL` | Yes | Hoop Central API base URL |
| `INGEST_API_KEY` | No | Sent as `x-ingest-api-key` when set |
| `SCRAPE_REQUEST_DELAY_MS` | No | Delay between BRef requests (default 2000) |

## Linking to existing stats profiles

Before creating a bio-only profile, the scraper tries to link to an existing balldontlie identity via name + birth date matching using `GET /api/ingest/completion-status?source=balldontlie`. Confirmed mappings are cached in `bref-to-bdl.cache.json`.

## Checkpoint files

- `scrape-bio-backfill.checkpoint.json` — completed BRef slugs
- `scrape-bio-backfill.log` — run log
- `bref-to-bdl.cache.json` — confirmed BRef → balldontlie mappings

All are gitignored.

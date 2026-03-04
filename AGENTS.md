# AGENTS.md

Guidance for coding agents working in this repository.

## Project Summary

This repo hosts a March Madness pool tool with:
- Static frontend on GitHub Pages
- Supabase-backed shared draft state (owners/draft mode/order/picks)
- ESPN-driven data refresh pipeline for teams/players/games/bracket

Current page model:
- `admin.html` + `app.js`: authenticated admin console (draft controls + exports)
- `index.html` / `public-board.html` + `public-home.js`: public live draft board
- `public-leaderboard.html` + `public-leaderboard.js`: public standings/details

## Architecture

### Data refresh (GitHub Action + script)
- Workflow: `.github/workflows/refresh-data.yml`
- Script: `scripts/refresh-data.mjs`
- Generated files in `data/`:
  - `meta.json`
  - `teams.json`
  - `players.json`
  - `events.json`
  - `game_log.json`
  - `player_totals.json`
  - `bracket.json`

### Live draft state (Supabase)
- Config: `supabase-config.js`
- Store client: `supabase-draft-store.js`
- Read helper for public pages: `live-state.js`
- SQL/RLS setup: `docs/supabase.sql`

State is shared via `public.pool_state` (`pool_key` default: `main`).
Public pages read picks. Admin page writes picks.

## Security Model

- Admin mutating actions are gated by Supabase Auth + `admin_users` allow-list.
- RLS policies in `docs/supabase.sql` are the source of truth.
- Public pages are intentionally read-only and can read public pool state.
- No service-role key should be used in client-side code.

## Key Frontend Behavior

- Public draft board focuses on:
  - current pick/on-clock/next-up
  - draft order highlighting (`On Clock`, `Next Up`)
  - optional/collapsible tournament context tables
  - player list with season + tournament stats
- Snake draft logic is implemented in `public-home.js` and `app.js`.
- Latest pick tile on public board shows player + team/logo.
- Admin picks reset is shared-pool scoped (not device-local wording).

## Export Behavior

Admin exports:
- Draft board CSV
- Picks CSV
- Picks JSON
- Picks PDF (print window flow with CSV fallback only if true popup block)

## Team Source Rules

`refresh-data.mjs` team source precedence depends on `--team_source_mode`:
- `auto`: official bracket first, then configured fallbacks
- file mode via `--team_file` (usually `config/teams.current.json`)
- explicit `--team_ids`
- discovery dates (`--team_discovery_dates`)

`team.seed` maps to `player.team_seed` and drives seed views + draft score weighting.

## Local Commands

Run local static site:

```bash
npm run serve
```

Refresh data locally:

```bash
npm run refresh -- \
  --year=2026 \
  --seasonType=2 \
  --team_source_mode=auto \
  --team_file=config/teams.current.json \
  --team_discovery_dates=20260317,20260318,20260319,20260320 \
  --game_start_date=20260317
```

## Validation Checklist

1. Syntax checks:

```bash
node --check scripts/refresh-data.mjs
node --check app.js
node --check public-home.js
node --check public-leaderboard.js
node --check live-state.js
node --check supabase-draft-store.js
```

2. Refresh data and sanity-check ranking output:

```bash
node scripts/refresh-data.mjs --year=2026 --seasonType=2 --team_source_mode=auto --team_file=config/teams.current.json --game_start_date=20260317 --game_end_date=20260317
jq '.[0:15] | map({rank:.draft_rank,name:.player_name,mpg:.avg_minutes,gp:.games_played,score:.draft_score})' data/players.json
```

3. If touching public UI/CSS, bump asset query version on:
- `index.html`
- `public-board.html`
- `public-leaderboard.html`
- `admin.html`

## Git / Deployment Notes

- Push to `main` deploys GitHub Pages.
- Scheduled/manual refresh action commits updated `data/*.json`.
- Do not hand-edit generated `data/*.json` except intentional placeholders.
- Do not commit tool artifacts (for example `.playwright-cli/` snapshots).

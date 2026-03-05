# NCAA Pool Draft + Tournament Tracker

Browser-first March Madness player draft pool app.

It provides:
- Public live draft board (`index.html` / `public-board.html`)
- Public live standings (`public-leaderboard.html`)
- Admin draft console (`admin.html`)
- Automated data refresh pipeline into `data/*.json`
- Shared live picks/draft state through Supabase

## Current Page Structure

- `index.html` (public):
  - live pick status (current pick, on clock, latest pick, available players)
  - draft order table with `On Clock` / `Next Up` highlights
  - optional/collapsible tournament context (teams, elimination tracker, bracket)
  - players table with draft status + tournament stats

- `public-board.html` (public):
  - same public board behavior as `index.html`

- `public-leaderboard.html` (public):
  - owner leaderboard
  - per-player drafted details (draft status + tournament production)
  - live bracket section

- `admin.html` (admin-only controls after login):
  - auth gate via Supabase
  - draft board/stat dashboard for drafting
  - owner management, snake/manual order, configurable picks per owner (default 6), add picks
  - export picks (PDF/CSV/JSON), import picks, reset picks
  - sync status cards (source/connection/last sync/write status)

## Architecture

### 1) Static frontend
- Hosted on GitHub Pages
- Main scripts:
  - `app.js` (admin, Lit-rendered UI)
  - `public-home.js` (public board, Lit-rendered UI)
  - `public-leaderboard.js` (public leaderboard, Lit-rendered UI)
  - `live-state.js` (shared live-state read helper)

### 2) Data refresh pipeline
- Workflow: `.github/workflows/refresh-data.yml`
- Script: `scripts/refresh-data.mjs`
- Generated files:
  - `data/meta.json`
  - `data/teams.json`
  - `data/players.json`
  - `data/events.json`
  - `data/game_log.json`
  - `data/player_totals.json`
  - `data/bracket.json`
  - `data/live_state.json` (legacy helper output)

### 3) Shared live picks state (Supabase)
- Config: `supabase-config.js`
- Client/store logic: `supabase-draft-store.js`
- SQL + RLS setup: `docs/supabase.sql`
- Table: `public.pool_state` (`pool_key` default `main`)

Public pages read from Supabase (read policy).
Admin page writes only when signed-in user is in `admin_users`.

## Supabase Setup

1. Create a Supabase project.
2. Run `docs/supabase.sql` in SQL Editor.
3. Set values in `supabase-config.js`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_POOL_KEY` (usually `main`)
4. Create admin users in Supabase Auth.
5. Insert those user UUIDs into `public.admin_users`.

Notes:
- `SUPABASE_ANON_KEY` is safe in client code when RLS is configured correctly.
- Do not use service-role keys in frontend code.

## Team Source + Refresh Behavior

`scripts/refresh-data.mjs` supports multiple team source strategies via `--team_source_mode`:
- `auto` (recommended): official bracket first, then fallback inputs
- `bracket`
- `file`
- `team_ids`
- `discover_dates`

Common inputs:
- `config/teams.current.json` as your projected/override team file
- `--team_discovery_dates` as fallback discovery dates

## Local Run

```bash
npm run serve
```

Default local URL:
- `http://localhost:4173` (or the next available port)

## Manual Data Refresh (Local)

```bash
npm run refresh -- \
  --year=2026 \
  --seasonType=2 \
  --team_source_mode=auto \
  --team_file=config/teams.current.json \
  --team_discovery_dates=20260317,20260318,20260319,20260320 \
  --game_start_date=20260317
```

Useful optional args:
- `--team_ids=150,248,...`
- `--game_end_date=YYYYMMDD`

## Daily Usage (Non-Technical)

1. Share `index.html` (or `public-board.html`) for the live draft board.
2. Share `public-leaderboard.html` for standings.
3. Admin runs draft from `admin.html`.
4. Use snake/manual order controls and add picks.
5. Export picks at draft end (PDF/CSV/JSON).
6. Run `Refresh NCAA Data` workflow during tournament.
7. Reload pages to see updated stats/standings.

## Export Notes

Admin exports:
- Draft board CSV
- Picks CSV
- Picks JSON
- Picks PDF

PDF uses a print-window flow. If popup is truly blocked, CSV fallback is used.

## Validation Checklist

Run syntax checks:

```bash
node --check scripts/refresh-data.mjs
node --check app.js
node --check public-home.js
node --check public-leaderboard.js
node --check live-state.js
node --check supabase-draft-store.js
```

Optional ranking sanity check:

```bash
node scripts/refresh-data.mjs --year=2026 --seasonType=2 --team_source_mode=auto --team_file=config/teams.current.json --game_start_date=20260317 --game_end_date=20260317
jq '.[0:15] | map({rank:.draft_rank,name:.player_name,mpg:.avg_minutes,gp:.games_played,score:.draft_score})' data/players.json
```

## Deployment Notes

- Push to `main` updates GitHub Pages.
- Scheduled/manual refresh workflow commits updated `data/*.json`.
- Avoid committing local tool artifacts (for example `.playwright-cli/` snapshots).
- Public asset cache busting uses query strings on CSS/JS includes.

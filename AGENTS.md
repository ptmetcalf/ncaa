# AGENTS.md

Guidance for coding agents working in this repository.

## Project Summary

This repo hosts a March Madness pool tool:
- Static frontend on GitHub Pages (`index.html`, `app.js`, `styles.css`)
- Data refresh script (`scripts/refresh-data.mjs`)
- GitHub Action that regenerates `data/*.json` (`.github/workflows/refresh-data.yml`)

Primary user workflows:
- Build draft board with season stats
- Track picks locally in browser
- Track tournament points from game logs
- Export draft board and picks to CSV

## Key Files

- `scripts/refresh-data.mjs`: fetches teams/rosters/stats/games and writes JSON outputs
- `config/teams.current.json`: current projected/official team input
- `config/teams.projected.json`: placeholder template list
- `data/*.json`: generated outputs consumed by frontend
- `app.js`: client app logic, localStorage picks, CSV/JSON export
- `index.html`: UI layout
- `styles.css`: presentation and table scroll behavior
- `.github/workflows/refresh-data.yml`: scheduled/manual refresh job

## Team Source Rules

Team source precedence in `refresh-data.mjs`:
1. `--team_file` (default: `config/teams.current.json`) if it exists and has teams
2. `--team_ids`
3. Scoreboard discovery dates (`--team_discovery_dates`)

`seed` in UI comes from the team file (`team.seed` -> `player.team_seed`).

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
  --team_file=config/teams.current.json \
  --game_start_date=20260317
```

Useful options:
- `--team_ids=150,248,...`
- `--game_end_date=YYYYMMDD`

## Data Contract

Script outputs:
- `data/meta.json`
- `data/teams.json`
- `data/players.json`
- `data/events.json`
- `data/game_log.json`
- `data/player_totals.json`

Frontend assumes these files exist and are valid JSON arrays/objects.

## Frontend Notes

- Picks are stored in browser localStorage (`ncaa_pool_state_v1`)
- Exports:
  - Draft board CSV
  - Picks CSV
  - Picks JSON (backup/import)
- Draft board table should remain vertically scrollable with sticky header

## Scoring Model

`buildDraftScore` is sample-aware to avoid low-minute outliers:
- Uses box-score rates as core
- Caps volatile advanced stats
- Applies reliability from minutes + games

If modifying weights, re-check top ranks for sanity (no bench-player outliers).

## Validation Checklist After Changes

1. Syntax check:

```bash
node --check scripts/refresh-data.mjs
node --check app.js
```

2. Run a data refresh and inspect top players:

```bash
node scripts/refresh-data.mjs --year=2026 --seasonType=2 --team_file=config/teams.current.json --game_start_date=20260317 --game_end_date=20260317
jq '.[0:15] | map({rank:.draft_rank,name:.player_name,mpg:.avg_minutes,gp:.games_played,score:.draft_score})' data/players.json
```

3. Confirm no obvious low-sample outliers in top ranks.

## Git and Deployment

- Push to `main` triggers Pages rebuild.
- Manual/scheduled action refresh writes new `data/*.json` and commits via bot.
- Do not hand-edit generated `data/*.json` unless intentionally resetting placeholders.


# NCAA Pool Draft + Tournament Tracker

Browser-first tool for a March Madness player draft pool.

It gives you:
- A sortable draft board with season stats (`PPG`, `MPG`, `RPG`, `APG`, etc.)
- A pick tracker for owners
- A live leaderboard based on tournament points scored

The site is static and works on GitHub Pages. Data is refreshed by GitHub Actions into `data/*.json`.

## How It Works

1. GitHub Action runs `scripts/refresh-data.mjs`.
2. Script pulls:
   - Team/game data from ESPN scoreboard + summaries
   - Rosters from ESPN team endpoints
   - Season averages from ESPN core athlete stats
3. Action commits JSON files to `data/`.
4. GitHub Pages loads those JSON files in `app.js`.
5. Picks are saved in the browser (`localStorage`) and can be exported/imported as JSON.

## One-Time Setup (GitHub)

1. Push this repo to GitHub.
2. In repo settings, enable **Pages** from `main` branch root.
3. Go to **Actions** -> **Refresh NCAA Data**.
4. Click **Run workflow** with your season settings.
5. Open the GitHub Pages URL.

## Ad Hoc Team Selection

Two easy options:

1. In the app, use the multi-select team filter during draft night.
2. In the workflow, pass `team_ids` (comma-separated ESPN team IDs) to limit loaded rosters/stats.

## Daily Use for Non-Coders

1. Open GitHub Pages URL.
2. Draft from the `Draft Board` section.
3. Add picks in `Draft Setup`.
4. After game slates, run **Refresh NCAA Data** workflow.
5. Reload page, leaderboard updates automatically.

## Local Run

```bash
npm run serve
```

Open `http://localhost:4173`.

## Manual Data Refresh (Local)

```bash
npm run refresh -- \
  --year=2026 \
  --seasonType=2 \
  --team_discovery_dates=20260317,20260318,20260319,20260320 \
  --game_start_date=20260317
```

Optional args:
- `--team_ids=150,248,...`
- `--game_end_date=YYYYMMDD`

## Notes

- If a player has no season stat line yet, the API can return `No stats found.`; the script keeps that player with blank averages.
- Tournament scoring in this app uses raw points from ESPN game summaries.
- Because picks are browser-local, export picks JSON after drafting as a backup.

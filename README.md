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
   - Team list from `config/teams.current.json` (fallback to ESPN discovery if empty/missing)
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

## Team File (Projected Now, Official Later)

Edit `config/teams.current.json` and keep it as your source of truth.

Format:

```json
{
  "year": 2026,
  "source": "Your notes",
  "teams": [
    { "team_id": 150, "team_name": "Duke Blue Devils", "seed": 1, "region": "East", "projected": true },
    { "team_id": 248, "team_name": "Houston Cougars", "seed": 1, "region": "Midwest", "projected": true }
  ]
}
```

Notes:
- `team_id` is required.
- `seed`, `region`, `projected`, `bid_type` are optional.
- This repo ships with a placeholder projected list in `config/teams.projected.json` (copied into `config/teams.current.json`).
- When the official field is released, update `config/teams.current.json` and run the workflow again.

## Daily Use for Non-Coders

1. Open GitHub Pages URL.
2. Draft from the `Draft Board` section.
3. Add picks in `Draft Setup`.
4. Export CSV files when needed:
   - `Download Draft Board CSV` for the full board
   - `Export Picks CSV` for each user's private Google Sheet import
5. Optional: switch `Draft Mode` to `Snake`, randomize order, and follow the `Next pick` prompt.
6. After game slates, run **Refresh NCAA Data** workflow.
7. Reload page, leaderboard updates automatically.

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
  --team_file=config/teams.current.json \
  --team_discovery_dates=20260317,20260318,20260319,20260320 \
  --game_start_date=20260317
```

Optional args:
- `--team_file=path/to/teams.json`
- `--team_ids=150,248,...`
- `--game_end_date=YYYYMMDD`

## Notes

- If a player has no season stat line yet, the API can return `No stats found.`; the script keeps that player with blank averages.
- Tournament scoring in this app uses raw points from ESPN game summaries.
- Because picks are browser-local, export picks JSON after drafting as a backup.

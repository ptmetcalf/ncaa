import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const TEAM_ROSTER_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams";
const SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary";
const CORE_BASE =
  "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const keyVal = token.slice(2);
    if (keyVal.includes("=")) {
      const [key, ...rest] = keyVal.split("=");
      out[key] = rest.join("=");
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[keyVal] = "true";
      continue;
    }

    out[keyVal] = next;
    i += 1;
  }
  return out;
}

function currentYear() {
  return Number(new Date().toISOString().slice(0, 4));
}

function todayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function ymdToDate(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}

function dateToYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function rangeYmd(startYmd, endYmd) {
  const out = [];
  const cur = ymdToDate(startYmd);
  const end = ymdToDate(endYmd);
  while (cur <= end) {
    out.push(dateToYmd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function parseCsvInts(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function parseCsvStrings(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchJson(url, { retries = 3, timeoutMs = 25000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Request failed for ${url}: ${err.message}`);
      }
      await sleep(250 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Request failed for ${url}`);
}

async function fetchJsonOr404(url, { retries = 2, timeoutMs = 15000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (attempt === retries) {
        throw new Error(`Request failed for ${url}: ${err.message}`);
      }
      await sleep(250 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Request failed for ${url}`);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const cur = index;
      index += 1;
      results[cur] = await worker(items[cur], cur);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function buildStatLookup(statBlob) {
  const lookup = new Map();
  const categories = statBlob?.splits?.categories ?? [];
  for (const category of categories) {
    for (const stat of category.stats ?? []) {
      lookup.set(stat.name, stat);
    }
  }
  return lookup;
}

function statValue(lookup, name) {
  const stat = lookup.get(name);
  if (!stat) return null;
  if (typeof stat.value === "number") return stat.value;
  return normalizeNumber(stat.displayValue);
}

function round(n, precision = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const mult = 10 ** precision;
  return Math.round(n * mult) / mult;
}

function buildDraftScore(player) {
  const points = player.avg_points ?? 0;
  const minutes = player.avg_minutes ?? 0;
  const rebounds = player.avg_rebounds ?? 0;
  const assists = player.avg_assists ?? 0;
  const steals = player.avg_steals ?? 0;
  const blocks = player.avg_blocks ?? 0;
  const turnovers = player.avg_turnovers ?? 0;
  const per = player.per ?? 0;
  const shooting = player.shooting_efficiency ?? 0;
  const ppep = player.points_per_estimated_possessions ?? 0;

  const score =
    points * 4.0 +
    minutes * 0.6 +
    rebounds * 1.8 +
    assists * 2.0 +
    steals * 2.5 +
    blocks * 2.5 -
    turnovers * 1.0 +
    per * 0.6 +
    shooting * 15 +
    ppep * 8;

  return round(score, 2);
}

async function getTeamsFromScoreboardDates(dates) {
  const teamMap = new Map();

  for (const date of dates) {
    const url = `${SCOREBOARD_BASE}?dates=${date}`;
    const body = await fetchJson(url);
    const events = body.events ?? [];
    for (const event of events) {
      const competitions = event.competitions ?? [];
      for (const competition of competitions) {
        for (const competitor of competition.competitors ?? []) {
          const id = Number(competitor.id);
          if (!Number.isInteger(id) || id <= 0) continue;
          const team = competitor.team ?? {};
          teamMap.set(id, {
            team_id: id,
            team_uid: competitor.uid ?? team.uid ?? null,
            team_name: team.displayName ?? team.name ?? null,
            team_short_name: team.shortDisplayName ?? null,
            team_abbreviation: team.abbreviation ?? null,
            conference_id: team.conferenceId ?? null,
            color: team.color ?? null,
            logo: team.logo ?? null
          });
        }
      }
    }
    await sleep(100);
  }

  return [...teamMap.values()].sort((a, b) => a.team_name.localeCompare(b.team_name));
}

async function getTeamRosters(teams) {
  const rosterRows = await mapWithConcurrency(teams, 8, async (team) => {
    const url = `${TEAM_ROSTER_BASE}/${team.team_id}/roster`;
    try {
      const body = await fetchJson(url, { retries: 3, timeoutMs: 20000 });
      await sleep(40);
      const apiTeam = body.team ?? {};
      const teamName = apiTeam.displayName ?? team.team_name;
      const teamShort = apiTeam.shortDisplayName ?? team.team_short_name;
      const teamAbbr = apiTeam.abbreviation ?? team.team_abbreviation;

      return (body.athletes ?? []).map((athlete) => ({
        player_id: Number(athlete.id),
        player_uid: athlete.uid ?? null,
        player_name: athlete.fullName ?? athlete.displayName ?? null,
        player_first_name: athlete.firstName ?? null,
        player_last_name: athlete.lastName ?? null,
        position: athlete.position?.abbreviation ?? null,
        jersey: athlete.jersey ?? null,
        class_year: athlete.experience?.abbreviation ?? null,
        height: athlete.displayHeight ?? null,
        weight: athlete.displayWeight ?? null,
        headshot: athlete.headshot?.href ?? null,
        team_id: team.team_id,
        team_name: teamName,
        team_short_name: teamShort,
        team_abbreviation: teamAbbr
      }));
    } catch (err) {
      console.warn(`Roster fetch failed for team ${team.team_id}: ${err.message}`);
      return [];
    }
  });

  const all = rosterRows.flat().filter((row) => Number.isInteger(row.player_id));
  const seen = new Set();
  const deduped = [];
  for (const row of all) {
    const key = `${row.player_id}:${row.team_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

async function getSeasonStatsForPlayers(players, year, seasonType) {
  const rows = await mapWithConcurrency(players, 10, async (player) => {
    const url = `${CORE_BASE}/seasons/${year}/types/${seasonType}/athletes/${player.player_id}/statistics/0?lang=en&region=us`;
    try {
      const body = await fetchJsonOr404(url, { retries: 2, timeoutMs: 15000 });
      await sleep(30);
      if (!body || body?.error?.message === "No stats found.") {
        return { ...player, has_season_stats: false };
      }

      const lookup = buildStatLookup(body);
      return {
        ...player,
        has_season_stats: true,
        games_played: statValue(lookup, "gamesPlayed"),
        games_started: statValue(lookup, "gamesStarted"),
        total_minutes: statValue(lookup, "minutes"),
        avg_minutes: statValue(lookup, "avgMinutes"),
        total_points: statValue(lookup, "points"),
        avg_points: statValue(lookup, "avgPoints"),
        total_rebounds: statValue(lookup, "rebounds") ?? statValue(lookup, "totalRebounds"),
        avg_rebounds: statValue(lookup, "avgRebounds"),
        total_assists: statValue(lookup, "assists"),
        avg_assists: statValue(lookup, "avgAssists"),
        total_steals: statValue(lookup, "steals"),
        avg_steals: statValue(lookup, "avgSteals"),
        total_blocks: statValue(lookup, "blocks"),
        avg_blocks: statValue(lookup, "avgBlocks"),
        total_turnovers: statValue(lookup, "totalTurnovers") ?? statValue(lookup, "turnovers"),
        avg_turnovers: statValue(lookup, "avgTurnovers"),
        fg_pct: statValue(lookup, "fieldGoalPct"),
        three_pt_pct: statValue(lookup, "threePointFieldGoalPct"),
        ft_pct: statValue(lookup, "freeThrowPct"),
        per: statValue(lookup, "PER"),
        shooting_efficiency: statValue(lookup, "shootingEfficiency"),
        scoring_efficiency: statValue(lookup, "scoringEfficiency"),
        estimated_possessions: statValue(lookup, "estimatedPossessions"),
        avg_estimated_possessions: statValue(lookup, "avgEstimatedPossessions"),
        points_per_estimated_possessions: statValue(lookup, "pointsPerEstimatedPossessions")
      };
    } catch (err) {
      console.warn(`Season stats fetch failed for athlete ${player.player_id}: ${err.message}`);
      return { ...player, has_season_stats: false };
    }
  });

  const withScores = rows.map((row) => ({
    ...row,
    draft_score: buildDraftScore(row)
  }));

  withScores.sort((a, b) => {
    const aScore = a.draft_score ?? -Infinity;
    const bScore = b.draft_score ?? -Infinity;
    if (bScore !== aScore) return bScore - aScore;
    return (a.player_name ?? "").localeCompare(b.player_name ?? "");
  });

  let rank = 1;
  for (const row of withScores) {
    row.draft_rank = rank;
    rank += 1;
  }

  return withScores;
}

async function getScoreboardEvents(dates) {
  const events = [];
  const seen = new Set();

  for (const date of dates) {
    const url = `${SCOREBOARD_BASE}?dates=${date}`;
    const body = await fetchJson(url);
    for (const event of body.events ?? []) {
      const id = Number(event.id);
      if (!Number.isInteger(id) || seen.has(id)) continue;
      seen.add(id);

      const competition = event.competitions?.[0] ?? {};
      const statusType = competition.status?.type ?? {};

      events.push({
        event_id: id,
        date,
        name: event.name ?? null,
        short_name: event.shortName ?? null,
        completed: Boolean(statusType.completed),
        status: statusType.description ?? statusType.name ?? null,
        home_team_id: Number(competition.competitors?.find((c) => c.homeAway === "home")?.id) || null,
        away_team_id: Number(competition.competitors?.find((c) => c.homeAway === "away")?.id) || null
      });
    }
    await sleep(100);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.event_id - b.event_id);
  return events;
}

function extractGameLogRows(summary, event) {
  const rows = [];
  const teams = summary?.boxscore?.players ?? [];

  for (const teamSection of teams) {
    const teamName = teamSection?.team?.displayName ?? null;
    const teamId = Number(teamSection?.team?.id) || null;
    const split = teamSection?.statistics?.[0];
    if (!split) continue;

    const labels = split.labels ?? [];
    const ptsIdx = labels.findIndex((l) => String(l).toUpperCase() === "PTS");
    const minIdx = labels.findIndex((l) => String(l).toUpperCase() === "MIN");

    for (const athleteRow of split.athletes ?? []) {
      const athleteId = Number(athleteRow?.athlete?.id);
      if (!Number.isInteger(athleteId)) continue;

      const stats = athleteRow.stats ?? [];
      const pointsRaw = ptsIdx >= 0 ? stats[ptsIdx] : null;
      const minutesRaw = minIdx >= 0 ? stats[minIdx] : null;

      rows.push({
        event_id: event.event_id,
        date: event.date,
        player_id: athleteId,
        player_name: athleteRow?.athlete?.displayName ?? null,
        team_id: teamId,
        team_name: teamName,
        minutes: normalizeNumber(minutesRaw),
        points: normalizeNumber(pointsRaw) ?? 0
      });
    }
  }

  return rows;
}

async function getGameLog(events) {
  const finalEvents = events.filter((e) => e.completed);
  const logs = await mapWithConcurrency(finalEvents, 8, async (event) => {
    const url = `${SUMMARY_BASE}?event=${event.event_id}`;
    try {
      const summary = await fetchJson(url, { retries: 3, timeoutMs: 20000 });
      await sleep(40);
      return extractGameLogRows(summary, event);
    } catch (err) {
      console.warn(`Summary fetch failed for event ${event.event_id}: ${err.message}`);
      return [];
    }
  });

  return logs.flat();
}

function aggregatePlayerTotals(gameLogRows) {
  const map = new Map();
  for (const row of gameLogRows) {
    const existing = map.get(row.player_id) ?? {
      player_id: row.player_id,
      player_name: row.player_name,
      team_id: row.team_id,
      team_name: row.team_name,
      games_played: 0,
      tournament_points: 0,
      tournament_minutes: 0
    };

    existing.games_played += 1;
    existing.tournament_points += row.points ?? 0;
    existing.tournament_minutes += row.minutes ?? 0;

    map.set(row.player_id, existing);
  }

  const totals = [...map.values()].map((row) => ({
    ...row,
    tournament_points: round(row.tournament_points, 2),
    tournament_minutes: round(row.tournament_minutes, 2)
  }));

  totals.sort((a, b) => b.tournament_points - a.tournament_points);
  return totals;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      if (value.trim() !== "") return value.trim();
      continue;
    }
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const year = Number(args.year ?? currentYear());
  const seasonType = Number(args.seasonType ?? args.season_type ?? 2);
  const selectedTeamIds = parseCsvInts(args.selectedTeams ?? args.selected_teams ?? args.team_ids ?? args.teamIds);

  const defaultDiscoverDates = [
    `${year}0317`,
    `${year}0318`,
    `${year}0319`,
    `${year}0320`
  ];

  const discoverDates =
    parseCsvStrings(args.discoverDates ?? args.discover_dates ?? args.team_discovery_dates).length > 0
      ? parseCsvStrings(args.discoverDates ?? args.discover_dates ?? args.team_discovery_dates)
      : defaultDiscoverDates;

  const gameStart = firstNonEmpty(args.gameStart, args.game_start, args.game_start_date, `${year}0317`);
  const gameEnd = firstNonEmpty(args.gameEnd, args.game_end, args.game_end_date, todayYmd());

  const gameDates = rangeYmd(gameStart, gameEnd);

  console.log(`Year: ${year}`);
  console.log(`Season type: ${seasonType}`);
  console.log(`Discover dates: ${discoverDates.join(", ")}`);
  console.log(`Game dates: ${gameStart} -> ${gameEnd} (${gameDates.length} days)`);

  let teams;
  if (selectedTeamIds.length > 0) {
    teams = selectedTeamIds.map((team_id) => ({
      team_id,
      team_uid: null,
      team_name: `Team ${team_id}`,
      team_short_name: null,
      team_abbreviation: null,
      conference_id: null,
      color: null,
      logo: null
    }));
  } else {
    teams = await getTeamsFromScoreboardDates(discoverDates);
  }

  if (teams.length === 0) {
    throw new Error(
      "No teams found. Try setting --selectedTeams=ID1,ID2 or pass valid --discoverDates=YYYYMMDD,..."
    );
  }

  console.log(`Teams: ${teams.length}`);

  const players = await getTeamRosters(teams);
  console.log(`Players from rosters: ${players.length}`);

  const playersWithStats = await getSeasonStatsForPlayers(players, year, seasonType);
  const events = await getScoreboardEvents(gameDates);
  const gameLog = await getGameLog(events);
  const playerTotals = aggregatePlayerTotals(gameLog);

  const now = new Date().toISOString();
  const meta = {
    generated_at: now,
    year,
    season_type: seasonType,
    discover_dates: discoverDates,
    game_start: gameStart,
    game_end: gameEnd,
    totals: {
      teams: teams.length,
      players: playersWithStats.length,
      events: events.length,
      final_events: events.filter((e) => e.completed).length,
      game_log_rows: gameLog.length,
      player_totals_rows: playerTotals.length
    }
  };

  const root = process.cwd();
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });

  await writeJson(path.join(dataDir, "meta.json"), meta);
  await writeJson(path.join(dataDir, "teams.json"), teams);
  await writeJson(path.join(dataDir, "players.json"), playersWithStats);
  await writeJson(path.join(dataDir, "events.json"), events);
  await writeJson(path.join(dataDir, "game_log.json"), gameLog);
  await writeJson(path.join(dataDir, "player_totals.json"), playerTotals);

  console.log("Wrote data files:");
  console.log("- data/meta.json");
  console.log("- data/teams.json");
  console.log("- data/players.json");
  console.log("- data/events.json");
  console.log("- data/game_log.json");
  console.log("- data/player_totals.json");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

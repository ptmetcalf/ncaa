import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
const BRACKET_PAGE_BASE = "https://www.espn.com/mens-college-basketball/bracket";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TEAM_FILE = "config/teams.current.json";

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

function compareYmd(a, b) {
  return Number(a) - Number(b);
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTeamRecord(raw, index = 0) {
  if (typeof raw === "number" || typeof raw === "string") {
    const teamId = Number(raw);
    if (!Number.isInteger(teamId) || teamId <= 0) return null;
    return {
      team_id: teamId,
      team_uid: null,
      team_name: `Team ${teamId}`,
      team_short_name: null,
      team_abbreviation: null,
      conference_id: null,
      color: null,
      logo: null,
      seed: null,
      region: null,
      bid_type: null,
      projected: true,
      source_rank: index + 1
    };
  }

  if (!raw || typeof raw !== "object") return null;
  const teamId = Number(raw.team_id ?? raw.id ?? raw.teamId);
  if (!Number.isInteger(teamId) || teamId <= 0) return null;

  const seedValue = normalizeNumber(raw.seed);
  const seed = Number.isFinite(seedValue) ? Math.round(seedValue) : null;

  return {
    team_id: teamId,
    team_uid: raw.team_uid ?? raw.teamUid ?? null,
    team_name: raw.team_name ?? raw.teamName ?? raw.name ?? `Team ${teamId}`,
    team_short_name: raw.team_short_name ?? raw.teamShortName ?? raw.short_name ?? null,
    team_abbreviation: raw.team_abbreviation ?? raw.teamAbbreviation ?? raw.abbreviation ?? null,
    conference_id: normalizeNumber(raw.conference_id ?? raw.conferenceId),
    color: raw.color ?? null,
    logo: raw.logo ?? null,
    seed,
    region: raw.region ?? null,
    bid_type: raw.bid_type ?? raw.bidType ?? null,
    projected: raw.projected ?? true,
    source_rank: normalizeNumber(raw.source_rank ?? raw.sourceRank ?? index + 1)
  };
}

async function loadTeamsFromFile(root, fileArg) {
  const filePath = path.resolve(root, fileArg);
  if (!(await fileExists(filePath))) {
    return { teams: [], filePath, found: false };
  }

  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.teams;
  if (!Array.isArray(list)) {
    throw new Error(`Invalid team file format in ${filePath}: expected array or { teams: [] }`);
  }

  const normalized = list
    .map((team, idx) => normalizeTeamRecord(team, idx))
    .filter((team) => team !== null);

  const seen = new Set();
  const deduped = [];
  for (const team of normalized) {
    if (seen.has(team.team_id)) continue;
    seen.add(team.team_id);
    deduped.push(team);
  }

  deduped.sort((a, b) => (a.source_rank ?? 9999) - (b.source_rank ?? 9999) || a.team_name.localeCompare(b.team_name));

  return { teams: deduped, filePath, found: true };
}

function normalizeBracketSeed(seedRaw) {
  const parsed = normalizeNumber(seedRaw);
  if (!Number.isFinite(parsed)) return null;
  return clamp(Math.round(parsed), 1, 16);
}

function inferRegionId(matchup) {
  const direct = normalizeNumber(matchup?.regionId);
  if (Number.isFinite(direct)) return Math.round(direct);

  const bracketLocation = normalizeNumber(matchup?.bracketLocation);
  if (!Number.isFinite(bracketLocation)) return null;

  // ESPN bracket payload uses 1-32 bracket slots in rounds 0/1.
  return clamp(Math.floor((Math.round(bracketLocation) - 1) / 8) + 1, 1, 4);
}

function normalizeBracketTeamCandidate(competitor, matchup, regionMap) {
  const teamId = Number(competitor?.id);
  if (!Number.isInteger(teamId) || teamId <= 0) return null;

  const regionId = inferRegionId(matchup);
  const regionLabel = regionId ? regionMap.get(regionId) ?? null : null;

  const fallbackName =
    firstNonEmpty(competitor?.location, competitor?.name, competitor?.abbreviation, `Team ${teamId}`) ?? `Team ${teamId}`;

  return {
    team_id: teamId,
    team_uid: null,
    team_name: fallbackName,
    team_short_name: fallbackName,
    team_abbreviation: firstNonEmpty(competitor?.abbreviation, null),
    conference_id: null,
    color: firstNonEmpty(competitor?.color, null),
    logo: firstNonEmpty(competitor?.logo, competitor?.logoDark, null),
    seed: normalizeBracketSeed(competitor?.seed),
    region: regionLabel,
    bid_type: "official",
    projected: false,
    source_rank: null,
    _round_id: Number(matchup?.roundId) || 99
  };
}

function mergeBracketTeam(existing, incoming) {
  if (!existing) return incoming;

  const preferIncoming = (incoming?._round_id ?? 99) < (existing?._round_id ?? 99);
  const merged = preferIncoming ? { ...existing, ...incoming } : { ...incoming, ...existing };

  if (!merged.seed && incoming.seed) merged.seed = incoming.seed;
  if (!merged.region && incoming.region) merged.region = incoming.region;
  if (!merged.logo && incoming.logo) merged.logo = incoming.logo;
  if (!merged.team_abbreviation && incoming.team_abbreviation) merged.team_abbreviation = incoming.team_abbreviation;

  merged._round_id = Math.min(existing?._round_id ?? 99, incoming?._round_id ?? 99);
  return merged;
}

function finalizeBracketTeams(teamMap) {
  const teams = [...teamMap.values()].map((team) => {
    const clean = { ...team };
    delete clean._round_id;
    return clean;
  });

  teams.sort((a, b) => {
    const aSeed = Number.isFinite(a.seed) ? a.seed : 99;
    const bSeed = Number.isFinite(b.seed) ? b.seed : 99;
    if (aSeed !== bSeed) return aSeed - bSeed;
    const aRegion = String(a.region ?? "");
    const bRegion = String(b.region ?? "");
    if (aRegion !== bRegion) return aRegion.localeCompare(bRegion);
    return String(a.team_name ?? "").localeCompare(String(b.team_name ?? ""));
  });

  let rank = 1;
  for (const team of teams) {
    team.source_rank = rank;
    rank += 1;
  }

  return teams;
}

function normalizeBracketRegionRow(region) {
  const id = Number(region?.id);
  if (!Number.isInteger(id)) return null;
  return {
    id,
    label: firstNonEmpty(region?.labelPrimary, region?.label, region?.slug, `Region ${id}`),
    slug: firstNonEmpty(region?.slug, null)
  };
}

function normalizeBracketRoundRow(round) {
  const id = Number(round?.id);
  if (!Number.isInteger(id)) return null;
  return {
    id,
    label: firstNonEmpty(round?.labelPrimary, round?.label, `Round ${id}`),
    num_matchups: Number(round?.numMatchups) || null,
    start: firstNonEmpty(round?.start, null),
    end: firstNonEmpty(round?.end, null)
  };
}

function normalizeBracketCompetitorRow(competitor) {
  if (!competitor || typeof competitor !== "object") return null;
  const teamId = Number(competitor?.id);
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  return {
    team_id: teamId,
    team_name: firstNonEmpty(competitor?.location, competitor?.name, competitor?.abbreviation, `Team ${teamId}`),
    abbreviation: firstNonEmpty(competitor?.abbreviation, null),
    seed: normalizeBracketSeed(competitor?.seed),
    score: normalizeNumber(competitor?.score),
    winner: competitor?.winner === true ? true : competitor?.winner === false ? false : null,
    logo: firstNonEmpty(competitor?.logo, competitor?.logoDark, null)
  };
}

function normalizeBracketMatchupRow(matchup) {
  const id = Number(matchup?.id);
  if (!Number.isInteger(id)) return null;
  const roundId = Number(matchup?.roundId);
  const regionId = inferRegionId(matchup);
  const competitorOne = normalizeBracketCompetitorRow(matchup?.competitorOne);
  const competitorTwo = normalizeBracketCompetitorRow(matchup?.competitorTwo);

  return {
    matchup_id: id,
    round_id: Number.isInteger(roundId) ? roundId : null,
    region_id: Number.isInteger(regionId) ? regionId : null,
    bracket_location: Number(matchup?.bracketLocation) || null,
    date: firstNonEmpty(matchup?.date, null),
    status_state: firstNonEmpty(matchup?.statusState, null),
    status_desc: firstNonEmpty(matchup?.statusDesc, null),
    status_detail: firstNonEmpty(matchup?.statusDetail, null),
    location: firstNonEmpty(matchup?.location, null),
    link: firstNonEmpty(matchup?.link, null),
    competitor_one: competitorOne,
    competitor_two: competitorTwo
  };
}

async function loadTeamsFromOfficialBracket(year) {
  const url = `${BRACKET_PAGE_BASE}?season=${year}`;
  const html = await fetchText(url, { retries: 3, timeoutMs: 25000 });
  const root = parseAssignedJsonObject(html, "window['__espnfitt__']=");

  const bracket = root?.page?.content?.bracket;
  const rawMatchups = Array.isArray(bracket?.matchups) ? bracket.matchups : [];
  const regions = (Array.isArray(bracket?.regions) ? bracket.regions : []).map(normalizeBracketRegionRow).filter(Boolean);
  const rounds = (Array.isArray(bracket?.rounds) ? bracket.rounds : []).map(normalizeBracketRoundRow).filter(Boolean);
  const matchups = rawMatchups.map(normalizeBracketMatchupRow).filter(Boolean);
  const regionMap = new Map(
    regions
      .map((region) => [Number(region?.id), firstNonEmpty(region?.label, region?.slug, null)])
      .filter(([id]) => Number.isInteger(id))
  );

  const teamMap = new Map();
  for (const matchup of rawMatchups) {
    const candidates = [
      normalizeBracketTeamCandidate(matchup?.competitorOne, matchup, regionMap),
      normalizeBracketTeamCandidate(matchup?.competitorTwo, matchup, regionMap)
    ].filter(Boolean);

    for (const candidate of candidates) {
      teamMap.set(candidate.team_id, mergeBracketTeam(teamMap.get(candidate.team_id), candidate));
    }
  }

  const teams = finalizeBracketTeams(teamMap);
  return {
    teams,
    season: firstNonEmpty(bracket?.season, null),
    tournament_name: firstNonEmpty(bracket?.name, null),
    short_name: firstNonEmpty(bracket?.shortName, null),
    regions,
    rounds,
    matchups,
    matchup_count: matchups.length
  };
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

async function fetchText(url, { retries = 3, timeoutMs = 25000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
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

function parseAssignedJsonObject(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }

  let start = idx + marker.length;
  while (start < source.length && source[start] !== "{") start += 1;
  if (start >= source.length) {
    throw new Error(`JSON object start not found for marker: ${marker}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) {
    throw new Error(`Could not find JSON object end for marker: ${marker}`);
  }

  return JSON.parse(source.slice(start, end));
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hasValidSeed(teamSeed) {
  if (teamSeed === null || teamSeed === undefined || teamSeed === "") return false;
  return Number.isFinite(Number(teamSeed));
}

function seedAdjustment(teamSeed) {
  if (!hasValidSeed(teamSeed)) {
    return {
      normalized: 0,
      multiplier: 1
    };
  }

  const numericSeed = Number(teamSeed);
  if (!Number.isFinite(numericSeed)) {
    return {
      normalized: 0,
      multiplier: 1
    };
  }

  // 1-seeds get the strongest boost, 16-seeds the biggest penalty.
  const seed = clamp(Math.round(numericSeed), 1, 16);
  const normalized = (8.5 - seed) / 7.5; // roughly [-1, 1]
  const multiplier = 1 + normalized * 0.12; // cap impact to +/-12%

  return {
    normalized: round(normalized, 3),
    multiplier: round(multiplier, 3)
  };
}

function buildDraftScore(player, seedWeight = seedAdjustment(player.team_seed)) {
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
  const gamesPlayed = player.games_played ?? 0;

  // Downweight volatile tiny-sample lines so bench players do not outrank stars.
  const minutesSample = clamp(minutes / 24, 0, 1);
  const gamesSample = clamp(gamesPlayed / 20, 0, 1);
  const reliability = Math.sqrt(minutesSample * gamesSample);

  const baseScore =
    points * 4.5 +
    minutes * 0.6 +
    rebounds * 2.0 +
    assists * 2.2 +
    steals * 3.0 +
    blocks * 2.8 -
    turnovers * 1.5;

  // Cap advanced metrics and blend them by reliability.
  const perClamped = clamp(per, 0, 30);
  const shootingClamped = clamp(shooting, 0, 1.1);
  const ppepClamped = clamp(ppep, 0, 1.8);
  const advancedScore =
    reliability * (perClamped * 0.35 + shootingClamped * 8 + ppepClamped * 5);

  const score = (baseScore + advancedScore) * (0.55 + 0.45 * reliability) * seedWeight.multiplier;

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
            logo: team.logo ?? null,
            seed: null,
            region: null,
            bid_type: null,
            projected: null,
            source_rank: null
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
      const teamLogo = apiTeam.logo ?? team.logo ?? null;

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
        team_abbreviation: teamAbbr,
        team_logo: teamLogo,
        team_seed: team.seed ?? null,
        team_region: team.region ?? null,
        team_bid_type: team.bid_type ?? null,
        team_projected: team.projected ?? null
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

  const withScores = rows.map((row) => {
    const weight = seedAdjustment(row.team_seed);
    return {
      ...row,
      draft_seed_normalized: weight.normalized,
      draft_seed_multiplier: weight.multiplier,
      draft_score: buildDraftScore(row, weight)
    };
  });

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
  const root = process.cwd();

  const year = Number(args.year ?? currentYear());
  const seasonType = Number(args.seasonType ?? args.season_type ?? 2);
  const teamSourceMode = String(firstNonEmpty(args.team_source_mode, args.teamSourceMode, "auto")).toLowerCase();
  const selectedTeamIds = parseCsvInts(args.selectedTeams ?? args.selected_teams ?? args.team_ids ?? args.teamIds);
  const teamFileArg = firstNonEmpty(args.teamFile, args.team_file, DEFAULT_TEAM_FILE);

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
  let gameEnd = firstNonEmpty(args.gameEnd, args.game_end, args.game_end_date, todayYmd());
  if (compareYmd(gameEnd, gameStart) < 0) {
    gameEnd = gameStart;
  }

  const gameDates = rangeYmd(gameStart, gameEnd);

  console.log(`Year: ${year}`);
  console.log(`Season type: ${seasonType}`);
  console.log(`Team source mode: ${teamSourceMode}`);
  console.log(`Team file: ${teamFileArg}`);
  console.log(`Discover dates: ${discoverDates.join(", ")}`);
  console.log(`Game dates: ${gameStart} -> ${gameEnd} (${gameDates.length} days)`);

  const normalizedMode = ["auto", "bracket", "file", "team_ids", "discover_dates"].includes(teamSourceMode)
    ? teamSourceMode
    : "auto";

  let teams = [];
  let teamSource = "discover_dates";
  let teamSourceDetail = "Fallback scoreboard discovery";
  let resolvedTeamFile = null;
  let bracketMeta = null;
  let bracketMetaError = null;

  async function ensureBracketMeta() {
    if (bracketMeta || bracketMetaError) return;
    try {
      bracketMeta = await loadTeamsFromOfficialBracket(year);
    } catch (err) {
      bracketMetaError = err.message;
      console.warn(`Official bracket load failed: ${err.message}`);
    }
  }

  async function fromBracket() {
    await ensureBracketMeta();
    if (!bracketMeta) return false;
    if ((bracketMeta.teams ?? []).length >= 64) {
      teams = bracketMeta.teams;
      teamSource = "official_bracket";
      teamSourceDetail = `ESPN bracket page (${bracketMeta.season ?? "unknown season"})`;
      return true;
    }
    return false;
  }

  async function fromFile() {
    const fileSource = await loadTeamsFromFile(root, teamFileArg);
    if (fileSource.teams.length > 0) {
      teams = fileSource.teams;
      teamSource = "team_file";
      teamSourceDetail = "config file";
      resolvedTeamFile = fileSource.filePath;
      return true;
    }
    return false;
  }

  function fromTeamIds() {
    if (selectedTeamIds.length === 0) return false;
    teams = selectedTeamIds.map((team_id) => ({
      team_id,
      team_uid: null,
      team_name: `Team ${team_id}`,
      team_short_name: null,
      team_abbreviation: null,
      conference_id: null,
      color: null,
      logo: null,
      seed: null,
      region: null,
      bid_type: null,
      projected: null,
      source_rank: null
    }));
    teamSource = "team_ids";
    teamSourceDetail = "CLI team_ids";
    return true;
  }

  async function fromDiscoverDates() {
    teams = await getTeamsFromScoreboardDates(discoverDates);
    teamSource = "discover_dates";
    teamSourceDetail = "scoreboard discovery dates";
    return teams.length > 0;
  }

  if (normalizedMode === "bracket") {
    if (!(await fromBracket())) {
      await fromFile();
    }
  } else if (normalizedMode === "file") {
    if (!(await fromFile())) {
      fromTeamIds() || (await fromDiscoverDates());
    }
  } else if (normalizedMode === "team_ids") {
    fromTeamIds() || (await fromDiscoverDates());
  } else if (normalizedMode === "discover_dates") {
    await fromDiscoverDates();
  } else {
    // auto
    if (!(await fromBracket())) {
      if (!(await fromFile())) {
        fromTeamIds() || (await fromDiscoverDates());
      }
    }
  }

  // Fetch official bracket payload for public bracket/elimination views even when source mode is file/team_ids.
  await ensureBracketMeta();

  let players = [];
  let playersWithStats = [];
  let events = [];
  let gameLog = [];
  let playerTotals = [];
  let note = null;
  let seededPlayers = 0;

  if (teams.length === 0) {
    note =
      "No teams discovered for the provided dates yet. This is expected before bracket/team assignment. " +
      "Run again later, populate the team file, or pass --selectedTeams with ESPN team IDs.";
    console.log(note);
  } else {
    console.log(`Team source: ${teamSource}`);
    console.log(`Team source detail: ${teamSourceDetail}`);
    if (bracketMeta) {
      console.log(
        `Bracket season: ${bracketMeta.season ?? "unknown"} | matchups: ${bracketMeta.matchup_count ?? 0} | teams: ${
          bracketMeta.teams?.length ?? 0
        }`
      );
    }
    if (resolvedTeamFile) console.log(`Using team file: ${resolvedTeamFile}`);
    console.log(`Teams: ${teams.length}`);
    players = await getTeamRosters(teams);
    console.log(`Players from rosters: ${players.length}`);

    playersWithStats = await getSeasonStatsForPlayers(players, year, seasonType);
    seededPlayers = playersWithStats.filter((row) => hasValidSeed(row.team_seed)).length;
    if (seededPlayers === 0) {
      console.log("Seed weighting is neutral (no team seeds found in current team source).");
    } else {
      console.log(`Seed weighting active for ${seededPlayers} players.`);
    }
    events = await getScoreboardEvents(gameDates);
    gameLog = await getGameLog(events);
    playerTotals = aggregatePlayerTotals(gameLog);
  }

  const now = new Date().toISOString();
  const meta = {
    generated_at: now,
    year,
    season_type: seasonType,
    team_source_mode: normalizedMode,
    team_source: teamSource,
    team_source_detail: teamSourceDetail,
    team_file: resolvedTeamFile,
    bracket: bracketMeta
      ? {
          season: bracketMeta.season ?? null,
          tournament_name: bracketMeta.tournament_name ?? null,
          short_name: bracketMeta.short_name ?? null,
          matchups: bracketMeta.matchup_count ?? 0,
          teams: bracketMeta.teams?.length ?? 0
        }
      : {
          season: null,
          tournament_name: null,
          short_name: null,
          matchups: 0,
          teams: 0,
          error: bracketMetaError
        },
    discover_dates: discoverDates,
    game_start: gameStart,
    game_end: gameEnd,
    totals: {
      teams: teams.length,
      players: playersWithStats.length,
      seeded_players: seededPlayers,
      events: events.length,
      final_events: events.filter((e) => e.completed).length,
      game_log_rows: gameLog.length,
      player_totals_rows: playerTotals.length
    },
    note
  };

  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });

  const bracketData = {
    generated_at: now,
    year,
    available: Boolean(bracketMeta && (bracketMeta.matchup_count ?? 0) > 0),
    source: bracketMeta ? "espn_bracket_page" : "none",
    error: bracketMetaError,
    season: bracketMeta?.season ?? null,
    tournament_name: bracketMeta?.tournament_name ?? null,
    short_name: bracketMeta?.short_name ?? null,
    teams_count: bracketMeta?.teams?.length ?? 0,
    matchups_count: bracketMeta?.matchup_count ?? 0,
    regions: bracketMeta?.regions ?? [],
    rounds: bracketMeta?.rounds ?? [],
    matchups: bracketMeta?.matchups ?? []
  };

  await writeJson(path.join(dataDir, "meta.json"), meta);
  await writeJson(path.join(dataDir, "teams.json"), teams);
  await writeJson(path.join(dataDir, "players.json"), playersWithStats);
  await writeJson(path.join(dataDir, "events.json"), events);
  await writeJson(path.join(dataDir, "game_log.json"), gameLog);
  await writeJson(path.join(dataDir, "player_totals.json"), playerTotals);
  await writeJson(path.join(dataDir, "bracket.json"), bracketData);

  console.log("Wrote data files:");
  console.log("- data/meta.json");
  console.log("- data/teams.json");
  console.log("- data/players.json");
  console.log("- data/events.json");
  console.log("- data/game_log.json");
  console.log("- data/player_totals.json");
  console.log("- data/bracket.json");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

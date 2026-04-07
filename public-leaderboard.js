import { loadLiveState } from "./live-state.js";
import { isPreviewBracket, resolveBracketData } from "./bracket-preview.js";
import { renderBracketTable as renderSharedBracketTable } from "./shared-bracket.js";
import {
  bindImageFallbacks,
  byIdMap,
  escapeHtml,
  formatInt,
  formatNum,
  renderPlayerCell,
  renderTeamCell
} from "./shared-ui.js";
import { html, nothing, render } from "https://esm.sh/lit-html@3.3.1";

const AUTO_REFRESH_STORAGE_KEY = "pool_public_auto_refresh_enabled";

const state = {
  meta: null,
  teams: [],
  players: [],
  playerTotals: [],
  bracket: {
    rounds: [],
    matchups: []
  },
  picks: [],
  owners: [],
  selectedOwner: null,
  pollIntervalMs: 30000,
  liveSource: "none",
  liveUpdatedAt: null,
  refreshStatus: "pending",
  lastLiveCheckAt: null,
  refreshInFlight: false,
  autoRefreshEnabled: true
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  refreshToggle: document.querySelector("#refresh-toggle"),
  refreshIndicator: document.querySelector("#refresh-indicator"),
  leaderboardHint: document.querySelector("#leaderboard-hint"),
  detailSummary: document.querySelector("#detail-summary"),
  detailClearOwner: document.querySelector("#detail-clear-owner"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  detailBody: document.querySelector("#detail-body"),
  bracketSummary: document.querySelector("#bracket-summary"),
  bracketBody: document.querySelector("#bracket-body")
};

function seedValue(playerOrTeam) {
  const seed = Number(playerOrTeam?.team_seed ?? playerOrTeam?.seed);
  return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function renderMetaLine() {
  const statsUpdated = state.meta?.generated_at ? new Date(state.meta.generated_at).toLocaleString() : "pending";
  const liveUpdated = state.liveUpdatedAt ? new Date(state.liveUpdatedAt).toLocaleString() : "pending";
  elements.metaLine.textContent = `Standings stats refresh: ${statsUpdated} | Live picks updated: ${liveUpdated}`;
}

function readAutoRefreshPreference() {
  try {
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    if (stored === null) return true;
    return stored !== "false";
  } catch {
    return true;
  }
}

function writeAutoRefreshPreference(value) {
  try {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Ignore storage failures.
  }
}

function renderRefreshToggle() {
  if (!elements.refreshToggle) return;
  elements.refreshToggle.textContent = state.autoRefreshEnabled ? "Pause Refresh" : "Resume Refresh";
}

function renderRefreshIndicator() {
  if (!elements.refreshIndicator) return;
  elements.refreshIndicator.hidden = true;
}

function buildTeamStatusMap() {
  const rows = new Map();
  for (const team of state.teams) {
    const id = Number(team.team_id);
    if (!Number.isInteger(id)) continue;
    rows.set(id, {
      team_id: id,
      team_name: String(team.team_name ?? `Team ${id}`),
      status: "Alive",
      result: "No elimination yet"
    });
  }

  const rounds = new Map(
    (state.bracket?.rounds ?? [])
      .map((round) => [Number(round.id), String(round.label ?? `Round ${round.id}`)])
      .filter(([id]) => Number.isInteger(id))
  );

  const matchups = [...(state.bracket?.matchups ?? [])].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  for (const matchup of matchups) {
    if (matchup.status_state !== "post") continue;
    const one = matchup.competitor_one;
    const two = matchup.competitor_two;
    if (!one?.team_id || !two?.team_id) continue;

    const roundLabel = rounds.get(Number(matchup.round_id)) ?? `Round ${matchup.round_id ?? "-"}`;
    const oneRow = rows.get(Number(one.team_id)) ?? {
      team_id: Number(one.team_id),
      team_name: String(one.team_name ?? `Team ${one.team_id}`),
      status: "Alive",
      result: "No elimination yet"
    };
    const twoRow = rows.get(Number(two.team_id)) ?? {
      team_id: Number(two.team_id),
      team_name: String(two.team_name ?? `Team ${two.team_id}`),
      status: "Alive",
      result: "No elimination yet"
    };

    const oneScore = formatInt(one.score);
    const twoScore = formatInt(two.score);
    oneRow.result = `vs ${two.team_name ?? "Opponent"} (${oneScore}-${twoScore})`;
    twoRow.result = `vs ${one.team_name ?? "Opponent"} (${twoScore}-${oneScore})`;

    if (one.winner === true && two.winner === false) {
      twoRow.status = `Eliminated (${roundLabel})`;
      twoRow.result = `Lost to ${one.team_name ?? "opponent"} (${twoScore}-${oneScore})`;
    } else if (two.winner === true && one.winner === false) {
      oneRow.status = `Eliminated (${roundLabel})`;
      oneRow.result = `Lost to ${two.team_name ?? "opponent"} (${oneScore}-${twoScore})`;
    }

    rows.set(oneRow.team_id, oneRow);
    rows.set(twoRow.team_id, twoRow);
  }

  const finalRound = Math.max(
    0,
    ...matchups.filter((row) => row.status_state === "post").map((row) => Number(row.round_id) || 0)
  );
  if (finalRound > 0) {
    for (const matchup of matchups.filter((row) => row.status_state === "post" && Number(row.round_id) === finalRound)) {
      for (const competitor of [matchup.competitor_one, matchup.competitor_two]) {
        if (!competitor?.team_id || competitor.winner !== true) continue;
        const row = rows.get(Number(competitor.team_id));
        if (!row) continue;
        row.status = "Champion";
        row.result = `Won ${rounds.get(finalRound) ?? `Round ${finalRound}`}`;
      }
    }
  }

  return rows;
}

function isTeamStillRemaining(status) {
  const normalized = String(status ?? "").trim();
  if (!normalized) return true;
  if (normalized.startsWith("Eliminated")) return false;
  if (normalized === "Champion") return false;
  return true;
}

function detailStatusLabel(status) {
  const normalized = String(status ?? "").trim();
  if (!normalized) return "Active";
  if (normalized === "Champion") return "Champion";
  if (normalized.startsWith("Eliminated")) return "Eliminated";
  return "Active";
}

function renderLeaderboard() {
  const totals = byIdMap(state.playerTotals, "player_id");
  const players = byIdMap(state.players, "player_id");
  const teamStatus = buildTeamStatusMap();
  const owners = state.owners.length > 0 ? state.owners : [...new Set(state.picks.map((pick) => pick.owner))];

  const rows = owners.map((owner) => {
    const ownerPicks = state.picks.filter((pick) => pick.owner === owner);
    const totalPts = ownerPicks.reduce((sum, pick) => {
      const total = totals.get(Number(pick.player_id));
      return sum + (Number(total?.tournament_points) || 0);
    }, 0);
    const playersRemaining = ownerPicks.reduce((sum, pick) => {
      const player = players.get(Number(pick.player_id));
      const status = teamStatus.get(Number(player?.team_id ?? pick.team_id))?.status ?? "Alive";
      return sum + (isTeamStillRemaining(status) ? 1 : 0);
    }, 0);
    return { owner, players: ownerPicks.length, playersRemaining, totalPts };
  });

  rows.sort(
    (a, b) =>
      b.totalPts - a.totalPts || b.playersRemaining - a.playersRemaining || b.players - a.players || a.owner.localeCompare(b.owner)
  );

  if (rows.length === 0) {
    render(html`<tr><td colspan="5">No picks have been published yet.</td></tr>`, elements.leaderboardBody);
    if (elements.leaderboardHint) {
      elements.leaderboardHint.textContent = "No owners with picks yet.";
    }
    return;
  }

  if (elements.leaderboardHint) {
    elements.leaderboardHint.textContent = state.selectedOwner
      ? `Showing details for ${state.selectedOwner}. Click another owner row to switch.`
      : "Click an owner row to filter player details.";
  }

  render(
    html`${rows.map(
      (row, index) => html`<tr
        class=${`leaderboard-owner-row${state.selectedOwner === row.owner ? " is-active" : ""}`}
        data-owner=${encodeURIComponent(row.owner)}
        tabindex="0"
        role="button"
        aria-label=${`Show players for ${row.owner}`}
      >
        <td data-label="Rank">${index + 1}</td>
        <td data-label="Owner">${row.owner}</td>
        <td data-label="Players">${row.players}</td>
        <td data-label="Remaining">${row.playersRemaining}</td>
        <td data-label="Total PTS">${formatNum(row.totalPts, 1)}</td>
      </tr>`
    )}`,
    elements.leaderboardBody
  );
}

function renderPickDetails() {
  const teamMap = byIdMap(state.teams, "team_id");
  const totals = byIdMap(state.playerTotals, "player_id");
  const players = byIdMap(state.players, "player_id");
  const teamStatus = buildTeamStatusMap();

  let rows = state.picks
    .map((pick) => {
      const player = players.get(Number(pick.player_id));
      const total = totals.get(Number(pick.player_id));
      return {
        owner: pick.owner,
        player_name: pick.player_name ?? player?.player_name ?? "Unknown",
        headshot: player?.headshot ?? null,
        team_name: pick.team_name ?? player?.team_name ?? "Unknown",
        team_id: player?.team_id ?? pick.team_id,
        team_abbreviation: player?.team_abbreviation ?? null,
        team_logo: player?.team_logo ?? null,
        team_seed: player?.team_seed ?? null,
        team_status: teamStatus.get(Number(player?.team_id ?? pick.team_id))?.status ?? "Alive",
        tourn_pts: total?.tournament_points ?? 0,
        tourn_gp: total?.games_played ?? 0
      };
    })
    .sort((a, b) => b.tourn_pts - a.tourn_pts || a.player_name.localeCompare(b.player_name));

  if (state.selectedOwner) {
    rows = rows.filter((row) => row.owner === state.selectedOwner);
  }

  const selectedTotal = state.selectedOwner
    ? rows.reduce((sum, row) => sum + (Number(row.tourn_pts) || 0), 0)
    : null;
  const selectedRemaining = state.selectedOwner
    ? rows.filter((row) => isTeamStillRemaining(row.team_status)).length
    : null;
  const selectedEliminated = state.selectedOwner
    ? rows.filter((row) => !isTeamStillRemaining(row.team_status)).length
    : null;

  elements.detailSummary.textContent = state.selectedOwner
    ? `${rows.length} drafted players | ${state.selectedOwner} total points: ${formatNum(selectedTotal, 1)} | Remaining: ${selectedRemaining} | Eliminated: ${selectedEliminated}`
    : `${rows.length} drafted players`;
  if (elements.detailClearOwner) {
    elements.detailClearOwner.hidden = !state.selectedOwner;
  }

  if (rows.length === 0) {
    const empty = state.selectedOwner
      ? `No drafted players found for ${state.selectedOwner}.`
      : "No picks have been published yet.";
    render(html`<tr><td colspan="7">${empty}</td></tr>`, elements.detailBody);
    return;
  }

  render(
    html`${rows.map(
      (row) => html`<tr>
        <td data-label="Owner">${row.owner}</td>
        <td data-label="Player">${renderPlayerCell({ playerName: row.player_name, headshot: row.headshot })}</td>
        <td data-label="Team"
          >${renderTeamCell(teamMap, {
            teamId: row.team_id,
            teamName: row.team_name,
            teamAbbreviation: row.team_abbreviation,
            teamLogo: row.team_logo
          })}</td
        >
        <td data-label="Seed">${formatInt(row.team_seed)}</td>
        <td data-label="Status">${detailStatusLabel(row.team_status)}</td>
        <td data-label="Tourn PTS">${formatNum(row.tourn_pts, 1)}</td>
        <td data-label="Tourn GP">${formatInt(row.tourn_gp)}</td>
      </tr>`
    )}`,
    elements.detailBody
  );

  bindImageFallbacks();
}

function renderBracketTable() {
  renderSharedBracketTable({
    bracket: state.bracket,
    summaryElement: elements.bracketSummary,
    bodyElement: elements.bracketBody,
    isPreview: isPreviewBracket(state.bracket),
    includeRegion: true
  });
}

function rerender() {
  renderMetaLine();
  renderRefreshIndicator();
  renderLeaderboard();
  renderPickDetails();
  renderBracketTable();
}

function setSelectedOwner(owner) {
  if (!owner) {
    state.selectedOwner = null;
    rerender();
    return;
  }
  state.selectedOwner = state.selectedOwner === owner ? null : owner;
  rerender();
}

function bindEvents() {
  elements.refreshToggle?.addEventListener("click", () => {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    writeAutoRefreshPreference(state.autoRefreshEnabled);
    renderRefreshToggle();
  });

  elements.leaderboardBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest("tr[data-owner]");
    if (!row) return;
    const encoded = row.getAttribute("data-owner");
    if (!encoded) return;
    setSelectedOwner(decodeURIComponent(encoded));
  });

  elements.leaderboardBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest("tr[data-owner]");
    if (!row) return;
    event.preventDefault();
    const encoded = row.getAttribute("data-owner");
    if (!encoded) return;
    setSelectedOwner(decodeURIComponent(encoded));
  });

  elements.detailClearOwner?.addEventListener("click", () => {
    setSelectedOwner(null);
  });
}

async function refreshLiveState() {
  state.lastLiveCheckAt = Date.now();

  try {
    const live = await loadLiveState();
    state.picks = Array.isArray(live.picks) ? live.picks : [];
    state.owners = Array.isArray(live.owners) ? live.owners : [];
    if (state.selectedOwner) {
      const ownerSet = new Set([
        ...state.owners,
        ...state.picks.map((pick) => String(pick.owner ?? "").trim()).filter(Boolean)
      ]);
      if (!ownerSet.has(state.selectedOwner)) {
        state.selectedOwner = null;
      }
    }
    state.liveSource = live.source ?? "none";
    state.liveUpdatedAt = live.updated_at ?? null;
    state.refreshStatus = state.liveSource === "supabase_rest" ? "ok" : "warn";
  } catch {
    state.refreshStatus = "error";
    state.liveSource = "refresh_error";
  }

  rerender();
}

async function loadJson(file) {
  const response = await fetch(file, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return response.json();
}

async function loadJsonIfPresent(file) {
  try {
    const response = await fetch(file, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function boot() {
  const [meta, teams, players, playerTotals, bracket, bracketPreview] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json"),
    loadJson("./data/player_totals.json"),
    loadJsonIfPresent("./data/bracket.json"),
    loadJsonIfPresent("./data/bracket-preview.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  state.playerTotals = Array.isArray(playerTotals) ? playerTotals : [];
  state.bracket = resolveBracketData(
    bracket && typeof bracket === "object" ? bracket : { rounds: [], matchups: [] },
    bracketPreview && typeof bracketPreview === "object" ? bracketPreview : null
  );
  state.autoRefreshEnabled = readAutoRefreshPreference();
  bindEvents();
  renderRefreshToggle();
  await refreshLiveState();

  // Keep public standings in sync with picks and new game totals.
  setInterval(async () => {
    if (!state.autoRefreshEnabled) return;
    if (state.refreshInFlight) return;
    state.refreshInFlight = true;
    try {
      state.playerTotals = await loadJson("./data/player_totals.json");
      state.bracket = resolveBracketData(
        (await loadJsonIfPresent("./data/bracket.json")) ?? state.bracket,
        await loadJsonIfPresent("./data/bracket-preview.json")
      );
      await refreshLiveState();
    } catch {
      // Keep rendering existing state if a refresh fails.
    } finally {
      state.refreshInFlight = false;
    }
  }, state.pollIntervalMs);
}

boot().catch((err) => {
  elements.metaLine.textContent = `Failed to load leaderboard: ${err.message}`;
  if (elements.refreshIndicator) {
    elements.refreshIndicator.dataset.status = "error";
    elements.refreshIndicator.textContent = "Live refresh unavailable due to page load error.";
  }
});

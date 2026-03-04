import { loadLiveState } from "./live-state.js";

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
  lastLiveCheckAt: null
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  refreshIndicator: document.querySelector("#refresh-indicator"),
  leaderboardHint: document.querySelector("#leaderboard-hint"),
  detailSummary: document.querySelector("#detail-summary"),
  detailClearOwner: document.querySelector("#detail-clear-owner"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  detailBody: document.querySelector("#detail-body"),
  bracketSummary: document.querySelector("#bracket-summary"),
  bracketBody: document.querySelector("#bracket-body")
};

function byIdMap(rows, idKey = "player_id") {
  const map = new Map();
  for (const row of rows) map.set(Number(row[idKey]), row);
  return map;
}

function formatNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number(n).toFixed(digits);
}

function formatInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return String(Math.round(Number(n)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function seedValue(playerOrTeam) {
  const seed = Number(playerOrTeam?.team_seed ?? playerOrTeam?.seed);
  return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function firstLetterToken(value) {
  const token = String(value ?? "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (token.length === 0) return "TM";
  if (token.length === 1) return token[0].slice(0, 2).toUpperCase();
  return `${token[0][0] ?? ""}${token[1][0] ?? ""}`.toUpperCase();
}

function getTeamLogoUrl(teamMap, teamId, explicitLogo = null) {
  if (explicitLogo && String(explicitLogo).trim() !== "") return String(explicitLogo).trim();
  const team = teamMap.get(Number(teamId));
  if (team?.logo && String(team.logo).trim() !== "") return String(team.logo).trim();
  if (Number.isInteger(Number(teamId)) && Number(teamId) > 0) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${Number(teamId)}.png`;
  }
  return null;
}

function renderTeamCell(teamMap, { teamId, teamName, teamAbbreviation, teamLogo }) {
  const logoUrl = getTeamLogoUrl(teamMap, teamId, teamLogo);
  const fallback = firstLetterToken(teamAbbreviation || teamName);
  const imgHtml = logoUrl
    ? `<img class="team-logo-img" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(teamName ?? "Team")} logo" loading="lazy" />`
    : `<span class="team-logo-fallback is-visible">${escapeHtml(fallback)}</span>`;
  const fallbackHtml = logoUrl ? `<span class="team-logo-fallback">${escapeHtml(fallback)}</span>` : "";
  return `<span class="team-cell"><span class="team-logo-wrap">${imgHtml}${fallbackHtml}</span><span class="team-cell-name">${escapeHtml(
    teamName ?? "-"
  )}</span></span>`;
}

function bindTeamLogoFallbacks() {
  const images = document.querySelectorAll("img.team-logo-img:not([data-logo-bound])");
  for (const img of images) {
    img.setAttribute("data-logo-bound", "1");
    const wrap = img.closest(".team-logo-wrap");
    const fallback = wrap?.querySelector(".team-logo-fallback");
    const showFallback = () => {
      img.classList.add("is-hidden");
      if (fallback) fallback.classList.add("is-visible");
    };
    img.addEventListener("error", showFallback);
    if (img.complete && img.naturalWidth === 0) showFallback();
  }
}

function renderMetaLine() {
  const generated = state.meta?.generated_at
    ? new Date(state.meta.generated_at).toLocaleString()
    : "No generated data yet";
  const liveUpdated = state.liveUpdatedAt ? new Date(state.liveUpdatedAt).toLocaleString() : "unknown";
  elements.metaLine.textContent = `Stats refresh: ${generated} | Live picks source: ${state.liveSource} | Live picks updated: ${liveUpdated}`;
}

function renderRefreshIndicator() {
  if (!elements.refreshIndicator) return;

  const pollSeconds = Math.max(1, Math.round(state.pollIntervalMs / 1000));
  const checkedAt = state.lastLiveCheckAt ? new Date(state.lastLiveCheckAt).toLocaleTimeString() : "not yet";
  const status = state.refreshStatus;
  elements.refreshIndicator.dataset.status = status;

  if (status === "ok") {
    elements.refreshIndicator.textContent = `Live data connected. Last check: ${checkedAt}. Auto-refresh every ${pollSeconds}s.`;
    return;
  }

  if (status === "warn") {
    elements.refreshIndicator.textContent = `Live feed warning (${state.liveSource}). Last check: ${checkedAt}. Showing latest available picks.`;
    return;
  }

  if (status === "error") {
    elements.refreshIndicator.textContent = `Live refresh failed. Last attempt: ${checkedAt}. Retrying every ${pollSeconds}s.`;
    return;
  }

  elements.refreshIndicator.textContent = "Checking live updates...";
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

function renderLeaderboard() {
  const totals = byIdMap(state.playerTotals, "player_id");
  const owners = state.owners.length > 0 ? state.owners : [...new Set(state.picks.map((pick) => pick.owner))];

  const rows = owners.map((owner) => {
    const ownerPicks = state.picks.filter((pick) => pick.owner === owner);
    const totalPts = ownerPicks.reduce((sum, pick) => {
      const total = totals.get(Number(pick.player_id));
      return sum + (Number(total?.tournament_points) || 0);
    }, 0);
    return { owner, players: ownerPicks.length, totalPts };
  });

  rows.sort((a, b) => b.totalPts - a.totalPts || b.players - a.players || a.owner.localeCompare(b.owner));

  if (rows.length === 0) {
    elements.leaderboardBody.innerHTML = `<tr><td colspan="4">No picks have been published yet.</td></tr>`;
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

  elements.leaderboardBody.innerHTML = rows
    .map(
      (row, index) => `<tr
      class="leaderboard-owner-row${state.selectedOwner === row.owner ? " is-active" : ""}"
      data-owner="${encodeURIComponent(row.owner)}"
      tabindex="0"
      role="button"
      aria-label="Show players for ${escapeHtml(row.owner)}"
    >
      <td data-label="Rank">${index + 1}</td>
      <td data-label="Owner">${escapeHtml(row.owner)}</td>
      <td data-label="Players">${row.players}</td>
      <td data-label="Total PTS">${formatNum(row.totalPts, 1)}</td>
    </tr>`
    )
    .join("");
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
        team_name: pick.team_name ?? player?.team_name ?? "Unknown",
        team_id: player?.team_id ?? pick.team_id,
        team_abbreviation: player?.team_abbreviation ?? null,
        team_logo: player?.team_logo ?? null,
        team_seed: player?.team_seed ?? null,
        team_status: teamStatus.get(Number(player?.team_id ?? pick.team_id))?.status ?? "Alive",
        team_status_detail: teamStatus.get(Number(player?.team_id ?? pick.team_id))?.result ?? "-",
        season_ppg: player?.avg_points ?? null,
        season_mpg: player?.avg_minutes ?? null,
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
  const selectedEliminated = state.selectedOwner
    ? rows.filter((row) => row.team_status.startsWith("Eliminated")).length
    : null;

  elements.detailSummary.textContent = state.selectedOwner
    ? `${rows.length} drafted players | ${state.selectedOwner} total points: ${formatNum(selectedTotal, 1)} | Eliminated: ${selectedEliminated}`
    : `${rows.length} drafted players`;
  if (elements.detailClearOwner) {
    elements.detailClearOwner.hidden = !state.selectedOwner;
  }

  if (rows.length === 0) {
    const empty = state.selectedOwner
      ? `No drafted players found for ${escapeHtml(state.selectedOwner)}.`
      : "No picks have been published yet.";
    elements.detailBody.innerHTML = `<tr><td colspan="10">${empty}</td></tr>`;
    return;
  }

  elements.detailBody.innerHTML = rows
    .map((row) => {
      return `<tr>
        <td data-label="Owner">${escapeHtml(row.owner)}</td>
        <td data-label="Player">${escapeHtml(row.player_name)}</td>
        <td data-label="Team">${renderTeamCell(teamMap, {
          teamId: row.team_id,
          teamName: row.team_name,
          teamAbbreviation: row.team_abbreviation,
          teamLogo: row.team_logo
        })}</td>
        <td data-label="Seed">${formatInt(row.team_seed)}</td>
        <td data-label="Team Status">${escapeHtml(row.team_status)}</td>
        <td data-label="Season PPG">${formatNum(row.season_ppg)}</td>
        <td data-label="Season MPG">${formatNum(row.season_mpg)}</td>
        <td data-label="Tourn PTS">${formatNum(row.tourn_pts, 1)}</td>
        <td data-label="Tourn GP">${formatInt(row.tourn_gp)}</td>
        <td data-label="Status Detail">${escapeHtml(row.team_status_detail)}</td>
      </tr>`;
    })
    .join("");

  bindTeamLogoFallbacks();
}

function renderBracketTable() {
  if (!elements.bracketSummary || !elements.bracketBody) return;

  const rounds = new Map(
    (state.bracket?.rounds ?? [])
      .map((round) => [Number(round.id), String(round.label ?? `Round ${round.id}`)])
      .filter(([id]) => Number.isInteger(id))
  );
  const rows = [...(state.bracket?.matchups ?? [])].sort((a, b) => {
    const aRound = Number(a.round_id) || 99;
    const bRound = Number(b.round_id) || 99;
    if (aRound !== bRound) return aRound - bRound;
    const aLoc = Number(a.bracket_location) || 999;
    const bLoc = Number(b.bracket_location) || 999;
    if (aLoc !== bLoc) return aLoc - bLoc;
    return String(a.date ?? "").localeCompare(String(b.date ?? ""));
  });

  if (rows.length === 0) {
    elements.bracketSummary.textContent = "Bracket not published yet.";
    elements.bracketBody.innerHTML = `<tr><td colspan="3">No bracket matchups available.</td></tr>`;
    return;
  }

  const completed = rows.filter((row) => row.status_state === "post").length;
  elements.bracketSummary.textContent = `Matchups: ${rows.length} | Final: ${completed}`;

  elements.bracketBody.innerHTML = rows
    .map((row) => {
      const roundLabel = rounds.get(Number(row.round_id)) ?? `Round ${row.round_id ?? "-"}`;
      const one = row.competitor_one;
      const two = row.competitor_two;
      const oneLabel = one ? `${one.team_name ?? "TBD"} (${formatInt(seedValue(one))})` : "TBD";
      const twoLabel = two ? `${two.team_name ?? "TBD"} (${formatInt(seedValue(two))})` : "TBD";

      let statusText = row.status_desc ?? row.status_state ?? "-";
      if (row.status_state === "post") {
        statusText = `Final ${formatInt(one?.score)}-${formatInt(two?.score)}`;
      } else if (row.status_state === "pre") {
        statusText = row.date ? new Date(row.date).toLocaleString() : "Scheduled";
      }

      return `<tr>
        <td>${escapeHtml(roundLabel)}</td>
        <td>${escapeHtml(`${oneLabel} vs ${twoLabel}`)}</td>
        <td>${escapeHtml(statusText)}</td>
      </tr>`;
    })
    .join("");
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
  const [meta, teams, players, playerTotals, bracket] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json"),
    loadJson("./data/player_totals.json"),
    loadJsonIfPresent("./data/bracket.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  state.playerTotals = Array.isArray(playerTotals) ? playerTotals : [];
  state.bracket = bracket && typeof bracket === "object" ? bracket : { rounds: [], matchups: [] };
  bindEvents();
  await refreshLiveState();

  // Keep public standings in sync with picks and new game totals.
  setInterval(async () => {
    try {
      state.playerTotals = await loadJson("./data/player_totals.json");
      state.bracket = (await loadJsonIfPresent("./data/bracket.json")) ?? state.bracket;
      await refreshLiveState();
    } catch {
      // Keep rendering existing state if a refresh fails.
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

import { loadLiveState } from "./live-state.js";

const state = {
  meta: null,
  teams: [],
  players: [],
  playerTotals: [],
  bracket: {
    available: false,
    rounds: [],
    matchups: []
  },
  picks: [],
  owners: [],
  draft: {
    mode: "manual",
    order: []
  },
  pollIntervalMs: 15000,
  liveSource: "none",
  liveUpdatedAt: null,
  refreshStatus: "pending",
  lastLiveCheckAt: null,
  filters: {
    sortMode: "seed_then_team",
    seedDirection: "asc",
    playerStatus: "eligible",
    teamQuery: "",
    playerQuery: ""
  }
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  refreshIndicator: document.querySelector("#refresh-indicator"),
  filterSummary: document.querySelector("#filter-summary"),
  sortMode: document.querySelector("#sort-mode"),
  seedDirection: document.querySelector("#seed-direction"),
  playerStatus: document.querySelector("#player-status"),
  teamQuery: document.querySelector("#team-query"),
  playerQuery: document.querySelector("#player-query"),
  resetFiltersBtn: document.querySelector("#reset-filters"),
  liveStatusSub: document.querySelector("#live-status-sub"),
  statusPick: document.querySelector("#status-pick"),
  statusOnClock: document.querySelector("#status-on-clock"),
  statusLatest: document.querySelector("#status-latest"),
  statusAvailable: document.querySelector("#status-available"),
  draftOrderMeta: document.querySelector("#draft-order-meta"),
  draftOrderBody: document.querySelector("#draft-order-body"),
  teamCountMeta: document.querySelector("#team-count-meta"),
  teamsBody: document.querySelector("#teams-body"),
  eliminationSummary: document.querySelector("#elimination-summary"),
  eliminationBody: document.querySelector("#elimination-body"),
  bracketSummary: document.querySelector("#bracket-summary"),
  bracketBody: document.querySelector("#bracket-body"),
  boardBody: document.querySelector("#board-body")
};

function formatInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return String(Math.round(Number(n)));
}

function formatNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number(n).toFixed(digits);
}

function byIdMap(rows, idKey) {
  const map = new Map();
  for (const row of rows ?? []) {
    const id = Number(row?.[idKey]);
    if (!Number.isInteger(id)) continue;
    map.set(id, row);
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function bindTeamLogoFallbacks(root = document) {
  const images = root.querySelectorAll("img.team-logo-img:not([data-logo-bound])");
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

function normalizePicks(rows) {
  return (rows ?? [])
    .map((pick, idx) => ({
      pick_no: Number(pick.pick_no) || idx + 1,
      owner: String(pick.owner ?? "").trim(),
      player_id: Number(pick.player_id),
      player_name: pick.player_name ?? null,
      team_name: pick.team_name ?? null,
      team_id: Number(pick.team_id) || null
    }))
    .filter((pick) => Number.isInteger(pick.player_id));
}

function normalizeOwners(values) {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
    const owner = String(value ?? "").trim();
    if (!owner || seen.has(owner)) continue;
    seen.add(owner);
    out.push(owner);
  }
  return out;
}

function normalizeDraft(value) {
  if (!value || typeof value !== "object") return { mode: "manual", order: [] };
  const mode = value.mode === "snake" ? "snake" : "manual";
  const order = normalizeOwners(value.order);
  return { mode, order };
}

function seedValue(playerOrTeam) {
  const seed = Number(playerOrTeam?.team_seed ?? playerOrTeam?.seed);
  return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function seedSortValue(playerOrTeam) {
  const seed = seedValue(playerOrTeam);
  if (seed === null) return state.filters.seedDirection === "asc" ? 99 : -1;
  return seed;
}

function compareSeed(a, b) {
  const aSeed = seedSortValue(a);
  const bSeed = seedSortValue(b);
  return state.filters.seedDirection === "asc" ? aSeed - bSeed : bSeed - aSeed;
}

function compareTeam(a, b) {
  const aTeam = String(a.team_name ?? "");
  const bTeam = String(b.team_name ?? "");
  return aTeam.localeCompare(bTeam);
}

function comparePlayer(a, b) {
  return String(a.player_name ?? "").localeCompare(String(b.player_name ?? ""));
}

function dateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function sortedPlayersForBoard() {
  const pickedIds = new Set(state.picks.map((pick) => Number(pick.player_id)));
  const teamQuery = state.filters.teamQuery.trim().toLowerCase();
  const playerQuery = state.filters.playerQuery.trim().toLowerCase();
  const playerStatus = state.filters.playerStatus;

  const rows = state.players.filter((player) => {
    const isPicked = pickedIds.has(Number(player.player_id));
    if (playerStatus === "eligible" && isPicked) return false;
    if (playerStatus === "picked" && !isPicked) return false;
    if (playerQuery) {
      const playerName = String(player.player_name ?? "").toLowerCase();
      if (!playerName.includes(playerQuery)) return false;
    }

    if (!teamQuery) return true;
    const team = String(player.team_name ?? "").toLowerCase();
    const abbr = String(player.team_abbreviation ?? "").toLowerCase();
    return team.includes(teamQuery) || abbr.includes(teamQuery);
  });

  return rows.sort((a, b) => {
    const sortMode = state.filters.sortMode;

    if (sortMode === "team_then_seed") {
      const team = compareTeam(a, b);
      if (team !== 0) return team;
      const seed = compareSeed(a, b);
      if (seed !== 0) return seed;
      return comparePlayer(a, b);
    }

    if (sortMode === "team_only") {
      const team = compareTeam(a, b);
      if (team !== 0) return team;
      return comparePlayer(a, b);
    }

    if (sortMode === "seed_only") {
      const seed = compareSeed(a, b);
      if (seed !== 0) return seed;
      return comparePlayer(a, b);
    }

    const seed = compareSeed(a, b);
    if (seed !== 0) return seed;
    const team = compareTeam(a, b);
    if (team !== 0) return team;
    return comparePlayer(a, b);
  });
}

function snakeOwnerForPick(pickNo, order) {
  if (!Number.isInteger(pickNo) || pickNo <= 0 || order.length === 0) return null;
  const ownerCount = order.length;
  const roundIndex = Math.floor((pickNo - 1) / ownerCount);
  const indexInRound = (pickNo - 1) % ownerCount;
  const isReverseRound = roundIndex % 2 === 1;
  const ownerIndex = isReverseRound ? ownerCount - 1 - indexInRound : indexInRound;
  return order[ownerIndex] ?? null;
}

function ownerForPickNo(pickNo) {
  const order = state.draft.order.length > 0 ? state.draft.order : state.owners;
  if (!Number.isInteger(pickNo) || pickNo <= 0 || order.length === 0) return null;

  if (state.draft.mode === "snake") {
    return snakeOwnerForPick(pickNo, order);
  }

  const idx = (pickNo - 1) % order.length;
  return order[idx] ?? null;
}

function nextUpInfo(nextPickNo) {
  const onClockOwner = ownerForPickNo(nextPickNo);
  const immediatePickNo = nextPickNo + 1;
  const immediateOwner = ownerForPickNo(immediatePickNo);
  if (!onClockOwner) {
    return {
      onClockOwner: null,
      immediateOwner: null,
      immediatePickNo: null,
      nextUpOwner: null,
      nextUpPickNo: null
    };
  }

  if (!immediateOwner) {
    return {
      onClockOwner,
      immediateOwner: null,
      immediatePickNo: null,
      nextUpOwner: null,
      nextUpPickNo: null
    };
  }

  return {
    onClockOwner,
    immediateOwner,
    immediatePickNo,
    nextUpOwner: immediateOwner,
    nextUpPickNo: immediatePickNo
  };
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

function renderStatus() {
  const pickCount = state.picks.length;
  const nextPickNo = pickCount + 1;
  const nextUp = nextUpInfo(nextPickNo);
  const onClockOwner = nextUp.onClockOwner;
  const nextOwner = nextUp.nextUpOwner;
  const lastPick = [...state.picks].sort((a, b) => a.pick_no - b.pick_no).at(-1) ?? null;
  const pickedIds = new Set(state.picks.map((pick) => Number(pick.player_id)));
  const availableCount = Math.max(0, state.players.length - pickedIds.size);
  const playersById = byIdMap(state.players, "player_id");
  const teamsById = byIdMap(state.teams, "team_id");

  elements.liveStatusSub.textContent = `Draft mode: ${state.draft.mode} | Total picks: ${pickCount}`;
  elements.statusPick.textContent = `#${nextPickNo}`;
  if (!onClockOwner) {
    elements.statusOnClock.textContent = "No order set";
  } else if (nextOwner) {
    elements.statusOnClock.textContent = `${onClockOwner} | Next: ${nextOwner}`;
  } else {
    elements.statusOnClock.textContent = onClockOwner;
  }
  if (!lastPick) {
    elements.statusLatest.textContent = "No picks yet";
  } else {
    const player = playersById.get(Number(lastPick.player_id));
    const playerName = lastPick.player_name ?? player?.player_name ?? "Unknown";
    const teamName = lastPick.team_name ?? player?.team_name ?? "Unknown";
    const teamId = player?.team_id ?? lastPick.team_id ?? null;
    const teamAbbreviation = player?.team_abbreviation ?? null;
    const teamLogo = player?.team_logo ?? null;

    elements.statusLatest.innerHTML = `<span class="latest-pick-primary">#${formatInt(lastPick.pick_no)} ${escapeHtml(
      lastPick.owner
    )}: ${escapeHtml(playerName)}</span>
    <span class="latest-pick-secondary">${renderTeamCell(teamsById, {
      teamId,
      teamName,
      teamAbbreviation,
      teamLogo
    })}</span>`;
    bindTeamLogoFallbacks(elements.statusLatest);
  }
  elements.statusAvailable.textContent = `${availableCount} of ${state.players.length}`;
}

function renderDraftOrder() {
  if (!elements.draftOrderMeta || !elements.draftOrderBody) return;
  const order = state.draft.order.length > 0 ? state.draft.order : state.owners;
  const nextPickNo = state.picks.length + 1;
  const nextUp = nextUpInfo(nextPickNo);
  const onClockOwner = nextUp.onClockOwner;
  const nextOwner = nextUp.nextUpOwner;
  const nextUpPickNo = nextUp.nextUpPickNo;
  const hasBackToBack = nextUp.immediateOwner === onClockOwner;
  elements.draftOrderMeta.textContent =
    order.length > 0
      ? `${order.length} owners | Mode: ${state.draft.mode} | On clock: ${onClockOwner ?? "-"} | Next: ${nextOwner ?? "-"}`
      : "No order published";

  if (order.length === 0) {
    elements.draftOrderBody.innerHTML = `<tr><td colspan="3">No draft order available.</td></tr>`;
    return;
  }

  elements.draftOrderBody.innerHTML = order
    .map((owner, idx) => {
      let rowClass = "";
      let chipClass = "";
      let statusText = "Waiting";

      if (owner === onClockOwner) {
        rowClass = " is-on-clock";
        chipClass = " chip-on-clock";
        statusText = hasBackToBack ? `On Clock + Next Up (#${nextPickNo} + #${nextPickNo + 1})` : `On Clock (#${nextPickNo})`;
      } else if (owner === nextOwner) {
        rowClass = " is-next-up";
        chipClass = " chip-next-up";
        statusText = `Next Up (#${nextUpPickNo ?? nextPickNo + 1})`;
      }

      return `<tr class="draft-order-row${rowClass}">
        <td data-label="Spot">${idx + 1}</td>
        <td data-label="Owner">${escapeHtml(owner)}</td>
        <td data-label="Draft Status"><span class="order-chip${chipClass}">${escapeHtml(statusText)}</span></td>
      </tr>`;
    })
    .join("");
}

function renderTeams() {
  if (!elements.teamCountMeta || !elements.teamsBody) return;
  const teams = [...state.teams].sort((a, b) => {
    const seed = compareSeed(a, b);
    if (seed !== 0) return seed;
    return compareTeam(a, b);
  });

  elements.teamCountMeta.textContent = `${teams.length} teams loaded`;

  if (teams.length === 0) {
    elements.teamsBody.innerHTML = `<tr><td colspan="2">No team data loaded.</td></tr>`;
    return;
  }

  elements.teamsBody.innerHTML = teams
    .map((team) => `<tr><td>${formatInt(seedValue(team))}</td><td>${escapeHtml(team.team_name)}</td></tr>`)
    .join("");
}

function buildTeamStatusMap() {
  const teamsById = new Map();
  for (const team of state.teams) {
    const teamId = Number(team.team_id);
    if (!Number.isInteger(teamId)) continue;
    teamsById.set(teamId, {
      team_id: teamId,
      team_name: String(team.team_name ?? `Team ${teamId}`),
      seed: seedValue(team),
      status: "Alive",
      result: "No elimination yet",
      eliminated: false,
      eliminated_at: null,
      eliminated_round: null,
      champion: false
    });
  }

  const rounds = new Map(
    (state.bracket?.rounds ?? [])
      .map((round) => [Number(round.id), String(round.label ?? `Round ${round.id}`)])
      .filter(([id]) => Number.isInteger(id))
  );

  const matchups = Array.isArray(state.bracket?.matchups) ? state.bracket.matchups : [];
  const byDate = [...matchups].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  for (const matchup of byDate) {
    if (matchup.status_state !== "post") continue;
    const roundLabel = rounds.get(Number(matchup.round_id)) ?? `Round ${matchup.round_id ?? "-"}`;
    const one = matchup.competitor_one;
    const two = matchup.competitor_two;
    if (!one?.team_id || !two?.team_id) continue;

    const oneRow = teamsById.get(Number(one.team_id)) ?? {
      team_id: Number(one.team_id),
      team_name: String(one.team_name ?? `Team ${one.team_id}`),
      seed: seedValue(one),
      status: "Alive",
      result: "No elimination yet",
      eliminated: false,
      eliminated_at: null,
      eliminated_round: null,
      champion: false
    };
    const twoRow = teamsById.get(Number(two.team_id)) ?? {
      team_id: Number(two.team_id),
      team_name: String(two.team_name ?? `Team ${two.team_id}`),
      seed: seedValue(two),
      status: "Alive",
      result: "No elimination yet",
      eliminated: false,
      eliminated_at: null,
      eliminated_round: null,
      champion: false
    };

    const oneScore = formatInt(one.score);
    const twoScore = formatInt(two.score);

    oneRow.result = `vs ${two.team_name ?? "Opponent"} (${oneScore}-${twoScore})`;
    twoRow.result = `vs ${one.team_name ?? "Opponent"} (${twoScore}-${oneScore})`;

    if (one.winner === true && two.winner === false) {
      twoRow.eliminated = true;
      twoRow.eliminated_at = matchup.date ?? null;
      twoRow.eliminated_round = roundLabel;
      twoRow.status = `Eliminated (${roundLabel})`;
      twoRow.result = `Lost to ${one.team_name ?? "opponent"} (${twoScore}-${oneScore})`;
    } else if (two.winner === true && one.winner === false) {
      oneRow.eliminated = true;
      oneRow.eliminated_at = matchup.date ?? null;
      oneRow.eliminated_round = roundLabel;
      oneRow.status = `Eliminated (${roundLabel})`;
      oneRow.result = `Lost to ${two.team_name ?? "opponent"} (${oneScore}-${twoScore})`;
    }

    teamsById.set(oneRow.team_id, oneRow);
    teamsById.set(twoRow.team_id, twoRow);
  }

  const finalRound = Math.max(
    0,
    ...byDate.filter((row) => row.status_state === "post").map((row) => Number(row.round_id) || 0)
  );
  if (finalRound > 0) {
    const finals = byDate.filter((row) => row.status_state === "post" && Number(row.round_id) === finalRound);
    for (const matchup of finals) {
      for (const competitor of [matchup.competitor_one, matchup.competitor_two]) {
        if (!competitor?.team_id || competitor.winner !== true) continue;
        const row = teamsById.get(Number(competitor.team_id));
        if (!row) continue;
        row.champion = true;
        row.status = "Champion";
        row.result = `Won ${rounds.get(finalRound) ?? `Round ${finalRound}`}`;
      }
    }
  }

  return teamsById;
}

function renderEliminationTracker() {
  if (!elements.eliminationSummary || !elements.eliminationBody) return;
  const teamsById = buildTeamStatusMap();
  const rows = [...teamsById.values()].sort((a, b) => {
    if (a.champion !== b.champion) return a.champion ? -1 : 1;
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    const aSeed = Number.isFinite(Number(a.seed)) ? Number(a.seed) : 99;
    const bSeed = Number.isFinite(Number(b.seed)) ? Number(b.seed) : 99;
    if (aSeed !== bSeed) return aSeed - bSeed;
    return a.team_name.localeCompare(b.team_name);
  });

  const eliminatedCount = rows.filter((row) => row.eliminated).length;
  const aliveCount = rows.filter((row) => !row.eliminated).length;
  const champion = rows.find((row) => row.champion);

  elements.eliminationSummary.textContent = `Alive: ${aliveCount} | Eliminated: ${eliminatedCount}${champion ? ` | Champion: ${champion.team_name}` : ""}`;

  if (rows.length === 0) {
    elements.eliminationBody.innerHTML = `<tr><td colspan="4">No elimination data yet.</td></tr>`;
    return;
  }

  elements.eliminationBody.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.team_name)}</td>
        <td>${formatInt(row.seed)}</td>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.result)}</td>
      </tr>`
    )
    .join("");
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
      const oneLabel = one ? `${one.team_name ?? "TBD"} (${formatInt(one.seed)})` : "TBD";
      const twoLabel = two ? `${two.team_name ?? "TBD"} (${formatInt(two.seed)})` : "TBD";

      let statusText = row.status_desc ?? row.status_state ?? "-";
      if (row.status_state === "post") {
        const oneScore = one ? formatInt(one.score) : "-";
        const twoScore = two ? formatInt(two.score) : "-";
        statusText = `Final ${oneScore}-${twoScore}`;
      } else if (row.status_state === "pre") {
        statusText = dateLabel(row.date);
      }

      return `<tr>
        <td>${escapeHtml(roundLabel)}</td>
        <td>${escapeHtml(`${oneLabel} vs ${twoLabel}`)}</td>
        <td>${escapeHtml(statusText)}</td>
      </tr>`;
    })
    .join("");
}

function renderBoard(players) {
  const pickedByPlayerId = new Map(state.picks.map((pick) => [Number(pick.player_id), pick.owner]));
  const teamStatusById = buildTeamStatusMap();
  const totalsByPlayerId = new Map(state.playerTotals.map((row) => [Number(row.player_id), row]));
  const parts = [`Showing ${players.length} players`, `status: ${state.filters.playerStatus}`, `picked: ${state.picks.length}`];
  if (state.filters.teamQuery.trim()) parts.push(`team filter: "${state.filters.teamQuery.trim()}"`);
  if (state.filters.playerQuery.trim()) parts.push(`player filter: "${state.filters.playerQuery.trim()}"`);
  elements.filterSummary.textContent = parts.join(" | ");

  if (players.length === 0) {
    elements.boardBody.innerHTML = `<tr><td colspan="10">No players match this filter.</td></tr>`;
    return;
  }

  elements.boardBody.innerHTML = players
    .map((player) => {
      const owner = pickedByPlayerId.get(Number(player.player_id));
      const draftStatus = owner ? `Picked (${owner})` : "Eligible";
      const teamStatus = teamStatusById.get(Number(player.team_id));
      const total = totalsByPlayerId.get(Number(player.player_id));
      return `<tr>
        <td data-label="Player">${escapeHtml(player.player_name)}</td>
        <td data-label="Team">${escapeHtml(player.team_name)}</td>
        <td data-label="Seed">${formatInt(seedValue(player))}</td>
        <td data-label="Draft Status">${escapeHtml(draftStatus)}</td>
        <td data-label="Team Status">${escapeHtml(teamStatus?.status ?? "Alive")}</td>
        <td data-label="Season PPG">${formatNum(player.avg_points)}</td>
        <td data-label="Season MPG">${formatNum(player.avg_minutes)}</td>
        <td data-label="Tourn PTS">${formatNum(total?.tournament_points ?? 0, 1)}</td>
        <td data-label="Tourn GP">${formatInt(total?.games_played ?? 0)}</td>
        <td data-label="Status Detail">${escapeHtml(teamStatus?.result ?? "-")}</td>
      </tr>`;
    })
    .join("");
}

function rerender() {
  const boardPlayers = sortedPlayersForBoard();
  renderMetaLine();
  renderRefreshIndicator();
  renderStatus();
  renderDraftOrder();
  renderTeams();
  renderEliminationTracker();
  renderBracketTable();
  renderBoard(boardPlayers);
}

async function refreshLiveState() {
  state.lastLiveCheckAt = Date.now();

  try {
    const live = await loadLiveState();
    state.picks = normalizePicks(live.picks);
    state.owners = normalizeOwners(live.owners);
    state.draft = normalizeDraft(live.draft);
    state.liveSource = live.source ?? "none";
    state.liveUpdatedAt = live.updated_at ?? null;
    state.refreshStatus = state.liveSource === "supabase_rest" ? "ok" : "warn";
  } catch {
    state.refreshStatus = "error";
    state.liveSource = "refresh_error";
  }

  rerender();
}

function bindEvents() {
  elements.sortMode.addEventListener("change", () => {
    state.filters.sortMode = elements.sortMode.value;
    rerender();
  });

  elements.seedDirection.addEventListener("change", () => {
    state.filters.seedDirection = elements.seedDirection.value === "desc" ? "desc" : "asc";
    rerender();
  });

  elements.playerStatus.addEventListener("change", () => {
    state.filters.playerStatus =
      elements.playerStatus.value === "picked" || elements.playerStatus.value === "all"
        ? elements.playerStatus.value
        : "eligible";
    rerender();
  });

  elements.teamQuery.addEventListener("input", () => {
    state.filters.teamQuery = elements.teamQuery.value;
    rerender();
  });

  elements.playerQuery.addEventListener("input", () => {
    state.filters.playerQuery = elements.playerQuery.value;
    rerender();
  });

  elements.resetFiltersBtn.addEventListener("click", () => {
    state.filters.sortMode = "seed_then_team";
    state.filters.seedDirection = "asc";
    state.filters.playerStatus = "eligible";
    state.filters.teamQuery = "";
    state.filters.playerQuery = "";

    elements.sortMode.value = state.filters.sortMode;
    elements.seedDirection.value = state.filters.seedDirection;
    elements.playerStatus.value = state.filters.playerStatus;
    elements.teamQuery.value = "";
    elements.playerQuery.value = "";
    rerender();
  });
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

async function refreshStaticData() {
  const [meta, teams, players, playerTotals, bracket] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json"),
    loadJsonIfPresent("./data/player_totals.json"),
    loadJsonIfPresent("./data/bracket.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  state.playerTotals = Array.isArray(playerTotals) ? playerTotals : [];
  state.bracket = bracket && typeof bracket === "object" ? bracket : { available: false, rounds: [], matchups: [] };
}

async function boot() {
  await refreshStaticData();

  bindEvents();
  await refreshLiveState();

  setInterval(async () => {
    try {
      await refreshStaticData();
      await refreshLiveState();
    } catch {
      // Keep the last rendered state if refresh fails.
    }
  }, state.pollIntervalMs);
}

boot().catch((err) => {
  elements.metaLine.textContent = `Failed to load page: ${err.message}`;
  if (elements.refreshIndicator) {
    elements.refreshIndicator.dataset.status = "error";
    elements.refreshIndicator.textContent = "Live refresh unavailable due to page load error.";
  }
});

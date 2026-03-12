import { loadLiveState } from "./live-state.js";
import { isPreviewBracket, resolveBracketData } from "./bracket-preview.js";
import { renderBracketTable as renderSharedBracketTable } from "./shared-bracket.js";
import {
  bindImageFallbacks,
  byIdMap,
  dateLabel,
  escapeHtml,
  formatInt,
  formatNum,
  renderTeamCell
} from "./shared-ui.js";
import { html, nothing, render } from "https://esm.sh/lit-html@3.3.1";

const AUTO_REFRESH_STORAGE_KEY = "pool_public_auto_refresh_enabled";

const state = {
  meta: null,
  teams: [],
  players: [],
  bracket: {
    available: false,
    rounds: [],
    matchups: []
  },
  picks: [],
  owners: [],
  draft: {
    mode: "manual",
    order: [],
    picks_per_owner: 6
  },
  pollIntervalMs: 5000,
  liveSource: "none",
  liveUpdatedAt: null,
  refreshStatus: "pending",
  lastLiveCheckAt: null,
  refreshInFlight: false,
  autoRefreshEnabled: true,
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
  refreshToggle: document.querySelector("#refresh-toggle"),
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
  bracketSummary: document.querySelector("#bracket-summary"),
  bracketBody: document.querySelector("#bracket-body"),
  boardBody: document.querySelector("#board-body")
};

function renderManaged(target, value) {
  if (!target) return;
  if (!target.hasAttribute("data-lit-managed")) {
    target.textContent = "";
    target.setAttribute("data-lit-managed", "1");
  }
  render(value, target);
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
  if (!value || typeof value !== "object") return { mode: "manual", order: [], picks_per_owner: 6 };
  const mode = value.mode === "snake" ? "snake" : "manual";
  const order = normalizeOwners(value.order);
  const picksPerOwner = Math.min(50, Math.max(1, Math.floor(Number(value.picks_per_owner ?? value.picksPerOwner ?? 6) || 6)));
  return { mode, order, picks_per_owner: picksPerOwner };
}

function picksPerOwnerValue() {
  return Math.min(50, Math.max(1, Math.floor(Number(state.draft?.picks_per_owner ?? 6) || 6)));
}

function maxDraftPickCount() {
  const owners = state.draft.order.length > 0 ? state.draft.order : state.owners;
  if (owners.length === 0) return 0;
  return owners.length * picksPerOwnerValue();
}

function isDraftComplete() {
  const max = maxDraftPickCount();
  return max > 0 && state.picks.length >= max;
}

function seedValue(playerOrTeam) {
  const seed = Number(playerOrTeam?.team_seed ?? playerOrTeam?.seed);
  return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function regionValue(playerOrTeam) {
  const region = String(playerOrTeam?.team_region ?? playerOrTeam?.region ?? "").trim();
  return region || null;
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

function roundForPickNo(pickNo) {
  const order = state.draft.order.length > 0 ? state.draft.order : state.owners;
  if (!Number.isInteger(pickNo) || pickNo <= 0 || order.length === 0) return null;
  return Math.floor((pickNo - 1) / order.length) + 1;
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
  const liveUpdated = state.liveUpdatedAt ?? state.meta?.generated_at ?? null;
  elements.metaLine.textContent = liveUpdated
    ? `Live picks updated: ${new Date(liveUpdated).toLocaleString()}`
    : "Live picks updated: pending";
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

function renderStatus() {
  const pickCount = state.picks.length;
  const nextPickNo = pickCount + 1;
  const totalPickCap = maxDraftPickCount();
  const draftComplete = isDraftComplete();
  const liveUnavailable = state.liveSource !== "supabase_rest";
  const nextUp = draftComplete ? { onClockOwner: null, nextUpOwner: null } : nextUpInfo(nextPickNo);
  const onClockOwner = nextUp.onClockOwner;
  const nextOwner = nextUp.nextUpOwner;
  const lastPick = [...state.picks].sort((a, b) => a.pick_no - b.pick_no).at(-1) ?? null;
  const pickedIds = new Set(state.picks.map((pick) => Number(pick.player_id)));
  const availableCount = Math.max(0, state.players.length - pickedIds.size);
  const playersById = byIdMap(state.players, "player_id");
  const teamsById = byIdMap(state.teams, "team_id");

  elements.liveStatusSub.textContent = `Draft mode: ${state.draft.mode} | Picks per owner: ${picksPerOwnerValue()} | Total picks: ${pickCount}${
    totalPickCap > 0 ? `/${totalPickCap}` : ""
  }`;
  const currentRound = roundForPickNo(nextPickNo);
  if (draftComplete) {
    elements.statusPick.textContent = `Round ${picksPerOwnerValue()} • Complete`;
  } else if (currentRound) {
    elements.statusPick.textContent = `Round ${currentRound} • Pick #${nextPickNo}`;
  } else {
    elements.statusPick.textContent = `#${nextPickNo}`;
  }
  if (draftComplete) {
    renderManaged(elements.statusOnClock, html`Draft complete`);
  } else if (liveUnavailable && pickCount === 0) {
    renderManaged(elements.statusOnClock, html`Live feed unavailable`);
  } else if (!onClockOwner) {
    renderManaged(elements.statusOnClock, html`No order set`);
  } else if (nextOwner) {
    renderManaged(
      elements.statusOnClock,
      html`<span class="status-on-clock-owner">${onClockOwner}</span>
        <span class="status-on-clock-next">Next: ${nextOwner}</span>`
    );
  } else {
    renderManaged(elements.statusOnClock, html`${onClockOwner}`);
  }
  if (!lastPick && liveUnavailable) {
    renderManaged(elements.statusLatest, html`Waiting for live picks`);
  } else if (!lastPick) {
    renderManaged(elements.statusLatest, html`No picks yet`);
  } else {
    const player = playersById.get(Number(lastPick.player_id));
    const playerName = lastPick.player_name ?? player?.player_name ?? "Unknown";
    const teamName = lastPick.team_name ?? player?.team_name ?? "Unknown";
    const teamId = player?.team_id ?? lastPick.team_id ?? null;
    const teamAbbreviation = player?.team_abbreviation ?? null;
    const teamLogo = player?.team_logo ?? null;

    renderManaged(
      elements.statusLatest,
      html`<span class="latest-pick-primary">#${formatInt(lastPick.pick_no)} ${lastPick.owner}: ${playerName}</span>
        <span class="latest-pick-secondary"
          >${renderTeamCell(teamsById, {
            teamId,
            teamName,
            teamAbbreviation,
            teamLogo
          })}</span
        >`
    );
    bindImageFallbacks(elements.statusLatest);
  }
  elements.statusAvailable.textContent = `${availableCount} of ${state.players.length}`;
}

function renderDraftOrder() {
  if (!elements.draftOrderMeta || !elements.draftOrderBody) return;
  const order = state.draft.order.length > 0 ? state.draft.order : state.owners;
  const nextPickNo = state.picks.length + 1;
  const totalPickCap = maxDraftPickCount();
  const complete = isDraftComplete();
  const nextUp = complete ? { onClockOwner: null, nextUpOwner: null, nextUpPickNo: null, immediateOwner: null } : nextUpInfo(nextPickNo);
  const onClockOwner = nextUp.onClockOwner;
  const nextOwner = nextUp.nextUpOwner;
  const nextUpPickNo = nextUp.nextUpPickNo;
  const hasBackToBack = nextUp.immediateOwner === onClockOwner;
  renderManaged(
    elements.draftOrderMeta,
    order.length > 0
      ? html`
          <article class="draft-order-highlight">
            <span class="draft-order-highlight-label">Owners</span>
            <strong>${order.length}</strong>
          </article>
          <article class="draft-order-highlight">
            <span class="draft-order-highlight-label">Mode</span>
            <strong>${state.draft.mode}</strong>
          </article>
          <article class="draft-order-highlight">
            <span class="draft-order-highlight-label">Picks</span>
            <strong>${state.picks.length}${totalPickCap > 0 ? `/${totalPickCap}` : ""}</strong>
          </article>
          <article class="draft-order-highlight">
            <span class="draft-order-highlight-label">${complete ? "Status" : "On Clock"}</span>
            <strong>${complete ? "Complete" : onClockOwner ?? "-"}</strong>
            ${!complete && nextOwner
              ? html`<span class="draft-order-highlight-sub">Next: ${nextOwner}${nextUpPickNo ? ` (#${nextUpPickNo})` : ""}</span>`
              : nothing}
          </article>
        `
      : html`<article class="draft-order-highlight draft-order-highlight-empty">
          <span class="draft-order-highlight-label">Draft Order</span>
          <strong>No order published</strong>
        </article>`
  );

  if (order.length === 0) {
    render(html`<tr><td colspan="3">No draft order available.</td></tr>`, elements.draftOrderBody);
    return;
  }

  render(
    html`${order.map((owner, idx) => {
      let rowClass = "";
      let chipClass = "";
      let statusText = complete ? "Complete" : "Waiting";

      if (!complete && owner === onClockOwner) {
        rowClass = " is-on-clock";
        chipClass = " chip-on-clock";
        statusText = hasBackToBack ? `On Clock + Next Up (#${nextPickNo} + #${nextPickNo + 1})` : `On Clock (#${nextPickNo})`;
      } else if (!complete && owner === nextOwner) {
        rowClass = " is-next-up";
        chipClass = " chip-next-up";
        statusText = `Next Up (#${nextUpPickNo ?? nextPickNo + 1})`;
      }

      return html`<tr class=${`draft-order-row${rowClass}`}>
        <td data-label="Spot"><span class="draft-order-spot">${idx + 1}</span></td>
        <td data-label="Owner"><span class="draft-order-owner">${owner}</span></td>
        <td data-label="Draft Status"><span class=${`order-chip${chipClass}`}>${statusText}</span></td>
      </tr>`;
    })}`,
    elements.draftOrderBody
  );
}

function renderBracketTable() {
  renderSharedBracketTable({
    bracket: state.bracket,
    summaryElement: elements.bracketSummary,
    bodyElement: elements.bracketBody,
    isPreview: isPreviewBracket(state.bracket),
    includeRegion: true,
    scheduledLabel: (row) => dateLabel(row?.date)
  });
}

function renderBoard(players) {
  const pickedByPlayerId = new Map(state.picks.map((pick) => [Number(pick.player_id), pick.owner]));
  const teamsById = byIdMap(state.teams, "team_id");
  const parts = [`Showing ${players.length} players`, `status: ${state.filters.playerStatus}`, `picked: ${state.picks.length}`];
  if (state.filters.teamQuery.trim()) parts.push(`team filter: "${state.filters.teamQuery.trim()}"`);
  if (state.filters.playerQuery.trim()) parts.push(`player filter: "${state.filters.playerQuery.trim()}"`);
  elements.filterSummary.textContent = parts.join(" | ");

  if (players.length === 0) {
    render(html`<tr><td colspan="5">No players match this filter.</td></tr>`, elements.boardBody);
    return;
  }

  render(
    html`${players.map((player) => {
      const owner = pickedByPlayerId.get(Number(player.player_id));
      const draftStatus = owner ? `Picked (${owner})` : "Eligible";
      return html`<tr>
        <td data-label="Player">${player.player_name}</td>
        <td data-label="Team"
          >${renderTeamCell(teamsById, {
            teamId: player.team_id,
            teamName: player.team_name,
            teamAbbreviation: player.team_abbreviation,
            teamLogo: player.team_logo
          })}</td
        >
        <td data-label="Region">${regionValue(player) ?? "-"}</td>
        <td data-label="Seed">${formatInt(seedValue(player))}</td>
        <td data-label="Draft Status">${draftStatus}</td>
      </tr>`;
    })}`,
    elements.boardBody
  );

  bindImageFallbacks();
}

function rerender() {
  const boardPlayers = sortedPlayersForBoard();
  renderMetaLine();
  renderRefreshIndicator();
  renderStatus();
  renderDraftOrder();
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
  elements.refreshToggle?.addEventListener("click", () => {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    writeAutoRefreshPreference(state.autoRefreshEnabled);
    renderRefreshToggle();
  });

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
  const [meta, teams, players, bracket, bracketPreview] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json"),
    loadJsonIfPresent("./data/bracket.json"),
    loadJsonIfPresent("./data/bracket-preview.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  state.bracket = resolveBracketData(
    bracket && typeof bracket === "object" ? bracket : { available: false, rounds: [], matchups: [] },
    bracketPreview && typeof bracketPreview === "object" ? bracketPreview : null
  );
}

async function boot() {
  await refreshStaticData();
  state.autoRefreshEnabled = readAutoRefreshPreference();

  bindEvents();
  renderRefreshToggle();
  await refreshLiveState();

  setInterval(async () => {
    if (!state.autoRefreshEnabled) return;
    if (state.refreshInFlight) return;
    state.refreshInFlight = true;
    try {
      await refreshStaticData();
      await refreshLiveState();
    } catch {
      // Keep the last rendered state if refresh fails.
    } finally {
      state.refreshInFlight = false;
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

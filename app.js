import { createSupabaseDraftStore } from "./supabase-draft-store.js";

const DEFAULT_OWNERS = Array.from({ length: 12 }, (_, i) => `Owner ${i + 1}`);
const DRAFT_MODES = {
  MANUAL: "manual",
  SNAKE: "snake"
};
let cachedTeamMap = null;
let cachedTeamMapSize = -1;

const state = {
  meta: null,
  teams: [],
  players: [],
  playerTotals: [],
  owners: [...DEFAULT_OWNERS],
  draft: {
    mode: DRAFT_MODES.MANUAL,
    order: [...DEFAULT_OWNERS]
  },
  picks: [],
  auth: {
    mode: "supabase",
    configured: false,
    isAdmin: false,
    session: null,
    source: "supabase",
    status: "Connecting to Supabase..."
  },
  sync: {
    saving: false,
    lastRemoteUpdate: null,
    lastError: null
  },
  draftStore: null,
  filters: {
    search: "",
    minMinutes: 0,
    teamQuery: "",
    status: "all"
  }
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  searchInput: document.querySelector("#search-input"),
  minMinutesInput: document.querySelector("#min-minutes"),
  teamFilter: document.querySelector("#team-filter"),
  teamOptions: document.querySelector("#team-options"),
  statusFilterGroup: document.querySelector("#status-filter-group"),
  filterSummary: document.querySelector("#filter-summary"),
  clearFiltersBtn: document.querySelector("#clear-filters"),
  downloadBoardBtn: document.querySelector("#download-board"),
  refreshPageBtn: document.querySelector("#refresh-page"),
  boardBody: document.querySelector("#draft-board-body"),
  ownersInput: document.querySelector("#owners-input"),
  saveOwnersBtn: document.querySelector("#save-owners"),
  draftMode: document.querySelector("#draft-mode"),
  randomizeOrderBtn: document.querySelector("#randomize-order"),
  resetOrderBtn: document.querySelector("#reset-order"),
  draftOrderPreview: document.querySelector("#draft-order-preview"),
  nextPickPreview: document.querySelector("#next-pick-preview"),
  dataStatusLine: document.querySelector("#data-status-line"),
  dataStatusNote: document.querySelector("#data-status-note"),
  syncSource: document.querySelector("#sync-source"),
  syncConnection: document.querySelector("#sync-connection"),
  syncLastUpdate: document.querySelector("#sync-last-update"),
  syncWriteStatus: document.querySelector("#sync-write-status"),
  syncError: document.querySelector("#sync-error"),
  downloadTeamsSnapshotBtn: document.querySelector("#download-teams-snapshot"),
  copyRefreshCommandBtn: document.querySelector("#copy-refresh-command"),
  authMeta: document.querySelector("#auth-meta"),
  authStatus: document.querySelector("#auth-status"),
  adminLockedMessage: document.querySelector("#admin-locked-message"),
  adminEmail: document.querySelector("#admin-email"),
  adminPassword: document.querySelector("#admin-password"),
  adminLoginBtn: document.querySelector("#admin-login"),
  adminLogoutBtn: document.querySelector("#admin-logout"),
  pickOwner: document.querySelector("#pick-owner"),
  pickPlayerSearch: document.querySelector("#pick-player-search"),
  pickPlayer: document.querySelector("#pick-player"),
  addPickBtn: document.querySelector("#add-pick"),
  pickLogBody: document.querySelector("#pick-log-body"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  exportPicksPdfBtn: document.querySelector("#export-picks-pdf"),
  downloadPicksCsvBtn: document.querySelector("#download-picks-csv"),
  downloadPicksBtn: document.querySelector("#download-picks"),
  uploadPicksBtn: document.querySelector("#upload-picks"),
  importFile: document.querySelector("#import-file"),
  resetPicksBtn: document.querySelector("#reset-picks")
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function teamByIdMap() {
  if (!cachedTeamMap || cachedTeamMapSize !== state.teams.length) {
    cachedTeamMap = byIdMap(state.teams, "team_id");
    cachedTeamMapSize = state.teams.length;
  }
  return cachedTeamMap;
}

function getTeamLogoUrl(teamId, explicitLogo = null) {
  if (explicitLogo && String(explicitLogo).trim() !== "") return String(explicitLogo).trim();
  const team = teamByIdMap().get(Number(teamId));
  if (team?.logo && String(team.logo).trim() !== "") return String(team.logo).trim();
  if (Number.isInteger(Number(teamId)) && Number(teamId) > 0) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${Number(teamId)}.png`;
  }
  return null;
}

function renderTeamCell({ teamId, teamName, teamAbbreviation, teamLogo }) {
  const logoUrl = getTeamLogoUrl(teamId, teamLogo);
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

function escapeCsv(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeOwnerList(values) {
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
    .filter((pick) => Number.isInteger(pick.player_id) && pick.owner);
}

function applyDraftPayload(payload) {
  if (!payload || typeof payload !== "object") return;

  if (Array.isArray(payload.owners) && payload.owners.length > 0) {
    state.owners = normalizeOwnerList(payload.owners);
  }

  if (payload.draft && typeof payload.draft === "object") {
    state.draft.mode = payload.draft.mode === DRAFT_MODES.SNAKE ? DRAFT_MODES.SNAKE : DRAFT_MODES.MANUAL;
    if (Array.isArray(payload.draft.order)) {
      state.draft.order = normalizeOwnerList(payload.draft.order);
    }
  }

  if (Array.isArray(payload.picks)) {
    state.picks = normalizePicks(payload.picks);
  }

  syncDraftOrderWithOwners();
}

function canEditDraft(showAlert = false) {
  if (!state.auth.configured) {
    if (showAlert) {
      alert("Admin tools require Supabase to be configured and reachable.");
    }
    return false;
  }
  if (state.auth.isAdmin) return true;
  if (showAlert) {
    alert("Admin sign-in required for draft controls.");
  }
  return false;
}

function adminOnlySections() {
  return document.querySelectorAll("[data-admin-only]");
}

function applyDraftLockState() {
  const editable = canEditDraft(false);
  for (const section of adminOnlySections()) {
    section.classList.toggle("is-locked", !editable);
    section.hidden = !editable;
    const controls = section.querySelectorAll("input, select, button");
    for (const control of controls) {
      control.disabled = !editable;
    }
  }

  if (elements.adminLockedMessage) {
    elements.adminLockedMessage.hidden = editable;
  }
}

function renderAuthState() {
  if (!elements.authMeta || !elements.authStatus) return;

  if (!state.auth.configured) {
    elements.authMeta.textContent = state.auth.status ?? "Supabase unavailable";
    elements.authStatus.textContent = "Admin controls are locked until Supabase config/connectivity is available.";
    if (elements.adminLoginBtn) elements.adminLoginBtn.disabled = true;
    if (elements.adminLogoutBtn) elements.adminLogoutBtn.disabled = true;
    return;
  }

  const email = state.auth.session?.user?.email ?? "Not signed in";
  const remoteTime = state.sync.lastRemoteUpdate
    ? ` | Remote sync: ${new Date(state.sync.lastRemoteUpdate).toLocaleString()}`
    : "";
  const errorText = state.sync.lastError ? ` | Last error: ${state.sync.lastError}` : "";

  elements.authMeta.textContent = `Mode: Supabase shared state | Pool: ${state.draftStore?.poolKey ?? "main"}`;
  elements.authStatus.textContent = `User: ${email} | Admin: ${state.auth.isAdmin ? "yes" : "no"}${remoteTime}${errorText}`;
  if (elements.adminLoginBtn) elements.adminLoginBtn.disabled = Boolean(state.auth.session) || state.sync.saving;
  if (elements.adminLogoutBtn) elements.adminLogoutBtn.disabled = !state.auth.session || state.sync.saving;
}

async function setSession(session) {
  state.auth.session = session ?? null;
  if (!state.auth.configured || !state.draftStore) {
    state.auth.isAdmin = false;
    return;
  }
  try {
    state.auth.isAdmin = await state.draftStore.isAdminSession(session);
  } catch (err) {
    state.auth.isAdmin = false;
    state.sync.lastError = err.message;
  }
}

async function persistDraftState({ showAlertOnError = true } = {}) {
  if (!state.auth.configured || !state.draftStore || !state.auth.isAdmin) return true;

  state.sync.saving = true;
  try {
    const result = await state.draftStore.saveState({
      owners: state.owners,
      draft: state.draft,
      picks: state.picks,
      updatedBy: state.auth.session?.user?.id ?? null
    });
    state.sync.lastRemoteUpdate = result.updated_at ?? new Date().toISOString();
    state.sync.lastError = null;
    return true;
  } catch (err) {
    state.sync.lastError = err.message;
    if (showAlertOnError) {
      alert(`Failed to sync to Supabase: ${err.message}`);
    }
    return false;
  } finally {
    state.sync.saving = false;
  }
}

async function loadRemoteDraftState() {
  if (!state.auth.configured || !state.draftStore) return;
  try {
    const remote = await state.draftStore.fetchState();
    applyDraftPayload(remote);
    state.sync.lastRemoteUpdate = remote.updated_at ?? null;
    state.sync.lastError = null;
    state.auth.source = "supabase";
  } catch (err) {
    state.sync.lastError = err.message;
  }
}

function shuffle(values) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function syncDraftOrderWithOwners() {
  const ownerSet = new Set(state.owners);
  const existing = normalizeOwnerList(state.draft.order).filter((owner) => ownerSet.has(owner));
  const missing = state.owners.filter((owner) => !existing.includes(owner));
  state.draft.order = [...existing, ...missing];
}

function snakeOwnerForPick(pickNo) {
  if (state.draft.mode !== DRAFT_MODES.SNAKE) return null;
  if (!Number.isInteger(pickNo) || pickNo <= 0 || state.draft.order.length === 0) return null;

  const owners = state.draft.order;
  const ownerCount = owners.length;
  const roundIndex = Math.floor((pickNo - 1) / ownerCount);
  const indexInRound = (pickNo - 1) % ownerCount;
  const isReverseRound = roundIndex % 2 === 1;
  const ownerIndex = isReverseRound ? ownerCount - 1 - indexInRound : indexInRound;
  return owners[ownerIndex] ?? null;
}

function pickedByPlayerId() {
  const map = new Map();
  for (const pick of state.picks) map.set(Number(pick.player_id), pick.owner);
  return map;
}

function totalsByPlayerId() {
  return byIdMap(state.playerTotals, "player_id");
}

function getFilteredPlayers({ ignoreStatus = false } = {}) {
  const search = state.filters.search.trim().toLowerCase();
  const minMinutes = Number(state.filters.minMinutes) || 0;
  const teamQuery = String(state.filters.teamQuery ?? "")
    .trim()
    .toLowerCase();
  const status = state.filters.status;
  const picked = pickedByPlayerId();

  return state.players.filter((player) => {
    const name = String(player.player_name ?? "").toLowerCase();
    const team = String(player.team_name ?? "").toLowerCase();
    const teamAbbr = String(player.team_abbreviation ?? "").toLowerCase();
    const isPicked = picked.has(Number(player.player_id));

    if (search && !name.includes(search) && !team.includes(search)) return false;
    if ((player.avg_minutes ?? 0) < minMinutes) return false;
    if (teamQuery && !team.includes(teamQuery) && !teamAbbr.includes(teamQuery)) return false;
    if (!ignoreStatus && status === "available" && isPicked) return false;
    if (!ignoreStatus && status === "picked" && !isPicked) return false;
    return true;
  });
}

function fillTeamFilter() {
  const teams = [...state.teams].sort((a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? ""));
  const seen = new Set();
  const options = [];
  for (const team of teams) {
    const name = String(team.team_name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push(`<option value="${escapeHtml(name)}"></option>`);
  }
  elements.teamOptions.innerHTML = options.join("");
  elements.teamFilter.value = String(state.filters.teamQuery ?? "");
}

function setStatusFilter(status) {
  state.filters.status = status === "available" || status === "picked" ? status : "all";
}

function renderStatusPills() {
  const pills = elements.statusFilterGroup?.querySelectorAll(".filter-pill") ?? [];
  for (const pill of pills) {
    const nextStatus = pill.getAttribute("data-status");
    pill.classList.toggle("is-active", nextStatus === state.filters.status);
  }
}

function fillOwnerSelectors() {
  const options = state.owners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("");
  elements.pickOwner.innerHTML = options;
  elements.ownersInput.value = state.owners.join(",");
}

function renderDraftControls() {
  syncDraftOrderWithOwners();
  elements.draftMode.value = state.draft.mode;

  if (state.draft.order.length === 0) {
    elements.draftOrderPreview.textContent = "Draft order: add owners first.";
  } else {
    const sequence = state.draft.order.map((owner, idx) => `${idx + 1}. ${owner}`).join(" -> ");
    elements.draftOrderPreview.textContent = `Draft order: ${sequence}`;
  }

  const nextPick = state.picks.length + 1;
  const expectedOwner = snakeOwnerForPick(nextPick);

  if (state.draft.mode === DRAFT_MODES.SNAKE && expectedOwner) {
    elements.nextPickPreview.textContent = `Next pick #${nextPick}: ${expectedOwner} (snake mode)`;
    elements.pickOwner.value = expectedOwner;
    elements.pickOwner.disabled = true;
  } else {
    elements.nextPickPreview.textContent = `Next pick #${nextPick}: choose owner manually`;
    elements.pickOwner.disabled = false;
  }
}

function fillPlayerPickSelector() {
  const picked = pickedByPlayerId();
  const search = String(elements.pickPlayerSearch?.value ?? "")
    .trim()
    .toLowerCase();
  const previousSelection = Number(elements.pickPlayer.value);

  let candidates = getFilteredPlayers({ ignoreStatus: true })
    .filter((player) => !picked.has(Number(player.player_id)))
    .sort((a, b) => (a.draft_rank ?? 999999) - (b.draft_rank ?? 999999));

  if (search) {
    candidates = candidates.filter((player) => {
      const blob = `${player.player_name ?? ""} ${player.team_name ?? ""} ${player.team_abbreviation ?? ""}`.toLowerCase();
      return blob.includes(search);
    });
  }

  if (candidates.length === 0) {
    elements.pickPlayer.innerHTML = `<option value="">No matching players</option>`;
    return;
  }

  elements.pickPlayer.innerHTML = candidates
    .map(
      (player) =>
        `<option value="${player.player_id}">#${formatInt(player.draft_rank)} ${escapeHtml(
          player.player_name
        )} (${escapeHtml(player.team_abbreviation ?? player.team_name)})</option>`
    )
    .join("");

  if (Number.isInteger(previousSelection) && candidates.some((p) => Number(p.player_id) === previousSelection)) {
    elements.pickPlayer.value = String(previousSelection);
  }
}

function renderDraftBoard() {
  const filtered = getFilteredPlayers().sort((a, b) => (a.draft_rank ?? 999999) - (b.draft_rank ?? 999999));
  const picked = pickedByPlayerId();
  const pickedCount = picked.size;
  const visiblePicked = filtered.filter((player) => picked.has(Number(player.player_id))).length;
  const visibleOpen = filtered.length - visiblePicked;

  elements.filterSummary.textContent = `Showing ${filtered.length} of ${state.players.length} players | Open ${visibleOpen} | Picked ${visiblePicked} (Total picked ${pickedCount})`;

  elements.boardBody.innerHTML = filtered
    .map((player) => {
      const owner = picked.get(Number(player.player_id));
      const statusClass = owner ? "status-picked" : "status-open";
      const statusText = owner ? `Picked (${owner})` : "Open";

      return `<tr>
        <td>${formatInt(player.draft_rank)}</td>
        <td>${escapeHtml(player.player_name)}</td>
        <td>${renderTeamCell({
          teamId: player.team_id,
          teamName: player.team_name,
          teamAbbreviation: player.team_abbreviation,
          teamLogo: player.team_logo
        })}</td>
        <td>${formatInt(player.team_seed)}</td>
        <td>${escapeHtml(player.position ?? "-")}</td>
        <td>${formatNum(player.avg_points)}</td>
        <td>${formatNum(player.avg_minutes)}</td>
        <td>${formatNum(player.avg_rebounds)}</td>
        <td>${formatNum(player.avg_assists)}</td>
        <td>${formatNum(player.avg_steals)}</td>
        <td>${formatNum(player.avg_blocks)}</td>
        <td>${formatNum(player.per)}</td>
        <td>${formatNum(player.draft_score, 2)}</td>
        <td class="${statusClass}">${escapeHtml(statusText)}</td>
      </tr>`;
    })
    .join("");
}

function renderPickLog() {
  const totals = totalsByPlayerId();
  const players = byIdMap(state.players, "player_id");

  elements.pickLogBody.innerHTML = state.picks
    .sort((a, b) => a.pick_no - b.pick_no)
    .map((pick) => {
      const total = totals.get(Number(pick.player_id));
      const player = players.get(Number(pick.player_id));
      const points = total?.tournament_points ?? 0;
      return `<tr>
        <td>${formatInt(pick.pick_no)}</td>
        <td>${escapeHtml(pick.owner)}</td>
        <td>${escapeHtml(pick.player_name)}</td>
        <td>${renderTeamCell({
          teamId: player?.team_id ?? pick.team_id,
          teamName: pick.team_name ?? player?.team_name,
          teamAbbreviation: player?.team_abbreviation,
          teamLogo: player?.team_logo
        })}</td>
        <td>${formatNum(points, 1)}</td>
      </tr>`;
    })
    .join("");
}

function renderLeaderboard() {
  const totals = totalsByPlayerId();
  const rows = state.owners.map((owner) => {
    const ownerPicks = state.picks.filter((pick) => pick.owner === owner);
    const totalPts = ownerPicks.reduce((sum, pick) => {
      const row = totals.get(Number(pick.player_id));
      return sum + (Number(row?.tournament_points) || 0);
    }, 0);

    return {
      owner,
      players: ownerPicks.length,
      totalPts
    };
  });

  rows.sort((a, b) => b.totalPts - a.totalPts || b.players - a.players || a.owner.localeCompare(b.owner));

  elements.leaderboardBody.innerHTML = rows
    .map(
      (row, index) => `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.owner)}</td>
      <td>${row.players}</td>
      <td>${formatNum(row.totalPts, 1)}</td>
    </tr>`
    )
    .join("");
}

function renderMetaLine() {
  const generated = state.meta?.generated_at
    ? new Date(state.meta.generated_at).toLocaleString()
    : "No generated data yet";
  const totals = state.meta?.totals ?? {};
  const source = state.meta?.team_source ?? "unknown";
  elements.metaLine.textContent = `Updated: ${generated} | Teams: ${totals.teams ?? 0} | Players: ${
    totals.players ?? 0
  } | Games: ${totals.final_events ?? 0} finals loaded | Team source: ${source}`;
}

function renderDataStatus() {
  if (!elements.dataStatusLine || !elements.dataStatusNote) return;

  const totals = state.meta?.totals ?? {};
  const mode = state.meta?.team_source_mode ?? "unknown";
  const source = state.meta?.team_source ?? "unknown";
  const detail = state.meta?.team_source_detail ?? "";
  const seededPlayers = totals.seeded_players ?? 0;
  const bracketTeams = state.meta?.bracket?.teams ?? 0;
  const bracketSeason = state.meta?.bracket?.season ?? "n/a";

  elements.dataStatusLine.textContent = `Mode: ${mode} | Source: ${source} ${detail ? `(${detail})` : ""} | Seeded players: ${seededPlayers} | Bracket teams detected: ${bracketTeams} (${bracketSeason})`;
  elements.dataStatusNote.textContent = state.meta?.note
    ? state.meta.note
    : "Auto mode uses official ESPN bracket teams/seeds when available, otherwise falls back to your configured team file.";
}

function renderSyncStats() {
  if (
    !elements.syncSource ||
    !elements.syncConnection ||
    !elements.syncLastUpdate ||
    !elements.syncWriteStatus ||
    !elements.syncError
  ) {
    return;
  }

  const source = String(state.auth.source ?? "supabase").replaceAll("_", " ");
  elements.syncSource.textContent = source;

  if (!state.auth.configured) {
    elements.syncConnection.textContent = "Unavailable";
  } else if (!state.auth.session) {
    elements.syncConnection.textContent = "Connected (signed out)";
  } else if (state.auth.isAdmin) {
    elements.syncConnection.textContent = "Connected (admin)";
  } else {
    elements.syncConnection.textContent = "Connected (read-only user)";
  }

  elements.syncLastUpdate.textContent = state.sync.lastRemoteUpdate
    ? new Date(state.sync.lastRemoteUpdate).toLocaleString()
    : "No successful sync";

  if (state.sync.saving) {
    elements.syncWriteStatus.textContent = "Saving...";
  } else if (state.sync.lastError) {
    elements.syncWriteStatus.textContent = "Error";
  } else if (state.auth.configured && state.auth.isAdmin) {
    elements.syncWriteStatus.textContent = "Ready";
  } else {
    elements.syncWriteStatus.textContent = "Locked";
  }

  elements.syncError.textContent = state.sync.lastError ? `Last sync error: ${state.sync.lastError}` : "No sync errors.";
}

function rerender() {
  renderMetaLine();
  renderDataStatus();
  renderSyncStats();
  renderAuthState();
  renderStatusPills();
  applyDraftLockState();
  renderDraftControls();
  renderDraftBoard();
  fillPlayerPickSelector();
  renderPickLog();
  renderLeaderboard();
  if (!canEditDraft(false)) applyDraftLockState();
  bindTeamLogoFallbacks();
}

async function onAddPick() {
  if (!canEditDraft(true)) return;

  const nextPickNo = state.picks.length + 1;
  const expectedOwner = snakeOwnerForPick(nextPickNo);
  const owner = expectedOwner ?? elements.pickOwner.value;
  const playerId = Number(elements.pickPlayer.value);
  if (!owner || !Number.isInteger(playerId)) return;

  if (state.picks.some((pick) => Number(pick.player_id) === playerId)) return;

  const player = state.players.find((p) => Number(p.player_id) === playerId);
  if (!player) return;

  state.picks.push({
    pick_no: nextPickNo,
    owner,
    player_id: playerId,
    player_name: player.player_name,
    team_name: player.team_name,
    team_id: player.team_id
  });

  if (elements.pickPlayerSearch) elements.pickPlayerSearch.value = "";
  await persistDraftState();
  rerender();
}

async function onSaveOwners() {
  if (!canEditDraft(true)) return;

  const parsed = normalizeOwnerList(
    elements.ownersInput.value
    .split(",")
    .map((x) => x.trim())
  );

  if (parsed.length === 0) return;

  state.owners = parsed;
  syncDraftOrderWithOwners();
  await persistDraftState();
  fillOwnerSelectors();
  rerender();
}

function onDownloadBoard() {
  const filtered = getFilteredPlayers().sort((a, b) => (a.draft_rank ?? 999999) - (b.draft_rank ?? 999999));
  const picked = pickedByPlayerId();

  const headers = [
    "rank",
    "player",
    "team",
    "seed",
    "position",
    "ppg",
    "mpg",
    "rpg",
    "apg",
    "spg",
    "bpg",
    "per",
    "draft_score",
    "status"
  ];

  const lines = [headers.join(",")];
  for (const p of filtered) {
    const owner = picked.get(Number(p.player_id));
    const row = [
      p.draft_rank,
      p.player_name,
      p.team_name,
      p.team_seed,
      p.position,
      p.avg_points,
      p.avg_minutes,
      p.avg_rebounds,
      p.avg_assists,
      p.avg_steals,
      p.avg_blocks,
      p.per,
      p.draft_score,
      owner ? `Picked (${owner})` : "Open"
    ];
    lines.push(row.map(escapeCsv).join(","));
  }

  downloadText("draft-board.csv", `${lines.join("\n")}\n`, "text/csv");
}

function onDownloadTeamsSnapshot() {
  const payload = {
    exported_at: new Date().toISOString(),
    team_source_mode: state.meta?.team_source_mode ?? null,
    team_source: state.meta?.team_source ?? null,
    team_source_detail: state.meta?.team_source_detail ?? null,
    bracket: state.meta?.bracket ?? null,
    totals: state.meta?.totals ?? null,
    teams: state.teams
  };
  downloadText("teams.snapshot.json", `${JSON.stringify(payload, null, 2)}\n`, "application/json");
}

function buildRefreshCommand() {
  const year = state.meta?.year ?? new Date().getUTCFullYear();
  const seasonType = state.meta?.season_type ?? 2;
  const teamFile = "config/teams.current.json";
  const discoverDates = Array.isArray(state.meta?.discover_dates) && state.meta.discover_dates.length > 0
    ? state.meta.discover_dates.join(",")
    : `${year}0317,${year}0318,${year}0319,${year}0320`;
  const gameStart = state.meta?.game_start ?? `${year}0317`;
  const gameEnd = state.meta?.game_end ?? "";

  const parts = [
    "npm run refresh --",
    `--year=${year}`,
    `--seasonType=${seasonType}`,
    "--team_source_mode=auto",
    `--team_file=${teamFile}`,
    `--team_discovery_dates=${discoverDates}`,
    `--game_start_date=${gameStart}`
  ];
  if (gameEnd) parts.push(`--game_end_date=${gameEnd}`);
  return parts.join(" ");
}

async function onCopyRefreshCommand() {
  const command = buildRefreshCommand();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
      alert("Refresh command copied.");
      return;
    }
  } catch {
    // Ignore and fall back.
  }

  const accepted = window.prompt("Copy this refresh command:", command);
  if (accepted === null) return;
}

function onDownloadPicks() {
  const payload = {
    exported_at: new Date().toISOString(),
    owners: state.owners,
    draft: state.draft,
    picks: state.picks
  };
  downloadText("pool-picks.json", `${JSON.stringify(payload, null, 2)}\n`, "application/json");
}

function onDownloadPicksCsv() {
  const totals = totalsByPlayerId();
  const players = byIdMap(state.players, "player_id");
  const exportedAt = new Date().toISOString();

  const headers = [
    "pick_no",
    "owner",
    "player_id",
    "player_name",
    "team_name",
    "team_logo_url",
    "team_seed",
    "position",
    "draft_rank",
    "tournament_points",
    "tournament_minutes",
    "tournament_games_played",
    "exported_at"
  ];

  const lines = [headers.join(",")];
  for (const pick of [...state.picks].sort((a, b) => a.pick_no - b.pick_no)) {
    const totalsRow = totals.get(Number(pick.player_id));
    const playerRow = players.get(Number(pick.player_id));
    const row = [
      pick.pick_no,
      pick.owner,
      pick.player_id,
      pick.player_name,
      pick.team_name,
      getTeamLogoUrl(playerRow?.team_id ?? pick.team_id, playerRow?.team_logo),
      playerRow?.team_seed ?? null,
      playerRow?.position ?? null,
      playerRow?.draft_rank ?? null,
      totalsRow?.tournament_points ?? 0,
      totalsRow?.tournament_minutes ?? 0,
      totalsRow?.games_played ?? 0,
      exportedAt
    ];
    lines.push(row.map(escapeCsv).join(","));
  }

  downloadText("pool-picks.csv", `${lines.join("\n")}\n`, "text/csv");
}

function onExportPicksPdf() {
  const players = byIdMap(state.players, "player_id");
  const picks = [...state.picks].sort((a, b) => a.pick_no - b.pick_no);
  const generatedAt = new Date().toLocaleString();

  const rowsHtml = picks
    .map((pick) => {
      const player = players.get(Number(pick.player_id));
      const playerName = pick.player_name ?? player?.player_name ?? "Unknown";
      const teamName = pick.team_name ?? player?.team_name ?? "-";
      const teamSeed = player?.team_seed ?? "-";

      return `<tr>
        <td>${formatInt(pick.pick_no)}</td>
        <td>${escapeHtml(pick.owner)}</td>
        <td>${escapeHtml(playerName)}</td>
        <td>${escapeHtml(teamName)}</td>
        <td>${escapeHtml(formatInt(teamSeed))}</td>
      </tr>`;
    })
    .join("");

  // `noopener,noreferrer` can cause some browsers to return `null` even when a tab opens.
  // Open plainly so we can reliably write print markup, then detach opener.
  const popup = window.open("", "_blank");
  if (!popup) {
    alert("Popup blocked by browser. Exporting CSV instead.");
    onDownloadPicksCsv();
    return;
  }
  try {
    popup.opener = null;
  } catch {
    // Ignore if browser disallows setting opener.
  }

  popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NCAA Pool Draft Picks</title>
    <style>
      body {
        margin: 24px;
        color: #152433;
        font-family: Arial, sans-serif;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 24px;
      }
      p {
        margin: 0 0 14px;
        color: #445566;
        font-size: 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      th,
      td {
        padding: 7px 8px;
        border: 1px solid #ccd4dd;
        text-align: left;
      }
      th {
        background: #f2f6fa;
      }
      @media print {
        body {
          margin: 10mm;
        }
      }
    </style>
  </head>
  <body>
    <h1>NCAA Pool Draft Picks</h1>
    <p>Generated: ${escapeHtml(generatedAt)} | Total picks: ${picks.length}</p>
    <table>
      <thead>
        <tr>
          <th>Pick</th>
          <th>Owner</th>
          <th>Player</th>
          <th>Team</th>
          <th>Seed</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="5">No picks available.</td></tr>`}
      </tbody>
    </table>
    <script>
      window.addEventListener("load", () => {
        setTimeout(() => {
          window.print();
        }, 100);
      });
    </script>
  </body>
</html>`);
  popup.document.close();
}

async function onImportPicks(file) {
  if (!canEditDraft(true)) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result ?? "{}"));
      applyDraftPayload(parsed);
      await persistDraftState();
      fillOwnerSelectors();
      rerender();
    } catch {
      alert("Invalid JSON file.");
    }
  };

  reader.readAsText(file);
}

async function onAdminLogin() {
  if (!state.auth.configured || !state.draftStore) return;
  const email = String(elements.adminEmail?.value ?? "").trim();
  const password = String(elements.adminPassword?.value ?? "");
  if (!email || !password) {
    alert("Enter admin email and password.");
    return;
  }

  try {
    state.sync.lastError = null;
    await state.draftStore.signInWithPassword(email, password);
    const session = await state.draftStore.getSession();
    await setSession(session);
    await loadRemoteDraftState();
    fillOwnerSelectors();
    if (elements.adminPassword) elements.adminPassword.value = "";
    if (!state.auth.isAdmin) {
      alert("Signed in, but this account is not in admin_users. Ask an existing admin to grant access.");
    }
    rerender();
  } catch (err) {
    state.sync.lastError = err.message;
    alert(`Sign-in failed: ${err.message}`);
    rerender();
  }
}

async function onAdminLogout() {
  if (!state.auth.configured || !state.draftStore) return;
  try {
    await state.draftStore.signOut();
    await setSession(null);
    rerender();
  } catch (err) {
    state.sync.lastError = err.message;
    alert(`Sign-out failed: ${err.message}`);
    rerender();
  }
}

async function initDraftStore() {
  try {
    state.draftStore = await createSupabaseDraftStore();
    state.auth.configured = Boolean(state.draftStore?.enabled);
    state.auth.mode = "supabase";
    state.auth.isAdmin = false;
    state.auth.status = state.draftStore?.reason ?? "Supabase configured";

    if (!state.auth.configured) return;

    const session = await state.draftStore.getSession();
    await setSession(session);
    await loadRemoteDraftState();

    state.draftStore.onAuthStateChange((_, nextSession) => {
      void (async () => {
        await setSession(nextSession);
        await loadRemoteDraftState();
        fillOwnerSelectors();
        rerender();
      })();
    });
  } catch (err) {
    console.warn(`Supabase unavailable: ${err.message}`);
    state.auth.configured = false;
    state.auth.mode = "supabase";
    state.auth.isAdmin = false;
    state.auth.status = `Supabase unavailable: ${err.message}`;
    state.draftStore = null;
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    state.filters.search = elements.searchInput.value;
    rerender();
  });

  elements.minMinutesInput.addEventListener("input", () => {
    state.filters.minMinutes = Number(elements.minMinutesInput.value) || 0;
    rerender();
  });

  elements.teamFilter.addEventListener("change", () => {
    state.filters.teamQuery = elements.teamFilter.value;
    rerender();
  });

  elements.teamFilter.addEventListener("input", () => {
    state.filters.teamQuery = elements.teamFilter.value;
    rerender();
  });

  elements.statusFilterGroup.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest(".filter-pill[data-status]");
    if (!button) return;
    setStatusFilter(button.getAttribute("data-status"));
    rerender();
  });

  elements.pickPlayerSearch.addEventListener("input", () => {
    fillPlayerPickSelector();
  });

  elements.draftMode.addEventListener("change", () => {
    if (!canEditDraft(true)) {
      rerender();
      return;
    }
    state.draft.mode = elements.draftMode.value === DRAFT_MODES.SNAKE ? DRAFT_MODES.SNAKE : DRAFT_MODES.MANUAL;
    void persistDraftState().then(() => rerender());
  });

  elements.randomizeOrderBtn.addEventListener("click", () => {
    if (!canEditDraft(true)) return;
    if (state.owners.length < 2) return;
    if (state.picks.length > 0) {
      const ok = window.confirm("Randomizing draft order now affects only future picks. Continue?");
      if (!ok) return;
    }
    syncDraftOrderWithOwners();
    state.draft.order = shuffle(state.draft.order);
    void persistDraftState().then(() => rerender());
  });

  elements.resetOrderBtn.addEventListener("click", () => {
    if (!canEditDraft(true)) return;
    state.draft.order = [...state.owners];
    void persistDraftState().then(() => rerender());
  });

  elements.clearFiltersBtn.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.minMinutes = 0;
    state.filters.teamQuery = "";
    setStatusFilter("all");

    elements.searchInput.value = "";
    elements.minMinutesInput.value = "0";
    elements.teamFilter.value = "";

    rerender();
  });

  elements.downloadBoardBtn.addEventListener("click", onDownloadBoard);
  elements.refreshPageBtn.addEventListener("click", () => window.location.reload());
  elements.downloadTeamsSnapshotBtn?.addEventListener("click", onDownloadTeamsSnapshot);
  elements.copyRefreshCommandBtn?.addEventListener("click", () => {
    void onCopyRefreshCommand();
  });
  elements.saveOwnersBtn.addEventListener("click", () => {
    void onSaveOwners();
  });
  elements.addPickBtn.addEventListener("click", () => {
    void onAddPick();
  });
  elements.exportPicksPdfBtn?.addEventListener("click", onExportPicksPdf);
  elements.downloadPicksCsvBtn.addEventListener("click", onDownloadPicksCsv);
  elements.downloadPicksBtn.addEventListener("click", onDownloadPicks);

  elements.uploadPicksBtn.addEventListener("click", () => {
    elements.importFile.value = "";
    elements.importFile.click();
  });

  elements.importFile.addEventListener("change", () => {
    const file = elements.importFile.files?.[0];
    if (file) {
      void onImportPicks(file);
    }
  });

  elements.resetPicksBtn.addEventListener("click", () => {
    if (!canEditDraft(true)) return;
    const poolKey = state.draftStore?.poolKey ?? "main";
    const ok = window.confirm(
      `Reset all picks for shared pool "${poolKey}"?\n\nThis clears picks for everyone using this pool.`
    );
    if (!ok) return;
    state.picks = [];
    if (elements.pickPlayerSearch) elements.pickPlayerSearch.value = "";
    void persistDraftState().then(() => rerender());
  });

  elements.adminLoginBtn?.addEventListener("click", () => {
    void onAdminLogin();
  });
  elements.adminLogoutBtn?.addEventListener("click", () => {
    void onAdminLogout();
  });
  elements.adminPassword?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void onAdminLogin();
  });
}

async function loadJson(file) {
  const response = await fetch(file, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return response.json();
}

async function boot() {
  const [meta, teams, players, playerTotals] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json"),
    loadJson("./data/player_totals.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  state.playerTotals = Array.isArray(playerTotals) ? playerTotals : [];
  cachedTeamMap = null;
  cachedTeamMapSize = -1;

  await initDraftStore();
  fillTeamFilter();
  fillOwnerSelectors();
  bindEvents();
  rerender();
}

boot().catch((err) => {
  elements.metaLine.textContent = `Load error: ${err.message}`;
  console.error(err);
});

const STORAGE_KEY = "ncaa_pool_state_v1";
const DEFAULT_OWNERS = Array.from({ length: 12 }, (_, i) => `Owner ${i + 1}`);

const state = {
  meta: null,
  teams: [],
  players: [],
  playerTotals: [],
  owners: [...DEFAULT_OWNERS],
  picks: [],
  filters: {
    search: "",
    minMinutes: 0,
    selectedTeams: new Set()
  }
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  searchInput: document.querySelector("#search-input"),
  minMinutesInput: document.querySelector("#min-minutes"),
  teamFilter: document.querySelector("#team-filter"),
  clearFiltersBtn: document.querySelector("#clear-filters"),
  downloadBoardBtn: document.querySelector("#download-board"),
  refreshPageBtn: document.querySelector("#refresh-page"),
  boardBody: document.querySelector("#draft-board-body"),
  ownersInput: document.querySelector("#owners-input"),
  saveOwnersBtn: document.querySelector("#save-owners"),
  pickOwner: document.querySelector("#pick-owner"),
  pickPlayer: document.querySelector("#pick-player"),
  addPickBtn: document.querySelector("#add-pick"),
  pickLogBody: document.querySelector("#pick-log-body"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function saveState() {
  const payload = {
    owners: state.owners,
    picks: state.picks
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.owners) && parsed.owners.length > 0) {
      state.owners = parsed.owners.map((o) => String(o).trim()).filter(Boolean);
    }

    if (Array.isArray(parsed.picks)) {
      state.picks = parsed
        .map((pick) => ({
          pick_no: Number(pick.pick_no),
          owner: String(pick.owner ?? "").trim(),
          player_id: Number(pick.player_id),
          player_name: pick.player_name ?? null,
          team_name: pick.team_name ?? null
        }))
        .filter((pick) => Number.isInteger(pick.pick_no) && Number.isInteger(pick.player_id) && pick.owner);
    }
  } catch {
    console.warn("Unable to parse saved local state.");
  }
}

function pickedByPlayerId() {
  const map = new Map();
  for (const pick of state.picks) map.set(Number(pick.player_id), pick.owner);
  return map;
}

function totalsByPlayerId() {
  return byIdMap(state.playerTotals, "player_id");
}

function getFilteredPlayers() {
  const search = state.filters.search.trim().toLowerCase();
  const minMinutes = Number(state.filters.minMinutes) || 0;
  const selectedTeams = state.filters.selectedTeams;

  return state.players.filter((player) => {
    const name = String(player.player_name ?? "").toLowerCase();
    const team = String(player.team_name ?? "").toLowerCase();

    if (search && !name.includes(search) && !team.includes(search)) return false;
    if ((player.avg_minutes ?? 0) < minMinutes) return false;
    if (selectedTeams.size > 0 && !selectedTeams.has(String(player.team_id))) return false;
    return true;
  });
}

function fillTeamFilter() {
  const teams = [...state.teams].sort((a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? ""));
  elements.teamFilter.innerHTML = teams
    .map((team) => `<option value="${team.team_id}">${escapeHtml(team.team_name)}</option>`)
    .join("");
}

function fillOwnerSelectors() {
  const options = state.owners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("");
  elements.pickOwner.innerHTML = options;
  elements.ownersInput.value = state.owners.join(",");
}

function fillPlayerPickSelector() {
  const picked = pickedByPlayerId();
  const candidates = getFilteredPlayers()
    .filter((player) => !picked.has(Number(player.player_id)))
    .sort((a, b) => (a.draft_rank ?? 999999) - (b.draft_rank ?? 999999));

  elements.pickPlayer.innerHTML = candidates
    .map(
      (player) =>
        `<option value="${player.player_id}">#${formatInt(player.draft_rank)} ${escapeHtml(
          player.player_name
        )} (${escapeHtml(player.team_abbreviation ?? player.team_name)})</option>`
    )
    .join("");
}

function renderDraftBoard() {
  const filtered = getFilteredPlayers().sort((a, b) => (a.draft_rank ?? 999999) - (b.draft_rank ?? 999999));
  const picked = pickedByPlayerId();

  elements.boardBody.innerHTML = filtered
    .map((player) => {
      const owner = picked.get(Number(player.player_id));
      const statusClass = owner ? "status-picked" : "status-open";
      const statusText = owner ? `Picked (${owner})` : "Open";

      return `<tr>
        <td>${formatInt(player.draft_rank)}</td>
        <td>${escapeHtml(player.player_name)}</td>
        <td>${escapeHtml(player.team_name)}</td>
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

  elements.pickLogBody.innerHTML = state.picks
    .sort((a, b) => a.pick_no - b.pick_no)
    .map((pick) => {
      const total = totals.get(Number(pick.player_id));
      const points = total?.tournament_points ?? 0;
      return `<tr>
        <td>${formatInt(pick.pick_no)}</td>
        <td>${escapeHtml(pick.owner)}</td>
        <td>${escapeHtml(pick.player_name)}</td>
        <td>${escapeHtml(pick.team_name)}</td>
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

function rerender() {
  renderMetaLine();
  renderDraftBoard();
  fillPlayerPickSelector();
  renderPickLog();
  renderLeaderboard();
}

function onAddPick() {
  const owner = elements.pickOwner.value;
  const playerId = Number(elements.pickPlayer.value);
  if (!owner || !Number.isInteger(playerId)) return;

  if (state.picks.some((pick) => Number(pick.player_id) === playerId)) return;

  const player = state.players.find((p) => Number(p.player_id) === playerId);
  if (!player) return;

  state.picks.push({
    pick_no: state.picks.length + 1,
    owner,
    player_id: playerId,
    player_name: player.player_name,
    team_name: player.team_name
  });

  saveState();
  rerender();
}

function onSaveOwners() {
  const parsed = elements.ownersInput.value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (parsed.length === 0) return;

  state.owners = parsed;
  saveState();
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

function onDownloadPicks() {
  const payload = {
    exported_at: new Date().toISOString(),
    owners: state.owners,
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

function onImportPicks(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result ?? "{}"));
      if (Array.isArray(parsed.owners) && parsed.owners.length > 0) {
        state.owners = parsed.owners.map((o) => String(o).trim()).filter(Boolean);
      }

      if (Array.isArray(parsed.picks)) {
        state.picks = parsed.picks
          .map((pick, idx) => ({
            pick_no: Number(pick.pick_no) || idx + 1,
            owner: String(pick.owner ?? "").trim(),
            player_id: Number(pick.player_id),
            player_name: pick.player_name ?? null,
            team_name: pick.team_name ?? null
          }))
          .filter((pick) => Number.isInteger(pick.player_id) && pick.owner);
      }

      saveState();
      fillOwnerSelectors();
      rerender();
    } catch {
      alert("Invalid JSON file.");
    }
  };

  reader.readAsText(file);
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
    const selected = [...elements.teamFilter.selectedOptions].map((opt) => opt.value);
    state.filters.selectedTeams = new Set(selected);
    rerender();
  });

  elements.clearFiltersBtn.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.minMinutes = 0;
    state.filters.selectedTeams = new Set();

    elements.searchInput.value = "";
    elements.minMinutesInput.value = "0";
    for (const option of elements.teamFilter.options) option.selected = false;

    rerender();
  });

  elements.downloadBoardBtn.addEventListener("click", onDownloadBoard);
  elements.refreshPageBtn.addEventListener("click", () => window.location.reload());
  elements.saveOwnersBtn.addEventListener("click", onSaveOwners);
  elements.addPickBtn.addEventListener("click", onAddPick);
  elements.downloadPicksCsvBtn.addEventListener("click", onDownloadPicksCsv);
  elements.downloadPicksBtn.addEventListener("click", onDownloadPicks);

  elements.uploadPicksBtn.addEventListener("click", () => {
    elements.importFile.value = "";
    elements.importFile.click();
  });

  elements.importFile.addEventListener("change", () => {
    const file = elements.importFile.files?.[0];
    if (file) onImportPicks(file);
  });

  elements.resetPicksBtn.addEventListener("click", () => {
    const ok = window.confirm("Reset all picks on this device?");
    if (!ok) return;
    state.picks = [];
    saveState();
    rerender();
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

  loadState();
  fillTeamFilter();
  fillOwnerSelectors();
  bindEvents();
  rerender();
}

boot().catch((err) => {
  elements.metaLine.textContent = `Load error: ${err.message}`;
  console.error(err);
});

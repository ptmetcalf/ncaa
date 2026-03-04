import { loadLiveState } from "./live-state.js";

const state = {
  meta: null,
  teams: [],
  players: [],
  picks: [],
  liveSource: "none",
  liveUpdatedAt: null,
  randomOrder: new Map(),
  filters: {
    search: "",
    minMinutes: 0,
    teamQuery: ""
  }
};

const elements = {
  metaLine: document.querySelector("#meta-line"),
  searchInput: document.querySelector("#search-input"),
  minMinutesInput: document.querySelector("#min-minutes"),
  teamFilter: document.querySelector("#team-filter"),
  teamOptions: document.querySelector("#team-options"),
  filterSummary: document.querySelector("#filter-summary"),
  clearFiltersBtn: document.querySelector("#clear-filters"),
  reloadLiveBtn: document.querySelector("#reload-live"),
  boardBody: document.querySelector("#board-body")
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
}

function availablePlayers() {
  const picked = new Set(state.picks.map((pick) => Number(pick.player_id)));
  const search = state.filters.search.trim().toLowerCase();
  const teamQuery = state.filters.teamQuery.trim().toLowerCase();
  const minMinutes = Number(state.filters.minMinutes) || 0;

  return state.players.filter((player) => {
    if (picked.has(Number(player.player_id))) return false;
    const name = String(player.player_name ?? "").toLowerCase();
    const team = String(player.team_name ?? "").toLowerCase();
    const teamAbbr = String(player.team_abbreviation ?? "").toLowerCase();

    if (search && !name.includes(search) && !team.includes(search)) return false;
    if (teamQuery && !team.includes(teamQuery) && !teamAbbr.includes(teamQuery)) return false;
    if ((player.avg_minutes ?? 0) < minMinutes) return false;
    return true;
  });
}

function randomSort(players) {
  for (const player of players) {
    const id = Number(player.player_id);
    if (!state.randomOrder.has(id)) state.randomOrder.set(id, Math.random());
  }
  return [...players].sort((a, b) => {
    return state.randomOrder.get(Number(a.player_id)) - state.randomOrder.get(Number(b.player_id));
  });
}

function renderMetaLine() {
  const generated = state.meta?.generated_at
    ? new Date(state.meta.generated_at).toLocaleString()
    : "No generated data yet";
  const liveUpdated = state.liveUpdatedAt ? new Date(state.liveUpdatedAt).toLocaleString() : "unknown";
  elements.metaLine.textContent = `Stats refresh: ${generated} | Live picks source: ${state.liveSource} | Live picks updated: ${liveUpdated}`;
}

function renderBoard() {
  const teamMap = byIdMap(state.teams, "team_id");
  const available = randomSort(availablePlayers());
  elements.filterSummary.textContent = `Available players: ${available.length} | Picked players: ${state.picks.length}`;

  elements.boardBody.innerHTML = available
    .map((player) => {
      return `<tr>
        <td>${escapeHtml(player.player_name)}</td>
        <td>${renderTeamCell(teamMap, {
          teamId: player.team_id,
          teamName: player.team_name,
          teamAbbreviation: player.team_abbreviation,
          teamLogo: player.team_logo
        })}</td>
        <td>${formatInt(player.team_seed)}</td>
        <td>${escapeHtml(player.position ?? "-")}</td>
        <td>${formatNum(player.avg_points)}</td>
        <td>${formatNum(player.avg_minutes)}</td>
        <td>${formatNum(player.draft_score, 2)}</td>
      </tr>`;
    })
    .join("");

  bindTeamLogoFallbacks();
}

function rerender() {
  renderMetaLine();
  renderBoard();
}

async function refreshLiveState() {
  const live = await loadLiveState();
  state.picks = Array.isArray(live.picks) ? live.picks : [];
  state.liveSource = live.source ?? "none";
  state.liveUpdatedAt = live.updated_at ?? null;
  rerender();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    state.filters.search = elements.searchInput.value;
    renderBoard();
  });

  elements.teamFilter.addEventListener("input", () => {
    state.filters.teamQuery = elements.teamFilter.value;
    renderBoard();
  });

  elements.minMinutesInput.addEventListener("input", () => {
    state.filters.minMinutes = Number(elements.minMinutesInput.value) || 0;
    renderBoard();
  });

  elements.clearFiltersBtn.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.teamQuery = "";
    state.filters.minMinutes = 0;

    elements.searchInput.value = "";
    elements.teamFilter.value = "";
    elements.minMinutesInput.value = "0";
    renderBoard();
  });

  elements.reloadLiveBtn.addEventListener("click", () => {
    refreshLiveState();
  });
}

async function loadJson(file) {
  const response = await fetch(file, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return response.json();
}

async function boot() {
  const [meta, teams, players] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/teams.json"),
    loadJson("./data/players.json")
  ]);

  state.meta = meta;
  state.teams = Array.isArray(teams) ? teams : [];
  state.players = Array.isArray(players) ? players : [];
  fillTeamFilter();
  bindEvents();
  await refreshLiveState();

  // Keep the public board synced during the draft.
  setInterval(() => {
    refreshLiveState();
  }, 15000);
}

boot().catch((err) => {
  elements.metaLine.textContent = `Failed to load board: ${err.message}`;
});

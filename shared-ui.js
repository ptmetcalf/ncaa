import { html, nothing } from "https://esm.sh/lit-html@3.3.1";

export function byIdMap(rows, idKey = "player_id") {
  const map = new Map();
  for (const row of rows ?? []) {
    const id = Number(row?.[idKey]);
    if (!Number.isInteger(id)) continue;
    map.set(id, row);
  }
  return map;
}

export function formatNum(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

export function formatInt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return String(Math.round(Number(value)));
}

export function dateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function firstLetterToken(value) {
  const token = String(value ?? "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (token.length === 0) return "TM";
  if (token.length === 1) return token[0].slice(0, 2).toUpperCase();
  return `${token[0][0] ?? ""}${token[1][0] ?? ""}`.toUpperCase();
}

export function getTeamLogoUrl(teamMap, teamId, explicitLogo = null) {
  if (explicitLogo && String(explicitLogo).trim() !== "") return String(explicitLogo).trim();
  const team = teamMap?.get(Number(teamId));
  if (team?.logo && String(team.logo).trim() !== "") return String(team.logo).trim();
  if (Number.isInteger(Number(teamId)) && Number(teamId) > 0) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${Number(teamId)}.png`;
  }
  return null;
}

export function renderTeamCell(teamMap, { teamId, teamName, teamAbbreviation, teamLogo }) {
  const logoUrl = getTeamLogoUrl(teamMap, teamId, teamLogo);
  const fallback = firstLetterToken(teamAbbreviation || teamName);
  return html`<span class="team-cell"
    ><span class="team-logo-wrap"
      >${logoUrl
        ? html`<img class="team-logo-img" src=${logoUrl} alt="${teamName ?? "Team"} logo" loading="lazy" />`
        : html`<span class="team-logo-fallback is-visible">${fallback}</span>`}
      ${logoUrl ? html`<span class="team-logo-fallback">${fallback}</span>` : nothing}</span
    ><span class="team-cell-name">${teamName ?? "-"}</span></span
  >`;
}

export function renderPlayerCell({ playerName, headshot }) {
  const fallback = firstLetterToken(playerName);
  return html`<span class="player-cell"
    ><span class="player-headshot-wrap"
      >${headshot
        ? html`<img class="player-headshot-img" src=${headshot} alt="${playerName ?? "Player"} headshot" loading="lazy" />`
        : html`<span class="player-headshot-fallback is-visible">${fallback}</span>`}
      ${headshot ? html`<span class="player-headshot-fallback">${fallback}</span>` : nothing}</span
    ><span class="player-cell-name">${playerName ?? "-"}</span></span
  >`;
}

export function bindImageFallbacks(root = document) {
  const images = root.querySelectorAll(
    "img.team-logo-img:not([data-logo-bound]), img.player-headshot-img:not([data-logo-bound])"
  );
  for (const img of images) {
    img.setAttribute("data-logo-bound", "1");
    const wrap = img.closest(".team-logo-wrap, .player-headshot-wrap");
    const fallback = wrap?.querySelector(".team-logo-fallback, .player-headshot-fallback");
    const showFallback = () => {
      img.classList.add("is-hidden");
      if (fallback) fallback.classList.add("is-visible");
    };
    img.addEventListener("error", showFallback);
    if (img.complete && img.naturalWidth === 0) showFallback();
  }
}

import { html, render } from "https://esm.sh/lit-html@3.3.1";
import { dateLabel, formatInt } from "./shared-ui.js";

function defaultScheduleLabel(row) {
  return dateLabel(row?.date);
}

export function renderBracketTable({
  bracket,
  summaryElement,
  bodyElement,
  isPreview = false,
  includeRegion = true,
  emptySummary = "Bracket not published yet.",
  emptyMessage = "No bracket matchups available.",
  scheduledLabel = defaultScheduleLabel
}) {
  if (!summaryElement || !bodyElement) return;

  const rounds = new Map(
    (bracket?.rounds ?? [])
      .map((round) => [Number(round.id), String(round.label ?? `Round ${round.id}`)])
      .filter(([id]) => Number.isInteger(id))
  );
  const regions = new Map(
    (bracket?.regions ?? [])
      .map((region) => [Number(region.id), String(region.label ?? `Region ${region.id}`)])
      .filter(([id]) => Number.isInteger(id))
  );
  const rows = [...(bracket?.matchups ?? [])].sort((a, b) => {
    const aRound = Number.isFinite(Number(a.round_id)) ? Number(a.round_id) : 99;
    const bRound = Number.isFinite(Number(b.round_id)) ? Number(b.round_id) : 99;
    if (aRound !== bRound) return aRound - bRound;
    const aLoc = Number(a.bracket_location) || 999;
    const bLoc = Number(b.bracket_location) || 999;
    if (aLoc !== bLoc) return aLoc - bLoc;
    return String(a.date ?? "").localeCompare(String(b.date ?? ""));
  });

  const colCount = includeRegion ? 4 : 3;
  if (rows.length === 0) {
    summaryElement.textContent = emptySummary;
    render(html`<tr><td colspan=${colCount}>${emptyMessage}</td></tr>`, bodyElement);
    return;
  }

  const completed = rows.filter((row) => row.status_state === "post").length;
  const previewPrefix = isPreview ? "Projected bracket | " : "";
  summaryElement.textContent = `${previewPrefix}Matchups: ${rows.length} | Final: ${completed}`;

  render(
    html`${rows.map((row) => {
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
      } else if (row.status_state === "pre" && isPreview) {
        statusText = row.status_desc ?? "Projected matchup";
      } else if (row.status_state === "pre") {
        statusText = scheduledLabel(row);
      }

      return html`<tr>
        <td>${roundLabel}</td>
        ${includeRegion ? html`<td>${regions.get(Number(row.region_id)) ?? "-"}</td>` : ""}
        <td>${`${oneLabel} vs ${twoLabel}`}</td>
        <td>${statusText}</td>
      </tr>`;
    })}`,
    bodyElement
  );
}

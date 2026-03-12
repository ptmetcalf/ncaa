function hasMatchups(bracket) {
  return Array.isArray(bracket?.matchups) && bracket.matchups.length > 0;
}

export function resolveBracketData(officialBracket, previewBracket) {
  if (hasMatchups(officialBracket)) return officialBracket;
  if (hasMatchups(previewBracket)) return { ...previewBracket, preview: true };
  return officialBracket && typeof officialBracket === "object"
    ? officialBracket
    : { available: false, rounds: [], matchups: [] };
}

export function isPreviewBracket(bracket) {
  return bracket?.preview === true;
}

import { SUPABASE_ANON_KEY, SUPABASE_POOL_KEY, SUPABASE_URL } from "./supabase-config.js";

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

async function loadFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, reason: "supabase_not_configured" };
  }

  const baseUrl = String(SUPABASE_URL).replace(/\/+$/, "");
  const url =
    `${baseUrl}/rest/v1/pool_state?` +
    `pool_key=eq.${encodeURIComponent(SUPABASE_POOL_KEY)}&` +
    "select=owners,draft,picks,updated_at&limit=1";

  try {
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      cache: "no-store"
    });
    if (!response.ok) return { ok: false, reason: `supabase_http_${response.status}` };
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !Array.isArray(row.picks)) {
      return { ok: false, reason: "supabase_no_pool_state" };
    }

    return {
      ok: true,
      owners: Array.isArray(row.owners) ? row.owners : [],
      draft: row.draft ?? null,
      picks: normalizePicks(row.picks),
      updated_at: row.updated_at ?? null,
      source: "supabase_rest"
    };
  } catch {
    return { ok: false, reason: "supabase_unreachable" };
  }
}

export async function loadLiveState() {
  const supabaseResult = await loadFromSupabase();
  if (supabaseResult.ok) return supabaseResult;

  return {
    owners: [],
    draft: null,
    picks: [],
    updated_at: null,
    source: supabaseResult.reason ?? "supabase_unavailable"
  };
}

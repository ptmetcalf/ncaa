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

function normalizeDraftState(row) {
  return {
    owners: normalizeOwnerList(row?.owners),
    draft: row?.draft && typeof row.draft === "object" ? row.draft : { mode: "manual", order: [] },
    picks: normalizePicks(row?.picks),
    updated_at: row?.updated_at ?? null
  };
}

let cachedClientPromise = null;

async function getSupabaseClient() {
  if (cachedClientPromise) return cachedClientPromise;
  cachedClientPromise = (async () => {
    const module = await import("https://esm.sh/@supabase/supabase-js@2");
    const { createClient } = module;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  })();
  return cachedClientPromise;
}

export async function createSupabaseDraftStore() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      enabled: false,
      reason: "Supabase config not set",
      poolKey: SUPABASE_POOL_KEY
    };
  }

  const client = await getSupabaseClient();
  const adminCache = new Map();

  async function isAdminSession(session) {
    const userId = session?.user?.id ?? null;
    if (!userId) return false;

    if (adminCache.has(userId)) return adminCache.get(userId);

    const { data, error } = await client.rpc("is_pool_admin");
    if (error) throw new Error(`Admin check failed: ${error.message}`);
    const isAdmin = Boolean(data);
    adminCache.set(userId, isAdmin);
    return isAdmin;
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
    adminCache.clear();
  }

  function onAuthStateChange(callback) {
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") adminCache.clear();
      callback(event, session);
    });
    return () => data.subscription.unsubscribe();
  }

  async function fetchState() {
    const { data, error } = await client
      .from("pool_state")
      .select("owners,draft,picks,updated_at")
      .eq("pool_key", SUPABASE_POOL_KEY)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return normalizeDraftState(data);
  }

  async function saveState({ owners, draft, picks, updatedBy }) {
    const payload = {
      pool_key: SUPABASE_POOL_KEY,
      owners: normalizeOwnerList(owners),
      draft: draft && typeof draft === "object" ? draft : { mode: "manual", order: [] },
      picks: normalizePicks(picks),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null
    };

    const { data, error } = await client
      .from("pool_state")
      .upsert(payload, { onConflict: "pool_key" })
      .select("updated_at")
      .single();

    if (error) throw new Error(error.message);
    return {
      updated_at: data?.updated_at ?? payload.updated_at
    };
  }

  return {
    enabled: true,
    reason: null,
    poolKey: SUPABASE_POOL_KEY,
    getSession,
    signInWithPassword,
    signOut,
    onAuthStateChange,
    fetchState,
    saveState,
    isAdminSession
  };
}

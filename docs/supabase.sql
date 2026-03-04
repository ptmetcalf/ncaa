-- Run this once in Supabase SQL Editor.
-- It creates:
--   1) shared pool state (public read, admin write)
--   2) admin_users allow-list keyed by auth user id
--   3) helper RPC function used by the frontend to check admin status

create table if not exists public.pool_state (
  pool_key text primary key,
  owners jsonb not null default '[]'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  picks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.pool_state (pool_key)
values ('main')
on conflict (pool_key) do nothing;

alter table public.pool_state enable row level security;
alter table public.admin_users enable row level security;

-- Replace any prior policies from older setup versions.
drop policy if exists "pool_state_public_read" on public.pool_state;
drop policy if exists "pool_state_admin_write" on public.pool_state;
drop policy if exists "pool_state_admin_insert" on public.pool_state;
drop policy if exists "pool_state_admin_update" on public.pool_state;
drop policy if exists "admin_users_self_read" on public.admin_users;

create or replace function public.is_pool_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_pool_admin() from public;
grant execute on function public.is_pool_admin() to anon, authenticated;

-- Public read for public-board/public-leaderboard pages.
create policy "pool_state_public_read"
on public.pool_state
for select
using (true);

-- Admin write only. Upsert from app requires both INSERT and UPDATE policies.
create policy "pool_state_admin_insert"
on public.pool_state
for insert
with check (public.is_pool_admin());

create policy "pool_state_admin_update"
on public.pool_state
for update
using (public.is_pool_admin())
with check (public.is_pool_admin());

-- Optional: allow signed-in users to check if they themselves are admin.
create policy "admin_users_self_read"
on public.admin_users
for select
using (user_id = auth.uid());

-- After users exist in Supabase Auth, add admins by user id.
-- Example:
-- insert into public.admin_users (user_id)
-- values ('00000000-0000-0000-0000-000000000000')
-- on conflict (user_id) do nothing;

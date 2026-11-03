-- supabase/migrations/0001_init.sql
--
-- Cloud event log for the TCC game: event batches per user, consent records,
-- the admin list, and the access rules (row-level security).
--
-- Run once, as the project owner (the Supabase SQL editor runs as `postgres`).
-- Spec: docs/superpowers/specs/2026-11-03-supabase-design.md, sections 7, 8, 12.
-- Setup guide: docs/supabase-setup.md. RLS check: supabase/tests/rls_check.sql.
--
-- Access summary (enforced below by privileges + RLS, both must allow):
--   player (authenticated, not admin):
--     event_batches  select/insert/update own rows only (user_id = auth.uid()); no delete
--     consents       select/insert own rows only; no update, no delete
--     admins         select own row only (to learn whether it is admin); no writes
--     events_flat    no rows (admins only)
--     delete_my_data() deletes the caller's batches and consents
--   admin (authenticated, row in admins): additionally reads every row of the
--     three tables and the events_flat view. Admins do NOT get extra write rights.
--   anon: no access to any table, view or function defined here.
--   admins table: written only by SQL as the owner (postgres), never by the API.
--
-- Deviation from spec section 8 ("player only inserts"): players may UPDATE their
-- own batches, because the client resends a batch with the same
-- (user_id, session_id, first_seq) as an upsert when it has grown. This is
-- idempotent and limited to the player's own rows.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.event_batches (
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  session_id text        not null,
  first_seq  integer     not null,
  last_seq   integer     not null,
  events     jsonb       not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, first_seq),
  constraint event_batches_first_seq_nonneg check (first_seq >= 0),
  constraint event_batches_seq_order        check (last_seq >= first_seq),
  constraint event_batches_events_is_array  check (jsonb_typeof(events) = 'array'),
  -- Sanity cap against abuse: the client sends at most 500 events per batch
  -- (docs/supabase-volume.md, about 145 KB each); 1000 leaves headroom.
  -- Postgres checks constraints in name order, so this one may run before
  -- events_is_array: the CASE keeps jsonb_array_length from erroring on a
  -- non-array (which is then rejected as a normal check violation).
  constraint event_batches_events_cap       check (
    case when jsonb_typeof(events) = 'array'
         then jsonb_array_length(events) <= 1000
         else false end),
  constraint event_batches_session_id_len   check (char_length(session_id) between 1 and 200)
);

comment on table public.event_batches is
  'One row per batch of NDJSON events (jsonb array, same shape as the local log). Resending the same (user_id, session_id, first_seq) upserts.';

create table public.consents (
  user_id       uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,
  terms_version text        not null,
  accepted_at   timestamptz not null default now(),
  primary key (user_id, terms_version),
  constraint consents_terms_version_len check (char_length(terms_version) between 1 and 100)
);

comment on table public.consents is
  'One row per accepted version of the consent terms. accepted_at is set by the server (clients cannot write it).';

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

comment on table public.admins is
  'Users listed here are administrators. Filled only by SQL as the owner, never by the game.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Supabase grants ALL on new public tables/functions to anon and authenticated
-- by default. Revoke everything and grant back only what each policy needs.
-- ---------------------------------------------------------------------------

revoke all on table public.event_batches from public, anon, authenticated;
revoke all on table public.consents      from public, anon, authenticated;
revoke all on table public.admins        from public, anon, authenticated;

-- event_batches: created_at is not writable by clients (server default only).
-- UPDATE lists the key columns too because an upsert (insert ... on conflict
-- do update) from PostgREST sets every column it was sent; RLS WITH CHECK keeps
-- user_id = auth.uid() on the new row.
grant select on table public.event_batches to authenticated;
grant insert (user_id, session_id, first_seq, last_seq, events)
  on table public.event_batches to authenticated;
grant update (user_id, session_id, first_seq, last_seq, events)
  on table public.event_batches to authenticated;

-- consents: accepted_at is not writable by clients (server default only).
grant select on table public.consents to authenticated;
grant insert (user_id, terms_version) on table public.consents to authenticated;

-- admins: read only. No insert/update/delete privilege for any API role.
grant select on table public.admins to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.event_batches enable row level security;
alter table public.consents      enable row level security;
alter table public.admins        enable row level security;

-- is_admin(): true when the caller (auth.uid()) has a row in admins.
-- security definer so it can read admins without going through admins' own
-- RLS (avoids recursion); search_path is empty and every name is qualified.
-- It takes no argument, so it can only answer about the caller.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- event_batches policies. `(select auth.uid())` is evaluated once per query
-- (Supabase's recommended form), same meaning as auth.uid().
create policy event_batches_select_own on public.event_batches
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy event_batches_select_admin on public.event_batches
  for select to authenticated
  using ((select public.is_admin()));

create policy event_batches_insert_own on public.event_batches
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy event_batches_update_own on public.event_batches
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No delete policy (and no delete privilege): deletion only via delete_my_data().

-- consents policies.
create policy consents_select_own on public.consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy consents_select_admin on public.consents
  for select to authenticated
  using ((select public.is_admin()));

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- admins policies: read only, never write.
create policy admins_select_own on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy admins_select_admin on public.admins
  for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- delete_my_data(): the player's right to erase (spec section 12).
-- security definer because players have no delete privilege/policy; it deletes
-- only rows of auth.uid() and refuses to run without a signed-in user.
-- The admins row (if any) is kept; remove it by SQL if wanted.
-- ---------------------------------------------------------------------------

create function public.delete_my_data()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_my_data: no authenticated user'
      using errcode = '42501';
  end if;
  delete from public.event_batches where user_id = uid;
  delete from public.consents      where user_id = uid;
end;
$$;

revoke all on function public.delete_my_data() from public, anon, authenticated;
grant execute on function public.delete_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- events_flat: one row per event, for research queries and export (admins).
--
-- Resent batches overlap (a bigger batch with the same first_seq replaces the
-- old row, but a later batch may also start inside an earlier one), so each
-- (user_id, session_id, seq) keeps the copy from the batch with the highest
-- last_seq (ties: latest created_at).
--
-- Access, two layers on purpose:
--   1. security_invoker = true: the view reads event_batches with the CALLER's
--      rights, so RLS on event_batches always applies. Without it the view
--      would run as its owner (postgres) and bypass RLS entirely, and a single
--      mistake in the filter would expose everything.
--   2. where public.is_admin(): with invoker rights alone a player would see
--      their own events here; the spec says the view is for admins only, so
--      non-admins get zero rows. (Plus the owner roles, see the filter below.)
--
-- Extracted columns use safe casts (null when the JSON value is not a number)
-- so one malformed event sent by a player cannot break the admin's export.
-- Events without a numeric seq are left out of the view (the raw rows stay in
-- event_batches).
-- ---------------------------------------------------------------------------

create view public.events_flat
with (security_invoker = true)
as
select distinct on (x.user_id, x.session_id, x.seq)
  x.user_id,
  x.session_id,
  x.seq,
  x.event ->> 'type' as type,
  -- Nested CASE (not AND) so the type test is guaranteed to run before the cast.
  case when jsonb_typeof(x.event -> 'run_idx') = 'number' then
    case when (x.event -> 'run_idx')::text::numeric between -2147483648 and 2147483647
         then (x.event -> 'run_idx')::text::numeric::integer end
  end as run_idx,
  case when jsonb_typeof(x.event -> 't_ms') = 'number' then
    case when abs((x.event -> 't_ms')::text::numeric) < 1e300
         then (x.event -> 't_ms')::text::numeric::double precision end
  end as t_ms,
  x.event,
  x.first_seq as batch_first_seq,
  x.last_seq  as batch_last_seq
from (
  select
    b.user_id,
    b.session_id,
    b.first_seq,
    b.last_seq,
    b.created_at,
    e.event,
    case when jsonb_typeof(e.event -> 'seq') = 'number' then
      case when (e.event -> 'seq')::text::numeric between 0 and 9223372036854775807
           then (e.event -> 'seq')::text::numeric::bigint end
    end as seq
  from public.event_batches b
  cross join lateral jsonb_array_elements(b.events) as e(event)
  -- current_user here is the CALLER (security_invoker). The allowlisted roles
  -- already bypass RLS and can read event_batches directly, so they gain
  -- nothing new; they are listed so the dashboard SQL editor (runs as
  -- postgres, where auth.uid() is null) can export. API users (anon,
  -- authenticated) get rows only through is_admin().
  where public.is_admin()
     or current_user in ('postgres', 'service_role', 'supabase_admin')
) x
where x.seq is not null
order by x.user_id, x.session_id, x.seq, x.last_seq desc, x.created_at desc;

comment on view public.events_flat is
  'One row per event (deduplicated across overlapping batches). Admins only: security_invoker + is_admin() filter.';

revoke all on table public.events_flat from public, anon, authenticated;
grant select on table public.events_flat to authenticated;

commit;

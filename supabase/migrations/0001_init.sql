-- supabase/migrations/0001_init.sql
--
-- Cloud event log for the TCC game: event batches per user, consent records,
-- the admin list, and the access rules (row-level security).
--
-- Run once, as the project owner (the Supabase SQL editor runs as `postgres`).
-- Spec: docs/superpowers/specs/2026-11-03-supabase-design.md, sections 7, 8, 12,
-- with the identity changes of docs/superpowers/specs/2026-11-05-clerk-auth-design.md
-- (section 5): users sign in with Clerk, and Supabase is only the database.
-- Setup guide: docs/supabase-setup.md. RLS check: supabase/tests/rls_check.sql.
--
-- Who is the caller: Supabase accepts the Clerk session token (third-party
-- auth). PostgREST switches to the database role named by the token's `role`
-- claim (`authenticated` for a signed-in Clerk user) and exposes the verified
-- claims through auth.jwt(). The caller's id is the `sub` claim: the Clerk
-- user id, a text such as 'user_...'. Every rule below reads
-- nullif(auth.jwt() ->> 'sub', ''): a token without `sub` (or with an empty
-- one) is no user at all and matches no row.
-- user_id is text and has no foreign key: users live in Clerk, not in the
-- Supabase Auth user table. Deleting a user in Clerk deletes nothing here; the
-- only way rows are deleted is delete_my_data(expected) (or SQL by the owner).
--
-- Access summary (enforced below by privileges + RLS, both must allow):
--   player (authenticated, not admin):
--     event_batches  select/insert/update own rows only (user_id = sub); no delete
--     consents       select/insert own rows only; no update, no delete
--     admins         select own row only (to learn whether it is admin); no writes
--     events_flat    no rows (admins only)
--     delete_my_data(expected) deletes the caller's batches and consents, only
--       when `expected` is the caller (the token's sub); otherwise it raises 42501
--   admin (authenticated, row in admins): additionally reads every row of the
--     three tables and the events_flat view. Admins do NOT get extra write rights.
--   anon: no access to any table, view or function defined here (no grants,
--     whatever claims its token carries).
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
  user_id    text        not null default (nullif(auth.jwt() ->> 'sub', '')),
  session_id text        not null,
  first_seq  integer     not null,
  last_seq   integer     not null,
  events     jsonb       not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, first_seq),
  constraint event_batches_user_id_len      check (char_length(user_id) between 1 and 200),
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
  -- Byte cap (1 MiB, about 7x a full 500-event batch): stops a few huge
  -- events from filling the free-plan database. Same CASE form as above
  -- (pg_column_size itself does not error; the guard keeps the checks uniform).
  constraint event_batches_events_bytes     check (
    case when jsonb_typeof(events) = 'array'
         then pg_column_size(events) <= 1048576
         else false end),
  constraint event_batches_session_id_len   check (char_length(session_id) between 1 and 200)
);

comment on table public.event_batches is
  'One row per batch of NDJSON events (jsonb array, same shape as the local log). Resending the same (user_id, session_id, first_seq) upserts.';

create table public.consents (
  user_id       text        not null default (nullif(auth.jwt() ->> 'sub', '')),
  terms_version text        not null,
  accepted_at   timestamptz not null default now(),
  primary key (user_id, terms_version),
  constraint consents_user_id_len       check (char_length(user_id) between 1 and 200),
  constraint consents_terms_version_len check (char_length(terms_version) between 1 and 100)
);

comment on table public.consents is
  'One row per accepted version of the consent terms. accepted_at is set by the server (clients cannot write it).';

create table public.admins (
  user_id text primary key,
  constraint admins_user_id_len check (char_length(user_id) between 1 and 200)
);

comment on table public.admins is
  'Users listed here are administrators (user_id = Clerk user id). Filled only by SQL as the owner, never by the game.';

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
-- user_id = the token's sub on the new row.
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

-- is_admin(): true when the caller (the token's sub) has a row in admins;
-- false without a token or without sub.
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
    select 1 from public.admins a where a.user_id = nullif(auth.jwt() ->> 'sub', '')
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- event_batches policies. `(select nullif(auth.jwt() ->> 'sub', ''))` is
-- evaluated once per query (Supabase's recommended form). When it is null (no
-- token, no sub, empty sub) `user_id = null` is never true: no rows.
create policy event_batches_select_own on public.event_batches
  for select to authenticated
  using (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

create policy event_batches_select_admin on public.event_batches
  for select to authenticated
  using ((select public.is_admin()));

create policy event_batches_insert_own on public.event_batches
  for insert to authenticated
  with check (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

create policy event_batches_update_own on public.event_batches
  for update to authenticated
  using (user_id = (select nullif(auth.jwt() ->> 'sub', '')))
  with check (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

-- No delete policy (and no delete privilege): deletion only via delete_my_data(expected).

-- Resends only grow a batch. If an update would make last_seq smaller (a
-- stale, shorter resend of the same (user_id, session_id, first_seq)), keep
-- the stored row unchanged by returning OLD. Silent on purpose: the upsert
-- succeeds and the client needs no special case. Security invoker (default),
-- empty search_path; touches nothing but the row being updated.
create function public.event_batches_keep_bigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_seq < old.last_seq then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.event_batches_keep_bigger() from public, anon, authenticated;

create trigger event_batches_keep_bigger
  before update on public.event_batches
  for each row execute function public.event_batches_keep_bigger();

-- consents policies.
create policy consents_select_own on public.consents
  for select to authenticated
  using (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

create policy consents_select_admin on public.consents
  for select to authenticated
  using ((select public.is_admin()));

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

-- admins policies: read only, never write.
create policy admins_select_own on public.admins
  for select to authenticated
  using (user_id = (select nullif(auth.jwt() ->> 'sub', '')));

create policy admins_select_admin on public.admins
  for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- delete_my_data(expected): the player's right to erase (spec section 12).
-- security definer because players have no delete privilege/policy; it deletes
-- only rows of the token's sub and refuses to run without one (no token, no
-- sub, empty sub).
-- `expected` is the account the game means to erase (the Clerk user id it
-- shows as signed in). If the request's token belongs to anyone else (another
-- account signed in meanwhile, in another tab), it raises 42501 and deletes
-- nothing, instead of erasing the wrong account.
-- The admins row (if any) is kept (remove it by SQL if wanted). The Clerk
-- account (e-mail) is outside this database; deleting it in Clerk does not
-- delete these rows (there is no foreign key), so this function is the only
-- way a player's rows are erased.
-- ---------------------------------------------------------------------------

create function public.delete_my_data(expected text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid text := nullif(auth.jwt() ->> 'sub', '');
begin
  if uid is null then
    raise exception 'delete_my_data: no authenticated user'
      using errcode = '42501';
  end if;
  if expected is null or expected <> uid then
    raise exception 'delete_my_data: the signed-in user is not the expected one'
      using errcode = '42501';
  end if;
  delete from public.event_batches where user_id = uid;
  delete from public.consents      where user_id = uid;
end;
$$;

revoke all on function public.delete_my_data(text) from public, anon, authenticated;
grant execute on function public.delete_my_data(text) to authenticated;

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
-- Events without a whole-number seq are left out of the view (the raw rows
-- stay in event_batches).
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
  -- numeric, not double precision: exact (no float rounding) and cannot overflow.
  case when jsonb_typeof(x.event -> 't_ms') = 'number'
       then (x.event -> 't_ms')::text::numeric
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
    -- Only whole numbers count as seq: 1.4 and 1.6 would both round to 1
    -- and collide in the dedup, so non-integers are left out (seq null).
    case when jsonb_typeof(e.event -> 'seq') = 'number' then
      case when (e.event -> 'seq')::text::numeric between 0 and 9223372036854775807
            and (e.event -> 'seq')::text::numeric = trunc((e.event -> 'seq')::text::numeric)
           then (e.event -> 'seq')::text::numeric::bigint end
    end as seq
  from public.event_batches b
  cross join lateral jsonb_array_elements(b.events) as e(event)
  -- current_user here is the CALLER (security_invoker). The allowlisted roles
  -- already bypass RLS and can read event_batches directly, so they gain
  -- nothing new; they are listed so the dashboard SQL editor (runs as
  -- postgres, with no token, so is_admin() is false) can export. API users (anon,
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

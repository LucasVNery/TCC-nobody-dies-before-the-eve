-- supabase/tests/rls_check.sql
--
-- Checks the access rules of supabase/migrations/0001_init.sql.
--
-- RUN ONLY IN A TEST PROJECT (never in production), in the Supabase SQL editor,
-- after applying 0001_init.sql there. Paste the whole file and run it once.
--
-- How it works
--   * The whole check is ONE `do` block. It ends by raising an exception whose
--     message is the report, one line per check, `OK` or `FALHOU`. Raising an
--     exception makes Postgres roll back everything the block did (the two
--     throwaway users, their batches, consents and the admins row), whatever
--     client runs it. So the editor will show an ERROR: that is expected; read
--     the message. The last line says `RESULTADO: TODOS OK` or
--     `RESULTADO: HA FALHAS`. Any other error means the script itself could
--     not run (see "Users" below). The same report is also emitted as a
--     NOTICE just before the exception (psql shows it).
--   * Two users are simulated the way PostgREST does it: `set local role
--     authenticated` plus `request.jwt.claims` with the user's id as `sub`
--     (auth.uid() reads that claim). `reset role` goes back to the owner.
--
-- Users
--   event_batches/consents/admins have a foreign key to auth.users, so real
--   auth.users rows are needed. The script creates two throwaway users inside
--   the block with a minimal insert into auth.users (id, instance_id, aud,
--   role, email); the other columns have defaults or are nullable. This is the
--   approach used by common Supabase test helpers and needs the editor to run
--   as `postgres` (its default). They disappear with the rollback.
--   NOT VERIFIED here (no Supabase/Postgres available when this was written):
--   if Supabase ever restricts inserts into auth.users for `postgres`, the
--   block fails with a permission error on auth.users. Then create two users
--   in Authentication > Users of the TEST project, and replace the two
--   `insert into auth.users` lines and the gen_random_uuid() values of
--   `a`/`b` below with their ids.

do $rls_check$
declare
  a  uuid := gen_random_uuid();   -- player A (not admin)
  b  uuid := gen_random_uuid();   -- player B (made admin below)
  r  text[] := array[]::text[];   -- report lines
  n  bigint;
  t  text;
  ok boolean;
begin
  -- ------------------------------------------------------------------ setup (owner)
  insert into auth.users (id, instance_id, aud, role, email)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rls-check-a-' || a || '@example.invalid'),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rls-check-b-' || b || '@example.invalid');
  insert into public.admins (user_id) values (b);

  -- ------------------------------------------------------------------ as B: own data
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role', 'authenticated')::text, true);

  insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
  values (b, 'sB', 0, 1, '[{"seq":0,"type":"b0"},{"seq":1,"type":"b1"}]');
  insert into public.consents (user_id, terms_version) values (b, 'test-v1');

  -- ------------------------------------------------------------------ as A
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);

  r := r || format('%s 01 A ve o proprio auth.uid()', case when auth.uid() = a then 'OK    ' else 'FALHOU' end);

  -- A inserts and upserts own batch
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'sA', 0, 1, '[{"seq":0,"type":"a0"},{"seq":1,"type":"a1"}]');
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'sA', 0, 2, '[{"seq":0,"type":"a0"},{"seq":1,"type":"a1"},{"seq":2,"type":"a2-old","run_idx":0,"t_ms":12.5}]')
    -- same statement shape as a PostgREST upsert: every sent column is set
    on conflict (user_id, session_id, first_seq)
    do update set user_id = excluded.user_id, session_id = excluded.session_id,
                  first_seq = excluded.first_seq, last_seq = excluded.last_seq,
                  events = excluded.events;
    -- a later batch overlapping seq 2 (events_flat must keep this copy of seq 2)
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'sA', 2, 3, '[{"seq":2,"type":"a2-new"},{"seq":3,"type":"a3"}]');
    select count(*) into n from public.event_batches
     where user_id = a and session_id = 'sA' and first_seq = 0 and last_seq = 2;
    r := r || format('%s 02 A insere e faz upsert do proprio lote', case when n = 1 then 'OK    ' else 'FALHOU' end);
  exception when others then
    r := r || format('FALHOU 02 A insere e faz upsert do proprio lote (%s %s)', sqlstate, sqlerrm);
  end;

  -- stale, shorter resend (upsert) must not shrink the stored batch (trigger)
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'sA', 0, 1, '[{"seq":0,"type":"stale"},{"seq":1,"type":"stale"}]')
    on conflict (user_id, session_id, first_seq)
    do update set user_id = excluded.user_id, session_id = excluded.session_id,
                  first_seq = excluded.first_seq, last_seq = excluded.last_seq,
                  events = excluded.events;
    select count(*) into n from public.event_batches
     where user_id = a and session_id = 'sA' and first_seq = 0 and last_seq = 2
       and jsonb_array_length(events) = 3 and events -> 0 ->> 'type' = 'a0';
    r := r || format('%s 36 upsert menor nao encolhe o lote guardado', case when n = 1 then 'OK    ' else 'FALHOU' end);
  exception when others then
    r := r || format('FALHOU 36 upsert menor nao encolhe o lote guardado (%s %s)', sqlstate, sqlerrm);
  end;

  -- a direct update to a smaller last_seq is ignored too (trigger)
  begin
    update public.event_batches set last_seq = 0, events = '[{"seq":0,"type":"stale"}]'
     where user_id = a and session_id = 'sA' and first_seq = 0;
    select count(*) into n from public.event_batches
     where user_id = a and session_id = 'sA' and first_seq = 0 and last_seq = 2
       and jsonb_array_length(events) = 3;
    r := r || format('%s 37 update direto para last_seq menor e ignorado', case when n = 1 then 'OK    ' else 'FALHOU' end);
  exception when others then
    r := r || format('FALHOU 37 update direto para last_seq menor e ignorado (%s %s)', sqlstate, sqlerrm);
  end;

  -- a bigger update still goes through (trigger only blocks shrinking); own
  -- session sGrow (counted in check 20, removed by delete_my_data below)
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'sGrow', 0, 0, '[{"seq":0}]');
    update public.event_batches set last_seq = 1, events = '[{"seq":0},{"seq":1}]'
     where user_id = a and session_id = 'sGrow';
    select count(*) into n from public.event_batches
     where user_id = a and session_id = 'sGrow' and last_seq = 1;
    r := r || format('%s 38 update para last_seq maior e aceito', case when n = 1 then 'OK    ' else 'FALHOU' end);
  exception when others then
    r := r || format('FALHOU 38 update para last_seq maior e aceito (%s %s)', sqlstate, sqlerrm);
  end;

  -- byte cap: a batch over 1 MiB is refused even with few events
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'huge', 0, 499,
      (select jsonb_agg(jsonb_build_object('seq', g,
                'pad', (select string_agg(md5(g::text || ':' || k::text), '') from generate_series(1, 80) k)))
         from generate_series(0, 499) g));
    r := r || text 'FALHOU 39 lote acima de 1 MiB e recusado';
  exception when check_violation then
    r := r || text 'OK     39 lote acima de 1 MiB e recusado';
  end;

  -- A inserts own consent
  begin
    insert into public.consents (user_id, terms_version) values (a, 'test-v1');
    r := r || text 'OK     03 A grava o proprio consentimento';
  exception when others then
    r := r || format('FALHOU 03 A grava o proprio consentimento (%s %s)', sqlstate, sqlerrm);
  end;

  -- A cannot set accepted_at (server-side timestamp only)
  begin
    insert into public.consents (user_id, terms_version, accepted_at) values (a, 'test-v2', '2000-01-01');
    r := r || text 'FALHOU 04 A nao escolhe accepted_at';
  exception when insufficient_privilege then
    r := r || text 'OK     04 A nao escolhe accepted_at';
  end;

  -- A cannot read B's batches / consents
  select count(*) into n from public.event_batches where user_id = b;
  r := r || format('%s 05 A nao le lotes de B', case when n = 0 then 'OK    ' else 'FALHOU' end);
  select count(*) into n from public.consents where user_id = b;
  r := r || format('%s 06 A nao le consentimentos de B', case when n = 0 then 'OK    ' else 'FALHOU' end);

  -- A cannot insert a batch for B
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (b, 'forged', 0, 0, '[{"seq":0}]');
    r := r || text 'FALHOU 07 A nao insere lote com user_id = B';
  exception when insufficient_privilege then
    r := r || text 'OK     07 A nao insere lote com user_id = B';
  end;

  -- A cannot insert a consent for B
  begin
    insert into public.consents (user_id, terms_version) values (b, 'forged');
    r := r || text 'FALHOU 08 A nao insere consentimento de B';
  exception when insufficient_privilege then
    r := r || text 'OK     08 A nao insere consentimento de B';
  end;

  -- A cannot update B's batch (RLS hides it: 0 rows)
  update public.event_batches set events = '[]', last_seq = 99 where user_id = b;
  get diagnostics n = row_count;
  r := r || format('%s 09 A nao altera lote de B', case when n = 0 then 'OK    ' else 'FALHOU' end);

  -- A cannot move own batch to B
  begin
    update public.event_batches set user_id = b where user_id = a and first_seq = 2;
    r := r || text 'FALHOU 10 A nao transfere o proprio lote para B';
  exception when insufficient_privilege then
    r := r || text 'OK     10 A nao transfere o proprio lote para B';
  end;

  -- A cannot delete directly (only through delete_my_data)
  begin
    delete from public.event_batches where user_id = a;
    r := r || text 'FALHOU 11 A nao apaga lote diretamente';
  exception when insufficient_privilege then
    r := r || text 'OK     11 A nao apaga lote diretamente';
  end;

  -- batch sanity checks
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'bad', 0, 0, '{"seq":0}');
    r := r || text 'FALHOU 12 lote que nao e lista e recusado';
  exception when check_violation then
    r := r || text 'OK     12 lote que nao e lista e recusado';
  end;
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'big', 0, 1000, (select jsonb_agg(jsonb_build_object('seq', g)) from generate_series(0, 1000) g));
    r := r || text 'FALHOU 13 lote com mais de 1000 eventos e recusado';
  exception when check_violation then
    r := r || text 'OK     13 lote com mais de 1000 eventos e recusado';
  end;

  -- A is not admin, sees nothing in events_flat, cannot touch admins
  r := r || format('%s 14 is_admin() = false para A', case when public.is_admin() = false then 'OK    ' else 'FALHOU' end);
  select count(*) into n from public.events_flat;
  r := r || format('%s 15 A nao le events_flat (0 linhas)', case when n = 0 then 'OK    ' else 'FALHOU' end);
  select count(*) into n from public.admins;
  r := r || format('%s 16 A nao le registros de admins de outros', case when n = 0 then 'OK    ' else 'FALHOU' end);
  begin
    insert into public.admins (user_id) values (a);
    r := r || text 'FALHOU 17 A nao se insere em admins';
  exception when insufficient_privilege then
    r := r || text 'OK     17 A nao se insere em admins';
  end;
  begin
    delete from public.admins where user_id = b;
    r := r || text 'FALHOU 18 A nao remove registros de admins';
  exception when insufficient_privilege then
    r := r || text 'OK     18 A nao remove registros de admins';
  end;

  -- ------------------------------------------------------------------ as B (admin)
  perform set_config('request.jwt.claims',
    json_build_object('sub', b, 'role', 'authenticated')::text, true);

  r := r || format('%s 19 is_admin() = true para B', case when public.is_admin() then 'OK    ' else 'FALHOU' end);
  select count(*) into n from public.event_batches where user_id in (a, b);
  r := r || format('%s 20 admin B le todos os lotes (esperado 4, veio %s)', case when n = 4 then 'OK    ' else 'FALHOU' end, n);
  select count(*) into n from public.consents where user_id in (a, b);
  r := r || format('%s 21 admin B le todos os consentimentos (esperado 2, veio %s)', case when n = 2 then 'OK    ' else 'FALHOU' end, n);
  select count(*) into n from public.events_flat where user_id = a and session_id = 'sA';
  r := r || format('%s 22 admin B le events_flat, sem duplicatas na sessao sA (esperado 4, veio %s)', case when n = 4 then 'OK    ' else 'FALHOU' end, n);
  select type into t from public.events_flat where user_id = a and session_id = 'sA' and seq = 2;
  r := r || format('%s 23 events_flat fica com o lote de maior last_seq (veio %s)', case when t = 'a2-new' then 'OK    ' else 'FALHOU' end, coalesce(t, 'nada'));
  select count(*) into n from public.admins where user_id = b;
  r := r || format('%s 24 B le o proprio registro em admins', case when n = 1 then 'OK    ' else 'FALHOU' end);

  -- ------------------------------------------------------------------ delete_my_data as A
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- A's token with B as the expected account (the game thinks B is signed in): refused, nothing deleted
  begin
    perform public.delete_my_data(b);
    r := r || text 'FALHOU 40 delete_my_data(B) com o token de A e recusado';
  exception when insufficient_privilege then
    r := r || text 'OK     40 delete_my_data(B) com o token de A e recusado';
  end;
  begin
    perform public.delete_my_data(null);
    r := r || text 'FALHOU 41 delete_my_data(null) e recusado';
  exception when insufficient_privilege then
    r := r || text 'OK     41 delete_my_data(null) e recusado';
  end;
  select count(*) into n from public.event_batches where user_id = a;
  r := r || format('%s 42 lotes de A intactos depois das chamadas recusadas (esperado 3, veio %s)', case when n = 3 then 'OK    ' else 'FALHOU' end, n);

  begin
    perform public.delete_my_data(a);
  exception when others then
    r := r || format('FALHOU 25 delete_my_data(A) como A (%s %s)', sqlstate, sqlerrm);
  end;

  reset role;   -- owner again, to see every row
  select count(*) into n from public.event_batches where user_id = a;
  ok := n = 0;
  select count(*) into n from public.consents where user_id = a;
  ok := ok and n = 0;
  r := r || format('%s 25 delete_my_data() apaga lotes e consentimentos de A', case when ok then 'OK    ' else 'FALHOU' end);
  select count(*) into n from public.event_batches where user_id = b;
  ok := n = 1;
  select count(*) into n from public.consents where user_id = b;
  ok := ok and n = 1;
  select count(*) into n from public.event_batches where user_id = b and last_seq = 1;
  ok := ok and n = 1;
  r := r || format('%s 26 delete_my_data() de A nao toca nos dados de B (e B nao foi alterado por A)', case when ok then 'OK    ' else 'FALHOU' end);

  -- delete_my_data without a user must raise
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  begin
    perform public.delete_my_data(a);
    r := r || text 'FALHOU 27 delete_my_data() sem usuario e recusado';
  exception when insufficient_privilege then
    r := r || text 'OK     27 delete_my_data() sem usuario e recusado';
  end;
  reset role;

  -- ------------------------------------------------------------------ as anon
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  begin
    select count(*) into n from public.event_batches;
    r := r || format('%s 28 anon nao le event_batches', case when n = 0 then 'OK    ' else 'FALHOU' end);
  exception when insufficient_privilege then
    r := r || text 'OK     28 anon nao le event_batches';
  end;
  begin
    select count(*) into n from public.consents;
    r := r || format('%s 29 anon nao le consents', case when n = 0 then 'OK    ' else 'FALHOU' end);
  exception when insufficient_privilege then
    r := r || text 'OK     29 anon nao le consents';
  end;
  begin
    select count(*) into n from public.admins;
    r := r || format('%s 30 anon nao le admins', case when n = 0 then 'OK    ' else 'FALHOU' end);
  exception when insufficient_privilege then
    r := r || text 'OK     30 anon nao le admins';
  end;
  begin
    select count(*) into n from public.events_flat;
    r := r || format('%s 31 anon nao le events_flat', case when n = 0 then 'OK    ' else 'FALHOU' end);
  exception when insufficient_privilege then
    r := r || text 'OK     31 anon nao le events_flat';
  end;
  begin
    insert into public.event_batches (user_id, session_id, first_seq, last_seq, events)
    values (a, 'anon', 0, 0, '[{"seq":0}]');
    r := r || text 'FALHOU 32 anon nao insere lotes';
  exception when insufficient_privilege then
    r := r || text 'OK     32 anon nao insere lotes';
  end;
  begin
    perform public.delete_my_data(a);
    r := r || text 'FALHOU 33 anon nao executa delete_my_data()';
  exception when insufficient_privilege then
    r := r || text 'OK     33 anon nao executa delete_my_data()';
  end;
  begin
    perform public.is_admin();
    r := r || text 'FALHOU 34 anon nao executa is_admin()';
  exception when insufficient_privilege then
    r := r || text 'OK     34 anon nao executa is_admin()';
  end;
  reset role;

  -- ------------------------------------------------------------------ owner (SQL editor export)
  select count(*) into n from public.events_flat where user_id = b;
  r := r || format('%s 35 dono (SQL editor) le events_flat para exportar (esperado 2, veio %s)', case when n = 2 then 'OK    ' else 'FALHOU' end, n);

  -- ------------------------------------------------------------------ report + rollback
  r := r || case when exists (select 1 from unnest(r) x where x like 'FALHOU%')
                 then 'RESULTADO: HA FALHAS'
                 else 'RESULTADO: TODOS OK' end;
  -- Also as NOTICE (shown by psql and by clients that display notices), then
  -- the exception that carries the same report and forces the rollback.
  raise notice E'RLS CHECK\n%', array_to_string(r, E'\n');
  raise exception E'RLS CHECK (tudo foi desfeito; este erro e esperado)\n%',
    array_to_string(r, E'\n');
end
$rls_check$;

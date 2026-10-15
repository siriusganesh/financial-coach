-- RLS checks for supabase/schema.sql. Any failure raises an error.
-- Run after 00_supabase_stub.sql and schema.sql, with ON_ERROR_STOP=1.
\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(uid text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', uid, false) $$;

create or replace function pg_temp.must_fail(q text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected RLS failure but statement succeeded: %', q;
exception when insufficient_privilege then null;  -- 42501: RLS violation
end $$;

\pset tuples_only on
set role authenticated;

-- user A creates data
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into sessions (title) values ('A1') returning id as a_sid \gset
insert into ledgers (session_id, version, data) select id, 1, '{}' from sessions;
insert into messages (session_id, role, step, content) select id, 'user', 1, 'hi' from sessions;
insert into plan_results (session_id, ledger_version, calculator_version, results, report)
  select id, 1, 'test', '{}', 'r' from sessions;
do $$ begin
  assert (select user_id from sessions) = '00000000-0000-0000-0000-00000000000a', 'user_id default';
  assert (select count(*) from tax_limits) >= 1, 'tax_limits readable';
end $$;

-- user B sees nothing of A, cannot write into A's session, cannot spoof
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from sessions) = 0, 'B sees A sessions';
  assert (select count(*) from ledgers) = 0, 'B sees A ledgers';
  assert (select count(*) from messages) = 0, 'B sees A messages';
  assert (select count(*) from plan_results) = 0, 'B sees A plan_results';
end $$;
update sessions set title = 'hacked';
delete from ledgers;
reset role;
do $$ begin
  assert (select title from sessions) = 'A1', 'B changed A session';
  assert (select count(*) from ledgers) = 1, 'B deleted A ledger';
end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.must_fail(format(
  'insert into ledgers (session_id, user_id, version, data) values (%L, %L, 2, ''{}'')',
  :'a_sid', '00000000-0000-0000-0000-00000000000b'));
select pg_temp.must_fail(format(
  'insert into messages (session_id, user_id, role, step, content) values (%L, %L, ''user'', 1, ''x'')',
  :'a_sid', '00000000-0000-0000-0000-00000000000b'));
select pg_temp.must_fail('insert into sessions (user_id) values (''00000000-0000-0000-0000-00000000000a'')');
select pg_temp.must_fail('insert into tax_limits values (2099, ''{}'', ''x'')');
select pg_temp.must_fail('insert into usage (user_id) values (''00000000-0000-0000-0000-00000000000b'')');

-- ledgers are append-only for the owner
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update ledgers set data = '{"x":1}';
do $$ begin assert (select data from ledgers) = '{}'::jsonb, 'ledger was updated'; end $$;

-- anon sees nothing
set role anon;
do $$ begin
  assert (select count(*) from sessions) = 0, 'anon sees sessions';
  assert (select count(*) from tax_limits) = 0, 'anon sees tax_limits';
end $$;

\echo RLS tests passed

-- financial-coach: schema + RLS
-- Paste this whole file into the Supabase SQL editor and run it.
-- Idempotent: safe to run more than once. Does not drop data.
--
-- Access model:
--   * A user can read and write only their own rows.
--   * Child rows (ledgers, messages, plan_results) must also point at a
--     session the same user owns.
--   * tax_limits is read-only for signed-in users. Edit it in the SQL editor.
--   * usage is read-only for the user. The Edge Function writes it with the
--     service role key (service role bypasses RLS).

-- =====================================================================
-- tables
-- =====================================================================

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text,
  step        int  not null default 1 check (step between 1 and 13),
  status      text not null default 'interview'
              check (status in ('interview', 'analysis', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per saved version of the facts ledger (LEDGER_TEMPLATE shape).
-- Append-only: a correction writes a new version, the old one stays.
create table if not exists public.ledgers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  version     int  not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (session_id, version)
);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.sessions on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  role        text not null check (role in ('user', 'model', 'app')),
  step        int  not null check (step between 1 and 13),
  content     text not null,
  created_at  timestamptz not null default now()
);

-- Output of plan(ledger). calculator_version = git hash or semver of
-- coach_calculator.py, so an old result can be traced to the code that made it.
create table if not exists public.plan_results (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.sessions on delete cascade,
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  ledger_version      int  not null,
  calculator_version  text not null,
  results             jsonb not null,
  report              text not null,
  created_at          timestamptz not null default now()
);

-- Section 2 time-sensitive values, one row per tax year.
create table if not exists public.tax_limits (
  year        int primary key,
  data        jsonb not null,
  source      text not null,
  updated_at  timestamptz not null default now()
);

-- Per-user daily Gemini usage, for the quota check in the Edge Function.
create table if not exists public.usage (
  user_id     uuid not null references auth.users on delete cascade,
  day         date not null default current_date,
  requests    int  not null default 0,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  primary key (user_id, day)
);

create index if not exists sessions_user_idx      on public.sessions     (user_id, updated_at desc);
create index if not exists ledgers_session_idx    on public.ledgers      (session_id, version desc);
create index if not exists messages_session_idx   on public.messages     (session_id, id);
create index if not exists plan_results_sess_idx  on public.plan_results (session_id, created_at desc);

-- keep sessions.updated_at current
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

-- true if the signed-in user owns the session
create or replace function public.owns_session(sid uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.sessions s
                 where s.id = sid and s.user_id = auth.uid());
$$;

-- =====================================================================
-- row level security
-- =====================================================================

alter table public.sessions     enable row level security;
alter table public.ledgers      enable row level security;
alter table public.messages     enable row level security;
alter table public.plan_results enable row level security;
alter table public.tax_limits   enable row level security;
alter table public.usage        enable row level security;

-- sessions: full control of own rows
drop policy if exists "sessions own" on public.sessions;
create policy "sessions own" on public.sessions
  for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ledgers: read, insert, delete own. No update (append-only versions).
drop policy if exists "ledgers own select" on public.ledgers;
drop policy if exists "ledgers own insert" on public.ledgers;
drop policy if exists "ledgers own delete" on public.ledgers;
create policy "ledgers own select" on public.ledgers
  for select to authenticated using (auth.uid() = user_id);
create policy "ledgers own insert" on public.ledgers
  for insert to authenticated
  with check (auth.uid() = user_id and public.owns_session(session_id));
create policy "ledgers own delete" on public.ledgers
  for delete to authenticated using (auth.uid() = user_id);

-- messages: read, insert, delete own. No update.
drop policy if exists "messages own select" on public.messages;
drop policy if exists "messages own insert" on public.messages;
drop policy if exists "messages own delete" on public.messages;
create policy "messages own select" on public.messages
  for select to authenticated using (auth.uid() = user_id);
create policy "messages own insert" on public.messages
  for insert to authenticated
  with check (auth.uid() = user_id and public.owns_session(session_id));
create policy "messages own delete" on public.messages
  for delete to authenticated using (auth.uid() = user_id);

-- plan_results: read, insert, delete own. No update.
drop policy if exists "plan_results own select" on public.plan_results;
drop policy if exists "plan_results own insert" on public.plan_results;
drop policy if exists "plan_results own delete" on public.plan_results;
create policy "plan_results own select" on public.plan_results
  for select to authenticated using (auth.uid() = user_id);
create policy "plan_results own insert" on public.plan_results
  for insert to authenticated
  with check (auth.uid() = user_id and public.owns_session(session_id));
create policy "plan_results own delete" on public.plan_results
  for delete to authenticated using (auth.uid() = user_id);

-- tax_limits: any signed-in user can read; nobody can write through the API
drop policy if exists "tax_limits read" on public.tax_limits;
create policy "tax_limits read" on public.tax_limits
  for select to authenticated using (true);

-- usage: user can read own counters; only the service role writes
drop policy if exists "usage own select" on public.usage;
create policy "usage own select" on public.usage
  for select to authenticated using (auth.uid() = user_id);

-- =====================================================================
-- seed: tax year 2026 (coach-reference.md Section 2, plus federal brackets)
-- Keys match LEDGER_TEMPLATE["limits"] in coach_calculator.py, plus the
-- catch-up and phase-out values the account plan needs.
-- brackets: [upper bound of taxable income (null = no limit), rate], used for
-- the D2 Roth vs. traditional rule. Source: Rev. Proc. 2025-32 Sections 4.01
-- and 4.14(1). Rerunning this file updates the row (upsert).
-- =====================================================================

insert into public.tax_limits (year, data, source) values (
  2026,
  '{
    "k401": 24500,
    "k401_catchup_50": 8000,
    "k401_catchup_60_63": 11250,
    "ira": 7500,
    "ira_catchup_50": 1100,
    "hsa_self": 4400,
    "hsa_family": 8750,
    "hsa_catchup_55": 1000,
    "roth_start": {"single": 153000, "hoh": 153000, "mfj": 242000},
    "roth_end":   {"single": 168000, "hoh": 168000, "mfj": 252000},
    "trad_ira_deduction_covered": {"single": [81000, 91000], "mfj": [129000, 149000]},
    "std_deduction": {"single": 16100, "mfj": 32200, "hoh": 24150},
    "brackets": {
      "single": [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [null, 0.37]],
      "mfj":    [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [null, 0.37]],
      "hoh":    [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [null, 0.37]]
    }
  }'::jsonb,
  'IRS IR-2025-111, Rev. Proc. 2025-19, Rev. Proc. 2025-32'
) on conflict (year) do update
  set data = excluded.data, source = excluded.source, updated_at = now();

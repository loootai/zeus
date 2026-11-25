-- Zeus results in your own Supabase project.
-- Written by `looot-zeus import-supabase` (service role key, server side only).
-- Additive: creates tables only if missing, never drops or rewrites data.
-- RLS is ON for every table and there is no policy, so the anon and authenticated
-- roles read and write nothing. Add a policy yourself if a page should read a table.

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  mode text not null check (mode in ('live', 'demo')),
  finished_at timestamptz,
  charged_usd numeric(12, 4),
  calls integer,
  imported_at timestamptz not null default now()
);
comment on table public.runs is 'One row per Zeus import: the domain the run was for, live or demo, what it cost on looot.';
comment on column public.runs.domain is 'The domain Zeus ran for (your own company).';
comment on column public.runs.charged_usd is 'What the run cost on looot, from gtm/receipt.json.';

create table if not exists public.accounts (
  domain text primary key check (domain = lower(domain) and domain <> ''),
  name text,
  industry text,
  employees integer,
  country text,
  grade text,
  score integer,
  reasons text,
  provider text,
  run_id uuid references public.runs (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.accounts is 'Target accounts Zeus scored, one row per company domain (upserted by domain).';
comment on column public.accounts.grade is 'Fit grade A to D.';
comment on column public.accounts.reasons is 'Why the account fits, in words.';
comment on column public.accounts.run_id is 'The import that last wrote this row.';

create table if not exists public.committees (
  account_domain text primary key references public.accounts (domain) on delete cascade,
  account_name text,
  grade text,
  score integer,
  members integer not null default 0,
  run_id uuid references public.runs (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.committees is 'The buying committee Zeus mapped for one account, one row per account domain.';
comment on column public.committees.members is 'How many people the committee has in public.people.';

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  account_domain text not null check (account_domain = lower(account_domain) and account_domain <> ''),
  person_key text not null,
  name text not null,
  role text,
  title text,
  linkedin text,
  email text,
  email_status text,
  phone text,
  run_id uuid references public.runs (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (account_domain, person_key)
);
comment on table public.people is 'People at target accounts (committee members and enriched people). Personal data: delete it when you no longer need it.';
comment on column public.people.person_key is 'Dedupe key: the LinkedIn URL, else the lower-cased name. Unique per account domain.';
comment on column public.people.email is 'Null unless the import ran with --contact-details on a paid, non-safe run.';
comment on column public.people.phone is 'Null unless the import ran with --contact-details on a paid, non-safe run.';

create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  run_domain text not null,
  title text not null,
  evidence text,
  list text,
  command text,
  cost text,
  basis text,
  run_id uuid references public.runs (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (run_domain, title)
);
comment on table public.plays is 'Outbound plays Zeus suggested for your domain, one row per play title.';
comment on column public.plays.basis is 'fact (backed by data in the run) or idea.';

create table if not exists public.rivals (
  domain text primary key check (domain = lower(domain) and domain <> ''),
  name text,
  positioning text,
  card jsonb not null default '{}'::jsonb,
  run_id uuid references public.runs (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.rivals is 'Rival cards (positioning, pricing, stack, news, each claim with its source), one row per rival domain.';
comment on column public.rivals.card is 'The full rival card as Zeus wrote it.';

alter table public.runs enable row level security;
alter table public.accounts enable row level security;
alter table public.committees enable row level security;
alter table public.people enable row level security;
alter table public.plays enable row level security;
alter table public.rivals enable row level security;

-- Supabase grants new public tables to anon and authenticated by default. RLS with no
-- policy already blocks them; revoking as well keeps the tables closed if RLS is ever turned off.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.runs, public.accounts, public.committees, public.people, public.plays, public.rivals from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.runs, public.accounts, public.committees, public.people, public.plays, public.rivals from authenticated';
  end if;
end $$;

#!/usr/bin/env bash
# Applies supabase/migrations/*_zeus.sql to a throwaway Postgres cluster (twice, it must be
# re-runnable), with Supabase's anon, authenticated and service_role roles, and checks RLS and
# the upsert keys. Needs initdb and pg_ctl on PATH (or in /usr/lib/postgresql/*/bin).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$(ls "$ROOT"/supabase/migrations/*_zeus.sql)"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")"
DIR="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
trap '"$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start -w >/dev/null
q() { psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX "$@"; }
q -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;"
q -f "$MIG"; q -f "$MIG"
echo "applied twice: ok"
[ "$(q -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity and relname in ('runs','accounts','committees','people','plays','rivals')")" = 6 ] && echo "rls on 6 tables: ok"
[ "$(q -c "select count(*) from pg_policies where schemaname='public'")" = 0 ] && echo "no policies: ok"
[ "$(q -c "select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public'")" = 0 ] && echo "anon/authenticated have no grants: ok"
if q -c "set role anon; select * from public.accounts" 2>/dev/null; then echo "anon read allowed: FAIL"; exit 1; else echo "anon read denied: ok"; fi
q -c "set role service_role;
  insert into public.runs (domain, mode) values ('yourdomain.com','demo');
  insert into public.accounts (domain, name, score) values ('a.example','A',1) on conflict (domain) do update set name = excluded.name, score = excluded.score;
  insert into public.accounts (domain, name, score) values ('a.example','A2',2) on conflict (domain) do update set name = excluded.name, score = excluded.score;
  insert into public.committees (account_domain, members) values ('a.example',2) on conflict (account_domain) do update set members = excluded.members;
  insert into public.people (account_domain, person_key, name) values ('a.example','x','X') on conflict (account_domain, person_key) do update set name = excluded.name;
  insert into public.people (account_domain, person_key, name) values ('a.example','x','X2') on conflict (account_domain, person_key) do update set name = excluded.name;
  insert into public.plays (run_domain, title) values ('yourdomain.com','P') on conflict (run_domain, title) do nothing;
  insert into public.rivals (domain, card) values ('r.example','{}') on conflict (domain) do nothing;"
[ "$(q -c "select name||score from public.accounts")" = "A22" ] && [ "$(q -c "select count(*)||max(name) from public.people")" = "1X2" ] && echo "upsert by domain as service_role: ok"
if q -c "insert into public.accounts (domain) values ('Upper.Example')" 2>/dev/null; then echo "mixed-case domain accepted: FAIL"; exit 1; else echo "lower-case domain check: ok"; fi

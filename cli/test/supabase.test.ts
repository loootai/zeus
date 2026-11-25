import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { readState } from "../src/more.js";
import { importToSupabase, redact, supabaseFromEnv, supabaseRowsOf, SUPABASE_CONFLICT } from "../src/supabase.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const KEY = "eyJservice-role-fake-key-0123456789";
function demoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-supa-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" }, encoding: "utf8" });
  return join(dir, "gtm");
}
const out = demoDir();
const state = readState(out)!;
const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));

/** A fake PostgREST: records every call, keeps rows per table keyed by the on_conflict columns. */
function fakeSupabase() {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const tables: Record<string, Map<string, any>> = {};
  const f = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const u = new URL(url);
    const t = u.pathname.split("/").pop()!;
    const cols = (u.searchParams.get("on_conflict") ?? "id").split(",");
    tables[t] ??= new Map();
    const made = body.map((r: any) => ({ id: r.id ?? `id-${tables[t].size + 1}`, ...r }));
    for (const r of made) tables[t].set(cols.map((c) => r[c]).join("|"), { ...tables[t].get(cols.map((c) => r[c]).join("|")), ...r });
    return new Response(init.headers.Prefer.includes("representation") ? JSON.stringify(made) : "", { status: 201 });
  }) as unknown as typeof fetch;
  return { f, calls, tables };
}

test("rows: one per domain, no emails or phones without --contact-details", () => {
  const r = supabaseRowsOf(state, receipt, { contactDetails: false });
  assert.ok(r.accounts.length > 0 && r.committees.length > 0 && r.people.length > 0 && r.plays.length > 0 && r.rivals.length > 0);
  for (const t of ["accounts", "rivals"] as const) assert.equal(new Set(r[t].map((x) => x.domain)).size, r[t].length, t);
  assert.equal(new Set(r.people.map((p) => `${p.account_domain}|${p.person_key}`)).size, r.people.length);
  assert.ok(r.people.every((p) => p.email === null && p.phone === null));
  const accountDomains = new Set(r.accounts.map((a) => a.domain));
  assert.ok(r.committees.every((c) => accountDomains.has(c.account_domain as string)), "every committee has its account row (FK)");
  assert.equal(r.run.mode, "demo");
});

test("rows: contact details only on a live, non-safe run", () => {
  assert.ok(supabaseRowsOf(state, receipt, { contactDetails: true }).people.every((p) => p.email === null), "demo run never carries emails");
  const live = { ...state, mode: "live" as const, placeholder: undefined };
  assert.ok(supabaseRowsOf(live, receipt, { contactDetails: true }).people.some((p) => p.email));
  assert.ok(supabaseRowsOf({ ...live, safe: true }, receipt, { contactDetails: true }).people.every((p) => p.email === null && p.phone === null));
});

test("import: run first, upserts by domain with merge-duplicates, twice gives the same rows", async () => {
  const fake = fakeSupabase();
  const rows = supabaseRowsOf(state, receipt, { contactDetails: false });
  const target = { url: "https://abc.supabase.co", key: KEY };
  await importToSupabase(rows, target, fake.f);
  const first = Object.fromEntries(Object.entries(fake.tables).map(([t, m]) => [t, m.size]));
  await importToSupabase(rows, target, fake.f);
  assert.equal(fake.calls[0].url, "https://abc.supabase.co/rest/v1/runs");
  for (const [t, cols] of Object.entries(SUPABASE_CONFLICT)) {
    const c = fake.calls.find((x) => new URL(x.url).pathname.endsWith(`/${t}`))!;
    assert.equal(new URL(c.url).searchParams.get("on_conflict"), cols, t);
    assert.match(c.headers.Prefer, /resolution=merge-duplicates/);
    assert.equal(fake.tables[t].size, first[t], `${t} deduped on re-import`);
    assert.ok(c.body.every((r: any) => r.run_id === "id-1"));
    const keys = JSON.stringify(Object.keys(c.body[0]).sort());
    assert.ok(c.body.every((r: any) => JSON.stringify(Object.keys(r).sort()) === keys), `${t}: same keys on every row (PostgREST PGRST102)`);
    assert.ok(!JSON.stringify(c.body).includes(KEY));
  }
  assert.equal(fake.tables.accounts.size, rows.accounts.length);
  assert.equal(fake.tables.runs.size, 2, "each import adds one run row");
});

test("key: read from env only, missing names listed, never in errors or output", async () => {
  assert.deepEqual(supabaseFromEnv({}).missing, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  assert.throws(() => supabaseFromEnv({ SUPABASE_URL: "http://evil.example", SUPABASE_SERVICE_ROLE_KEY: KEY }), /https/);
  assert.equal(redact(`bad ${KEY} bad`, KEY), "bad [redacted] bad");
  const echo = (async (_u: string, init: any) => new Response(`denied for ${init.headers.apikey}`, { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(importToSupabase(supabaseRowsOf(state, receipt, { contactDetails: false }), { url: "https://abc.supabase.co", key: KEY }, echo), (e: Error) => !e.message.includes(KEY) && /401/.test(e.message));
  const env = { ...process.env, LOOOT_TOKEN: "", SUPABASE_URL: "https://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: KEY };
  const dry = spawnSync(process.execPath, [cli, "import-supabase", "--dry-run", "--out", out], { env, encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run, nothing written\. Would upsert by domain: \d+ accounts/);
  const fail = spawnSync(process.execPath, [cli, "import-supabase", "--out", out], { env, encoding: "utf8" });
  assert.notEqual(fail.status, 0);
  assert.ok(!(fail.stdout + fail.stderr).includes(KEY), "key never printed");
  const none = spawnSync(process.execPath, [cli, "import-supabase", "--out", out], { env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, encoding: "utf8" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
});

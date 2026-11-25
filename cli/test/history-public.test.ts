// Week over week (snapshot, history, changes.md, watch) and the public export. All offline.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallResult, JobRunner } from "../src/client.js";
import { cmdDemo, cmdRun, cmdWatch } from "../src/commands.js";
import { changesMarkdown, diffSnapshots, type Snapshot } from "../src/history.js";
import { applySwaps, exportPublic, leaks, PUBLIC_FILES, swapsFor } from "../src/public.js";
import { validateReceipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";
import { demoSnapshots } from "../src/watch.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const EXAMPLE = join(PKG_ROOT, "examples", "yourdomain.yaml");

const missRunner: JobRunner = {
  async call(job, _input, opts): Promise<CallResult> {
    return { record: { module: opts.module, job, provider: "mock", outcome: "miss", quoted: opts.quotedUsd, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed", outcome: "miss" }, data: {} };
  },
};

function quietly<T>(f: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  return f().finally(() => {
    console.log = log;
  });
}

// ---- what changed since last week ---------------------------------------------------------------

test("the diff finds new accounts, rival changes, rank moves, signals and mentions", () => {
  const { prev, next } = demoSnapshots();
  const c = diffSnapshots(prev, next);
  assert.ok(c.accounts.added.some((a) => a.domain === "northpeak-supply.example"));
  assert.equal(c.accounts.removed.length, 1);
  assert.ok(c.rivals.added.some((r) => r.competitor === "Rival A" && r.price === "$59/user/mo"));
  assert.equal(c.ranks.length, 1);
  assert.equal(c.signals.length, 1);
  assert.equal(c.mentions.length, 1);
  const md = changesMarkdown(prev, next, c);
  assert.match(md, /^# What changed since last week/);
  assert.match(md, /## New accounts \(1\)\n\n- Northpeak Supply \(northpeak-supply\.example\), grade A/);
  assert.match(md, /new price for Rival A, Pro at \$59\/user\/mo/);
  assert.match(md, /went from #\d+ to #\d+, up \d/);
  assert.ok(!md.includes(", and") && !md.includes("—"));
  // the same snapshot twice is no change at all
  assert.equal(diffSnapshots(prev, prev).total, 0);
  assert.match(changesMarkdown(prev, prev), /Nothing changed\./);
});

test("each run keeps last week's files in history/ and writes changes.md", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-hist-"));
  const out = join(dir, "gtm");
  mkdirSync(out);
  const cfgPath = join(out, "config.yaml");
  copyFileSync(EXAMPLE, cfgPath);
  const deps = { client: () => missRunner, isTTY: false, log: () => {} };
  await cmdRun({ offline: true, yes: true }, cfgPath, out, deps);
  assert.ok(existsSync(join(out, "snapshot.json")));
  assert.ok(!existsSync(join(out, "changes.md")), "no changes.md on the first run");
  // Pretend the first run was a week ago and found an account and a rank.
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  snap.at = "2026-10-23T09:00:00.000Z";
  snap.accounts = [{ domain: "gone-co.example", name: "Gone Co", grade: "B", score: 70 }];
  writeFileSync(join(out, "snapshot.json"), JSON.stringify(snap));
  const lines: string[] = [];
  await cmdRun({ offline: true, yes: true }, cfgPath, out, { ...deps, log: (l: string) => lines.push(l) });
  const hist = readdirSync(join(out, "history"));
  assert.deepEqual(hist, ["2026-10-23T09-00"]);
  for (const f of ["snapshot.json", "receipt.json", "dossier.md"]) assert.ok(existsSync(join(out, "history", hist[0], f)), f);
  const md = readFileSync(join(out, "changes.md"), "utf8");
  assert.match(md, /Last run 2026-10-23/);
  assert.match(md, /## Accounts no longer found \(1\)\n\n- Gone Co \(gone-co\.example\)/);
  assert.match(lines.join("\n"), /1 changes since the run of 2026-10-23/);
});

test("watch --demo writes an example changes.md with no call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-wd-"));
  await cmdWatch({ demo: true }, join(dir, "config.yaml"), dir, { log: () => {}, client: () => assert.fail("no client in demo") });
  const md = readFileSync(join(dir, "changes.md"), "utf8");
  assert.match(md, /PLACEHOLDER/);
  assert.match(md, /Northpeak Supply/);
});

test("the GitHub Action template runs weekly with --yes and a cap, then commits gtm/", () => {
  const y = readFileSync(join(PKG_ROOT, ".github", "workflows", "gtm-watch.yml"), "utf8");
  assert.match(y, /cron: "0 7 \* \* 1"/);
  assert.match(y, /npx looot-zeus run --yes --cap 5/);
  assert.match(y, /LOOOT_TOKEN: \$\{\{ secrets\.LOOOT_TOKEN \}\}/);
  assert.match(y, /git add gtm/);
});

// ---- the public export --------------------------------------------------------------------------------

const REAL: [string, string][] = [
  ["yourdomain.com", "acmereal.io"],
  ["YourBrand", "Acme Real"],
  ["rival-a.com", "bigrival.com"],
  ["rival-b.com", "megacorp.io"],
  ["rival-c.com", "zenstack.dev"],
  ["Rival A", "Bigrival"],
  ["Rival B", "Megacorp"],
  ["Rival C", "Zenstack"],
];

/** A demo dossier turned into what a real one looks like: a real-looking domain, brand and rivals. */
async function realLookingRun(): Promise<{ out: string; originals: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-pub-"));
  const out = join(dir, "gtm");
  await quietly(() => cmdDemo({}, out));
  for (const f of [...PUBLIC_FILES, "snapshot.json", "config.yaml"]) {
    let t = readFileSync(join(out, f), "utf8");
    for (const [a, b] of REAL) t = t.split(a).join(b);
    writeFileSync(join(out, f), t);
  }
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  const people = snap.people.flatMap((p) => [p.name, p.email, p.linkedin, p.phone]).filter((s) => s.length > 0);
  assert.ok(snap.people.length >= 5, "the demo has people to mask");
  return { out, originals: [...REAL.map(([, b]) => b), ...people] };
}

test("export --public swaps domain, brand, rivals and people, and 0 originals are left", async () => {
  const { out, originals } = await realLookingRun();
  // the originals really are in the dossier before the export
  const before = PUBLIC_FILES.map((f) => readFileSync(join(out, f), "utf8")).join("\n");
  for (const s of ["acmereal.io", "Acme Real", "Bigrival", "megacorp.io"]) assert.ok(before.includes(s), s);
  const e = exportPublic(out);
  assert.deepEqual(readdirSync(e.dir).sort(), ["city", "dossier.html", "dossier.md", "receipt.json"]);
  assert.deepEqual(readdirSync(join(e.dir, "city")), ["index.html"]);
  for (const f of PUBLIC_FILES) {
    const t = readFileSync(join(e.dir, f), "utf8").toLowerCase();
    for (const s of originals) assert.equal(t.split(s.toLowerCase()).length - 1, 0, `${f} still has ${s}`);
  }
  const md = readFileSync(join(e.dir, "dossier.md"), "utf8");
  for (const s of ["yourdomain.com", "Rival A", "rival-b.com", "Person 1"]) assert.ok(md.includes(s), s);
  const r = JSON.parse(readFileSync(join(e.dir, "receipt.json"), "utf8"));
  assert.deepEqual(validateReceipt(r), []);
  assert.equal(r.run.domain, "yourdomain.com");
});

test("the leak check catches an original that slipped through", () => {
  const swaps = swapsFor({ domain: "acmereal.io", brand: "Acme Real", competitors: [{ domain: "bigrival.com", name: "Bigrival" }], people: [{ name: "Jane Smith", email: "jane@x.example", linkedin: "", phone: "" }] });
  const clean = applySwaps("Acme Real (acmereal.io) vs Bigrival. Ask Jane Smith, jane@x.example. Bigrivals.", swaps);
  assert.equal(clean, "yourbrand (yourdomain.com) vs Rival A. Ask Person 1, person1@example.com. Bigrivals.");
  assert.deepEqual(leaks(clean, swaps), []);
  assert.deepEqual(leaks(`${clean} jane smith`, swaps), [{ from: "Jane Smith", hits: 1 }]);
});

test("demo --public through the CLI writes gtm/public with the four files", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-pubcli-"));
  const o = execFileSync(process.execPath, [cli, "demo", "--public", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } }).toString();
  assert.match(o, /Public copy in .*public\/ \(receipt\.json, dossier\.html, dossier\.md, city\/index\.html\)/);
  for (const f of PUBLIC_FILES) assert.ok(existsSync(join(dir, "gtm", "public", f)), f);
  const ex = execFileSync(process.execPath, [cli, "export", "--public", "--out", join(dir, "gtm")], { cwd: dir }).toString();
  assert.match(ex, /0 left/);
});

// ---- skill and agent docs ------------------------------------------------------------------------------

test("SKILL.md and docs/agents.md exist, follow the copy rules and say quote first", () => {
  const skill = readFileSync(join(PKG_ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: gtm\n/);
  assert.match(skill, /\/gtm <domain>/);
  assert.match(skill, /npx looot-zeus run <domain>/);
  assert.match(skill, /two failures/i);
  const agents = readFileSync(join(PKG_ROOT, "docs", "agents.md"), "utf8");
  for (const w of ["~/.claude/skills/gtm/", "Codex", "Cursor"]) assert.ok(agents.includes(w), w);
  const readme = readFileSync(join(PKG_ROOT, "README.md"), "utf8");
  assert.match(readme, /npx looot-zeus skill > ~\/\.claude\/skills\/gtm\/SKILL\.md/);
  for (const t of [skill, agents]) {
    assert.ok(!t.includes(", and"), "comma before and");
    assert.ok(!t.includes("—"), "em dash");
  }
  const out = execFileSync(process.execPath, [cli, "skill"]).toString();
  assert.equal(out, skill);
});

test("export --public --mask-accounts turns target accounts into Account N with a generic industry", async () => {
  const { out, originals } = await realLookingRun();
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  const accounts = [...snap.accounts, ...(snap.lookalikes ?? [])];
  assert.ok(accounts.length >= 10, "the demo has accounts to mask");
  const accountStrings = [...accounts.flatMap((a) => [a.name, a.domain]), ...(snap.seeds ?? [])].filter((s) => s.length > 0);
  const before = readFileSync(join(out, "dossier.md"), "utf8");
  for (const s of accountStrings.slice(0, 4)) assert.ok(before.toLowerCase().includes(s.toLowerCase()), s);

  // without the flag the accounts stay
  exportPublic(out);
  assert.ok(readFileSync(join(out, "public", "dossier.md"), "utf8").includes(accounts[0].name));

  const e = exportPublic(out, undefined, { maskAccounts: true });
  for (const f of PUBLIC_FILES) {
    const t = readFileSync(join(e.dir, f), "utf8").toLowerCase();
    for (const s of [...originals, ...accountStrings]) assert.equal(t.split(s.toLowerCase()).length - 1, 0, `${f} still has ${s}`);
  }
  // no half-swapped names either: the first word of each account name is gone too
  const firstWords = [...new Set(accounts.map((a) => a.name.split(/\s+/)[0]).filter((w) => w.length >= 5))];
  for (const f of PUBLIC_FILES) {
    const t = readFileSync(join(e.dir, f), "utf8");
    for (const w of firstWords) assert.ok(!new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`).test(t), `${f} still has ${w}`);
  }
  const md = readFileSync(join(e.dir, "dossier.md"), "utf8");
  assert.match(md, /Account 1\b/);
  assert.match(md, /account-1\.example/);
  // every table row that names a masked account shows the generic industry, never the real one
  const industries = [...new Set(accounts.map((a) => a.industry ?? "").filter(Boolean))];
  const rows = md.split("\n").filter((l) => l.startsWith("|") && /\bAccount \d+\b/.test(l));
  assert.ok(rows.length >= 10);
  assert.ok(rows.some((l) => l.includes("| Business |")));
  for (const l of rows) for (const ind of industries) assert.ok(!new RegExp(`(?<![a-z])${ind}(?![a-z])`, "i").test(l), `row still says ${ind}: ${l}`);
  const html = readFileSync(join(e.dir, "dossier.html"), "utf8");
  for (const r of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)!.filter((r) => /Account \d+/.test(r))) for (const ind of industries) assert.ok(!new RegExp(`>${ind}<`, "i").test(r), `html row still says ${ind}`);
  assert.deepEqual(validateReceipt(JSON.parse(readFileSync(join(e.dir, "receipt.json"), "utf8"))), []);
});

test("--mask-accounts works through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-maskcli-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const ex = execFileSync(process.execPath, [cli, "export", "--public", "--mask-accounts", "--out", join(dir, "gtm")], { cwd: dir }).toString();
  assert.match(ex, /rivals, target accounts and people are swapped out, .* 0 left/);
  const md = readFileSync(join(dir, "gtm", "public", "dossier.md"), "utf8");
  assert.ok(!md.includes("Lumen Wholesale"));
  assert.match(md, /Account \d+/);
});

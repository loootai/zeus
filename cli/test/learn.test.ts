// looot-zeus learn and log. Everything here is offline: the paid runner is a mock, Instantly is a
// fake fetch and no test spends money. Covers the acceptance list of the learn plan.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallResult, JobRunner } from "../src/client.js";
import { cmdLearn, cmdLog, cmdRun, keepRun } from "../src/commands.js";
import { writeArtifacts } from "../src/exports.js";
import { pullInstantly, pageUrl } from "../src/learn/instantly.js";
import { byWeight } from "../src/learn/propose.js";
import { parseCsv, readResults, ResultsError } from "../src/learn/results.js";
import { emptyLearnings, LEARN, readLearnings, sizeBandOf } from "../src/learn/schema.js";
import { learnFrom, providerPrefs, rankedAngles, runEntry, stepWeight, titleKey, type Send } from "../src/learn/update.js";
import { scoreAccount } from "../src/modules/accounts.js";
import { loadFixture } from "../src/modules/fixture.js";
import { titleRank } from "../src/modules/people.js";
import type { Receipt } from "../src/receipt.js";
import { PKG_ROOT, sha256 } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const quiet = () => {};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "looot-zeus-learn-"));
}

/** A results CSV: n rows per group, the first `replies` of each group replied. */
function resultsCsv(groups: { n: number; replies: number; industry: string; title?: string; bounces?: number }[]): string {
  const lines = ["email,website,industry,title,employees,country,replied,bounced"];
  let k = 0;
  for (const g of groups)
    for (let i = 0; i < g.n; i++) {
      k++;
      const bounced = i >= g.replies && i < g.replies + (g.bounces ?? 0);
      lines.push(`p${k}@${g.industry}-${k}.example,${g.industry}-${k}.example,${g.industry},${g.title ?? "Head of Sales"},60,United Kingdom,${i < g.replies ? "yes" : "no"},${bounced ? "yes" : ""}`);
    }
  return lines.join("\n") + "\n";
}

const CONFIG = `domain: yourdomain.com
brand: YourBrand
offer: Sales pipeline software
icp:
  industries: [agencies, software]
  sizeBand: 11-200
  geos: [United Kingdom]
  titles: [Head of Sales, Founder]
seeds: []
competitors: []
keywords: []
`;

function workspace(): { dir: string; out: string; config: string } {
  const dir = tmp();
  const out = join(dir, "gtm");
  mkdirSync(out, { recursive: true });
  const config = join(out, "config.yaml");
  writeFileSync(config, CONFIG);
  return { dir, out, config };
}

// ---- reading outcomes ---------------------------------------------------------------------------

test("the CSV reader handles quotes, commas in quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿email,note\r\n"a@x.example","hi, ""there"""\r\nb@y.example,\r\n');
  assert.deepEqual(rows, [["email", "note"], ["a@x.example", 'hi, "there"'], ["b@y.example", ""]]);
});

test("results are read from loose column names and status words", () => {
  const out = readResults(
    [
      "Email Address,Reply Count,Lead Status,Job Title",
      "Ann@A.example,2,,Head of Sales",
      "bob@b.example,0,Bounced,Founder",
      "cat@c.example,0,Meeting booked,VP Sales",
      "dan@d.example,0,not interested,Founder",
      "eve@e.example,0,contacted,Founder",
      "not-an-email,1,,",
    ].join("\n"),
  );
  const by = Object.fromEntries(out.map((o) => [o.email, o]));
  assert.equal(out.length, 5);
  assert.equal(by["ann@a.example"].replied, true);
  assert.equal(by["bob@b.example"].bounced, true);
  assert.equal(by["bob@b.example"].replied, false);
  assert.equal(by["cat@c.example"].meeting, true);
  assert.equal(by["cat@c.example"].replied, true);
  assert.equal(by["dan@d.example"].replied, true);
  assert.equal(by["dan@d.example"].interested, false);
  assert.equal(by["eve@e.example"].replied, false);
  assert.equal(by["ann@a.example"].title, "Head of Sales");
});

test("a results file needs an email column and one outcome column", () => {
  assert.throws(() => readResults("name,replied\nAnn,yes\n"), ResultsError);
  assert.throws(() => readResults("email,name\na@x.example,Ann\n"), /replied, bounced, meeting, interested or status/);
  assert.equal(readResults("email,name\na@x.example,Ann\n", { requireOutcome: false }).length, 1);
});

// ---- the rules ------------------------------------------------------------------------------------

test("a weight moves at most 25 percent per learn and stays between 0.5 and 1.5", () => {
  assert.equal(stepWeight(1, 3), 1.25);
  assert.equal(stepWeight(1, 0), 0.75);
  assert.equal(stepWeight(1.4, 2), 1.5);
  assert.equal(stepWeight(0.6, 0), 0.5);
  assert.equal(stepWeight(1, 1.1), 1.1);
});

test("25 sends change nothing and say why", () => {
  const sends: Send[] = Array.from({ length: 25 }, (_, i) => ({ email: `p${i}@s.example`, domain: "s.example", grade: "A", industry: "software", title: "Head of Sales", sizeBand: "51-200", country: "united kingdom" }));
  const r = learnFrom(emptyLearnings(), sends, sends.slice(0, 5).map((s) => ({ email: s.email, replied: true, bounced: false, meeting: false, interested: false })), "2026-11-02");
  assert.equal(r.changes.length, 0);
  assert.match(r.notes.join(" "), /biggest group has 25 sends\. A weight moves only after 30 sends/);
});

test("angles rank only with 30 sends and 3 replies", () => {
  const ranked = rankedAngles([
    { name: "short", sends: 29, replies: 9, meetings: 0 },
    { name: "two replies", sends: 60, replies: 2, meetings: 0 },
    { name: "ok", sends: 30, replies: 3, meetings: 1 },
    { name: "better", sends: 40, replies: 6, meetings: 1 },
  ]);
  assert.deepEqual(ranked.map((a) => a.name), ["better", "ok"]);
});

const sendsIn = (industry: string, n: number, title = "Head of Sales"): Send[] =>
  Array.from({ length: n }, (_, i) => ({ email: `p${i}@${industry}-${i}.example`, domain: `${industry}-${i}.example`, grade: "B", industry, title, sizeBand: "51-200", country: "united kingdom" }));

test("an industry under 40 percent valid emails on 30 lookups and 30 sends loses 10 percent", () => {
  const prev = emptyLearnings();
  prev.runs = [{ date: "2026-10-30", at: "2026-10-30T09:00:00.000Z", charged: 1, calls: 10, accounts: {}, emails: { industry: { wholesale: { attempts: 32, found: 16, valid: 9 }, retail: { attempts: 29, found: 2, valid: 1 } }, sizeBand: {} }, providers: {} }];
  const sends = [...sendsIn("wholesale", 30), ...sendsIn("retail", 30)];
  const r = learnFrom(prev, sends, [], "2026-11-02");
  assert.equal(r.changes.length, 1);
  assert.equal(r.next.weights.industry.wholesale, 0.9);
  assert.equal(r.next.weights.industry.retail, undefined, "29 lookups is under the 30 needed");
  // The same run never cuts twice.
  assert.equal(learnFrom(r.next, sends, [], "2026-11-09").changes.length, 0);
});

test("the valid email cut is held when the industry has under 30 sends, with a note", () => {
  const prev = emptyLearnings();
  prev.runs = [{ date: "2026-10-30", at: "2026-10-30T09:00:00.000Z", charged: 1, calls: 10, accounts: {}, emails: { industry: { wholesale: { attempts: 32, found: 16, valid: 9 } }, sizeBand: {} }, providers: {} }];
  const none = learnFrom(prev, [], [], "2026-11-02");
  assert.equal(none.changes.length, 0, "no sends at all");
  assert.equal(none.next.weights.industry.wholesale, undefined);
  assert.match(none.notes.join(" "), /Industry wholesale had 9 of 32 valid emails.*held because it has 0 sends/);
  const few = learnFrom(prev, sendsIn("wholesale", 29), [], "2026-11-02");
  assert.equal(few.changes.length, 0, "29 sends");
  assert.equal(few.next.weights.industry.wholesale, undefined);
  assert.match(few.notes.join(" "), /held because it has 29 sends/);
});

test("a step never moves a weight more than 25 percent after rounding, near both cap bounds", () => {
  // 0.71 up: the cap is 0.8875, plain rounding gives 0.89 (25.35 percent).
  assert.equal(stepWeight(0.71, 2), 0.88);
  // 0.71 down: the cap is 0.5325, plain rounding gives 0.53 (25.35 percent).
  assert.equal(stepWeight(0.71, 0), 0.54);
  for (let c = 50; c <= 150; c++) {
    const old = c / 100;
    for (const target of [0, 0.5, 1.5, 3]) {
      const neu = stepWeight(old, target);
      assert.ok(Math.abs(neu - old) <= old * LEARN.stepCap + 1e-9, `${old} to ${neu} moves more than 25 percent`);
      assert.ok(neu >= LEARN.min && neu <= LEARN.max, `${neu} out of bounds`);
      assert.equal(neu, Math.round(neu * 100) / 100, "two decimals");
    }
  }
});

test("title weights land on the ICP title the provider title matches", () => {
  const icp = ["Head of Sales", "Founder"];
  assert.equal(titleKey("Head of Sales EMEA", icp), "head of sales");
  assert.equal(titleKey("Chief Revenue Officer", icp), "chief revenue officer", "no ICP match keeps its own key");
  const sends = [...sendsIn("software", 30, "Head of Sales EMEA"), ...sendsIn("agencies", 30, "Chief Revenue Officer")];
  const outcomes = sends.slice(0, 9).map((s) => ({ email: s.email, replied: true, bounced: false, meeting: false, interested: false }));
  const r = learnFrom(emptyLearnings(), sends, outcomes, "2026-11-02", { icpTitles: icp });
  assert.equal(r.next.weights.title["head of sales"], 1.25);
  assert.equal(r.next.weights.title["head of sales emea"], undefined);
  assert.equal(r.next.weights.title["chief revenue officer"], 0.75);
  // The run then finds it: an exact ICP hit gets the learned bonus.
  assert.ok(titleRank("Head of Sales EMEA", icp, "sales", r.next.weights.title) > titleRank("Head of Sales EMEA", icp, "sales"));
});

test("a provider is noted after 20 calls on a job with a 15 point lead, never pinned", () => {
  const run = (providers: any) => ({ date: "d", at: "a", charged: 0, calls: 0, accounts: {}, emails: { industry: {}, sizeBand: {} }, providers });
  const noted = providerPrefs([run({ "people.email.find": { A: { hit: 9, miss: 1, fail: 0, fallback: 0 }, B: { hit: 6, miss: 4, fail: 0, fallback: 0 } } })]);
  assert.deepEqual(noted, [{ job: "people.email.find", provider: "A", hitRate: 90, calls: 10, status: "noted" }]);
  assert.equal(providerPrefs([run({ "people.email.find": { A: { hit: 9, miss: 0, fail: 0, fallback: 0 }, B: { hit: 5, miss: 4, fail: 0, fallback: 0 } } })]).length, 0, "18 calls is under 20");
  assert.equal(providerPrefs([run({ "people.email.find": { A: { hit: 8, miss: 2, fail: 0, fallback: 0 }, B: { hit: 7, miss: 3, fail: 0, fallback: 0 } } })]).length, 0, "a 10 point lead is under 15");
});

test("learned weights lift the score of a matching account and title rank follows the title weight", () => {
  const crit = { industries: ["software", "agencies"], band: [11, 200] as [number, number], countries: ["United Kingdom"], stack: [] };
  const co = (industry: string) => ({ company: { domain: `${industry}.example`, name: null, industries: [industry], employees: 60, country: "GB", technologies: [], keywords: [] }, similarity: null, searchRank: 12 });
  const plain = scoreAccount(co("software"), crit);
  const weighted = scoreAccount(co("software"), { ...crit, weights: { industry: { software: 1.25 }, sizeBand: {}, country: {} } });
  const other = scoreAccount(co("agencies"), { ...crit, weights: { industry: { software: 1.25 }, sizeBand: {}, country: {} } });
  assert.ok(weighted.score > plain.score, `${weighted.score} > ${plain.score}`);
  assert.equal(other.score, plain.score);
  assert.match(weighted.reasons, /learned x1\.25/);
  assert.ok(weighted.score <= 100);
  const titles = ["Head of Sales", "Founder"];
  assert.ok(titleRank("Founder", titles, "sales", { founder: 1.4 }) > titleRank("Head of Sales", titles, "sales", { founder: 1.4 }));
  assert.equal(titleRank("Founder", titles, "sales"), titleRank("Founder", titles, "sales", {}));
  assert.deepEqual(byWeight(["Head of Sales", "Founder", "VP Sales"], { founder: 1.2 }), ["Founder", "Head of Sales", "VP Sales"]);
});

test("size bands", () => {
  assert.equal(sizeBandOf(8), "1-10");
  assert.equal(sizeBandOf("140"), "51-200");
  assert.equal(sizeBandOf(""), "");
  assert.equal(sizeBandOf(5000), "1001+");
});

// ---- the commands ---------------------------------------------------------------------------------

test("learn on 25 sends writes nothing that moves a weight and says why", async () => {
  const w = workspace();
  const results = join(w.out, "results.csv");
  writeFileSync(results, resultsCsv([{ n: 25, replies: 6, industry: "software" }]));
  const before = sha256(readFileSync(w.config, "utf8"));
  const lines: string[] = [];
  const l = await cmdLearn({}, w.config, w.out, { log: (x) => lines.push(x), env: {}, date: "2026-11-02" });
  assert.ok(l);
  assert.equal(l!.lastLearn?.changes.length, 0);
  assert.match(lines.join("\n"), /biggest group has 25 sends/);
  assert.ok(!existsSync(join(w.out, "learnings", "changelog.md")), "no changelog line without a change");
  assert.equal(sha256(readFileSync(w.config, "utf8")), before, "config.yaml unchanged");
});

test("40 sends with 6 replies on one industry raise its weight by at most 25 percent, one changelog line, then the next run uses it", async () => {
  const w = workspace();
  writeFileSync(join(w.out, "results.csv"), resultsCsv([{ n: 40, replies: 6, industry: "software" }, { n: 20, replies: 0, industry: "agencies" }]));
  const before = sha256(readFileSync(w.config, "utf8"));
  const lines: string[] = [];
  const l = (await cmdLearn({}, w.config, w.out, { log: (x) => lines.push(x), env: {}, date: "2026-11-02" }))!;
  assert.ok(l.weights.industry.software > 1);
  assert.ok(l.weights.industry.software <= 1.25);
  assert.equal(l.weights.industry.agencies, undefined, "20 sends do not move a weight");
  const log = readFileSync(join(w.out, "learnings", "changelog.md"), "utf8");
  const changeLines = log.split("\n").filter((x) => x.startsWith("- "));
  assert.equal(changeLines.length, 1);
  assert.match(changeLines[0], /2026-11-02 · industry software · replies · 40 sends, 6 replies · 1\.00 to 1\.25/);
  assert.equal(sha256(readFileSync(w.config, "utf8")), before, "learn never writes config.yaml");
  assert.ok(existsSync(join(w.out, "config.next.yaml")));
  const next = readFileSync(join(w.out, "next-run.md"), "utf8");
  assert.match(next, /Suggested cap \d+ USD\./);
  const bullets = next.split("\n").filter((x) => x.startsWith("- "));
  assert.ok(bullets.length >= 1 && bullets.length <= 5, `${bullets.length} lines`);
  assert.match(readFileSync(join(w.out, "config.next.yaml"), "utf8"), /industries:\n\s+- software\n\s+- agencies/);

  // The same file again moves nothing.
  const again: string[] = [];
  await cmdLearn({}, w.config, w.out, { log: (x) => again.push(x), env: {}, date: "2026-11-03" });
  assert.match(again.join("\n"), /already learned from/);
  assert.equal(readLearnings(w.out)!.weights.industry.software, 1.25);

  // The next run. Two search results that tie on everything but industry.
  const runner: JobRunner = {
    async call(job, _input, opts): Promise<CallResult> {
      const hit = job === "company.search" || job === "company.search.filtered";
      return {
        record: { module: opts.module, job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: opts.quotedUsd, charged: 0, ms: 1, ts: new Date().toISOString() },
        run: { runId: "r", status: "completed", outcome: hit ? "hit" : "miss" },
        data: hit ? { items: [{ domain: "alpha-agency.example", name: "Alpha", industry: "agencies", employees: 60, country: "United Kingdom" }, { domain: "zeta-soft.example", name: "Zeta", industry: "software", employees: 60, country: "United Kingdom" }] } : {},
      };
    },
  };
  const firstOf = () => readFileSync(join(w.out, "accounts.csv"), "utf8").split("\n")[1].split(",")[3];
  const plain: string[] = [];
  await cmdRun({ only: "accounts", yes: true, offline: true, cap: "10" }, w.config, w.out, { client: () => runner, log: (x) => plain.push(x) });
  assert.match(plain.join("\n"), /Learnings from 2026-11-02 found, 1 change, not used in this run\. Add --apply-learnings/);
  assert.equal(firstOf(), "alpha-agency.example", "without the flag the run scores as before");
  const used: string[] = [];
  await cmdRun({ only: "accounts", yes: true, offline: true, cap: "10", "apply-learnings": true }, w.config, w.out, { client: () => runner, log: (x) => used.push(x) });
  assert.equal(used[0], "using learnings from 2026-11-02, 1 change");
  assert.equal(firstOf(), "zeta-soft.example", "software ranks higher with the learnings");
  assert.equal(readLearnings(w.out)!.runs.length, 2, "each run keeps a line in learnings.json");
  assert.equal(sha256(readFileSync(w.config, "utf8")), before, "the run never writes config.yaml either");
});

test("learn with no results and no key is a no-op that writes nothing", async () => {
  const w = workspace();
  const lines: string[] = [];
  const r = await cmdLearn({}, w.config, w.out, { log: (x) => lines.push(x), env: {} });
  assert.equal(r, null);
  assert.match(lines.join("\n"), /Nothing to learn from yet/);
  assert.deepEqual(readdirSync(w.out), ["config.yaml"]);
  // The same through the CLI, as the workflow runs it, with no keys in the environment.
  const env = { ...process.env };
  delete env.INSTANTLY_API_KEY;
  delete env.LOOOT_TOKEN;
  const p = spawnSync(process.execPath, [cli, "learn", "--out", w.out], { cwd: w.dir, env, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(readdirSync(w.out), ["config.yaml"]);
});

test("learn --demo works with no key and writes to learn-demo", () => {
  const dir = tmp();
  const env = { ...process.env };
  delete env.INSTANTLY_API_KEY;
  delete env.LOOOT_TOKEN;
  const p = spawnSync(process.execPath, [cli, "learn", "--demo", "--out", join(dir, "gtm")], { cwd: dir, env, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /No key, no network, no charge/);
  assert.match(p.stdout, /industry software 1\.00 to 1\.25/);
  for (const f of ["learnings.json", "next-run.md", "learnings.md", "config.next.yaml", join("learnings", "changelog.md")]) assert.ok(existsSync(join(dir, "gtm", "learn-demo", f)), f);
  assert.ok(!existsSync(join(dir, "gtm", "config.yaml")));
});

test("log writes who was sent which angle and learn joins replies to it", async () => {
  const w = workspace();
  const exp = join(w.out, "exports", "instantly.csv");
  mkdirSync(join(w.out, "exports"), { recursive: true });
  const rows = ["email,first_name,last_name,company_name,website,title,grade"];
  for (let i = 0; i < 32; i++) rows.push(`p${i}@s${i}.example,P,${i},S${i},s${i}.example,Head of Sales,A`);
  writeFileSync(exp, rows.join("\n") + "\n");
  const out = cmdLog({ campaign: "Week 45", angle: "pipeline review", file: exp }, w.out, { log: quiet, date: "2026-11-02" });
  assert.equal(out, join(w.out, "outreach", "2026-11-02-week-45.json"));
  const logged = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(logged.leads.length, 32);
  assert.equal(logged.angle, "pipeline review");
  writeFileSync(join(w.out, "results.csv"), "email,replied,bounced\np0@s0.example,yes,\np1@s1.example,yes,\np2@s2.example,yes,\np3@s3.example,,yes\n");
  const l = (await cmdLearn({}, w.config, w.out, { log: quiet, env: {}, date: "2026-11-09" }))!;
  assert.deepEqual(l.angles, [{ name: "pipeline review", sends: 32, replies: 3, meetings: 0 }]);
  assert.equal(rankedAngles(l.angles).length, 1);
  assert.deepEqual(l.suppress, ["p3@s3.example"]);
});

test("the same email in two campaigns counts once per campaign, a campaign logged twice counts once", async () => {
  const w = workspace();
  mkdirSync(join(w.out, "outreach"), { recursive: true });
  const leads = Array.from({ length: 30 }, (_, i) => ({ email: `p${i}@s${i}.example`, domain: `s${i}.example`, grade: "A", industry: "software", title: "Head of Sales", sizeBand: "51-200", country: "united kingdom" }));
  const put = (f: string, campaign: string) => writeFileSync(join(w.out, "outreach", f), JSON.stringify({ schemaVersion: "1", date: "2026-11-02", campaign, angle: "a", file: "x.csv", leads }));
  put("2026-11-02-week-45.json", "Week 45");
  put("2026-11-03-week-45.json", "Week 45");
  put("2026-11-09-week-46.json", "Week 46");
  writeFileSync(join(w.out, "results.csv"), "email,replied\np0@s0.example,yes\n");
  const lines: string[] = [];
  await cmdLearn({}, w.config, w.out, { log: (x) => lines.push(x), env: {}, date: "2026-11-10" });
  assert.match(lines.join("\n"), /Learning from 60 sends/);
});

test("bounced addresses are left out of the next exports", () => {
  const dir = tmp();
  const outputs = { accounts: { rows: [{ domain: "a.example", grade: "A" }] }, enrich: { rows: [{ account: "A", domain: "a.example", name: "Ann One", title: "VP", email: "ann@a.example", status: "valid" }, { account: "A", domain: "a.example", name: "Bob Two", title: "VP", email: "bob@a.example", status: "valid" }] } };
  writeArtifacts(dir, outputs, { public: false, suppress: ["BOB@a.example"] });
  const csv = readFileSync(join(dir, "exports", "instantly.csv"), "utf8");
  assert.match(csv, /ann@a\.example/);
  assert.doesNotMatch(csv, /bob@a\.example/);
  assert.match(readFileSync(join(dir, "people.csv"), "utf8"), /bob@a\.example/, "people.csv keeps everyone");
});

test("a run keeps one line in learnings.json with grades, emails and providers", () => {
  const dir = tmp();
  const receipt = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8")) as Receipt;
  const outputs = { accounts: loadFixture("accounts"), enrich: loadFixture("enrich") };
  keepRun(dir, receipt, outputs);
  keepRun(dir, receipt, outputs);
  const l = readLearnings(dir)!;
  assert.equal(l.runs.length, 1, "the same run is kept once");
  const e = runEntry(receipt, outputs);
  assert.ok(Object.keys(e.providers).length > 0);
  assert.ok(Object.values(e.emails.industry).some((t) => t.attempts > 0));
  assert.equal(e.accounts.A + e.accounts.B + e.accounts.C + e.accounts.D, outputs.accounts.rows.length);
});

// ---- Instantly, read only -----------------------------------------------------------------------

test("Instantly is skipped cleanly without a key", async () => {
  let called = 0;
  const r = await pullInstantly({}, { env: {}, fetch: (async () => { called++; return new Response("{}"); }) as typeof fetch });
  assert.equal(r, null);
  assert.equal(called, 0);
});

test("Instantly is read with GET only, received emails, auto replies skipped, pages followed, key never shown", async () => {
  const seen: { url: string; method: string; auth: string }[] = [];
  const pages = [
    { items: [{ lead: "Ann@a.example", ue_type: 2, is_auto_reply: 0 }, { lead: "ooo@b.example", ue_type: 2, is_auto_reply: 1 }, { lead: "sent@c.example", ue_type: 1 }], next_starting_after: "cursor-1" },
    { items: [{ lead: "dan@d.example", ue_type: 2 }] },
  ];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method), auth: String((init?.headers as Record<string, string>).Authorization) });
    return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 });
  }) as typeof fetch;
  const r = (await pullInstantly({ campaignId: "c-1" }, { env: { INSTANTLY_API_KEY: "secret-test-key" }, fetch: f }))!;
  assert.deepEqual(r.outcomes.map((o) => o.email).sort(), ["ann@a.example", "dan@d.example"]);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.method === "GET"));
  assert.ok(seen.every((s) => s.auth === "Bearer secret-test-key"));
  assert.match(seen[0].url, /^https:\/\/api\.instantly\.ai\/api\/v2\/emails\?/);
  assert.match(seen[0].url, /email_type=received/);
  assert.match(seen[0].url, /campaign_id=c-1/);
  assert.match(seen[1].url, /starting_after=cursor-1/);
  assert.doesNotMatch(r.note, /secret-test-key/);
  assert.equal(pageUrl(undefined, undefined), "https://api.instantly.ai/api/v2/emails?email_type=received&limit=100");
});

test("a bad Instantly key leaves the CSV in charge and says so without the key", async () => {
  const r = (await pullInstantly({}, { env: { INSTANTLY_API_KEY: "k-123" }, fetch: (async () => new Response("no", { status: 401 })) as typeof fetch }))!;
  assert.equal(r.outcomes.length, 0);
  assert.match(r.note, /not valid \(401\)/);
  assert.doesNotMatch(r.note, /k-123/);
});

test("no outbound write call exists in the learn code", () => {
  for (const f of readdirSync(join(PKG_ROOT, "src", "learn"))) {
    const src = readFileSync(join(PKG_ROOT, "src", "learn", f), "utf8");
    assert.doesNotMatch(src, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i, f);
  }
  const instantly = readFileSync(join(PKG_ROOT, "src", "learn", "instantly.ts"), "utf8");
  assert.equal((instantly.match(/await f\(/g) ?? []).length, 1, "one request site");
  assert.match(instantly, /method: "GET"/);
});

// ---- the workflow and the files -------------------------------------------------------------------

test("the Monday workflow runs learn before the run and does not apply learnings on its own", () => {
  const yml = readFileSync(join(PKG_ROOT, ".github", "workflows", "gtm-watch.yml"), "utf8");
  const learnAt = yml.indexOf("npx looot-zeus learn");
  const runAt = yml.indexOf("npx looot-zeus run");
  assert.ok(learnAt > 0 && learnAt < runAt);
  assert.doesNotMatch(yml, /^\s*run:.*--apply-learnings/m, "no run line applies learnings");
});

test("the fixture learnings and a learn result carry every field the schema requires", async () => {
  const schema = JSON.parse(readFileSync(join(PKG_ROOT, "schema", "learnings.schema.json"), "utf8"));
  const fixture = loadFixture("learnings");
  for (const k of schema.required) assert.ok(k in fixture, `fixture ${k}`);
  const w = workspace();
  writeFileSync(join(w.out, "results.csv"), resultsCsv([{ n: 30, replies: 3, industry: "software" }]));
  await cmdLearn({}, w.config, w.out, { log: quiet, env: {} });
  const l = JSON.parse(readFileSync(join(w.out, "learnings.json"), "utf8"));
  for (const k of schema.required) assert.ok(k in l, `learn ${k}`);
  for (const k of Object.keys(l)) assert.ok(k in schema.properties, `unknown field ${k}`);
  assert.equal(LEARN.minSends, 30);
});

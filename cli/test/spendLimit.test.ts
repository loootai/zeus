// The workspace spend limit (looot budgets, daily or monthly). Read free at quote time, refuse a run whose worst
// case does not fit what is left, stop a run at the first budget_exceeded refusal, and say on the page and in the
// last line which sections are empty because of it. All offline: fake budget answers, no network.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import { LoootClient, readSpendLimit, type CallResult, type JobRunner } from "../src/client.js";
import { CliExit, cmdRunDomain, spendLimitGate, type OneShotDeps } from "../src/commands.js";
import { normalizeConfig } from "../src/config.js";
import { assemble } from "../src/dossier/index.js";
import { ads } from "../src/modules/ads.js";
import { competitors } from "../src/modules/competitors.js";
import { runPipeline, stopLine } from "../src/modules/index.js";
import { intake } from "../src/modules/intake.js";
import { mentions } from "../src/modules/mentions.js";
import { social } from "../src/modules/social.js";
import type { GtmModule } from "../src/modules/types.js";
import { buildQuote } from "../src/quote.js";
import { buildReceipt, receiptMarkdown, validateReceipt } from "../src/receipt.js";

/** A fake gateway for the two budget reads. */
function budgetFetch(o: { preview?: unknown; previewStatus?: number; list?: unknown; listStatus?: number }) {
  const seen: { url: string; body?: unknown }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/v1/budgets/preview")) return new Response(JSON.stringify(o.preview ?? { error: { code: "forbidden", message: "Budget read scope required" } }), { status: o.previewStatus ?? 200 });
    if (url.endsWith("/v1/budgets")) return new Response(JSON.stringify(o.list ?? { budgets: [] }), { status: o.listStatus ?? 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, seen };
}

const client = (f: typeof fetch) => new LoootClient({ token: "t", baseUrl: "https://api.test", fetch: f });

test("quote time: $0.0013 left on a daily limit is below a $1.51 worst case, and the daily period is named", async () => {
  const g = budgetFetch({ preview: { allowed: false, checks: [{ policyId: "b1", version: 1, availableMicros: 1300 }] }, list: { budgets: [{ policyId: "b1", period: "daily", status: "published" }] } });
  const r = await readSpendLimit(client(g.f), 1.51);
  assert.equal(r.state, "below");
  assert.equal(r.availableUsd, 0.0013);
  assert.equal(r.period, "daily");
  assert.deepEqual(g.seen[0]!.body, { dimensions: {}, amountMicros: 1_510_000, currency: "USD" });
  assert.match(r.note, /daily spend limit has \$0\.0013 left/);
});

test("quote time: a key without the budget read scope says so and goes on conservatively", async () => {
  const g = budgetFetch({ previewStatus: 403 });
  const r = await readSpendLimit(client(g.f), 1.51);
  assert.equal(r.state, "unknown");
  assert.match(r.note, /cannot read the workspace spend limits \(budgets:read\)/);
  assert.match(r.note, /stops at the first spend-limit refusal/);
});

test("quote time: no limit, or room for the worst case, passes", async () => {
  assert.equal((await readSpendLimit(client(budgetFetch({ preview: { allowed: true, checks: [] } }).f), 1.51)).state, "none");
  const ok = await readSpendLimit(client(budgetFetch({ preview: { allowed: true, checks: [{ policyId: "m", version: 1, availableMicros: 40_000_000 }] }, list: { budgets: [{ policyId: "m", period: "monthly" }] } }).f), 1.51);
  assert.equal(ok.state, "ok");
  assert.equal(ok.availableUsd, 40);
  assert.equal((await readSpendLimit(null, 1.51)).state, "unknown");
});

test("the gate refuses a run whose worst case is above what the limit has left, and offers a smaller cap when one fits", () => {
  const q = { expectedCapped: 0.4, worstCapped: 1.51 } as Parameters<typeof spendLimitGate>[1];
  const tiny = spendLimitGate({ state: "below", availableUsd: 0.0013, period: "daily", note: "" }, q, 2);
  assert.equal(tiny.ok, false);
  assert.match(tiny.message, /Refused\. Your daily spend limit has \$0\.0013 left/);
  assert.match(tiny.message, /looot\.ai\/usage/);
  assert.doesNotMatch(tiny.message, /--cap/);
  const some = spendLimitGate({ state: "below", availableUsd: 0.9, period: "daily", note: "" }, q, 2);
  assert.equal(some.ok, false);
  assert.match(some.message, /--cap 0\.9/);
  assert.equal(spendLimitGate({ state: "ok", availableUsd: 5, note: "" }, q, 2).ok, true);
  assert.equal(spendLimitGate({ state: "unknown", note: "" }, q, 2).ok, true);
  // A cap under what is left makes the worst case fit.
  assert.equal(spendLimitGate({ state: "below", availableUsd: 0.9, note: "" }, q, 0.85).ok, true);
});

const BOOK = { source: "test", live: {} };
const mods: GtmModule[] = [intake, ads, competitors, social, mentions];
const blocked = (module: string, job: string): CallResult => ({
  record: { module, job, provider: "p", outcome: "fail", quoted: 0, charged: 0, ms: 1, ts: new Date().toISOString(), note: "budget_exceeded (customer)" },
  run: { runId: "rb", status: "blocked", error: { code: "budget_exceeded", message: "This run would exceed the workspace's budget policy.", whoseError: "customer" } },
  data: null,
});
const hit = (module: string, job: string): CallResult => ({ record: { module, job, provider: "p", outcome: "miss", quoted: 0, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: null });

test("run time: the first budget_exceeded stops the run, keeps what was found, and never says done", async () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival.example"] });
  const q = buildQuote(mods, cfg, BOOK);
  let n = 0;
  const jobs: string[] = [];
  // Two calls answer, every call after that is refused by the spend limit.
  const runner: JobRunner = { call: async (job, _i, o) => (jobs.push(job), ++n <= 2 ? hit(o.module, job) : blocked(o.module, job)) };
  const ledger = new CapLedger(50, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger, mode: "live", outDir: "", limitPeriod: "daily", preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "test" } } });
  const refused = res.calls.filter((c) => c.note?.startsWith("budget_exceeded"));
  assert.ok(refused.length >= 1, "the refusal is on the receipt");
  // Modules run in parallel, so calls already sent with the first refusal may also come back refused (5 here), never dozens.
  assert.ok(refused.length <= 8, `stopped at the first refusals, not ${refused.length}`);
  assert.equal(jobs.length, 2 + refused.length, "no call was sent after a refusal came back");
  assert.ok(jobs.length < q.calls, "the rest of the quote was never called");
  assert.ok(res.limitStopped);
  const line = stopLine(res);
  assert.match(line, /^stopped: your daily spend limit/);
  assert.match(line, /looot\.ai\/usage/);
  assert.doesNotMatch(line, /^done/);
  const stoppedIds = [...res.results].filter(([, r]) => r.capScope === "limit").map(([id]) => id);
  assert.ok(stoppedIds.length >= 1);

  const receipt = buildReceipt({ domain: cfg.domain, mode: "live", cap: 50, quote: q, labels: Object.fromEntries(mods.map((m) => [m.id, m.label])), results: res.results, timings: res.timings, calls: res.calls, startedAt: res.startedAt, finishedAt: res.finishedAt, capStopped: false, limitStopped: res.limitStopped });
  assert.deepEqual(validateReceipt(receipt), []);
  assert.equal(receipt.run.stoppedBy?.reason, "spend_limit");
  assert.match(receiptMarkdown(receipt), /Stopped at your daily spend limit/);
  const d = assemble({ domain: cfg.domain, brand: cfg.brand, mods, results: res.results, receipt, public: false, cfg });
  const top = JSON.stringify(d.overview);
  assert.match(top, /stopped at your daily spend limit/);
  const label = mods.find((m) => m.id === stoppedIds[0])!.label;
  assert.ok(top.includes(label), `the overview names the empty section ${label}`);
});

test("one command: a $0.0013 daily limit refuses the run before any paid call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-limit-"));
  const outDir = join(dir, "gtm");
  const events: string[] = [];
  const paid: string[] = [];
  const runner = {
    call: async (job: string, _i: Record<string, unknown>, o: { module: string }) => (paid.push(job), hit(o.module, job)),
    spendLimit: async (worst: number) => readSpendLimit(client(budgetFetch({ preview: { allowed: false, checks: [{ policyId: "b1", version: 1, availableMicros: 1300 }] }, list: { budgets: [{ policyId: "b1", period: "daily" }] } }).f), worst),
  };
  const page = (async () => new Response("<html><head><title>Acme</title></head><body><h1>Acme CRM</h1><p>The sales CRM for small teams.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
  const deps: OneShotDeps = { fetch: page, client: () => runner, isTTY: false, log: (l) => events.push(l) };
  await assert.rejects(cmdRunDomain("acme.example", { offline: true, yes: true }, join(outDir, "config.yaml"), outDir, deps), (e: unknown) => e instanceof CliExit && e.code === 3 && /Refused\. Your daily spend limit has \$0\.0013 left/.test(e.message));
  assert.equal(paid.length, 0, "nothing paid ran");
  const text = events.join("\n");
  assert.match(text, /daily spend limit has \$0\.0013 left/);
  assert.throws(() => readFileSync(join(outDir, "receipt.json")));
});

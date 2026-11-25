import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import { LoootClient, LoootError, readWorkspaceRule, type CallResult, type JobRunner } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { assemble } from "../src/dossier/index.js";
import { ruleFromEffective } from "../src/guardrails.js";
import { ads } from "../src/modules/ads.js";
import { competitors } from "../src/modules/competitors.js";
import { runPipeline, stopLine } from "../src/modules/index.js";
import { intake } from "../src/modules/intake.js";
import { mentions } from "../src/modules/mentions.js";
import { social } from "../src/modules/social.js";
import type { GtmModule } from "../src/modules/types.js";
import { buildQuote, formatQuote } from "../src/quote.js";
import { buildReceipt } from "../src/receipt.js";

const BOOK = { source: "test", live: {} };
const base = { domain: "acme.example", competitors: ["rival.example"] };
const mods: GtmModule[] = [intake, ads, competitors, social, mentions];
const jobsOf = (q: ReturnType<typeof buildQuote>) => q.rows.flatMap((r) => r.lines).map((l) => l.job);
const hit = (module: string, job: string): CallResult => ({ record: { module, job, provider: "p", outcome: "miss", quoted: 0, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: null });

async function go(rule: ReturnType<typeof ruleFromEffective>, call: JobRunner["call"]) {
  const cfg = normalizeConfig(base);
  const q = buildQuote(mods, cfg, BOOK, { rule });
  const jobs: string[] = [];
  const runner: JobRunner = { call: async (job, input, opts) => (jobs.push(job), call(job, input, opts)) };
  const ledger = new CapLedger(50, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger, mode: "live", outDir: "", preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "test" } } });
  const receipt = buildReceipt({ domain: cfg.domain, mode: "live", cap: 50, quote: q, labels: Object.fromEntries(mods.map((m) => [m.id, m.label])), results: res.results, timings: res.timings, calls: res.calls, startedAt: res.startedAt, finishedAt: res.finishedAt, capStopped: false });
  const d = assemble({ domain: cfg.domain, brand: cfg.brand, mods, results: res.results, receipt, public: false, cfg });
  return { q, jobs, res, receipt, page: JSON.stringify(d) };
}

test("an enforce guardrail on linkedin keeps LinkedIn in the quote, marked may be blocked, and Zeus does not pre-skip it", async () => {
  const rule = ruleFromEffective({ applies: true, guardrails: [{ mode: "enforce", settings: { blockedPlatforms: ["linkedin"] } }], effective: { blockedPlatforms: ["linkedin"] } });
  const { q, jobs } = await go(rule, async (job, _i, o) => hit(o.module, job));
  assert.ok(jobsOf(q).some((j) => /linkedin/.test(j)), "still quoted: the gateway decides per provider");
  assert.ok(jobs.some((j) => /linkedin/.test(j)), "the call is made and the gateway may refuse it");
  assert.match(formatQuote(q, 5), /ads\.linkedin\.search.*may be blocked by your workspace rule: blockedPlatforms linkedin/);
  assert.equal(q.expected, buildQuote(mods, normalizeConfig(base), BOOK).expected);
});

test("only enforce guardrails count: a shadow guardrail marks nothing, and the pooled effective block is not read", () => {
  assert.equal(ruleFromEffective({ applies: true, guardrails: [{ mode: "shadow", settings: { blockedPlatforms: ["x"] } }], effective: { blockedPlatforms: ["x"] } }), null);
  assert.deepEqual(ruleFromEffective({ guardrails: [{ mode: "enforce", settings: { noLinkedIn: true } }] }), { blockedPlatforms: ["linkedin"] });
  const q = buildQuote(mods, normalizeConfig(base), BOOK, { rule: ruleFromEffective({ guardrails: [{ mode: "shadow", settings: { blockedPlatforms: ["x"] } }] }) });
  assert.doesNotMatch(formatQuote(q), /may be blocked/);
});

test("blockedPlatforms x (enforce) marks x.post.search may be blocked; a refusal mid-run skips it and the page says so", async () => {
  const rule = ruleFromEffective({ applies: true, guardrails: [{ mode: "enforce", settings: { blockedPlatforms: ["x"] } }], effective: { blockedPlatforms: ["x"] } });
  const { q, jobs, page, res } = await go(rule, async (job, _i, o) =>
    job === "x.post.search"
      ? { ...hit(o.module, job), record: { ...hit(o.module, job).record, outcome: "fail", charged: 0, note: "guardrail_blocked (customer)" }, run: { runId: "r", status: "blocked", error: { code: "guardrail_blocked", message: "x terms" } } }
      : hit(o.module, job));
  assert.match(formatQuote(q), /x\.post\.search.*may be blocked by your workspace rule: blockedPlatforms x/);
  assert.ok(jobs.includes("x.post.search") && jobs.includes("reddit.post.search"));
  assert.match(res.results.get("mentions")!.summary, /skipped by your workspace rule/);
  assert.match(page, /skipped by your workspace rule/);
});

test("a guardrail 403 mid-run skips that call, the section ends partial and the page is complete", async () => {
  const fake: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(url).includes("/v1/runs") && body.endpointId === "job:reddit.post.search")
      return new Response(JSON.stringify({ error: { code: "guardrail_blocked", message: "Blocked by guardrail Reddit off" } }), { status: 403 });
    return new Response(JSON.stringify({ runId: "r1", status: "completed", outcome: "miss", actualCost: 0 }), { status: 201 });
  };
  const client = new LoootClient({ token: "t", fetch: fake, sleep: async () => {} });
  const { res, receipt, page } = await go(null, (job, i, o) => client.call(job, i, o));
  assert.equal(res.results.get("mentions")?.status, "done");
  assert.match(res.results.get("mentions")!.summary, /skipped by your workspace rule/);
  assert.ok(receipt.modules.some((m) => m.id === "ads" && m.status === "done"));
  assert.match(page, /skipped by your workspace rule/);
});

test("a 402 mid-run stops further paid calls; done sections stay, the rest say not run with the top-up link", async () => {
  let refused = false;
  let after = 0;
  const { res, receipt, page } = await go(null, async (job, _i, o) => {
    if (refused) after++;
    // The other sections answer quickly and finish; mentions is refused last.
    await new Promise((r) => setTimeout(r, o.module === "mentions" ? 80 : 1));
    if (o.module === "mentions") refused = true;
    if (o.module === "mentions") throw new LoootError("Insufficient balance", 402, "insufficient_balance", "https://looot.ai/usage");
    return hit(o.module, job);
  });
  assert.equal(after, 0, "no paid call starts after the refusal (calls already in flight finish)");
  const notRun = receipt.modules.filter((m) => /not run: balance too low, top up at https:\/\/looot\.ai\/usage/.test(m.summary));
  assert.ok(notRun.length >= 1);
  assert.ok(receipt.modules.some((m) => m.status === "done" && m.id !== "intake"));
  assert.match(page, /balance was too low/);
  assert.match(stopLine(res), /balance too low/);
});

test("guardrail read failure falls back to no rule with a one-line note", async () => {
  const fake: typeof fetch = async () => new Response(JSON.stringify({ error: { code: "control_plane_unavailable" } }), { status: 503 });
  const r = await readWorkspaceRule(new LoootClient({ token: "t", fetch: fake }));
  assert.equal(r.rule, null);
  assert.match(r.note, /not read \(looot answered control_plane_unavailable\)/);
  const down = await readWorkspaceRule(new LoootClient({ token: "t", fetch: async () => { throw new Error("offline"); } }));
  assert.equal(down.rule, null);
  assert.match(down.note, /could not be reached/);
  assert.match((await readWorkspaceRule(null)).note, /no LOOOT_TOKEN/);
  const ok = await readWorkspaceRule(new LoootClient({ token: "t", fetch: async () => new Response(JSON.stringify({ applies: true, guardrails: [{ mode: "enforce", settings: { blockedPlatforms: ["x"] } }] })) }));
  assert.deepEqual(ok.rule, { blockedPlatforms: ["x"] });
});

test("a workspace guardrail never changes the brief: LinkedIn stays on in cfg, so nothing reaches gtm/config.yaml", async () => {
  const { configToYaml } = await import("../src/config.js");
  const rule = ruleFromEffective({ applies: true, guardrails: [{ mode: "enforce", settings: { blockedPlatforms: ["linkedin"] } }], effective: { blockedPlatforms: ["linkedin"] } });
  const cfg = normalizeConfig(base);
  const q = buildQuote(mods, cfg, BOOK, { rule });
  assert.equal(cfg.linkedin, true);
  assert.equal(q.linkedinOff, undefined);
  assert.doesNotMatch(configToYaml(cfg), /linkedin: false|blockedPlatforms|workspaceRule/);
});

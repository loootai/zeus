import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import type { CallResult, JobRunner } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { assemble } from "../src/dossier/index.js";
import { ads } from "../src/modules/ads.js";
import { competitors } from "../src/modules/competitors.js";
import { intake } from "../src/modules/intake.js";
import { MODULES, runPipeline } from "../src/modules/index.js";
import { social } from "../src/modules/social.js";
import { buildQuote, formatQuote } from "../src/quote.js";
import { buildReceipt } from "../src/receipt.js";

const BOOK = { source: "test", live: {} };
const base = { domain: "acme.example", competitors: ["rival.example"] };
const mods = [intake, ads, competitors, social];
const isLi = (j: string) => /linkedin/.test(j);

async function run(raw: Record<string, unknown>, o: { noLinkedin?: boolean } = {}) {
  const cfg = normalizeConfig({ ...base, ...raw }, o);
  const q = buildQuote(mods, cfg, BOOK);
  const jobs: string[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      jobs.push(job);
      return { record: { module: opts.module, job, provider: "p", outcome: "miss", quoted: 0, charged: 0, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: null };
    },
  };
  const ledger = new CapLedger(50, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger, mode: "live", outDir: "", preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "test" } } });
  return { cfg, q, jobs, res };
}

test("linkedin is on by default and the quote lists the LinkedIn jobs", async () => {
  const { cfg, q, jobs } = await run({});
  assert.equal(cfg.linkedin, true);
  assert.ok(q.rows.flatMap((r) => r.lines).some((l) => isLi(l.job)));
  assert.ok(jobs.some(isLi));
  assert.equal(q.linkedinOff, undefined);
});

test("linkedin: false in the config skips every LinkedIn call and the quote leaves them out", async () => {
  const { q, jobs } = await run({ linkedin: false });
  assert.equal(q.rows.flatMap((r) => r.lines).filter((l) => isLi(l.job)).length, 0);
  assert.equal(jobs.filter(isLi).length, 0);
  assert.ok(jobs.length > 0, "the other steps still run");
  assert.match(formatQuote(q, 5), /LinkedIn steps off/);
});

test("--no-linkedin (the override) does the same as linkedin: false, and the quote is cheaper", async () => {
  const on = await run({});
  const off = await run({}, { noLinkedin: true });
  assert.equal(off.cfg.linkedin, false);
  assert.equal(off.jobs.filter(isLi).length, 0);
  assert.ok(off.q.expected < on.q.expected);
  assert.ok(off.q.worst < on.q.worst);
});

test("the dossier says LinkedIn steps off", async () => {
  const { cfg, res, q } = await run({ linkedin: false });
  const receipt = buildReceipt({ domain: cfg.domain, mode: "live", cap: 5, quote: q, labels: {}, results: res.results, timings: res.timings, calls: res.calls, startedAt: res.startedAt, finishedAt: res.finishedAt, capStopped: false });
  const d = assemble({ domain: cfg.domain, brand: cfg.brand, mods, results: res.results, receipt, public: false, cfg });
  const cost = (x: typeof d) => JSON.stringify(x.sections.find((sec) => sec.id === "receipt"));
  assert.match(cost(d), /LinkedIn steps off/);
  const d2 = assemble({ domain: cfg.domain, brand: cfg.brand, mods, results: res.results, receipt, public: false, cfg: { ...cfg, linkedin: true } });
  assert.doesNotMatch(cost(d2), /LinkedIn steps off/);
});

test("every module still registers", () => {
  assert.equal(MODULES.length >= 17, true);
});

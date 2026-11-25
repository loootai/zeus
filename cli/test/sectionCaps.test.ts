import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger, CapReached, parseCaps, type CapLimits } from "../src/cap.js";
import type { CallResult, JobRunner } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { DEFAULT_CAPS, USE_DEFAULT_CAPS, resolveCaps } from "../src/capDefaults.js";
import { runPipeline, stopLine } from "../src/modules/index.js";
import type { GtmModule } from "../src/modules/types.js";
import { buildQuote, formatQuote } from "../src/quote.js";
import { buildReceipt, receiptMarkdown } from "../src/receipt.js";

const runner: JobRunner = {
  async call(job, input, opts): Promise<CallResult> {
    return { record: { module: opts.module, job, provider: "p", outcome: "hit", quoted: 0.001, charged: 0.01, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: input };
  },
};

function mk(id: string, n = 5): GtmModule {
  return {
    id, label: id, needs: [],
    quote: () => ({ lines: [{ job: "news.search", calls: n }] }),
    async run(ctx) {
      const got: number[] = [];
      for (let i = 0; i < n; i++) {
        await ctx.call("news.search", { q: `${id}-${i}` }, `q${i}`);
        got.push(i);
        ctx.partial({ got });
      }
      return { status: "done", summary: "all", out: { got } };
    },
    render: () => null,
  };
}

async function go(limits: CapLimits, mods = [mk("one"), mk("two")], cap = 10) {
  const cfg = normalizeConfig({ domain: "acme.example" });
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const ledger = new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })), limits);
  return { res: await runPipeline({ mods, cfg, quote: q, runner, ledger, mode: "live", outDir: "" }), ledger, q, cfg };
}

test("without limits the ledger behaves as before", async () => {
  assert.equal(USE_DEFAULT_CAPS, true);
  const { res } = await go({ sections: {} });
  assert.equal(res.calls.length, 10);
  assert.deepEqual(res.sectionCapped, []);
  assert.deepEqual(resolveCaps({}).sections, DEFAULT_CAPS.sections);
});

test("a section stops at its runs cap, the other section still runs", async () => {
  const { res, ledger } = await go({ sections: { one: { runs: 2 } } });
  assert.equal(res.results.get("one")!.status, "capped");
  assert.equal(res.results.get("one")!.capScope, "section");
  assert.match(res.results.get("one")!.summary, /stopped at its cap: 2 of 2 paid calls/);
  assert.deepEqual(res.results.get("one")!.out, { got: [0, 1] });
  assert.equal(res.results.get("two")!.status, "done");
  assert.equal(res.capStopped, false);
  assert.deepEqual(res.sectionCapped, ["one"]);
  assert.equal(res.calls.length, 7);
  assert.equal(ledger.sectionRuns("one"), 2);
  assert.match(stopLine(res), /one stopped at its section cap/);
});

test("a section stops at its USD cap using the call ceiling", async () => {
  // news.search ceiling is 0.01 per call, so 0.025 allows 2 calls.
  const { res } = await go({ sections: { two: { usd: 0.025 } } });
  assert.equal(res.results.get("two")!.status, "capped");
  assert.equal(res.results.get("two")!.capScope, "section");
  assert.equal(res.calls.filter((c) => c.module === "two").length, 2);
  assert.equal(res.results.get("one")!.status, "done");
});

test("the global runs cap stops the whole run", async () => {
  const { res, ledger } = await go({ totalRuns: 6, sections: {} });
  assert.equal(res.calls.length, 6);
  assert.equal(res.capStopped, true);
  assert.equal(ledger.runs, 6);
  assert.equal(res.results.get("two")!.status, "capped");
});

test("the global USD cap lowers the run cap", () => {
  const l = new CapLedger(10, [{ id: "a", worst: 1 }], { totalUsd: 0.02, sections: {} });
  assert.equal(l.cap, 0.02);
  l.reserve("a", 0.01)(0.01);
  l.reserve("a", 0.01)(0.01);
  assert.throws(() => l.reserve("a", 0.01), (e: unknown) => e instanceof CapReached && e.scope === "run");
});

test("caps in the brief parse from snake_case and camelCase and reject bad numbers", () => {
  const c = normalizeConfig({ domain: "a.example", caps: { total_usd: 1.5, total_runs: 40, sections: { seo: { usd: 0.1, runs: 5 } } } });
  assert.deepEqual(c.caps, { totalUsd: 1.5, totalRuns: 40, sections: { seo: { usd: 0.1, runs: 5 } } });
  assert.deepEqual(parseCaps({ totalRuns: 3 }), { totalRuns: 3, sections: {} });
  assert.throws(() => normalizeConfig({ domain: "a.example", caps: { total_usd: -1 } }), /positive/);
  assert.equal(normalizeConfig({ domain: "a.example" }).caps, undefined);
});

test("--max-runs lowers the config's own total runs", () => {
  assert.equal(normalizeConfig({ domain: "a.example" }, { maxRuns: 9 }).caps?.totalRuns, 9);
  assert.equal(normalizeConfig({ domain: "a.example", caps: { total_runs: 5 } }, { maxRuns: 9 }).caps?.totalRuns, 5);
});

test("the quote prints each section's cap and the worst case under the caps", () => {
  const cfg = normalizeConfig({ domain: "a.example", caps: { total_usd: 0.05, total_runs: 8, sections: { one: { usd: 0.03, runs: 2 } } } });
  const q = buildQuote([mk("one"), mk("two")], cfg, { source: "test", live: {} });
  assert.equal(q.rows[0]!.worstCapped, 0.02);
  assert.equal(q.rows[1]!.worstCapped, q.rows[1]!.worst);
  assert.equal(q.worstCapped, 0.05);
  // expected is 5 x $0.001 per section, below its caps, so it is unchanged
  assert.equal(q.expectedCapped, q.expected);
  const text = formatQuote(q, 1);
  assert.match(text, /Section caps/);
  assert.match(text, /one\s+2 paid calls\s+\$0\.03/);
  assert.match(text, /whole run\s+8 paid calls\s+\$0\.05/);
});

test("the receipt and the dossier say the section stopped at its cap", async () => {
  const { res, q, cfg } = await go({ sections: { one: { runs: 1 } } });
  const receipt = buildReceipt({ domain: cfg.domain, mode: "live", cap: 10, quote: q, labels: { one: "One", two: "Two" }, results: res.results, timings: res.timings, calls: res.calls, startedAt: res.startedAt, finishedAt: res.finishedAt, capStopped: res.capStopped });
  assert.equal(receipt.modules.find((m) => m.id === "one")!.capScope, "section");
  assert.match(receiptMarkdown(receipt), /Stopped at its cap \| One/);
});

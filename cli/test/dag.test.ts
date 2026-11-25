import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import type { CallResult, JobRunner } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { MODULES, runDag, runPipeline, topoOrder } from "../src/modules/index.js";
import type { GtmModule } from "../src/modules/types.js";
import { buildQuote } from "../src/quote.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the spec DAG: intake, icp, accounts, people, enrich in order, synthesis last", () => {
  const order = topoOrder(MODULES);
  const at = (id: string) => order.indexOf(id);
  assert.ok(at("intake") < at("icp") && at("icp") < at("accounts") && at("accounts") < at("people") && at("people") < at("enrich"));
  assert.ok(at("accounts") < at("signals"));
  assert.equal(order.at(-1), "synthesis");
  assert.deepEqual(new Set(MODULES.map((m) => m.id)), new Set(["intake", "icp", "accounts", "people", "enrich", "committee", "signals", "competitors", "ads", "social", "seo", "reviews", "mentions", "market", "local", "commerce", "readiness", "domains", "synthesis"]));
});

test("cycles and missing needs are refused", () => {
  assert.throws(() => topoOrder([{ id: "a", needs: ["b"] }, { id: "b", needs: ["a"] }]), /cycle/);
  assert.throws(() => topoOrder([{ id: "a", needs: ["x"] }]), /not in the run/);
});

test("independent nodes run in parallel, dependents wait", async () => {
  const log: string[] = [];
  let live = 0;
  let peak = 0;
  const nodes = [
    { id: "root", needs: [] },
    { id: "x", needs: ["root"] },
    { id: "y", needs: ["root"] },
    { id: "z", needs: ["root"] },
    { id: "end", needs: ["x", "y", "z"] },
  ];
  await runDag(nodes, async (n) => {
    live++;
    peak = Math.max(peak, live);
    log.push(`start ${n.id}`);
    await sleep(20);
    log.push(`end ${n.id}`);
    live--;
    return { status: "done", summary: "", out: n.id };
  });
  assert.equal(peak, 3);
  assert.equal(log[0], "start root");
  assert.ok(log.indexOf("start end") > log.indexOf("end x"));
  assert.ok(log.indexOf("start end") > log.indexOf("end z"));
});

test("a failing node is recorded and its dependents still run", async () => {
  const r = await runDag([{ id: "a", needs: [] }, { id: "b", needs: ["a"] }], async (n) => {
    if (n.id === "a") throw new Error("boom");
    return { status: "done", summary: "ok", out: null };
  });
  assert.equal(r.get("a")!.status, "skipped");
  assert.match(r.get("a")!.summary, /boom/);
  assert.equal(r.get("b")!.status, "done");
});

test("pipeline stops at the cap, marks the rest capped and keeps partial output", async () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["a.example"] });
  const mk = (id: string, needs: string[]): GtmModule => ({
    id, label: id, needs,
    quote: () => ({ lines: [{ job: "news.search", calls: 5 }] }),
    async run(ctx) {
      const got: number[] = [];
      for (let i = 0; i < 5; i++) {
        await ctx.call("news.search", { q: `${id}-${i}` }, `q${i}`);
        got.push(i);
        ctx.partial({ got });
      }
      return { status: "done", summary: "all", out: { got } };
    },
    render: () => null,
  });
  const mods = [mk("one", []), mk("two", ["one"])];
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      return { record: { module: opts.module, job, provider: "p", outcome: "hit", quoted: 0.001, charged: 0.01, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: input };
    },
  };
  // Ceiling per call is 0.01, so a 0.035 cap allows 3 calls.
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger: new CapLedger(0.035, [{ id: "one", worst: 1 }, { id: "two", worst: 0.0001 }]), mode: "live", outDir: "" });
  assert.equal(res.calls.length, 3);
  assert.equal(res.capStopped, true);
  assert.equal(res.results.get("one")!.status, "capped");
  assert.deepEqual(res.results.get("one")!.out, { got: [0, 1, 2] });
  assert.equal(res.results.get("two")!.status, "capped");
  assert.ok(res.calls.reduce((n, c) => n + c.charged, 0) <= 0.035);
});

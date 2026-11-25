// The module registry and the DAG runner.
// DAG from the spec: intake -> icp -> accounts -> people -> enrich, accounts -> signals,
// intake -> {competitors, ads, seo, reviews, mentions, market, local, commerce}, everything -> synthesis.
// A module starts as soon as everything it needs has settled, so independent modules run in parallel.

import { CapLedger, CapReached } from "../cap.js";
import { withSingleProvider, type CallRecord, type JobRunner } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Quote } from "../quote.js";
import { accounts } from "./accounts.js";
import { ads } from "./ads.js";
import { commerce } from "./commerce.js";
import { committee } from "./committee.js";
import { competitors } from "./competitors.js";
import { enrich } from "./enrich.js";
import { icp } from "./icp.js";
import { intake } from "./intake.js";
import { local } from "./local.js";
import { domains } from "./domains.js";
import { market } from "./market.js";
import { mentions } from "./mentions.js";
import { people } from "./people.js";
import { readiness } from "./readiness.js";
import { reviews } from "./reviews.js";
import { seo } from "./seo.js";
import { signals } from "./signals.js";
import { social } from "./social.js";
import { synthesis } from "./synthesis.js";
import type { GtmModule, ModuleContext, ModuleResult, ModuleStatus } from "./types.js";

export type { GtmModule, ModuleContext, ModuleResult, ModuleStatus } from "./types.js";

/** Every module in dossier order. Synthesis comes last because it reads all the others. */
export const MODULES: GtmModule[] = [intake, icp, accounts, people, enrich, committee, signals, competitors, ads, social, seo, reviews, mentions, market, local, commerce, readiness, domains, synthesis];

export function moduleById(id: string): GtmModule {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`unknown module ${id}`);
  return m;
}

/** Checks every need exists and there is no cycle. Returns ids in a valid order. */
export function topoOrder(mods: Pick<GtmModule, "id" | "needs">[]): string[] {
  const ids = new Set(mods.map((m) => m.id));
  for (const m of mods) for (const n of m.needs) if (!ids.has(n)) throw new Error(`${m.id} needs ${n}, which is not in the run`);
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`cycle: ${[...path, id].join(" -> ")}`);
    state.set(id, 1);
    for (const n of byId.get(id)!.needs) visit(n, [...path, id]);
    state.set(id, 2);
    order.push(id);
  };
  for (const m of mods) visit(m.id, []);
  return order;
}

export interface DagEvent {
  id: string;
  type: "start" | "end";
  at: number;
  result?: ModuleResult;
}

/**
 * Generic parallel DAG runner. `exec` runs one node once all its needs settled. A node runs even
 * when a need was skipped or capped, it gets whatever output exists. Returns results by id.
 */
export async function runDag<T extends { id: string; needs: string[] }>(
  nodes: T[],
  exec: (node: T, done: ReadonlyMap<string, ModuleResult>) => Promise<ModuleResult>,
  onEvent?: (e: DagEvent) => void,
): Promise<Map<string, ModuleResult>> {
  topoOrder(nodes);
  const results = new Map<string, ModuleResult>();
  const running = new Map<string, Promise<void>>();
  const pending = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (pending.size > 0 || running.size > 0) {
    for (const id of [...pending]) {
      const node = byId.get(id)!;
      if (!node.needs.every((n) => results.has(n))) continue;
      pending.delete(id);
      onEvent?.({ id, type: "start", at: Date.now() });
      const p = exec(node, results)
        .catch((e): ModuleResult => ({ status: "skipped", summary: `error: ${(e as Error).message}`, out: null }))
        .then((r) => {
          results.set(id, r);
          running.delete(id);
          onEvent?.({ id, type: "end", at: Date.now(), result: r });
        });
      running.set(id, p);
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  return results;
}

export interface PipelineOptions {
  mods: GtmModule[];
  cfg: GtmConfig;
  quote: Quote;
  runner: JobRunner;
  ledger: CapLedger;
  mode: "live" | "demo";
  outDir: string;
  /** Modules already done before this run, with their output (intake after init). */
  preset?: Record<string, { out: unknown; summary: string }>;
  log?: (line: string) => void;
  onModuleEnd?: (id: string, r: ModuleResult) => void;
  onCall?: (c: CallRecord) => void;
}

export interface ModuleTiming {
  startedAtMs: number;
  endedAtMs: number;
}

export interface PipelineResult {
  results: Map<string, ModuleResult>;
  calls: CallRecord[];
  timings: Map<string, ModuleTiming>;
  capStopped: boolean;
  /** Modules that stopped because they used up their own share of the cap. The run went on. */
  moduleCapped: string[];
  /** Modules that stopped at their own hard section cap (runs or USD). The run went on. */
  sectionCapped: string[];
  startedAt: Date;
  finishedAt: Date;
}

function joinIds(ids: string[]): string {
  return ids.length <= 1 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

/** The first words of the last line of a run. Says plainly when and why the run stopped early. */
export function stopLine(r: { capStopped: boolean; moduleCapped: string[]; sectionCapped?: string[] }): string {
  if (r.capStopped) return "stopped at the cap, partial dossier";
  const sec = [...new Set(r.sectionCapped ?? [])];
  if (sec.length > 0 && r.moduleCapped.length === 0) return `done, but ${joinIds(sec)} stopped at ${sec.length === 1 ? "its" : "their"} section cap, so ${sec.length === 1 ? "that section is" : "those sections are"} partial`;
  const ids = [...new Set(r.moduleCapped)];
  if (ids.length === 0) return "done";
  return ids.length === 1
    ? `done, but ${ids[0]} used up its share of the cap and stopped early, so its section is partial`
    : `done, but ${joinIds(ids)} used up their share of the cap and stopped early, so their sections are partial`;
}

export async function runPipeline(o: PipelineOptions): Promise<PipelineResult> {
  const startedAt = new Date();
  const t0 = startedAt.getTime();
  const calls: CallRecord[] = [];
  const outputs: Record<string, unknown> = {};
  const timings = new Map<string, ModuleTiming>();
  let capStopped = false;
  const moduleCapped: string[] = [];
  const sectionCapped: string[] = [];
  const log = o.log ?? (() => {});
  const rowFor = (id: string) => o.quote.rows.find((r) => r.module === id);

  const exec = async (m: GtmModule): Promise<ModuleResult> => {
    const preset = o.preset?.[m.id];
    if (preset) {
      outputs[m.id] = preset.out;
      return { status: "done", summary: preset.summary, out: preset.out };
    }
    const row = rowFor(m.id);
    if (row?.skip) return { status: "skipped", summary: row.skip, out: { skipped: true, summary: row.skip } };
    if (m.stub && o.mode === "live") return { status: "skipped", summary: "not built yet, shown in demo only", out: { skipped: true, summary: "not built yet, shown in demo only" } };
    if (capStopped && (row?.calls ?? 0) > 0) return { status: "capped", summary: "not started, the cap was reached", out: null };
    let partial: unknown = null;
    const ctx: ModuleContext = {
      cfg: o.cfg,
      mode: o.mode,
      outputs,
      outDir: o.outDir,
      partial: (out) => {
        partial = out;
      },
      log,
      call: async (jobId, input, step) => {
        const line = row?.lines.find((l) => l.job === jobId);
        if (!line) throw new Error(`${m.id} called ${jobId}, which its quote does not list`);
        if (capStopped) throw new CapReached(m.id, "run", "cap reached");
        let settle: (charged: number) => void;
        try {
          settle = o.ledger.reserve(m.id, line.capPerCall);
        } catch (e) {
          if (e instanceof CapReached && e.scope === "run") capStopped = true;
          throw e;
        }
        try {
          const res = await o.runner.call(jobId, input, { module: m.id, step, maxCostUsd: line.capPerCall, quotedUsd: line.expected / Math.max(1, line.calls) });
          res.record = withSingleProvider(res.record);
          settle(res.record.charged);
          calls.push(res.record);
          o.onCall?.(res.record);
          return res;
        } catch (e) {
          settle(0);
          throw e;
        }
      },
    };
    try {
      const r = await m.run(ctx);
      outputs[m.id] = r.out;
      return r;
    } catch (e) {
      if (e instanceof CapReached) {
        if (e.scope === "module") moduleCapped.push(m.id);
        if (e.scope === "section") sectionCapped.push(m.id);
        outputs[m.id] = partial;
        return { status: "capped", summary: e.message, out: partial, ...(e.scope === "section" ? { capScope: "section" as const } : {}) };
      }
      throw e;
    } finally {
      o.ledger.finish(m.id);
    }
  };

  const results = await runDag(o.mods, (m) => exec(m), (e) => {
    if (e.type === "start") timings.set(e.id, { startedAtMs: e.at - t0, endedAtMs: e.at - t0 });
    else {
      const t = timings.get(e.id)!;
      t.endedAtMs = e.at - t0;
      if (e.result) o.onModuleEnd?.(e.id, e.result);
    }
  });
  return { results, calls, timings, capStopped, moduleCapped, sectionCapped, startedAt, finishedAt: new Date() };
}

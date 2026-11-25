// receipt.json and receipt.md. The schema lives in schema/receipt.schema.json and is the contract
// the dossier, the launch page and the video all read. validateReceipt checks a receipt against
// that file with a small validator for the keywords the schema uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CallRecord } from "./client.js";
import type { ModuleTiming } from "./modules/index.js";
import type { ModuleResult } from "./modules/types.js";
import type { Quote } from "./quote.js";
import { PKG_ROOT, round6, usd } from "./util.js";

export interface ReceiptModule {
  id: string;
  label: string;
  status: "done" | "skipped" | "capped";
  /** "section" when the section stopped at its own hard cap. */
  capScope?: "section";
  calls: number;
  quoted: number;
  /** Quoted worst case in USD: every call of the module at its own ceiling. */
  worst: number;
  /** Quoted worst case with this section's cap applied (the most it could cost under its cap). */
  worstCapped?: number;
  /** Quoted expected cost under the section's cap, never above worstCapped. */
  expectedCapped?: number;
  /** This section's hard cap, when it has one. */
  cap?: { usd?: number; runs?: number };
  charged: number;
  summary: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface Receipt {
  schemaVersion: "1";
  placeholder?: string;
  run: {
    domain: string;
    mode: "live" | "demo";
    startedAt: string;
    finishedAt: string;
    cap: number;
    expected: number;
    worst: number;
    /** Quoted worst case with every section cap and the run's dollar cap applied. */
    worstCapped?: number;
    /** The run's own limit on paid calls, when one was set. */
    totalRuns?: number;
    charged: number;
    calls: number;
    durationMs: number;
    capStopped: boolean;
    priceSource: string;
    /** Calls answered from an earlier run at no new charge, with what they cost the first time. */
    replayedCalls?: number;
    replayedValue?: number;
  };
  modules: ReceiptModule[];
  calls: CallRecord[];
}

export interface ReceiptInput {
  domain: string;
  mode: "live" | "demo";
  cap: number;
  quote: Quote;
  labels: Record<string, string>;
  results: Map<string, ModuleResult>;
  timings: Map<string, ModuleTiming>;
  calls: CallRecord[];
  startedAt: Date;
  finishedAt: Date;
  capStopped: boolean;
  placeholder?: string;
}

export function buildReceipt(i: ReceiptInput): Receipt {
  const modules: ReceiptModule[] = [...i.results.entries()].map(([id, r]) => {
    const mine = i.calls.filter((c) => c.module === id);
    const t = i.timings.get(id) ?? { startedAtMs: 0, endedAtMs: 0 };
    const q = i.quote.rows.find((x) => x.module === id);
    return {
      id,
      label: i.labels[id] ?? id,
      status: r.status,
      ...(r.capScope ? { capScope: r.capScope } : {}),
      calls: mine.length,
      quoted: round6(q?.expected ?? 0),
      worst: round6(q?.worst ?? 0),
      ...(q ? { worstCapped: round6(q.worstCapped ?? q.worst), expectedCapped: round6(Math.min(q.expectedCapped ?? q.expected, q.worstCapped ?? q.worst)) } : {}),
      ...(q?.cap && (q.cap.usd !== undefined || q.cap.runs !== undefined) ? { cap: { ...(q.cap.usd !== undefined ? { usd: q.cap.usd } : {}), ...(q.cap.runs !== undefined ? { runs: q.cap.runs } : {}) } } : {}),
      charged: round6(mine.reduce((n, c) => n + c.charged, 0)),
      summary: r.summary,
      startedAtMs: Math.max(0, Math.round(t.startedAtMs)),
      endedAtMs: Math.max(0, Math.round(t.endedAtMs)),
    };
  });
  const order = i.quote.rows.map((r) => r.module);
  modules.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return {
    schemaVersion: "1",
    ...(i.placeholder ? { placeholder: i.placeholder } : {}),
    run: {
      domain: i.domain,
      mode: i.mode,
      startedAt: i.startedAt.toISOString(),
      finishedAt: i.finishedAt.toISOString(),
      cap: i.cap,
      expected: i.quote.expected,
      worst: i.quote.worst,
      worstCapped: round6(Math.min(i.quote.worstCapped ?? i.quote.worst, i.cap)),
      ...(i.quote.totalRuns !== undefined ? { totalRuns: i.quote.totalRuns } : {}),
      charged: round6(i.calls.reduce((n, c) => n + c.charged, 0)),
      calls: i.calls.length,
      durationMs: Math.max(0, i.finishedAt.getTime() - i.startedAt.getTime()),
      capStopped: i.capStopped,
      priceSource: i.quote.priceSource,
      ...(i.calls.some((c) => c.replayed) ? { replayedCalls: i.calls.filter((c) => c.replayed).length, replayedValue: round6(i.calls.reduce((n, c) => n + (c.replayed ? (c.firstCharged ?? 0) : 0), 0)) } : {}),
    },
    modules,
    calls: i.calls,
  };
}

/** What the ledger says about billing, by outcome. Shown as is, overcharges included. */
export function billingBreakdown(r: Receipt) {
  const by = (o: string) => r.calls.filter((c) => c.outcome === o);
  const sum = (cs: CallRecord[]) => round6(cs.reduce((n, c) => n + c.charged, 0));
  const over = r.calls.filter((c) => c.charged > c.quoted + 1e-9);
  return {
    hit: { calls: by("hit").length, charged: sum(by("hit")) },
    fallback: { calls: by("fallback").length, charged: sum(by("fallback")) },
    miss: { calls: by("miss").length, charged: sum(by("miss")) },
    fail: { calls: by("fail").length, charged: sum(by("fail")) },
    overQuote: { calls: over.length, extra: round6(over.reduce((n, c) => n + (c.charged - c.quoted), 0)) },
    singleProvider: singleProviderJobs(r),
  };
}

/** Jobs in this run that have one provider only, with their calls and charge. */
export function singleProviderJobs(r: Pick<Receipt, "calls">): { job: string; calls: number; misses: number; charged: number }[] {
  const by = new Map<string, { job: string; calls: number; misses: number; charged: number }>();
  for (const c of r.calls) {
    if (!c.singleProvider) continue;
    const row = by.get(c.job) ?? { job: c.job, calls: 0, misses: 0, charged: 0 };
    row.calls++;
    if (c.outcome === "miss" || c.outcome === "fail") row.misses++;
    row.charged = round6(row.charged + c.charged);
    by.set(c.job, row);
  }
  return [...by.values()];
}

export function receiptMarkdown(r: Receipt): string {
  const b = billingBreakdown(r);
  const out: string[] = ["# Receipt", ""];
  if (r.placeholder) out.push(`> ${r.placeholder}`, "");
  out.push(`${r.run.domain}, ${r.run.mode} run, ${r.run.startedAt.slice(0, 16).replace("T", " ")} UTC`, "");
  out.push(`| | |`, `|---|---|`);
  out.push(`| Cap | ${usd(r.run.cap)} |`, `| Quoted, expected | ${usd(r.run.expected)} |`, `| Quoted, worst case | ${usd(r.run.worst)} |`, `| New spend | ${usd(r.run.charged)} |`, `| Paid calls | ${r.run.calls - (r.run.replayedCalls ?? 0)} |`, ...(r.run.replayedCalls ? [`| Replayed free | ${r.run.replayedCalls} calls, ${usd(r.run.replayedValue ?? 0)} when they first ran, not charged again |`] : []), `| Time | ${Math.round(r.run.durationMs / 1000)}s |`);
  if (r.run.capStopped) out.push(`| Stopped at the cap | yes, the dossier is partial |`);
  else {
    const short = r.modules.filter((m) => m.status === "capped" && m.capScope !== "section").map((m) => m.label);
    if (short.length > 0) out.push(`| Used up their share of the cap | ${short.join(", ")}, those sections are partial |`);
    const sec = r.modules.filter((m) => m.capScope === "section").map((m) => m.label);
    if (sec.length > 0) out.push(`| Stopped at its cap | ${sec.join(", ")}, those sections are partial. The other sections went on |`);
  }
  out.push("", "## By outcome", "", "| Outcome | Calls | Charged |", "|---|---:|---:|");
  out.push(`| hit | ${b.hit.calls} | ${usd(b.hit.charged)} |`, `| fallback (a later provider answered) | ${b.fallback.calls} | ${usd(b.fallback.charged)} |`, `| miss | ${b.miss.calls} | ${usd(b.miss.charged)} |`, `| fail | ${b.fail.calls} | ${usd(b.fail.charged)} |`);
  if (b.overQuote.calls > 0) out.push("", `${b.overQuote.calls} calls were charged above their quote, ${usd(b.overQuote.extra)} in total. They are listed below.`);
  if (b.singleProvider.length > 0) {
    out.push("", "## One provider, no fallback", "", "These jobs have one provider only. A miss or a failure on them had no second provider to try.", "", "| Job | Calls | Miss or fail | Charged |", "|---|---:|---:|---:|");
    for (const j of b.singleProvider) out.push(`| ${j.job} | ${j.calls} | ${j.misses} | ${usd(j.charged)} |`);
  }
  out.push("", "## By module", "", "| Module | Status | Calls | Quoted | Charged | Summary |", "|---|---|---:|---:|---:|---|");
  for (const m of r.modules) out.push(`| ${m.label} | ${m.status} | ${m.calls} | ${usd(m.quoted)} | ${usd(m.charged)} | ${m.summary} |`);
  out.push("", "## Every call", "", "| Time | Module | Job | Provider | One provider | Outcome | Quoted | Charged | ms |", "|---|---|---|---|---|---|---:|---:|---:|");
  // A replayed call shows 0 charged and says what it cost the first time.
  for (const c of r.calls) {
    const prov = c.fallbackFrom ? `${c.fallbackFrom} then ${c.provider}` : c.provider;
    out.push(`| ${c.ts.slice(11, 19)} | ${c.module} | ${c.job} | ${prov} | ${c.singleProvider ? "yes" : ""} | ${c.outcome}${c.replayed ? `, replayed free (first cost ${(c.firstCharged ?? 0).toFixed(6)})` : ""} | ${c.quoted.toFixed(6)} | ${c.charged.toFixed(6)} | ${c.ms} |`);
  }
  out.push("", `Prices quoted from ${r.run.priceSource}.`, "");
  return out.join("\n");
}

// ---- schema check -------------------------------------------------------------------------

type Schema = Record<string, any>;

function check(v: unknown, s: Schema, path: string, errs: string[]): void {
  const t = s.type;
  const isInt = (x: unknown) => typeof x === "number" && Number.isInteger(x);
  const typeOk =
    t === undefined ||
    (t === "object" && v !== null && typeof v === "object" && !Array.isArray(v)) ||
    (t === "array" && Array.isArray(v)) ||
    (t === "string" && typeof v === "string") ||
    (t === "number" && typeof v === "number" && Number.isFinite(v)) ||
    (t === "integer" && isInt(v)) ||
    (t === "boolean" && typeof v === "boolean");
  if (!typeOk) {
    errs.push(`${path} should be ${t}`);
    return;
  }
  if (s.const !== undefined && v !== s.const) errs.push(`${path} should be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) errs.push(`${path} should be one of ${s.enum.join(", ")}`);
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) errs.push(`${path} is below ${s.minimum}`);
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) errs.push(`${path} should be above ${s.exclusiveMinimum}`);
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${path} is too short`);
    if (s.format === "date-time" && Number.isNaN(Date.parse(v))) errs.push(`${path} is not a date-time`);
  }
  if (t === "object") {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}.${k} is missing`);
    for (const [k, x] of Object.entries(o)) {
      if (s.properties?.[k]) check(x, s.properties[k], `${path}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${path}.${k} is not in the schema`);
    }
  }
  if (t === "array" && s.items) (v as unknown[]).forEach((x, i) => check(x, s.items, `${path}[${i}]`, errs));
}

export function loadReceiptSchema(): Schema {
  return JSON.parse(readFileSync(join(PKG_ROOT, "schema", "receipt.schema.json"), "utf8"));
}

/** Errors against schema/receipt.schema.json plus the sums the schema cannot express. Empty = valid. */
export function validateReceipt(r: unknown, schema: Schema = loadReceiptSchema()): string[] {
  const errs: string[] = [];
  check(r, schema, "receipt", errs);
  if (errs.length > 0) return errs;
  const x = r as Receipt;
  const sum = round6(x.calls.reduce((n, c) => n + c.charged, 0));
  if (Math.abs(sum - x.run.charged) > 1e-6) errs.push(`run.charged ${x.run.charged} differs from the sum of calls ${sum}`);
  if (x.calls.length !== x.run.calls) errs.push(`run.calls ${x.run.calls} differs from ${x.calls.length} call rows`);
  for (const c of x.calls) if (c.outcome === "fallback" && !c.fallbackFrom) errs.push(`a fallback call to ${c.job} has no fallbackFrom`);
  return errs;
}

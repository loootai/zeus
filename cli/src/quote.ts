// Prices a run before it starts. Makes no paid call.
// Unit prices come from src/modules/jobs.ts (checked 30 Oct 2026 with free catalog calls). When the
// network is up, the free GET /v1/catalog/overview?topic=<job> (no token) is read once a day and
// cached in .looot-zeus/prices.json. A live cheapest price above the dated one raises the quote.
// Expected = calls x typical price. Worst case = calls x the per-call ceiling (fallback.maxCostUsd).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GtmConfig } from "./config.js";
import { JOBS, job } from "./modules/jobs.js";
import type { GtmModule } from "./modules/types.js";
import { DEFAULT_BASE_URL } from "./client.js";
import { resolveCaps } from "./capDefaults.js";
import type { SectionLimit } from "./cap.js";
import { round6, writeFile } from "./util.js";

export interface PricedLine {
  module: string;
  job: string;
  calls: number;
  rows?: number;
  unitUsd: number;
  basis: "call" | "result";
  expected: number;
  worst: number;
  /** Per-call ceiling sent as fallback.maxCostUsd. */
  capPerCall: number;
  singleProvider: boolean;
  note?: string;
}

export interface ModuleQuoteRow {
  module: string;
  label: string;
  calls: number;
  expected: number;
  worst: number;
  lines: PricedLine[];
  skip?: string;
  /** This section's hard cap, when it has one. */
  cap?: SectionLimit;
  /** Worst case with the section's cap applied: the lower of the worst case, its USD cap and runs times its dearest call. */
  worstCapped: number;
  /** Expected cost with the section's USD cap applied (a section never costs more than its cap). */
  expectedCapped: number;
}

export interface Quote {
  rows: ModuleQuoteRow[];
  calls: number;
  expected: number;
  worst: number;
  /** Worst case with every section cap and the global dollar cap applied. Equals worst when nothing is capped. */
  worstCapped: number;
  /** Expected cost with every section's USD cap and the global dollar cap applied. Equals expected when nothing is capped. */
  expectedCapped: number;
  /** Global limits that apply, when any. */
  totalUsd?: number;
  totalRuns?: number;
  priceSource: string;
  /** True when the brief turned LinkedIn steps off, so no LinkedIn call is quoted. */
  linkedinOff?: boolean;
}

export interface LivePrice {
  cheapestPerCall: number | null;
  cheapestPerResult: number | null;
}

export interface PriceBook {
  source: string;
  live: Record<string, LivePrice>;
}

const DAY = 86_400_000;

/** Reads live cheapest prices for every job, free and without a token. Cached for a day. */
export async function loadPriceBook(opts: { cacheDir: string; offline?: boolean; fetch?: typeof fetch; baseUrl?: string; now?: Date } = { cacheDir: ".looot-zeus" }): Promise<PriceBook> {
  const now = opts.now ?? new Date();
  const dated = { source: "the dated price table checked 2026-10-30 (offline estimate)", live: {} };
  if (opts.offline) return dated;
  const cacheFile = join(opts.cacheDir, "prices.json");
  if (existsSync(cacheFile)) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, "utf8")) as { at: string; live: Record<string, LivePrice> };
      if (now.getTime() - Date.parse(c.at) < DAY) return { source: `the live catalog, read ${c.at.slice(0, 16).replace("T", " ")} UTC (cached)`, live: c.live };
    } catch {
      // A broken cache is read again from the network.
    }
  }
  const f = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const live: Record<string, LivePrice> = {};
  try {
    await Promise.all(
      Object.keys(JOBS).map(async (id) => {
        const res = await f(`${base}/v1/catalog/overview?topic=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const body = (await res.json()) as { jobs?: { id: string; cheapestPerCall: number | null; cheapestPerResult: number | null }[] };
        const j = body.jobs?.find((x) => x.id === id);
        if (j) live[id] = { cheapestPerCall: j.cheapestPerCall, cheapestPerResult: j.cheapestPerResult };
      }),
    );
  } catch {
    return dated;
  }
  if (Object.keys(live).length === 0) return dated;
  writeFile(cacheFile, JSON.stringify({ at: now.toISOString(), live }, null, 1));
  return { source: `the live catalog, read ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`, live };
}

/** Unit price for a job: the dated typical price, raised when the live cheapest is higher. */
export function unitPrice(jobId: string, book: PriceBook): number {
  const j = job(jobId);
  const l = book.live[jobId];
  const liveUnit = j.basis === "call" ? l?.cheapestPerCall : l?.cheapestPerResult;
  return typeof liveUnit === "number" && liveUnit > j.typicalUsd ? liveUnit : j.typicalUsd;
}

export function priceModule(m: GtmModule, cfg: GtmConfig, book: PriceBook): ModuleQuoteRow {
  const q = m.quote(cfg);
  const lines: PricedLine[] = q.lines
    .filter((l) => l.calls > 0)
    .map((l) => {
      const j = job(l.job);
      const unit = unitPrice(l.job, book);
      const rows = j.basis === "result" ? (l.rows ?? j.rowsPerCall ?? 1) : undefined;
      const perCall = j.basis === "result" ? unit * (rows ?? 1) : unit;
      const capPerCall = Math.max(j.capUsd, round6(perCall * 1.5));
      return {
        module: m.id,
        job: l.job,
        calls: l.calls,
        ...(rows ? { rows } : {}),
        unitUsd: unit,
        basis: j.basis,
        expected: round6(perCall * l.calls * (typeof l.billedShare === "number" ? l.billedShare : 1)),
        worst: round6(capPerCall * l.calls),
        capPerCall,
        singleProvider: j.singleProvider,
        ...(l.note ? { note: l.note } : {}),
      };
    });
  return {
    module: m.id,
    label: m.label,
    calls: lines.reduce((n, l) => n + l.calls, 0),
    expected: round6(lines.reduce((n, l) => n + l.expected, 0)),
    worst: round6(lines.reduce((n, l) => n + l.worst, 0)),
    worstCapped: round6(lines.reduce((n, l) => n + l.worst, 0)),
    expectedCapped: round6(lines.reduce((n, l) => n + l.expected, 0)),
    lines,
    ...(q.skip ? { skip: q.skip } : {}),
  };
}

export function buildQuote(mods: GtmModule[], cfg: GtmConfig, book: PriceBook, opts: { skipDone?: Set<string> } = {}): Quote {
  const caps = resolveCaps(cfg);
  const rows = mods.map((m) => {
    let r = priceModule(m, cfg, book);
    if (opts.skipDone?.has(m.id)) r = { ...r, calls: 0, expected: 0, worst: 0, worstCapped: 0, expectedCapped: 0, lines: [], skip: "done at init" };
    const sec = caps.sections[m.id];
    if (!sec) return r;
    const dearest = Math.max(0, ...r.lines.map((l) => l.capPerCall));
    const limits = [r.worst, ...(sec.usd !== undefined ? [sec.usd] : []), ...(sec.runs !== undefined ? [round6(sec.runs * dearest)] : [])];
    return { ...r, cap: sec, worstCapped: round6(Math.min(...limits)), expectedCapped: round6(Math.min(r.expected, ...(sec.usd !== undefined ? [sec.usd] : []))) };
  });
  const sumCapped = round6(rows.reduce((n, r) => n + r.worstCapped, 0));
  const sumExpectedCapped = round6(rows.reduce((n, r) => n + r.expectedCapped, 0));
  return {
    rows,
    expectedCapped: caps.totalUsd !== undefined ? Math.min(sumExpectedCapped, caps.totalUsd) : sumExpectedCapped,
    worstCapped: caps.totalUsd !== undefined ? Math.min(sumCapped, caps.totalUsd) : sumCapped,
    ...(caps.totalUsd !== undefined ? { totalUsd: caps.totalUsd } : {}),
    ...(caps.totalRuns !== undefined ? { totalRuns: caps.totalRuns } : {}),
    calls: rows.reduce((n, r) => n + r.calls, 0),
    expected: round6(rows.reduce((n, r) => n + r.expected, 0)),
    worst: round6(rows.reduce((n, r) => n + r.worst, 0)),
    priceSource: book.source,
    ...(cfg.linkedin === false ? { linkedinOff: true } : {}),
  };
}

/** The table printed by `looot-zeus quote`. */
export function formatQuote(q: Quote, cap?: number): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const lpad = (s: string, n: number) => s.padStart(n);
  const out: string[] = [];
  out.push(`${pad("module", 13)}${pad("job", 52)}${lpad("calls", 6)}${lpad("expected", 11)}${lpad("worst case", 12)}  note`);
  out.push("-".repeat(124));
  for (const r of q.rows) {
    if (r.lines.length === 0) {
      out.push(`${pad(r.module, 13)}${pad(r.skip ? "skipped" : "no paid calls", 52)}${lpad("0", 6)}${lpad("$0", 11)}${lpad("$0", 12)}  ${r.skip ?? ""}`);
      continue;
    }
    r.lines.forEach((l, i) => {
      const tag = l.singleProvider ? "one provider, no fallback" : "";
      out.push(`${pad(i === 0 ? r.module : "", 13)}${pad(l.job, 52)}${lpad(String(l.calls), 6)}${lpad(`$${l.expected.toFixed(4)}`, 11)}${lpad(`$${l.worst.toFixed(4)}`, 12)}  ${tag}`.trimEnd());
    });
  }
  out.push("-".repeat(124));
  out.push(`${pad("total", 65)}${lpad(String(q.calls), 6)}${lpad(`$${q.expected.toFixed(2)}`, 11)}${lpad(`$${q.worst.toFixed(2)}`, 12)}`);
  const capped = q.rows.filter((r) => r.cap);
  if (capped.length > 0 || q.totalUsd !== undefined || q.totalRuns !== undefined) {
    out.push("", "Section caps (a section stops at its cap, the others go on):");
    for (const r of capped) {
      const c = r.cap!;
      out.push(`  ${pad(r.module, 13)}${pad(c.runs !== undefined ? `${c.runs} paid calls` : "no call limit", 18)}${pad(c.usd !== undefined ? `$${c.usd.toFixed(2)}` : "no USD limit", 14)}worst case under its cap $${r.worstCapped.toFixed(2)}`);
    }
    out.push(`  ${pad("whole run", 13)}${pad(q.totalRuns !== undefined ? `${q.totalRuns} paid calls` : "no call limit", 18)}${pad(q.totalUsd !== undefined ? `$${q.totalUsd.toFixed(2)}` : "no USD limit", 14)}worst case under all caps $${q.worstCapped.toFixed(2)}`);
  }
  if (q.linkedinOff) out.push("", "LinkedIn steps off: no LinkedIn call is quoted or made.");
  out.push("");
  out.push(`Prices from ${q.priceSource}.`);
  out.push("Expected uses the typical price per job. Worst case is every call at its own ceiling, the most looot can hold for it.");
  if (cap !== undefined) out.push(`Cap ${cap.toFixed(2)} USD.`);
  return out.join("\n");
}

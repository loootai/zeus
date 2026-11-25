// Shared helpers for the seo, reviews, mentions, local and commerce modules.
// Loose readers for provider answers (lifted from loootai/looot-mentions and looot-reviews, MIT),
// a small concurrency pool that stops cleanly at the cap plus the section frame every one of the
// five modules renders into.

import { CapReached } from "../cap.js";
import type { CallRecord, CallResult } from "../client.js";
import type { Block, Section } from "../dossier/blocks.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_ROOT, usd } from "../util.js";
import { job } from "./jobs.js";
import type { ModuleContext, ModuleStatus } from "./types.js";

export type Obj = Record<string, unknown>;

export const PLACEHOLDER_SOURCE = "PLACEHOLDER data, invented to show the layout. A real run replaces it.";
export const ONE_PROVIDER = "one provider, no fallback";

/** Narrows to a plain object, or an empty one. */
export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** First non-empty string (numbers become text) among the candidates, or null. */
export function str(...vs: unknown[]): string | null {
  for (const v of vs) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** First finite number among the candidates (numeric strings count), or undefined. */
export function num(...vs: unknown[]): number | undefined {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
  }
  return undefined;
}

/**
 * Finds the first array of objects under any of the given keys, searching wrappers such as data,
 * result, results and tasks[0].result[0] up to four levels deep.
 */
export function list(raw: unknown, keys: string[], depth = 0): Obj[] {
  if (Array.isArray(raw)) {
    const objs = raw.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Obj[];
    // A DataForSEO style wrapper list ([{ items: [...] }]) is unwrapped once.
    if (objs.length === 1 && depth < 4) {
      const inner = list(objs[0], keys, depth + 1);
      if (inner.length > 0) return inner;
    }
    return objs;
  }
  const o = obj(raw);
  for (const k of keys) if (Array.isArray(o[k]) && (o[k] as unknown[]).some((x) => x && typeof x === "object")) return (o[k] as unknown[]).map(obj);
  if (depth >= 4) return [];
  for (const k of ["data", "result", "results", "tasks", "response", "body", "output"]) {
    // A key that is also a list key ("data") is still a wrapper when it holds an object.
    if (o[k] === undefined || (keys.includes(k) && Array.isArray(o[k]))) continue;
    const inner = list(o[k], keys, depth + 1);
    if (inner.length > 0) return inner;
  }
  return [];
}

/** Host of a URL without www, or null. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** True when host is the domain or one of its subdomains. */
export function onDomain(host: string | null, domain: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** Turns a date in any common form into YYYY-MM-DD, or null. "3 days ago" is counted back from now. */
export function dayOf(v: unknown, now: Date): string | null {
  if (typeof v === "number") {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim();
  const rel = /^(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(t);
  if (rel) {
    const n = /^an?$/i.test(rel[1]) ? 1 : Number(rel[1]);
    const per = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[rel[2].toLowerCase() as "day"];
    return new Date(now.getTime() - n * per * 86_400_000).toISOString().slice(0, 10);
  }
  if (/^\d{9,13}$/.test(t)) return dayOf(Number(t), now);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Every string in a value, split into text and URLs, in document order. */
export function strings(v: unknown, out: { text: string[]; urls: string[] } = { text: [], urls: [] }, depth = 0): { text: string[]; urls: string[] } {
  if (depth > 12) return out;
  if (typeof v === "string") {
    if (/^https?:\/\//i.test(v.trim())) out.urls.push(v.trim());
    else if (v.trim()) out.text.push(v);
  } else if (Array.isArray(v)) for (const x of v) strings(x, out, depth + 1);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    // Raw HTML repeats the text and adds markup noise.
    if (/html/i.test(k)) continue;
    strings(x, out, depth + 1);
  }
  return out;
}

/** "hubspot.com" becomes "HubSpot" when the brand is known, otherwise "Hubspot". */
export function nameOfDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text names the term as a whole word (case-insensitive). */
export function names(text: string, term: string): boolean {
  if (!term.trim()) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(term.toLowerCase())}($|[^a-z0-9])`, "i").test(text.toLowerCase());
}

/** A provider trail for one call: "serper", or "serper after anyapi missed". */
export function trail(r: CallRecord): string {
  if (r.outcome === "fallback" && r.fallbackFrom) return `${r.provider} after ${r.fallbackFrom}`;
  return r.provider;
}

/** What one call row says about the answer. */
export function outcomeText(r: CallRecord): string {
  if (r.outcome === "hit" || r.outcome === "fallback") return "answered";
  if (r.outcome === "miss") return "no answer (miss)";
  return `failed${r.note ? `, ${r.note}` : ""}`;
}

/** The fallback column for a job. */
export function fallbackText(jobId: string): string {
  return job(jobId).singleProvider ? ONE_PROVIDER : "yes";
}

export const answered = (r: CallResult): boolean => r.record.outcome === "hit" || r.record.outcome === "fallback";

/** Counts calls and charges by outcome, so a section can say what misses and failures cost. */
export interface Tally {
  calls: number;
  hit: number;
  miss: number;
  fail: number;
  fallback: number;
  charged: number;
  chargedOnMissOrFail: number;
}

export function emptyTally(): Tally {
  return { calls: 0, hit: 0, miss: 0, fail: 0, fallback: 0, charged: 0, chargedOnMissOrFail: 0 };
}

export function count(t: Tally, r: CallRecord): void {
  t.calls++;
  t[r.outcome]++;
  t.charged += r.charged;
  if (r.outcome === "miss" || r.outcome === "fail") t.chargedOnMissOrFail += r.charged;
}

/** One line on what the calls did, for the summary and the section. Never says misses are free. */
export function tallyLine(t: Tally): string {
  const bits = [`${t.calls} calls`];
  if (t.fallback) bits.push(`${t.fallback} answered by a fallback provider`);
  if (t.miss) bits.push(`${t.miss} miss`);
  if (t.fail) bits.push(`${t.fail} failed`);
  bits.push(`${usd(t.charged)} charged`);
  if (t.miss + t.fail > 0) bits.push(`${usd(t.chargedOnMissOrFail)} of it on misses or failures`);
  return bits.join(", ");
}

/**
 * Runs tasks with at most `limit` in flight. When a call hits the cap, no new task starts, the ones
 * already running settle, then CapReached is thrown again so the pipeline marks the module capped
 * with whatever ctx.partial holds. Any other error is thrown the same way.
 */
export async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let stop: unknown = null;
  const worker = async () => {
    while (stop === null && next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (e) {
        if (stop === null) stop = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (stop !== null) throw stop;
}

/** Calls a job and counts it. Returns the result, or throws CapReached. */
export async function tracked(ctx: ModuleContext, t: Tally, calls: CallRecord[], jobId: string, input: Record<string, unknown>, step: string): Promise<CallResult> {
  const r = await ctx.call(jobId, input, step);
  count(t, r.record);
  calls.push(r.record);
  return r;
}

export const isCap = (e: unknown): boolean => e instanceof CapReached;

/** The location name used for country-level SEO and search jobs: the first ICP geography, else United States. */
export function locationOf(geos: string[]): string {
  return geos[0] ?? "United States";
}

const COUNTRY: Record<string, string> = {
  "united states": "us", usa: "us", us: "us", "united kingdom": "gb", uk: "gb", germany: "de", netherlands: "nl", france: "fr", spain: "es", italy: "it",
  canada: "ca", australia: "au", ireland: "ie", belgium: "be", sweden: "se", denmark: "dk", norway: "no", finland: "fi", portugal: "pt", brazil: "br", india: "in",
  switzerland: "ch", austria: "at", poland: "pl", mexico: "mx", japan: "jp", singapore: "sg",
};

/** Two-letter country code for the first ICP geography, else "us". */
export function countryOf(geos: string[]): string {
  return COUNTRY[(geos[0] ?? "").toLowerCase()] ?? "us";
}

export interface FrameSpec {
  num: string;
  id: string;
  title: string;
  deeper?: string;
  activate?: string;
}

/** The section frame: a note when skipped or capped with nothing to show, else the module's blocks. */
export function frame(spec: FrameSpec, out: any, status: ModuleStatus, body: (o: any) => Block[]): Section {
  const base = { num: spec.num, id: spec.id, title: spec.title, status, deeper: spec.deeper, activate: spec.activate };
  const hasRows = out && !out.skipped && (status === "done" || status === "capped");
  if (!hasRows) {
    const why = out?.summary ?? (status === "capped" ? "stopped at the cap before this module ran" : "skipped");
    return { ...base, source: "", blocks: [{ kind: "note", text: why }] };
  }
  const source = out.placeholder ? PLACEHOLDER_SOURCE : `${out.provider ?? "looot"}, ${out.date ?? ""}`;
  const blocks: Block[] = [{ kind: "text", text: out.summary ?? "" }, ...body(out)];
  if (status === "capped") blocks.push({ kind: "note", text: "The run reached the cap inside this module. What is shown is partial." });
  if (out.calls) blocks.push({ kind: "note", text: `This section made ${out.calls}. Each call is on the receipt with its provider, outcome and charge.` });
  return { ...base, source, blocks };
}

/** Providers that answered, joined for the source line. */
export function providersOf(calls: CallRecord[]): string {
  const seen = [...new Set(calls.filter((c) => c.outcome === "hit" || c.outcome === "fallback").map((c) => c.provider))];
  return seen.length > 0 ? seen.join(", ") : "no provider answered";
}

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Reads fixtures/<name>.json. Same as the loader in stubs.ts, kept here so these modules never import stubs.ts. */
export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", `${name}.json`), "utf8")) as T;
}

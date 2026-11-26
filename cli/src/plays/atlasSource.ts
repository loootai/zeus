// Where the Workflow Atlas comes from. Walid's dataset on looot.ai is the one source of truth (Luisa, 2026-11-26):
// https://looot.ai/workflow-atlas/workflows-atlas.json, built in loootai/coset-gateway (PR #3466). Zeus keeps no
// copy of its own: atlas.vendored.json is that file projected to the fields Zeus uses (toVendored), refreshed by
// `npm run atlas:sync` and checked against the live file by `npm run atlas:check`. A run reads the live file once
// a day into .looot-zeus/atlas.json (loadAtlas); offline, or when looot.ai is down, it uses the cache, then the
// vendored copy, so the CLI never fails on it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFile } from "../util.js";

/** The live Atlas dataset, Walid's file on looot.ai. */
export const ATLAS_SOURCE_URL = "https://looot.ai/workflow-atlas/workflows-atlas.json";
/** The Atlas home on looot.ai. */
export const ATLAS_PAGE_URL = "https://looot.ai/workflow-atlas";
/** The full workflow page on looot.ai for one play (Walid's slug). */
export function workflowUrl(slug: string): string {
  return `${ATLAS_PAGE_URL}/${encodeURIComponent(slug)}`;
}

/** The fields of Walid's dataset (workflowAtlasData.ts, schema 1.x) that Zeus reads. The rest is ignored. */
export interface LiveAtlas {
  schemaVersion: string;
  generatedAt: string;
  goals: { id: string; name: string }[];
  workflows: { id: number; slug: string; goal: string; title: string; decisionRule: string; nextAction: string; steps: { providerName: string; purpose: string }[] }[];
}

/** The vendored projection: goals, one provider list and plays as [id, goal index, slug, title, decision rule, next action, provider indexes]. */
export interface VendoredAtlas {
  source: string;
  schemaVersion: string;
  generatedAt: string;
  format: string;
  goals: string[];
  providers: { provider: string; purpose: string }[];
  plays: [number, number, string, string, string, string, number[]][];
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Projects Walid's dataset to what Zeus uses. Throws on a shape Zeus cannot read, so a broken file is never used. */
export function toVendored(raw: unknown): VendoredAtlas {
  const a = raw as Partial<LiveAtlas>;
  if (!a || !str(a.schemaVersion) || !a.schemaVersion.startsWith("1.")) throw new Error(`Atlas schemaVersion ${String(a?.schemaVersion)} is not 1.x`);
  if (!Array.isArray(a.goals) || !Array.isArray(a.workflows) || a.workflows.length === 0) throw new Error("Atlas has no goals or workflows");
  const goals = a.goals.map((g) => g?.name);
  if (!goals.every(str) || new Set(goals).size !== goals.length) throw new Error("Atlas goal names are missing or repeated");
  const providers: VendoredAtlas["providers"] = [];
  const at = (p: { provider: string; purpose: string }) => {
    let k = providers.findIndex((x) => x.provider === p.provider && x.purpose === p.purpose);
    if (k < 0) { k = providers.length; providers.push(p); }
    return k;
  };
  const ids = new Set<number>();
  const slugs = new Set<string>();
  const plays = a.workflows.map((w): VendoredAtlas["plays"][number] => {
    const g = goals.indexOf(w?.goal);
    if (!Number.isInteger(w?.id) || ids.has(w.id) || !str(w.slug) || slugs.has(w.slug) || g < 0 || !str(w.title) || !str(w.decisionRule) || !str(w.nextAction) || !Array.isArray(w.steps) || w.steps.length === 0) throw new Error(`Atlas workflow ${String(w?.id)} is incomplete`);
    if (!w.steps.every((s) => str(s?.providerName) && str(s?.purpose))) throw new Error(`Atlas workflow ${w.id} has a step without a provider or purpose`);
    ids.add(w.id);
    slugs.add(w.slug);
    return [w.id, g, w.slug, w.title, w.decisionRule, w.nextAction, w.steps.map((s) => at({ provider: s.providerName, purpose: s.purpose }))];
  });
  return {
    source: ATLAS_SOURCE_URL,
    schemaVersion: a.schemaVersion,
    generatedAt: str(a.generatedAt) ? a.generatedAt : "",
    format: "plays: [id, goal index, slug, title, decision rule, next action, provider indexes]",
    goals: goals as string[],
    providers,
    plays,
  };
}

/** Checks a projection before it is used (a cache from another Zeus version, or a damaged one): every goal and
 * provider index in range, every field text. Throws on the first problem. */
export function checkVendored(v: unknown): VendoredAtlas {
  const a = v as Partial<VendoredAtlas>;
  if (!a || !Array.isArray(a.goals) || !a.goals.every(str) || !Array.isArray(a.providers) || !Array.isArray(a.plays) || a.plays.length === 0) throw new Error("Atlas copy has no goals, providers or plays");
  if (!a.providers.every((p) => str(p?.provider) && str(p?.purpose))) throw new Error("Atlas copy has a provider without a name or purpose");
  for (const row of a.plays) {
    const [id, g, slug, title, rule, next, steps] = Array.isArray(row) ? row : [];
    const ok = Number.isInteger(id) && Number.isInteger(g) && g! >= 0 && g! < a.goals.length && [slug, title, rule, next].every(str) && Array.isArray(steps) && steps.length > 0 && steps.every((k) => Number.isInteger(k) && k >= 0 && k < a.providers!.length);
    if (!ok) throw new Error(`Atlas copy play ${String(id)} cannot be read`);
  }
  return a as VendoredAtlas;
}

/** The copy of the dataset that ships with Zeus. */
export function vendoredAtlas(): VendoredAtlas {
  return JSON.parse(readFileSync(new URL("./atlas.vendored.json", import.meta.url), "utf8")) as VendoredAtlas;
}

/** Zeus's code (OUTCOMES, goal icons, Run it) names the 20 goals, so a dataset with another goal set is not used. */
function sameGoals(a: VendoredAtlas, b: VendoredAtlas): boolean {
  return a.goals.length === b.goals.length && a.goals.every((g) => b.goals.includes(g));
}

const DAY = 86_400_000;
let memo: { dir: string; at: number; atlas: VendoredAtlas } | null = null;
/** Forgets the in-memory copy (tests). */
export function forgetAtlasMemo(): void {
  memo = null;
}

/** Where this run's Atlas came from. */
export type AtlasOrigin = "live" | "cache" | "vendored";

/**
 * The Atlas for a run: the cache when under a day old, else the live file (5 s timeout, then cached), else a stale
 * cache, else the vendored copy. Never throws and never makes more than one request.
 */
export async function loadAtlas(o: { cacheDir: string; offline?: boolean; fetch?: typeof fetch; now?: Date; url?: string }): Promise<{ atlas: VendoredAtlas; origin: AtlasOrigin; note: string }> {
  const vendored = vendoredAtlas();
  const fallback = (why: string) => ({ atlas: vendored, origin: "vendored" as const, note: `Workflow Atlas: the copy shipped with Zeus (${vendored.generatedAt.slice(0, 10)}), ${why}.` });
  if (o.offline) return fallback("offline");
  const now = o.now ?? new Date();
  // One read a day per process too (the hosted page has no lasting disk).
  if (memo && memo.dir === o.cacheDir && now.getTime() - memo.at < DAY) return { atlas: memo.atlas, origin: "cache", note: `Workflow Atlas: looot.ai, read ${new Date(memo.at).toISOString().slice(0, 10)} (in memory).` };
  const cacheFile = join(o.cacheDir, "atlas.json");
  let stale: VendoredAtlas | null = null;
  if (existsSync(cacheFile)) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, "utf8")) as { at: string; atlas: VendoredAtlas };
      if (c.atlas?.format === vendored.format && sameGoals(checkVendored(c.atlas), vendored)) {
        if (now.getTime() - Date.parse(c.at) < DAY) return { atlas: c.atlas, origin: "cache", note: `Workflow Atlas: looot.ai, read ${c.at.slice(0, 10)} (cached).` };
        stale = c.atlas;
      }
    } catch {
      // A broken cache is read again from the network.
    }
  }
  try {
    const res = await (o.fetch ?? fetch)(o.url ?? ATLAS_SOURCE_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const live = toVendored(await res.json());
    if (!sameGoals(live, vendored)) throw new Error("its goals differ from the 20 Zeus knows");
    try {
      writeFile(cacheFile, JSON.stringify({ at: now.toISOString(), atlas: live }));
    } catch {
      // A read-only disk (the hosted page) keeps the live copy for this run only.
    }
    memo = { dir: o.cacheDir, at: now.getTime(), atlas: live };
    return { atlas: live, origin: "live", note: `Workflow Atlas: looot.ai, read ${now.toISOString().slice(0, 10)}.` };
  } catch (err) {
    const why = `looot.ai could not be read (${err instanceof Error ? err.message : String(err)})`;
    if (stale) return { atlas: stale, origin: "cache", note: `Workflow Atlas: the cached looot.ai copy, ${why}.` };
    return fallback(why);
  }
}

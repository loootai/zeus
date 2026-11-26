// The signed-in owner's three next steps on the private /p/<domain> page (Luisa, 2026-11-26):
// A "Complete your GTM engine" (main button), B "Map another company" and C "Refresh my engine" (small links).
// A lists what THIS run left missing, empty or partial, priced from the dated price table (no network, no paid
// call), and copies a prompt that names exactly those sections, the cap and "ask me before spending".
// Kept out of city/index.ts on purpose: it imports the quote and the modules, which the looot.page bundle must not.
import type { Block } from "../dossier/blocks.js";
import type { Dossier } from "../dossier/index.js";
import { normalizeConfig } from "../config.js";
import { MODULES } from "../modules/index.js";
import { buildQuote, type PriceBook } from "../quote.js";
import { round6, usd } from "../util.js";
import { CITY_VIEWS, LOCKED_LINE, PAID_FEATURES, itemsOf } from "./index.js";

/** One section A would fill. usd is null when Zeus has no module for it: the agent prices it before it runs. */
export interface CtaItem { /** The city view it fills, when it is one. */ view?: string; label: string; state: string; expected: number | null; worst: number | null }
/** What renderCity draws for the owner. complete=true hides A. */
/** One view's own bar: Complete this section (only when it is missing) and Refresh this section. */
export interface ViewCta { complete?: string; state?: string; expected?: number | null; cap?: number; refresh: string }
export interface OwnerCta { /** Per city view id. */ views: Record<string, ViewCta>; items: CtaItem[]; expected: number; cap: number; prompt: string; mapPrompt: string; refreshPrompt: string; runDate: string }

const DATED: PriceBook = { source: "the dated price table", live: {} };

/** The modules that fill each free-run view. Views with none (drafts, calendar) are written by the agent for free. */
const FILL: Record<string, string[]> = {
  targets: ["accounts", "enrich"],
  seo: ["seo"],
  geo: ["seo"],
  readiness: ["readiness"],
  domains: ["domains"],
  influencers: ["social"],
  competitive: ["competitors"],
  reddit: ["mentions"],
  mmap: ["market"],
};
/** City districts the free run does not build, and the Zeus module that fills one (none: the agent prices it). */
const DISTRICT_FILL: Record<string, string[]> = { signals: ["signals"], brief: [], campaign: [] };

const isEmptyNote = (b: Block) => b.kind === "note";

function price(ids: string[], domain: string): { expected: number; worst: number } | null {
  if (ids.length === 0) return null;
  const mods = ids.map((id) => MODULES.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m)).map((m) => ({ ...m, needs: [] }));
  if (mods.length === 0) return null;
  try {
    const q = buildQuote(mods, normalizeConfig({ domain }), DATED);
    // No call quoted (the module needs inputs this run did not have): the agent prices it before it runs, never "$0.00".
    if (q.calls === 0 || q.expectedCapped <= 0) return null;
    return { expected: round6(q.expectedCapped), worst: round6(q.worstCapped) };
  } catch {
    return null;
  }
}

/** The sections this run left missing, empty or partial, plus the districts not in the free run, each priced. */
export function ctaItems(d: Dossier): CtaItem[] {
  const out: CtaItem[] = [];
  const seen = new Set<string>();
  for (const v of CITY_VIEWS) {
    const ids = FILL[v.id];
    if (!ids) continue;
    const secs = v.ids.map((id) => d.sections.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const blocks = secs.flatMap((s) => (v.pick ? s.blocks.filter(v.pick) : s.blocks));
    const n = blocks.find((b) => itemsOf(b) > 0) ? itemsOf(blocks.find((b) => itemsOf(b) > 0)!) : 0;
    const status = secs.map((s) => s.status).find((x) => /partial|capped|skipped|failed|error/i.test(x));
    let state = "";
    if (secs.length === 0) state = "not in this run";
    else if (n === 0 && (blocks.length === 0 || blocks.every(isEmptyNote))) state = v.id === "targets" ? "0 found" : "empty";
    else if (n === 0) state = "0 found";
    else if (status) state = /^partial$/i.test(status) ? "partial" : `partial (${status.toLowerCase()})`;
    if (!state) continue;
    seen.add(v.id);
    const p = price(ids, d.domain);
    out.push({ view: v.id, label: v.label, state, expected: p?.expected ?? null, worst: p?.worst ?? null });
  }
  const signalsFound = d.sections.find((s) => s.id === "signals")?.blocks.some((b) => itemsOf(b) > 0) ?? false;
  for (const [key, ids] of Object.entries(DISTRICT_FILL)) {
    const f = PAID_FEATURES.find((x) => x.key === key);
    if (!f?.district || f.state !== "off") continue;
    if (key === "signals" && signalsFound) continue;
    const p = price(ids, d.domain);
    out.push({ label: f.district, state: LOCKED_LINE.toLowerCase(), expected: p?.expected ?? null, worst: p?.worst ?? null });
  }
  return out;
}

const two = (n: number) => usd(Math.ceil(n * 100) / 100);

/** A's prompt: names exactly the sections, the cap and "ask me before spending". */
export function completePrompt(domain: string, items: CtaItem[], cap: number): string {
  const list = items.map((i) => `${i.label} (${i.state}${i.expected !== null ? `, about ${two(i.expected)}` : ", price it first"})`).join("; ");
  return `Complete my GTM engine for ${domain} with looot Zeus (my private page: https://zeus.looot.ai/p/${domain}). Fill only these sections: ${list}. Keep the whole thing under a cap of ${two(cap)}. Show me the price of each section first and ask me before spending anything. Then push the updated city to zeus.looot.ai.`;
}

/** B's prompt: run Zeus on another company. */
export const MAP_PROMPT = "run zeus.looot.ai for <their-company>.com";
/** C's prompt: the same run again, with what changed. */
export function refreshPrompt(domain: string, runDate: string): string {
  return `run zeus.looot.ai for ${domain} again and show me what changed since ${runDate || "the last run"}. Show me the price first and ask me before spending.`;
}

const capOf = (worst: number) => Math.max(1, Math.ceil(worst));

/** "Complete this section": one section, its price, its cap, ask before spending. */
export function sectionCompletePrompt(domain: string, i: CtaItem): string {
  const cap = capOf(i.worst ?? 0);
  return `Complete the ${i.label} section of my GTM engine for ${domain} with looot Zeus (my private page: https://zeus.looot.ai/p/${domain}). It is ${i.state} now.${i.expected !== null ? ` Expected about ${two(i.expected)}.` : " Price it first."} Keep it under a cap of ${two(cap)}. Show me the price first and ask me before spending anything. Then push the updated city to zeus.looot.ai.`;
}

/** "Refresh this section": re-run that one section and show what changed. */
export function sectionRefreshPrompt(domain: string, label: string, runDate: string): string {
  return `Refresh only the ${label} section of my GTM engine for ${domain} with looot Zeus and show me what changed since ${runDate || "the last run"}. Show me the price first and ask me before spending. Then push the updated city to zeus.looot.ai.`;
}

/** Everything the owner's three buttons need, computed from this run's dossier. No network, no paid call. */
export function ownerCta(d: Dossier): OwnerCta {
  const items = ctaItems(d);
  const expected = round6(items.reduce((n, i) => n + (i.expected ?? 0), 0));
  const worst = round6(items.reduce((n, i) => n + (i.worst ?? 0), 0));
  // The cap is the sum of the priced sections' worst cases, rounded up to the next dollar, at least $1.
  const cap = items.length ? capOf(worst) : 0;
  const runDate = (d.generatedAt ?? "").slice(0, 10);
  const views: Record<string, ViewCta> = {};
  for (const v of CITY_VIEWS) {
    if (!FILL[v.id]) continue;
    const it = items.find((i) => i.view === v.id);
    views[v.id] = { refresh: sectionRefreshPrompt(d.domain, v.label, runDate), ...(it ? { complete: sectionCompletePrompt(d.domain, it), state: it.state, expected: it.expected, cap: capOf(it.worst ?? 0) } : {}) };
  }
  return { views, items, expected, cap, prompt: completePrompt(d.domain, items, cap), mapPrompt: MAP_PROMPT, refreshPrompt: refreshPrompt(d.domain, runDate), runDate };
}

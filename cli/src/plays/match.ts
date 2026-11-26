// "Your next plays": picks the 5 Workflow Atlas plays (Workflow Atlas by Walid) that fit this run.
// Pure and explainable. A play can only be picked when a topic its own words name (its trigger) is in the
// run's findings, and its "why" is that finding's text, word for word. Score per play:
//   3 per trigger topic in the play's title that the run found, 1 per one only in its decision rule
//   + 1 when every step maps to a looot job Zeus knows (a priced job in the catalog snapshot)
//   + 1 when Zeus has a command that runs its goal today (the Run it button)
// A chosen goal keeps only the plays of its Atlas goals. The "why" cites the play's first title trigger
// (else its first rule trigger), so the reason is the play's own subject, not a side fact.
// Ties keep Atlas order. At most 2 plays per Atlas goal (more when a goal narrows the pick), so the 5
// are not one idea five times.
// Prices come from the catalog snapshot (modules/jobs.ts) or the run's cached prices; no call is made.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS } from "../modules/jobs.js";
import { unitPrice, type PriceBook } from "../quote.js";
import type { Finding, Topic } from "./findings.js";

/** One Atlas play: its goal, what it does, its decision rule, what it produces and its provider route. */
export interface AtlasPlay { id: number; goal: string; title: string; rule: string; delivery: string; steps: { provider: string; purpose: string }[] }
/** The extracted Atlas (scripts/extractAtlas.mjs), expanded from its compact rows. */
export const ATLAS: { source: string; extracted: string; goals: string[]; plays: AtlasPlay[] } = (() => {
  const raw = JSON.parse(readFileSync(new URL("./atlas.json", import.meta.url), "utf8")) as { source: string; extracted: string; goals: string[]; providers: { provider: string; purpose: string }[]; plays: [number, number, string, string, string, number[]][] };
  const plays = raw.plays.map(([id, g, title, rule, delivery, steps]) => ({ id, goal: raw.goals[g]!, title, rule, delivery, steps: steps.map((k) => raw.providers[k]!) }));
  return { source: raw.source, extracted: raw.extracted, goals: raw.goals, plays };
})();

/** Which looot job does each Atlas provider step. A provider with no job here is not runnable through Zeus. */
export const STEP_JOB: Record<string, string> = {
  "The Companies API": "company.enrich",
  "People Data Labs": "company.enrich",
  TheirStack: "jobs.search",
  PredictLeads: "news.search",
  Firecrawl: "web.scrape.markdown",
  SerpApi: "maps.local.search",
  BuiltWith: "company.technographics",
  Exa: "google.serp.organic",
  "SearchAPI.io": "google.serp.organic",
  Adyntel: "ads.meta.search",
  Coresignal: "people.search",
  Hunter: "people.email.find",
  ZeroBounce: "people.email.verify",
  DataForSEO: "keywords.domain.overview",
  Cloro: "chatgpt.search.answer",
  ScrapeCreators: "reddit.post.search",
};

/** The 6 plain outcomes of the goal picker, each mapped to Atlas goals. Together they cover all 20. */
export const OUTCOMES: { key: string; label: string; goals: string[] }[] = [
  { key: "more customers", label: "More customers", goals: ["Buying signals", "Outbound research", "Buying committees", "Pipeline and deal execution", "Inbound and product-led growth"] },
  { key: "beat competitors", label: "Beat competitors", goals: ["Competitor displacement", "Positioning and research"] },
  { key: "get found", label: "Get found", goals: ["SEO and AI search", "Paid media", "Commerce and distribution"] },
  { key: "grow accounts", label: "Grow existing accounts", goals: ["Expansion and renewals", "Partnerships"] },
  { key: "new markets", label: "Enter new markets", goals: ["Market sizing and ICP", "Market expansion", "Local market opportunities", "Events and communities", "Technical adoption"] },
  { key: "clean data", label: "Clean data, cut costs", goals: ["CRM and data quality", "GTM operations", "Data spend and reliability"] },
];

/** The Atlas goals for a goal: an outcome key or label, or one Atlas goal name. Anything else is null. */
export function goalsFor(goal: string | undefined): string[] | null {
  const g = (goal ?? "").trim().toLowerCase();
  if (!g) return null;
  const o = OUTCOMES.find((x) => x.key === g || x.label.toLowerCase() === g);
  if (o) return o.goals;
  const a = ATLAS.goals.find((x) => x.toLowerCase() === g);
  return a ? [a] : null;
}

/** The words in a play that make a topic its trigger. */
const TRIGGERS: Record<Topic, RegExp> = {
  hiring: /\b(hir(e|es|ing)|vacanc(y|ies)|job (post|description|opening)s?|open roles?|recruit)/,
  funding: /\b(fund(ing|ed|raise)|raised|raises|investment round|series [a-d])\b/,
  news: /\b(announce(s|d|ment)?|press release|new (office|location|division)|reorg|reorganiz|acquir|expan(d|ds|sion) (into|to))/,
  rivals: /\b(competitor|rival|displace|switch(ing|ers)?|migrat|alternative|incumbent)/,
  ads: /\b(ads?|ad librar(y|ies)|ad creative|advertis(er|ers|ing)|paid (media|search|social))\b/,
  stack: /\b(tech(nology)? stack|technograph|uses? (a|the) tool|installed|tool (is |that is )?reaching end of life)/,
  seo: /\b(keyword|rankings?|ranks?|seo|organic|search demand|serp)\b/,
  geo: /\b(ai answers?|llm|chatgpt|ai search|citations?|cited)\b/,
  readiness: /\b(llms\.txt|crawler|agent[- ]read|machine[- ]readable|structured data|schema markup)/,
  accounts: /\b(target accounts?|account list|lookalike|icp|ideal customer|tam|market size|size the market)\b/,
  reviews: /\b(customer reviews?|reviews (of|on|from|mention|name)|review sites?|ratings?|complain(t|ts|s)?|dissatisf)/,
  mentions: /\b(reddit|forum posts?|forums?|brand mentions?|mentions? of)\b/,
  committee: /\b(stakeholders?|buying committees?|decision makers?|champions?)\b/,
};

/** Trigger order when a play names several: the most specific subject first. */
const ORDER: Topic[] = ["hiring", "funding", "ads", "seo", "geo", "readiness", "reviews", "mentions", "committee", "rivals", "accounts", "stack", "news"];

/** Which looot-zeus command runs a play's goal today. Goals with none get no Run it button. */
const RUN: Record<string, string> = {
  "Buying signals": "npx looot-zeus run --only signals",
  "Buying committees": "npx looot-zeus more committee",
  "Outbound research": "npx looot-zeus more accounts",
  "Market sizing and ICP": "npx looot-zeus more accounts",
  "Paid media": "npx looot-zeus more ads",
  "SEO and AI search": "npx looot-zeus more seo",
  "Positioning and research": "npx looot-zeus more social",
};

/** One recommended play, ready for the page. */
export interface NextPlay {
  id: number;
  goal: string;
  title: string;
  /** "Why it fits <company>: <one finding>." Built only from the run's findings. */
  why: string;
  /** What the play produces (the Atlas's "what to do with the result"). */
  produces: string;
  /** The looot jobs its steps use, in step order. */
  jobs: string[];
  /** Expected and worst cost for `units` companies, and the cap the prompt names. */
  lowUsd: number;
  highUsd: number;
  capUsd: number;
  units: number;
  priceText: string;
  /** What Tell your agent copies. */
  prompt: string;
  /** The looot-zeus command that runs it today, when there is one. */
  runCommand?: string;
  triggers: Topic[];
  score: number;
}

const DATED: PriceBook = { source: "the dated price table", live: {} };

/** The run's cached live prices (.looot-zeus/prices.json, written by the quote), else the dated table. Never a network call. */
export function cachedPriceBook(dir = ".looot-zeus"): PriceBook {
  try {
    const c = JSON.parse(readFileSync(join(dir, "prices.json"), "utf8")) as { at: string; live: PriceBook["live"] };
    if (c && typeof c.live === "object") return { source: `the live catalog, read ${String(c.at).slice(0, 10)} (cached)`, live: c.live };
  } catch {
    // No cache: the dated table.
  }
  return DATED;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => (n < 0.01 ? "under $0.01" : n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2).replace(/\.00$/, "")}`);

/** Picks the top plays for this run. No findings, no plays. */
export function matchPlays(i: { company: string; domain: string; findings: Finding[]; goal?: string; isPublic?: boolean; book?: PriceBook; units?: number; n?: number; atlas?: AtlasPlay[]; /** Count every fitting play: no per-goal limit. */ fitOnly?: boolean }): NextPlay[] {
  const found = new Map<Topic, Finding>();
  for (const f of i.findings) if (!found.has(f.topic)) found.set(f.topic, f);
  if (found.size === 0) return [];
  const wanted = goalsFor(i.goal);
  const book = i.book ?? DATED;
  const units = Math.max(1, Math.min(25, Math.round(i.units ?? 10)));
  const scored: { p: AtlasPlay; triggers: Topic[]; lead: Topic; score: number; jobs: string[] }[] = [];
  for (const p of i.atlas ?? ATLAS.plays) {
    if (wanted && !wanted.includes(p.goal)) continue;
    const inTitle = ORDER.filter((t) => TRIGGERS[t].test(p.title.toLowerCase()));
    const inRule = ORDER.filter((t) => !inTitle.includes(t) && TRIGGERS[t].test(p.rule.toLowerCase()));
    const hitsT = inTitle.filter((t) => found.has(t));
    const hitsR = inRule.filter((t) => found.has(t));
    if (hitsT.length + hitsR.length === 0) continue;
    const jobs = [...new Set(p.steps.map((s) => STEP_JOB[s.provider]).filter((j): j is string => !!j && !!JOBS[j]))];
    if (jobs.length === 0) continue;
    const allRunnable = p.steps.every((s) => STEP_JOB[s.provider] && JOBS[STEP_JOB[s.provider]!]);
    scored.push({ p, triggers: [...inTitle, ...inRule], lead: (hitsT[0] ?? hitsR[0])!, jobs, score: 3 * hitsT.length + hitsR.length + (allRunnable ? 1 : 0) + (RUN[p.goal] ? 1 : 0) });
  }
  scored.sort((a, z) => z.score - a.score);
  if (i.fitOnly) return scored.map((s) => build(s.p, s.triggers, s.score, s.jobs, found.get(s.lead)!, i, book, units));
  const perGoal = new Map<string, number>();
  const maxPerGoal = wanted ? Math.max(2, Math.ceil((i.n ?? 5) / wanted.length)) : 2;
  const usedWhy = new Set<Topic>();
  const out: NextPlay[] = [];
  // Pass 0 takes one play per goal citing a finding not cited yet, pass 1 allows a second play per goal,
  // pass 2 lets a finding be cited twice. So the 5 cite different facts and goals where the run has them.
  for (const pass of [0, 1, 2]) {
    for (const s of scored) {
      if (out.length >= (i.n ?? 5)) break;
      const g = perGoal.get(s.p.goal) ?? 0;
      if (out.some((o) => o.id === s.p.id) || g >= (pass === 0 ? 1 : maxPerGoal)) continue;
      if (pass < 2 && usedWhy.has(s.lead)) continue;
      usedWhy.add(s.lead);
      perGoal.set(s.p.goal, g + 1);
      out.push(build(s.p, s.triggers, s.score, s.jobs, found.get(s.lead)!, i, book, units));
    }
  }
  return out;
}

function build(p: AtlasPlay, triggers: Topic[], score: number, jobs: string[], f: Finding, i: { company: string; domain: string; isPublic?: boolean }, book: PriceBook, units: number): NextPlay {
  const low = jobs.reduce((n, j) => n + unitPrice(j, book) * (JOBS[j]!.basis === "result" ? (JOBS[j]!.rowsPerCall ?? 1) : 1), 0) * units;
  const high = jobs.reduce((n, j) => n + JOBS[j]!.capUsd, 0) * units;
  const cap = Math.max(0.1, Math.ceil(high * 10) / 10);
  const why = `Why it fits ${i.company}: ${i.isPublic ? f.safe : f.text}.`;
  const what = `${units} ${units === 1 ? "company" : "companies"}`;
  const priceText = `about ${money(low)} to ${money(high)} for ${what}`;
  const prompt = `Run this play for ${i.domain} with looot: ${p.title} Decision rule: ${p.rule} Use these looot jobs with fallback on: ${jobs.map((j) => `job:${j}`).join(", ")}. Then: ${p.delivery} Do it for ${what}. Show me the price first and spend nothing without my yes. Budget $${cap.toFixed(2)}, stop at it.`;
  const run = RUN[p.goal];
  return { id: p.id, goal: p.goal, title: p.title, why, produces: p.delivery, jobs, lowUsd: r2(low) || 0.01, highUsd: r2(high), capUsd: cap, units, priceText, prompt, ...(run ? { runCommand: run } : {}), triggers, score };
}

/** The whole Atlas for the city's browse view, compact: goals, providers with their looot job and unit
 * prices, plays as [id, goal index, title, rule, delivery, provider indexes], and the Run it commands. */
export function atlasBrowseData(book: PriceBook = DATED): { goals: string[]; providers: [string, string, string | null, number, number][]; plays: [number, number, string, string, string, number[]][]; run: Record<string, string> } {
  const names: { provider: string; purpose: string }[] = [];
  const idx = (n: { provider: string; purpose: string }) => { let k = names.findIndex((x) => x.provider === n.provider && x.purpose === n.purpose); if (k < 0) { k = names.length; names.push(n); } return k; };
  const plays = ATLAS.plays.map((p) => [p.id, ATLAS.goals.indexOf(p.goal), p.title, p.rule, p.delivery, p.steps.map(idx)] as [number, number, string, string, string, number[]]);
  const providers = names.map((n) => {
    const j = STEP_JOB[n.provider];
    const info = j ? JOBS[j] : undefined;
    const low = info ? unitPrice(j!, book) * (info.basis === "result" ? (info.rowsPerCall ?? 1) : 1) : 0;
    return [n.provider, n.purpose, info ? j! : null, low, info ? info.capUsd : 0] as [string, string, string | null, number, number];
  });
  return { goals: ATLAS.goals, providers, plays, run: RUN };
}

/** How many plays in each Atlas goal fit this run (same rule as matchPlays: a trigger is a finding). */
export function fitCounts(findings: Finding[]): Record<string, number> {
  const all = matchPlays({ company: "", domain: "", findings, n: 100000, fitOnly: true });
  const out: Record<string, number> = {};
  for (const p of all) out[p.goal] = (out[p.goal] ?? 0) + 1;
  return out;
}

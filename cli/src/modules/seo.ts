// Module 8, Search + AI. Keyword gaps against each competitor, a rank table for the config keywords
// and AI answer share: which brands ChatGPT and Google AI Mode name across the buyer questions.
// Logic lifted from loootai/looot-seo (domain intersection, rank overview, position finding) and the
// looot-cookbook recipe 03 seo-and-geo-check (brand counting in AI answers), both MIT.
//
// Jobs (verified 30 Oct 2026, see jobs.ts):
//   keywords.domain.overview                           one provider, no fallback
//   dataforseolabs.google.domain-intersection.live-ai  one provider, no fallback
//   google.serp.organic                                8 providers, fallback on
//   google.serp.ai-mode                                4 providers, fallback on
//   chatgpt.search.answer                              one provider, no fallback, async
// Rows that come from a one-provider job say so in their Fallback column.

import type { CallRecord } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import {
  answered, domainOf, emptyTally, fixture, fallbackText, frame, list, locationOf, nameOfDomain, names, num, obj, onDomain, outcomeText, pool, providersOf, str, strings, tallyLine, today, tracked, trail, type Obj,
} from "./modc-helpers.js";
import { JOBS } from "./jobs.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const SEO_JOBS = {
  overview: "keywords.domain.overview",
  gap: "dataforseolabs.google.domain-intersection.live-ai",
  serp: "google.serp.organic",
  aiMode: "google.serp.ai-mode",
  chatgpt: "chatgpt.search.answer",
} as const;

const GAPS_PER_RIVAL = 20;
const GAPS_SHOWN = 25;
const CONCURRENCY = 4;

export type FootprintRow = { domain: string; keywords: number | null; traffic: number | null; status: string; fallback: string };
export type GapRow = { keyword: string; intent?: string; volume: number | null; you: string; rival: string; fallback: string };
export type RankRow = { keyword: string; you: number | null; best: string; top: string; status: string; provider: string; fallback: string };
export type AiRow = { question: string; engine: string; named: string[]; you: boolean; cited: string[]; status: string; provider: string; fallback: string };

export interface SeoOut {
  placeholder?: string;
  summary: string;
  provider: string;
  date: string;
  location?: string;
  footprint: FootprintRow[];
  gaps: GapRow[];
  ranks: RankRow[];
  ai: AiRow[];
  /** Share of answered AI answers that name each brand, 0 to 1. "you" is the run's own brand. */
  share: Record<string, number>;
  singleProvider: string[];
  calls?: string;
}

export { relevantKeyword } from "./target.js";
import { keywordIntent, relevantKeyword } from "./target.js";

export const SEO_NOTHING = "no keywords, buyer questions or competitors in the config";

export function seoQuote(cfg: GtmConfig): ModuleQuote {
  const n = cfg.competitors.length;
  if (n + cfg.keywords.length + cfg.questions.length === 0) return { lines: [], skip: SEO_NOTHING };
  const lines = [
    { job: SEO_JOBS.overview, calls: 1 + n, note: "you and each competitor" },
    ...(n > 0 ? [{ job: SEO_JOBS.gap, calls: n, note: "keywords a competitor ranks for and you do not" }] : []),
    ...(cfg.keywords.length > 0 ? [{ job: SEO_JOBS.serp, calls: cfg.keywords.length, note: "one page of Google per keyword" }] : []),
    ...(cfg.questions.length > 0
      ? [
          { job: SEO_JOBS.aiMode, calls: cfg.questions.length, note: "Google AI Mode per buyer question" },
          { job: SEO_JOBS.chatgpt, calls: cfg.questions.length, rows: 1, note: "ChatGPT per buyer question" },
        ]
      : []),
  ];
  return { lines };
}

// ---------- parsers (pure, tested on their own) ----------

/** DataForSEO Labs rank overview: ranking keyword count and estimated monthly traffic. */
export function parseOverview(raw: unknown): { keywords: number | null; traffic: number | null } | null {
  const item = list(raw, ["items"])[0];
  const organic = obj(obj(item?.metrics).organic);
  const keywords = num(organic.count) ?? null;
  const traffic = num(organic.etv) ?? null;
  if (keywords === null && traffic === null) return null;
  return { keywords, traffic: traffic === null ? null : Math.round(traffic) };
}

/** Domain intersection with target1 = competitor, target2 = you, intersections false: the competitor's keywords you do not rank for. */
export function parseGaps(raw: unknown): { keyword: string; volume: number | null; rank: number | null }[] {
  return list(raw, ["items"]).flatMap((i) => {
    const kd = obj(i.keyword_data);
    const keyword = str(kd.keyword, i.keyword);
    if (!keyword) return [];
    const serp = obj(i.first_domain_serp_element);
    return [{ keyword, volume: num(obj(kd.keyword_info).search_volume, i.search_volume) ?? null, rank: num(serp.rank_group, serp.rank_absolute) ?? null }];
  });
}

/** Organic results in order with their hosts. Positions fall back to the order when the provider sends none. */
export function parseOrganic(raw: unknown): { position: number; host: string }[] {
  const rows = list(raw, ["organic", "organic_results", "items", "results"]).filter((r) => !r.type || r.type === "organic");
  const out: { position: number; host: string }[] = [];
  rows.forEach((r, i) => {
    const host = domainOf(str(r.link, r.url, r.domain));
    if (!host) return;
    out.push({ position: num(r.position, r.rank_group, r.rank_absolute) ?? i + 1, host });
  });
  return out.sort((a, b) => a.position - b.position);
}

export interface Brand { label: string; domain: string; terms: string[]; you: boolean }

export function brandsOf(cfg: GtmConfig): Brand[] {
  const you: Brand = { label: cfg.brand || nameOfDomain(cfg.domain), domain: cfg.domain, terms: [...new Set([cfg.brand, cfg.domain].filter(Boolean))], you: true };
  const rivals = cfg.competitors.map((d) => ({ label: nameOfDomain(d), domain: d, terms: [nameOfDomain(d), d], you: false }));
  return [you, ...rivals];
}

/** Which brands an AI answer names in its text. Also which ones it cites by link. */
export function brandsInAnswer(raw: unknown, brands: Brand[]): { named: string[]; cited: string[] } {
  const s = strings(raw);
  const text = s.text.join("\n");
  const hosts = s.urls.map(domainOf);
  const named = brands.filter((b) => b.terms.some((t) => names(text, t)) || hosts.some((h) => onDomain(h, b.domain))).map((b) => b.label);
  const cited = brands.filter((b) => hosts.some((h) => onDomain(h, b.domain))).map((b) => b.label);
  return { named, cited };
}

/** Share of answered answers that name each brand. Answers that missed or failed do not count. */
export function answerShare(ai: AiRow[], brands: Brand[]): Record<string, number> {
  const done = ai.filter((a) => a.status === "answered");
  const share: Record<string, number> = {};
  for (const b of brands) share[b.you ? "you" : b.label] = done.length ? Math.round((done.filter((a) => a.named.includes(b.label)).length / done.length) * 100) / 100 : 0;
  return share;
}

// ---------- run ----------

async function run(ctx: ModuleContext) {
  const cfg = ctx.cfg;
  const loc = locationOf(cfg.icp.geos);
  const brands = brandsOf(cfg);
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const footprint: FootprintRow[] = [];
  const gapMap = new Map<string, { keyword: string; volume: number | null; rivals: { d: string; rank: number | null }[] }>();
  const ranks: RankRow[] = [];
  const ai: AiRow[] = [];

  const build = (): SeoOut => {
    const rel = [...gapMap.values()]
      .filter((g) => relevantKeyword(g.keyword, cfg.categoryTerms ?? [], [cfg.domain, ...cfg.competitors].map((d) => d.split(".")[0])))
      .map((g) => ({ ...g, rivals: g.rivals.filter((r) => !(cfg.excluded ?? []).includes(r.d)) }))
      .filter((g) => g.rivals.length > 0);
    const offTopic = gapMap.size - rel.length;
    // Buyers first: comparison searches, then commercial ones, then the rest, each by volume.
    const RANK = { comparison: 0, commercial: 1, other: 2, informational: 3 } as const;
    const gaps = rel
      .sort((a, b) => RANK[keywordIntent(a.keyword)] - RANK[keywordIntent(b.keyword)] || (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.localeCompare(b.keyword))
      .slice(0, GAPS_SHOWN)
      .map((g) => {
        const best = [...g.rivals].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
        return { keyword: g.keyword, intent: keywordIntent(g.keyword), volume: g.volume, you: "-", rival: best ? `${best.d}${best.rank ? ` #${best.rank}` : ""}` : "-", fallback: fallbackText(SEO_JOBS.gap) };
      });
    const ranked = ranks.filter((r) => r.you !== null).length;
    const aiDone = ai.filter((a) => a.status === "answered");
    const youNamed = aiDone.filter((a) => a.you).length;
    const parts = [
      `${gaps.length} keyword gaps${offTopic > 0 ? ` about your category (${offTopic} off-topic or from rejected rivals left out)` : ""}`,
      `ranked on ${ranked} of ${ranks.length} keywords`,
      `named in ${youNamed} of ${aiDone.length} AI answers`,
    ];
    return {
      summary: parts.join(", "),
      provider: providersOf(calls),
      date: today(),
      location: loc,
      footprint: [...footprint].sort((a, b) => Number(b.domain === cfg.domain) - Number(a.domain === cfg.domain)),
      gaps,
      ranks: cfg.keywords.map((k) => ranks.find((r) => r.keyword === k)).filter((r): r is RankRow => Boolean(r)),
      ai: [...ai].sort((a, b) => cfg.questions.indexOf(a.question) - cfg.questions.indexOf(b.question) || a.engine.localeCompare(b.engine)),
      share: answerShare(ai, brands),
      singleProvider: Object.values(SEO_JOBS).filter((j) => JOBS[j]?.singleProvider),
      calls: tallyLine(t),
    };
  };

  type Task = () => Promise<void>;
  const tasks: Task[] = [];
  for (const d of [cfg.domain, ...cfg.competitors]) {
    tasks.push(async () => {
      const r = await tracked(ctx, t, calls, SEO_JOBS.overview, { target: d, location_name: loc, language_code: "en" }, `overview:${d}`);
      const o = answered(r) ? parseOverview(r.data) : null;
      footprint.push({ domain: d, keywords: o?.keywords ?? null, traffic: o?.traffic ?? null, status: o ? "answered" : answered(r) ? "answered, no organic data" : outcomeText(r.record), fallback: fallbackText(SEO_JOBS.overview) });
    });
  }
  for (const c of cfg.competitors) {
    tasks.push(async () => {
      const input = { target1: c, target2: cfg.domain, intersections: false, location_name: loc, language_code: "en", limit: GAPS_PER_RIVAL, order_by: ["keyword_data.keyword_info.search_volume,desc"] };
      const r = await tracked(ctx, t, calls, SEO_JOBS.gap, input, `gap:${c}`);
      if (!answered(r)) return;
      for (const g of parseGaps(r.data)) {
        const key = g.keyword.toLowerCase();
        const cur = gapMap.get(key) ?? { keyword: g.keyword, volume: g.volume, rivals: [] };
        cur.volume = Math.max(cur.volume ?? 0, g.volume ?? 0) || cur.volume;
        cur.rivals.push({ d: c, rank: g.rank });
        gapMap.set(key, cur);
      }
    });
  }
  for (const kw of cfg.keywords) {
    tasks.push(async () => {
      const r = await tracked(ctx, t, calls, SEO_JOBS.serp, { query: kw, location: loc, language: "en" }, `rank:${kw}`);
      const organic = answered(r) ? parseOrganic(r.data) : [];
      const mine = organic.find((o) => onDomain(o.host, cfg.domain));
      const rival = organic.find((o) => cfg.competitors.some((c) => onDomain(o.host, c)));
      const rivalDomain = rival ? cfg.competitors.find((c) => onDomain(rival.host, c))! : null;
      ranks.push({
        keyword: kw,
        you: mine?.position ?? null,
        best: rival ? `${rivalDomain} #${rival.position}` : "-",
        top: organic[0]?.host ?? "-",
        status: answered(r) ? "answered" : outcomeText(r.record),
        provider: trail(r.record),
        fallback: fallbackText(SEO_JOBS.serp),
      });
    });
  }
  for (const q of cfg.questions) {
    for (const [engine, jobId, input] of [
      ["Google AI Mode", SEO_JOBS.aiMode, { query: q, location: loc, language: "en" }],
      ["ChatGPT", SEO_JOBS.chatgpt, { query: q }],
    ] as [string, string, Obj][]) {
      tasks.push(async () => {
        const r = await tracked(ctx, t, calls, jobId, input, `${jobId === SEO_JOBS.chatgpt ? "chatgpt" : "aimode"}:${q}`);
        const b = answered(r) ? brandsInAnswer(r.data, brands) : { named: [], cited: [] };
        const youLabel = brands[0].label;
        ai.push({ question: q, engine, named: b.named, you: b.named.includes(youLabel), cited: b.cited, status: answered(r) ? "answered" : outcomeText(r.record), provider: trail(r.record), fallback: fallbackText(jobId) });
      });
    }
  }

  try {
    await pool(tasks, CONCURRENCY, async (task) => {
      await task();
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`seo: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

// ---------- render ----------

const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)}%`;

function blocks(o: SeoOut): Block[] {
  const done = o.ai.filter((a) => (a.status ?? "answered") === "answered");
  const out: Block[] = [
    { kind: "stat", items: [
      { label: "Keyword gaps", value: String(o.gaps.length) },
      { label: "Keywords you rank on", value: `${o.ranks.filter((r) => r.you !== null).length} of ${o.ranks.length}` },
      { label: "AI answers naming you", value: `${done.filter((a) => a.you).length} of ${done.length}` },
    ] },
  ];
  if (o.footprint?.length) out.push({ kind: "table", caption: "Organic footprint", columns: [{ key: "domain", label: "Domain" }, { key: "keywords", label: "Ranking keywords", num: true }, { key: "traffic", label: "Est. visits/mo", num: true }, { key: "fallback", label: "Fallback" }], rows: o.footprint.map((f) => ({ ...f, keywords: f.keywords ?? f.status, traffic: f.traffic ?? "-" })) });
  out.push({ kind: "table", caption: "Keyword gaps, a competitor ranks and you do not", columns: [{ key: "keyword", label: "Keyword" }, { key: "intent", label: "Intent" }, { key: "volume", label: "Searches/mo", num: true }, { key: "you", label: "You" }, { key: "rival", label: "Best rival", logoKey: "rivalDomain" }, { key: "fallback", label: "Fallback" }], rows: o.gaps.map((g) => ({ ...g, rivalDomain: g.rival.split(" ")[0], volume: g.volume ?? "-", fallback: g.fallback ?? "one provider, no fallback" })) });
  out.push({ kind: "table", caption: `Google ranks${o.location ? ` in ${o.location}` : ""}`, columns: [{ key: "keyword", label: "Keyword" }, { key: "you", label: "You" }, { key: "best", label: "Best rival" }, { key: "top", label: "Top result" }, { key: "provider", label: "Provider" }], rows: o.ranks.map((r) => ({ ...r, you: r.you ?? (r.status && r.status !== "answered" ? r.status : "not in top 10"), top: r.top ?? "-", provider: r.provider ?? "-" })) });
  const share = Object.entries(o.share ?? {}).sort((a, b) => b[1] - a[1]);
  if (share.length) out.push({ kind: "table", caption: "AI answer share, answers that name the brand", columns: [{ key: "brand", label: "Brand" }, { key: "share", label: "Share", num: true }], rows: share.map(([brand, s]) => ({ brand: brand === "you" ? "You" : brand, share: pct(s) })) });
  out.push({ kind: "table", caption: "AI answers per buyer question", columns: [{ key: "question", label: "Question" }, { key: "engine", label: "Engine" }, { key: "named", label: "Brands named" }, { key: "you", label: "You named" }, { key: "status", label: "Answer" }, { key: "fallback", label: "Fallback" }], rows: o.ai.map((a) => ({ ...a, you: a.you ? "yes" : "no", named: a.named.length ? a.named : "-", status: a.status ?? "answered", fallback: a.fallback ?? (a.engine === "ChatGPT" ? "one provider, no fallback" : "yes") })) });
  if (o.singleProvider?.length) out.push({ kind: "note", text: `One provider, no fallback for ${o.singleProvider.join(", ")}. A miss on those rows has no second provider behind it.` });
  out.push({ kind: "note", text: `Ranks and AI answers are for ${o.location ?? "the geographies in the run"}, read on ${o.date}. They move week to week.` });
  return out;
}

export const seo: GtmModule = {
  id: "seo",
  label: "Search + AI",
  needs: ["intake"],
  quote: seoQuote,
  async run(ctx) {
    if (ctx.mode === "demo") {
      const f = fixture("seo");
      return { status: "done", summary: f.summary, out: f };
    }
    if (ctx.cfg.competitors.length + ctx.cfg.keywords.length + ctx.cfg.questions.length === 0) return { status: "skipped", summary: SEO_NOTHING, out: { skipped: true, summary: SEO_NOTHING } };
    return run(ctx);
  },
  render: (out, status) =>
    frame({ num: "07", id: "seo", title: "Search + AI", deeper: "github.com/loootai/looot-seo for rank tracking over time", activate: "Write pages for the top 5 gaps, then check the AI answers again next week" }, out, status, (o) => blocks(o as SeoOut)),
};

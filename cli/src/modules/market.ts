// Module 12, market. You and each competitor side by side: web traffic, latest funding round, open
// roles and news in the last 30 days, each cell with the provider that answered and the date.
// No job returns a market size, so this is a snapshot of the players for the geographies in the
// run. It sizes nothing. Web traffic has one provider on the platform key, no fallback.

import type { CallResult } from "../client.js";
import type { Block } from "../dossier/blocks.js";
import { job } from "./jobs.js";
import { answered, baseSection, count, demoResult, isObj, mentions, nameOf, newTally, outcomeText, parseFundingRounds, parseJobPosts, parseNewsItems, type CallTally, type Obj } from "./signals.js";
import type { GtmModule, ModuleContext } from "./types.js";

const JOBS_LIMIT = 25;
const NEWS_LIMIT = 20;

/** Monthly visits from a traffic answer. Looks for the usual keys at any depth. null when none. */
export function parseTraffic(raw: unknown, depth = 0): number | null {
  if (depth > 4) return null;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = parseTraffic(x, depth + 1);
      if (n !== null) return n;
    }
    return null;
  }
  if (!isObj(raw)) return null;
  const o = raw as Obj;
  for (const k of ["monthlyVisits", "monthly_visits", "estimatedMonthlyVisits", "estimated_monthly_visits", "visits", "totalVisits", "total_visits", "traffic", "monthly_traffic"]) {
    const v = o[k];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  for (const v of Object.values(o)) {
    if (typeof v === "object" && v !== null) {
      const n = parseTraffic(v, depth + 1);
      if (n !== null) return n;
    }
  }
  return null;
}

export function visitsText(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M/mo`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K/mo`;
  return `${Math.round(n)}/mo`;
}

/** Cell text for a call that gave no number: miss or fail. */
const noAnswer = (r: CallResult) => (r.record.outcome === "fail" ? "fail" : "not found");

export interface MarketRow {
  name: string;
  domain: string;
  you: boolean;
  traffic: string;
  visits: number | null;
  funding: string;
  openRoles: number | string;
  news30d: number | string;
  sources: string;
  lookups: string;
}

async function snapshot(ctx: ModuleContext, who: { name: string; domain: string; you: boolean }, now: Date, tally: CallTally): Promise<MarketRow> {
  const day = (r: CallResult) => r.record.ts.slice(0, 10);
  const src: string[] = [];
  const looks: string[] = [];

  const t = count(tally, await ctx.call("company.traffic", { domain: who.domain }, `traffic:${who.domain}`));
  looks.push(`traffic ${outcomeText(t)}`);
  const visits = answered(t) ? parseTraffic(t.data) : null;
  if (visits !== null) src.push(`traffic ${t.record.provider} ${day(t)}`);

  const f = count(tally, await ctx.call("company.funding", { domain: who.domain }, `funding:${who.domain}`));
  looks.push(`funding ${outcomeText(f)}`);
  const rounds = answered(f) ? parseFundingRounds(f.data, now) : [];
  const last = rounds[0];
  if (last) src.push(`funding ${f.record.provider} ${day(f)}`);

  const j = count(tally, await ctx.call("jobs.search", { query: who.name, company: who.name, limit: JOBS_LIMIT }, `jobs:${who.domain}`));
  looks.push(`jobs ${outcomeText(j)}`);
  const roles = answered(j) ? parseJobPosts(j.data, now, who.name, who.domain).length : null;
  if (roles !== null) src.push(`jobs ${j.record.provider} ${day(j)}`);

  const n = count(tally, await ctx.call("news.search", { query: `"${who.name}"`, limit: NEWS_LIMIT }, `news:${who.domain}`));
  looks.push(`news ${outcomeText(n)}`);
  const recent = answered(n) ? parseNewsItems(n.data, now).filter((x) => mentions(x.title, who.name, who.domain) && x.date && now.getTime() - Date.parse(x.date) <= 30 * 86_400_000).length : null;
  if (recent !== null) src.push(`news ${n.record.provider} ${day(n)}`);

  return {
    ...who,
    traffic: visits !== null ? visitsText(visits) : noAnswer(t),
    visits,
    funding: last ? `${[last.round, last.amount].filter(Boolean).join(" ")}${last.date ? `, ${last.date}` : ""}` : answered(f) || f.record.outcome === "miss" ? "none found" : "fail",
    openRoles: roles === null ? noAnswer(j) : roles >= JOBS_LIMIT ? `${JOBS_LIMIT}+` : roles,
    news30d: recent === null ? noAnswer(n) : recent >= NEWS_LIMIT ? `${NEWS_LIMIT}+` : recent,
    sources: src.join("; "),
    lookups: looks.join(", "),
  };
}

export interface MarketOut {
  summary: string;
  rows: MarketRow[];
  singleProvider: string[];
  tally: CallTally;
  provider: string;
  date: string;
  placeholder?: string;
  skipped?: boolean;
}

const asNum = (v: number | string) => (typeof v === "number" ? v : /^\d+\+$/.test(v) ? Number(v.slice(0, -1)) : -1);

function out(rows: MarketRow[], tally: CallTally, now: Date): MarketOut {
  const most = (k: "openRoles" | "news30d") => [...rows].sort((a, b) => asNum(b[k]) - asNum(a[k]))[0];
  const roles = most("openRoles");
  const news = most("news30d");
  const parts = [`${rows.length} companies side by side`];
  if (roles && asNum(roles.openRoles) > 0) parts.push(`most open roles ${roles.name} (${roles.openRoles})`);
  if (news && asNum(news.news30d) > 0) parts.push(`most news in 30 days ${news.name} (${news.news30d})`);
  const single = ["company.traffic", "company.funding", "jobs.search", "news.search"].filter((j) => job(j).singleProvider);
  return { summary: parts.join(", "), rows, singleProvider: single, tally, provider: tally.providers.join(", "), date: now.toISOString().slice(0, 10) };
}

export const market: GtmModule = {
  id: "market",
  label: "Market",
  needs: ["intake"],
  quote: (cfg) => {
    const k = 1 + cfg.competitors.length;
    return {
      lines: [
        { job: "company.traffic", calls: k, note: "one provider, no fallback" },
        { job: "company.funding", calls: k },
        { job: "jobs.search", calls: k },
        { job: "news.search", calls: k },
      ],
    };
  },
  async run(ctx) {
    if (ctx.mode === "demo") return demoResult("market");
    const now = new Date();
    const who = [{ name: ctx.cfg.brand, domain: ctx.cfg.domain, you: true }, ...ctx.cfg.competitors.map((d) => ({ name: nameOf(d), domain: d, you: false }))];
    const tally = newTally();
    const rows: MarketRow[] = [];
    for (const w of who) {
      rows.push(await snapshot(ctx, w, now, tally));
      ctx.partial(out(rows, tally, now));
    }
    const o = out(rows, tally, now);
    return { status: "done", summary: o.summary, out: o };
  },
  render: (o, status) =>
    baseSection({ num: "10", id: "market", title: "Market snapshot", status, out: o, deeper: "github.com/loootai/looot-intent for a weekly score per company", activate: "looot-zeus watch --cap 5 checks again next week" }, (f: MarketOut) => {
      const blocks: Block[] = [
        { kind: "table", columns: [{ key: "who", label: "Company" }, { key: "traffic", label: "Web traffic" }, { key: "funding", label: "Latest funding" }, { key: "openRoles", label: "Open roles", num: true }, { key: "news30d", label: "News, 30 days", num: true }, { key: "sources", label: "Provider and date" }], rows: f.rows.map((r) => ({ ...r, who: r.you ? `${r.name} (you)` : r.name, sources: r.sources ?? "" })) },
      ];
      const single = Array.isArray(f.singleProvider) ? f.singleProvider : ["company.traffic"];
      if (single.length > 0) blocks.push({ kind: "note", text: `One provider, no fallback for ${single.join(", ")}. A miss there means that one provider found nothing.` });
      blocks.push({ kind: "note", text: "No job returns a market size. This compares the players for the geographies in the run." });
      return blocks;
    }),
};

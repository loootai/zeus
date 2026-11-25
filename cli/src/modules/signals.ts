// Module 5, signals. For the best accounts (A and B grades first) it looks up open roles, funding
// rounds and news, builds one dated timeline and scores buying intent 0 to 100 per account.
// Parsing is lifted from loootai/looot-signals (src/lib/parse.ts, MIT) and the score from
// loootai/looot-intent (src/engine/score.ts, MIT): recency half-lives, a saturation point per
// signal kind and a reduced share for events that do not match the ICP. Cut down to three kinds.
//
// This file also exports the small readers the other module-B files share (rows, dates, names,
// funding rounds, news, the call tally), so the four modules parse provider answers the same way.

import type { CallResult } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block, Section } from "../dossier/blocks.js";
import { usd } from "../util.js";
import { loadFixture } from "./fixture.js";
import type { GtmModule, ModuleContext, ModuleResult, ModuleStatus, RenderOptions } from "./types.js";

// ---------- shared readers ----------

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** First non-empty string (numbers become text) among the keys of an object. */
export function pick(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** The rows of a provider answer: the first array of objects, looking in the usual wrapper keys first. */
export function rowsOf(result: unknown, preferred: string[] = ["data", "results", "items", "jobs", "news", "companies", "organic", "output"]): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result)) return [];
  for (const k of preferred) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = rowsOf(v, preferred);
      if (inner.length > 0) return inner;
    }
  }
  for (const v of Object.values(result)) if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v.filter(isObj);
  return [];
}

/** A date or timestamp as an ISO string, or null. Understands "3 days ago" given `now`. */
export function toIso(v: unknown, now: Date): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v !== "string" || v.trim() === "") return null;
  const rel = /^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$/i.exec(v.trim());
  if (rel) {
    const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }[rel[2].toLowerCase()] ?? 0;
    return new Date(now.getTime() - Number(rel[1]) * unit).toISOString();
  }
  if (/^yesterday$/i.test(v.trim())) return new Date(now.getTime() - 86_400_000).toISOString();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y < 1990 || y > 2100 ? null : d.toISOString();
}

export const dayOf = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);

/** "hubspot.com" becomes "Hubspot". */
export function nameOf(domain: string): string {
  const stem = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** True when the text names the company, by name or by domain stem, as whole words. */
export function mentions(text: string | null | undefined, name: string, domain?: string): boolean {
  if (!text) return false;
  const t = words(text);
  const terms = [name, domain ? domain.split(".")[0] : ""].map((x) => words(x).trim()).filter((x) => x.length >= 2);
  return terms.some((term) => t.includes(` ${term} `)) || (domain ? text.toLowerCase().includes(domain.toLowerCase()) : false);
}

export interface Dated {
  date: string | null;
  title: string;
  source: string | null;
}

/** News rows (Serper style: news[] with title, link, date, source). */
export function parseNewsItems(result: unknown, now: Date): (Dated & { outlet: string | null })[] {
  return rowsOf(result, ["news", "results", "data", "items", "organic", "articles"]).flatMap((r) => {
    const title = pick(r, ["title", "headline"]);
    const link = pick(r, ["link", "url"]);
    if (!title) return [];
    return [{ date: dayOf(toIso(r.date ?? r.published_at ?? r.publishedAt ?? r.datePublished, now)), title, source: link, outlet: pick(r, ["source", "publisher"]) }];
  });
}

function amountText(v: unknown): string | null {
  if (isObj(v)) return amountText(v.amount ?? v.value ?? v.usd);
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (Number.isFinite(n) && n > 0) return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Funding rounds, newest first. Reads Aviato style fundingRounds, PredictLeads style JSON:API rows and plain lists. */
export function parseFundingRounds(result: unknown, now: Date): (Dated & { round: string; amount: string | null })[] {
  const rows = rowsOf(result, ["fundingRounds", "funding_rounds", "rounds", "data", "items", "results"]);
  const out = rows.flatMap((r) => {
    const a = isObj(r.attributes) ? r.attributes : r;
    const round = (pick(a, ["roundName", "round_name", "name", "stage", "financing_type_normalized", "financing_type", "series", "type", "fundingType"]) ?? "").replace(/_/g, " ");
    const amount = amountText(a.moneyRaised ?? a.money_raised ?? a.amount_normalized ?? a.amount ?? a.raisedAmount ?? a.amount_usd);
    const date = dayOf(toIso(a.announcedOn ?? a.announced_on ?? a.effective_date ?? a.date ?? a.closedOn ?? a.published_at, now));
    if (!round && !amount) return [];
    const title = `Funding: ${[round || "round", amount].filter(Boolean).join(", ")}`;
    return [{ date, title, source: pick(a, ["url", "source_url", "article_url", "sourceUrl"]), round: round || "round", amount }];
  });
  return out.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
}

/** Job posts. Keeps only rows that name the company when the row carries a company at all. */
export function parseJobPosts(result: unknown, now: Date, name: string, domain?: string): Dated[] {
  return rowsOf(result, ["jobs", "data", "results", "items"]).flatMap((r) => {
    const title = pick(r, ["title", "jobTitle", "job_title", "position", "name"]);
    if (!title) return [];
    const co = isObj(r.company) ? pick(r.company, ["name", "companyName"]) : pick(r, ["companyName", "company_name", "company", "organization"]);
    if (co && !mentions(co, name, domain)) return [];
    const date = dayOf(toIso(r.postedAt ?? r.posted_at ?? r.datePosted ?? r.date_posted ?? r.listedAt ?? r.postedDate ?? r.posted ?? r.date, now));
    return [{ date, title, source: pick(r, ["url", "jobUrl", "job_url", "link", "applyUrl", "final_url"]) }];
  });
}

// ---------- the call tally, shared ----------

export interface CallTally {
  calls: number;
  hit: number;
  fallback: number;
  miss: number;
  fail: number;
  charged: number;
  providers: string[];
}

export const newTally = (): CallTally => ({ calls: 0, hit: 0, fallback: 0, miss: 0, fail: 0, charged: 0, providers: [] });

export function count(t: CallTally, r: CallResult): CallResult {
  t.calls++;
  t[r.record.outcome]++;
  t.charged = Math.round((t.charged + r.record.charged) * 1e6) / 1e6;
  if ((r.record.outcome === "hit" || r.record.outcome === "fallback") && !t.providers.includes(r.record.provider)) t.providers.push(r.record.provider);
  return r;
}

/** True when the call answered with data (first provider or a later one). */
export const answered = (r: CallResult) => r.record.outcome === "hit" || r.record.outcome === "fallback";

/** "fallback (kittai then findymail)", "miss", "fail (provider_timeout)". */
export function outcomeText(r: CallResult): string {
  const o = r.record;
  if (o.outcome === "fallback") return `hit via ${o.provider} after ${o.fallbackFrom}`;
  if (o.outcome === "fail") return `fail${o.note ? ` (${o.note})` : ""}`;
  return o.outcome === "hit" ? `hit via ${o.provider}` : `miss via ${o.provider}`;
}

/** The honest line under every module-B section. Never says a miss or a failure cost nothing. */
export function tallyNote(t: CallTally): string {
  const parts = [`${t.hit} hit`, `${t.fallback} answered by a later provider`, `${t.miss} miss`, `${t.fail} fail`];
  return `${t.calls} lookups. ${parts.join(" · ")}. Charged ${usd(t.charged)} in total. A miss can still be charged when the provider bills a not found. receipt.md shows the charge of every call.`;
}

/** A section with the source line every module-B section uses. */
export function baseSection(o: { num: string; id: string; title: string; status: ModuleStatus; out: any; deeper?: string; activate?: string }, body: (out: any) => Block[]): Section {
  const base = { num: o.num, id: o.id, title: o.title, status: o.status, deeper: o.deeper, activate: o.activate };
  const out = o.out;
  const hasData = out && !out.skipped && (o.status === "done" || o.status === "capped");
  if (!hasData) {
    const why = out?.summary ?? (o.status === "capped" ? "stopped at the cap before this module ran" : "skipped");
    return { ...base, source: "", blocks: [{ kind: "note", text: why }] };
  }
  const source = out.placeholder ? "PLACEHOLDER data, invented to show the layout. A real run replaces it." : `${out.provider || "looot"}, ${out.date ?? ""}`;
  const blocks: Block[] = [{ kind: "text", text: out.summary }, ...body(out)];
  if (o.status === "capped") blocks.push({ kind: "note", text: "Stopped at the cap. This section is partial and shows what came back before the stop." });
  if (out.tally) blocks.push({ kind: "note", text: tallyNote(out.tally) });
  return { ...base, source, blocks };
}

/** Demo mode reads the PLACEHOLDER fixture of the module. No call, no network. */
export function demoResult(id: string): ModuleResult {
  const f = loadFixture(id);
  if (f.skipped) return { status: "skipped", summary: f.summary, out: f };
  return { status: "done", summary: f.summary, out: f };
}

// ---------- signals ----------

export type SignalKind = "hiring" | "funding" | "news";
export type Intent = "hot" | "warm" | "cold";

export interface SignalEvent extends Dated {
  type: SignalKind;
  provider: string;
  /** Matches the ICP: a go-to-market role, or a growth headline. Others count at UNRELEVANT_SHARE. */
  relevant: boolean;
}

export interface AccountSignals {
  account: string;
  domain: string;
  grade: string;
  score: number;
  intent: Intent;
  reasons: string;
  lookups: string;
  events: SignalEvent[];
}

/** Weights, half-lives and saturation from looot-intent's default config, for the three kinds used here. */
export const SIGNAL_RULES: Record<SignalKind, { weight: number; halfLifeDays: number; saturation: number; noun: string }> = {
  hiring: { weight: 22, halfLifeDays: 45, saturation: 6, noun: "open roles" },
  funding: { weight: 15, halfLifeDays: 120, saturation: 1, noun: "funding rounds" },
  news: { weight: 10, halfLifeDays: 30, saturation: 3, noun: "news items" },
};
export const UNRELEVANT_SHARE = 0.4;
/** looot-intent stage lines: hot from "considering" (45) up, warm from "aware" (20) up, cold below. */
export const TIERS = { hot: 45, warm: 20 };
/** Events older than this are left off the timeline. */
export const MAX_AGE_DAYS = 365;

const DAY = 86_400_000;
const GTM_ROLE = /\b(sales|account executive|sdr|bdr|business development|revenue|growth|marketing|demand gen|customer success|partnerships?|head of|vp|chief)\b/i;
const GROWTH_NEWS = /\b(raises?|raised|secures?|funding|series [a-e]|seed|launch(es|ed)?|expands?|expansion|opens?|acquires?|acquired|partners?|partnership|hires?|appoints?|names|new (ceo|cro|cmo|office|market))\b/i;

export function recencyWeight(date: string | null, now: Date, halfLifeDays: number): number {
  if (!date) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(date)) / DAY);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function ago(date: string | null, now: Date): string {
  if (!date) return "undated";
  const d = Math.floor((now.getTime() - Date.parse(date)) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  return d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
}

/** Scores one account. Pure: the same events and date give the same score. */
export function scoreEvents(events: SignalEvent[], now: Date): { score: number; intent: Intent; reasons: string[] } {
  const total = Object.values(SIGNAL_RULES).reduce((n, r) => n + r.weight, 0);
  let raw = 0;
  const reasons: { pts: number; text: string }[] = [];
  for (const kind of Object.keys(SIGNAL_RULES) as SignalKind[]) {
    const rule = SIGNAL_RULES[kind];
    const mine = events.filter((e) => e.type === kind);
    if (mine.length === 0) continue;
    const sum = mine.reduce((n, e) => n + recencyWeight(e.date, now, rule.halfLifeDays) * (e.relevant ? 1 : UNRELEVANT_SHARE), 0);
    const max = (100 * rule.weight) / total;
    const pts = max * Math.min(1, sum / rule.saturation);
    raw += pts;
    const newest = mine.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null;
    const relevant = mine.filter((e) => e.relevant).length;
    reasons.push({ pts, text: `${mine.length} ${rule.noun}${relevant < mine.length ? ` (${relevant} match the ICP)` : ""}, newest ${ago(newest, now)}, +${pts.toFixed(1)} of ${max.toFixed(1)}` });
  }
  const score = Math.round(Math.min(100, raw));
  const intent: Intent = score >= TIERS.hot ? "hot" : score >= TIERS.warm ? "warm" : "cold";
  return { score, intent, reasons: reasons.sort((a, b) => b.pts - a.pts).map((r) => r.text) };
}

interface AccountIn {
  domain: string;
  name: string;
  grade: string;
  score: number;
}

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/** The accounts that get paid lookups: A and B grades by score. When none is A or B, the top scores. */
export function pickAccounts(accounts: unknown, limit: number): AccountIn[] {
  const rows = isObj(accounts) && Array.isArray(accounts.rows) ? accounts.rows.filter(isObj) : [];
  const list: AccountIn[] = rows
    .map((r) => ({ domain: String(r.domain ?? "").trim().toLowerCase(), name: String(r.name ?? r.domain ?? "").trim(), grade: String(r.grade ?? "").toUpperCase(), score: Number(r.score ?? 0) || 0 }))
    .filter((r) => r.domain && r.name);
  list.sort((a, b) => (GRADE_RANK[a.grade] ?? 9) - (GRADE_RANK[b.grade] ?? 9) || b.score - a.score);
  const top = list.filter((r) => r.grade === "A" || r.grade === "B");
  return (top.length > 0 ? top : list).slice(0, limit);
}

/** The three calls for one account, read into events. */
async function lookAt(ctx: ModuleContext, a: AccountIn, now: Date, tally: CallTally, cfg: GtmConfig): Promise<AccountSignals> {
  const events: SignalEvent[] = [];
  const looks: string[] = [];
  const roleWords = new RegExp(`\\b(${cfg.icp.titles.flatMap((t) => t.toLowerCase().split(/\s+/)).filter((w) => w.length > 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "sales"})\\b`, "i");

  const jobs = count(tally, await ctx.call("jobs.search", { query: a.name, company: a.name, limit: 25 }, `jobs:${a.domain}`));
  looks.push(`jobs ${outcomeText(jobs)}`);
  if (answered(jobs)) for (const j of parseJobPosts(jobs.data, now, a.name, a.domain)) events.push({ ...j, title: `Hiring: ${j.title}`, type: "hiring", provider: jobs.record.provider, relevant: GTM_ROLE.test(j.title) || roleWords.test(j.title) });

  const fund = count(tally, await ctx.call("company.funding", { domain: a.domain }, `funding:${a.domain}`));
  looks.push(`funding ${outcomeText(fund)}`);
  if (answered(fund)) for (const f of parseFundingRounds(fund.data, now)) events.push({ date: f.date, title: f.title, source: f.source, type: "funding", provider: fund.record.provider, relevant: true });

  const news = count(tally, await ctx.call("news.search", { query: `"${a.name}"`, limit: 10 }, `news:${a.domain}`));
  looks.push(`news ${outcomeText(news)}`);
  if (answered(news)) for (const n of parseNewsItems(news.data, now)) {
    if (!mentions(n.title, a.name, a.domain)) continue;
    events.push({ date: n.date, title: n.title, source: n.source, type: "news", provider: news.record.provider, relevant: GROWTH_NEWS.test(n.title) });
  }

  const fresh = events.filter((e) => !e.date || now.getTime() - Date.parse(e.date) <= MAX_AGE_DAYS * DAY);
  const s = scoreEvents(fresh, now);
  return { account: a.name, domain: a.domain, grade: a.grade || "-", score: s.score, intent: s.intent, reasons: s.reasons.join("; ") || "no signal found in jobs, funding or news", lookups: looks.join(", "), events: fresh };
}

export interface SignalsOut {
  summary: string;
  rows: Record<string, unknown>[];
  accounts: AccountSignals[];
  tally: CallTally;
  provider: string;
  date: string;
  skipped?: boolean;
  placeholder?: string;
}

/** Timeline rows, newest first, undated last. The shape signals.json and the fixture share. */
export function timeline(accounts: AccountSignals[]): Record<string, unknown>[] {
  return accounts
    .flatMap((a) => a.events.map((e) => ({ account: a.account, domain: a.domain, date: e.date ?? "undated", type: e.type, title: e.title, source: e.source ?? "", intent: a.intent, score: a.score, provider: e.provider, icpMatch: e.relevant })))
    .sort((x, y) => (x.date === "undated" ? 1 : 0) - (y.date === "undated" ? 1 : 0) || String(y.date).localeCompare(String(x.date)));
}

function summarize(accounts: AccountSignals[], rows: unknown[], of: number): string {
  const n = (t: Intent) => accounts.filter((a) => a.intent === t).length;
  if (rows.length === 0) return `No dated signal found on ${accounts.length} of ${of} accounts checked.`;
  return `${rows.length} signals on ${accounts.length} accounts, ${n("hot")} hot, ${n("warm")} warm, ${n("cold")} cold`;
}

function out(accounts: AccountSignals[], tally: CallTally, of: number, now: Date): SignalsOut {
  const rows = timeline(accounts);
  return { summary: summarize(accounts, rows, of), rows, accounts, tally, provider: tally.providers.join(", "), date: now.toISOString().slice(0, 10) };
}

export const signals: GtmModule = {
  id: "signals",
  label: "Signals",
  needs: ["accounts"],
  quote: (cfg) => ({
    lines: [
      { job: "jobs.search", calls: cfg.limits.signalAccounts, note: "A and B accounts" },
      { job: "company.funding", calls: cfg.limits.signalAccounts },
      { job: "news.search", calls: cfg.limits.signalAccounts },
    ],
    ...(cfg.limits.signalAccounts === 0 ? { skip: "limits.signalAccounts is 0" } : {}),
  }),
  async run(ctx) {
    if (ctx.mode === "demo") return demoResult("signals");
    const now = new Date();
    const picked = pickAccounts(ctx.outputs.accounts, ctx.cfg.limits.signalAccounts);
    if (picked.length === 0) {
      const why = "no scored accounts to check, the accounts module returned none";
      return { status: "skipped", summary: why, out: { skipped: true, summary: why } };
    }
    const tally = newTally();
    const done: AccountSignals[] = [];
    for (const a of picked) {
      done.push(await lookAt(ctx, a, now, tally, ctx.cfg));
      ctx.partial(out(done, tally, picked.length, now));
    }
    const o = out(done, tally, picked.length, now);
    return { status: "done", summary: o.summary, out: o };
  },
  render: (o, status, opts: RenderOptions) =>
    baseSection({ num: "04", id: "signals", title: "Signals and intent", status, out: o, deeper: "github.com/loootai/looot-signals, npm run signals -- --triggers market.yaml --cap 1", activate: "Call the hot accounts this week. looot-zeus watch --cap 5 checks again next week." }, (f: SignalsOut) => {
      void opts;
      const blocks: Block[] = [];
      if (Array.isArray(f.accounts) && f.accounts.length > 0) {
        blocks.push({ kind: "stat", items: (["hot", "warm", "cold"] as Intent[]).map((t) => ({ label: t, value: String(f.accounts.filter((a) => a.intent === t).length) })) });
        blocks.push({ kind: "table", caption: "Intent by account", columns: [{ key: "account", label: "Account" }, { key: "grade", label: "Grade" }, { key: "score", label: "Intent score", num: true }, { key: "intent", label: "Tier" }, { key: "reasons", label: "Why" }, { key: "lookups", label: "Lookups" }], rows: [...f.accounts].sort((a, b) => b.score - a.score) as unknown as Record<string, unknown>[] });
      }
      blocks.push({ kind: "table", caption: "Timeline, newest first", columns: [{ key: "date", label: "Date" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "title", label: "Signal" }, { key: "intent", label: "Tier" }, { key: "score", label: "Score", num: true }, { key: "provider", label: "Provider" }, { key: "source", label: "Source" }], rows: f.rows.slice(0, 60) });
      if (f.rows.length > 60) blocks.push({ kind: "note", text: `${f.rows.length - 60} older signals are in signals.json.` });
      blocks.push({ kind: "note", text: `Score 0 to 100 from hiring, funding and news, weighted by how recent each one is. Hot is ${TIERS.hot} and up, warm ${TIERS.warm} and up.` });
      return blocks;
    }),
};

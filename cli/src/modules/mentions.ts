// Module 10, mentions. Reddit, X and news over the last 7 days for your brand and each competitor.
// A 7-day digest plus the posts with buying intent (asking for a tool, comparing tools, or unhappy
// with a competitor). Parsers and intent rules lifted from loootai/looot-mentions (MIT).
//
// Jobs: reddit.post.search (2 providers), x.post.search (3 providers), news.search (8 providers).

import type { CallRecord } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { answered, dayOf, emptyTally, fixture, frame, list, nameOfDomain, names, obj, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail } from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const MENTION_JOBS = { reddit: "reddit.post.search", x: "x.post.search", news: "news.search" } as const;
export const WINDOW_DAYS = 7;
type Platform = "Reddit" | "X" | "News";

export interface RawPost { title: string; url: string | null; date: string | null; where: string | null }

export function mentionTerms(cfg: GtmConfig): { term: string; about: string; you: boolean }[] {
  return [{ term: cfg.brand || nameOfDomain(cfg.domain), about: "you", you: true }, ...cfg.competitors.map((d) => ({ term: nameOfDomain(d), about: nameOfDomain(d), you: false }))];
}

export function mentionsQuote(cfg: GtmConfig): ModuleQuote {
  const n = mentionTerms(cfg).length;
  return {
    lines: [
      { job: MENTION_JOBS.reddit, calls: n, note: "you and each competitor, past week" },
      { job: MENTION_JOBS.x, calls: n },
      { job: MENTION_JOBS.news, calls: n },
    ],
  };
}

const clip = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

// ---------- parsers (from looot-mentions engine/sources.ts) ----------

export function parseReddit(raw: unknown, now: Date): RawPost[] {
  return list(raw, ["posts", "children", "results", "items"]).flatMap((entry) => {
    const r = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? obj(entry.data) : entry;
    const title = str(r.title);
    if (!title) return [];
    const permalink = str(r.permalink);
    const url = permalink ? (permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`) : str(r.url);
    const sub = str(r.subreddit, r.subreddit_name_prefixed);
    const body = str(r.selftext, r.body) ?? "";
    return [{ title: clip(body ? `${title}. ${body}` : title, 400), url, date: dayOf(r.created_utc ?? r.created ?? r.created_at, now), where: sub ? (sub.startsWith("r/") ? sub : `r/${sub}`) : null }];
  });
}

export function parseX(raw: unknown, now: Date): RawPost[] {
  return list(raw, ["tweets", "results", "items", "posts", "timeline"]).flatMap((r) => {
    const text = str(r.text, r.full_text, r.content);
    if (!text) return [];
    const user = obj(r.author ?? r.user);
    const handle = str(user.userName, user.username, user.screen_name, r.username);
    const id = str(r.id, r.id_str, r.tweet_id);
    const url = str(r.url, r.twitterUrl) ?? (handle && id ? `https://x.com/${handle}/status/${id}` : null);
    return [{ title: clip(text, 400), url, date: dayOf(r.createdAt ?? r.created_at, now), where: handle ? `@${handle}` : null }];
  });
}

export function parseNews(raw: unknown, now: Date): RawPost[] {
  return list(raw, ["news", "articles", "results", "items"]).flatMap((r) => {
    const title = str(r.title);
    if (!title) return [];
    return [{ title: clip(`${title}${str(r.snippet, r.description) ? `. ${str(r.snippet, r.description)}` : ""}`, 400), url: str(r.link, r.url), date: dayOf(r.date ?? r.published_at ?? r.publishedAt, now), where: str(r.source, obj(r.source).name) }];
  });
}

// ---------- intent (rules from looot-mentions config/rules.json) ----------

const INTENTS: Record<string, RegExp[]> = {
  "asks for a tool": [/\b(can|does|did) anyone (recommend|suggest)/i, /\blooking for\b/i, /\bany (good )?(tools?|apps?|alternatives?|suggestions?|recommendations?)\b/i, /\bwhat('?s| is| are) the best\b/i, /\bwhich .{0,40}(should|to) (i|we) (use|pick|choose|buy)\b/i],
  compares: [/\bvs\.?\b/i, /\bversus\b/i, /\bcompared (to|with)\b/i, /\balternatives? to\b/i, /\bbetter than\b/i, /\bswitch(ed|ing)? (from|to|off)\b/i, /\bmoving (off|away from)\b/i, /\binstead of\b/i],
  complains: [/doesn'?t work/i, /not working/i, /stopped working/i, /\bbroken\b/i, /\bterrible\b/i, /\bworst\b/i, /disappointed/i, /frustrat\w*/i, /rip[- ]?off/i, /\brefund\b/i, /price (increase|hike|change|jump)/i, /\bcancel(l)?ed (my|our)\b/i, /\bfed up\b/i, /\bunacceptable\b/i],
};

/** The intent labels a post matches, in a fixed order. */
export function intentsOf(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  return Object.entries(INTENTS).filter(([, res]) => res.some((re) => re.test(flat))).map(([k]) => k);
}

/** Buying intent: someone asks for a tool, compares tools, or complains about a competitor. */
export function hasBuyingIntent(intents: string[], aboutYou: boolean): boolean {
  return intents.includes("asks for a tool") || intents.includes("compares") || (!aboutYou && intents.includes("complains"));
}

// ---------- run ----------

export type MentionRow = { date: string; platform: Platform; about: string; title: string; intent: boolean; kind: string; where: string; url: string; provider: string };
export type DigestRow = { about: string; reddit: number; x: number; news: number; intent: number };
export type SearchRow = { about: string; platform: Platform; found: number; kept: number; status: string; provider: string };

export interface MentionsOut {
  placeholder?: string;
  summary: string;
  provider: string;
  date: string;
  rows: MentionRow[];
  digest?: DigestRow[];
  searches?: SearchRow[];
  calls?: string;
}

/** Keeps posts that name the term, are inside the window (undated posts stay, marked). Drops repeats by URL or title. */
export function keep(posts: RawPost[], term: string, now: Date, seen: Set<string>): RawPost[] {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return posts.filter((p) => {
    if (!names(p.title, term)) return false;
    if (p.date && p.date < cutoff) return false;
    const key = (p.url ?? p.title).toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function run(ctx: ModuleContext) {
  const now = new Date();
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const rows: MentionRow[] = [];
  const searches: SearchRow[] = [];
  const seen = new Set<string>();
  const terms = mentionTerms(ctx.cfg);

  const build = (): MentionsOut => {
    const sorted = [...rows].sort((a, b) => Number(b.intent) - Number(a.intent) || b.date.localeCompare(a.date));
    const digest: DigestRow[] = terms.map((tm) => {
      const mine = rows.filter((r) => r.about === tm.about);
      return { about: tm.about, reddit: mine.filter((r) => r.platform === "Reddit").length, x: mine.filter((r) => r.platform === "X").length, news: mine.filter((r) => r.platform === "News").length, intent: mine.filter((r) => r.intent).length };
    });
    const intent = rows.filter((r) => r.intent).length;
    return { summary: `${rows.length} mentions in ${WINDOW_DAYS} days, ${intent} buying-intent posts`, provider: providersOf(calls), date: today(), rows: sorted, digest, searches: [...searches], calls: tallyLine(t) };
  };

  const plan: { tm: (typeof terms)[number]; platform: Platform; job: string; input: Record<string, unknown>; parse: (raw: unknown, now: Date) => RawPost[] }[] = [];
  for (const tm of terms) {
    plan.push({ tm, platform: "Reddit", job: MENTION_JOBS.reddit, input: { query: tm.term, sort: "new", timeframe: "week" }, parse: parseReddit });
    plan.push({ tm, platform: "X", job: MENTION_JOBS.x, input: { query: tm.term, limit: 20 }, parse: parseX });
    plan.push({ tm, platform: "News", job: MENTION_JOBS.news, input: { query: tm.term, limit: 20 }, parse: parseNews });
  }

  try {
    await pool(plan, 4, async (p) => {
      const r = await tracked(ctx, t, calls, p.job, p.input, `${p.platform.toLowerCase()}:${p.tm.term}`);
      const found = answered(r) ? p.parse(r.data, now) : [];
      const kept = keep(found, p.tm.term, now, seen);
      for (const k of kept) {
        const intents = intentsOf(k.title);
        rows.push({ date: k.date ?? "undated", platform: p.platform, about: p.tm.about, title: clip(k.title), intent: hasBuyingIntent(intents, p.tm.you), kind: intents.join(", ") || "-", where: k.where ?? "-", url: k.url ?? "-", provider: trail(r.record) });
      }
      searches.push({ about: p.tm.about, platform: p.platform, found: found.length, kept: kept.length, status: answered(r) ? "answered" : outcomeText(r.record), provider: trail(r.record) });
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`mentions: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: MentionsOut): Block[] {
  const b: Block[] = [];
  if (o.digest?.length) b.push({ kind: "table", caption: `${WINDOW_DAYS}-day digest`, columns: [{ key: "about", label: "About" }, { key: "reddit", label: "Reddit", num: true }, { key: "x", label: "X", num: true }, { key: "news", label: "News", num: true }, { key: "intent", label: "Buying intent", num: true }], rows: o.digest });
  const intent = o.rows.filter((r) => r.intent);
  b.push({ kind: "table", caption: `Buying-intent posts (${intent.length})`, columns: [{ key: "date", label: "Date" }, { key: "platform", label: "Where" }, { key: "about", label: "About" }, { key: "title", label: "Post" }, { key: "kind", label: "Why" }, { key: "url", label: "Link" }], rows: intent.map((r) => ({ ...r, about: r.about ?? "-", kind: r.kind ?? "asks or compares" })) });
  b.push({ kind: "table", caption: "All mentions", columns: [{ key: "date", label: "Date" }, { key: "platform", label: "Where" }, { key: "title", label: "Post" }, { key: "intent", label: "Buying intent" }, { key: "url", label: "Link" }], rows: o.rows.map((r) => ({ ...r, intent: r.intent ? "yes" : "" })) });
  if (o.searches?.some((s) => s.status !== "answered")) b.push({ kind: "table", caption: "Searches that did not answer", columns: [{ key: "about", label: "About" }, { key: "platform", label: "Where" }, { key: "status", label: "Answer" }, { key: "provider", label: "Provider" }], rows: o.searches.filter((s) => s.status !== "answered") });
  b.push({ kind: "note", text: "Buying intent is a keyword rule (asks for a tool, compares tools, or complains about a competitor). Read the post before you reply." });
  return b;
}

export const mentions: GtmModule = {
  id: "mentions",
  label: "Mentions",
  needs: ["intake"],
  quote: mentionsQuote,
  async run(ctx) {
    if (ctx.mode === "demo") {
      const f = fixture("mentions");
      return { status: "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "09", id: "mentions", title: `Mentions, last ${WINDOW_DAYS} days`, deeper: "github.com/loootai/looot-mentions, npm run mentions -- --config mentions.yaml", activate: "Reply to the buying-intent posts today" }, out, status, (o) => blocks(o as MentionsOut)),
};


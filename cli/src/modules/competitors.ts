// Module 6, competitors. One rival card per competitor in the config: positioning and pricing read
// from their own pages, tech stack, recent news and LinkedIn company posts. Every claim carries the
// page it came from, the provider that read it and a date (the publish date when the source has
// one, else the day it was read). Extractors lifted from loootai/looot-battlecards
// (src/engine/extract.ts, MIT) and cut down. Weak spots are plain rules over those claims.

import type { CallResult } from "../client.js";
import type { Block } from "../dossier/blocks.js";
import { answered, baseSection, count, demoResult, isObj, nameOf, newTally, outcomeText, parseNewsItems, pick, rowsOf, toIso, dayOf, type CallTally, type Obj } from "./signals.js";
import type { GtmModule, ModuleContext } from "./types.js";

export interface Claim {
  topic: "positioning" | "pricing" | "stack" | "news" | "posts" | "weak spot";
  text: string;
  /** Page, article or post the claim comes from. */
  source: string;
  provider: string;
  /** ISO day. */
  date: string;
  /** published: the source's own date. read: the day /gtm read it. */
  dateKind: "published" | "read";
}

export interface Card {
  domain: string;
  name: string;
  positioning: string;
  pricing: { plan: string; price: string }[];
  stack: string[];
  news: { date: string; title: string; source: string }[];
  posts: { date: string; text: string; source: string }[];
  weakSpots: string[];
  claims: Claim[];
  lookups: string;
  provider: string;
  date: string;
  /** Why this company is a rival, from the rival check or the agent. */
  reason?: string;
}

const clip = (t: string, n = 160) => (t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t);
const plain = (t: string) => t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`>#]+/g, "").replace(/\s+/g, " ").trim();

/** Page text from a reader answer: { data: { content, title } }, { markdown }, { content }, or a string. */
export function parsePage(raw: unknown): { content: string; title: string | null } {
  if (typeof raw === "string") return { content: raw, title: /^Title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null };
  const o = isObj(raw) ? raw : {};
  const d = isObj(o.data) ? o.data : {};
  const meta = isObj(o.metadata) ? o.metadata : {};
  const content = pick(d, ["content", "markdown", "text"]) ?? pick(o, ["markdown", "content", "text"]) ?? "";
  const title = pick(d, ["title"]) ?? pick(meta, ["title"]) ?? pick(o, ["title"]) ?? /^Title:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? null;
  return { content, title };
}

const PRICE_RE = /(?:US\$|\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:\/|per)\s?(?:user|seat|member|month|mo|year|yr|editor|agent)(?:\s?(?:\/|per)\s?(?:month|mo|year|yr))?)?/i;

/** Plan names and prices from a pricing page, at most 8. */
export function extractPlans(markdown: string): { plan: string; price: string }[] {
  const out: { plan: string; price: string }[] = [];
  const seen = new Set<string>();
  let heading = "";
  for (const line of markdown.split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.+)$/.exec(line);
    if (h) heading = plain(h[1]);
    const m = PRICE_RE.exec(line);
    if (!m) continue;
    const price = m[0].replace(/\s+/g, " ").trim();
    const before = plain(line.slice(0, m.index)).replace(/[:|\-]+$/, "").trim();
    const plan = before.length > 1 && before.length <= 40 ? before : heading;
    const key = `${plan}|${price}`.toLowerCase();
    if (!plan || seen.has(key) || /^\d/.test(plan)) continue;
    seen.add(key);
    out.push({ plan, price });
    if (out.length >= 8) break;
  }
  return out;
}

/** Title, first headline and the first full sentence under it. */
export function extractPositioning(markdown: string, title: string | null): string[] {
  const out: string[] = [];
  if (title) out.push(`Page title "${clip(plain(title), 120)}"`);
  const lines = markdown.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1 >= 0) {
    out.push(`Headline "${clip(plain(lines[h1].replace(/^#\s+/, "")), 140)}"`);
    for (const l of lines.slice(h1 + 1, h1 + 15)) {
      const t = plain(l);
      if (t.split(" ").length >= 8 && !/^\s*[-*]\s*\[/.test(l)) {
        out.push(`Subhead "${clip(t, 200)}"`);
        break;
      }
    }
  }
  return out;
}

/** Technology names, from Tomba style lists or BuiltWith style groups. At most 12. */
export function extractStack(raw: unknown): string[] {
  const rows = rowsOf(raw, ["technologies", "tech", "groups", "data", "results"]);
  const names: string[] = [];
  for (const t of rows) {
    const n = pick(t, ["name", "technology", "Name", "tech"]);
    if (n && !names.includes(n)) names.push(n);
  }
  return names.slice(0, 12);
}

/** LinkedIn company posts: { posts: [{ url, text, datePublished }] }. Five newest. */
export function extractPosts(raw: unknown, now: Date): { date: string | null; text: string; source: string | null }[] {
  return rowsOf(raw, ["posts", "data", "items", "results"])
    .flatMap((p: Obj) => {
      const text = pick(p, ["text", "commentary", "content", "title"]);
      if (!text) return [];
      return [{ date: dayOf(toIso(p.datePublished ?? p.date ?? p.postedAt ?? p.posted_at ?? p.time, now)), text: clip(plain(text), 160), source: pick(p, ["url", "link", "postUrl"]) }];
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);
}

function priceNumber(p: string): number | null {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(p);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  if (!(n > 0)) return null;
  return /year|yr/i.test(p) && !/month|mo\b/i.test(p) ? n / 12 : n;
}

/** Weak spots from the claims already read. Plain rules, each one points at its source claim. */
export function weakSpots(plans: { plan: string; price: string }[], pricingText: string, posts: { date: string | null }[], postsAnswered: boolean, now: Date): string[] {
  const out: string[] = [];
  const priced = plans.map((p) => ({ ...p, n: priceNumber(p.price) })).filter((p): p is { plan: string; price: string; n: number } => p.n !== null);
  if (priced.length >= 2) {
    const lo = priced.reduce((a, b) => (b.n < a.n ? b : a));
    const hi = priced.reduce((a, b) => (b.n > a.n ? b : a));
    const x = hi.n / lo.n;
    if (x >= 3) out.push(`Price jumps ${x.toFixed(1)}x from ${lo.plan} (${lo.price}) to ${hi.plan} (${hi.price})`);
  }
  if (pricingText && /\b(contact (sales|us)|talk to sales|custom pricing|book a demo)\b/i.test(pricingText) && /enterprise/i.test(pricingText)) out.push("Top tier price is only given by sales");
  if (pricingText && !/\b(free (plan|forever|tier|trial)|forever free|start for free|try (it )?free)\b/i.test(pricingText)) out.push("No free plan or free trial named on the pricing page");
  if (postsAnswered && !posts.some((p) => p.date && now.getTime() - Date.parse(p.date) <= 30 * 86_400_000)) out.push("No LinkedIn company post in the last 30 days");
  return out;
}

async function card(ctx: ModuleContext, domain: string, now: Date, tally: CallTally): Promise<Card> {
  const name = ctx.cfg.profiles?.[domain]?.name || nameOf(domain);
  const today = now.toISOString().slice(0, 10);
  const claims: Claim[] = [];
  const looks: string[] = [];
  const readDay = (r: CallResult) => r.record.ts.slice(0, 10) || today;
  const add = (topic: Claim["topic"], text: string, source: string, r: CallResult, published?: string | null) =>
    claims.push({ topic, text, source, provider: r.record.provider, date: published ?? readDay(r), dateKind: published ? "published" : "read" });

  const homeUrl = `https://${domain}`;
  const home = count(tally, await ctx.call("web.scrape.markdown", { url: homeUrl }, `home:${domain}`));
  looks.push(`home ${outcomeText(home)}`);
  const homePage = answered(home) ? parsePage(home.data) : { content: "", title: null };
  const positioning = extractPositioning(homePage.content, homePage.title);
  for (const p of positioning) add("positioning", p, homeUrl, home);

  const pricingUrl = `https://${domain}/pricing`;
  const pricing = count(tally, await ctx.call("web.scrape.markdown", { url: pricingUrl }, `pricing:${domain}`));
  looks.push(`pricing ${outcomeText(pricing)}`);
  let pricingText = answered(pricing) ? parsePage(pricing.data).content : "";
  let plans = extractPlans(pricingText);
  let plansFrom = { url: pricingUrl, r: pricing };
  if (plans.length === 0 && homePage.content) {
    // No pricing page answer, or no price on it: read prices from the home page instead.
    const fromHome = extractPlans(homePage.content);
    if (fromHome.length > 0) {
      plans = fromHome;
      plansFrom = { url: homeUrl, r: home };
      if (!pricingText) pricingText = homePage.content;
    }
  }
  for (const p of plans) add("pricing", `${p.plan} ${p.price}`, plansFrom.url, plansFrom.r);

  const tech = count(tally, await ctx.call("company.technographics", { domain }, `tech:${domain}`));
  looks.push(`stack ${outcomeText(tech)}`);
  const stack = answered(tech) ? extractStack(tech.data) : [];
  if (stack.length > 0) add("stack", `Runs ${stack.slice(0, 8).join(", ")}`, `https://${domain}`, tech);

  const newsR = count(tally, await ctx.call("news.search", { query: `"${name}"`, limit: 10 }, `news:${domain}`));
  looks.push(`news ${outcomeText(newsR)}`);
  const news = (answered(newsR) ? parseNewsItems(newsR.data, now) : []).filter((n) => n.source).slice(0, 5);
  for (const n of news) add("news", `${n.title}${n.outlet ? ` (${n.outlet})` : ""}`, n.source!, newsR, n.date);

  // The company's own LinkedIn page from its site or company.enrich, a guess from the domain only when neither had one.
  const liUrl = ctx.cfg.profiles?.[domain]?.linkedin || `https://www.linkedin.com/company/${domain.split(".")[0]}`;
  const liOff = ctx.cfg.linkedin === false;
  const postsR = liOff ? null : count(tally, await ctx.call("linkedin.company.posts", { url: liUrl }, `posts:${domain}`));
  looks.push(postsR ? `posts ${outcomeText(postsR)}` : "posts skipped, LinkedIn steps off");
  const posts = postsR && answered(postsR) ? extractPosts(postsR.data, now) : [];
  for (const p of posts) add("posts", p.text, p.source ?? liUrl, postsR!, p.date);

  const weak = weakSpots(plans, pricingText, posts, postsR ? answered(postsR) : false, now);
  for (const w of weak) {
    const fromPosts = /LinkedIn/.test(w);
    add("weak spot", w, fromPosts ? liUrl : plansFrom.url, fromPosts && postsR ? postsR : plansFrom.r);
  }

  const providers = [...new Set(claims.map((c) => c.provider))];
  return {
    domain,
    name,
    positioning: positioning.find((p) => p.startsWith("Headline"))?.replace(/^Headline /, "") ?? positioning[0] ?? "not read",
    pricing: plans,
    stack,
    news: news.map((n) => ({ date: n.date ?? "undated", title: n.title, source: n.source! })),
    posts: posts.map((p) => ({ date: p.date ?? "undated", text: p.text, source: p.source ?? liUrl })),
    weakSpots: weak,
    claims,
    lookups: looks.join(", "),
    provider: providers.join(", "),
    date: today,
    reason: ctx.cfg.rivalReasons?.[domain] ?? "",
  };
}

export interface CompetitorsOut {
  summary: string;
  cards: Card[];
  tally: CallTally;
  provider: string;
  date: string;
  placeholder?: string;
  skipped?: boolean;
}

function out(cards: Card[], tally: CallTally, of: number, now: Date): CompetitorsOut {
  const claims = cards.reduce((n, c) => n + c.claims.length, 0);
  return { summary: `${cards.length} of ${of} rival cards, ${claims} claims, each with its source and date`, cards, tally, provider: tally.providers.join(", "), date: now.toISOString().slice(0, 10) };
}

export const competitors: GtmModule = {
  id: "competitors",
  label: "Competitors",
  needs: ["intake"],
  quote: (cfg) => {
    const n = cfg.competitors.length;
    if (n === 0) return { lines: [], skip: "no competitors in the config, add some to gtm/config.yaml" };
    return {
      lines: [
        { job: "web.scrape.markdown", calls: 2 * n, note: "home and pricing" },
        { job: "company.technographics", calls: n },
        { job: "news.search", calls: n },
        ...(cfg.linkedin === false ? [] : [{ job: "linkedin.company.posts", calls: n }]),
      ],
    };
  },
  async run(ctx) {
    if (ctx.mode === "demo") return demoResult("competitors");
    const now = new Date();
    const list = ctx.cfg.competitors;
    if (list.length === 0) {
      const why = "no competitors in the config, add some to gtm/config.yaml";
      return { status: "skipped", summary: why, out: { skipped: true, summary: why } };
    }
    const tally = newTally();
    const cards: Card[] = [];
    for (const d of list) {
      cards.push(await card(ctx, d, now, tally));
      ctx.partial(out(cards, tally, list.length, now));
    }
    const o = out(cards, tally, list.length, now);
    return { status: "done", summary: o.summary, out: o };
  },
  render: (o, status) =>
    baseSection({ num: "05", id: "competitors", title: "Rival cards", status, out: o, deeper: "github.com/loootai/looot-battlecards, npm run cards -- --config battlecards.yaml --max-spend 0.25", activate: "Share gtm/competitors.json with sales" }, (f: CompetitorsOut) =>
      [{ kind: "cards", caption: "Your rivals and why each one is in the list", items: f.cards.map((c) => ({ title: c.name, logo: c.domain, text: c.reason ? c.reason.charAt(0).toUpperCase() + c.reason.slice(1) : "Named in the brief.", chips: c.pricing.slice(0, 3).map((p) => `${p.plan} ${p.price}`) })) } as Block, ...f.cards.flatMap((c): Block[] => {
        const blocks: Block[] = [
          { kind: "kv", items: [
            { label: "Competitor", value: `${c.name} (${c.domain})` },
            { label: "Positioning", value: c.positioning },
            { label: "Pricing", value: c.pricing.map((p) => `${p.plan} ${p.price}`).join(", ") || "no price found" },
            { label: "Stack", value: c.stack.join(", ") || "not found" },
            { label: "Weak spots", value: c.weakSpots.join(", ") || "none found by the rules" },
            ...(c.lookups ? [{ label: "Lookups", value: c.lookups }] : []),
          ] },
        ];
        const claims: Claim[] = Array.isArray(c.claims) ? c.claims : [];
        if (claims.length > 0) blocks.push({ kind: "table", caption: `${c.name}, every claim with its source`, columns: [{ key: "topic", label: "Topic" }, { key: "text", label: "Claim" }, { key: "source", label: "Source" }, { key: "provider", label: "Provider" }, { key: "when", label: "Date" }], rows: claims.map((x) => ({ ...x, when: x.dateKind === "read" ? `read ${x.date}` : x.date })) });
        return blocks;
      })],
    ),
  files: (o): Record<string, string> => (o && Array.isArray((o as CompetitorsOut).cards) ? { "competitors.json": JSON.stringify((o as CompetitorsOut).cards, null, 2) + "\n" } : {}),
};

// Social listening on rivals. What you and each rival post on LinkedIn and X, with links, dates,
// engagement when the provider returns it, and the topics read from the text with keyword rules
// (no model). Jobs: linkedin.company.posts (the company page, guessed from the domain) and
// x.post.search (posts from the handle guessed from the domain). A rival that uses another page
// name or handle shows no posts, and the section says so.

import type { Block, Card } from "../dossier/blocks.js";
import type { GtmConfig } from "../config.js";
import { dayOf, list, obj, str } from "./modc-helpers.js";
import { answered, baseSection, count, demoResult, newTally, outcomeText, type CallTally } from "./signals.js";
import type { GtmModule, ModuleContext } from "./types.js";
import type { MoreHints } from "./committee.js";

export const SOCIAL_JOBS = { linkedin: "linkedin.company.posts", x: "x.post.search" } as const;

/** Topic rules over the post text. A post can carry several. */
export const TOPICS: Record<string, RegExp> = {
  "Product news": /\b(launch|launched|introducing|new feature|release|released|now live|update|announc\w+)\b/i,
  "AI": /\b(ai|agent\w*|copilot|gpt|llm|automat\w+|machine learning)\b/i,
  "Customer story": /\b(customer|case study|story|how .{0,30} (uses|used)|results|testimonial)\b/i,
  "Event or webinar": /\b(webinar|event|summit|conference|meetup|join us|live session|register)\b/i,
  "Hiring and team": /\b(hiring|we're hiring|join the team|open role|careers|welcome .{0,30} to the team)\b/i,
  "Offer or pricing": /\b(free trial|discount|% off|pricing|price|offer|deal|promo)\b/i,
  "Opinion and how to": /\b(how to|tips|guide|lessons|why|mistakes|playbook|framework)\b/i,
};

export const topicsOf = (text: string): string[] => Object.entries(TOPICS).filter(([, re]) => re.test(text)).map(([t]) => t);

export interface SocialPost {
  network: "LinkedIn" | "X";
  date: string | null;
  text: string;
  url: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  topics: string[];
  provider: string;
}

export interface SocialBrand {
  name: string;
  domain: string;
  you: boolean;
  linkedinUrl: string;
  handle: string;
  posts: SocialPost[];
  lookups: string;
}

export interface SocialOut {
  placeholder?: string;
  summary: string;
  brands: SocialBrand[];
  tally?: CallTally;
  provider?: string;
  date?: string;
  skipped?: boolean;
}

const stem = (d: string) => d.replace(/^www\./, "").split(".")[0];
const nameOf = (d: string) => stem(d).charAt(0).toUpperCase() + stem(d).slice(1);
const clip = (t: string, n = 280) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);
const numOf = (...vs: unknown[]): number | null => {
  for (const v of vs) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export function parseLinkedinPosts(raw: unknown, now: Date, provider: string): SocialPost[] {
  return list(raw, ["posts", "data", "items", "results", "elements"]).flatMap((r) => {
    const text = str(r.text, r.commentary, r.content, r.title, obj(r.commentary).text);
    if (!text) return [];
    const stats = obj(r.stats ?? r.socialActivity ?? r.engagement);
    const t = text.replace(/\s+/g, " ").trim();
    return [{ network: "LinkedIn" as const, date: dayOf(r.datePublished ?? r.date ?? r.postedAt ?? r.posted_at ?? r.time ?? r.postedDate, now), text: clip(t), url: str(r.url, r.link, r.postUrl, r.post_url), likes: numOf(r.likes, r.numLikes, r.reactions, stats.likes, stats.numLikes, stats.total_reactions), comments: numOf(r.comments, r.numComments, stats.comments, stats.numComments), shares: numOf(r.shares, r.reposts, r.numShares, stats.shares, stats.reposts), topics: topicsOf(t), provider }];
  });
}

/**
 * X posts from the shapes the providers return: AnyAPI (output.data.items[] with authorUsername and
 * createdUtc), TikHub (data.timeline[] with user_info.screen_name and tweet_id) and the usual tweets[].
 * With a handle, posts by anyone else (a search can return mentions) are left out.
 */
export function parseXPosts(raw: unknown, now: Date, provider: string, handle?: string): SocialPost[] {
  return list(raw, ["tweets", "items", "timeline", "posts", "results", "data"]).flatMap((r) => {
    const text = str(r.text, r.full_text, r.content);
    if (!text) return [];
    const user = obj(r.author ?? r.user ?? r.user_info);
    const author = str(r.authorUsername, user.userName, user.username, user.screen_name, r.screen_name, r.username);
    if (handle && author && author.toLowerCase() !== handle.toLowerCase()) return [];
    const id = str(r.tweet_id, r.id_str, r.id);
    const t = text.replace(/\s+/g, " ").trim();
    const url = str(r.url, r.twitterUrl);
    return [{ network: "X" as const, date: dayOf(r.createdUtc ?? r.createdAt ?? r.created_at, now), text: clip(t), url: author && id ? `https://x.com/${author}/status/${id}` : url, likes: numOf(r.likeCount, r.favorite_count, r.favorites, r.likes), comments: numOf(r.replyCount, r.reply_count, r.replies), shares: numOf(r.retweetCount, r.retweet_count, r.retweets, r.reposts), topics: topicsOf(t), provider }];
  });
}

const FRESH_DAYS = 180;
export const isFresh = (day: string, now: Date) => now.getTime() - Date.parse(day) <= FRESH_DAYS * 86_400_000;

const squashName = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * LinkedIn company slugs or X handles in a web search answer that carry the brand name or the domain
 * stem, best match first. "TaplioHQ" passes for Taplio, "aakashgupta" does not.
 */
export function linksIn(raw: unknown, kind: "linkedin" | "x", name: string, domain: string): string[] {
  const text = JSON.stringify(raw ?? "");
  const re = kind === "linkedin" ? /linkedin\.com\/company\/([A-Za-z0-9_%.-]+)/gi : /(?:twitter|x)\.com\/@?([A-Za-z0-9_]{2,15})(?![A-Za-z0-9_])/gi;
  const bad = /^(i|intent|share|home|search|hashtag|login|signup|explore|privacy|tos|settings|messages|notifications|status|linkedin)$/i;
  const keys = [squashName(name), squashName(stem(domain))].filter((k) => k.length >= 3);
  const out = new Map<string, number>();
  for (const m of text.matchAll(re)) {
    const slug = m[1].replace(/[.\/]+$/, "");
    if (!slug || bad.test(slug)) continue;
    const q = squashName(slug);
    const score = keys.some((k) => q === k) ? 3 : keys.some((k) => q.includes(k)) ? 2 : 0;
    if (score > 0) out.set(slug, Math.max(out.get(slug) ?? 0, score));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

async function searchLinks(ctx: ModuleContext, tally: CallTally, query: string, step: string, kind: "linkedin" | "x", name: string, domain: string): Promise<string[]> {
  const r = count(tally, await ctx.call("google.serp.organic", { query }, step));
  return answered(r) ? linksIn(r.data, kind, name, domain) : [];
}

export function socialWho(cfg: GtmConfig): { name: string; domain: string; you: boolean }[] {
  return [{ name: cfg.brand || nameOf(cfg.domain), domain: cfg.domain, you: true }, ...cfg.competitors.map((d) => ({ name: nameOf(d), domain: d, you: false }))];
}

export function summarize(brands: SocialBrand[]): string {
  const posts = brands.reduce((n, b) => n + b.posts.length, 0);
  const rivals = brands.filter((b) => !b.you && b.posts.length > 0).length;
  return `${posts} recent posts from you and ${rivals} of ${brands.filter((b) => !b.you).length} rivals on LinkedIn and X`;
}

const engagement = (p: SocialPost) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);

export function socialBlocks(f: SocialOut): Block[] {
  const brands = f.brands;
  const label = (b: SocialBrand) => (b.you ? `${b.name} (you)` : b.name);
  const blocks: Block[] = [
    { kind: "bars", caption: "Posts by brand and network", items: brands.map((b) => {
      const li = b.posts.filter((p) => p.network === "LinkedIn").length;
      const x = b.posts.filter((p) => p.network === "X").length;
      return { label: label(b), value: li + x, display: String(li + x), tone: b.you ? "go" : "plain", parts: [{ label: "LinkedIn", value: li, tone: "go" }, { label: "X", value: x, tone: "warm" }] };
    }) },
  ];
  const topicCount = new Map<string, { you: number; rivals: number }>();
  for (const b of brands) for (const p of b.posts) for (const t of p.topics) {
    const c = topicCount.get(t) ?? { you: 0, rivals: 0 };
    if (b.you) c.you++;
    else c.rivals++;
    topicCount.set(t, c);
  }
  const topics = [...topicCount.entries()].sort((a, b) => b[1].rivals - a[1].rivals || a[0].localeCompare(b[0]));
  if (topics.length > 0) blocks.push({ kind: "bars", caption: "Topics rivals post about", items: topics.map(([t, c]) => ({ label: t, value: c.rivals, display: `${c.rivals} rival, ${c.you} yours`, tone: c.you === 0 ? "warm" : "plain" })) });
  const silent = topics.filter(([, c]) => c.rivals > 0 && c.you === 0).map(([t]) => t);
  if (silent.length > 0) blocks.push({ kind: "list", items: [`Topics your rivals post about and you do not yet. ${silent.join(", ")}.`] });
  for (const b of brands) {
    const posts = [...b.posts].sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
    const cards: Card[] = posts.slice(0, 6).map((p) => ({
      title: p.text,
      tag: p.network,
      sub: p.date ?? "undated",
      chips: p.topics,
      rows: engagement(p) > 0 ? [{ label: "Engagement", value: [p.likes !== null ? `${p.likes} likes` : "", p.comments !== null ? `${p.comments} comments` : "", p.shares !== null ? `${p.shares} shares` : ""].filter(Boolean).join(", ") }] : [],
      links: p.url ? [{ href: p.url, label: `Open on ${p.network}` }] : [],
      logo: b.domain,
    }));
    blocks.push({ kind: "cards", caption: `${label(b)}, ${b.posts.length} posts${b.lookups ? ` (${b.lookups})` : ""}`, items: cards, empty: `No posts found for ${b.name} on ${b.linkedinUrl || "LinkedIn"} or X @${b.handle}. The page or handle may use another name.` });
  }
  blocks.push({ kind: "note", text: "Source. LinkedIn company posts and X posts from the pages each company links on its own site (or company.enrich). A page guessed from the domain says so in the lookups. Topics come from keyword rules on the text." });
  return blocks;
}

export const social: GtmModule = {
  id: "social",
  label: "Social",
  needs: ["intake"],
  quote: (cfg) => {
    const n = socialWho(cfg).length;
    const li = cfg.linkedin !== false;
    return { lines: [...(li ? [{ job: SOCIAL_JOBS.linkedin, calls: n * 2, note: "you and each rival, a second provider when the first misses" }] : []), { job: SOCIAL_JOBS.x, calls: n }, { job: "google.serp.organic", calls: n, note: li ? "a web search for the LinkedIn page or the X handle, only when the first one has no recent posts" : "a web search for the X handle, only when the first one has no recent posts" }] };
  },
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") return demoResult("social");
    const now = new Date();
    const page = (ctx.cfg as GtmConfig & MoreHints).more?.page;
    const tally = newTally();
    const brands: SocialBrand[] = [];
    const build = (): SocialOut => ({ summary: summarize(brands), brands: [...brands], tally, provider: tally.providers.join(", "), date: now.toISOString().slice(0, 10) });
    for (const w of socialWho(ctx.cfg)) {
      const s = stem(w.domain);
      // The pages the company links from its own site (or company.enrich), a guess from the domain only as a last resort.
      const prof = ctx.cfg.profiles?.[w.domain];
      const name = prof?.name && !w.you ? prof.name : w.name;
      const looks: string[] = [];
      const posts: SocialPost[] = [];
      const pg = page ? { page } : {};
      const sfx = page ? `:${page}` : "";
      const tried = { li: new Set<string>(), x: new Set<string>() };

      const tryLinkedin = async (url: string, tag: string, how: string): Promise<SocialPost[]> => {
        tried.li.add(url.toLowerCase());
        const li = count(tally, await ctx.call(SOCIAL_JOBS.linkedin, { url, ...pg }, `social-li${tag}:${w.domain}${sfx}`));
        looks.push(`LinkedIn ${how} ${outcomeText(li)}`);
        let got = answered(li) ? parseLinkedinPosts(li.data, now, li.record.provider) : [];
        if (got.length === 0) {
          // A second provider takes the page as "company" (HarvestAPI), so a miss on the first gets another try.
          const li2 = count(tally, await ctx.call(SOCIAL_JOBS.linkedin, { company: url, ...pg }, `social-li2${tag}:${w.domain}${sfx}`));
          looks.push(`LinkedIn second try ${outcomeText(li2)}`);
          if (answered(li2)) got = parseLinkedinPosts(li2.data, now, li2.record.provider);
        }
        return got;
      };
      const tryX = async (h: string, tag: string, how: string): Promise<SocialPost[]> => {
        tried.x.add(h.toLowerCase());
        const x = count(tally, await ctx.call(SOCIAL_JOBS.x, { query: `from:${h}`, limit: 20, ...pg }, `social-x${tag}:${w.domain}${sfx}`));
        looks.push(`X @${h} ${how} ${outcomeText(x)}`);
        return answered(x) ? parseXPosts(x.data, now, x.record.provider, h) : [];
      };
      /** Keeps an account only when its newest post is under 180 days old. An old account says nothing about the brand now. */
      const keep = (got: SocialPost[], label: string): SocialPost[] | null => {
        if (got.length === 0) return null;
        const newest = got.map((p) => p.date).filter((d): d is string => !!d).sort().at(-1);
        if (newest && !isFresh(newest, now)) {
          looks.push(`${label} last posted ${newest}, older than 180 days, not used`);
          return null;
        }
        return got.filter((p) => !p.date || isFresh(p.date, now));
      };

      let linkedinUrl = (prof?.linkedin || `https://www.linkedin.com/company/${s}`).replace(/\/+$/, "");
      const liOff = ctx.cfg.linkedin === false;
      if (liOff) looks.push("LinkedIn steps off");
      let liPosts = liOff ? null : keep(await tryLinkedin(linkedinUrl, "", prof?.linkedin ? "page from the site" : "page guessed from the domain"), linkedinUrl);
      if (!liPosts && !liOff) {
        // A web search for the company page finds the slug the site does not link, or a renamed page.
        const found = await searchLinks(ctx, tally, `site:linkedin.com/company ${name}`, `social-li-find:${w.domain}`, "linkedin", name, w.domain);
        looks.push(`LinkedIn page search found ${found.length}`);
        for (const [i, slug] of found.filter((x) => !tried.li.has(`https://www.linkedin.com/company/${x}`.toLowerCase())).slice(0, 2).entries()) {
          const url = `https://www.linkedin.com/company/${slug}`;
          const got = keep(await tryLinkedin(url, `-s${i}`, "page from a web search"), url);
          if (got) {
            liPosts = got;
            linkedinUrl = url;
            break;
          }
        }
      }
      posts.push(...(liPosts ?? []));

      let handle = prof?.x || s;
      let xPosts = keep(await tryX(handle, "", prof?.x ? "from the site" : "guessed from the domain"), `X @${handle}`);
      if (!xPosts) {
        const found = await searchLinks(ctx, tally, `${name} on X twitter.com`, `social-x-find:${w.domain}`, "x", name, w.domain);
        looks.push(`X handle search found ${found.length}`);
        for (const [i, h] of found.filter((x) => !tried.x.has(x.toLowerCase())).slice(0, 2).entries()) {
          const got = keep(await tryX(h, `-s${i}`, "from a web search"), `X @${h}`);
          if (got) {
            xPosts = got;
            handle = h;
            break;
          }
        }
      }
      posts.push(...(xPosts ?? []));
      brands.push({ ...w, name, linkedinUrl, handle, posts, lookups: looks.join(", ") });
      ctx.partial(build());
    }
    const out = build();
    return { status: "done", summary: out.summary, out };
  },
  render: (o, status) => baseSection({ num: "06B", id: "social", title: "Social listening", status, out: o, activate: "Answer the topics your rivals own, or take the one nobody posts about" }, (f: SocialOut) => socialBlocks(f)),
  files: (o): Record<string, string> => (o && Array.isArray((o as SocialOut).brands) ? { "social.json": JSON.stringify((o as SocialOut).brands, null, 2) + "\n" } : {}),
};

// Module 9, reviews. App Store and Google Maps reviews for you and, when listed, for competitors.
// Themes, average rating and competitor weak spots. Logic lifted from loootai/looot-reviews (MIT):
// the loose review parser, keyword themes and the weak-spot rule.
//
// Auto-skips with the reason printed when the config lists no App Store app and no Google Maps
// listing. G2, Capterra and Trustpilot have no looot job today, so B2B review sites are out of scope.
//
// Config entries (gtm/config.yaml):
//   reviews.appStoreIds: ["284882215"]                     your own apps
//   reviews.mapsPlaces:  ["ChIJN1t_tDeuEmsRUsoyG83frY4"]   your own places, a place id or a numeric CID
//   reviews.competitors: { rival-a.com: { appStoreIds: ["1107711722"], mapsPlaces: [] } }
// The older inline form "rival-a.com:1107711722" in your own lists still works.
//
// Jobs: reviews.appstore.reviews (one provider, no fallback), maps.place.reviews (4 providers).

import type { CallRecord } from "../client.js";
import { reviewEntries, type GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import {
  answered, dayOf, emptyTally, fallbackText, fixture, frame, list, countryOf, nameOfDomain, num, obj, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail,
} from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const REVIEW_JOBS = { appstore: "reviews.appstore.reviews", maps: "maps.place.reviews" } as const;
export const APPSTORE_PAGES = 3;
const B2B_GAP = "B2B review sites have no looot job yet, so they are not covered.";

export interface ReviewTarget { owner: string; id: string; you: boolean; source: "App Store" | "Google Maps" }
export interface Review { owner: string; source: string; rating: number; text: string; date: string | null }

/** "284882215" is yours, "rival-a.com:1107711722" belongs to that competitor. */
export function parseTarget(entry: string, source: ReviewTarget["source"], cfg: Pick<GtmConfig, "domain">): ReviewTarget {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+):(.+)$/i.exec(entry.trim());
  if (m) return { owner: m[1].toLowerCase(), id: m[2].trim(), you: m[1].toLowerCase() === cfg.domain, source };
  return { owner: cfg.domain, id: entry.trim(), you: true, source };
}

export function targetsOf(cfg: GtmConfig): ReviewTarget[] {
  const e = reviewEntries(cfg);
  return [...e.appStore.map((x) => parseTarget(x, "App Store", cfg)), ...e.maps.map((x) => parseTarget(x, "Google Maps", cfg))];
}

/** The reason the module skips for this config, or null when it runs. */
export function reviewsSkip(cfg: GtmConfig): string | null {
  if (cfg.reviews.mode === "off") return "turned off in config";
  const e = reviewEntries(cfg);
  if (e.appStore.length + e.maps.length === 0) {
    return `no App Store app or Google Maps listing found for ${cfg.domain}. Add App Store ids or Maps places under reviews in gtm/config.yaml to run it. ${B2B_GAP}`;
  }
  return null;
}

export function reviewsQuote(cfg: GtmConfig): ModuleQuote {
  const skip = reviewsSkip(cfg);
  if (skip) return { lines: [], skip };
  const lines = [];
  const e = reviewEntries(cfg);
  if (e.appStore.length) lines.push({ job: REVIEW_JOBS.appstore, calls: e.appStore.length * APPSTORE_PAGES, note: `up to ${APPSTORE_PAGES} pages per app, stops at an empty page` });
  if (e.maps.length) lines.push({ job: REVIEW_JOBS.maps, calls: e.maps.length, note: "newest reviews per place" });
  return { lines };
}

/** App Store ids found in page text (apps.apple.com/.../id284882215). For intake to fill reviews.appStoreIds. */
export function appStoreIdsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/apps\.apple\.com\/[^\s)"']*?\/id(\d{6,12})/gi)].map((m) => m[1]))];
}

// ---------- parse ----------

function toRating(v: unknown): number | undefined {
  if (v && typeof v === "object") return toRating(obj(v).value ?? obj(v).rating);
  const n = num(v);
  if (n === undefined || n < 0.5 || n > 5.49) return undefined;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** Review rows from any provider answer. A row needs a rating and some text. */
export function parseReviews(raw: unknown, owner: string, source: string, now: Date): Review[] {
  const out: Review[] = [];
  const seen = new Set<string>();
  for (const r of list(raw, ["reviews", "user_reviews", "review_list", "comments", "items", "results"])) {
    const rating = toRating(r.rating ?? r.stars ?? r.score ?? r.star_rating ?? r.user_rating);
    const text = str(r.snippet, r.text, r.content, r.body, r.review, r.review_text, r.comment, r.description, obj(r.text).text, r.title);
    if (rating === undefined || !text) continue;
    const key = `${rating}|${text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, source, rating, text, date: dayOf(r.iso_date ?? r.isoDate ?? r.date ?? r.published_at ?? r.review_date ?? r.updated, now) });
  }
  return out;
}

// ---------- analyze ----------

/** Theme keywords, matched at the start of a word. A trimmed version of looot-reviews config/themes.json. */
export const THEMES: Record<string, string[]> = {
  "Ease of use": ["easy to use", "intuitive", "confusing", "interface", "user friendly", "simple to", "learning curve", "clunky"],
  "Setup and onboarding": ["setup", "set up", "onboarding", "getting started", "migrat", "import"],
  "Price and value": ["price", "pricing", "expensive", "overpriced", "cheap", "cost", "value", "worth", "subscription", "billing", "refund"],
  "Reliability and bugs": ["crash", "bug", "freez", "glitch", "error", "not working", "doesn't work", "stopped working", "slow", "lag"],
  "Mobile app": ["mobile", "iphone", "android", "offline", "app store"],
  "Sync and integrations": ["sync", "integrat", "outlook", "gmail", "calendar", "zapier", "api"],
  "Customer support": ["support", "no response", "never replied", "ticket", "customer service", "help desk"],
  "Features": ["feature", "missing", "wish it", "option to", "export", "report", "automation"],
  "Staff and service": ["staff", "rude", "friendly", "helpful", "manager", "service"],
};

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
const matcher = (kws: string[]) => {
  const re = new RegExp(`(^|[^a-z0-9])(${kws.map((k) => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");
  return (t: string) => re.test(t.toLowerCase());
};

export type ThemeRow = { theme: string; count: number; tone: string; avg: number };
export type WeakSpotRow = { competitor: string; theme: string; count: number; avg: number; yours: string };

export function themesOf(reviews: Review[]): ThemeRow[] {
  return Object.entries(THEMES)
    .map(([theme, kws]) => {
      const test = matcher(kws);
      const hits = reviews.filter((r) => test(r.text));
      const avg = mean(hits.map((r) => r.rating));
      return { theme, count: hits.length, avg, tone: avg >= 4 ? "praise" : avg <= 2.5 ? "complaint" : "mixed" };
    })
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

/** Themes where a competitor's reviewers are unhappy (average 3 or less, or 40% at 1 to 2 stars) and yours are not. */
export function weakSpotsOf(reviews: Review[], you: string): WeakSpotRow[] {
  const owners = [...new Set(reviews.map((r) => r.owner))].filter((o) => o !== you);
  const out: WeakSpotRow[] = [];
  for (const owner of owners) {
    for (const [theme, kws] of Object.entries(THEMES)) {
      const test = matcher(kws);
      const theirs = reviews.filter((r) => r.owner === owner && test(r.text));
      if (theirs.length < 3) continue;
      const avg = mean(theirs.map((r) => r.rating));
      const neg = theirs.filter((r) => r.rating <= 2).length / theirs.length;
      if (!(avg <= 3 || neg >= 0.4)) continue;
      const mine = reviews.filter((r) => r.owner === you && test(r.text));
      const myAvg = mine.length >= 3 ? mean(mine.map((r) => r.rating)) : null;
      if (myAvg !== null && myAvg - avg < 0.5) continue;
      out.push({ competitor: nameOfDomain(owner), theme, count: theirs.length, avg, yours: myAvg === null ? "rarely raised" : String(myAvg) });
    }
  }
  return out.sort((a, b) => a.avg - b.avg || b.count - a.count).slice(0, 12);
}

// ---------- run ----------

export type ListingRow = { owner: string; source: string; id: string; reviews: number; rating: string; status: string; provider: string; fallback: string };

export interface ReviewsOut {
  placeholder?: string;
  summary: string;
  provider: string;
  date: string;
  source: string;
  rating: number | string;
  count: number;
  themes: ThemeRow[];
  weakSpots: WeakSpotRow[];
  listings?: ListingRow[];
  calls?: string;
}

async function run(ctx: ModuleContext) {
  const cfg = ctx.cfg;
  const now = new Date();
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const all: Review[] = [];
  const listings: ListingRow[] = [];
  const country = countryOf(cfg.icp.geos);

  const build = (): ReviewsOut => {
    const mine = all.filter((r) => r.owner === cfg.domain);
    const sources = [...new Set(mine.map((r) => r.source))];
    const themes = themesOf(mine);
    const rating = mine.length ? mean(mine.map((r) => r.rating)) : "-";
    const summary = mine.length
      ? `${sources.join(" and ")}, ${rating} average over ${mine.length} reviews, ${themes.length} themes`
      : `no reviews came back for ${cfg.domain}`;
    return { summary, provider: providersOf(calls), date: today(), source: sources.join(", ") || "-", rating, count: mine.length, themes, weakSpots: weakSpotsOf(all, cfg.domain), listings: [...listings], calls: tallyLine(t) };
  };

  const one = async (tg: ReviewTarget) => {
    const got: Review[] = [];
    let last: CallRecord | null = null;
    if (tg.source === "App Store") {
      for (let page = 1; page <= APPSTORE_PAGES; page++) {
        const r = await tracked(ctx, t, calls, REVIEW_JOBS.appstore, { product_id: tg.id, country, page }, `appstore:${tg.owner}:${tg.id}:${page}`);
        last = r.record;
        const rows = answered(r) ? parseReviews(r.data, tg.owner, tg.source, now) : [];
        got.push(...rows);
        if (rows.length === 0) break;
      }
    } else {
      const key = /^\d+$/.test(tg.id) ? { cid: tg.id } : { placeId: tg.id };
      const r = await tracked(ctx, t, calls, REVIEW_JOBS.maps, { ...key, sortBy: "newest", gl: country }, `maps:${tg.owner}:${tg.id}`);
      last = r.record;
      if (answered(r)) got.push(...parseReviews(r.data, tg.owner, tg.source, now));
    }
    all.push(...got);
    listings.push({
      owner: tg.you ? "you" : nameOfDomain(tg.owner),
      source: tg.source,
      id: tg.id,
      reviews: got.length,
      rating: got.length ? String(mean(got.map((x) => x.rating))) : "-",
      status: got.length ? "answered" : last ? (last.outcome === "hit" || last.outcome === "fallback" ? "answered, no reviews" : outcomeText(last)) : "-",
      provider: last ? trail(last) : "-",
      fallback: fallbackText(tg.source === "App Store" ? REVIEW_JOBS.appstore : REVIEW_JOBS.maps),
    });
  };

  try {
    await pool(targetsOf(cfg), 3, async (tg) => {
      await one(tg);
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`reviews: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: ReviewsOut): Block[] {
  const b: Block[] = [
    { kind: "stat", items: [{ label: "Source", value: o.source }, { label: "Rating", value: String(o.rating) }, { label: "Reviews", value: String(o.count) }] },
    { kind: "table", caption: "Themes in your reviews", columns: [{ key: "theme", label: "Theme" }, { key: "count", label: "Reviews", num: true }, { key: "tone", label: "Tone" }], rows: o.themes },
    { kind: "table", caption: "Competitor weak spots", columns: [{ key: "competitor", label: "Competitor" }, { key: "theme", label: "Theme" }, { key: "count", label: "Reviews", num: true }, ...(o.weakSpots.some((w) => w.avg !== undefined) ? [{ key: "avg", label: "Their avg", num: true }, { key: "yours", label: "Yours" }] : [])], rows: o.weakSpots },
  ];
  if (o.listings?.length) b.push({ kind: "table", caption: "Listings read", columns: [{ key: "owner", label: "Whose" }, { key: "source", label: "Source" }, { key: "id", label: "Id" }, { key: "reviews", label: "Reviews", num: true }, { key: "rating", label: "Rating" }, { key: "status", label: "Answer" }, { key: "provider", label: "Provider" }, { key: "fallback", label: "Fallback" }], rows: o.listings });
  if (o.count > 0 && o.count < 30) b.push({ kind: "note", text: `Only ${o.count} reviews. Themes on this few are weak evidence.` });
  b.push({ kind: "note", text: B2B_GAP });
  return b;
}

export const reviews: GtmModule = {
  id: "reviews",
  label: "Reviews",
  needs: ["intake"],
  quote: reviewsQuote,
  async run(ctx) {
    const skip = reviewsSkip(ctx.cfg);
    if (skip) return { status: "skipped", summary: skip, out: { skipped: true, summary: skip } };
    if (ctx.mode === "demo") {
      const f = fixture("reviews");
      return { status: "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "08", id: "reviews", title: "Reviews", deeper: "github.com/loootai/looot-reviews, npm run reviews -- --config reviews.yaml", activate: "Use the competitor weak spots in your battlecards" }, out, status, (o) => blocks(o as ReviewsOut)),
};

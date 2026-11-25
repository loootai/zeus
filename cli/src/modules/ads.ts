// Module 7, ads. Searches the Meta, LinkedIn and Google ad libraries for you and each competitor,
// then reads the angles and offers in the ad copy with keyword rules (no model). Ad parsing and the
// angle and offer rules are lifted from loootai/looot-ads (src/lib/normalize.ts, src/lib/analyze.ts,
// config/angles.json, MIT) and cut down. Google ads come from one provider on the platform key,
// so every Google cell says so and a miss there has no second provider behind it.

import type { CallResult } from "../client.js";
import type { Block } from "../dossier/blocks.js";
import { job } from "./jobs.js";
import { answered, baseSection, count, demoResult, isObj, newTally, outcomeText, type CallTally, type Obj } from "./signals.js";
import type { GtmModule, ModuleContext } from "./types.js";

export type Platform = "meta" | "linkedin" | "google";
export const PLATFORM_JOB: Record<Platform, string> = { meta: "ads.meta.search", linkedin: "ads.linkedin.search", google: "google.company.ads" };

/** From looot-ads config/angles.json. An angle is a theme in the copy, a hit is any keyword in the headline or body. */
export const ANGLES: Record<string, string[]> = {
  "Price and savings": ["save", "cheaper", "discount", "affordable", "lowest price", "cost less", "half the price", "budget"],
  "Speed and ease": ["in minutes", "in seconds", "instantly", "easy", "simple", "no code", "one click", "set up in", "faster", "quick"],
  "Results and ROI": ["roi", "grow", "increase", "boost", "more leads", "more sales", "revenue", "convert", "results", "double your"],
  "Social proof": ["trusted by", "customers", "rated", "reviews", "#1", "award", "join ", "teams use", "loved by", "thousands"],
  Urgency: ["limited time", "ends", "last chance", "today only", "hurry", "don't miss", "while supplies", "now or never", "this week"],
  "Risk reversal": ["money back", "guarantee", "no credit card", "cancel anytime", "risk free", "free trial", "try free", "no commitment"],
  "AI and automation": [" ai ", "ai-powered", "automate", "automation", "agent", "copilot", "machine learning"],
  "Security and trust": ["secure", "security", "compliance", "soc 2", "gdpr", "privacy", "encrypted"],
  "Pain point question": ["tired of", "struggling", "sick of", "still using", "why is", "what if", "ever wonder"],
};

export const OFFERS: { label: string; re: RegExp }[] = [
  { label: "Percent off", re: /\b\d{1,2}\s?% off/i },
  { label: "Amount off", re: /[$€£]\s?\d+(\.\d+)?\s?off/i },
  { label: "Free trial", re: /free trial|try (it )?free|start free/i },
  { label: "Demo or call", re: /book a (demo|call)|request a demo|get a demo|free demo|schedule a (demo|call)/i },
  { label: "Free audit or quote", re: /free (audit|consultation|quote|sample|assessment|report)/i },
  { label: "Guarantee", re: /money.?back|guarantee/i },
  { label: "No credit card", re: /no credit card/i },
  { label: "Limited time", re: /limited time|today only|ends (today|tonight|soon|sunday|monday|friday)/i },
  { label: "Free plan", re: /free (plan|forever|tier)|forever free/i },
];

export interface Ad {
  platform: Platform;
  advertiser: string | null;
  headline: string | null;
  body: string | null;
  firstSeen: string | null;
  url: string | null;
  provider: string;
  /** Where the ad sends people, when the library answer has it. */
  landing?: string | null;
  /** The creative image or video thumbnail, when the library answer has one. */
  image?: string | null;
  /** The call to action on the ad button, when there is one. */
  cta?: string | null;
  /** The creative saved under gtm/assets/ at run time, relative to gtm/. */
  imageFile?: string | null;
}

const PLATFORM_NAME: Record<string, string> = { meta: "Meta", linkedin: "LinkedIn", google: "Google" };

const LIST_KEYS = ["ads", "results", "data", "items", "ads_data", "advertisements", "creatives", "ad_list", "searchResults", "response", "materials", "ad_creatives", "tasks", "result"];

/** The list of ads in a provider answer, up to four levels deep. DataForSEO nests tasks[].result[].items[]. */
export function findAdArray(result: unknown, depth = 0): Obj[] {
  if (Array.isArray(result)) {
    const objs = result.filter(isObj);
    if (depth < 4 && objs.length > 0 && objs.every((o) => LIST_KEYS.some((k) => Array.isArray(o[k])) && !("title" in o) && !("headline" in o))) return objs.flatMap((o) => findAdArray(o, depth + 1));
    return objs;
  }
  if (!isObj(result) || depth > 4) return [];
  for (const k of LIST_KEYS) {
    const v = result[k];
    if (Array.isArray(v) && v.some(isObj)) return findAdArray(v, depth + 1);
  }
  for (const k of LIST_KEYS) {
    if (isObj(result[k])) {
      const inner = findAdArray(result[k], depth + 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

const scopes = (ad: Obj): Obj[] => [ad, ...["snapshot", "creative", "content", "details", "ad", "advertiser"].filter((k) => isObj(ad[k])).map((k) => ad[k] as Obj)];

function pickStr(ad: Obj, keys: string[]): string | null {
  for (const s of scopes(ad))
    for (const k of keys) {
      const v = s[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (isObj(v) && typeof v.text === "string" && v.text.trim()) return v.text.trim();
    }
  return null;
}

/** Date value (ISO text, unix seconds or milliseconds) to an ISO day, or null. */
export function toDay(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let ms: number;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === "string") ms = /^\d{9,13}$/.test(v) ? (Number(v) < 1e11 ? Number(v) * 1000 : Number(v)) : Date.parse(v);
  else return null;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return d.getUTCFullYear() < 2005 || d.getUTCFullYear() > 2100 ? null : d.toISOString().slice(0, 10);
}

const START_KEYS = ["start_date", "startDate", "start_date_string", "ad_delivery_start_time", "first_shown", "firstShown", "first_shown_date", "first_seen", "firstSeen", "date_start", "created_at"];

const httpUrl = (v: string | null): string | null => (v && /^https?:\/\//i.test(v) ? v : null);

/** The first image URL in a list of images or cards, as Meta returns them (snapshot.images[].original_image_url). */
function imageIn(ad: Obj): string | null {
  for (const s of scopes(ad))
    for (const k of ["images", "cards", "videos", "imageSources", "carouselImages"]) {
      const v = s[k];
      if (!Array.isArray(v)) continue;
      for (const x of v) {
        if (typeof x === "string" && /^https?:/.test(x)) return x;
        if (isObj(x)) for (const kk of ["original_image_url", "resized_image_url", "image_url", "video_preview_image_url", "src", "url"]) if (typeof x[kk] === "string" && /^https?:/.test(x[kk] as string)) return x[kk] as string;
      }
    }
  return null;
}

export function parseAds(result: unknown, platform: Platform, provider: string): Ad[] {
  const out: Ad[] = [];
  const seen = new Set<string>();
  for (const raw of findAdArray(result)) {
    const headline = pickStr(raw, ["title", "headline", "ad_title", "link_title"]);
    const body = pickStr(raw, ["body", "ad_text", "commentary", "primary_text", "message", "text", "description", "ad_creative_body", "caption"]);
    const image0 = httpUrl(pickStr(raw, ["image_url", "imageUrl", "thumbnail", "thumbnail_url", "original_image_url", "resized_image_url", "video_preview_image_url", "preview_image", "image"]) ?? imageIn(raw));
    // A Google text or image ad comes back as a rendered image only. It is kept for its creative.
    if (!headline && !body && !image0) continue;
    let advertiser: string | null = null;
    for (const s of scopes(raw)) {
      for (const k of ["page_name", "advertiser_name", "advertiserName", "brand_name", "advertiser", "paid_for_by", "byline"]) {
        const v = s[k];
        if (typeof v === "string" && v.trim()) advertiser = v.trim();
        else if (isObj(v) && typeof v.name === "string") advertiser = v.name.trim();
        if (advertiser) break;
      }
      if (advertiser) break;
    }
    let firstSeen: string | null = null;
    for (const s of scopes(raw)) for (const k of START_KEYS) firstSeen ??= toDay(s[k]);
    const id = pickStr(raw, ["ad_archive_id", "ad_id", "adId", "creative_id", "creativeId", "id"]);
    const url = pickStr(raw, ["ad_library_url", "library_url", "ad_url", "adUrl", "url", "preview_url"]) ?? (platform === "meta" && id ? `https://www.facebook.com/ads/library/?id=${id}` : null);
    const key = id ?? `${headline}|${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dom = pickStr(raw, ["domain", "caption"]);
    const landing = httpUrl(pickStr(raw, ["link_url", "landing_page", "landingPage", "landing_url", "destination_url", "final_url", "display_url", "cta_link", "website_url"])) ?? (dom && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dom) ? `https://${dom.toLowerCase()}` : null);
    const image = image0;
    const cta = pickStr(raw, ["cta_text", "ctaText", "call_to_action", "cta", "cta_type"]);
    out.push({ platform, advertiser, headline, body, firstSeen, url, provider, landing, image, cta });
  }
  return out;
}

const textOf = (a: Ad) => ` ${[a.headline, a.body].filter(Boolean).join(" . ").toLowerCase()} `;
export const anglesOf = (a: Ad) => Object.entries(ANGLES).filter(([, ws]) => ws.some((w) => textOf(a).includes(w))).map(([n]) => n);
export const offersOf = (a: Ad) => OFFERS.filter((o) => o.re.test(textOf(a))).map((o) => o.label);

function tallyLabels(labels: string[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of labels) m.set(l, (m.get(l) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * Does this ad belong to this advertiser. The advertiser name must match the brand (or the domain
 * stem) and the landing page must sit on the brand's domain. A side the library does not return is
 * not held against the ad, but at least one side must match. Everything else is dropped.
 */
export function belongsTo(ad: Pick<Ad, "advertiser" | "landing">, who: { name: string; domain: string }): { ok: boolean; why: string } {
  const stem = who.domain.split(".")[0];
  const names = [squash(who.name), squash(stem)].filter((x) => x.length >= 3);
  // The advertiser name, minus legal and web suffixes, must be the brand: "2PR.io" and "Buffer Inc" match,
  // "Creative Buffer Consultancy Private Limited" and "TEPLOBAK | Buffer Tanks" do not.
  const SUFFIX = /\b(inc|llc|ltd|limited|gmbh|sas|sarl|bv|co|company|corp|corporation|private|pvt|plc|app|hq|io|ai|com|official|team|the|by [a-z0-9 ]+)\b\.?/gi;
  const adv = ad.advertiser ? squash(ad.advertiser.replace(/\.(com|io|ai|app|co)\b/gi, "").replace(SUFFIX, " ")) : "";
  const nameOk = adv ? names.some((n) => adv === n) : null;
  let landOk: boolean | null = null;
  if (ad.landing) {
    try {
      const h = new URL(ad.landing).hostname.replace(/^www\./, "").toLowerCase();
      landOk = h === who.domain || h.endsWith(`.${who.domain}`);
    } catch {
      landOk = null;
    }
  }
  if (nameOk === false) return { ok: false, why: `advertiser "${ad.advertiser}" is not ${who.name}` };
  if (landOk === false) return { ok: false, why: `landing page is not on ${who.domain}` };
  if (!nameOk && !landOk) return { ok: false, why: "no advertiser name or landing page to check" };
  return { ok: true, why: "" };
}

export interface Advertiser {
  name: string;
  domain: string;
  you: boolean;
  meta: number | string;
  linkedin: number | string;
  google: number | string;
  angles: string[];
  offers: string[];
  sample: { headline: string; date: string; platform: string; url: string; provider: string } | null;
  ads: Ad[];
  lookups: string;
  /** Ads the libraries returned that were not this advertiser's, by reason. */
  dropped?: { reason: string; count: number }[];
}

/** A cell: the ad count, or why there is no count. */
function cell(r: CallResult, n: number): number | string {
  if (r.record.outcome === "fail") return "fail";
  return n;
}

async function board(ctx: ModuleContext, who: { name: string; domain: string; you: boolean }, tally: CallTally): Promise<Advertiser> {
  // `looot-zeus more ads` asks the libraries for the next page of results.
  const page = (ctx.cfg as { more?: { page?: number } }).more?.page;
  const pg = page ? { page } : {};
  // Search by the advertiser itself, never by a keyword: the Meta page id or the advertiser name on
  // the company ads endpoint, the LinkedIn company id (from the company's page) or its name, and the
  // domain on Google's transparency library.
  const prof = ctx.cfg.profiles?.[who.domain];
  const fbId = prof?.facebook && /^\d{6,}$/.test(prof.facebook) ? prof.facebook : "";
  const inputs: Record<Platform, Record<string, unknown>> = {
    meta: fbId ? { pageId: fbId, ...pg } : { companyName: who.name, ...pg },
    linkedin: prof?.linkedinId ? { companyId: prof.linkedinId, ...pg } : { company: who.name, ...pg },
    google: { domain: who.domain, ...pg },
  };
  const droppedWhy = new Map<string, number>();
  const ads: Ad[] = [];
  const cells: Partial<Record<Platform, number | string>> = {};
  const looks: string[] = [];
  for (const p of (["meta", "linkedin", "google"] as Platform[]).filter((x) => x !== "linkedin" || ctx.cfg.linkedin !== false)) {
    let r = count(tally, await ctx.call(PLATFORM_JOB[p], inputs[p], `${p}:${who.domain}${page ? `:${page}` : ""}`));
    looks.push(`${p} ${outcomeText(r)}`);
    let found = answered(r) ? parseAds(r.data, p, r.record.provider) : [];
    // The Meta company ads endpoint times out or refuses some names (ContentIn, AuthoredUp on 3 Nov). A keyword
    // search on the advertiser name is the fallback. The advertiser check below keeps only this brand's ads.
    if (p === "meta" && found.length === 0 && r.record.outcome !== "hit" && r.record.outcome !== "fallback") {
      const r2 = count(tally, await ctx.call(PLATFORM_JOB.meta, { query: who.name, ...pg }, `meta-kw:${who.domain}${page ? `:${page}` : ""}`));
      looks.push(`meta keyword search ${outcomeText(r2)}`);
      if (answered(r2)) {
        r = r2;
        found = parseAds(r2.data, p, r2.record.provider);
      } else if (r.record.outcome === "fail" && r2.record.outcome !== "fail") r = r2;
    }
    // A library can return other brands' ads (resellers, look-alike names). Only this advertiser's ads stay.
    const mine = found.filter((a) => {
      const b = belongsTo(a, who);
      if (!b.ok) droppedWhy.set(`${PLATFORM_NAME[p]}: ${b.why.replace(/"[^"]*"/, "another name")}`, (droppedWhy.get(`${PLATFORM_NAME[p]}: ${b.why.replace(/"[^"]*"/, "another name")}`) ?? 0) + 1);
      return b.ok;
    });
    ads.push(...mine);
    cells[p] = cell(r, mine.length);
  }
  const angles = tallyLabels(ads.flatMap(anglesOf));
  const offers = tallyLabels(ads.flatMap(offersOf));
  const newest = [...ads].filter((a) => a.headline || a.body).sort((a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""))[0];
  return {
    ...who,
    meta: cells.meta ?? 0,
    linkedin: cells.linkedin ?? 0,
    google: cells.google ?? 0,
    angles: angles.map((a) => `${a.label} (${a.count})`),
    offers: offers.map((a) => `${a.label} (${a.count})`),
    sample: newest ? { headline: (newest.headline ?? newest.body ?? "").slice(0, 120), date: newest.firstSeen ?? "undated", platform: newest.platform, url: newest.url ?? "", provider: newest.provider } : null,
    ads,
    lookups: looks.join(", "),
    dropped: [...droppedWhy.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/** Angles a competitor runs that you do not run. Angles nobody runs. */
export function gaps(advertisers: Pick<Advertiser, "you" | "angles">[]): { yoursMissing: string[]; nobody: string[] } {
  const names = (a: Pick<Advertiser, "angles">) => a.angles.map((x) => x.replace(/ \(\d+\)$/, ""));
  const you = new Set(advertisers.filter((a) => a.you).flatMap(names));
  const rivals = new Set(advertisers.filter((a) => !a.you).flatMap(names));
  return { yoursMissing: [...rivals].filter((x) => !you.has(x)), nobody: Object.keys(ANGLES).filter((x) => !you.has(x) && !rivals.has(x)) };
}

export interface AdsOut {
  summary: string;
  advertisers: Advertiser[];
  gaps: { yoursMissing: string[]; nobody: string[] };
  singleProvider: string[];
  tally: CallTally;
  provider: string;
  date: string;
  placeholder?: string;
  skipped?: boolean;
}

function out(list: Advertiser[], tally: CallTally, now: Date): AdsOut {
  const total = list.reduce((n, a) => n + a.ads.length, 0);
  const angles = new Set(list.flatMap((a) => a.angles.map((x) => x.replace(/ \(\d+\)$/, ""))));
  const single = (["meta", "linkedin", "google"] as Platform[]).map((p) => PLATFORM_JOB[p]).filter((j) => job(j).singleProvider);
  return { summary: `${total} ads across ${list.filter((a) => a.ads.length > 0).length} of ${list.length} advertisers, ${angles.size} ${angles.size === 1 ? "angle" : "angles"}`, advertisers: list, gaps: gaps(list), singleProvider: single, tally, provider: tally.providers.join(", "), date: now.toISOString().slice(0, 10) };
}

const n = (v: number | string): number => (typeof v === "number" ? v : 0);

/** Ad volume by advertiser, split by platform, and the angles each one runs. */
export function adVisuals(f: AdsOut): Block[] {
  const label = (a: Advertiser) => (a.you ? `${a.name} (you)` : a.name);
  const out: Block[] = [
    { kind: "bars", caption: "Live ads by advertiser and platform", items: f.advertisers.map((a) => {
      const parts = [{ label: "Meta", value: n(a.meta), tone: "go" as const }, { label: "LinkedIn", value: n(a.linkedin), tone: "warm" as const }, { label: "Google", value: n(a.google), tone: "plain" as const }];
      const total = parts.reduce((x, p) => x + p.value, 0);
      return { label: label(a), value: total, display: String(total), tone: a.you ? "go" : "plain", parts };
    }) },
  ];
  const angleCount = new Map<string, number>();
  for (const a of f.advertisers.filter((x) => !x.you)) for (const x of a.angles) {
    const k = x.replace(/ \(\d+\)$/, "");
    angleCount.set(k, (angleCount.get(k) ?? 0) + (Number(/\((\d+)\)$/.exec(x)?.[1]) || 1));
  }
  const mine = new Set(f.advertisers.filter((x) => x.you).flatMap((a) => a.angles.map((x) => x.replace(/ \(\d+\)$/, ""))));
  if (angleCount.size > 0) out.push({ kind: "bars", caption: "Angles your rivals run", items: [...angleCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, display: `${v} ${v === 1 ? "ad" : "ads"}, ${mine.has(k) ? "yours too" : "not yours"}`, tone: mine.has(k) ? "plain" : "warm" })) });
  return out;
}

/** The ads themselves, as cards, one group per advertiser. */
export function adGallery(f: AdsOut): Block[] {
  return f.advertisers.map((a): Block => {
    const list = [...(a.ads ?? [])].sort((x, y) => (y.firstSeen ?? "").localeCompare(x.firstSeen ?? ""));
    return {
      kind: "cards",
      caption: `${a.you ? `${a.name} (you)` : a.name}, ${list.length} ${list.length === 1 ? "ad" : "ads"} pulled`,
      empty: `No ad from ${a.name} itself came back${(a.dropped ?? []).length > 0 ? `. ${(a.dropped ?? []).reduce((n, d) => n + d.count, 0)} ads from other advertisers were dropped` : ""}.`,
      items: list.slice(0, 9).map((ad) => ({
        title: ad.headline ?? (ad.body ? ad.body.slice(0, 90) : `${PLATFORM_NAME[ad.platform] ?? ad.platform} ad from ${ad.advertiser ?? a.name}`),
        tag: PLATFORM_NAME[ad.platform] ?? ad.platform,
        sub: `first seen ${ad.firstSeen ?? "undated"}${ad.provider ? `, ${ad.provider}` : ""}`,
        text: ad.headline && ad.body ? (ad.body.length > 220 ? `${ad.body.slice(0, 217)}...` : ad.body) : undefined,
        image: ad.imageFile ?? ad.image ?? undefined,
        logo: a.domain,
        chips: [...anglesOf(ad), ...offersOf(ad)],
        rows: [{ label: "Advertiser", value: ad.advertiser ?? a.name }, ...(ad.landing ? [{ label: "Landing domain", value: (() => { try { return new URL(ad.landing).hostname.replace(/^www\./, ""); } catch { return ad.landing.slice(0, 60); } })() }] : []), ...(ad.cta ? [{ label: "Button", value: ad.cta }] : [])],
        links: [...(ad.url ? [{ href: ad.url, label: "Open in the ad library" }] : []), ...(ad.landing ? [{ href: ad.landing, label: "Landing page" }] : [])],
      })),
    };
  });
}

export const ads: GtmModule = {
  id: "ads",
  label: "Ads",
  needs: ["intake"],
  quote: (cfg) => {
    const k = 1 + cfg.competitors.length;
    return { lines: [{ job: "ads.meta.search", calls: k + Math.ceil(k / 2), note: "the company ads page, then a name search when it misses" }, ...(cfg.linkedin === false ? [] : [{ job: "ads.linkedin.search", calls: k }]), { job: "google.company.ads", calls: k, note: "by domain, one provider, no fallback" }] };
  },
  async run(ctx) {
    if (ctx.mode === "demo") return demoResult("ads");
    const now = new Date();
    // The name each brand uses (profiles, from its own site or company.enrich), the domain stem only without one.
    const nameOf = (d: string) => ctx.cfg.profiles?.[d]?.name || d.split(".")[0].charAt(0).toUpperCase() + d.split(".")[0].slice(1);
    const who = [{ name: ctx.cfg.brand, domain: ctx.cfg.domain, you: true }, ...ctx.cfg.competitors.map((d) => ({ name: nameOf(d), domain: d, you: false }))];
    const tally = newTally();
    const list: Advertiser[] = [];
    for (const w of who) {
      list.push(await board(ctx, w, tally));
      ctx.partial(out(list, tally, now));
    }
    const o = out(list, tally, now);
    return { status: "done", summary: o.summary, out: o };
  },
  render: (o, status) =>
    baseSection({ num: "06", id: "ads", title: "Ad board", status, out: o, deeper: "github.com/loootai/looot-ads, npm run ads -- --file competitors.csv --max-spend 0.12", activate: "Test the angle nobody runs yet" }, (f: AdsOut) => {
      const single = Array.isArray(f.singleProvider) ? f.singleProvider : [];
      const gLabel = single.includes(PLATFORM_JOB.google) ? "Google (one provider)" : "Google";
      const blocks: Block[] = [
        { kind: "table", caption: "Live ads by advertiser", columns: [{ key: "who", label: "Advertiser" }, { key: "meta", label: "Meta", num: true }, { key: "linkedin", label: "LinkedIn", num: true }, { key: "google", label: gLabel, num: true }, { key: "angles", label: "Angles" }, { key: "offers", label: "Offers" }, { key: "headline", label: "Newest headline" }], rows: f.advertisers.map((a) => ({ ...a, who: a.you ? `${a.name} (you)` : a.name, angles: a.angles.join(", ") || "none read", offers: a.offers.join(", ") || "none read", headline: a.sample ? `${a.sample.headline} (${a.sample.date}${a.sample.provider ? `, ${a.sample.provider}` : ""})` : "no ad found" })) },
      ];
      blocks.unshift(...adVisuals(f));
      blocks.push(...adGallery(f));
      const g = f.gaps;
      if (g) blocks.push({ kind: "list", items: [`Rival angles you do not run yet. ${g.yoursMissing.join(", ") || "None"}.`, `Angles nobody runs yet. ${g.nobody.join(", ") || "None"}.`] });
      const lookups = f.advertisers.filter((a) => a.lookups).map((a) => ({ who: a.name, lookups: a.lookups }));
      if (lookups.length > 0) blocks.push({ kind: "table", caption: "Lookups", columns: [{ key: "who", label: "Advertiser" }, { key: "lookups", label: "Meta, LinkedIn, Google" }], rows: lookups });
      if (single.length > 0) blocks.push({ kind: "note", text: `One provider, no fallback for ${single.join(", ")}. A miss there means that one provider found nothing.` });
      const dropped = f.advertisers.flatMap((a) => (a.dropped ?? []).map((d) => ({ who: a.name, reason: d.reason, count: d.count })));
      if (dropped.length > 0) blocks.push({ kind: "table", caption: "Ads dropped because they were not the advertiser's own", columns: [{ key: "who", label: "Searched for" }, { key: "reason", label: "Why dropped" }, { key: "count", label: "Ads", num: true }], rows: dropped });
      blocks.push({ kind: "note", text: "Each library is searched by the advertiser itself, never by a keyword. Meta by advertiser name or page id, LinkedIn by company, Google by domain. An ad stays only when its advertiser name matches and its landing page is on the advertiser's domain. Angles and offers come from keyword rules on the ad copy." });
      return blocks;
    }),
  files: (o): Record<string, string> => (o && Array.isArray((o as AdsOut).advertisers) ? { "ads.json": JSON.stringify((o as AdsOut).advertisers, null, 2) + "\n" } : {}),
};

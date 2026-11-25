// Module 0, intake. Domain in, config draft out.
// Scrapes four pages (home, pricing, customers, alternatives or vs page) with web.scrape.markdown,
// then derives a first config: brand, one-line offer, ICP hypothesis, seed customers, competitors,
// keywords and buyer questions. Every value is a draft for the user (or their agent) to edit.

import type { GtmConfig } from "../config.js";
import { normalizeConfig } from "../config.js";
import { cleanDomain } from "../util.js";
import { asinsIn, looksLikeStore } from "./commerce.js";
import { looksLocal } from "./local.js";
import { appStoreIdsIn } from "./reviews.js";
import { isGeneric, isSeedDomain } from "./rivals.js";
import { categoryPhrases } from "./target.js";
import type { GtmModule, ModuleContext } from "./types.js";

export type PageKind = "home" | "pricing" | "customers" | "alternatives" | "casestudies" | "usecases" | "about";

/** Every page kind intake reads, in order. */
export const PAGE_KINDS: PageKind[] = ["home", "pricing", "customers", "alternatives", "casestudies", "usecases", "about"];

export interface IntakePage {
  kind: PageKind;
  url: string;
  ok: boolean;
  chars: number;
  markdown: string;
}

export interface IntakeOut {
  pages: IntakePage[];
  config: GtmConfig;
  /** Fields that came from a default because the pages did not say. */
  guessed: string[];
}

const DEFAULT_PATHS: Record<Exclude<PageKind, "home">, string[]> = {
  pricing: ["/pricing", "/plans"],
  customers: ["/customers", "/wall-of-love", "/testimonials"],
  alternatives: ["/alternatives", "/compare", "/vs"],
  casestudies: ["/case-studies", "/stories"],
  usecases: ["/use-cases", "/solutions"],
  about: ["/about", "/about-us"],
};

const LINK_HINTS: Record<Exclude<PageKind, "home">, RegExp> = {
  pricing: /pricing|plans/i,
  customers: /customers|wall-of-love|testimonial|reviews/i,
  alternatives: /alternative|\/vs\b|\/vs-|compare|comparison|versus/i,
  casestudies: /case-stud|stories|success/i,
  usecases: /use-cases?|usecase|solutions|\/for-/i,
  about: /\/about/i,
};

/** Pulls the page text out of a run result, whatever the provider called the field. */
export function markdownOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  for (const k of ["markdown", "content", "text", "body"]) if (typeof o[k] === "string" && (o[k] as string).length > 0) return o[k] as string;
  if (o.fields && typeof o.fields === "object") {
    const f = markdownOf(o.fields);
    if (f) return f;
  }
  for (const k of ["data", "result", "page"]) {
    const inner = markdownOf(o[k]);
    if (inner) return inner;
  }
  return "";
}

/** Every markdown link [text](href) on a page, made absolute. */
export function linksOf(md: string, base: string): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  for (const m of md.matchAll(/\[([^\]]{0,200})\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    try {
      out.push({ text: m[1].trim(), href: new URL(m[2], base).toString() });
    } catch {
      // Not a URL.
    }
  }
  return out;
}

function hostOf(href: string): string | null {
  try {
    return cleanDomain(new URL(href).hostname);
  } catch {
    return null;
  }
}

/** Picks the pricing, customers and alternatives URLs from the home page links, or the usual paths. */
export function pickUrls(domain: string, homeMd: string): Record<Exclude<PageKind, "home">, string> {
  const base = `https://${domain}/`;
  const own = linksOf(homeMd, base).filter((l) => {
    const h = hostOf(l.href);
    return h === domain || h?.endsWith(`.${domain}`);
  });
  const pick = (kind: Exclude<PageKind, "home">) => {
    const hit = own.find((l) => LINK_HINTS[kind].test(new URL(l.href).pathname) || LINK_HINTS[kind].test(l.text));
    return hit ? hit.href.split("#")[0] : new URL(DEFAULT_PATHS[kind][0], base).toString();
  };
  return { pricing: pick("pricing"), customers: pick("customers"), alternatives: pick("alternatives"), casestudies: pick("casestudies"), usecases: pick("usecases"), about: pick("about") };
}

const NOT_COMPANIES = /(^|\.)(facebook|twitter|x|linkedin|instagram|youtube|tiktok|github|google|apple|microsoft|cloudflare|gstatic|googleapis|wikipedia|medium|vimeo|w3|schema|g2|capterra|trustpilot|getapp|softwareadvice|bit|t|apps\.apple|play\.google)\.[a-z.]+$/;

/** Outside domains linked from a page, most-linked first. */
export function outsideDomains(md: string, domain: string, base: string): string[] {
  const count = new Map<string, number>();
  for (const l of linksOf(md, base)) {
    const h = hostOf(l.href);
    if (!h || h === domain || h.endsWith(`.${domain}`) || NOT_COMPANIES.test(h)) continue;
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/**
 * The domain a competitor name points to. Looks for the name written as a domain in the page text
 * ("apollo.io") or linked as a host, before falling back to <name>.com. Returns guessed when it fell back.
 */
export function resolveCompetitor(name: string, text: string, base: string): { domain: string; guessed: boolean } {
  if (name.includes(".")) return { domain: name, guessed: false };
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = new Map<string, number>();
  for (const m of text.matchAll(new RegExp(`(?<![a-z0-9.-])${esc}\\.(com|io|ai|co|app|so|dev|net|org|tech)(?![a-z0-9-])`, "gi"))) {
    const d = `${name}.${m[1].toLowerCase()}`;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  for (const l of linksOf(text, base)) {
    const h = hostOf(l.href);
    if (h && h.split(".")[0] === name && h.split(".").length === 2) count.set(h, (count.get(h) ?? 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { domain: best[0], guessed: false } : { domain: `${name}.com`, guessed: true };
}

/** Competitor names from "X alternative", "vs X", "/vs/x". With context, names resolve to the domain the site text uses. */
export function competitorsFrom(md: string, domain: string, base: string, context?: string, guessedOut?: string[]): string[] {
  const own = domain.split(".")[0];
  const found: string[] = [];
  const add = (name: string) => {
    const n = name.toLowerCase().replace(/[^a-z0-9.-]/g, "");
    if (!n || n === own || n.length < 3 || found.includes(n)) return;
    found.push(n);
  };
  for (const l of linksOf(md, base)) {
    const path = (() => {
      try {
        return new URL(l.href).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const m = path.match(/(?:\/vs[/-]|-vs-|\/alternatives?[/-]|\/compare[/-])([a-z0-9-]+)/);
    if (m) add(m[1].replace(/-(alternative|crm|vs).*$/, "").split("-vs-")[0]);
  }
  for (const m of md.matchAll(/\b(?:vs\.?|versus|alternative to)\s+([A-Z][A-Za-z0-9]+)/g)) add(m[1]);
  for (const m of md.matchAll(/\b([A-Z][A-Za-z0-9]+)\s+alternatives?\b/g)) add(m[1]);
  return found.map((n) => {
    const r = resolveCompetitor(n, context ?? md, base);
    if (r.guessed) guessedOut?.push(r.domain);
    return r.domain;
  });
}

const STOP = new Set("a an and are as at be by for from has have in is it its of on or our that the this to was we were will with you your can all more get one new use how what why who not no do does just than then them they their these those into out up so if about also any each per most very".split(" "));

/** The most frequent two-word phrases, a rough keyword list to edit. */
export function keywordsFrom(text: string, brand: string, n = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const counts = new Map<string, number>();
  const b = brand.toLowerCase();
  for (let i = 0; i < words.length - 1; i++) {
    const [x, y] = [words[i], words[i + 1]];
    if (STOP.has(x) || STOP.has(y) || x === b || y === b) continue;
    const k = `${x} ${y}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

const INDUSTRIES = ["software", "saas", "agencies", "ecommerce", "e-commerce", "retail", "real estate", "healthcare", "finance", "fintech", "insurance", "manufacturing", "logistics", "education", "consulting", "construction", "hospitality", "nonprofit", "legal", "marketing", "recruiting", "media", "telecom", "automotive", "travel"];

export function industriesFrom(text: string): string[] {
  const t = text.toLowerCase();
  return INDUSTRIES.map((i) => ({ i, c: t.split(i).length - 1 }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 5)
    .map((x) => x.i);
}

const TLD_GEO: Record<string, string> = { de: "Germany", fr: "France", nl: "Netherlands", uk: "United Kingdom", es: "Spain", it: "Italy", be: "Belgium", se: "Sweden", dk: "Denmark", pl: "Poland", pt: "Portugal", ch: "Switzerland", at: "Austria", ie: "Ireland", au: "Australia", ca: "Canada", br: "Brazil", in: "India" };

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** First heading and the first sentence after it, cut to 160 characters. */
export function offerFrom(md: string): string {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const h = lines.find((l) => /^#{1,2}\s+\S/.test(l));
  const head = h ? h.replace(/^#+\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") : "";
  const after = h ? lines.slice(lines.indexOf(h) + 1).find((l) => !l.startsWith("#") && !l.startsWith("!") && !l.startsWith("[") && l.length > 40) : undefined;
  const sentence = after ? after.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").split(/(?<=[.!?])\s/)[0] : "";
  return [head, sentence].filter(Boolean).join(". ").replace(/\.\./g, ".").slice(0, 160);
}

/** Builds the config draft from the scraped pages. Pure, so it is tested without the network. */
export function deriveConfig(domain: string, pages: IntakePage[]): { config: GtmConfig; guessed: string[] } {
  const by = (k: PageKind) => pages.find((p) => p.kind === k && p.ok)?.markdown ?? "";
  const base = `https://${domain}/`;
  const home = by("home");
  const all = pages.map((p) => p.markdown).join("\n");
  const guessed: string[] = [];
  const titleLine = home.split("\n").find((l) => l.startsWith("Title:"))?.replace("Title:", "").trim();
  const stem = domain.split(".")[0];
  const brand = titleLine?.split(/[|:\u2013\u2014]| - /).map((x) => x.trim()).find((x) => x.toLowerCase().includes(stem) && x.length <= stem.length + 12) || titleCase(stem);
  const offer = offerFrom(home) || (guessed.push("offer"), `${brand}, describe the offer in one line`);
  const comDomainGuesses: string[] = [];
  let competitors = competitorsFrom(by("alternatives"), domain, base, all, comDomainGuesses);
  if (competitors.length < 3) competitors = [...competitors, ...competitorsFrom(home, domain, base, all, comDomainGuesses)].filter((c, i, a) => a.indexOf(c) === i);
  // A plain word on a page ("Competitors", "Every") never becomes <word>.com. Only names the pages
  // write as a domain or link to stay, and the rival check in run or prepare reads each one again.
  competitors = competitors.filter((c) => !comDomainGuesses.includes(c) && !isGeneric(c));
  if (competitors.length === 0) guessed.push("competitors");
  // A customers page that is really about customers: intake may have saved another page under that name.
  const custPage = pages.find((p) => p.kind === "customers" && p.ok);
  const custText = custPage && (!custPage.url || /customer|case-stud|testimonial|success|clients|wall-of-love/i.test(custPage.url)) ? custPage.markdown : "";
  let seeds = outsideDomains(custText, domain, base).filter((d) => !competitors.includes(d) && !d.startsWith(`${stem}.`) && isSeedDomain(d));
  if (seeds.length === 0) guessed.push("seeds");
  seeds = seeds.slice(0, 5);
  // What the product is, from the title and headings ("data api"), comes first: the phrases a buyer
  // searches. Then how they search for it, then the most frequent phrases of the pages.
  const category = categoryPhrases(pages.filter((p) => p.ok), brand, domain);
  const fromCategory = category.length > 0 ? [...category, `best ${category[0]}`, `${category[0]} pricing`, `${category[0]} alternatives`] : [];
  let keywords = [...new Set([...fromCategory, ...keywordsFrom(`${home}\n${by("pricing")}`, brand)])];
  if (keywords.length < 3) guessed.push("keywords");
  keywords = keywords.slice(0, 10);
  const industries = industriesFrom(`${by("customers")}\n${home}`);
  if (industries.length === 0) guessed.push("icp.industries");
  const enterprise = /enterprise/i.test(by("pricing"));
  const tld = domain.split(".").at(-1) ?? "";
  const geos = TLD_GEO[tld] ? [TLD_GEO[tld]] : ["United States", "United Kingdom"];
  guessed.push("icp.geos", "icp.sizeBand", "icp.titles");
  const salesy = /sales|pipeline|deal|crm|revenue|prospect/i.test(all);
  const marketing = /marketing|campaign|seo|content|brand/i.test(all);
  const titles = [
    ...(salesy ? ["Head of Sales", "VP Sales", "Revenue Operations Manager"] : []),
    ...(marketing ? ["Head of Marketing", "Growth Lead"] : []),
    "Founder",
  ].slice(0, 5);
  const compNames = competitors.slice(0, 3).map((c) => titleCase(c.split(".")[0]));
  const kw = keywords.length > 0 ? keywords : ["your category"];
  const questions = [
    ...(category.length > 0 ? category.slice(0, 3).map((c) => `what is the best ${c}`) : kw.slice(0, 6).map((k) => `what is the best ${k} tool`)),
    ...(category.length > 0 ? [`which ${category[0]} should I use`] : []),
    ...compNames.map((c) => `best ${c} alternatives`),
    `${brand} alternatives`,
    `is ${brand} worth it`,
  ].slice(0, 10);
  // Auto fields. Reviews, local and commerce run only when the pages give a reason to.
  const appStoreIds = appStoreIdsIn(all).slice(0, 3);
  const isLocal = looksLocal(all);
  if (isLocal) guessed.push("local.queries");
  const asins = asinsIn(all).slice(0, 10);
  const isStore = looksLikeStore(all) || asins.length > 0;
  const rivals = competitors.slice(0, 3);
  const config = normalizeConfig({
    domain,
    brand,
    offer,
    category,
    icp: { industries, sizeBand: enterprise ? "51-1000" : "11-200", geos, titles },
    seeds,
    competitors: rivals,
    keywords,
    questions,
    depth: "sample",
    reviews: {
      mode: "auto",
      appStoreIds,
      mapsPlaces: [],
      competitors: Object.fromEntries(rivals.map((c) => [c, { appStoreIds: [], mapsPlaces: [] }])),
    },
    local: { mode: isLocal ? "on" : "auto", queries: isLocal ? [`${brand} @ ${geos[0]}`] : [] },
    discovery: { by: "draft", at: new Date().toISOString().slice(0, 10) },
    commerce: {
      mode: isStore ? "on" : "off",
      asins,
      competitors: isStore ? Object.fromEntries(rivals.map((c) => [c, []])) : {},
    },
  });
  return { config, guessed };
}

export const intake: GtmModule = {
  id: "intake",
  label: "Intake",
  needs: [],
  quote: () => ({ lines: [{ job: "web.scrape.markdown", calls: PAGE_KINDS.length }] }),
  async run(ctx: ModuleContext) {
    const domain = ctx.cfg.domain;
    const pages: IntakePage[] = [];
    const scrape = async (kind: PageKind, url: string) => {
      const res = await ctx.call("web.scrape.markdown", { url }, `page:${kind}`);
      const md = res.record.outcome === "hit" || res.record.outcome === "fallback" ? markdownOf(res.data) : "";
      const page: IntakePage = { kind, url, ok: md.length > 200, chars: md.length, markdown: md };
      pages.push(page);
      ctx.partial({ pages, config: ctx.cfg, guessed: [] });
      return page;
    };
    const home = await scrape("home", `https://${domain}/`);
    const urls = pickUrls(domain, home.markdown);
    await Promise.all((Object.keys(urls) as Exclude<PageKind, "home">[]).map((k) => scrape(k, urls[k])));
    pages.sort((a, b) => PAGE_KINDS.indexOf(a.kind) - PAGE_KINDS.indexOf(b.kind));
    const { config, guessed } = deriveConfig(domain, pages);
    const read = pages.filter((p) => p.ok).length;
    return { status: "done", summary: `${read} of ${pages.length} pages read, config draft written`, out: { pages, config, guessed } satisfies IntakeOut };
  },
  render: () => null,
};

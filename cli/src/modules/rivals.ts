// The rivals and target step. Runs before the main run (and on its own as `looot-zeus prepare`).
// Rule based, no model. Every paid call is quoted first and goes through the cap.
//
// 1. Target. Who your own pages say the product is for (roles, size words, industries, named
//    customers, use cases) and the category words that say what it is. Read from gtm/intake/, free.
// 2. Rival candidates. Your site ("vs", "alternative to", comparison links), Google results for
//    "<domain> alternatives", "<brand> vs", "best <category>" and "<category> alternatives"
//    (google.serp.organic), the products the top "best <category>" lists link to, and
//    company.similar on your domain. The category is a phrase from your title and headings
//    ("data api"), or `category` in the brief. A word is never taken as a domain.
// 3. Rival check. Each candidate's home page is read (web.scrape.markdown). It stays only when it is
//    a real product page that says your category phrase, shares enough of your category words, and is not a directory, a
//    marketplace, a media site or a big platform. Top 3 to 5 kept, each with its reason.
// 4. Profiles. company.enrich on you and each rival (name, logo, social pages), then the social links
//    on each site's own footer, which win over provider data.
// 5. Customers. The customer and case study pages of the rivals give customer domains (seeds), and
//    "<rival> review" results give reviewer roles. Named customers go to the brief for the agent.
//
// With a brief that already names rivals (an agent or the user picked them), only steps 4 and 5 run.
// commands.ts writes gtm/candidates.json from this output, so an agent can review every choice.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GtmConfig, Profile, Target } from "../config.js";
import { normalizeConfig } from "../config.js";
import { cleanDomain } from "../util.js";
import { answered, companyObject, isObj, normalizeCompany, payloads, rowsOf } from "./icp.js";
import { markdownOf } from "./intake.js";
import { domainOf, list, str } from "./modc-helpers.js";
import { categoryPhrases, categoryTerms, extractTarget, saysPhrase, linkedDomains, overlap, relevantKeyword, roleLabels, sizeBandFrom, socialLinks, titlesFrom, type SitePage } from "./target.js";
import type { GtmModule, ModuleContext } from "./types.js";

export const RIVALS_WANTED = 3;
export const RIVALS_MAX = 5;
export const SEEDS_WANTED = 5;
export const RIVALS_ROWS = 10;
/** Candidate home pages read to check them. */
export const CHECK_MAX = 16;
/** Names seen next to "vs" in Google results that are tried as <name>.com, .ai and .io, each still checked. */
export const NAMES_TRIED = 5;
/** Share of your category words a rival home page must have. */
export const OVERLAP_MIN = 0.45;
const SERP_QUERIES = 5;
/** "Best <category>" listicles read for the products they link to. */
const LISTICLE_PAGES = 2;
const REVIEW_QUERIES = 3;
const CUSTOMER_PAGES = 3;

/** Modules that read cfg.competitors, and the ones that read cfg.seeds. */
const USES_RIVALS = new Set(["competitors", "ads", "seo", "mentions", "market", "reviews", "commerce", "social", "readiness", "domains"]);
const USES_SEEDS = new Set(["icp"]);

/**
 * Never a rival: big platforms, directories, review and listicle sites, media, marketplaces and
 * words that came out of page text ("competitors.com").
 */
const GENERIC = new Set(
  (
    "competitors.com competitor.com alternatives.com alternative.com example.com yourdomain.com vs.com compare.com " +
    "google.com youtube.com facebook.com instagram.com linkedin.com twitter.com x.com tiktok.com reddit.com quora.com pinterest.com wikipedia.org medium.com substack.com " +
    "apple.com microsoft.com amazon.com aws.amazon.com meta.com openai.com chatgpt.com anthropic.com claude.ai gemini.google.com bing.com yahoo.com " +
    "g2.com capterra.com getapp.com softwareadvice.com trustradius.com trustpilot.com producthunt.com alternativeto.net saasworthy.com sourceforge.net slashdot.org " +
    "crunchbase.com similarweb.com builtwith.com zoominfo.com apollo.io owler.com cbinsights.com glassdoor.com indeed.com " +
    "futurepedia.io theresanaiforthat.com toolify.ai aitoolsdirectory.com topai.tools insidr.ai saasgenius.com saashub.com stackshare.io " +
    "forbes.com techcrunch.com businessinsider.com hubspot.com blog.hubspot.com zapier.com notion.so canva.com github.com gitlab.com " +
    "wordpress.com wix.com squarespace.com shopify.com webflow.com bit.ly t.co lnkd.in apps.apple.com play.google.com chrome.google.com"
  ).split(/\s+/),
);

/** A domain that can never be a rival. */
export function isGeneric(domain: string): boolean {
  const d = cleanDomain(domain);
  if (GENERIC.has(d)) return true;
  // subdomains of the big ones (blog.hubspot.com, support.google.com)
  for (const g of ["google.com", "microsoft.com", "amazon.com", "apple.com", "facebook.com", "linkedin.com", "medium.com", "substack.com", "wordpress.com", "hubspot.com", "notion.site", "github.io"]) if (d.endsWith(`.${g}`)) return true;
  // Image hosts, CDNs and site builders' asset domains are never a company.
  if (/(^|[.-])(cdn|static|assets?|img|images|media|files|usercontent|cloudfront|akamai|fastly|imgix|cloudinary|gravatar|wp|s3)([.-]|$)/.test(d) || /usercontent|cloudfront|amazonaws|googleapis|gstatic|framer\.(website|app)|webflow\.io|wixstatic|squarespace-cdn|hubspotusercontent|ctfassets|sanity\.io|prismic\.io|vercel\.app|netlify\.app|calendly\.com|typeform\.com|youtu\.be|loom\.com|stripe\.com|intercom|crisp\.chat|zendesk/.test(d)) return true;
  return /\.(gov|mil|edu)(\.[a-z]{2})?$/.test(d);
}

/** Review and list sites whose "best X" and "X alternatives" pages name the products of a category. */
const LIST_SITES = new Set("g2.com capterra.com getapp.com softwareadvice.com trustradius.com alternativeto.net saashub.com saasworthy.com sourceforge.net producthunt.com stackshare.io".split(" "));

/** A page worth reading for the products it lists: a review or list site, or any non-generic site's own list post. */
export function isListSource(domain: string): boolean {
  const d = cleanDomain(domain);
  return LIST_SITES.has(d) || !isGeneric(d);
}

/** App hosts whose subdomains are someone's project, never a customer company. */
const APP_HOSTS = /\.(supabase\.(co|in)|firebaseapp\.com|web\.app|herokuapp\.com|pages\.dev|workers\.dev|onrender\.com|fly\.dev|railway\.app|azurewebsites\.net|appspot\.com|repl\.co|glitch\.me|ngrok\.io|ngrok-free\.app|myshopify\.com|bubbleapps\.io|lovable\.app|replit\.app)$/;

/** A domain that can be a seed customer: a company's own site, not a platform, an app host or a random project id. */
export function isSeedDomain(domain: string): boolean {
  const d = cleanDomain(domain);
  if (!d.includes(".") || isGeneric(d) || APP_HOSTS.test(d)) return false;
  const label = d.split(".")[0];
  // qwtacnykulkgtsveodvs.supabase.co: a long label with almost no vowels is a generated id.
  if (label.length >= 14 && (label.match(/[aeiou]/g) ?? []).length / label.length < 0.25) return false;
  return true;
}

export interface Need {
  competitors: boolean;
  seeds: boolean;
  /** Logo and social pages missing for you or a rival. */
  profiles: boolean;
}

export interface RivalCandidate {
  domain: string;
  name: string;
  /** Where it was found: "your compare page", "Google: acmeposts alternatives", "company.similar". */
  sources: string[];
  /** Share of your category words on its home page, 0 to 1. null when the page was not read. */
  overlap: number | null;
  shared: string[];
  /** Times its name was seen next to "vs" or "alternatives" in Google results. */
  named?: number;
  product: boolean;
  kept: boolean;
  reason: string;
}

export interface ReviewSnippet {
  about: string;
  title: string;
  snippet: string;
  url: string;
}

export interface RivalsOut {
  summary: string;
  competitors: string[];
  seeds: string[];
  provider: string;
  /** What the brief had before. Only the empty lists are filled. */
  filled: Need;
  /** The full candidate list, kept and turned down, with reasons. */
  candidates?: RivalCandidate[];
  reasons?: Record<string, string>;
  excluded?: string[];
  categoryTerms?: string[];
  /** The category phrases the search and the match used ("data api"). */
  category?: string[];
  target?: Target;
  profiles?: Record<string, Profile>;
  /** Customer domains and names found on rivals' customer pages. */
  rivalCustomers?: { rival: string; url: string; domains: string[] }[];
  reviews?: ReviewSnippet[];
  /** Names seen next to "vs" or "alternatives" in Google results that did not resolve to a domain. */
  unresolved?: string[];
}

const emptyProfile = (): Profile => ({ name: "", logo: "", linkedin: "", linkedinId: "", x: "", facebook: "" });
const profileDone = (p: Profile | undefined) => !!p && !!p.logo && (!!p.linkedin || !!p.x);

/** What the step would fill for this brief and these modules. */
export function rivalsNeeded(cfg: Pick<GtmConfig, "competitors" | "seeds" | "domain"> & Partial<Pick<GtmConfig, "profiles" | "discovery">>, moduleIds: string[]): Need {
  // A first draft from the site is not checked yet, so its rivals go through the check like any candidate.
  const competitors = (cfg.competitors.length === 0 || cfg.discovery?.by === "draft") && moduleIds.some((id) => USES_RIVALS.has(id));
  const seeds = cfg.seeds.length === 0 && moduleIds.some((id) => USES_SEEDS.has(id));
  const profiles = moduleIds.some((id) => USES_RIVALS.has(id)) && [cfg.domain, ...cfg.competitors].some((d) => !profileDone(cfg.profiles?.[d]));
  return { competitors, seeds, profiles };
}

export const needsAny = (n: Need) => n.competitors || n.seeds || n.profiles;

/**
 * The brief the quote is priced on when the step runs: 3 stand-in rivals and 3 stand-in seeds,
 * so the price covers the modules that will run on them. Never written to disk.
 */
export function assumeRivals(cfg: GtmConfig, need: Pick<Need, "competitors" | "seeds">): GtmConfig {
  return {
    ...cfg,
    competitors: need.competitors ? Array.from({ length: RIVALS_WANTED }, (_, i) => `rival-${i + 1}.example`) : cfg.competitors,
    seeds: need.seeds ? Array.from({ length: SEEDS_WANTED }, (_, i) => `seed-${i + 1}.example`) : cfg.seeds,
  };
}

/** Splits similar companies into rivals and seeds, the old fallback. Your own domain and known names are left out. */
export function pickRivals(domains: string[], cfg: Pick<GtmConfig, "domain" | "competitors" | "seeds">, need: Pick<Need, "competitors" | "seeds">): { competitors: string[]; seeds: string[] } {
  const known = new Set([cfg.domain, ...cfg.competitors, ...cfg.seeds]);
  const fresh = [...new Set(domains)].filter((d) => d && !known.has(d) && !d.endsWith(`.${cfg.domain}`) && !isGeneric(d));
  const competitors = need.competitors ? fresh.slice(0, RIVALS_WANTED) : cfg.competitors;
  const rest = fresh.filter((d) => !competitors.includes(d));
  const seeds = need.seeds ? rest.slice(0, SEEDS_WANTED) : cfg.seeds;
  return { competitors, seeds };
}

/** The brief with what the step found. Fields the user or agent already set are kept. */
export function applyRivals(cfg: GtmConfig, out: Pick<RivalsOut, "competitors" | "seeds"> & Partial<RivalsOut>): GtmConfig {
  const agent = cfg.discovery?.by === "agent" || cfg.discovery?.by === "";
  const t = out.target;
  const profiles: Record<string, Profile> = { ...(cfg.profiles ?? {}) };
  for (const [d, p] of Object.entries(out.profiles ?? {})) {
    const cur = profiles[d] ?? emptyProfile();
    profiles[d] = { name: cur.name || p.name, logo: cur.logo || p.logo, linkedin: cur.linkedin || p.linkedin, linkedinId: cur.linkedinId || p.linkedinId, x: cur.x || p.x, facebook: cur.facebook || p.facebook };
  }
  const roles = t ? roleLabels(t) : [];
  const icp = !agent && t && t.roles.length > 0
    ? { ...cfg.icp, industries: t.industries.length > 0 ? t.industries : cfg.icp.industries, sizeBand: sizeBandFrom(t.sizes, cfg.icp.sizeBand), titles: titlesFrom(roles, cfg.icp.titles) }
    : cfg.icp;
  // Rules only: keep the keywords that are about the category, when at least three are.
  const terms = cfg.categoryTerms?.length ? cfg.categoryTerms : out.categoryTerms ?? [];
  const onTopic = cfg.keywords.filter((k) => relevantKeyword(k, terms));
  const keywords = !agent && onTopic.length >= 3 ? onTopic : cfg.keywords;
  const hadTarget = (cfg.target?.roles?.length ?? 0) > 0 || (cfg.target?.customers?.length ?? 0) > 0;
  const n = normalizeConfig({
    ...cfg,
    competitors: out.competitors,
    seeds: out.seeds,
    icp,
    keywords,
    categoryTerms: terms,
    category: cfg.category?.length ? cfg.category : out.category ?? [],
    rivalReasons: { ...(out.reasons ?? {}), ...(cfg.rivalReasons ?? {}) },
    excluded: [...new Set([...(cfg.excluded ?? []), ...(out.excluded ?? [])])].filter((d) => !out.competitors.includes(d)),
    profiles,
    target: hadTarget ? cfg.target : t ?? cfg.target,
    discovery: cfg.discovery?.by && cfg.discovery.by !== "draft" ? cfg.discovery : { by: "rules", at: new Date().toISOString().slice(0, 10) },
  });
  for (const c of n.competitors) n.reviews.competitors[c] ??= { appStoreIds: [], mapsPlaces: [] };
  if (n.commerce.mode === "on") for (const c of n.competitors) n.commerce.competitors[c] ??= [];
  // Run-only fields (learned weights, more hints) are not part of the brief, they ride along unchanged.
  const extra = cfg as GtmConfig & { learned?: unknown; more?: unknown };
  return { ...n, ...(extra.learned ? { learned: extra.learned } : {}), ...(extra.more ? { more: extra.more } : {}) } as GtmConfig;
}

/** The pages intake saved under gtm/intake/, as kind, url and text. */
export function readIntake(outDir: string): SitePage[] {
  const dir = join(outDir, "intake");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(dir, f), "utf8");
      const url = raw.match(/^<!-- (\S+) -->/)?.[1] ?? "";
      return { kind: f.replace(/\.md$/, ""), url, markdown: raw.replace(/^<!-- \S+ -->\n?/, "") };
    });
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (d: string) => titleCase(d.split(".")[0]);

/** Rival names next to "vs" or "alternatives" in a line of text. */
export function namesNearVs(text: string, brand: string): string[] {
  const out: string[] = [];
  const own = brand.toLowerCase();
  const add = (n: string) => {
    const x = n.trim();
    if (x.length < 3 || x.toLowerCase() === own || /^(the|best|top|free|and|or|for|with|alternatives?|vs|which|what|why|how|review|reviews|pricing|tools?|apps?|software|competitors?|comparison|compare|other|more|ai|creator|creators|linkedin|chatgpt|google|reddit|youtube|twitter|this|that|these|new|our|your|my)$/i.test(x)) return;
    if (!out.includes(x)) out.push(x);
  };
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\.[a-z]{2,4})?)\s+(?:vs\.?|versus)\s+([A-Z][A-Za-z0-9]+(?:\.[a-z]{2,4})?)/g)) {
    add(m[1]);
    add(m[2]);
  }
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\.[a-z]{2,4})?)\s+alternatives?\b/g)) add(m[1]);
  return out;
}

/** Candidate rival domains from your own pages: comparison links and names that the page writes as a domain. */
export function siteCandidates(pages: SitePage[], domain: string, brand: string): string[] {
  const out: string[] = [];
  const text = pages.map((p) => p.markdown).join("\n");
  const add = (d: string) => {
    const c = cleanDomain(d);
    if (!c.includes(".") || c === domain || c.endsWith(`.${domain}`) || isGeneric(c) || out.includes(c)) return;
    out.push(c);
  };
  // /vs/taplio, /compare/taplio-vs-x, /alternatives/taplio on your own site: the slug names a rival.
  const slugs: string[] = [];
  for (const m of text.matchAll(/\]\((?:https?:\/\/[^)\s]*?)?\/(?:vs|compare|alternatives?)[/-]([a-z0-9-]{3,40})/gi)) slugs.push(...m[1].toLowerCase().split(/-vs-|-alternative.*$/)[0].split("-vs-"));
  for (const n of [...slugs, ...namesNearVs(text, brand).map((x) => x.toLowerCase())]) {
    const stem = n.replace(/\.[a-z]{2,4}$/, "").replace(/[^a-z0-9]/g, "");
    if (!stem || stem === domain.split(".")[0]) continue;
    // Only a name the pages write as a domain or link to counts. A plain word never becomes <word>.com.
    const written = text.match(new RegExp(`(?<![a-z0-9.-])${stem}\\.(com|io|ai|co|app|so|dev|net|org|tech|xyz)(?![a-z0-9-])`, "i"));
    if (written) add(written[0]);
    for (const l of linkedDomains(text, domain)) if (l.split(".")[0] === stem) add(l);
  }
  // Outside links on a comparison page are rivals more often than not.
  for (const p of pages.filter((x) => x.kind === "alternatives")) for (const l of linkedDomains(p.markdown, domain).slice(0, 8)) add(l);
  return out;
}

/** A page that sells a product: pricing, a sign up or a trial. Listicles and directories are not. */
export function looksLikeProduct(md: string): boolean {
  const title = (md.match(/^Title:\s*(.+)$/m)?.[1] ?? md.split("\n").find((l) => /^#\s/.test(l)) ?? "").toLowerCase();
  if (/\b(best|top)\s+\d+\b|\b\d+\s+best\b|\balternatives to\b|\bdirectory\b|\blist of\b/.test(title)) return false;
  return /pricing|sign ?up|get started|start (for )?free|free trial|try (it )?(for )?free|book a demo|request a demo|start now|create (an |your )?account/i.test(md);
}

/** The logo URL in a company.enrich answer, when there is one. */
export function logoOf(row: unknown): string {
  if (!isObj(row)) return "";
  const assets = isObj(row.assets) ? row.assets : {};
  const sq = isObj(assets.logoSquare) ? assets.logoSquare : {};
  return str(sq.src, row.logo, row.logo_url, row.logoUrl, isObj(row.image) ? row.image.src : row.image) ?? "";
}

/** LinkedIn page, LinkedIn id, X handle and Facebook page in a company.enrich answer. */
export function socialsOf(row: unknown): Pick<Profile, "linkedin" | "linkedinId" | "x" | "facebook"> {
  const out = { linkedin: "", linkedinId: "", x: "", facebook: "" };
  if (!isObj(row)) return out;
  const soc = isObj(row.socials) ? row.socials : row;
  const li = isObj(soc.linkedin) ? soc.linkedin : {};
  const tw = isObj(soc.twitter) ? soc.twitter : {};
  const fb = isObj(soc.facebook) ? soc.facebook : {};
  const liUrl = str(li.url, li.handle ? `https://www.linkedin.com/${String(li.handle).replace(/^\/+/, "")}` : null, row.linkedin_url, row.linkedinUrl) ?? "";
  out.linkedin = /linkedin\.com\/company\//.test(liUrl) ? liUrl : "";
  out.linkedinId = str(li.idNumeric, li.id && /^\d+$/.test(String(li.id)) ? li.id : null) ?? "";
  out.x = (str(tw.handle, tw.id, row.twitter_handle) ?? "").replace(/^@/, "");
  if (/^\d+$/.test(out.x)) out.x = "";
  out.facebook = str(fb.handle, fb.id) ?? "";
  return out;
}

/** SERP rows (title, link, snippet) in a google.serp.organic answer. */
export function serpRows(data: unknown): { title: string; link: string; snippet: string }[] {
  return list(data, ["results", "organic", "organic_results", "items"]).map((r) => ({ title: str(r.title) ?? "", link: str(r.link, r.url) ?? "", snippet: str(r.snippet, r.description) ?? "" })).filter((r) => r.link);
}

/** A short phrase for the category, the two most used category words. */
export function categoryPhrase(terms: string[]): string {
  return terms.slice(0, 2).join(" ");
}

export function rivalsModule(need: Need): GtmModule {
  const full = need.competitors;
  return {
    id: "rivals",
    label: "Rivals and target",
    needs: [],
    quote: (cfg) => {
      const rivals = full ? RIVALS_WANTED : cfg.competitors.length;
      const lines = [];
      if (full) {
        lines.push({ job: "google.serp.organic", calls: SERP_QUERIES + REVIEW_QUERIES, note: `"${cfg.domain} alternatives", "${cfg.brand} vs", "best <your category>", "<your category> alternatives" and reviews of the top rivals` });
        lines.push({ job: "company.similar", calls: 1, rows: RIVALS_ROWS, note: "companies like your domain" });
        lines.push({ job: "web.scrape.markdown", calls: CHECK_MAX + CUSTOMER_PAGES + LISTICLE_PAGES, note: "reads 2 \"best <your category>\" lists, each rival candidate's home page to check it, then rivals' customer pages" });
      } else {
        lines.push({ job: "web.scrape.markdown", calls: rivals + (need.seeds ? Math.min(CUSTOMER_PAGES, rivals) : 0), note: "each rival's home page for its social links, then customer pages" });
      }
      lines.push({ job: "company.enrich", calls: 1 + rivals, note: "logo and social pages for you and each rival" });
      return { lines };
    },
    async run(ctx: ModuleContext) {
      const cfg = ctx.cfg;
      const pages = readIntake(ctx.outDir);
      const ownText = pages.map((p) => p.markdown).join("\n");
      // Category words from the brief, else your pages, else the offer and keywords in the brief.
      let terms = cfg.categoryTerms.length > 0 ? cfg.categoryTerms : categoryTerms(ownText, cfg.brand, cfg.domain);
      if (terms.length < 3) terms = categoryTerms(`${cfg.offer} ${cfg.keywords.join(" ")}\n`.repeat(2), cfg.brand, cfg.domain);
      const target = extractTarget(pages, cfg.brand);
      // What the product is, as phrases: from the brief, else the site's title and headings.
      const category = cfg.category?.length ? cfg.category : categoryPhrases(pages, cfg.brand, cfg.domain);
      const providers = new Set<string>();
      const seen = (p: string) => p && providers.add(p);
      const homes = new Map<string, string>();
      const cands = new Map<string, RivalCandidate>();
      const unresolved: string[] = [];
      const reviews: ReviewSnippet[] = [];
      const add = (d: string, source: string, name?: string) => {
        const c = cleanDomain(d);
        if (!c.includes(".") || c === cfg.domain || c.endsWith(`.${cfg.domain}`) || isGeneric(c) || cfg.excluded.includes(c)) return;
        const cur = cands.get(c) ?? { domain: c, name: name ?? nameOf(c), sources: [], overlap: null, shared: [], product: false, kept: false, reason: "" };
        if (!cur.sources.includes(source)) cur.sources.push(source);
        cands.set(c, cur);
      };
      const scrape = async (url: string, step: string) => {
        const res = await ctx.call("web.scrape.markdown", { url }, step);
        seen(res.record.provider);
        return answered(res) ? markdownOf(res.data) : "";
      };

      let competitors = cfg.competitors;
      const excluded: string[] = [];
      const reasons: Record<string, string> = {};
      if (full) {
        for (const d of siteCandidates(pages, cfg.domain, cfg.brand)) add(d, "your own site");
        for (const d of cfg.competitors) add(d, "the brief");
        // The domain is searched, not only the brand: a short brand ("looot") alone finds board games.
        const cat = category[0] ?? categoryPhrase(terms);
        const queries = [`${cfg.domain} alternatives`, `${cfg.brand} vs`, `best ${cat}`, `${cat} alternatives`, ...(category[1] ? [`best ${category[1]}`] : [`${cat} platform`])].slice(0, SERP_QUERIES);
        const listicles: string[] = [];
        const vsNames = new Map<string, number>();
        for (const q of queries) {
          const res = await ctx.call("google.serp.organic", { query: q }, `rivals-serp:${q}`);
          seen(res.record.provider);
          if (!answered(res)) continue;
          for (const r of serpRows(res.data)) {
            const h = domainOf(r.link);
            // A "best X" or "X alternatives" list names the products of the category: read it, it is not a rival.
            if (h && isListSource(h) && /\b(best|top \d+|\d+ best|alternatives|competitors|vs\.?)\b/i.test(r.title) && /^(best|.* alternatives)/.test(q) && !listicles.includes(r.link)) listicles.push(r.link);
            if (h) add(h, `Google search "${q}"`);
            for (const n of namesNearVs(`${r.title}. ${r.snippet}`, cfg.brand)) vsNames.set(n, (vsNames.get(n) ?? 0) + 1);
          }
        }
        // A name next to "vs" counts for the candidate whose domain carries that name.
        for (const [n, k] of vsNames) {
          const stem = n.toLowerCase().replace(/\.[a-z]{2,4}$/, "");
          const hit = [...cands.values()].find((c) => c.domain.split(".")[0] === stem);
          if (hit) {
            const src = `named next to "vs" or "alternatives" ${k} ${k === 1 ? "time" : "times"}`;
            if (!hit.sources.includes(src)) hit.sources.push(src);
            hit.named = (hit.named ?? 0) + k;
          } else if (stem !== cfg.domain.split(".")[0]) unresolved.push(n);
        }
        // The names seen most often are tried as a domain. Each try is a candidate like any other and
        // only stays when its home page passes the check, so a wrong guess costs one page read.
        const tryNames = [...vsNames.entries()].filter(([n]) => unresolved.includes(n) && /^[A-Za-z][A-Za-z0-9]{2,20}(\.[a-z]{2,4})?$/.test(n)).sort((a, b) => b[1] - a[1]).slice(0, NAMES_TRIED);
        for (const [n, k] of tryNames) {
          const written = /\.[a-z]{2,4}$/.test(n) ? [n.toLowerCase()] : ["com", "ai", "io"].map((t) => `${n.toLowerCase()}.${t}`);
          for (const d of written) {
            add(d, `named next to "vs" or "alternatives" ${k} ${k === 1 ? "time" : "times"} in Google results, domain tried`, n);
            const c = cands.get(d);
            if (c) c.named = k;
          }
        }
        // The products the top lists link to are candidates; each still has to pass the home page check.
        for (const url of listicles.slice(0, LISTICLE_PAGES)) {
          const md = await scrape(url, `rivals-list:${url}`);
          const host = domainOf(url) ?? "";
          for (const d of linkedDomains(md, host).slice(0, 25)) if (d !== host) add(d, `listed in ${host}`);
        }
        const sim = await ctx.call("company.similar", { domain: cfg.domain, limit: RIVALS_ROWS }, `rivals:${cfg.domain}`);
        seen(sim.record.provider);
        if (answered(sim)) {
          const rows = payloads(sim).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
          for (const r of rows) {
            const c = normalizeCompany(r);
            if (c) add(c.domain, "company.similar", c.name ?? undefined);
          }
        }
        // Check the strongest candidates: more sources first, your own site first.
        const weight = (c: RivalCandidate) => c.sources.length + (c.named ?? 0) + (c.sources.includes("your own site") ? 1 : 0);
        const order = [...cands.values()].sort((a, b) => weight(b) - weight(a) || a.domain.localeCompare(b.domain));
        for (const c of order.slice(0, CHECK_MAX)) {
          const md = await scrape(`https://${c.domain}/`, `rivals-home:${c.domain}`);
          homes.set(c.domain, md);
          if (md.length < 200) {
            c.reason = "home page could not be read";
            continue;
          }
          const o = overlap(md, terms);
          c.overlap = o.score;
          c.shared = o.shared;
          c.product = looksLikeProduct(md);
          const t = md.match(/^Title:\s*(.+)$/m)?.[1];
          if (t) c.name = t.split(/[|:–—]| - /)[0].trim().slice(0, 40) || c.name;
          const phrase = saysPhrase(md, category);
          if (!c.product) c.reason = "no pricing, sign up or trial on the home page, so not a product page";
          else if (category.length > 0 && !phrase && (c.named ?? 0) < 2) {
            // Sharing common words ("agent", "data") is not a category match: the page must say what you are.
            c.reason = `never says "${category.join('" or "')}", your category, so another market`;
            c.overlap = Math.min(o.score, OVERLAP_MIN - 0.01);
          } else if (category.length === 0 && terms[0] && !o.shared.includes(terms[0])) {
            c.reason = `never says "${terms[0]}", your main category word`;
            c.overlap = Math.min(o.score, OVERLAP_MIN - 0.01);
          } else if (o.score < OVERLAP_MIN) c.reason = `shares ${o.shared.length} of ${terms.length} category words, below the bar`;
        }
        // One candidate per name: taplio.com and taplio.io are the same rival, the better page wins.
        const byStem = new Map<string, RivalCandidate>();
        for (const c of order.filter((x) => x.overlap !== null && x.product && x.overlap >= OVERLAP_MIN)) {
          const st = c.domain.split(".")[0];
          const cur = byStem.get(st);
          if (!cur || (c.overlap ?? 0) > (cur.overlap ?? 0)) byStem.set(st, c);
        }
        // Rank: how much of your category it shares, plus how often Google names it next to you or "alternatives".
        const ok = [...byStem.values()].sort((a, b) => (b.overlap ?? 0) + Math.min(5, b.named ?? 0) * 0.08 + b.sources.length * 0.03 - ((a.overlap ?? 0) + Math.min(5, a.named ?? 0) * 0.08 + a.sources.length * 0.03));
        const kept = ok.slice(0, RIVALS_MAX);
        for (const c of kept) {
          c.kept = true;
          const ph = saysPhrase(homes.get(c.domain) ?? "", category);
          c.reason = `${ph ? `Its home page says "${ph}", your category, and shares` : "Its home page shares"} ${c.shared.length} of ${terms.length} category words (${c.shared.slice(0, 5).join(", ")}). Found in ${c.sources.join("; ")}.`;
          reasons[c.domain] = c.reason;
        }
        for (const c of order) if (!c.kept) {
          if (!c.reason) c.reason = c.overlap === null ? "not checked, weaker evidence than the ones checked" : "fit, but more than 5 rivals passed";
          if (c.overlap !== null) excluded.push(c.domain);
        }
        competitors = kept.map((c) => c.domain);
      }

      // Profiles: company.enrich on you and each rival, then the footer links on each site.
      const profiles: Record<string, Profile> = {};
      const ownHome = pages.find((p) => p.kind === "home")?.markdown ?? "";
      homes.set(cfg.domain, ownHome);
      for (const d of need.profiles || full ? [cfg.domain, ...competitors] : []) {
        if (profileDone(cfg.profiles[d])) {
          profiles[d] = cfg.profiles[d];
          continue;
        }
        if (!homes.has(d)) homes.set(d, await scrape(`https://${d}/`, `rivals-home:${d}`));
        const res = await ctx.call("company.enrich", { domain: d }, `rivals-enrich:${d}`);
        seen(res.record.provider);
        const p = emptyProfile();
        if (answered(res)) {
          for (const pl of payloads(res)) {
            const o = companyObject(pl);
            if (!o) continue;
            p.name ||= (str(o.name, isObj(o.about) ? o.about.name : null) ?? "");
            p.logo ||= logoOf(o);
            const s = socialsOf(o);
            p.linkedin ||= s.linkedin;
            p.linkedinId ||= s.linkedinId;
            p.x ||= s.x;
            p.facebook ||= s.facebook;
          }
        }
        // The site's own footer wins over provider data: providers often guess the slug.
        const name = d === cfg.domain ? cfg.brand : p.name || cands.get(d)?.name || nameOf(d);
        const own = socialLinks(homes.get(d) ?? "", name, d);
        profiles[d] = { name, logo: p.logo, linkedin: own.linkedin || p.linkedin, linkedinId: own.linkedin && own.linkedin !== p.linkedin ? "" : p.linkedinId, x: own.x || p.x, facebook: own.facebook || p.facebook };
      }

      // Customers of the rivals: their customer or case study pages give customer domains.
      const rivalCustomers: { rival: string; url: string; domains: string[] }[] = [];
      let seeds = cfg.seeds;
      if (need.seeds) {
        // Only a page that really is about customers: intake may have saved another page under that name.
        const isCustomerPage = (p: SitePage) => (p.kind === "customers" || p.kind === "casestudies") && (!p.url || /customer|case-stud|testimonial|success|wall-of-love|clients/i.test(p.url));
        const ownCustomers = pages.filter(isCustomerPage).flatMap((p) => linkedDomains(p.markdown, cfg.domain));
        const pool: string[] = [...ownCustomers];
        for (const r of competitors.slice(0, CUSTOMER_PAGES)) {
          const home = homes.get(r) ?? "";
          const link = [...home.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g)].map((m) => m[1]).find((h) => /customers|case-stud|testimonial|wall-of-love|success-stor|reviews/i.test(h) && !/\.(png|jpe?g|gif|webp|svg|avif|mp4|pdf)(\?|$)/i.test(h));
          const url = link ? new URL(link, `https://${r}/`).toString() : `https://${r}/customers`;
          const md = await scrape(url, `rivals-customers:${r}`);
          const domains = linkedDomains(md, r).filter((d) => isSeedDomain(d) && !competitors.includes(d) && d !== cfg.domain).slice(0, 15);
          rivalCustomers.push({ rival: r, url, domains });
          pool.push(...domains);
        }
        seeds = [...new Set(pool)].filter((d) => isSeedDomain(d) && !competitors.includes(d) && d !== cfg.domain && !excluded.includes(d)).slice(0, SEEDS_WANTED);
      }

      // Reviews: what reviewers of you and the top rivals say, from Google snippets.
      if (full) {
        const about = [cfg.brand, ...competitors.slice(0, REVIEW_QUERIES - 1).map((d) => profiles[d]?.name || nameOf(d))];
        for (const a of about) {
          const res = await ctx.call("google.serp.organic", { query: `${a} review` }, `rivals-review:${a}`);
          seen(res.record.provider);
          if (!answered(res)) continue;
          // Only results that name it as a word: "ViralRobot review" is not about AcmePosts.
          const re = new RegExp(`(^|[^a-z0-9])${a.toLowerCase().replace(/[^a-z0-9]/g, "")}($|[^a-z0-9])`, "i");
          for (const r of serpRows(res.data).filter((x) => re.test(`${x.title} ${x.snippet}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") ) || re.test(x.link)).slice(0, 6)) reviews.push({ about: a, title: r.title, snippet: r.snippet, url: r.link });
        }
        const more = extractTarget([{ kind: "reviews", url: "", markdown: reviews.map((r) => `${r.title}. ${r.snippet}`).join("\n") }], cfg.brand);
        for (const r of more.roles) if (!target.roles.some((x) => x.startsWith(r.replace(/\s*\(.*$/, "")))) target.roles.push(`${r.replace(/\s*\(.*$/, "")} (in reviews)`);
      }

      const found = full ? `${competitors.length} rivals checked and kept of ${cands.size} candidates` : `profiles for you and ${competitors.length} rivals`;
      const out: RivalsOut = {
        summary: full && competitors.length === 0 ? `no candidate passed the rival check (${cands.size} looked at), add rivals to the brief` : `${found}${need.seeds ? `, ${seeds.length} seeds from customer pages` : ""}`,
        competitors,
        seeds,
        provider: [...providers].slice(0, 4).join(", "),
        filled: need,
        candidates: [...cands.values()],
        reasons,
        excluded,
        categoryTerms: terms,
        category,
        target,
        profiles,
        rivalCustomers,
        reviews,
        unresolved: [...new Set(unresolved)].slice(0, 15),
      };
      return { status: "done", summary: out.summary, out };
    },
    render: () => null,
  };
}

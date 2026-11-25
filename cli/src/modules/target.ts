// Who a site is for, read with word rules from its own pages (no model). Roles, company size words,
// industries, named customers, use cases and the category words that say what the product is.
// Used by `prepare` and by the rivals step of `run`, and written into the brief with the pages that
// said it. The user's agent can read gtm/candidates.json and correct any of it.

import type { Target } from "../config.js";
import { cleanDomain } from "../util.js";

export interface SitePage {
  kind: string;
  url: string;
  markdown: string;
}

/** Words every site uses. They say nothing about the category. */
const BOILER = new Set(
  (
    "the and for with you your our are was were will can all more get one new use how what why who not no do does just than then them they their these those into out up so if about also any each per most very " +
    "home pricing price prices login log sign signup started start free try trial blog contact terms privacy policy cookie cookies rights reserved copyright company careers career features feature product products " +
    "resources resource help support faq faqs docs doc book demo menu close open learn read more now today day days month monthly year yearly annual plan plans team teams user users customers customer best top " +
    "using used make made create get see way ways work works need want like love just time first last next back over under every here there this that from have has had been being which when where while " +
    "click page pages site website web app apps account accounts email submit join view watch video videos image images logo logos icon arrow check star stars learn button cta " +
    "inc ltd llc gmbh com www http https html png jpg svg webp gif null true false undefined javascript css " +
    "one two three four five six seven eight nine ten hundred thousand million billion per cent percent " +
    "better faster easy easily simple simply great good best amazing powerful smart smarter perfect real really top leading ultimate world worlds " +
    "people person everyone anyone someone something everything anything thing things lot lots much many few less least most other others another " +
    "minutes minute seconds second hours hour weeks week months years 2023 2024 2025 2026 2027 jan feb mar apr may jun jul aug sep oct nov dec " +
    "english french german spanish language languages ago min mins max yes cancel anytime trusted rated reviews review testimonials wall " +
    "integrations integration api apis security secure privacy gdpr soc enterprise pro basic starter business growth premium unlimited " +
    "x27 both ask wins win built put run runs place reach doubled set sets let lets keep keeps dashboard settings profile profiles update updates updated latest news newsletter subscribe follow share copy link links"
  ).split(/\s+/),
);

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => (w.length > 2 || w === "ai") && !/^\d+$/.test(w));

const stemWord = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") ? w.slice(0, -1) : w);

/**
 * The words that say what the category is: the most frequent content words on your own pages,
 * plural folded to singular, your brand left out. The rival check and the SEO filter use them.
 */
export function categoryTerms(text: string, brand: string, domain: string, n = 25): string[] {
  const skip = new Set([brand.toLowerCase(), domain.split(".")[0].toLowerCase(), ...brand.toLowerCase().split(/\s+/)]);
  const count = new Map<string, number>();
  for (const w0 of tokens(text)) {
    if (BOILER.has(w0) || skip.has(w0)) continue;
    const w = stemWord(w0);
    if (BOILER.has(w) || skip.has(w)) continue;
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

/** Words a category phrase may hold although they are boilerplate on their own ("data API", "AI agent"). */
const PHRASE_OK = new Set(["api", "apis", "ai", "integration", "integrations", "security", "enterprise", "email", "video", "web", "app", "apps", "product", "account", "customer", "dashboard", "profile", "news"]);
/** Words that never start or end a category phrase. */
const PHRASE_EDGE = new Set(["google", "maps", "claude", "code", "cursor", "codex", "chatgpt", "openai", "linkedin", "tiktok", "instagram", "youtube", "facebook", "twitter", "reddit", "amazon", "shopify", "slack", "notion", "hubspot", "salesforce", "now", "can", "lowest", "every", "needs", "across", "only", "own", "pay", "paying", "find", "send", "call", "calls", "pick", "choose", "order", "name", "key", "keys", "get", "done", "connect", "connects", "need", "needs", "checked", "help", "helps", "go", "let"]);

/** A singular noun form so "data APIs" and "data API" count as one phrase. */
const phraseWord = (w: string) => (w === "apis" ? "api" : stemWord(w));

/**
 * The two- and three-word phrases that say what the product is ("data api", "mcp server"), most
 * telling first. A phrase in the home page title or an H1 counts most, then how often the pages say
 * it. Used for the rival search queries and the category match. No model, word rules only.
 */
export function categoryPhrases(pages: SitePage[], brand: string, domain: string, n = 3): string[] {
  const skip = new Set([brand.toLowerCase(), domain.split(".")[0].toLowerCase(), ...brand.toLowerCase().split(/\s+/)]);
  const ok = (w: string) => w.length >= 2 && !/\d/.test(w) && !skip.has(w) && (!BOILER.has(w) || PHRASE_OK.has(w));
  const words = (t: string) => t.toLowerCase().replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9\s-]/g, " ").split(/[\s]+/).filter(Boolean);
  const score = new Map<string, number>();
  const add = (t: string, w: number) => {
    const ws = words(t);
    for (let i = 0; i < ws.length; i++) {
      for (const len of [2, 3]) {
        const g = ws.slice(i, i + len);
        if (g.length < len || !g.every(ok)) continue;
        const st = g.map(phraseWord);
        // A third-party product name never makes a category ("google maps", "claude code"), and the edges are nouns.
        if (st.some((x) => PHRASE_EDGE.has(x) && !["code", "key", "name", "order", "call"].includes(x)) || PHRASE_EDGE.has(st[0]) || PHRASE_EDGE.has(st[len - 1])) continue;
        // One content word at least that is not a generic one: "ai api" alone says little.
        if (g.every((x) => PHRASE_OK.has(x))) continue;
        const k = st.join(" ");
        score.set(k, (score.get(k) ?? 0) + w * (len === 3 ? 0.8 : 1));
      }
    }
  };
  for (const p of pages) {
    const title = p.markdown.match(/^Title:\s*(.+)$/m)?.[1] ?? "";
    const h1 = [...p.markdown.matchAll(/^#\s+(.+)$/gm)].map((m) => m[1]).join("\n");
    add(title, p.kind === "home" ? 8 : 1);
    add(h1, p.kind === "home" ? 2 : 1);
    add(p.markdown.replace(/^Title:.*$/m, ""), 0.25);
  }
  const out: string[] = [];
  for (const [k] of [...score.entries()].filter(([, v]) => v >= 1.5).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    // Skip a phrase that only repeats one already picked ("data api" then "every data api").
    if (out.some((o) => o.includes(k) || k.includes(o))) continue;
    out.push(k);
    if (out.length >= n) break;
  }
  return out;
}

/** True when the page says one of the category phrases (plural or singular, words next to each other). */
export function saysPhrase(text: string, phrases: string[]): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map(phraseWord).join(" ")} `;
  return phrases.find((p) => t.includes(` ${p} `)) ?? null;
}

/**
 * How much of your category a page shares, 0 to 1. Each category word found on the page counts,
 * the first words (your most used) count more. Returns the share and the words it found.
 */
export function overlap(text: string, terms: string[]): { score: number; shared: string[] } {
  if (terms.length === 0) return { score: 0, shared: [] };
  const have = new Set(tokens(text).map(stemWord));
  let got = 0;
  let all = 0;
  const shared: string[] = [];
  terms.forEach((t, i) => {
    const w = 1 / (1 + i / 8);
    all += w;
    if (have.has(t)) {
      got += w;
      shared.push(t);
    }
  });
  return { score: Math.round((got / all) * 100) / 100, shared };
}

/** Role words and the label the brief uses for them. */
const ROLES: [RegExp, string][] = [
  [/\b(co-?founders?|founders?|founder-led|solopreneurs?)\b/gi, "Founders"],
  [/\b(ceos?|chief executives?|executives?|c-suite|business leaders?)\b/gi, "Executives"],
  [/\b(creators?|influencers?|thought leaders?|personal brands?)\b/gi, "Creators"],
  [/\b(agenc(y|ies)|agency owners?)\b/gi, "Agencies"],
  [/\b(ghostwriters?|copywriters?|writers?)\b/gi, "Writers and ghostwriters"],
  [/\b(marketers?|marketing teams?|marketing managers?|growth teams?|cmos?)\b/gi, "Marketers"],
  [/\b(sales teams?|salespeople|sales reps?|sdrs?|bdrs?|account executives?|sales leaders?)\b/gi, "Sales teams"],
  [/\b(recruiters?|recruiting teams?|talent teams?|hr teams?)\b/gi, "Recruiters"],
  [/\b(consultants?|coaches|coach|advisors?|freelancers?)\b/gi, "Consultants and coaches"],
  [/\b(developers?|engineers?|engineering teams?|devs)\b/gi, "Developers"],
  [/\b(small business(es)?|smbs?|smes?|local business(es)?)\b/gi, "Small businesses"],
  [/\b(startups?|start-ups?)\b/gi, "Startups"],
  [/\b(enterprises?|fortune 500|large teams?|global brands?)\b/gi, "Enterprises"],
  [/\b(shopify stores?|e-?commerce brands?|online stores?|dtc brands?)\b/gi, "Online stores"],
];

/** Company size words, as the label the brief uses. */
const SIZES: [RegExp, string][] = [
  [/\b(solo|solopreneurs?|freelancers?|individuals?|creators?|one-person)\b/gi, "solo"],
  [/\b(startups?|small business(es)?|smbs?|smes?|small teams?|founder-led)\b/gi, "small"],
  [/\b(agenc(y|ies))\b/gi, "agency"],
  [/\b(mid-?market|scale-?ups?|growing teams?)\b/gi, "mid-market"],
  [/\b(enterprises?|fortune 500|large companies|global brands?)\b/gi, "enterprise"],
];

/** The industries a company search uses for each role. LinkedIn style industry names. */
export const ROLE_INDUSTRIES: Record<string, string[]> = {
  Agencies: ["marketing services", "advertising services"],
  Marketers: ["marketing services", "software development"],
  Founders: ["software development", "technology, information and internet"],
  Startups: ["software development", "technology, information and internet"],
  Executives: ["business consulting and services", "software development"],
  "Sales teams": ["software development", "business consulting and services"],
  Recruiters: ["staffing and recruiting", "human resources services"],
  "Consultants and coaches": ["business consulting and services", "professional training and coaching"],
  Creators: ["online audio and video media", "writing and editing"],
  "Writers and ghostwriters": ["writing and editing", "marketing services"],
  Developers: ["software development", "it services and it consulting"],
  "Small businesses": ["retail", "professional services"],
  "Online stores": ["retail", "online and mail order retail"],
  Enterprises: ["financial services", "software development"],
};

function counted(text: string, rules: [RegExp, string][]): { label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const [re, label] of rules) {
    const n = (text.match(re) ?? []).length;
    if (n > 0) m.set(label, (m.get(label) ?? 0) + n);
  }
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

const NOT_A_NAME = /^(logo|icon|avatar|image|photo|picture|arrow|check|star|stars|play|close|menu|hero|banner|background|screenshot|illustration|chart|graph|thumbnail|profile|user|author|quote|g2|capterra|product hunt|trustpilot|linkedin|twitter|x|facebook|instagram|youtube|tiktok|google|apple|app store|play store|chrome)$/i;

/** Customer names from a page: logo alt text, "Name, Founder at Company" lines and "Founder @ Company". */
export function customersFrom(md: string, brand: string): string[] {
  const out = new Map<string, number>();
  const add = (raw: string) => {
    const n = raw.replace(/\s+/g, " ").replace(/[.,;:!]+$/, "").trim();
    if (n.length < 2 || n.length > 40 || NOT_A_NAME.test(n) || n.toLowerCase().includes(brand.toLowerCase()) || /^\d/.test(n)) return;
    if (n.split(" ").length > 5) return;
    out.set(n, (out.get(n) ?? 0) + 1);
  };
  for (const m of md.matchAll(/!\[([^\]]{2,60})\]/g)) {
    const alt = m[1].trim();
    const logo = alt.match(/^(.+?)\s*(?:'s)?\s*(?:logo|logotype|wordmark|brand mark)\b/i);
    if (logo) add(logo[1]);
  }
  const role = String.raw`(?:CEO|CTO|COO|CMO|CRO|Founder|Co-?founder|Owner|Head of [A-Z][A-Za-z]+|VP(?: of)? [A-Z][A-Za-z]+|Director(?: of [A-Z][A-Za-z]+)?|Marketing Manager|Growth Lead|Partner|Managing Director|President)`;
  const co = String.raw`([A-Z][A-Za-z0-9&.'-]+(?: [A-Z][A-Za-z0-9&.'-]+){0,3})`;
  for (const m of md.matchAll(new RegExp(`${role}\\s*(?:at|@|of|,)\\s*${co}`, "g"))) add(m[1]);
  return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n).slice(0, 25);
}

/** Use cases: headings on the use cases page, then "for <audience>" lines on the home page. */
export function useCasesFrom(pages: SitePage[]): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const x = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
    if (x.length < 6 || x.length > 90 || out.some((o) => o.toLowerCase() === x.toLowerCase())) return;
    out.push(x);
  };
  for (const p of pages.filter((p) => p.kind === "usecases"))
    for (const l of p.markdown.split("\n")) if (/^#{2,3}\s/.test(l)) add(l);
  for (const p of pages.filter((p) => p.kind === "home"))
    for (const l of p.markdown.split("\n")) {
      const m = l.match(/\b(?:built |made |designed )?for (founders|agencies|creators|marketers|sales teams|recruiters|coaches|consultants|executives|startups|teams|ghostwriters|freelancers|small businesses)[^.!?\n]{0,60}/i);
      if (m && /^#{1,4}\s|^[-*]\s/.test(l.trim())) add(l.replace(/^#+\s|^[-*]\s/, ""));
      else if (m) add(m[0]);
    }
  return out.slice(0, 10);
}

/** Roles, sizes, industries, named customers and use cases, with the pages that said them. */
export function extractTarget(pages: SitePage[], brand: string): Target {
  const ok = pages.filter((p) => p.markdown.length > 200);
  const text = ok.map((p) => p.markdown).join("\n");
  const roles = counted(text, ROLES).filter((r) => r.n >= 2).slice(0, 6);
  const sizes = counted(text, SIZES).filter((s) => s.n >= 2).map((s) => s.label).slice(0, 4);
  const industries = [...new Set(roles.flatMap((r) => ROLE_INDUSTRIES[r.label] ?? []))].slice(0, 5);
  const custPages = ok.filter((p) => ["customers", "casestudies", "home"].includes(p.kind));
  const customers = [...new Set(custPages.flatMap((p) => customersFrom(p.markdown, brand)))].slice(0, 20);
  return {
    roles: roles.map((r) => `${r.label} (${r.n} mentions)`),
    sizes,
    industries,
    customers,
    useCases: useCasesFrom(ok),
    sources: ok.map((p) => p.url),
  };
}

/** The plain role labels, without the counts. */
export const roleLabels = (t: Target) => t.roles.map((r) => r.replace(/\s*\(\d+ mentions?\)$/, ""));

/** The size band a company search uses, from the size words. */
export function sizeBandFrom(sizes: string[], fallback: string): string {
  const s = new Set(sizes);
  if (s.size === 0) return fallback;
  if (s.has("enterprise") && !s.has("solo") && !s.has("small")) return "201-5000";
  if (s.has("mid-market") && !s.has("solo")) return "11-500";
  return "1-50";
}

/** Job titles to look for, from the roles. */
export function titlesFrom(roles: string[], fallback: string[]): string[] {
  const map: Record<string, string[]> = {
    Founders: ["Founder", "CEO"],
    Executives: ["CEO", "Managing Director"],
    Agencies: ["Agency Owner", "Managing Director"],
    Marketers: ["Head of Marketing", "Marketing Manager"],
    Creators: ["Founder", "Content Creator"],
    "Writers and ghostwriters": ["Content Lead", "Ghostwriter"],
    "Sales teams": ["Head of Sales", "VP Sales"],
    Recruiters: ["Head of Talent", "Recruiter"],
    "Consultants and coaches": ["Founder", "Consultant"],
    Developers: ["CTO", "Head of Engineering"],
    Startups: ["Founder", "CEO"],
    "Small businesses": ["Owner", "Founder"],
    Enterprises: ["VP Marketing", "Head of Sales"],
    "Online stores": ["Founder", "Head of Ecommerce"],
  };
  const out = [...new Set(roles.flatMap((r) => map[r] ?? []))].slice(0, 5);
  return out.length > 0 ? out : fallback;
}

/** Social pages linked from a site, usually in the footer. The one named like the brand wins. */
export function socialLinks(md: string, brand: string, domain: string): { linkedin: string; x: string; facebook: string } {
  const stem = domain.split(".")[0].toLowerCase();
  const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const score = (slug: string) => {
    const s = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
    return s === stem || s === b ? 3 : s.includes(stem) || (b.length > 2 && s.includes(b)) ? 2 : 1;
  };
  const best = (re: RegExp, bad: RegExp) => {
    const hits = new Map<string, number>();
    for (const m of md.matchAll(re)) {
      const slug = m[1].replace(/[\\/]+$/, "");
      if (!slug || bad.test(slug)) continue;
      hits.set(slug, Math.max(hits.get(slug) ?? 0, score(slug)));
    }
    return [...hits.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? "";
  };
  const li = best(/linkedin\.com\/company\/([A-Za-z0-9_%.-]+)/gi, /^(linkedin|share)$/i);
  const x = best(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{2,15})(?![A-Za-z0-9_])/gi, /^(i|intent|share|home|search|hashtag|login|signup|explore|privacy|tos|settings|messages|notifications)$/i);
  const fb = best(/facebook\.com\/([A-Za-z0-9.\-]{2,80})/gi, /^(sharer|share|dialog|tr|plugins|groups|events|watch|login|policies|privacy|help|pages)$/i);
  return { linkedin: li ? `https://www.linkedin.com/company/${li}` : "", x, facebook: fb };
}

/** Outside company domains linked from a page (customer logos often link to the customer). */
export function linkedDomains(md: string, own: string): string[] {
  const out = new Map<string, number>();
  for (const m of md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    let h: string;
    try {
      h = cleanDomain(new URL(m[1]).hostname);
    } catch {
      continue;
    }
    if (!h || h === own || h.endsWith(`.${own}`)) continue;
    out.set(h, (out.get(h) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/**
 * A gap keyword is about your category when it shares at least two of your category words, one of
 * them among the first three (one word is enough when the brief has fewer than 10). "linkedin post generator" passes for a LinkedIn content tool,
 * "how to cancel linkedin premium" and "competitors" do not. With no category words, every gap stays.
 */
export type Intent = "comparison" | "commercial" | "informational" | "other";

/** Comparison and commercial searches come from buyers. How-to and definition searches come from readers. */
export function keywordIntent(keyword: string): Intent {
  const k = ` ${keyword.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (/ (vs|versus|alternative|alternatives|compare|comparison|competitor|competitors|or) /.test(k) || / (best|top) (?!time|times|way|ways|practice|practices|day|days|hour|hours)/.test(k)) return "comparison";
  if (/ (tool|tools|software|app|apps|platform|generator|maker|builder|scheduler|planner|creator|writer|template|templates|pricing|price|free|ai|extension|service|services|agency|agencies|review|reviews|buy) /.test(k)) return "commercial";
  if (/^ (what|how|why|when|who|where|which|is|are|does|do|can|should|definition|meaning) /.test(k) || / (meaning|definition|example|examples|tips|guide|best time|best times|how often|how many) /.test(k)) return "informational";
  return "other";
}

/** Searches that are never about buying a tool: jobs, logins, account settings, someone else's product plan. */
const OFF_INTENT = / (job|jobs|salary|salaries|login|log in|sign in|cancel|cancellation|delete|deactivate|premium|download|downloader|customer service|phone number|refund) /;

/** The phrase that names the category: the first two category words, "linkedin post". */
const phraseOf = (terms: string[]) => terms.slice(0, 2).join(" ");

export function relevantKeyword(keyword: string, terms: string[], brands: string[] = []): boolean {
  const k = ` ${keyword.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (OFF_INTENT.test(k)) return false;
  // "taplio alternatives" and "supergrow vs taplio" are buyers comparing rivals in your category.
  if (keywordIntent(keyword) === "comparison" && brands.some((b) => b.length >= 3 && k.includes(` ${b.toLowerCase()} `))) return true;
  // "what are impressions on linkedin" is a reader, a how-to or definition search stays only when it names the category phrase.
  if (terms.length >= 2 && keywordIntent(keyword) === "informational") {
    const fold = (x: string) => x.split(" ").map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");
    if (!fold(k).includes(` ${phraseOf(terms)} `) && !fold(k).includes(` ${phraseOf(terms)}`)) return false;
  }
  if (terms.length === 0) return true;
  const words = new Set(keyword.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
  const hits = terms.filter((t) => words.has(t)).length;
  if (terms.length < 10) return hits >= 1;
  // Two category words, one of them among the three that define the category ("ai image generator" shares
  // "ai" and "generator" with a LinkedIn tool but none of linkedin, post, founder).
  return hits >= 2 && terms.slice(0, 3).some((t) => words.has(t));
}


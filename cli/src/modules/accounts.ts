// Module 2, accounts. The ideal customer profile and the lookalikes in, accounts scored A to D with reasons out.
// Scoring is lifted from loootai/looot-score (MIT): fixed components with points, a reason line per
// component, unknown data earns no points and says so, grades at 75, 55 and 35.
// Calls company.search (on the ideal customer profile industries and geographies) and company.enrich (one per
// kept account, to fill size, industry and country before the final score).

import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { keyOf, sizeBandOf } from "../learn/schema.js";
import { loadFixture } from "./fixture.js";
import { isGeneric, OVERLAP_MIN, SOFT_GENERIC } from "./rivals.js";
import { markdownOf } from "./intake.js";
import { overlap } from "./target.js";
import type { GtmModule, ModuleContext, RenderOptions } from "./types.js";
import {
  answered,
  type CallTrail,
  type Company,
  companyObject,
  costNote,
  countryKey,
  countryName,
  type IcpOut,
  normalizeCompany,
  parseBand,
  payloads,
  pool,
  rowsOf,
  shell,
  type ShellSpec,
  sizeSimilarity,
  today,
  trailLine,
  trailTable,
} from "./icp.js";

export type Grade = "A" | "B" | "C" | "D";

export const GRADES = { A: 75, B: 55, C: 35 };
export const SEARCH_ROWS = 25;
/** Below this many fits, the Accounts view says so and shows the more accounts command. */
export const FEW = 5;

export interface ScoreLine {
  component: "size" | "industry" | "country" | "lookalike" | "stack" | "usecase";
  max: number;
  points: number;
  known: boolean;
  detail: string;
}

export interface Criteria {
  industries: string[];
  band: [number, number] | null;
  countries: string[];
  stack: string[];
  /** Phrases a good buyer says on its own site or profile (icp.useCaseTerms). Empty skips the use case score. */
  useCaseTerms?: string[];
  /** Your category words, for the check that drops accounts selling the same kind of product. */
  categoryTerms?: string[];
  /**
   * Multipliers learned from replies (looot-zeus learn, used with run --apply-learnings). Keys in
   * lower case: an industry, a size band ("51-200") or a country name. 1 or missing is neutral.
   */
  weights?: LearnedWeights;
}

export interface LearnedWeights {
  industry: Record<string, number>;
  sizeBand: Record<string, number>;
  country: Record<string, number>;
  title?: Record<string, number>;
}

/** A config can carry the learned weights for one run. They never go into config.yaml. */
export type WithLearnings = GtmConfig & { learned?: LearnedWeights };

const lk = keyOf;
const bandOf = sizeBandOf;

export interface AccountInput {
  company: Company;
  /** Similarity from the icp module, 0 to 1, when the account is a lookalike. */
  similarity: number | null;
  /** Rank in the company.search answer, when it came from search. */
  searchRank: number | null;
  /** The account's own home page as text, when it was read. */
  site?: string;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** The first term that appears as a whole word or phrase in the text, either way round. */
export function matchTerm(text: string, terms: string[]): string | undefined {
  const t = words(text);
  return terms.find((term) => term.trim() && (t.includes(words(term)) || words(term).includes(t)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Words that do not tell one industry from another. */
const IND_FILLER = new Set(["and", "of", "the", "services", "service", "other", "related", "products", "product", "activities", "general", "industry", "industries", "solutions", "&", "-", "it", "information", "technology"]);
const indWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)).filter((w) => w.length > 2 && !IND_FILLER.has(w));
/** Same words, either way round: "marketing & advertising" fits "marketing services", "computer software" fits "software development". */
const IND_ALIAS: Record<string, string> = { advertising: "marketing", advertis: "marketing", internet: "software", online: "software", saa: "software", computer: "software", recruiting: "staffing", recruitment: "staffing", consulting: "consulting", management: "consulting", coaching: "training", writing: "media", publishing: "media", editing: "media" };
const canon = (w: string) => IND_ALIAS[w] ?? w;

/** The ICP industry an account industry fits, by a shared industry word. undefined when none. */
export function industryFit(accountIndustries: string[], icpIndustries: string[]): string | undefined {
  for (const a of accountIndustries) {
    const aw = new Set(indWords(a).map(canon));
    if (aw.size === 0) continue;
    const hit = icpIndustries.find((i) => indWords(i).map(canon).some((w) => aw.has(w)));
    if (hit) return hit;
  }
  return undefined;
}

const fold = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ")} `;

/** Everything the account says about itself: name, provider description, keywords, industries and its home page. */
export function accountText(co: Company, site = ""): string {
  return [co.name ?? "", co.description ?? "", co.keywords.join(", "), co.industries.join(", "), site.slice(0, 12_000)].join(" . ");
}

/**
 * How well an account's own words fit the use case, 0 to 1, with the phrases it says. A phrase said as
 * written counts 1, all of its words somewhere counts a half, two full phrases make a full fit.
 * null when there is no text to judge.
 */
export function useCaseFit(text: string, terms: string[]): { f: number | null; hits: string[] } {
  if (!text.replace(/[\s.,]/g, "")) return { f: null, hits: [] };
  const t = fold(text);
  const words = new Set(t.trim().split(" "));
  let sum = 0;
  const hits: string[] = [];
  for (const term of terms) {
    const ft = fold(term);
    if (ft.trim() && t.includes(ft)) {
      sum += 1;
      hits.push(term);
    } else if (ft.trim() && ft.trim().split(" ").every((w) => words.has(w))) sum += 0.5;
  }
  return { f: Math.min(1, sum / 2), hits };
}

const SOFTWARE_SIGNS = [/free trial/i, /start (for )?free|try (it )?(for )?free|get started (for )?free/i, /no credit card/i, /chrome extension|browser extension/i, /\/\s?mo(nth)?\b|per month|billed (monthly|annually|yearly)/i, /sign ?up/i, /\bsaas\b/i, /\bapi\b/i, /\blog ?in\b/i];
const AGENCY_SIGNS = [/\bagency\b/i, /our services|services we offer|what we do/i, /book a (call|strategy call|discovery call|consultation|free consultation)/i, /done[- ]for[- ]you/i, /our clients|client results|case stud/i, /\bwe help\b/i, /\bconsult(ing|ancy)\b/i];

/**
 * Does this account sell the same kind of product as you. Buyers stay, rivals go. On its home page: three or
 * more software signs (trial, sign up, monthly price, extension) that outweigh the agency signs, plus enough of
 * your category words, your top one included (the same bar as the rival check). Without a page: a tool,
 * app or software description, no agency words and at least two category words, your top one included.
 */
export function sellsSameProduct(co: Company, site: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  if (site.length >= 200) {
    const sw = SOFTWARE_SIGNS.filter((re) => re.test(site)).length;
    const ag = AGENCY_SIGNS.filter((re) => re.test(site)).length;
    const o = overlap(site, terms);
    return sw >= 3 && sw > ag && o.score >= OVERLAP_MIN && o.shared.includes(terms[0]);
  }
  const d = [co.name ?? "", co.description ?? "", co.keywords.join(", ")].join(" . ");
  const toolish = /\b(saas|software|platform|app|tool|chrome extension|browser extension|ai[- ]powered)\b/i.test(d) || co.industries.some((i) => /software/.test(i));
  if (!toolish || AGENCY_SIGNS.some((re) => re.test(d))) return false;
  const o = overlap(d, terms);
  return o.shared.length >= 2 && o.shared.includes(terms[0]);
}

/** Holding groups. An agency inside one is far over a small-vendor size band, whatever its own headcount says. */
const HOLDING_STEMS = ["havas", "wpp", "omnicom", "publicis", "interpublic", "dentsu", "stagwell", "s4capital", "ogilvy", "saatchi", "mccann", "wunderman", "groupm", "mediamonks", "fleishmanhillard", "webershandwick", "leoburnett", "mullenlowe"];
const HOLDING_WORDS = /\b(bbdo|tbwa|ddb|vmly?&?r|ipg|accenture song|deloitte digital|edelman)\b/i;
const HOLDING_NAME: Record<string, string> = { havas: "Havas", wpp: "WPP", omnicom: "Omnicom", publicis: "Publicis", interpublic: "Interpublic", dentsu: "Dentsu", stagwell: "Stagwell", s4capital: "S4 Capital", ogilvy: "WPP", saatchi: "Publicis", mccann: "Interpublic", wunderman: "WPP", groupm: "WPP", mediamonks: "S4 Capital", fleishmanhillard: "Omnicom", webershandwick: "Interpublic", leoburnett: "Publicis", mullenlowe: "Interpublic" };

/** The holding group an account belongs to, by its name, domain or description. null when none. */
export function holdingOf(co: Company): string | null {
  const flat = `${co.name ?? ""} ${co.domain}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const st = HOLDING_STEMS.find((h) => flat.includes(h));
  if (st) return HOLDING_NAME[st] ?? st;
  const w = HOLDING_WORDS.exec(`${co.name ?? ""} ${co.domain.split(".")[0]}`);
  if (w) return w[1].toUpperCase();
  const d = /\b(?:part of|a member of|subsidiary of|division of|owned by|an? \w+ company of)\s+(?:the\s+)?(havas|wpp|omnicom|publicis|interpublic|ipg|dentsu|stagwell|s4 capital)\b/i.exec(co.description ?? "");
  return d ? d[1] : null;
}

/**
 * Does the company name show up in its domain. "Dev Academy by Dr. Rahul Dev" on patentbusinesslawyer.com does
 * not: the provider joined a name to someone else's site. Any name word of 3 letters or more in the domain is enough,
 * so does the domain stem inside the name. Without a name there is nothing to compare.
 */
export function nameFitsDomain(name: string | null, domain: string): boolean {
  if (!name) return true;
  const host = domain.toLowerCase().replace(/^www\./, "");
  const flatHost = host.replace(/[^a-z0-9]/g, "");
  const stem = host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const flatName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (stem.length >= 3 && flatName.includes(stem)) return true;
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  return words.some((w) => flatHost.includes(w));
}

/** Website builders and link pages. A company listed under one of these has no domain of its own to judge. */
const HOSTED = new Set(["clickfunnels.com", "uwu.ai", "carrd.co", "linktr.ee", "wixsite.com", "wix.com", "squarespace.com", "webflow.io", "framer.website", "notion.site", "calendly.com", "beacons.ai", "bio.link", "hubspot.com", "godaddysites.com", "weebly.com", "wordpress.com", "substack.com", "medium.com"]);

/** Brands too big or too well known to be a target for a small vendor. Lower case names and domain stems. */
const MEGA = new Set(
  (
    "google alphabet amazon microsoft apple meta facebook instagram linkedin ibm oracle salesforce sap adobe intel cisco dell hp nvidia netflix tesla uber airbnb " +
    "ey deloitte pwc kpmg accenture mckinsey bcg bain capgemini infosys tcs wipro cognizant hcl tata " +
    "walmart target costco nike coca-cola pepsico unilever nestle samsung sony siemens bosch toyota ford gm bmw volkswagen " +
    "jpmorgan chase goldmanSachs morganstanley citi citigroup hsbc barclays wellsfargo bankofamerica paypal visa mastercard amex " +
    "att verizon tmobile vodafone comcast disney twitter x openai anthropic"
  ).toLowerCase().split(/\s+/),
);

export const GIANT = 5000;

/**
 * Why an account is out of the ICP, or null when it fits. The hard filter: an account outside the size
 * band, outside the industries, a giant (over 5,000 staff unless the ICP is enterprise), a mega brand,
 * a government or military body, or one where the providers disagree about what it does.
 */
export function outOfIcp(co: Company, c: Criteria, searchIndustries: string[] = [], firstPass = false): string | null {
  const stem = co.domain.split(".")[0].toLowerCase();
  const name = (co.name ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (/\.(gov|mil)(\.[a-z]{2})?$/.test(co.domain) || /\b(government|military|armed forces|army|navy|air force|defen[cs]e|public administration|ministry|federal)\b/i.test([co.name ?? "", ...co.industries].join(" "))) return "government or military";
  if (MEGA.has(stem) || MEGA.has(name)) return "a mega brand, out of reach for this ICP";
  if (HOSTED.has(co.domain) || [...HOSTED].some((h) => co.domain.endsWith(`.${h}`))) return "listed under a website builder, no domain of its own";
  if (!nameFitsDomain(co.name, co.domain)) return "the website does not match the company name";
  const group = holdingOf(co);
  if (group) return `part of the ${group} group, far over the size band`;
  const hi = c.band?.[1] ?? 0;
  if (co.employees !== null && co.employees > GIANT && hi <= GIANT) return `${co.employees.toLocaleString("en-US")} staff, a giant`;
  // Before enrich, search data is rough: only the hard cases go. Size and industry are judged on the enriched row.
  if (firstPass) return null;
  // Bands drawn from a few seeds are narrow, so the cut sits at half the low end and twice the high end.
  if (c.band && co.employees !== null && (co.employees < c.band[0] / 2 || co.employees > c.band[1] * 2)) return `${co.employees} staff, outside ${c.band[0]}-${c.band[1]}`;
  if (c.industries.length > 0 && co.industries.length > 0 && !industryFit(co.industries, c.industries)) return `${co.industries[0]} is outside the ICP industries`;
  if (c.countries.length > 0 && co.country && !c.countries.some((x) => countryKey(x) === co.country)) return `${countryName(co.country)} is outside the target countries`;
  if (c.countries.length > 0 && !co.country) return "no country returned";
  if (searchIndustries.length > 0 && co.industries.length > 0 && !industryFit(co.industries, searchIndustries) && !industryFit(searchIndustries, co.industries)) return `providers disagree, ${searchIndustries[0]} in search and ${co.industries[0]} in enrich`;
  return null;
}

/** Scores one account against the ideal customer profile. Pure: the same input always gives the same score. */
export function scoreAccount(a: AccountInput, c: Criteria): { score: number; grade: Grade; lines: ScoreLine[]; reasons: string } {
  const lines: ScoreLine[] = [];
  const add = (component: ScoreLine["component"], max: number, f: number | null, detail: string, w = 1) =>
    lines.push({ component, max, points: round1(max * (f ?? 0) * w), known: f !== null, detail: w !== 1 && (f ?? 0) > 0 ? `${detail}, learned x${w.toFixed(2)}` : detail });
  const co = a.company;
  const lw = c.weights;
  const wOf = (m: Record<string, number> | undefined, ...keys: (string | null | undefined)[]) => {
    for (const k of keys) if (k && m && typeof m[lk(k)] === "number") return m[lk(k)];
    return 1;
  };

  if (c.band) {
    const [lo, hi] = c.band;
    if (co.employees === null) add("size", 25, null, "no headcount returned");
    else if (co.employees >= lo && co.employees <= hi) add("size", 25, 1, `${co.employees} staff in band`, wOf(lw?.sizeBand, bandOf(co.employees)));
    else {
      const s = sizeSimilarity(co.employees, { min: lo, max: hi });
      add("size", 25, s >= 0.7 ? 0.5 : 0, `${co.employees} staff, outside ${lo}-${hi}`, wOf(lw?.sizeBand, bandOf(co.employees)));
    }
  }
  if (c.industries.length > 0) {
    if (co.industries.length === 0) add("industry", 25, null, "no industry returned");
    else {
      const hit = co.industries.map((i) => matchTerm(i, c.industries)).find(Boolean) ?? industryFit(co.industries, c.industries);
      add("industry", 25, hit ? 1 : 0, hit ? `${co.industries[0]} fits` : `${co.industries[0]} is outside the ICP`, hit ? wOf(lw?.industry, co.industries[0], hit) : 1);
    }
  }
  if (c.countries.length > 0) {
    if (!co.country) add("country", 15, null, "no country returned");
    else {
      const ok = c.countries.some((x) => countryKey(x) === co.country);
      add("country", 15, ok ? 1 : 0, ok ? `${countryName(co.country)} in target` : `${countryName(co.country)} not in target`, ok ? wOf(lw?.country, countryName(co.country), co.country) : 1);
    }
  }
  if (a.similarity !== null) add("lookalike", 20, a.similarity, `lookalike ${a.similarity.toFixed(2)}`);
  else if (a.searchRank !== null) add("lookalike", 20, a.searchRank <= 10 ? 0.5 : 0.25, `search match #${a.searchRank}`);
  if (c.useCaseTerms && c.useCaseTerms.length > 0) {
    const u = useCaseFit(accountText(co, a.site ?? ""), c.useCaseTerms);
    add("usecase", 30, u.f, u.f === null ? "nothing on its site or profile to judge the use case" : u.hits.length > 0 ? `says ${u.hits.slice(0, 2).join(", ")}` : u.f > 0 ? "some use case words, no full phrase" : "no use case words on its site or profile");
  }
  if (c.stack.length > 0 && co.technologies.length > 0) {
    const found = c.stack.filter((t) => co.technologies.some((x) => matchTerm(x, [t])));
    add("stack", 15, Math.min(1, found.length / Math.min(2, c.stack.length)), found.length ? `uses ${found.slice(0, 2).join(", ")}` : "no shared stack");
  }

  const max = lines.reduce((n, l) => n + l.max, 0);
  const earned = lines.reduce((n, l) => n + l.points, 0);
  // Learned weights can lift a score past 100 points of 100. It is held at 100.
  const score = max > 0 ? Math.min(100, Math.round((100 * earned) / max)) : 0;
  const grade: Grade = score >= GRADES.A ? "A" : score >= GRADES.B ? "B" : score >= GRADES.C ? "C" : "D";
  // Strongest reasons first, then the biggest gap, at most three.
  const good = lines.filter((l) => l.points > 0).sort((x, y) => y.points - x.points).map((l) => l.detail);
  const gaps = lines.filter((l) => l.points === 0).sort((x, y) => y.max - x.max).map((l) => l.detail);
  const reasons = [...good.slice(0, 2), ...gaps.slice(0, 1), ...good.slice(2)].slice(0, 3).join(", ");
  return { score, grade, lines, reasons };
}

export interface AccountRow {
  domain: string;
  name: string;
  industry: string;
  employees: number | string;
  country: string;
  grade: Grade;
  score: number;
  reasons: string;
  source: "lookalike" | "search";
  provider: string;
  date: string;
  enriched: boolean;
}

export interface AccountsOut {
  placeholder?: string;
  summary: string;
  provider?: string;
  date?: string;
  rows: AccountRow[];
  /** Candidates considered before the top ones were enriched. */
  considered?: number;
  /** Accounts the hard ICP filter dropped, counted by reason. Never shown by name. */
  dropped?: { reason: string; count: number }[];
  calls?: CallTrail[];
}

/** The criteria from the icp output, or the intake draft when icp has none. */
export function criteriaFrom(cfg: GtmConfig, icpOut: IcpOut | null | undefined): Criteria {
  // A brief your agent reviewed keeps its own industries, size band and countries over the seed traits.
  const card = cfg.discovery?.by === "agent" ? undefined : icpOut?.card;
  const stack = (icpOut?.traits?.technologies ?? []).map((t) => t.value);
  const learned = (cfg as WithLearnings).learned;
  return {
    industries: card?.industries?.length ? card.industries : cfg.icp.industries,
    band: parseBand(card?.sizeBand ?? cfg.icp.sizeBand),
    countries: card?.geos?.length ? card.geos : cfg.icp.geos,
    stack,
    useCaseTerms: cfg.icp.useCaseTerms ?? [],
    categoryTerms: cfg.categoryTerms ?? [],
    ...(learned ? { weights: learned } : {}),
  };
}

/** The company.search inputs: one per call, cycling through industry and geography pairs. */
export function searchInputs(cfg: GtmConfig, c: Criteria, calls: number, offset = 0): Record<string, unknown>[] {
  const inds = c.industries.length > 0 ? c.industries : [cfg.offer || cfg.brand];
  const geos = c.countries.length > 0 ? c.countries : [""];
  const pairs = inds.flatMap((i) => geos.map((g) => [i, g] as const));
  // Use case searches first: AI Ark matches the phrases against what each company says it sells
  // (productAndServices), so "linkedin ghostwriting" finds the agencies that do it. Then the industry searches.
  const uc = c.band ? (c.useCaseTerms ?? []).flatMap((t) => geos.map((g) => [t, g] as const)).slice(0, USE_CASE_CALLS_MAX) : [];
  const range = c.band ? { type: "RANGE", range: [{ start: Math.max(1, Math.floor(c.band[0] / 2)), end: c.band[1] * 2 }] } : null;
  return Array.from({ length: calls }, (_, j) => {
    const k0 = j + offset;
    if (k0 < uc.length && range) {
      const [term, location] = uc[k0];
      return { page: 0, size: SEARCH_ROWS, account: { employeeSize: range, productAndServices: { any: { include: { mode: "SMART", content: [term] } } }, ...(location ? { location: { any: { include: [location] } } } : {}) } };
    }
    const k = k0 - uc.length;
    const [industry, location] = pairs[k % pairs.length];
    const page = Math.floor(k / pairs.length) + 1;
    // With a size band the search goes to AI Ark with its own filter (company.search.filtered). Without
    // it a routed search returns the biggest companies first (Google, IBM, US Army).
    if (c.band) {
      return { page: page - 1, size: SEARCH_ROWS, account: {
        // The same tolerance as the hard filter: half the low end to twice the high end.
        employeeSize: { type: "RANGE", range: [{ start: Math.max(1, Math.floor(c.band[0] / 2)), end: c.band[1] * 2 }] },
        industries: { any: { include: { mode: "WORD", content: [industry] } } },
        ...(location ? { location: { any: { include: [location] } } } : {}),
      } };
    }
    const input: Record<string, unknown> = { query: industry, industry, limit: SEARCH_ROWS };
    if (location) input.location = location;
    if (page > 1) input.page = page;
    return input;
  });
}

/** The filtered search when the brief has a size band, the routed one otherwise. */
export const searchJob = (cfg: GtmConfig) => (parseBand(cfg.icp.sizeBand) ? "company.search.filtered" : "company.search");

/** At most this many use case searches (phrase and country pairs) per run. */
export const USE_CASE_CALLS_MAX = 8;
/** Use case searches this brief makes: one per phrase and country, only with a size band. */
export const useCaseCalls = (cfg: GtmConfig) => (parseBand(cfg.icp.sizeBand) ? Math.min(USE_CASE_CALLS_MAX, (cfg.icp.useCaseTerms ?? []).length * Math.max(1, cfg.icp.geos.length)) : 0);
const searchCalls = (cfg: GtmConfig) => useCaseCalls(cfg) + Math.max(1, Math.ceil((cfg.limits.accounts * 2) / SEARCH_ROWS));

const SPEC: ShellSpec = {
  num: "02",
  id: "accounts",
  title: "Accounts, scored A to D",
  deeper: "github.com/loootai/looot-score, npm run score -- accounts.csv --icp icp.json",
  activate: "Import gtm/accounts.csv into your CRM",
};

interface Cand {
  company: Company;
  similarity: number | null;
  searchRank: number | null;
  provider: string;
  enriched: boolean;
  /** Industries the search row gave, before enrich, to spot providers that disagree. */
  searchInd?: string[];
  /** The home page as text, when it was read. */
  site?: string;
}

export const accounts: GtmModule = {
  id: "accounts",
  label: "Accounts",
  needs: ["icp"],
  quote: (cfg) => ({
    lines: [
      { job: searchJob(cfg), calls: searchCalls(cfg) + 1, rows: SEARCH_ROWS, note: "twice the accounts kept, to score, plus one wider search when all come back empty" },
      { job: "company.enrich", calls: cfg.limits.accounts },
      { job: "web.scrape.markdown", calls: cfg.limits.accounts, note: "each kept account's home page, to check the use case and drop rivals" },
    ],
  }),
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") {
      const f = loadFixture<AccountsOut>("accounts");
      return { status: "done", summary: f.summary, out: f };
    }
    const cfg = ctx.cfg;
    const date = today();
    const icpOut = ctx.outputs.icp as IcpOut | null | undefined;
    const crit = criteriaFrom(cfg, icpOut);
    const calls: CallTrail[] = [];
    // `looot-zeus more accounts` skips the accounts the folder already has and reads later pages.
    const more = (cfg as { more?: { skipDomains?: string[]; pageOffset?: number } }).more;
    const exclude = new Set([cfg.domain, ...cfg.seeds, ...cfg.competitors, ...(cfg.excluded ?? []), ...(more?.skipDomains ?? [])]);
    // Widely embedded products (Stripe, HubSpot, OpenAI...) may be rivals on a category match, never target accounts.
    const skip = (d: string) => exclude.has(d) || isGeneric(d) || SOFT_GENERIC.has(d);
    const cands = new Map<string, Cand>();
    for (const l of icpOut?.lookalikes ?? []) {
      if (skip(l.domain)) continue;
      const country = l.country ? countryKey(l.country) : null;
      cands.set(l.domain, {
        company: { domain: l.domain, name: l.name, industries: l.industry ? [l.industry.toLowerCase()] : [], employees: typeof l.employees === "number" ? l.employees : null, country, technologies: [], keywords: [] },
        similarity: Number(l.similarity) || 0,
        searchRank: null,
        provider: l.provider,
        enriched: false,
      });
    }

    const score = (c: Cand) => scoreAccount({ company: c.company, similarity: c.similarity, searchRank: c.searchRank, site: c.site }, crit);
    let kept: Cand[] = [];
    const dropped = new Map<string, string>();
    const drop = (c: Cand, why: string) => {
      dropped.set(c.company.domain, why);
      cands.delete(c.company.domain);
    };
    const fits = (c: Cand, firstPass = false) => {
      const why = outOfIcp(c.company, crit, c.searchInd ?? [], firstPass);
      if (why) drop(c, why);
      return !why;
    };
    const build = (): AccountsOut => {
      const list = (kept.length > 0 ? kept : [...cands.values()].slice(0, cfg.limits.accounts)).filter((c) => !dropped.has(c.company.domain));
      const rows = list
        .map((c): AccountRow => {
          const s = score(c);
          return {
            domain: c.company.domain,
            name: c.company.name ?? c.company.domain,
            industry: c.company.industries[0] ?? "",
            employees: c.company.employees ?? "",
            country: c.company.country ? countryName(c.company.country) : "",
            grade: s.grade,
            score: s.score,
            reasons: s.reasons,
            source: c.similarity !== null ? "lookalike" : "search",
            provider: c.provider,
            date,
            enriched: c.enriched,
          };
        })
        .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
      const n = (g: Grade) => rows.filter((r) => r.grade === g).length;
      const summary = `${rows.length} accounts scored, ${n("A")} A, ${n("B")} B, ${n("C")} C, ${n("D")} D`;
      const used = [...new Set(rows.map((r) => r.provider).filter(Boolean))].slice(0, 3);
      const why = new Map<string, number>();
      for (const r of dropped.values()) {
        const k = r.replace(/^\d[\d,]* staff, outside .*/, "outside the size band").replace(/^\d[\d,]* staff, a giant$/, "over 5,000 staff").replace(/^.* is outside the ICP industries$/, "outside the ICP industries").replace(/^providers disagree.*/, "providers disagree on the industry").replace(/^.* is outside the target countries$/, "outside the target countries").replace(/^part of the .* group.*/, "part of a holding group");
        why.set(k, (why.get(k) ?? 0) + 1);
      }
      const droppedList = [...why.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
      return { summary: `${summary}${dropped.size > 0 ? `, ${dropped.size} dropped by the ICP filter` : ""}`, provider: used.join(", ") || undefined, date, rows, considered: cands.size + dropped.size, calls, dropped: droppedList };
    };

    try {
      const inputs = searchInputs(cfg, crit, searchCalls(cfg), more?.pageOffset ?? 0);
      await pool(inputs, 3, async (input, k) => {
        const res = await ctx.call(searchJob(cfg), input, `search:${k + (more?.pageOffset ?? 0)}`);
        const acct = (input.account ?? {}) as any;
        const what = String(input.industry ?? acct.industries?.any?.include?.content?.[0] ?? (acct.productAndServices ? `"${acct.productAndServices.any?.include?.content?.[0]}"` : ""));
        const where = String(input.location ?? acct.location?.any?.include?.[0] ?? "");
        calls.push(trailLine(`search ${what}${where ? ` in ${where}` : ""}`, res));
        if (!answered(res)) return;
        const rows = payloads(res).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
        rows
          .map((r) => normalizeCompany(r))
          .filter((c): c is Company => !!c && !skip(c.domain))
          .forEach((c, i) => {
            const cur = cands.get(c.domain);
            if (cur) {
              cur.searchRank ??= i + 1;
              return;
            }
            cands.set(c.domain, { company: c, similarity: null, searchRank: i + 1, provider: res.record.provider, enriched: false, searchInd: c.industries });
          });
        ctx.partial(build());
      });
      // Fallback: every search came back empty. One wider search with no country filter, so a narrow
      // or wrong country guess does not leave the section empty.
      const first = inputs[0] as any;
      if (cands.size === 0 && first && (first.location || first.account?.location)) {
        const wide = first.account ? { ...first, account: { ...first.account, location: undefined } } : { ...first, location: undefined };
        if (wide.account) delete wide.account.location;
        else delete wide.location;
        const res = await ctx.call(searchJob(cfg), wide, `search-wide:${more?.pageOffset ?? 0}`);
        calls.push(trailLine("search again without the country filter", res));
        if (answered(res)) {
          const rows = payloads(res).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
          rows.map((r) => normalizeCompany(r)).filter((c): c is Company => !!c && !skip(c.domain)).forEach((c, i) => {
            if (!cands.has(c.domain)) cands.set(c.domain, { company: c, similarity: null, searchRank: i + 1, provider: res.record.provider, enriched: false, searchInd: c.industries });
          });
        }
        ctx.partial(build());
      }
      // Score on what search and lookalikes gave, keep the best, then enrich those to score again.
      for (const c of [...cands.values()]) {
        // A description that already reads like a rival's product goes before any paid lookup.
        if (sellsSameProduct(c.company, "", crit.categoryTerms ?? [])) drop(c, "sells the same kind of product, a rival");
        else fits(c, true);
      }
      kept = [...cands.values()].sort((a, b) => score(b).score - score(a).score || a.company.domain.localeCompare(b.company.domain)).slice(0, cfg.limits.accounts);
      ctx.partial(build());
      await pool(kept, 4, async (c) => {
        const d = c.company.domain;
        const res = await ctx.call("company.enrich", { domain: d }, `enrich:${d}`);
        calls.push(trailLine(`enrich ${d}`, res));
        if (answered(res)) {
          const e = payloads(res).map((p) => normalizeCompany(companyObject(p), d)).find((x) => x && (x.industries.length > 0 || x.employees !== null || x.country));
          if (e) {
            c.company = {
              domain: d,
              name: c.company.name ?? e.name,
              industries: e.industries.length > 0 ? e.industries : c.company.industries,
              employees: e.employees ?? c.company.employees,
              country: e.country ?? c.company.country,
              technologies: e.technologies.length > 0 ? e.technologies : c.company.technologies,
              keywords: e.keywords,
            };
            c.enriched = true;
            c.provider = res.record.provider;
          }
        }
        // The account's own home page: the use case score reads it. An account that sells the same kind
        // of product as you is a rival, never a buyer.
        const home = await ctx.call("web.scrape.markdown", { url: `https://${d}/` }, `acct-home:${d}`);
        calls.push(trailLine(`home page ${d}`, home));
        if (answered(home)) c.site = markdownOf(home.data);
        if (sellsSameProduct(c.company, c.site ?? "", crit.categoryTerms ?? [])) drop(c, "sells the same kind of product, a rival");
        else fits(c);
        ctx.partial(build());
      });
    } catch (e) {
      ctx.partial(build());
      throw e;
    }
    const out = build();
    return { status: "done", summary: out.summary, out };
  },
  render(out, status, _opts: RenderOptions) {
    return shell(SPEC, out, status, (f: AccountsOut) => {
      const blocks: Block[] = [
        { kind: "stat", items: (["A", "B", "C", "D"] as Grade[]).map((g) => ({ label: `Grade ${g}`, value: String(f.rows.filter((r) => r.grade === g).length) })) },
        { kind: "table", columns: [{ key: "grade", label: "Grade" }, { key: "score", label: "Score", num: true }, { key: "name", label: "Company", logoKey: "domain" }, { key: "industry", label: "Industry" }, { key: "employees", label: "Staff", num: true }, { key: "country", label: "Country" }, { key: "reasons", label: "Why" }, { key: "provider", label: "Provider" }, { key: "date", label: "Date" }], rows: f.rows.map((r) => ({ ...r })), ...(f.considered && f.considered > f.rows.length ? { total: f.considered } : {}) },
        ...(f.dropped && f.dropped.length > 0 ? [{ kind: "note" as const, text: `The ICP filter dropped ${f.dropped.reduce((n, d) => n + d.count, 0)} accounts before grading: ${f.dropped.map((d) => `${d.count} ${d.reason}`).join(", ")}. They are not shown.` }] : []),
        ...(f.rows.length === 0 ? [{ kind: "note" as const, text: `No account fits yet. ${f.considered ? `${f.considered} companies came back and none passed the ICP filter.` : "The lookalike and profile searches returned no company for this ideal customer."} Next step: add 3 to 5 domains of your real customers under seeds: in gtm/config.yaml (they steer the lookalikes), check the industries and size there, then fetch accounts again with the command below.` }, { kind: "more" as const, label: "More accounts", command: "npx looot-zeus more accounts", price: "the price is shown before anything is spent" }] : []),
        ...(f.rows.length > 0 && f.rows.length < FEW ? [{ kind: "note" as const, text: `Only ${f.rows.length} ${f.rows.length === 1 ? "account fits" : "accounts fit"} the ICP after the filter. Nothing was added to pad the list. Fetch the next pages of the search with the command below.` }, { kind: "more" as const, label: "More accounts", command: "npx looot-zeus more accounts", price: "the price is shown before anything is spent" }] : []),
        { kind: "note", text: `Grades. A at ${GRADES.A} points or more, B at ${GRADES.B}, C at ${GRADES.C}. Size and industry carry 25 points each, lookalike 20, country 15, shared stack 15. When the brief names use case phrases, saying them on its own site or profile carries 30. The score is the share of the points the data could earn. Data a provider did not return earns no points.` },
      ];
      const tt = trailTable(f.calls ?? []);
      if (tt) blocks.push(tt);
      const cn = costNote(f.calls ?? []);
      if (cn) blocks.push(cn);
      return blocks;
    });
  },
};

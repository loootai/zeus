import { readFileSync } from "node:fs";
import YAML from "yaml";
import { cleanDomain } from "./util.js";
import { parseCaps, type CapLimits } from "./cap.js";

export type Depth = "sample" | "full";
export type Auto = "auto" | "on" | "off";

export interface GtmConfig {
  domain: string;
  /** What the user wants most (--goal), for "Your next plays": one of the 6 outcomes or an Atlas goal. */
  goal?: string;
  brand: string;
  offer: string;
  icp: {
    industries: string[];
    sizeBand: string;
    geos: string[];
    titles: string[];
    /**
     * What a buyer does that your product serves, as phrases found on a buyer's own site or profile:
     * "linkedin content", "ghostwriting", "personal branding". The account search looks for them and the
     * score favours accounts that say them. Set by your agent. Empty means the category words are used.
     */
    useCaseTerms?: string[];
  };
  seeds: string[];
  competitors: string[];
  keywords: string[];
  questions: string[];
  depth: Depth;
  limits: {
    /** Accounts kept after scoring. sample = 25, full = 100 by default. */
    accounts: number;
    peoplePerAccount: number;
    /** Accounts that get the paid signal lookups (the A and B grades). */
    signalAccounts: number;
    /** Top A and B accounts that get a buying committee. sample = 10, full = 25. */
    committeeAccounts: number;
    /** People per buying committee, one per role. Default 4. */
    committeeSize: number;
  };
  /**
   * People data (names, work emails, buying committees). Off by default: the free run is company-level
   * only. On with --people or `people: true`, for paid runs.
   */
  people: boolean;
  /** --phones: phones for every enriched person too, plus the deepest phone step (Limadata, $0.20 a hit). Needs people. */
  phones: boolean;
  /** Phones on the buying committees and each account's company line. Opt-in: --phones or `committeePhones: true`, and only with people. */
  committeePhones: boolean;
  /** Your own App Store ids and Google Maps places, plus the same per competitor domain. */
  reviews: { mode: Auto; appStoreIds: string[]; mapsPlaces: string[]; competitors: Record<string, CompetitorListings> };
  local: { mode: Auto; queries: string[] };
  /** Your own Amazon ASINs, plus ASINs per competitor domain. */
  commerce: { mode: Auto; asins: string[]; competitors: Record<string, string[]> };
  /** Words that say what the category is. SEO gaps and rival checks use them. Filled by prepare or by the agent. */
  categoryTerms: string[];
  /** Two- or three-word phrases that say what the product is ("data api"). Read from your site when empty; set them to steer the rival search. */
  category: string[];
  /** Why each rival is in the list, one line per rival domain. */
  rivalReasons: Record<string, string>;
  /** Candidates that were checked and turned down. Their SEO gaps and ads are dropped. */
  excluded: string[];
  /** Name, logo and social pages for you and each rival, read from the sites and company.enrich. Edit any wrong link. */
  profiles: Record<string, Profile>;
  /** Who the site says it is for, with the pages that say so. */
  target: Target;
  /**
   * Who picked the rivals and the ICP. "draft" is the first read of the site, not checked yet, so the
   * run checks the rivals first. "rules" is prepare or run on its own. "agent" is your agent, after
   * reading gtm/candidates.json. Empty means you wrote the brief yourself, it is used as it is.
   */
  discovery: { by: "" | "draft" | "rules" | "agent"; at: string };
  /**
   * Hard limits per section, on top of the run cap: `caps: { total_usd, total_runs, sections: { <moduleId>: { usd, runs } } }`.
   * Left out, the defaults in capDefaults.ts apply (none while they are off).
   */
  caps?: CapLimits;
  /** Off skips every LinkedIn step (LinkedIn ads, company posts, the LinkedIn page search). On by default. */
  linkedin: boolean;
}

export interface Profile {
  name: string;
  logo: string;
  linkedin: string;
  /** LinkedIn numeric company id, when known. The LinkedIn ad library prefers it. */
  linkedinId: string;
  x: string;
  facebook: string;
}

export interface Target {
  roles: string[];
  sizes: string[];
  industries: string[];
  customers: string[];
  useCases: string[];
  sources: string[];
}

export interface CompetitorListings {
  appStoreIds: string[];
  mapsPlaces: string[];
}

export class ConfigError extends Error {}

const DEFAULT_LIMITS = { sample: { accounts: 25, peoplePerAccount: 2, signalAccounts: 10, committeeAccounts: 10, committeeSize: 4 }, full: { accounts: 100, peoplePerAccount: 2, signalAccounts: 30, committeeAccounts: 25, committeeSize: 4 } };

function strList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ConfigError(`${field} should be a list`);
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function auto(v: unknown, field: string): Auto {
  if (v === undefined || v === null) return "auto";
  if (v === true) return "on";
  if (v === false) return "off";
  if (v === "auto" || v === "on" || v === "off") return v;
  throw new ConfigError(`${field} should be auto, on or off`);
}

function domainMap<T>(v: unknown, field: string, each: (x: unknown, f: string) => T): Record<string, T> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new ConfigError(`${field} should map a competitor domain to its ids`);
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const d = cleanDomain(k);
    if (!d.includes(".")) throw new ConfigError(`${field} has "${k}", which is not a domain`);
    out[d] = each(x, `${field}.${k}`);
  }
  return out;
}

/** Turns parsed YAML into a full config with defaults. Throws ConfigError with the field name. */
export function normalizeConfig(raw: unknown, overrides: { depth?: Depth; phones?: boolean; noPhones?: boolean; maxRuns?: number; noLinkedin?: boolean; people?: boolean } = {}): GtmConfig {
  if (!raw || typeof raw !== "object") throw new ConfigError("config is empty");
  const r = raw as Record<string, any>;
  if (!r.domain) throw new ConfigError("domain is missing");
  const depth: Depth = overrides.depth ?? (r.depth === "full" ? "full" : "sample");
  const lim = { ...DEFAULT_LIMITS[depth], ...(r.limits ?? {}) };
  for (const k of ["accounts", "peoplePerAccount", "signalAccounts", "committeeAccounts", "committeeSize"] as const) {
    lim[k] = Number(lim[k]);
    if (!Number.isInteger(lim[k]) || lim[k] < 0) throw new ConfigError(`limits.${k} should be a whole number`);
  }
  const domain = cleanDomain(String(r.domain));
  // People data only when asked for (a paid run). Phones only with people and only when asked for.
  const peopleOn = overrides.people === true || r.people === true;
  let caps: CapLimits | undefined;
  try {
    caps = parseCaps(r.caps);
  } catch (e) {
    throw new ConfigError((e as Error).message);
  }
  if (overrides.maxRuns !== undefined) {
    caps = { sections: {}, ...caps };
    caps.totalRuns = caps.totalRuns === undefined ? overrides.maxRuns : Math.min(caps.totalRuns, overrides.maxRuns);
  }
  return {
    ...(caps ? { caps } : {}),
    domain,
    ...(typeof r.goal === "string" && r.goal.trim() ? { goal: r.goal.trim().slice(0, 80) } : {}),
    brand: String(r.brand ?? domain.split(".")[0]),
    offer: String(r.offer ?? ""),
    icp: {
      industries: strList(r.icp?.industries, "icp.industries"),
      sizeBand: String(r.icp?.sizeBand ?? "11-200"),
      geos: strList(r.icp?.geos, "icp.geos"),
      titles: strList(r.icp?.titles, "icp.titles"),
      useCaseTerms: strList(r.icp?.useCaseTerms, "icp.useCaseTerms").map((x) => x.toLowerCase().trim()).filter(Boolean).slice(0, 12),
    },
    seeds: strList(r.seeds, "seeds").map(cleanDomain).slice(0, 20),
    competitors: strList(r.competitors, "competitors").map(cleanDomain).slice(0, 10),
    keywords: strList(r.keywords, "keywords").slice(0, 50),
    questions: strList(r.questions, "questions").slice(0, 50),
    depth,
    limits: lim,
    people: peopleOn,
    phones: peopleOn && !overrides.noPhones && (overrides.phones ?? r.phones === true),
    committeePhones: peopleOn && !overrides.noPhones && (overrides.phones === true || r.phones === true || r.committeePhones === true),
    reviews: {
      mode: auto(r.reviews?.mode, "reviews.mode"),
      appStoreIds: strList(r.reviews?.appStoreIds, "reviews.appStoreIds"),
      mapsPlaces: strList(r.reviews?.mapsPlaces, "reviews.mapsPlaces"),
      competitors: domainMap(r.reviews?.competitors, "reviews.competitors", (x, f) => {
        const o = (x ?? {}) as Record<string, unknown>;
        if (typeof o !== "object" || Array.isArray(o)) throw new ConfigError(`${f} should have appStoreIds and mapsPlaces lists`);
        return { appStoreIds: strList(o.appStoreIds, `${f}.appStoreIds`), mapsPlaces: strList(o.mapsPlaces, `${f}.mapsPlaces`) };
      }),
    },
    local: { mode: auto(r.local?.mode, "local.mode"), queries: strList(r.local?.queries, "local.queries") },
    commerce: {
      mode: auto(r.commerce?.mode, "commerce.mode"),
      asins: strList(r.commerce?.asins, "commerce.asins"),
      competitors: domainMap(r.commerce?.competitors, "commerce.competitors", (x, f) => strList(x, f)),
    },
    categoryTerms: strList(r.categoryTerms, "categoryTerms").map((x) => x.toLowerCase()).slice(0, 40),
    category: strList(r.category, "category").map((x) => x.toLowerCase().trim()).filter(Boolean).slice(0, 5),
    rivalReasons: Object.fromEntries(Object.entries((r.rivalReasons && typeof r.rivalReasons === "object" && !Array.isArray(r.rivalReasons) ? r.rivalReasons : {}) as Record<string, unknown>).map(([k, v]) => [cleanDomain(k), String(v ?? "")])),
    excluded: strList(r.excluded, "excluded").map(cleanDomain),
    profiles: domainMap(r.profiles, "profiles", (x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const s2 = (k: string) => (o[k] === undefined || o[k] === null ? "" : String(o[k]).trim());
      return { name: s2("name"), logo: s2("logo"), linkedin: s2("linkedin"), linkedinId: s2("linkedinId"), x: s2("x").replace(/^@/, ""), facebook: s2("facebook") };
    }),
    target: {
      roles: strList(r.target?.roles, "target.roles"),
      sizes: strList(r.target?.sizes, "target.sizes"),
      industries: strList(r.target?.industries, "target.industries"),
      customers: strList(r.target?.customers, "target.customers"),
      useCases: strList(r.target?.useCases, "target.useCases"),
      sources: strList(r.target?.sources, "target.sources"),
    },
    linkedin: overrides.noLinkedin ? false : r.linkedin !== false,
    discovery: { by: ["agent", "rules", "draft"].includes(r.discovery?.by) ? r.discovery.by : "", at: String(r.discovery?.at ?? "") },
  };
}

/**
 * Every App Store id and Maps place to read, yours first. A competitor's entry comes back as
 * "<domain>:<id>", the form the reviews module reads. The older inline form "rival.com:123" in your
 * own lists still works.
 */
export function reviewEntries(cfg: Pick<GtmConfig, "reviews">): { appStore: string[]; maps: string[] } {
  const comp = Object.entries(cfg.reviews.competitors ?? {});
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    appStore: uniq([...cfg.reviews.appStoreIds, ...comp.flatMap(([d, l]) => l.appStoreIds.map((id) => `${d}:${id}`))]),
    maps: uniq([...cfg.reviews.mapsPlaces, ...comp.flatMap(([d, l]) => l.mapsPlaces.map((id) => `${d}:${id}`))]),
  };
}

/** Every ASIN to read, yours first, competitors as "<domain>:<ASIN>". */
export function asinEntries(cfg: Pick<GtmConfig, "commerce">): string[] {
  const comp = Object.entries(cfg.commerce.competitors ?? {}).flatMap(([d, list]) => list.map((a) => `${d}:${a}`));
  return [...new Set([...cfg.commerce.asins, ...comp])];
}

export function loadConfig(path: string, overrides: { depth?: Depth; phones?: boolean; noPhones?: boolean; maxRuns?: number; noLinkedin?: boolean; people?: boolean } = {}): GtmConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Cannot read ${path}. Run looot-zeus init <domain> first, or pass --config.`);
  }
  return normalizeConfig(YAML.parse(text), overrides);
}

/** Writes a config back as YAML with a short header the agent and the user can edit. */
export function configToYaml(cfg: GtmConfig, header: string[] = []): string {
  const head = header.map((l) => `# ${l}`).join("\n");
  return `${head}${head ? "\n" : ""}${YAML.stringify(cfg, { lineWidth: 0 })}`;
}

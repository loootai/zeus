// Module 1, icp. Your own domain and the seed customers in, an ideal customer profile and lookalike candidates out.
// Lifted from loootai/looot-lookalike (MIT): company normalising, shared seed traits and the
// weighted similarity score. Calls company.enrich (you and every seed), company.technographics
// (you and every seed) and company.similar (one call per seed, or your own domain when there is
// no seed). Every call goes through ctx.call, so it is capped, idempotent and on the receipt.
//
// The shared helpers at the top (normalising, provider trail, the call pool, the section shell)
// are also used by accounts, people and enrich.

import { CapReached } from "../cap.js";
import type { CallResult } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block, Section } from "../dossier/blocks.js";
import { usd } from "../util.js";
import { loadFixture } from "./fixture.js";
import type { GtmModule, ModuleContext, ModuleStatus, RenderOptions } from "./types.js";

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const PLACEHOLDER_SOURCE = "PLACEHOLDER data, invented to show the layout. A real run replaces it.";

/** Lower-case host of a URL or bare domain, without "www.". null when there is no host. */
export function hostOf(text: unknown): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const t = text.trim().toLowerCase();
  try {
    const h = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

const COUNTRIES: Record<string, string> = {
  "united states": "US", usa: "US", "united states of america": "US", "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", germany: "DE", france: "FR", spain: "ES", italy: "IT", netherlands: "NL", "the netherlands": "NL", belgium: "BE", switzerland: "CH", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", ireland: "IE", portugal: "PT", poland: "PL", austria: "AT", canada: "CA", australia: "AU", "new zealand": "NZ", india: "IN", singapore: "SG", japan: "JP", china: "CN", brazil: "BR", mexico: "MX", israel: "IL", "united arab emirates": "AE", "south africa": "ZA", morocco: "MA", turkey: "TR", estonia: "EE", lithuania: "LT", latvia: "LV", "czech republic": "CZ", czechia: "CZ", romania: "RO", ukraine: "UA", argentina: "AR", colombia: "CO", chile: "CL", "south korea": "KR",
};
const COUNTRY_NAME: Record<string, string> = { US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", BE: "Belgium", CH: "Switzerland", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", IE: "Ireland", PT: "Portugal", PL: "Poland", AT: "Austria", CA: "Canada", AU: "Australia", NZ: "New Zealand", IN: "India", SG: "Singapore", JP: "Japan", BR: "Brazil", MX: "Mexico", IL: "Israel", AE: "United Arab Emirates", ZA: "South Africa" };

/** Country as ISO alpha-2 when the text is a known name or code, else the lower-cased text. null when empty. */
export function countryKey(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim().toLowerCase();
  if (COUNTRIES[t]) return COUNTRIES[t];
  if (/^[a-z]{2}$/.test(t)) return t.toUpperCase();
  return t;
}

export function countryName(code: string): string {
  return COUNTRY_NAME[code] ?? code;
}

/** An employee count from a number or a range such as "51-200", "201 to 500 employees", "1,001+". A range gives its midpoint. */
export function parseEmployees(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const nums = (v.replace(/,/g, "").match(/\d+(\.\d+)?\s*[kK]?/g) ?? []).map((n) => (/[kK]/.test(n) ? parseFloat(n) * 1000 : parseFloat(n)));
  if (nums.length === 0) return null;
  if (nums.length >= 2 && /-|to|–/.test(v)) return Math.round((nums[0] + nums[1]) / 2);
  return Math.round(nums[0]);
}

/** "11-200" gives [11, 200]. "500+" gives [500, 5000]. Unreadable gives null. */
export function parseBand(band: string): [number, number] | null {
  const nums = (band.replace(/,/g, "").match(/\d+/g) ?? []).map(Number);
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  if (nums.length === 1) return /\+/.test(band) ? [nums[0], nums[0] * 10] : [nums[0], nums[0]];
  return null;
}

export function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,;|]/).map((x) => x.trim());
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? [x.trim()] : isObj(x) ? strings(x.name ?? x.label ?? x.title ?? x.slug ?? x.technology ?? x.tech) : []));
  if (isObj(v)) return strings(v.active ?? v.names ?? v.list ?? v.name);
  return [];
}

const clean = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()).filter((x) => x.length > 1 && x.length < 60))];
export const first = (o: Obj, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");
const path = (o: Obj, ...keys: string[]): unknown => keys.reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), o);

export interface Company {
  domain: string;
  name: string | null;
  industries: string[];
  employees: number | null;
  country: string | null;
  technologies: string[];
  keywords: string[];
  /** What the company says it does (provider description), when a provider returns it. */
  description?: string;
}

/** The company object inside a provider answer: unwraps `fields`, `data`, `company` and `result` wrappers. */
export function companyObject(result: unknown): Obj | null {
  let cur = result;
  for (let i = 0; i < 4 && isObj(cur); i++) {
    if (cur.domain || cur.name || cur.about || cur.category || cur.website) return cur;
    const inner = cur.fields ?? cur.data ?? cur.company ?? cur.result;
    if (!isObj(inner)) return cur;
    cur = inner;
  }
  return isObj(cur) ? cur : null;
}

/** Country-code TLDs sold as vanity domains (.ai, .io, .co): a provider country equal to one is a guess from the domain. */
const VANITY_TLDS = new Set(["ai", "io", "co", "so", "me", "tv", "gg", "ly", "fm", "sh", "to", "ws", "cc", "vc", "app", "dev", "is", "it", "am", "im", "md", "ms", "nu", "tk", "ac", "la", "xyz"]);

/** The country, unless it is only the vanity TLD read back as a country (smithery.ai as Anguilla). */
export function countryFor(domain: string, raw: string | null): string | null {
  const k = countryKey(raw);
  if (!k) return null;
  const tld = domain.toLowerCase().split(".").pop() ?? "";
  if (VANITY_TLDS.has(tld) && k.toLowerCase() === tld) return null;
  return k;
}

/** Reads one company from a provider row, under the field names the public docs use. null when there is no domain. */
export function normalizeCompany(row: unknown, fallbackDomain?: string): Company | null {
  if (!isObj(row)) return null;
  const link = isObj(row.link) ? row.link : {};
  const summary = isObj(row.summary) ? row.summary : {};
  const domainRaw = isObj(row.domain) ? row.domain.domain : first(row, ["domain", "website", "url", "company_domain", "homepage", "website_url", "websiteUrl"]);
  const domain = hostOf(domainRaw) ?? hostOf(path(row, "about", "website")) ?? hostOf(link.domain) ?? hostOf(link.website) ?? (fallbackDomain ? hostOf(fallbackDomain) : null);
  if (!domain || domain.includes("linkedin.com")) return null;
  const about = isObj(row.about) ? row.about : {};
  const category = isObj(row.category) ? row.category : {};
  const location = isObj(row.location) ? row.location : {};
  const hq = isObj(path(row, "locations", "headquarters")) ? (path(row, "locations", "headquarters") as Obj) : isObj(row.headquarters) ? (row.headquarters as Obj) : {};
  const geo = isObj(row.geo) ? row.geo : {};
  const countryRaw = first(row, ["country", "country_code", "countryCode", "hq_country"]) ?? path(row, "location", "headquarter", "country") ?? path(location, "country", "code") ?? path(location, "country", "name") ?? location.country ?? first(geo, ["countryCode", "country"]) ?? path(hq, "country", "code") ?? path(hq, "country", "name") ?? hq.country;
  // AI Ark: summary.staff.total is the counted headcount, summary.staff.range the self-declared band.
  const staffTotal = typeof path(summary, "staff", "total") === "number" ? (path(summary, "staff", "total") as number) : null;
  const employeesRaw = staffTotal ?? first(row, ["employees", "employee_count", "employeeCount", "totalEmployees", "employees_range", "employeesRange", "size", "headcount", "staff_count", "estimated_num_employees"]) ?? first(about, ["totalEmployees", "employees"]) ?? path(row, "metrics", "employees") ?? path(row, "metrics", "employeesRange") ?? (isObj(path(summary, "staff", "range")) ? (() => {
    const r = path(summary, "staff", "range") as Obj;
    return typeof r.start === "number" && typeof r.end === "number" ? Math.round((r.start + r.end) / 2) : null;
  })() : null);
  const industries = [...strings(first(row, ["industries", "industry", "industry_name", "sector"])), ...strings(about.industries), ...strings(category.industry), ...strings(category.sector), ...strings(summary.industry)];
  const technologies = [...strings(first(row, ["technologies", "tech", "techStack", "tech_stack", "tech_tags"])), ...strings(path(row, "technologies", "active"))];
  const name = first(row, ["name", "company_name", "companyName", "legalName", "display_name"]) ?? about.name ?? summary.name ?? null;
  return {
    domain,
    name: typeof name === "string" ? name : null,
    industries: clean(industries),
    employees: parseEmployees(employeesRaw),
    country: countryFor(domain, typeof countryRaw === "string" ? countryRaw : null),
    technologies: clean(technologies),
    keywords: clean([...strings(first(row, ["keywords", "tags", "specialties", "topics", "keyword_tags"])), ...strings(about.keywords)]),
    ...(() => {
      const d = [summary.description, summary.overview, row.description, row.short_description, row.shortDescription, about.description, row.about_us, row.tagline, row.seo_description].find((x) => typeof x === "string" && x.trim());
      return typeof d === "string" ? { description: d.replace(/\s+/g, " ").trim().slice(0, 1200) } : {};
    })(),
  };
}

/** The rows of a search answer: the first array of objects, looking in the usual wrapper keys first. */
export function rowsOf(result: unknown): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result)) return [];
  for (const k of ["companies", "people", "persons", "contacts", "items", "results", "data", "organizations", "records", "fields"]) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = rowsOf(v);
      if (inner.length > 0) return inner;
    }
  }
  for (const v of Object.values(result)) if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v.filter(isObj);
  return [];
}

/** The places a run answer can sit, most specific first. */
export function payloads(res: CallResult): unknown[] {
  const n = res.run.normalized as Obj | undefined;
  return [n?.fields, n, res.run.result, res.data].filter((x) => x !== undefined && x !== null);
}

/** True when looot settled the call with an answer (first provider or a later one). */
export const answered = (res: CallResult) => res.record.outcome === "hit" || res.record.outcome === "fallback";

/** One line per paid call, kept in the module output and shown in the dossier when it was not a plain hit. */
export interface CallTrail {
  step: string;
  job: string;
  outcome: string;
  provider: string;
  trail: string;
  charged: number;
}

const ATTEMPT_WORD: Record<string, string> = { hit: "hit", weak: "hit", miss: "miss", error: "fail", rejected: "fail", skipped: "skipped", pending: "pending" };

/** "kittai miss → findymail hit". Built from the route attempts looot returns, else from the ledger line. */
export function trailOf(res: CallResult): string {
  const attempts = res.run.route?.attempts ?? [];
  if (attempts.length > 0) {
    return attempts
      .map((a) => `${a.provider ?? a.endpointId ?? "provider"} ${ATTEMPT_WORD[(a.outcome ?? a.status ?? "").toLowerCase()] ?? (a.outcome ?? a.status ?? "?")}`)
      .join(" → ");
  }
  const r = res.record;
  return `${r.provider} ${r.outcome}${r.note ? ` (${r.note})` : ""}`;
}

export function trailLine(step: string, res: CallResult): CallTrail {
  return { step, job: res.record.job, outcome: res.record.outcome, provider: res.record.provider, trail: trailOf(res), charged: res.record.charged };
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runs fn over items, n at a time. When one call hits the cap, no new item starts, the ones in
 * flight finish, then CapReached is thrown again so the pipeline marks the module capped.
 */
export async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let stop: unknown = null;
  const worker = async () => {
    while (stop === null && next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (e) {
        if (stop === null) stop = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  if (stop !== null) throw stop;
}

export const isCap = (e: unknown): e is CapReached => e instanceof CapReached;

/** Totals of the trail, for the summary and the honesty note. */
export function tally(calls: CallTrail[]) {
  const by = (o: string) => calls.filter((c) => c.outcome === o);
  const sum = (xs: CallTrail[]) => xs.reduce((n, c) => n + c.charged, 0);
  return {
    calls: calls.length,
    misses: by("miss").length,
    missCharged: sum(by("miss")),
    fails: by("fail").length,
    failCharged: sum(by("fail")),
    fallbacks: by("fallback").length,
    charged: sum(calls),
  };
}

/** The note that says what misses and failures cost, read from the ledger. Never assumes $0. */
export function costNote(calls: CallTrail[]): Block | null {
  const t = tally(calls);
  if (t.calls === 0) return null;
  const parts = [`${t.calls} paid calls, ${usd(t.charged)} charged`];
  if (t.fallbacks > 0) parts.push(`${t.fallbacks} answered by a later provider`);
  if (t.misses > 0) parts.push(`${t.misses} misses charged ${usd(t.missCharged)} in total (some providers bill a not found)`);
  if (t.fails > 0) parts.push(`${t.fails} failed calls charged ${usd(t.failCharged)}`);
  return { kind: "note", text: `${parts.join(". ")}. Every call is in receipt.md.` };
}

/** Calls that were not a plain first-provider hit, as a table. */
export function trailTable(calls: CallTrail[], limit = 20): Block | null {
  const rows = calls.filter((c) => c.outcome !== "hit");
  if (rows.length === 0) return null;
  return {
    kind: "table",
    caption: rows.length > limit ? `Provider trail, misses, failures and fallbacks (first ${limit} of ${rows.length})` : "Provider trail, misses, failures and fallbacks",
    columns: [{ key: "step", label: "Call" }, { key: "job", label: "Job" }, { key: "trail", label: "Trail" }, { key: "charged", label: "Charged", num: true }],
    rows: rows.slice(0, limit).map((c) => ({ ...c, charged: usd(c.charged) })),
  };
}

export interface ShellSpec {
  num: string;
  id: string;
  title: string;
  deeper?: string;
  activate?: string;
}

/**
 * The section for one module. Placeholder output says so in the source line. A capped module
 * that kept partial output shows it with a note on top. No output at all shows the reason.
 */
export function shell(spec: ShellSpec, out: any, status: ModuleStatus, body: (o: any) => Block[]): Section {
  const base = { num: spec.num, id: spec.id, title: spec.title, status, deeper: spec.deeper, activate: spec.activate };
  const hasRows = out && !out.skipped && (status === "done" || status === "capped");
  if (!hasRows) {
    const why = out?.summary ?? (status === "capped" ? "stopped at the cap before this module ran" : "skipped");
    return { ...base, source: "", blocks: [{ kind: "note", text: why }] };
  }
  const blocks: Block[] = [];
  if (status === "capped") blocks.push({ kind: "note", text: "The run stopped at the cap during this module. What it found before the stop is below." });
  if (out.summary) blocks.push({ kind: "text", text: out.summary });
  blocks.push(...body(out));
  const source = out.placeholder ? PLACEHOLDER_SOURCE : [out.provider, out.date].filter(Boolean).join(", ") || "looot";
  return { ...base, source, blocks };
}

// ---------------------------------------------------------------------------------------------
// The icp module
// ---------------------------------------------------------------------------------------------

export interface TraitValue {
  value: string;
  share: number;
  n: number;
}

export interface Traits {
  seeds: number;
  industries: TraitValue[];
  technologies: TraitValue[];
  countries: TraitValue[];
  size: { min: number; max: number } | null;
}

/** Values at least minShare of the seeds that report the field share, strongest first. */
function shared(seeds: Company[], pick: (c: Company) => string[], minShare: number, max: number): TraitValue[] {
  const withData = seeds.filter((c) => pick(c).length > 0);
  if (withData.length === 0) return [];
  const count = new Map<string, number>();
  for (const c of withData) for (const v of new Set(pick(c))) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()]
    .map(([value, n]) => ({ value, n, share: Math.round((n / withData.length) * 100) / 100 }))
    .filter((t) => t.share >= minShare)
    .sort((a, b) => b.share - a.share || a.value.localeCompare(b.value))
    .slice(0, max);
}

/** The shared traits of the seeds (lifted from looot-lookalike). */
export function deriveTraits(seeds: Company[], minShare = 0.4): Traits {
  const sizes = seeds.map((c) => c.employees).filter((n): n is number => n !== null && n > 0);
  return {
    seeds: seeds.length,
    industries: shared(seeds, (c) => c.industries, minShare, 6),
    technologies: shared(seeds, (c) => c.technologies, minShare, 10),
    countries: shared(seeds, (c) => (c.country ? [c.country] : []), minShare, 5),
    size: sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
  };
}

/** Size similarity: 1 inside the range, falling to 0 at ten times outside it (log scale). */
export function sizeSimilarity(employees: number, range: { min: number; max: number }): number {
  if (employees >= range.min && employees <= range.max) return 1;
  const factor = employees < range.min ? range.min / Math.max(1, employees) : employees / range.max;
  return Math.max(0, 1 - Math.log10(factor));
}

export interface Lookalike {
  domain: string;
  name: string;
  industry: string;
  employees: number | null;
  country: string | null;
  similarity: string;
  seed: string;
  provider: string;
  date: string;
  /** How many seeds returned it. */
  seeds: number;
}

interface Candidate {
  company: Company;
  seeds: string[];
  ranks: number[];
  provider: string;
}

/**
 * Weighted similarity of a candidate to the seed traits, 0 to 1. Industry 0.35, size 0.25,
 * country 0.15, agreement (how many seeds returned it and how high) 0.25. A trait the candidate
 * has no data for is left out of the weight instead of counted as a mismatch.
 */
export function similarity(c: Candidate, traits: Traits, seedCount: number): number {
  const parts: [number, number][] = [];
  if (traits.industries.length > 0 && c.company.industries.length > 0) {
    const hit = traits.industries.filter((t) => c.company.industries.some((i) => i === t.value || i.includes(t.value) || t.value.includes(i)));
    const top = traits.industries[0].share || 1;
    parts.push([0.35, hit.length > 0 ? Math.min(1, Math.max(...hit.map((t) => t.share)) / top) : 0]);
  }
  if (traits.size && c.company.employees !== null) parts.push([0.25, sizeSimilarity(c.company.employees, traits.size)]);
  if (traits.countries.length > 0 && c.company.country) {
    const reg = traits.countries.find((t) => t.value === c.company.country);
    parts.push([0.15, reg ? Math.min(1, reg.share / (traits.countries[0].share || 1)) : 0]);
  }
  const rankPart = c.ranks.reduce((n, r) => n + 1 / (1 + Math.log2(r)), 0) / Math.max(1, c.ranks.length);
  const agree = Math.min(1, (c.seeds.length / Math.max(1, Math.min(seedCount, 3))) * 0.5 + rankPart * 0.5);
  parts.push([0.25, agree]);
  const w = parts.reduce((n, [x]) => n + x, 0);
  return w > 0 ? Math.round((parts.reduce((n, [x, s]) => n + x * s, 0) / w) * 100) / 100 : 0;
}

/** Technology names out of a technographics answer, whatever the provider called them. */
export function techOf(data: unknown): string[] {
  const rows = rowsOf(data);
  const fromRows = rows.flatMap((r) => strings(first(r, ["name", "technology", "tech", "title", "Name"])));
  const obj = companyObject(data);
  const fromObj = obj ? strings(first(obj, ["technologies", "tech", "techStack", "tech_stack"])) : [];
  return clean([...fromRows, ...fromObj]).slice(0, 40);
}

export interface IcpCard {
  industries: string[];
  sizeBand: string;
  geos: string[];
  titles: string[];
  stack: string[];
  evidence: { claim: string; provider: string; date: string }[];
  /** Where each field came from, "seeds" or "config". */
  from: Record<string, "seeds" | "config">;
}

export interface IcpOut {
  placeholder?: string;
  summary: string;
  provider?: string;
  date?: string;
  own?: Company | null;
  card: IcpCard;
  lookalikes: Lookalike[];
  traits?: Traits;
  seedsResolved?: number;
  calls?: CallTrail[];
}

/** Builds the card from the traits, falling back to the intake draft field by field. Pure. */
export function buildCard(cfg: GtmConfig, traits: Traits | null, seedProvider: string, techProvider: string, own: Company | null, ownProvider: string, date: string): IcpCard {
  const from: IcpCard["from"] = {};
  const evidence: IcpCard["evidence"] = [];
  const t = traits && traits.seeds > 0 ? traits : null;
  // One seed is an anecdote: it may set the industries, but size and countries need two seeds that agree.
  const firm = !!t && t.seeds >= 2;
  let industries = cfg.icp.industries;
  from.industries = "config";
  if (t && t.industries.length > 0) {
    industries = t.industries.map((x) => x.value);
    from.industries = "seeds";
    evidence.push({ claim: `${t.industries[0].n} of ${t.seeds} seeds list ${t.industries[0].value}`, provider: seedProvider, date });
  }
  let sizeBand = cfg.icp.sizeBand;
  from.sizeBand = "config";
  if (firm && t?.size) {
    sizeBand = `${t.size.min}-${t.size.max}`;
    from.sizeBand = "seeds";
    evidence.push({ claim: `Seeds sit between ${t.size.min} and ${t.size.max} employees`, provider: seedProvider, date });
  }
  let geos = cfg.icp.geos;
  from.geos = "config";
  if (firm && t && t.countries.length > 0 && t.countries[0].n >= 2) {
    geos = t.countries.map((c) => countryName(c.value));
    from.geos = "seeds";
    evidence.push({ claim: `${t.countries[0].n} of ${t.seeds} seeds are based in ${countryName(t.countries[0].value)}`, provider: seedProvider, date });
  }
  from.titles = "config";
  const stack = t ? t.technologies.map((x) => `${x.value} (${x.n} of ${t.seeds} seeds)`) : [];
  if (t && t.technologies.length > 0) evidence.push({ claim: `Seeds share ${t.technologies.slice(0, 3).map((x) => x.value).join(", ")}`, provider: techProvider, date });
  if (own) {
    const bits = [own.industries[0], own.employees !== null ? `${own.employees} staff` : null, own.country ? countryName(own.country) : null].filter(Boolean);
    if (bits.length > 0) evidence.push({ claim: `${own.domain} is listed as ${bits.join(", ")}`, provider: ownProvider, date });
  }
  if (!t) evidence.push({ claim: "No seed resolved, the card keeps the intake draft from config.yaml", provider: "intake", date });
  return { industries, sizeBand, geos, titles: cfg.icp.titles, stack, evidence, from };
}

const SPEC: ShellSpec = {
  num: "01",
  id: "icp",
  title: "Ideal customer profile",
  deeper: "github.com/loootai/looot-lookalike, npm run lookalike -- --seeds seeds.txt --cap 1",
  activate: "Add the top lookalikes to accounts with looot-zeus run --only accounts",
};

export const LOOKALIKES_KEPT = 25;
export const SIMILAR_PER_SEED = 5;
/** Stack lookups: you and the first two seeds. They only add a stack line, so they run last. */
export const TECH_CALLS = 3;

export const icp: GtmModule = {
  id: "icp",
  label: "ICP",
  needs: ["intake"],
  quote: (cfg) => ({
    lines: [
      { job: "company.enrich", calls: 1 + cfg.seeds.length, note: "your own domain and every seed" },
      { job: "company.similar", calls: cfg.seeds.length + 1, rows: SIMILAR_PER_SEED, note: "lookalikes per seed, and of your own domain when fewer than 2 seeds resolve" },
      { job: "company.technographics", calls: Math.min(1 + cfg.seeds.length, TECH_CALLS), note: "you and the first seeds, after the lookalikes" },
    ],
  }),
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") {
      const f = loadFixture<IcpOut>("icp");
      return { status: "done", summary: f.summary, out: f };
    }
    const cfg = ctx.cfg;
    const date = today();
    const calls: CallTrail[] = [];
    const companies = new Map<string, Company>();
    const techs = new Map<string, string[]>();
    const providers = { enrich: "", tech: "", similar: "" };
    const cands = new Map<string, Candidate>();
    const exclude = new Set([cfg.domain, ...cfg.seeds, ...cfg.competitors]);
    const domains = [cfg.domain, ...cfg.seeds];

    const build = (): IcpOut => {
      const seedCos = cfg.seeds.map((d) => companies.get(d)).filter((c): c is Company => !!c).map((c) => ({ ...c, technologies: techs.get(c.domain) ?? c.technologies }));
      const traits = seedCos.length > 0 ? deriveTraits(seedCos, seedCos.length === 1 ? 1 : 0.4) : null;
      const ownCo = companies.get(cfg.domain) ?? null;
      const own = ownCo ? { ...ownCo, technologies: techs.get(cfg.domain) ?? ownCo.technologies } : null;
      const card = buildCard(cfg, traits, providers.enrich || "company.enrich", providers.tech || "company.technographics", own, providers.enrich || "company.enrich", date);
      const t: Traits = traits ?? { seeds: 0, industries: [], technologies: [], countries: [], size: null };
      const seedCount = Math.max(1, cfg.seeds.length);
      const lookalikes = [...cands.values()]
        .map((c) => ({ c, s: similarity(c, t, seedCount) }))
        .sort((a, b) => b.s - a.s || b.c.seeds.length - a.c.seeds.length || a.c.company.domain.localeCompare(b.c.company.domain))
        .slice(0, LOOKALIKES_KEPT)
        .map(({ c, s }): Lookalike => ({
          domain: c.company.domain,
          name: c.company.name ?? c.company.domain,
          industry: c.company.industries[0] ?? "",
          employees: c.company.employees,
          country: c.company.country,
          similarity: s.toFixed(2),
          seed: c.seeds.join(", "),
          provider: c.provider,
          date,
          seeds: c.seeds.length,
        }));
      const tl = tally(calls);
      const miss = tl.misses + tl.fails;
      const summary = `ideal customer written from ${seedCos.length} of ${cfg.seeds.length} seeds, ${lookalikes.length} lookalike candidates${miss > 0 ? `, ${miss} calls came back empty or failed` : ""}`;
      const used = [...new Set([providers.enrich, providers.similar, providers.tech].filter(Boolean))];
      return { summary, provider: used.join(", ") || undefined, date, own, card, lookalikes, traits: t, seedsResolved: seedCos.length, calls };
    };

    try {
      await pool(domains, 4, async (d) => {
        const res = await ctx.call("company.enrich", { domain: d }, `enrich:${d}`);
        calls.push(trailLine(`enrich ${d}`, res));
        if (answered(res)) {
          const c = payloads(res).map((p) => normalizeCompany(companyObject(p), d)).find((x) => x && (x.industries.length > 0 || x.employees !== null || x.country));
          if (c) {
            companies.set(d, { ...c, domain: d });
            providers.enrich ||= res.record.provider;
          }
        }
        ctx.partial(build());
      });
      const similar = async (seed: string) => {
        const res = await ctx.call("company.similar", { domain: seed, limit: SIMILAR_PER_SEED }, `similar:${seed}`);
        calls.push(trailLine(`similar ${seed}`, res));
        if (answered(res)) {
          const rows = payloads(res).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
          rows
            .map((r) => normalizeCompany(r))
            .filter((c): c is Company => !!c && !exclude.has(c.domain))
            .forEach((c, i) => {
              const cur = cands.get(c.domain);
              if (cur) {
                if (!cur.seeds.includes(seed)) cur.seeds.push(seed);
                cur.ranks.push(i + 1);
                cur.company.industries = cur.company.industries.length ? cur.company.industries : c.industries;
                cur.company.employees ??= c.employees;
                cur.company.country ??= c.country;
              } else cands.set(c.domain, { company: c, seeds: [seed], ranks: [i + 1], provider: res.record.provider });
            });
          providers.similar ||= res.record.provider;
        }
        ctx.partial(build());
      };
      // Lookalikes before the stack: they feed accounts. Seeds a provider knows go first.
      const bases = [...cfg.seeds].sort((a, b) => Number(companies.has(b)) - Number(companies.has(a)));
      await pool(bases, 4, similar);
      // Fallback: too few seeds resolved, or none gave a lookalike. Companies like your own domain.
      const resolved = cfg.seeds.filter((d) => companies.has(d)).length;
      if (resolved < 2 || cands.size === 0) await similar(cfg.domain);
      await pool(domains.slice(0, TECH_CALLS), 3, async (d) => {
        const res = await ctx.call("company.technographics", { domain: d }, `tech:${d}`);
        calls.push(trailLine(`tech ${d}`, res));
        if (answered(res)) {
          const list = payloads(res).map(techOf).find((x) => x.length > 0) ?? [];
          if (list.length > 0) {
            techs.set(d, list);
            providers.tech ||= res.record.provider;
          }
        }
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
    return shell(SPEC, out, status, (f: IcpOut) => {
      const blocks: Block[] = [
        { kind: "kv", items: [
          { label: "Industries", value: f.card.industries.join(", ") || "none found, fill in config.yaml" },
          { label: "Size", value: `${f.card.sizeBand} employees` },
          { label: "Geographies", value: f.card.geos.join(", ") },
          { label: "Titles", value: f.card.titles.join(", ") },
          { label: "Shared stack", value: f.card.stack.join(", ") || "no shared technology found" },
        ] },
        { kind: "table", caption: "Evidence", columns: [{ key: "claim", label: "Claim" }, { key: "provider", label: "Provider" }, { key: "date", label: "Date" }], rows: f.card.evidence },
      ];
      if (f.lookalikes.length > 0) {
        blocks.push({ kind: "table", caption: "Lookalike candidates", columns: [{ key: "name", label: "Company" }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "similarity", label: "Similarity", num: true }, { key: "seed", label: "Seed" }, { key: "provider", label: "Provider" }], rows: f.lookalikes.map((r) => ({ ...r })) });
      } else blocks.push({ kind: "note", text: "No lookalike came back. Accounts falls back to a search on the ideal customer profile." });
      const tt = trailTable(f.calls ?? []);
      if (tt) blocks.push(tt);
      const cn = costNote(f.calls ?? []);
      if (cn) blocks.push(cn);
      return blocks;
    });
  },
};

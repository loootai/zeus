// Module 12B, domains. The registry's own RDAP record for you and each rival: registrar, created and
// expiry dates and the domain's age. One domain.rdap.lookup call per domain, $0 a lookup (looot's own
// RDAP route, registry picked by IANA's bootstrap). The answer carries no contact data. A TLD looot
// does not serve yet is a $0 miss and the row says so. Company-level only, no LinkedIn.

import type { CallRecord } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { answered, emptyTally, fixture, frame, nameOfDomain, obj, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail } from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const RDAP_JOB = "domain.rdap.lookup";
const isObj = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

export function domainSites(cfg: Pick<GtmConfig, "domain" | "competitors">): { domain: string; about: string }[] {
  return [{ domain: cfg.domain, about: "you" }, ...cfg.competitors.map((d) => ({ domain: d, about: nameOfDomain(d) }))];
}

export function domainsQuote(cfg: GtmConfig): ModuleQuote {
  return { lines: [{ job: RDAP_JOB, calls: domainSites(cfg).length, note: "you and each rival, free RDAP lookup" }] };
}

export interface RdapFacts { registrar: string | null; createdAt: string | null; expiresAt: string | null; registry: string | null }

/** Reads a domain.rdap.lookup answer ({ registrar: { name }, createdAt, expiresAt, registry }), unwrapping data/result. */
export function parseRdap(raw: unknown, depth = 0): RdapFacts | null {
  if (depth > 3 || !isObj(raw)) return null;
  const o = obj(raw);
  if (Array.isArray(o.events) || (Array.isArray(o.entities) && "ldhName" in o)) return parseRawRdap(o);
  if ("createdAt" in o || "expiresAt" in o || "registrar" in o) {
    const day = (v: unknown) => (str(v) ?? "").slice(0, 10) || null;
    return { registrar: str(obj(o.registrar).name, typeof o.registrar === "string" ? o.registrar : null), createdAt: day(o.createdAt), expiresAt: day(o.expiresAt), registry: str(o.registry) };
  }
  for (const k of ["data", "result", "output", "body"]) {
    const inner = parseRdap(o[k], depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** The registrar's name from a raw RDAP entity: vcardArray fn, else the handle-free publicIds are ignored. */
function registrarOf(entities: unknown): string | null {
  if (!Array.isArray(entities)) return null;
  for (const e of entities) {
    const x = obj(e);
    if (!Array.isArray(x.roles) || !x.roles.includes("registrar")) continue;
    const card = Array.isArray(x.vcardArray) ? x.vcardArray[1] : null;
    if (Array.isArray(card)) for (const p of card) if (Array.isArray(p) && p[0] === "fn" && typeof p[3] === "string" && p[3].trim()) return p[3].trim();
  }
  return null;
}

/** Reads a raw registry RDAP domain record (RFC 9083: events and entities), as Verisign, PIR and SIDN answer it. */
export function parseRawRdap(o: Record<string, unknown>): RdapFacts {
  const ev = (action: string) => {
    const e = (Array.isArray(o.events) ? o.events : []).map(obj).find((x) => x.eventAction === action);
    return e ? (str(e.eventDate) ?? "").slice(0, 10) || null : null;
  };
  return { registrar: registrarOf(o.entities), createdAt: ev("registration"), expiresAt: ev("expiration"), registry: str(o.port43) };
}

/** Whole years between two YYYY-MM-DD dates, or null. */
export function yearsBetween(from: string | null, to: string): number | null {
  if (!from) return null;
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return Math.max(0, y);
}

export type DomainRow = { about: string; domain: string; age: string; registrar: string; created: string; expires: string; status: string; provider: string };
export interface DomainsOut { placeholder?: string; summary: string; provider: string; date: string; rows: DomainRow[]; calls?: string }

export function domainRow(site: { domain: string; about: string }, f: RdapFacts | null, status: string, provider: string, now: string): DomainRow {
  const age = yearsBetween(f?.createdAt ?? null, now);
  return { about: site.about, domain: site.domain, age: age === null ? "-" : `${age} ${age === 1 ? "year" : "years"}`, registrar: f?.registrar ?? "-", created: f?.createdAt ?? "-", expires: f?.expiresAt ?? "-", status, provider };
}

function summaryOf(rows: DomainRow[]): string {
  const you = rows.find((r) => r.about === "you");
  const known = rows.filter((r) => r.age !== "-").length;
  return you && you.age !== "-" ? `your domain is ${you.age} old, registry records for ${known} of ${rows.length} domains` : `registry records for ${known} of ${rows.length} domains`;
}

async function run(ctx: ModuleContext) {
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const sites = domainSites(ctx.cfg);
  const rows: DomainRow[] = [];
  const now = today();
  const build = (): DomainsOut => {
    const ordered = sites.map((s) => rows.find((r) => r.domain === s.domain)).filter((r): r is DomainRow => !!r);
    return { summary: summaryOf(ordered), provider: providersOf(calls), date: now, rows: ordered, calls: tallyLine(t) };
  };
  try {
    await pool(sites, 3, async (s) => {
      const r = await tracked(ctx, t, calls, RDAP_JOB, { domain: s.domain }, `domain:${s.domain}`);
      const f = answered(r) ? parseRdap(r.data) : null;
      rows.push(domainRow(s, f, answered(r) ? "answered" : outcomeText(r.record), trail(r.record), now));
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`domains: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: DomainsOut): Block[] {
  return [
    { kind: "table", caption: "Domain registration", columns: [{ key: "about", label: "Site" }, { key: "domain", label: "Domain" }, { key: "age", label: "Age" }, { key: "registrar", label: "Registrar" }, { key: "created", label: "Created" }, { key: "expires", label: "Expires" }, { key: "status", label: "Answer" }], rows: o.rows },
    { kind: "note", text: "From each registry's RDAP record. No contact data is read. A domain whose registry looot does not serve yet shows no answer." },
  ];
}

export const domains: GtmModule = {
  id: "domains",
  label: "Domains",
  needs: ["intake"],
  quote: domainsQuote,
  async run(ctx) {
    if (ctx.mode === "demo") {
      const f = fixture("domains");
      return { status: "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "12B", id: "domains", title: "Domains", activate: "Check that your own domain renews before the expiry date" }, out, status, (o) => blocks(o as DomainsOut)),
};

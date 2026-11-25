// Phone numbers for people on a buying committee. A short waterfall, cheapest first, stops at the first
// usable number: the routed people.phone.find (QuickEnrich first, it bills only a hit), then LeadMagic's
// mobile finder pinned, then (with --phones) Limadata pinned, which bills $0.20 only on a hit. Every account
// also gets its main line, read from a tel: link on the home or contact page. It is labelled "Company line"
// and shows on the card. Tomba on the company domain was tried on 5 Nov 2026 and found none of 19, so it is
// not called.
//
// Every number is labelled Mobile, Direct or Company line. A number with no line type from the provider
// counts as Mobile: treat it as personal. Providers return numbers in many shapes (national digits with a
// separate country code, 44 7... without the plus, +1 (555) ...), so readPhoneInfo turns them into E.164.

import type { CallResult } from "../client.js";
import { findValue } from "./enrich.js";
import { answered, type CallTrail, payloads, trailLine } from "./icp.js";
import type { ModuleContext } from "./types.js";

export type PhoneType = "Mobile" | "Direct" | "Company line";

export interface PhoneInfo {
  /** E.164 when the country is known, else the digits with a plus when the provider gave one. */
  phone: string;
  type: PhoneType | "";
  /** The provider that returned it. */
  source: string;
}

/** Dial codes for the countries providers name most. A number from elsewhere keeps its own plus prefix. */
const DIAL: Record<string, string> = {
  US: "1", CA: "1", GB: "44", UK: "44", IE: "353", FR: "33", DE: "49", NL: "31", BE: "32", LU: "352", CH: "41", AT: "43",
  ES: "34", PT: "351", IT: "39", SE: "46", NO: "47", DK: "45", FI: "358", PL: "48", CZ: "420", AU: "61", NZ: "64",
  SG: "65", IN: "91", AE: "971", IL: "972", ZA: "27", BR: "55", MX: "52", JP: "81", HK: "852",
};
/** Shortest national number per dial code, for the countries providers name most. */
const MIN_NATIONAL: Record<string, number> = { "1": 10, "44": 9, "31": 9, "41": 9, "33": 9, "32": 8, "34": 9, "39": 6, "46": 7, "45": 8, "47": 8, "65": 8, "61": 9, "91": 10, "972": 8, "971": 8, "353": 7, "351": 9, "49": 6 };
const NAMES: Record<string, string> = { "united states": "US", usa: "US", "united kingdom": "GB", england: "GB", canada: "CA", netherlands: "NL", switzerland: "CH", germany: "DE", france: "FR", ireland: "IE", spain: "ES", portugal: "PT", singapore: "SG", australia: "AU", india: "IN", israel: "IL", belgium: "BE" };

const NUMBER_KEYS = ["employee_phone", "mobile_number", "mobile_phone", "mobilePhone", "direct_dial", "direct_phone", "e164", "international_format", "phone_number", "phoneNumber", "mobile", "phone", "number"];
const TYPE_KEYS = ["employee_phone_type", "line_type", "lineType", "phone_type", "phoneType", "number_type", "type"];
const COUNTRY_KEYS = ["country_code", "countryCode", "country"];

function iso(country: string): string {
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return NAMES[c.toLowerCase()] ?? "";
}

/**
 * One number in E.164 form, or "" when it fails a basic check: 8 to 15 digits, not one or two digits
 * repeated, not a run like 123456789. National numbers ("07700 900123", "6465550100") need the country to get a prefix.
 */
export function normalizePhone(raw: string, country = ""): string {
  const s = String(raw ?? "").trim();
  if (!/\d/.test(s)) return "";
  let digits = s.replace(/\D/g, "");
  const code = DIAL[iso(country)] ?? "";
  if (s.startsWith("+")) {
    // keep as is
  } else if (s.startsWith("00")) digits = digits.slice(2);
  else if (code && digits.startsWith(code) && digits.length >= code.length + 9) {
    // already carries the country code without a plus (44 7700 900123)
  } else if (code) digits = code + digits.replace(/^0/, "");
  else return "";
  if (digits.length < 8 || digits.length > 15) return "";
  // A national part shorter than the country uses is a cut-off number (Limadata sent 7 digits for a Dutch mobile).
  const cc = Object.keys(MIN_NATIONAL).filter((c) => digits.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  if (cc && digits.length - cc.length < MIN_NATIONAL[cc]) return "";
  const nat = digits.slice(-9);
  if (new Set(nat).size <= 2 || /^(?:0?12345678|987654321)/.test(nat)) return "";
  return `+${digits}`;
}

/** The line type a provider gave, in our three labels. Unknown counts as Mobile (treat as personal). */
export function lineType(hint: string): PhoneType {
  const h = hint.toLowerCase();
  if (/mobile|cell|wireless|personal/.test(h)) return "Mobile";
  if (/direct|work|office|landline|fixed|business|hq|main/.test(h)) return "Direct";
  return "Mobile";
}

/** The number in a phone answer, its line type and the provider. Empty phone when the answer has none. */
export function readPhoneInfo(res: CallResult, countryHint = ""): PhoneInfo {
  for (const p of payloads(res)) {
    const raw = findValue(p, NUMBER_KEYS);
    if (!raw) continue;
    const country = findValue(p, COUNTRY_KEYS) || countryHint;
    const phone = normalizePhone(raw, country) || normalizePhone(raw, countryHint);
    if (!phone) continue;
    const hint = findValue(p, TYPE_KEYS);
    return { phone, type: lineType(hint), source: res.record.provider };
  }
  return { phone: "", type: "", source: "" };
}

/** Inputs each phone provider reads, under the names they use. Extra keys are ignored by the others. */
export function phoneInput(p: { linkedin?: string; email?: string; firstName?: string; lastName?: string; name?: string }, domain: string): Record<string, unknown> {
  if (p.linkedin) return { linkedin_url: p.linkedin, linkedin: p.linkedin, profile_url: p.linkedin, ...(p.email ? { email: p.email, work_email: p.email } : {}) };
  const out: Record<string, unknown> = { first_name: p.firstName, last_name: p.lastName, name: p.name, domain, company_url: domain, company_domain: domain };
  if (p.email) Object.assign(out, { email: p.email, work_email: p.email });
  return out;
}

/** The phone jobs one person may cost, in waterfall order. The quote and the run use the same list. */
/** People per committee who get the later phone steps: the economic buyer and the champion, picked first. */
export const LATER_STEP_PEOPLE = 2;
export const PERSON_STEPS = ["people.phone.find", "people.phone.find.mobile", "people.phone.find.deep"] as const;

/**
 * Runs the person waterfall. Stops at the first usable number. Calls go through ctx.call, so the cap and
 * the receipt see each one. Returns the number (or none) and the trail lines for the cost section.
 */
export async function findPersonPhone(
  ctx: Pick<ModuleContext, "call">,
  p: { linkedin?: string; email?: string; firstName?: string; lastName?: string; name?: string },
  domain: string,
  country: string,
  step: string,
  opts: { later?: boolean; deep?: boolean } = {},
): Promise<{ info: PhoneInfo; calls: CallTrail[] }> {
  const calls: CallTrail[] = [];
  const input = phoneInput(p, domain);
  // later: the paid later steps (the first two people per committee). deep: Limadata, only with --phones.
  const steps = opts.later === false ? PERSON_STEPS.slice(0, 1) : opts.deep ? PERSON_STEPS : PERSON_STEPS.slice(0, 2);
  for (const job of steps) {
    const r = await ctx.call(job, input, `${step}:${job}`);
    calls.push(trailLine(`phone ${domain}`, r));
    if (!answered(r)) continue;
    const info = readPhoneInfo(r, country);
    if (info.phone) return { info, calls };
  }
  return { info: { phone: "", type: "", source: "" }, calls };
}

const TEL = /tel:(\+?[\d\s().%-]{7,24})/gi;

/** The first tel: link in a scraped page that passes normalizePhone, else "". */
export function telFromPage(res: CallResult, country: string): string {
  const text = JSON.stringify(payloads(res)).replace(/%20/g, " ");
  for (const m of text.matchAll(TEL)) {
    const n = normalizePhone(m[1], country);
    if (n) return n;
  }
  return "";
}

/** The account's main line from a tel: link on the home page, else the contact page. Labelled Company line. */
export async function findCompanyLine(ctx: Pick<ModuleContext, "call">, domain: string, country: string, step: string): Promise<{ info: PhoneInfo; calls: CallTrail[] }> {
  const calls: CallTrail[] = [];
  for (const url of [`https://${domain}`, `https://${domain}/contact`]) {
    const r = await ctx.call("web.scrape.markdown", { url }, `${step}:site:${url}`);
    calls.push(trailLine(`company line ${domain}`, r));
    const phone = answered(r) ? telFromPage(r, country) : "";
    if (phone) return { info: { phone, type: "Company line", source: `website (${url.replace("https://", "")})` }, calls };
  }
  return { info: { phone: "", type: "", source: "" }, calls };
}
/** "+44 7700 900123" style display for an E.164 number: country code, then groups of 3 and 4. */
export function formatPhone(e164: string): string {
  const m = /^\+(\d+)$/.exec(e164);
  if (!m) return e164;
  const d = m[1];
  const cc = d.startsWith("1") ? "1" : Object.values(DIAL).filter((c) => d.startsWith(c)).sort((a, b) => b.length - a.length)[0] ?? d.slice(0, 2);
  const rest = d.slice(cc.length);
  if (cc === "1" && rest.length === 10) return `+1 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  const head = rest.length > 7 ? rest.slice(0, rest.length - 6) : rest.slice(0, rest.length - 4);
  const tail = rest.slice(head.length);
  return `+${cc} ${head} ${tail.length > 4 ? `${tail.slice(0, 3)} ${tail.slice(3)}` : tail}`.trim();
}

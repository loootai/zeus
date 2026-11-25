// Outcomes the user hands back. A CSV from any outreach tool or CRM: one row per person, with an
// email column and any of replied, bounced, meeting, interested or status. Column names are matched
// loosely ("Reply Count", "email_reply_count", "Replied" all count as replied).
// Also the outreach log, gtm/outreach/<date>-<campaign>.json, written by `looot-zeus log`, which says
// who was sent what angle. learn joins the two by email.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countryName } from "../modules/icp.js";
import { keyOf, sizeBandOf } from "./schema.js";

/** Splits CSV text into rows. Handles quotes, doubled quotes, commas and new lines inside quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const squash = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** CSV text to objects keyed by the squashed header ("Reply Count" becomes "replycount"). */
export function csvObjects(text: string): Record<string, string>[] {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const keys = head.map(squash);
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const ALIASES = {
  email: ["email", "emailaddress", "emailaddresses", "workemail", "leademail", "lead", "contactemail"],
  replied: ["replied", "reply", "replies", "replycount", "emailreplycount", "hasreplied", "isreplied", "answered"],
  bounced: ["bounced", "bounce", "isbounced", "bouncecount", "emailbounced", "hardbounce"],
  meeting: ["meeting", "meetings", "meetingbooked", "booked", "meetingscheduled"],
  interested: ["interested", "isinterested", "positive", "positivereply"],
  status: ["status", "leadstatus", "outcome", "result", "stage", "interestStatus".toLowerCase(), "ltintereststatus"],
  industry: ["industry", "companyindustry", "sector"],
  title: ["title", "jobtitle", "position", "role"],
  grade: ["grade", "accountgrade"],
  employees: ["employees", "companysize", "headcount", "staff", "size"],
  country: ["country", "companycountry", "location"],
  domain: ["domain", "website", "companydomain", "websiteurl", "company"],
  angle: ["angle", "messageangle"],
  campaign: ["campaign", "campaignname"],
} as const;

function pick(r: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) if (k in r && r[k] !== "") return r[k];
  return undefined;
}

const has = (r: Record<string, string>, keys: readonly string[]) => keys.some((k) => k in r);

/** yes, true, 1, x, a count above 0, or a date all mean yes. Empty, no, false and 0 mean no. */
export function truthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  if (t === "" || t === "no" || t === "false" || t === "n" || t === "0" || t === "none" || t === "-") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t) > 0;
  return true;
}

export interface Outcome {
  email: string;
  replied: boolean;
  bounced: boolean;
  meeting: boolean;
  interested: boolean;
  /** What the file said about the person, when it said it. */
  industry?: string;
  title?: string;
  grade?: string;
  sizeBand?: string;
  country?: string;
  domain?: string;
  angle?: string;
  campaign?: string;
}

export class ResultsError extends Error {}

/**
 * Reads an outcomes CSV. Needs an email column plus at least one of replied, bounced, meeting,
 * interested or status. With requireOutcome false it reads a send list (an export) instead.
 */
export function readResults(text: string, o: { requireOutcome?: boolean } = {}): Outcome[] {
  const rows = csvObjects(text);
  if (rows.length === 0) return [];
  const sample = rows[0];
  if (!has(sample, ALIASES.email)) throw new ResultsError("the file has no email column");
  if (o.requireOutcome !== false && ![ALIASES.replied, ALIASES.bounced, ALIASES.meeting, ALIASES.interested, ALIASES.status].some((a) => has(sample, a))) {
    throw new ResultsError("the results file needs a replied, bounced, meeting, interested or status column next to the email");
  }
  const out = new Map<string, Outcome>();
  for (const r of rows) {
    const email = keyOf(pick(r, ALIASES.email));
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) continue;
    const status = keyOf(pick(r, ALIASES.status));
    // Instantly lead interest status: 1 interested, 2 meeting booked, 3 meeting completed, 4 won.
    const statusNum = /^-?\d+$/.test(status) ? Number(status) : null;
    const said = (re: RegExp) => statusNum === null && re.test(status);
    const meeting = truthy(pick(r, ALIASES.meeting)) || said(/meeting|booked|demo|call scheduled/) || (statusNum !== null && statusNum >= 2);
    const interested = (truthy(pick(r, ALIASES.interested)) && !/^not/.test(keyOf(pick(r, ALIASES.interested)))) || (said(/interested|positive|won/) && !said(/not interested/)) || statusNum === 1;
    const bounced = truthy(pick(r, ALIASES.bounced)) || said(/bounce|invalid|undeliverable/);
    const replied = truthy(pick(r, ALIASES.replied)) || said(/repl|answered|not interested|wrong person/) || meeting || interested;
    const employees = pick(r, ALIASES.employees);
    const domain = pick(r, ALIASES.domain);
    const prev = out.get(email);
    const o: Outcome = {
      email,
      replied: replied || !!prev?.replied,
      bounced: bounced || !!prev?.bounced,
      meeting: meeting || !!prev?.meeting,
      interested: interested || !!prev?.interested,
      industry: keyOf(pick(r, ALIASES.industry)) || prev?.industry,
      title: pick(r, ALIASES.title) ?? prev?.title,
      grade: pick(r, ALIASES.grade)?.toUpperCase() ?? prev?.grade,
      sizeBand: (employees ? sizeBandOf(employees) || (/^\d+\s*-\s*\d+$|\+$/.test(employees) ? employees.replace(/\s/g, "") : "") : "") || prev?.sizeBand,
      country: keyOf(pick(r, ALIASES.country)) || prev?.country,
      angle: pick(r, ALIASES.angle) ?? prev?.angle,
      campaign: pick(r, ALIASES.campaign) ?? prev?.campaign,
      domain: domain && domain.includes(".") ? keyOf(domain).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : prev?.domain,
    };
    out.set(email, o);
  }
  return [...out.values()];
}

// ---- the outreach log ---------------------------------------------------------------------------

export interface Lead {
  email: string;
  domain: string;
  grade: string;
  industry: string;
  title: string;
  sizeBand: string;
  country: string;
}

export interface OutreachLog {
  schemaVersion: "1";
  date: string;
  campaign: string;
  angle: string;
  file: string;
  leads: Lead[];
}

/** What gtm/people.csv and gtm/accounts.csv say about each email: grade, industry, title, size and country. */
export function leadIndex(outDir: string): Map<string, Lead> {
  const read = (f: string) => (existsSync(join(outDir, f)) ? csvObjects(readFileSync(join(outDir, f), "utf8")) : []);
  const accounts = new Map(read("accounts.csv").map((a) => [keyOf(a.domain), a]));
  const idx = new Map<string, Lead>();
  for (const p of read("people.csv")) {
    const email = keyOf(p.email);
    if (!email.includes("@") || email.includes("*")) continue;
    const domain = keyOf(p.domain);
    const a = accounts.get(domain);
    idx.set(email, {
      email,
      domain,
      grade: (a?.grade ?? "").toUpperCase(),
      industry: keyOf(a?.industry),
      title: p.title ?? "",
      sizeBand: sizeBandOf(a?.employees),
      country: keyOf(a?.country),
    });
  }
  return idx;
}

/** One lead from an export row, filled from people.csv and accounts.csv when the email is there. */
export function leadFrom(o: Partial<Outcome> & { email: string }, idx: Map<string, Lead>): Lead {
  const k = idx.get(o.email);
  return {
    email: o.email,
    domain: o.domain || k?.domain || o.email.split("@")[1] || "",
    grade: o.grade || k?.grade || "",
    industry: o.industry || k?.industry || "",
    title: o.title || k?.title || "",
    sizeBand: o.sizeBand || k?.sizeBand || "",
    country: o.country ? keyOf(o.country.length === 2 ? countryName(o.country.toUpperCase()) : o.country) : k?.country || "",
  };
}

/** Reads every gtm/outreach/*.json. */
export function readOutreach(outDir: string): OutreachLog[] {
  const dir = join(outDir, "outreach");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      try {
        const l = JSON.parse(readFileSync(join(dir, f), "utf8")) as OutreachLog;
        return Array.isArray(l.leads) ? [l] : [];
      } catch {
        return [];
      }
    });
}

/** A file name safe slug of the campaign name. */
export function slug(s: string): string {
  return keyOf(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campaign";
}

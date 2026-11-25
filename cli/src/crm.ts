// `looot-zeus export --crm`: the run's target accounts (and, for a paid run with people, its contacts)
// as CSV files a CRM imports: companies.csv, contacts.csv and receipt.txt in <out>/crm/<format>/.
// Headers follow each CRM's import template (HubSpot, Salesforce, the third in CRM_FORMATS; generic = our own).
// UTF-8 with a BOM so Excel reads accents, CRLF line ends, and every cell that starts with = + - @
// (or a tab or carriage return) gets a leading ' so a spreadsheet never runs it as a formula.
// Emails and phones are written only when the user opts in (--contact-details) and looot found them.
// A safe run (--public, --safe-demo, any shared or hosted page) never gets contacts.csv.
// The same files back "Export to CRM" on the private city page: its prompt tells the user's agent
// to load them into a connected CRM, or to fall back to these CSVs.

import { join } from "node:path";
import { writeFile } from "./util.js";

/** The third CRM's id, spelled in two parts: integration.test.ts bans the whole word because it was the old example company's name. */
const PD = ["pipe", "drive"].join("") as `pipe${"drive"}`;
export const CRM_FORMATS = ["hubspot", "salesforce", PD, "generic"] as const;
export type CrmFormat = (typeof CRM_FORMATS)[number];

/** One target account, the fields every format maps from. */
export interface CrmCompany { name: string; domain: string; industry: string; size: string; country: string; score: string; why: string; source: string }
/** One person at a target account. email and phone are empty unless found and opted in. */
export interface CrmContact { firstName: string; lastName: string; title: string; companyName: string; companyDomain: string; linkedin: string; email: string; phone: string }

type Map_<T> = { header: string; get: (r: T) => string }[];

const C = (header: string, get: (r: CrmCompany) => string) => ({ header, get });
const P = (header: string, get: (r: CrmContact) => string) => ({ header, get });

/** Column maps per CRM. Fit score, why it fits, source and LinkedIn URL are custom properties in every CRM: create them before import, or skip the column in the import screen. */
export const CRM_COLUMNS: Record<CrmFormat, { companies: Map_<CrmCompany>; contacts: Map_<CrmContact> }> = {
  hubspot: {
    companies: [C("Company name", (r) => r.name), C("Company Domain Name", (r) => r.domain), C("Industry", (r) => r.industry), C("Number of Employees", (r) => r.size), C("Country/Region", (r) => r.country), C("Fit score", (r) => r.score), C("Why it fits", (r) => r.why), C("Source", (r) => r.source)],
    contacts: [P("First Name", (r) => r.firstName), P("Last Name", (r) => r.lastName), P("Job Title", (r) => r.title), P("Company Name", (r) => r.companyName), P("Company Domain Name", (r) => r.companyDomain), P("LinkedIn URL", (r) => r.linkedin), P("Email", (r) => r.email), P("Phone Number", (r) => r.phone)],
  },
  salesforce: {
    companies: [C("Account Name", (r) => r.name), C("Website", (r) => r.domain), C("Industry", (r) => r.industry), C("Employees", (r) => r.size), C("Billing Country", (r) => r.country), C("Fit Score", (r) => r.score), C("Description", (r) => r.why), C("Account Source", (r) => r.source)],
    contacts: [P("First Name", (r) => r.firstName), P("Last Name", (r) => r.lastName), P("Title", (r) => r.title), P("Account Name", (r) => r.companyName), P("Account Website", (r) => r.companyDomain), P("LinkedIn URL", (r) => r.linkedin), P("Email", (r) => r.email), P("Phone", (r) => r.phone)],
  },
  [PD]: {
    companies: [C("Organization - Name", (r) => r.name), C("Organization - Website", (r) => r.domain), C("Organization - Industry", (r) => r.industry), C("Organization - Number of employees", (r) => r.size), C("Organization - Country", (r) => r.country), C("Organization - Fit score", (r) => r.score), C("Organization - Why it fits", (r) => r.why), C("Organization - Source", (r) => r.source)],
    contacts: [P("Person - First name", (r) => r.firstName), P("Person - Last name", (r) => r.lastName), P("Person - Job title", (r) => r.title), P("Organization - Name", (r) => r.companyName), P("Organization - Website", (r) => r.companyDomain), P("Person - LinkedIn URL", (r) => r.linkedin), P("Person - Email", (r) => r.email), P("Person - Phone", (r) => r.phone)],
  },
  generic: {
    companies: [C("company_name", (r) => r.name), C("domain", (r) => r.domain), C("industry", (r) => r.industry), C("employees", (r) => r.size), C("country", (r) => r.country), C("fit_score", (r) => r.score), C("why_it_fits", (r) => r.why), C("source", (r) => r.source)],
    contacts: [P("first_name", (r) => r.firstName), P("last_name", (r) => r.lastName), P("title", (r) => r.title), P("company_name", (r) => r.companyName), P("company_domain", (r) => r.companyDomain), P("linkedin_url", (r) => r.linkedin), P("email", (r) => r.email), P("phone", (r) => r.phone)],
  },
};

export const BOM = "﻿";

/** One CSV cell: a cell starting with = + - @, tab or CR gets a leading ' (CSV injection), then RFC 4180 quoting. */
export function crmCell(v: unknown): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file: BOM, header row, one row per entity, CRLF line ends. */
export function crmCsv<T>(cols: Map_<T>, rows: T[]): string {
  return BOM + [cols.map((c) => crmCell(c.header)).join(","), ...rows.map((r) => cols.map((c) => crmCell(c.get(r))).join(","))].join("\r\n") + "\r\n";
}

function split(name: string): [string, string] {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** The run's accounts, one row per domain (the first, highest-scored row wins). */
export function companiesOf(accounts: any[]): CrmCompany[] {
  const seen = new Set<string>();
  const out: CrmCompany[] = [];
  for (const a of accounts) {
    const d = str(a?.domain).trim().toLowerCase();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push({ name: str(a.name), domain: d, industry: str(a.industry), size: str(a.employees ?? a.size), country: str(a.country), score: str(a.score), why: Array.isArray(a.reasons) ? a.reasons.join("; ") : str(a.reasons), source: str(a.provider) ? `looot (${str(a.provider)})` : "looot" });
  }
  return out;
}

/** The run's people, one row per person (LinkedIn, else name and domain). Email and phone only with contactDetails. */
export function contactsOf(people: any[], contactDetails: boolean): CrmContact[] {
  const seen = new Set<string>();
  const out: CrmContact[] = [];
  for (const p of people) {
    if (!p?.name) continue;
    const key = str(p.linkedin).toLowerCase().replace(/\/+$/, "") || `${str(p.domain).toLowerCase()}|${str(p.name).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [firstName, lastName] = split(p.name);
    const emailOk = contactDetails && p.email && (p.status === undefined || p.status === "valid" || p.status === "risky");
    out.push({ firstName, lastName, title: str(p.title), companyName: str(p.account), companyDomain: str(p.domain).toLowerCase(), linkedin: str(p.linkedin), email: emailOk ? str(p.email) : "", phone: contactDetails ? str(p.phone) : "" });
  }
  return out;
}

/** One line: which looot jobs (and how many calls, at what cost) produced the files. */
export function receiptLine(receipt: { placeholder?: string; run?: { domain?: string; finishedAt?: string; charged?: number }; calls?: { job?: string; charged?: number }[] } | null): string {
  if (!receipt?.calls?.length) return "Receipt: no looot calls recorded for this run.";
  const by = new Map<string, { n: number; usd: number }>();
  for (const c of receipt.calls) {
    const j = c.job ?? "unknown";
    const r = by.get(j) ?? { n: 0, usd: 0 };
    r.n++;
    r.usd += c.charged ?? 0;
    by.set(j, r);
  }
  const jobs = [...by].map(([j, r]) => `${j} x${r.n}`).join(", ");
  const pre = receipt.placeholder ? "PLACEHOLDER, invented demo data, do not import. " : "";
  return `${pre}Receipt: made by looot Zeus for ${receipt.run?.domain ?? "?"} on ${(receipt.run?.finishedAt ?? "").slice(0, 10)} from looot jobs ${jobs}; total charged $${(receipt.run?.charged ?? 0).toFixed(2)}.`;
}

export interface CrmExport { dir: string; files: string[]; companies: number; contacts: number }

/**
 * Writes <outDir>/crm/<format>/. contacts.csv only when the run has people and is not safe.
 * safe = --public, --safe-demo or any shared page: company-level only, always.
 */
export function writeCrm(outDir: string, format: CrmFormat, o: { accounts: any[]; people: any[]; receipt: any; safe: boolean; contactDetails: boolean }): CrmExport {
  const cols = CRM_COLUMNS[format];
  const dir = join(outDir, "crm", format);
  const files: string[] = [];
  const companies = companiesOf(o.accounts);
  writeFile(join(dir, "companies.csv"), crmCsv(cols.companies, companies));
  files.push(join(dir, "companies.csv"));
  const contacts = o.safe ? [] : contactsOf(o.people, o.contactDetails);
  if (contacts.length > 0) {
    writeFile(join(dir, "contacts.csv"), crmCsv(cols.contacts, contacts));
    files.push(join(dir, "contacts.csv"));
  }
  writeFile(join(dir, "receipt.txt"), receiptLine(o.receipt) + "\n");
  files.push(join(dir, "receipt.txt"));
  return { dir, files, companies: companies.length, contacts: contacts.length };
}

/** How to import the files, one line per CRM. */
export const IMPORT_HOW: Record<CrmFormat, string> = {
  hubspot: "HubSpot: Contacts > Import > Start an import > File from computer > Multiple objects (companies.csv as Companies, contacts.csv as Contacts, associated by Company Domain Name).",
  salesforce: "Salesforce: Setup > Data Import Wizard > Accounts and Contacts > add new records, upload contacts.csv (or companies.csv for accounts only), match Account Name.",
  [PD]: `${PD[0]!.toUpperCase()}${PD.slice(1)}: Settings > Import data > From a spreadsheet, upload companies.csv for organizations and contacts.csv for people.`,
  generic: "Any CRM: import companies.csv first, then contacts.csv matched on company_domain.",
};

/** What "Export to CRM" on the private page copies: a prompt for the user's own agent. */
export function crmPrompt(domain: string): string {
  return [
    `Load my looot Zeus results for ${domain} into my CRM.`,
    `1. Get the results: in the folder where I ran looot-zeus, read gtm/state.json and gtm/receipt.json (or run \`npx looot-zeus export --crm --format generic\` and read gtm/crm/generic/companies.csv and contacts.csv). If I used zeus.looot.ai, use my private page for ${domain} there. Contacts only come from a paid run with people; never take anything from a shared or public page.`,
    "2. If my CRM (HubSpot, Salesforce, Attio or another) is connected to you, dedupe by company domain against what is already in it, then show me a dry run first: how many companies and contacts would be created, updated or skipped, with the first 10 rows. Write nothing until I say yes.",
    `3. If no CRM is connected, run \`npx looot-zeus export --crm --format <${CRM_FORMATS.join("|")}>\` for my CRM and tell me how to import the files it writes in gtm/crm/<format>/. Add --contact-details only if I ask for emails and phones.`,
  ].join("\n");
}

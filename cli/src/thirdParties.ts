// Shared and public pages name no third-party company. Target accounts (and lookalikes) become
// Account A, B, C on account-a.example; rivals become Rival 1, 2, 3 on rival-1.example. Sector, size,
// grade and score stay: company-level stats are fine, names, logos and domains of third parties are not.
// The private local page keeps the names. Used by every safe page (--public, --safe-demo, serve).
import type { Snapshot } from "./history.js";
import { stripAssets } from "./assets.js";

/** One third-party string and the label that replaces it on a shared page. */
export interface ThirdParty { from: string; to: string; word: boolean }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A, B, ..., Z, AA, AB: the letter for the i-th account. */
export function accountLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Words too common to stand for one company on their own: a leading "Digital" or "Global" is not swapped alone. */
const GENERIC = new Set(["the", "global", "digital", "group", "studio", "studios", "agency", "media", "labs", "lab", "tech", "data", "cloud", "smart", "first", "new", "best", "open", "good", "great", "united", "north", "south", "east", "west", "rival", "account", "company", "your", "brand", "home", "real", "world", "creative", "health", "capital", "partners", "solutions", "systems", "software", "services", "consulting", "marketing", "design", "video", "social", "online", "app", "apps", "web", "net", "code", "work", "team", "build"]);

/** Plain English words that are also a company's domain label (search.com, metro.co.uk). Masking one of them would rewrite headings. */
const PLAIN_WORDS = new Set(("search find data news jobs job metro legacy platform complex total real deal tab onion and post posts money market markets " +
  "people person mail email home page pages link links field fields guide guides review reviews answer answers rank ranks share shares signal signals " +
  "content local social ads ad brand brands growth sales price prices pricing trade trust clear bright light spark pulse focus scale point points level " +
  "simple direct prime core base edge front next shift stack loop wave flow path bridge range river ocean forest stone story stories report reports " +
  "insight insights index track tracker hub view views check checks match lead leads target targets").split(" "));

/** The short forms a page or a provider uses for a company: the leading word of a multi-word name
 * ("Northwind" for "Northwind Logistics") and the main label of its domain ("northwind-logistics",
 * "acme" for acme.io), unless that word is too common to name one company. */
function shortForms(name: string, domain: string): string[] {
  const out = new Set<string>();
  const lead = name.trim().split(/[\s,]+/)[0] ?? "";
  const plain = (w: string) => GENERIC.has(w.toLowerCase()) || PLAIN_WORDS.has(w.toLowerCase());
  if (name.trim().includes(" ") && lead.length >= 4 && !plain(lead)) out.add(lead);
  const label = bare(domain).split(".")[0] ?? "";
  if (label.length >= 4 && !plain(label)) out.add(label);
  const first = label.split("-")[0] ?? "";
  if (label.includes("-") && first.length >= 4 && !plain(first)) out.add(first);
  return [...out];
}

const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Every account and rival name and domain of a run, with its label. Your own domain and brand are not here. */
export function thirdPartySwaps(snap: Pick<Snapshot, "domain" | "accounts" | "competitors"> & Partial<Pick<Snapshot, "lookalikes" | "seeds">>): ThirdParty[] {
  const own = bare(snap.domain);
  const out: ThirdParty[] = [];
  const add = (from: string, to: string, word: boolean) => {
    const f = from.trim();
    if (f.length < (word ? 3 : 4) || f.toLowerCase() === to.toLowerCase()) return;
    out.push({ from: f, to, word });
  };
  const accounts = new Map<string, { domain: string; name: string }>();
  for (const a of [...snap.accounts, ...(snap.lookalikes ?? [])]) {
    const k = bare(a.domain) || a.name.toLowerCase();
    if (k && k !== own && !accounts.has(k)) accounts.set(k, a);
  }
  [...accounts.values()].forEach((a, i) => {
    const l = accountLetter(i);
    if (a.domain) add(bare(a.domain), `account-${l.toLowerCase()}.example`, false);
    if (a.name) add(a.name, `Account ${l}`, true);
    for (const f of shortForms(a.name, a.domain)) add(f, `Account ${l}`, true);
  });
  (snap.seeds ?? []).forEach((d, i) => { if (bare(d) !== own) add(bare(d), `customer-${i + 1}.example`, false); });
  snap.competitors.filter((c) => bare(c.domain) !== own).forEach((c, i) => {
    if (c.domain) add(bare(c.domain), `rival-${i + 1}.example`, false);
    if (c.name) add(c.name, `Rival ${i + 1}`, true);
    for (const f of shortForms(c.name, c.domain)) add(f, `Rival ${i + 1}`, true);
  });
  const seen = new Set<string>();
  const withHtml: ThirdParty[] = [];
  for (const s of out.filter((x) => { const k = `${x.word}:${x.from.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })) {
    withHtml.push(s);
    if (htmlEsc(s.from) !== s.from) withHtml.push({ ...s, from: htmlEsc(s.from) });
  }
  return withHtml.sort((a, b) => b.from.length - a.from.length);
}

// Whole names only, any casing (a leak in any casing must be caught). A plain English word is never a
// swap on its own (PLAIN_WORDS), so "Search" in a heading is never taken for search.com.
const pattern = (s: ThirdParty) => (s.word ? `(?<![\\p{L}\\p{N}])${esc(s.from)}(?![\\p{L}\\p{N}])` : `(?<![\\p{L}\\p{N}.-])(?:www\\.)?${esc(s.from)}(?![\\p{L}\\p{N}-])`);

/** Replaces every third-party name and domain in one pass, so a label is never swapped again. */
export function applyThirdParties(text: string, swaps: ThirdParty[]): string {
  if (swaps.length === 0) return text;
  const re = new RegExp(swaps.map((s) => `(${pattern(s)})`).join("|"), "giu");
  return text.replace(re, (...m) => {
    const i = (m.slice(1, swaps.length + 1) as (string | undefined)[]).findIndex((g) => g !== undefined);
    return swaps[i]?.to ?? m[0];
  });
}

/** The third-party names or domains still in a page: the guard that stops a shared page. */
export function thirdPartyLeaks(text: string, swaps: ThirdParty[]): string[] {
  return [...new Set(swaps.filter((s) => new RegExp(pattern(s), "iu").test(text)).map((s) => s.from))];
}

/** Turns a safe page into one that names no third party, drops logos, and throws if one is left. */
export function scrubThirdParties(file: string, text: string, swaps: ThirdParty[]): string {
  const out = applyThirdParties(file.endsWith(".html") ? stripAssets(text) : text, swaps);
  const left = thirdPartyLeaks(out, swaps);
  if (left.length > 0) throw new Error(`${file} still names ${left.length} third-party ${left.length === 1 ? "company" : "companies"} (${left.slice(0, 3).join(", ")}). Refusing to write a shared page.`);
  return out;
}

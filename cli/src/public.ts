// `looot-zeus export --public`: a copy of the dossier you can show anyone. It writes gtm/public/
// with receipt.json, dossier.html and dossier.md. Your domain and brand become yourdomain.com and
// yourbrand, competitors become Rival A, B, C (rival-a.com ...) and people become Person 1, 2, 3
// with example.com emails. Then it searches the three files for every original string. One hit
// and the export is deleted and refused.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { readSnapshot } from "./history.js";
import { validateReceipt } from "./receipt.js";
import { writeFile } from "./util.js";
import { stripAssets } from "./assets.js";

export const PUBLIC_FILES = ["receipt.json", "dossier.html", "dossier.md", "city/index.html"];

export interface Swap {
  from: string;
  to: string;
  /** Match whole words only, case-insensitive. Used for names. */
  word?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function letter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Turns a domain into the name a page would use for it: hubspot.com gives hubspot. */
function nameOfDomain(d: string): string {
  return d.replace(/^www\./, "").split(".")[0] ?? d;
}

/** Every original string and what replaces it. Longer strings first, so emails go before names. */
export function swapsFor(o: { domain: string; brand: string; competitors: { domain: string; name: string }[]; people: { name: string; email: string; linkedin: string; phone: string }[] }): Swap[] {
  const out: Swap[] = [];
  o.competitors.forEach((c, i) => {
    const l = letter(i);
    const to = `rival-${l.toLowerCase()}.com`;
    // A placeholder run already uses rival-a.com and Rival A. Nothing to swap.
    if (c.domain.toLowerCase() === to) return;
    out.push({ from: c.domain, to });
    const name = c.name || nameOfDomain(c.domain);
    if (name.length >= 3) out.push({ from: name, to: `Rival ${l}`, word: true });
  });
  const seen = new Map<string, number>();
  for (const p of o.people) {
    if (!p.name) continue;
    if (!seen.has(p.name.toLowerCase())) seen.set(p.name.toLowerCase(), seen.size + 1);
    const n = seen.get(p.name.toLowerCase())!;
    if (p.email) out.push({ from: p.email, to: `person${n}@example.com` });
    if (p.linkedin) out.push({ from: p.linkedin, to: `https://www.linkedin.com/in/person-${n}` });
    if (p.phone) out.push({ from: p.phone, to: "+1 555 0100" });
    out.push({ from: p.name, to: `Person ${n}`, word: true });
  }
  out.push({ from: o.domain, to: "yourdomain.com" });
  if (o.brand && o.brand.length >= 2) out.push({ from: o.brand, to: "yourbrand", word: true });
  const withHtml: Swap[] = [];
  for (const s of out) {
    withHtml.push(s);
    if (htmlEsc(s.from) !== s.from) withHtml.push({ ...s, from: htmlEsc(s.from) });
  }
  // Drop swaps that change nothing, so a placeholder run stays as it is.
  return withHtml.filter((s) => s.from.toLowerCase() !== s.to.toLowerCase()).sort((a, b) => b.from.length - a.from.length);
}

export function applySwaps(text: string, swaps: Swap[]): string {
  let t = text;
  for (const s of swaps) {
    const re = s.word ? new RegExp(`(?<![\\p{L}\\p{N}])${esc(s.from)}(?![\\p{L}\\p{N}])`, "giu") : new RegExp(esc(s.from), "gi");
    t = t.replace(re, s.to);
  }
  return t;
}

/** Counts every original string left in the text, case-insensitive. */
export function leaks(text: string, swaps: Swap[]): { from: string; hits: number }[] {
  const lower = text.toLowerCase();
  const out: { from: string; hits: number }[] = [];
  for (const s of swaps) {
    const f = s.from.toLowerCase();
    // A word swap whose name sits inside a longer word (Ana in Analytics) is not a leak.
    const hits = s.word ? (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${esc(s.from)}(?![\\p{L}\\p{N}])`, "giu")) ?? []).length : lower.split(f).length - 1;
    if (hits > 0) out.push({ from: s.from, hits });
  }
  return out;
}

export interface PublicExport {
  dir: string;
  files: string[];
  checked: number;
}

/** Writes <outDir>/public/. Throws when an original string is still in the output. */
/** The industry every masked account shows. */
export const GENERIC_INDUSTRY = "Business";

/**
 * --mask-accounts. Target accounts and lookalikes become Account 1..N on account-1.example, seed
 * customers become customer-1.example. Their industries become "Business" in the rows that name them.
 */
export function accountSwaps(snap: { accounts: { domain: string; name: string; industry?: string }[]; lookalikes?: { domain: string; name: string; industry: string }[]; seeds?: string[] }): { swaps: Swap[]; industries: string[] } {
  const all = new Map<string, { domain: string; name: string; industry: string }>();
  for (const a of [...snap.accounts, ...(snap.lookalikes ?? [])]) if (a.domain && !all.has(a.domain.toLowerCase())) all.set(a.domain.toLowerCase(), { domain: a.domain, name: a.name, industry: a.industry ?? "" });
  const swaps: Swap[] = [];
  [...all.values()].forEach((a, i) => {
    swaps.push({ from: a.domain, to: `account-${i + 1}.example` });
    if (a.name.length >= 2) swaps.push({ from: a.name, to: `Account ${i + 1}`, word: true });
  });
  (snap.seeds ?? []).forEach((d, i) => {
    if (!/^customer-\d+\.example$/.test(d)) swaps.push({ from: d, to: `customer-${i + 1}.example` });
  });
  const industries = [...new Set([...all.values()].map((a) => a.industry.trim()).filter((x) => x.length >= 2 && x !== GENERIC_INDUSTRY))];
  return { swaps, industries };
}

/** In every table row or line that names an account, its industry words become the generic one. */
export function maskIndustries(text: string, industries: string[]): string {
  if (industries.length === 0) return text;
  // Runs after the swaps, so a row that names an account now says Account N or account-N.example.
  const named = /(?<![\p{L}\p{N}])Account \d+(?![\p{N}])|account-\d+\.example/u;
  const ind = new RegExp(`(?<![\\p{L}\\p{N}])(${industries.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const fix = (seg: string) => (named.test(seg) ? seg.replace(ind, GENERIC_INDUSTRY) : seg);
  // HTML table rows first, then plain lines (markdown tables and everything else).
  return text.replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, fix).split("\n").map(fix).join("\n");
}

export function exportPublic(outDir: string, configPath: string = join(outDir, "config.yaml"), opts: { maskAccounts?: boolean; /** Safe pages rendered from the saved run. Used in place of the private files on disk. */ rendered?: Record<string, string> } = {}): PublicExport {
  for (const f of PUBLIC_FILES) if (!existsSync(join(outDir, f)) && opts.rendered?.[f] === undefined) throw new Error(`${join(outDir, f)} does not exist yet. Run looot-zeus run first.`);
  const snap = readSnapshot(outDir);
  if (!snap) throw new Error(`${join(outDir, "snapshot.json")} does not exist yet. Run looot-zeus run first.`);
  const cfg = existsSync(configPath) ? loadConfig(configPath) : null;
  const competitors = [...snap.competitors];
  for (const d of cfg?.competitors ?? []) if (!competitors.some((c) => c.domain === d)) competitors.push({ domain: d, name: "" });
  let swaps = swapsFor({ domain: snap.domain, brand: snap.brand || cfg?.brand || "", competitors, people: snap.people });
  let prep = (t: string): string => t;
  if (opts.maskAccounts) {
    const acc = accountSwaps(snap);
    prep = (t) => maskIndustries(t, acc.industries);
    const more: Swap[] = [];
    for (const s of acc.swaps) {
      more.push(s);
      if (htmlEsc(s.from) !== s.from) more.push({ ...s, from: htmlEsc(s.from) });
    }
    swaps = [...swaps, ...more].sort((a, b) => b.from.length - a.from.length);
  }
  const dir = join(outDir, "public");
  // No logo, letter tile or ad creative goes into the public copy: an image can name a rival or an account.
  const source = (f: string) => opts.rendered?.[f] ?? readFileSync(join(outDir, f), "utf8");
  const texts = PUBLIC_FILES.map((f) => [f, prep(applySwaps(f.endsWith(".html") ? stripAssets(source(f)) : source(f), swaps))] as const);
  const problems: string[] = [];
  for (const [f, t] of texts) for (const l of leaks(t, swaps)) problems.push(`${f} still has ${l.hits} x ${l.from}`);
  const receiptErrs = validateReceipt(JSON.parse(texts[0][1]));
  if (receiptErrs.length > 0) problems.push(`receipt.json no longer matches the schema, ${receiptErrs[0]}`);
  if (problems.length > 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`The public export was not written, because:\n  ${problems.slice(0, 10).join("\n  ")}`);
  }
  for (const [f, t] of texts) writeFile(join(dir, f), t);
  return { dir, files: PUBLIC_FILES.map((f) => join(dir, f)), checked: swaps.length };
}

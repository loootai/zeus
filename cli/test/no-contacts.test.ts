import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Guard: the repo never ships a real person's email, phone or photo. Real contacts live only in
// the private local output (gtm/, .looot-zeus/, city/data/contacts*.json, city/img/people/).

const here = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // not a git checkout (an unpacked tarball): nothing to scan
  }
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|pdf|woff2?|ttf|zip|gz|tgz|mp4|mov|webm)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// E.164 style (+ then 8 to 15 digits with spaces, dots, dashes, brackets) or a US style 3-3-4 number.
const PHONE = /(?<![\w.])(\+[1-9][\d ()\-.]{7,16}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?![\w])/g;

const PLACEHOLDER_DOMAINS = ["example.com", "example.org", "example.net", "yourdomain.com", "looot.ai", "users.noreply.github.com"];
// Free-mail addresses are allowed only when they are exactly one of these placeholders.
const PLACEHOLDER_ADDRESSES = new Set(["placeholder.person@gmail.com"]);

/** Whether an email is a placeholder: a reserved or own domain, a noreply address, or a listed address. */
export function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (PLACEHOLDER_ADDRESSES.has(lower)) return true;
  const [local, domain] = lower.split("@");
  if (/^noreply$|^no-reply$|^\d+\+.+/.test(local) && domain.endsWith("noreply.github.com")) return true;
  if (local === "noreply" || local === "no-reply") return true;
  if (local === "contact") return true; // build/anonymize.py writes contact@<company domain>
  if (/\.(example|test|invalid|localhost)$/.test(domain)) return true;
  return PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/** Whether a phone number is a reserved fictional one (555-01xx, Ofcom drama ranges, 1234 5678, one repeated digit). */
export function isPlaceholderPhone(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  return (
    /^0+$/.test(d) || // "+00 000 000 000" from build/anonymize.py
    /5550[1]\d\d$/.test(d) ||
    /^447700900\d{3}$/.test(d) ||
    /^44207946\d{4}$/.test(d) ||
    /^3161234567\d$/.test(d) ||
    /123456789$/.test(d) ||
    /^(\d)\1+$/.test(d.replace(/^\d{1,2}(?=(\d)\1)/, "")) ||
    /^(\d)\1+$/.test(d)
  );
}

test("placeholder helpers accept reserved values and reject real-looking ones", () => {
  assert.ok(isPlaceholderEmail("ann@a.example"));
  assert.ok(isPlaceholderEmail("hello@yourdomain.com"));
  assert.ok(isPlaceholderEmail("1234+me@users.noreply.github.com"));
  assert.ok(!isPlaceholderEmail("jane@acme-agency.com"));
  assert.ok(!isPlaceholderEmail("someone@gmail.com"));
  assert.ok(isPlaceholderPhone("+1 555 0142"));
  assert.ok(isPlaceholderPhone("+44 7700 900123"));
  assert.ok(!isPlaceholderPhone("+1 415 867 5309"));
  assert.ok(!isPlaceholderPhone("+49 30 12345678".replace("12345678", "98765432")));
});

test("no tracked file holds a real email, a real phone number or a person photo", () => {
  const root = repoRoot();
  if (!root) return;
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const problems: string[] = [];
  for (const f of files) {
    if (f === "cli/test/no-contacts.test.ts") continue; // its own examples
    if (f.startsWith("city/img/people/")) problems.push(`${f}: person photos are private local output`);
    if (BINARY.test(f)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue; // a file deleted in the working tree but still indexed
    }
    if (text.includes("\0")) continue;
    let emails = 0;
    for (const m of text.matchAll(EMAIL)) if (!isPlaceholderEmail(m[0])) emails++;
    let phones = 0;
    for (const m of text.matchAll(PHONE)) if (!isPlaceholderPhone(m[0])) phones++;
    // Counts only: the failure message never prints the contact itself.
    if (emails) problems.push(`${f}: ${emails} non-placeholder email(s)`);
    if (phones) problems.push(`${f}: ${phones} non-placeholder phone number(s)`);
  }
  assert.deepEqual(problems, [], "real contact data found in tracked files");
});

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root. This file runs from dist/src/util.js, so the root is two levels up. */
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** JSON with sorted keys, so the same value always gives the same text. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Dollars with 4 decimals under $1 and 2 above. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$?";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/** Rounds to 6 decimals, the precision looot bills in. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** j***@domain.com */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** "Jane Doe" becomes "J. D." */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]}.`)
    .join(" ");
}

/** "+31 6 1234 5678" becomes "+31 *** 78" */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${phone.startsWith("+") ? "+" : ""}${digits.slice(0, 2)} *** ${digits.slice(-2)}`;
}

export function csv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Cleans a user-typed domain: no scheme, no www, no path. */
export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Returns the URL when it is an absolute http(s) URL, else null, so data never puts javascript: or data: in a link. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

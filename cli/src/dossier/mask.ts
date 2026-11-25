import { maskEmail, maskName, maskPhone } from "../util.js";
import type { Pii } from "./blocks.js";
import { isPlaceholderName } from "./safe.js";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Masks one value for --public. Free text gets its email addresses masked too. */
export function maskValue(v: unknown, pii: Pii | undefined, on: boolean): string {
  const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  if (!on) return s;
  if (pii === "email") return s ? maskEmail(s) : "";
  if (pii === "name") return isPlaceholderName(s) ? s : maskName(s);
  if (pii === "phone") return s ? maskPhone(s) : "";
  return s.replace(EMAIL, (m) => maskEmail(m));
}

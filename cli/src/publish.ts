// `looot-zeus export --public --publish` and `export --unpublish`. Builds the zeus.share.v1 bundle,
// company-level data only (the receipt's totals and step summaries, the competitors, the run ids
// looot uses to verify the domain), and sends it to looot-pages, which renders the page itself.
// People, emails, phones and accounts are never part of the bundle. looot-pages checks again.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSnapshot } from "./history.js";
import type { Receipt } from "./receipt.js";
import { loadLogos, logoData } from "./assets.js";
import type { Dossier } from "./dossier/index.js";
import { publicCityDossier, publicText } from "./publicCity.js";
import { applyThirdParties, thirdPartyLeaks, thirdPartySwaps } from "./thirdParties.js";

/** Where pages are published. Until looot.page is live this is the Vercel URL of looot-pages. */
export const DEFAULT_PAGES_URL = "https://looot-pages.vercel.app";

export interface ShareBundle {
  schema: "zeus.share.v2";
  domain: string;
  brand?: string;
  generatedAt: string;
  runIds: string[];
  totals: { charged: number; calls: number; durationMs: number };
  modules: { id: string; label: string; status: string; summary: string; calls: number; charged: number }[];
  rivals: { name: string }[];
  /** The public city dossier (publicCity.ts): looot-pages checks it and renders the same city page as the private one. */
  city: Dossier;
  /** The owner's own logo as a small data: URI, from the run's safe asset fetch. */
  logo?: string;
  /** The run's category words. looot-pages only uses one that is on its allow-list, to pick a page name. */
  categoryWords?: string[];
}

const CONTACT = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}]{2,}|linkedin\.com\/in\/|\+?\d[\d\s().-]{8,}\d/iu;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** The share bundle of the last run in outDir. Throws on a placeholder run or anything that looks like a contact. */
export function buildShareBundle(outDir: string): ShareBundle {
  const rf = join(outDir, "receipt.json");
  if (!existsSync(rf)) throw new Error(`${rf} does not exist yet. Run looot-zeus run first.`);
  const receipt = JSON.parse(readFileSync(rf, "utf8")) as Receipt;
  if (receipt.placeholder || receipt.run.mode === "demo") throw new Error("This is a placeholder or demo run. Only a real run can be published.");
  const snap = readSnapshot(outDir);
  const runIds = [...new Set(receipt.calls.map((c) => c.runId).filter((r): r is string => typeof r === "string" && /^run_[a-f0-9]{32}$/.test(r)))].slice(0, 5);
  if (runIds.length === 0) throw new Error("The receipt has no looot run ids, so the domain cannot be verified. Run looot-zeus run again.");
  const b: ShareBundle = {
    schema: "zeus.share.v2",
    domain: receipt.run.domain.toLowerCase().replace(/^www\./, ""),
    ...(snap?.brand ? { brand: snap.brand.slice(0, 60) } : {}),
    generatedAt: new Date(receipt.run.finishedAt).toISOString(),
    runIds,
    totals: { charged: round(receipt.run.charged), calls: receipt.run.calls, durationMs: receipt.run.durationMs },
    modules: receipt.modules.slice(0, 30).map((m) => ({ id: m.id, label: m.label.slice(0, 40), status: m.status, summary: m.summary.slice(0, 240), calls: m.calls, charged: round(m.charged) })),
    // Public: rivals are Rival 1, 2, 3 and target accounts Account A, B, C (#32); looot-pages refuses anything else.
    rivals: (snap?.competitors ?? []).filter((c) => c.domain.toLowerCase().replace(/^www\./, "") !== receipt.run.domain.toLowerCase().replace(/^www\./, "")).slice(0, 10).map((_, i) => ({ name: `Rival ${i + 1}` })),
    city: publicCityDossier(outDir),
  };
  if (b.city.domain !== b.domain) throw new Error(`The saved run is for ${b.city.domain}, the receipt for ${b.domain}. Run looot-zeus run again.`);
  loadLogos(outDir);
  const logo = logoData(b.domain);
  if (logo && logo.length <= 48_000 && /^data:image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(logo)) b.logo = logo;
  const swaps = snap ? thirdPartySwaps({ domain: b.domain, accounts: snap.accounts ?? [], competitors: snap.competitors ?? [], lookalikes: snap.lookalikes, seeds: snap.seeds }) : [];
  b.modules = b.modules.map((m) => ({ ...m, label: applyThirdParties(m.label, swaps).slice(0, 40), summary: applyThirdParties(m.summary, swaps).slice(0, 240) }));
  const cf = join(outDir, "candidates.json");
  const terms: unknown = existsSync(cf) ? JSON.parse(readFileSync(cf, "utf8"))?.categoryTerms : undefined;
  if (Array.isArray(terms)) {
    const words = terms.filter((t): t is string => typeof t === "string" && /^[\p{L} -]{1,40}$/u.test(t)).slice(0, 20);
    if (words.length > 0) b.categoryWords = words.map((w) => applyThirdParties(w, swaps));
  }
  b.modules = b.modules.map((m) => ({ ...m, summary: publicText(m.summary, b.domain, swaps).slice(0, 240) }));
  const strings = [b.brand ?? "", ...b.modules.flatMap((m) => [m.label, m.summary]), ...b.rivals.map((r) => r.name), ...cityStrings(b.city)];
  const left = thirdPartyLeaks(JSON.stringify(b), swaps);
  if (left.length > 0) throw new Error(`Not published: the page still names ${left.slice(0, 3).join(", ")}. Public pages name no rival or account.`);
  const hit = strings.find((s) => CONTACT.test(s.replace(/\d{4}-\d{2}-\d{2}/g, " ")));
  if (hit) throw new Error(`Not published: "${hit.slice(0, 60)}" looks like contact data. Public pages hold no emails, phones or profile links.`);
  return b;
}

/** Every string in a value, for the contact check. */
function cityStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) cityStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) cityStrings(x, out);
  return out;
}

interface Opts { token: string; baseUrl?: string; fetch?: typeof fetch }

async function send(path: string, init: RequestInit, o: Opts): Promise<any> {
  const f = o.fetch ?? fetch;
  const base = (o.baseUrl ?? DEFAULT_PAGES_URL).replace(/\/$/, "");
  const r = await f(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`looot-pages said ${r.status}: ${body?.error?.message ?? "no reason given"}`);
  return body;
}

/** Publishes the bundle. Returns the page URL. */
export async function publishShare(b: ShareBundle, o: Opts & { name?: string }): Promise<{ slug: string; url: string }> {
  if (o.name !== undefined && !/^[a-z0-9-]{3,63}$/.test(o.name)) throw new Error(`${o.name} is not a page name.`);
  return send(`/api/publish${o.name ? `?name=${o.name}` : ""}`, { method: "POST", body: JSON.stringify(b) }, o);
}

/** Three free page names for the domain, to pick one for publishShare({ name }). */
export async function suggestNames(domain: string, o: Opts): Promise<string[]> {
  return (await send(`/api/names?domain=${encodeURIComponent(domain)}`, { method: "GET" }, o)).names ?? [];
}

/** Unpublishes a page this account published. */
export async function unpublishShare(slug: string, o: Opts): Promise<void> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error(`${slug} is not a page name.`);
  await send(`/api/pages/${slug}`, { method: "DELETE" }, o);
}

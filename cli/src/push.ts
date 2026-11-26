// `looot-zeus push`: sends the last run's city to zeus.looot.ai, where members of the same looot workspace see it
// after Sign in with looot (Luisa and Walid, 2026-11-26: the site is view-only, the user's agent runs Zeus and
// pushes). The bundle is plain data: the safe city dossier (people reduced to a role, no email, phone or profile
// link) and, when the run allows one, the public share bundle for looot.page. No HTML is sent; zeus.looot.ai
// checks the data and renders the page itself. The key goes only to https zeus.looot.ai (or ZEUS_URL pointing at a local
// test server).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dossier } from "./dossier/index.js";
import { assemble } from "./dossier/index.js";
import { safeDossier } from "./dossier/safe.js";
import { MODULES } from "./modules/index.js";
import { readState } from "./more.js";
import { buildShareBundle, type ShareBundle } from "./publish.js";
import { readSavedLogin } from "./client.js";

export const DEFAULT_ZEUS_URL = "https://zeus.looot.ai";
export const PUSH_SCHEMA = "zeus.push.v1";

export interface PushBundle {
  schema: typeof PUSH_SCHEMA;
  domain: string;
  brand?: string;
  generatedAt: string;
  /** The safe city dossier, the same data the hosted city page is rendered from. */
  city: Dossier;
  /** The public looot.page bundle (Rival 1/2/3, no contacts), when the run can build one. */
  share?: ShareBundle;
}

/**
 * The city of the last run in outDir as the hosted page shows it: the run's real brand, domain and rivals,
 * people reduced to a role with an invented name, no email, phone, profile link or photo. Null with no run yet.
 */
export function cityDossier(outDir: string): Dossier | null {
  const state = readState(outDir);
  const receiptFile = join(outDir, "receipt.json");
  if (!state || !existsSync(receiptFile)) return null;
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
  const ids = new Set(state.modules);
  const mods = MODULES.filter((m) => ids.has(m.id));
  const results = new Map(Object.entries(state.results).map(([id, r]) => [id, { ...r }]));
  return safeDossier(assemble({ domain: state.cfg.domain, brand: state.cfg.brand, mods, results, receipt, public: true, placeholder: state.placeholder, cfg: state.cfg, pages: state.pages, pulls: state.pulls }));
}

/** The push bundle of the last run in outDir. Throws when there is no real run to push. */
export function buildPushBundle(outDir: string): PushBundle {
  const city = cityDossier(outDir);
  if (!city) throw new Error(`No run in ${outDir} yet. Run looot-zeus run <domain> first.`);
  if (city.placeholder) throw new Error("This is a demo or placeholder run. Only a real run can be pushed.");
  let share: ShareBundle | undefined;
  try {
    share = buildShareBundle(outDir);
  } catch {
    share = undefined; // the private city still goes; Share on the site says to run again
  }
  return { schema: PUSH_SCHEMA, domain: city.domain, ...(city.brand ? { brand: city.brand.slice(0, 60) } : {}), generatedAt: city.generatedAt || new Date().toISOString(), city, ...(share ? { share } : {}) };
}

/** Only these get the user's looot key: https on zeus.looot.ai or another looot host, or a local test server. */
export function pushHostAllowed(base: string): boolean {
  try {
    const u = new URL(base);
    if (u.username || u.password) return false;
    // Exact hosts only: a look-alike (any *.vercel.app, any other looot.ai name) never gets a spend-capable key.
    if (u.protocol === "https:" && u.hostname === "zeus.looot.ai" && u.port === "") return true;
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

/** The key Zeus pushes with: LOOOT_TOKEN, else LOOOT_API_KEY, else the saved `looot login`. Never printed. */
export function pushToken(env: Record<string, string | undefined> = process.env): string | null {
  return env.LOOOT_TOKEN?.trim() || env.LOOOT_API_KEY?.trim() || readSavedLogin(env)?.token || null;
}

export interface PushResult {
  ok: boolean;
  status: number;
  url?: string;
  domain?: string;
  message?: string;
  errors?: string[];
  share?: { available: boolean; hint: string };
}

/** POST /api/cities with the user's own key. Returns the server's answer; never throws on an HTTP error. */
export async function pushCity(b: PushBundle, o: { token: string; baseUrl?: string; fetch?: typeof fetch }): Promise<PushResult> {
  const base = (o.baseUrl ?? DEFAULT_ZEUS_URL).replace(/\/+$/, "");
  if (!pushHostAllowed(base)) throw new Error(`${base} is not a Zeus host. Your looot key is only sent to https://zeus.looot.ai.`);
  const f = o.fetch ?? fetch;
  const r = await f(`${base}/api/cities`, { method: "POST", headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(b), redirect: "error", signal: AbortSignal.timeout(60_000) });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && body.ok === true,
    status: r.status,
    ...(typeof body.url === "string" ? { url: body.url } : {}),
    ...(typeof body.domain === "string" ? { domain: body.domain } : {}),
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(Array.isArray(body.errors) ? { errors: body.errors.filter((e): e is string => typeof e === "string").slice(0, 50) } : {}),
    ...(body.share && typeof body.share === "object" ? { share: body.share as PushResult["share"] } : {}),
  };
}

/** The lines `push` prints for a result. */
export function pushLines(r: PushResult): string[] {
  if (r.ok) return [
    `Pushed to Zeus: ${r.url}`,
    "Private: members of your looot workspace see it after Sign in with looot. Anyone else gets a 404.",
    r.share?.hint ?? "Share: open the link and press Share to publish a safe public copy on looot.page.",
  ];
  return [`Push refused (${r.status}): ${r.message ?? "no reason given"}`, ...(r.errors ?? []).map((e) => `  - ${e}`)];
}

// Safe copies of a finished run, rebuilt from the folder's saved state (never from the private
// pages), for `export --public` and `serve`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCity } from "./city/index.js";
import { assemble } from "./dossier/index.js";
import { renderHtml } from "./dossier/html.js";
import { renderMarkdown } from "./dossier/md.js";
import { safeDossier } from "./dossier/safe.js";
import { MODULES } from "./modules/index.js";
import type { ModuleResult } from "./modules/types.js";
import { readState } from "./more.js";
import type { Receipt } from "./receipt.js";
import { writeFile } from "./util.js";
import { buildSnapshot } from "./history.js";
import { scrubThirdParties, thirdPartySwaps, type ThirdParty } from "./thirdParties.js";
import type { Dossier } from "./dossier/index.js";

export type SafePages = {
  "city/index.html": string;
  "dossier.html": string;
  "dossier.md": string;
};

/** Renders the city page, dossier and markdown of the run in `outDir` with every person reduced to role and invented name. Null when the folder has no saved run. */
/** The safe dossier of the run in `outDir` (people reduced to role and invented name) and its third-party swaps. Null when the folder has no saved run. */
export function safeRun(outDir: string): { d: Dossier; tp: ThirdParty[] } | null {
  const state = readState(outDir);
  const receiptFile = join(outDir, "receipt.json");
  if (!state || !existsSync(receiptFile)) return null;
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as Receipt;
  const ids = new Set(state.modules);
  const mods = MODULES.filter((m) => ids.has(m.id));
  const results = new Map<string, ModuleResult>(Object.entries(state.results).map(([id, r]) => [id, { ...r }]));
  const d = safeDossier(assemble({ domain: state.cfg.domain, brand: state.cfg.brand, mods, results, receipt, public: true, placeholder: state.placeholder, cfg: state.cfg, pages: state.pages, pulls: state.pulls }));
  const outputs = Object.fromEntries([...results].map(([id, r]) => [id, r.out]));
  return { d, tp: thirdPartySwaps(buildSnapshot(state.cfg, outputs, receipt)) };
}

export function renderSafePages(outDir: string): SafePages | null {
  const state = readState(outDir);
  const receiptFile = join(outDir, "receipt.json");
  if (!state || !existsSync(receiptFile)) return null;
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as Receipt;
  const ids = new Set(state.modules);
  const mods = MODULES.filter((m) => ids.has(m.id));
  const results = new Map<string, ModuleResult>(Object.entries(state.results).map(([id, r]) => [id, { ...r }]));
  const d = safeDossier(assemble({ domain: state.cfg.domain, brand: state.cfg.brand, mods, results, receipt, public: true, placeholder: state.placeholder, cfg: state.cfg, pages: state.pages, pulls: state.pulls }));
  // No target account or rival is named on a page meant to be shared; the guard throws if one is left.
  const outputs = Object.fromEntries([...results].map(([id, r]) => [id, r.out]));
  const tp = thirdPartySwaps(buildSnapshot(state.cfg, outputs, receipt));
  return {
    "city/index.html": scrubThirdParties("city/index.html", renderCity(d), tp),
    "dossier.html": scrubThirdParties("dossier.html", renderHtml(d), tp),
    "dossier.md": scrubThirdParties("dossier.md", renderMarkdown(d), tp),
  };
}

/** Writes the safe pages for `serve` into `<dir>`, with the city page as index.html. Returns the folder, or null when there is no saved run. */
export function writeSafeView(outDir: string, dir: string): string | null {
  const p = renderSafePages(outDir);
  if (!p) return null;
  writeFile(join(dir, "index.html"), p["city/index.html"]);
  writeFile(join(dir, "city", "index.html"), p["city/index.html"]);
  writeFile(join(dir, "dossier.html"), p["dossier.html"]);
  return dir;
}

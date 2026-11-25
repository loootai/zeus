// The one place the default per-section caps live. Every number here is a PLACEHOLDER until Luisa
// decides it, because it sets how much a run may spend. The values are chosen so the worst case of a
// full default run of the demo fixtures, with every section held to its cap, stays under 2 USD (the
// free credit). Whether they apply is USE_DEFAULT_CAPS: off means a run behaves as before section caps.

import type { CapLimits } from "./cap.js";
import type { GtmConfig } from "./config.js";

/** Whether the default caps below apply when the config has no `caps:` of its own. */
// Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
export const USE_DEFAULT_CAPS = true;

export const DEFAULT_CAPS: CapLimits = {
  // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
  totalUsd: 1.95,
  // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
  totalRuns: 150,
  sections: {
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    intake: { usd: 0.07, runs: 7 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2" (usd 0.15, runs 12).
    // runs 12 -> 14 in #47 for the lookalike fallback on your own domain; the USD cap is hers and unchanged.
    icp: { usd: 0.15, runs: 14 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    accounts: { usd: 0.25, runs: 20 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    people: { usd: 0.12, runs: 12 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    enrich: { usd: 0.25, runs: 25 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    committee: { usd: 0.2, runs: 10 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    signals: { usd: 0.2, runs: 8 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    competitors: { usd: 0.1, runs: 10 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    ads: { usd: 0.08, runs: 10 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    social: { usd: 0.08, runs: 10 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    seo: { usd: 0.12, runs: 12 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    reviews: { usd: 0.03, runs: 3 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    mentions: { usd: 0.06, runs: 8 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2".
    market: { usd: 0.15, runs: 6 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2". One check per site, you and up to 5 rivals.
    readiness: { usd: 0.06, runs: 6 },
    // Decided by Luisa 2026-11-25 (looot-zeus#11): "Caps so a run fits $2". One free RDAP lookup per domain.
    domains: { usd: 0.006, runs: 6 },
  },
};

/**
 * The limits that apply to a run: the defaults when USE_DEFAULT_CAPS is on, with the brief's own
 * `caps:` (and --max-runs) laid over them. With the defaults off and no `caps:`, nothing is limited.
 */
export function resolveCaps(cfg: Pick<GtmConfig, "caps">): CapLimits {
  const base: CapLimits = USE_DEFAULT_CAPS ? { ...DEFAULT_CAPS, sections: { ...DEFAULT_CAPS.sections } } : { sections: {} };
  const mine = cfg.caps;
  if (!mine) return base;
  const sections = { ...base.sections };
  for (const [id, l] of Object.entries(mine.sections)) sections[id] = { ...(sections[id] ?? {}), ...l };
  const out: CapLimits = { sections };
  const tu = mine.totalUsd ?? base.totalUsd;
  const tr = mine.totalRuns ?? base.totalRuns;
  if (tu !== undefined) out.totalUsd = tu;
  if (tr !== undefined) out.totalRuns = tr;
  return out;
}

/** Section names in `caps.sections` that are not a module id, so a typo does not silently do nothing. */
export function unknownCapSections(caps: CapLimits, moduleIds: string[]): string[] {
  return Object.keys(caps.sections).filter((id) => !moduleIds.includes(id));
}

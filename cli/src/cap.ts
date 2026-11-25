// One cap for the whole run. Each module gets a share of it in proportion to its worst-case
// quote. A module may also use what finished modules left unspent. Before every paid call the
// ledger checks the call's ceiling (its fallback.maxCostUsd), so the run stops before it could
// pass the cap, never after.

import { round6 } from "./util.js";

export class CapReached extends Error {
  constructor(
    readonly module: string,
    readonly scope: "run" | "module" | "section",
    message: string,
  ) {
    super(message);
    this.name = "CapReached";
  }
}

/** A hard limit on one section (module): paid calls and dollars. Either may be left out. */
export interface SectionLimit {
  usd?: number;
  runs?: number;
}

/** Hard limits on top of the proportional shares. Empty means none, the behaviour before section caps. */
export interface CapLimits {
  /** Global dollar ceiling for the run. The lower of this and --cap wins. */
  totalUsd?: number;
  /** Global ceiling on paid calls in the run. */
  totalRuns?: number;
  sections: Record<string, SectionLimit>;
}

export interface ModuleShare {
  id: string;
  /** Worst-case quote of the module in USD. */
  worst: number;
}

export class CapLedger {
  readonly cap: number;
  readonly limits: CapLimits;
  #runs = 0;
  readonly #sectionRuns = new Map<string, number>();
  #spent = 0;
  #reserved = 0;
  readonly #alloc = new Map<string, number>();
  readonly #moduleSpent = new Map<string, number>();
  readonly #moduleReserved = new Map<string, number>();
  readonly #finished = new Set<string>();

  constructor(cap: number, shares: ModuleShare[], limits: CapLimits = { sections: {} }) {
    if (!(cap > 0)) throw new Error("cap must be a positive dollar amount");
    this.limits = limits;
    this.cap = limits.totalUsd !== undefined && limits.totalUsd > 0 ? Math.min(cap, limits.totalUsd) : cap;
    const total = shares.reduce((n, s) => n + Math.max(0, s.worst), 0);
    for (const s of shares) {
      const share = total > 0 ? (this.cap * Math.max(0, s.worst)) / total : 0;
      // When the whole worst case fits under the cap, every module simply gets its worst case
      // plus its share of the headroom, so the allocation never binds.
      this.#alloc.set(s.id, round6(share));
      this.#moduleSpent.set(s.id, 0);
      this.#moduleReserved.set(s.id, 0);
    }
  }

  /** Paid calls reserved so far in the whole run. */
  get runs(): number {
    return this.#runs;
  }

  sectionRuns(id: string): number {
    return this.#sectionRuns.get(id) ?? 0;
  }

  get spent(): number {
    return round6(this.#spent);
  }

  get remaining(): number {
    return round6(this.cap - this.#spent - this.#reserved);
  }

  allocation(id: string): number {
    return this.#alloc.get(id) ?? 0;
  }

  moduleSpent(id: string): number {
    return round6(this.#moduleSpent.get(id) ?? 0);
  }

  /** Unspent allocation of modules that are done, open to any module still running. */
  pool(): number {
    let n = 0;
    for (const id of this.#finished) n += Math.max(0, (this.#alloc.get(id) ?? 0) - (this.#moduleSpent.get(id) ?? 0));
    return round6(n);
  }

  #poolUsedByOthers(module: string): number {
    // What other running modules already took beyond their own allocation.
    let n = 0;
    for (const [id, a] of this.#alloc) {
      if (id === module || this.#finished.has(id)) continue;
      n += Math.max(0, (this.#moduleSpent.get(id) ?? 0) + (this.#moduleReserved.get(id) ?? 0) - a);
    }
    return n;
  }

  /**
   * Reserves the most the next call can cost. Throws CapReached when spent plus this ceiling would
   * pass the run cap, or the module's allocation plus the free pool. Returns a release function
   * that settles the call at what it really charged.
   */
  reserve(module: string, maxUsd: number): (chargedUsd: number) => void {
    if (this.#spent + this.#reserved + maxUsd > this.cap + 1e-9) {
      throw new CapReached(module, "run", `cap reached: ${this.spent.toFixed(4)} spent of ${this.cap.toFixed(2)}, next call could cost up to ${maxUsd.toFixed(4)}`);
    }
    const tr = this.limits.totalRuns;
    if (tr !== undefined && this.#runs + 1 > tr) {
      throw new CapReached(module, "run", `run cap reached: ${this.#runs} of ${tr} paid calls made`);
    }
    const sec = this.limits.sections[module];
    if (sec) {
      const sr = this.#sectionRuns.get(module) ?? 0;
      if (sec.runs !== undefined && sr + 1 > sec.runs) {
        throw new CapReached(module, "section", `stopped at its cap: ${sr} of ${sec.runs} paid calls made`);
      }
      const sUsd = (this.#moduleSpent.get(module) ?? 0) + (this.#moduleReserved.get(module) ?? 0);
      if (sec.usd !== undefined && sUsd + maxUsd > sec.usd + 1e-9) {
        throw new CapReached(module, "section", `stopped at its cap: ${sUsd.toFixed(4)} of ${sec.usd.toFixed(2)} USD used, next call could cost up to ${maxUsd.toFixed(4)}`);
      }
    }
    const own = this.#alloc.get(module) ?? 0;
    const mine = (this.#moduleSpent.get(module) ?? 0) + (this.#moduleReserved.get(module) ?? 0);
    const room = own + Math.max(0, this.pool() - this.#poolUsedByOthers(module));
    if (mine + maxUsd > room + 1e-9) {
      throw new CapReached(module, "module", `${module} used its share of the cap (${mine.toFixed(4)} of ${room.toFixed(4)})`);
    }
    this.#runs += 1;
    this.#sectionRuns.set(module, (this.#sectionRuns.get(module) ?? 0) + 1);
    this.#reserved += maxUsd;
    this.#moduleReserved.set(module, (this.#moduleReserved.get(module) ?? 0) + maxUsd);
    let open = true;
    return (charged: number) => {
      if (!open) return;
      open = false;
      this.#reserved -= maxUsd;
      this.#moduleReserved.set(module, (this.#moduleReserved.get(module) ?? 0) - maxUsd);
      this.#spent += charged;
      this.#moduleSpent.set(module, (this.#moduleSpent.get(module) ?? 0) + charged);
    };
  }

  /** Marks a module done so its unspent share joins the pool. */
  finish(module: string): void {
    this.#finished.add(module);
  }
}

export interface CapCheck {
  ok: boolean;
  /** Printed to the user. */
  message: string;
}

/** The refusal rule. A quote whose expected total is above the cap never starts. */
export function checkQuoteAgainstCap(expected: number, worst: number, cap: number): CapCheck {
  if (expected > cap) {
    return { ok: false, message: `Refused. The expected cost (${expected.toFixed(2)} USD) is above your cap (${cap.toFixed(2)} USD). Raise --cap, use --depth sample, or turn modules off in gtm/config.yaml.` };
  }
  if (worst > cap) {
    return { ok: true, message: `Worst case (${worst.toFixed(2)} USD) is above the cap. The run stops at the cap and writes a partial dossier.` };
  }
  return { ok: true, message: `Worst case (${worst.toFixed(2)} USD) fits under the cap (${cap.toFixed(2)} USD).` };
}

/** Suggested cap: the worst case rounded up to the next whole dollar, at least 1. */
export function suggestCap(worst: number): number {
  return Math.max(1, Math.ceil(worst));
}

function posNum(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} should be a positive number`);
  return n;
}

/** Reads `caps:` from the brief (total_usd, total_runs, sections.<id>.usd/runs; camelCase works too). */
export function parseCaps(raw: unknown): CapLimits | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("caps should be a map");
  const r = raw as Record<string, unknown>;
  const out: CapLimits = { sections: {} };
  const tu = posNum(r.total_usd ?? r.totalUsd, "caps.total_usd");
  const tr = posNum(r.total_runs ?? r.totalRuns, "caps.total_runs");
  if (tu !== undefined) out.totalUsd = tu;
  if (tr !== undefined) out.totalRuns = Math.floor(tr);
  const secs = r.sections ?? {};
  if (typeof secs !== "object" || Array.isArray(secs)) throw new Error("caps.sections should map a module id to its limits");
  for (const [id, v] of Object.entries(secs as Record<string, unknown>)) {
    const o = (v ?? {}) as Record<string, unknown>;
    const usd = posNum(o.usd, `caps.sections.${id}.usd`);
    const runs = posNum(o.runs, `caps.sections.${id}.runs`);
    out.sections[id] = { ...(usd !== undefined ? { usd } : {}), ...(runs !== undefined ? { runs: Math.floor(runs) } : {}) };
  }
  return out;
}

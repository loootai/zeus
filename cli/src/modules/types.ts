import type { CallResult } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Section } from "../dossier/blocks.js";

export interface QuoteLine {
  job: string;
  calls: number;
  /** Rows per call for result-priced jobs. */
  rows?: number;
  note?: string;
  /**
   * Share of the calls expected to bill, for steps that bill only a hit (the later phone steps). Lowers the
   * expected price only. The worst case still counts every call at its ceiling.
   */
  billedShare?: number;
}

export interface ModuleQuote {
  lines: QuoteLine[];
  /** Set when the module skips itself for this config, with the reason printed to the user. */
  skip?: string;
}

export type ModuleStatus = "done" | "skipped" | "capped";

export interface ModuleResult {
  status: ModuleStatus;
  /** One line, printed in the run and kept in the receipt. */
  summary: string;
  out: unknown;
  /** "section" when the module stopped at its own hard cap (the run went on); "limit" when the workspace spend limit stopped the run. */
  capScope?: "section" | "limit";
}

export interface ModuleContext {
  cfg: GtmConfig;
  mode: "live" | "demo";
  /** Outputs of the modules this one needs, by module id. */
  outputs: Readonly<Record<string, unknown>>;
  outDir: string;
  /**
   * Runs one paid job call through the cap. Throws CapReached when the next call could pass the
   * cap. step must be stable across re-runs (it feeds the idempotency key).
   */
  call(job: string, input: Record<string, unknown>, step: string): Promise<CallResult>;
  /** Stores what the module has so far, so a cap stop still renders it. */
  partial(out: unknown): void;
  log(line: string): void;
}

export interface RenderOptions {
  public: boolean;
}

export interface GtmModule {
  id: string;
  label: string;
  needs: string[];
  /** True for modules not built yet. They skip in a live run and render fixtures in demo. */
  stub?: boolean;
  quote(cfg: GtmConfig): ModuleQuote;
  run(ctx: ModuleContext): Promise<ModuleResult>;
  /** Dossier section for this module's output, null when it has none of its own. */
  render(out: unknown, status: ModuleStatus, opts: RenderOptions): Section | null;
  /**
   * A section this module renders only when the module that usually shows its output (the host)
   * ended with no rows. People use it. They show inside enrich, or on their own when enrich found nothing.
   */
  standIn?: { host: string; render(out: unknown, status: ModuleStatus, opts: RenderOptions): Section | null };
  /** Extra files under gtm/, path relative to gtm/ mapped to text. */
  files?(out: unknown): Record<string, string>;
}

// The workspace guardrails Zeus respects. Read once before the quote from the free GET /v1/guardrails/effective
// (any role of the workspace may read its own effective guardrail). Zeus reads only `effective.blockedPlatforms`:
// a platform listed in an enforce guardrail marks the Zeus steps that read it "may be blocked" in the quote. Zeus does not skip
// them itself: the gateway decides per provider (platform terms facts, exceptions), and a refusal becomes a skipped step. A read that fails leaves the run as it is and says so in one line; the gateway
// still enforces the guardrail on every run, and a refusal mid-run becomes a skipped step (modules/index.ts).

/** The platforms Zeus knows, each with the jobs that read it. A platform not listed here blocks nothing in Zeus. */
const PLATFORM_JOBS: Record<string, RegExp> = {
  linkedin: /^(linkedin\.|ads\.linkedin\.)/,
  x: /^x\./,
  twitter: /^x\./,
  reddit: /^reddit\./,
  meta: /^ads\.meta\./,
  facebook: /^ads\.meta\./,
  instagram: /^ads\.meta\./,
  amazon: /^amazon\./,
  google: /^(google\.|ads\.google\.|maps\.)/,
  maps: /^maps\./,
  appstore: /^reviews\.appstore\./,
  apple: /^reviews\.appstore\./,
  chatgpt: /^chatgpt\./,
  openai: /^chatgpt\./,
};

/** The workspace rule as Zeus applies it. */
export interface WorkspaceRule {
  blockedPlatforms: string[];
}

/** What the guardrail read gave: the rule (null when none applies or the read failed) and one line to print. */
export interface GuardrailRead {
  rule: WorkspaceRule | null;
  note: string;
}

/** The rule that blocks this job, in words ("blockedPlatforms x"), or undefined when none does. */
export function ruleFor(job: string, rule: WorkspaceRule | null | undefined): string | undefined {
  for (const p of rule?.blockedPlatforms ?? []) {
    const re = PLATFORM_JOBS[p.toLowerCase()];
    if (re?.test(job)) return `blockedPlatforms ${p.toLowerCase()}`;
  }
  return undefined;
}

/** True when the rule turns LinkedIn steps off. */
export function ruleBlocksLinkedin(rule: WorkspaceRule | null | undefined): boolean {
  return ruleFor("linkedin.company.posts", rule) !== undefined;
}

/** The words a quote line carries when an enforce guardrail may refuse it (the gateway decides, per provider, with its exceptions). */
export function ruleMayBlockText(rule: string): string {
  return `may be blocked by your workspace rule: ${rule}`;
}

/** The words a skipped step or section carries. */
export function ruleSkipText(rule: string): string {
  return `skipped by your workspace rule: ${rule}`;
}

/**
 * Turns the body of GET /v1/guardrails/effective into a rule. Only guardrails in mode "enforce" count: a shadow guardrail only
 * records what it would have blocked. Reads each enforce guardrail's own blockedPlatforms (a `noLinkedIn: true` flag counts as
 * "linkedin"). The pooled `effective` block mixes in shadow guardrails, so it is not read.
 */
export function ruleFromEffective(body: unknown): WorkspaceRule | null {
  const b = (body ?? {}) as { guardrails?: { mode?: unknown; settings?: { blockedPlatforms?: unknown; noLinkedIn?: unknown } }[] };
  const list: string[] = [];
  for (const g of Array.isArray(b.guardrails) ? b.guardrails : []) {
    if (g?.mode !== "enforce") continue;
    const bp = g.settings?.blockedPlatforms;
    if (Array.isArray(bp)) list.push(...bp.filter((x): x is string => typeof x === "string" && x !== ""));
    if (g.settings?.noLinkedIn === true) list.push("linkedin");
  }
  const blockedPlatforms = [...new Set(list.map((x) => x.toLowerCase()))];
  return blockedPlatforms.length > 0 ? { blockedPlatforms } : null;
}

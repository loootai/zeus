// The looot calls /gtm makes. Lifted from looot-js and looot-signals (MIT, loootai) and cut down.
// Every paid call goes to "job:<id>" with fallback on and a per-call ceiling (fallback.maxCostUsd),
// so looot walks the job's providers inside one hold and stops before a charge past that ceiling.
// Idempotency key = sha256(module, step, input): a re-run of the same step with the same input
// replays the stored run and is never charged twice.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { JOBS } from "./modules/jobs.js";
import { sha256, stableStringify } from "./util.js";
import { ruleFromEffective, type GuardrailRead } from "./guardrails.js";

export const DEFAULT_BASE_URL = "https://api.looot.ai";
export const TERMINAL = new Set(["completed", "failed", "blocked", "stopped"]);

export type Outcome = "hit" | "miss" | "fail" | "fallback";

export class LoootError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The top-up link a 402 insufficient_balance answer carries, when it has one. */
    readonly topUpUrl?: string,
    /** Seconds to wait before the next try, from a 429's body or Retry-After header. */
    readonly retryAfterSeconds?: number,
    /** The workspace's in-flight run limit, from a 429 too_many_inflight_runs body. */
    readonly limit?: number,
  ) {
    super(message);
    this.name = "LoootError";
  }
}

export interface RouteAttempt {
  n?: number;
  endpointId?: string;
  provider?: string;
  outcome?: string;
  status?: string;
  chargedUsd?: number;
  ms?: number;
}

export interface LoootRun {
  runId: string;
  status: string;
  endpointId?: string;
  outcome?: string;
  outcomeReason?: string;
  result?: unknown;
  normalized?: Record<string, unknown>;
  estimatedCost?: number;
  actualCost?: number | string | null;
  error?: { code?: string; message?: string; whoseError?: string; retryable?: boolean } | null;
  replayed?: boolean;
  route?: { servedBy?: string; outcome?: string; chargedUsd?: number; capped?: boolean; attempts?: RouteAttempt[]; summary?: string };
}

/** One line of the ledger. The same shape as receipt.calls[]. */
export interface CallRecord {
  module: string;
  job: string;
  provider: string;
  /** The job has one provider only, so a miss or a failure had no fallback. Set on every row. */
  singleProvider?: boolean;
  outcome: Outcome;
  fallbackFrom?: string;
  quoted: number;
  charged: number;
  ms: number;
  ts: string;
  runId?: string;
  /** looot answered from a run with the same key, so nothing new was charged. charged is 0, firstCharged is what the first run cost. */
  replayed?: boolean;
  firstCharged?: number;
  /** looot may have charged this call but its cost could not be read back (timeout, disconnect, 5xx). charged is the call's ceiling. */
  costUnknown?: boolean;
  note?: string;
}

/** The note on a call whose cost could not be read back. */
export const COST_UNKNOWN = "cost unknown, counted at its limit";

export interface CallResult {
  record: CallRecord;
  run: LoootRun;
  data: unknown;
}

export interface CallOptions {
  module: string;
  step: string;
  /** The ceiling for this call. Sent as fallback.maxCostUsd. */
  maxCostUsd: number;
  /** Shown as the quoted price on the receipt line. */
  quotedUsd: number;
}

/** What modules call. The live client and the demo fixture client both implement it. */
export interface JobRunner {
  call(job: string, input: Record<string, unknown>, opts: CallOptions): Promise<CallResult>;
}

/** Returns the row with singleProvider set from the job table, placed right after provider. */
export function withSingleProvider(rec: CallRecord): CallRecord {
  const { module, job, provider, singleProvider: _drop, ...rest } = rec;
  return { module, job, provider, singleProvider: JOBS[job]?.singleProvider ?? false, ...rest };
}

/** sha256 of module, step and the input with sorted keys. */
export function idempotencyKey(module: string, step: string, input: Record<string, unknown>): string {
  return `gtm-${sha256(stableStringify([module, step, input])).slice(0, 40)}`;
}

/** The key used after an idempotency_conflict: the step, the input, the endpoint and the ceiling. */
export function conflictKey(module: string, step: string, input: Record<string, unknown>, job: string, maxCostUsd: number): string {
  return idempotencyKey(module, `${step}@${JOBS[job]?.endpoint ?? `job:${job}`}@${maxCostUsd}`, input);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function providerOf(a: RouteAttempt | undefined, fallback?: string): string {
  return a?.provider ?? a?.endpointId ?? fallback ?? "unknown";
}

/**
 * Maps a settled run to a ledger line.
 * hit       the first provider answered (outcome hit or weak)
 * fallback  a later provider answered after an earlier one missed or failed; fallbackFrom names the first
 * miss      every provider tried came back empty. A miss is an answer, the row says so.
 * fail      error, rejected input, blocked, still pending when waiting stopped, or anything else
 * charged is what looot settled (actualCost, else route.chargedUsd, else 0 for a run that never completed).
 */
export function toRecord(run: LoootRun, job: string, opts: CallOptions, ms: number, ts: string): CallRecord {
  const attempts = run.route?.attempts ?? [];
  const final = (run.route?.outcome ?? run.outcome ?? "").toLowerCase();
  const charged = num(run.actualCost) ?? num(run.route?.chargedUsd) ?? 0;
  const servedBy = run.route?.servedBy ?? providerOf(attempts.at(-1), run.endpointId);
  let outcome: Outcome;
  let fallbackFrom: string | undefined;
  let note: string | undefined;
  if (run.status === "completed" && (final === "hit" || final === "weak")) {
    if (attempts.length > 1) {
      outcome = "fallback";
      fallbackFrom = providerOf(attempts[0]);
    } else outcome = "hit";
  } else if (run.status === "completed" && final === "miss") {
    outcome = "miss";
  } else {
    outcome = "fail";
    note = run.error?.code ? `${run.error.code}${run.error.whoseError ? ` (${run.error.whoseError})` : ""}` : `status ${run.status}${final ? `, outcome ${final}` : ""}`;
    if (!TERMINAL.has(run.status)) note = `still ${run.status} when waiting stopped, read it again with runs_get ${run.runId}`;
  }
  return {
    module: opts.module,
    job,
    provider: servedBy,
    singleProvider: JOBS[job]?.singleProvider ?? false,
    outcome,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    quoted: num(run.estimatedCost) ?? opts.quotedUsd,
    // A replayed run was paid for when it first ran. This run spends nothing on it.
    charged: run.replayed ? 0 : charged,
    ms,
    ts,
    runId: run.runId,
    ...(run.replayed ? { replayed: true, firstCharged: charged } : {}),
    ...(note ? { note } : {}),
  };
}

export interface LoootClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to keep reading a run whose cost is not known yet, after the poll timeout or a lost answer. Default 60 s. */
  readBackMs?: number;
  /** Most runs this client keeps in flight at once. Default 6, under the gateway's per-workspace limit of 8. */
  maxInflight?: number;
  /** Tries of one call refused with 429 (too_many_inflight_runs, run_rate_limited) before it is recorded as failed. Default 6. */
  busyTries?: number;
}

/** The 429 answers that mean "busy, nothing was charged, try again shortly". */
export const BUSY_CODES = new Set(["too_many_inflight_runs", "run_rate_limited"]);

/** A counting gate: at most `max` holders at once, the rest wait in order. `max` can shrink when looot says its limit is lower. */
export class Gate {
  #active = 0;
  readonly #waiting: (() => void)[] = [];
  constructor(public max: number) {}
  get active(): number { return this.#active; }
  async acquire(): Promise<void> {
    if (this.#active < this.max && this.#waiting.length === 0) { this.#active++; return; }
    await new Promise<void>((r) => this.#waiting.push(r));
  }
  release(): void {
    this.#active--;
    while (this.#active < this.max && this.#waiting.length > 0) {
      this.#active++;
      this.#waiting.shift()!();
    }
  }
}

export class LoootClient implements JobRunner {
  readonly #token: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #pollTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #readBackMs: number;
  readonly #gate: Gate;
  readonly #busyTries: number;

  constructor(o: LoootClientOptions) {
    this.#token = o.token;
    this.#base = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = o.fetch ?? fetch;
    this.#pollTimeoutMs = o.pollTimeoutMs ?? 120_000;
    this.#pollIntervalMs = o.pollIntervalMs ?? 2_000;
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = o.now ?? Date.now;
    this.#readBackMs = o.readBackMs ?? 60_000;
    this.#gate = new Gate(Math.max(1, o.maxInflight ?? 6));
    this.#busyTries = Math.max(1, o.busyTries ?? 6);
  }

  /**
   * Starts and polls a run inside the in-flight gate. A 429 busy answer (nothing was charged and no run
   * exists) waits retryAfterSeconds, or a growing backoff, and tries again with the same key, up to busyTries.
   */
  async #gatedRunAndWait(job: string, input: Record<string, unknown>, key: string, maxCostUsd: number, seen?: (run: LoootRun) => void): Promise<LoootRun> {
    for (let i = 1; ; i++) {
      await this.#gate.acquire();
      let err: unknown;
      try {
        return await this.runAndWait(job, input, key, maxCostUsd, seen);
      } catch (e) {
        err = e;
      } finally {
        this.#gate.release();
      }
      const le = err as LoootError;
      if (!(err instanceof LoootError) || le.status !== 429 || !BUSY_CODES.has(le.code ?? "") || i >= this.#busyTries) throw err;
      // looot says its limit is lower than ours: stay under it from now on.
      if (le.limit && le.limit > 0 && le.limit - 2 < this.#gate.max) this.#gate.max = Math.max(1, le.limit - 2);
      const wait = Math.min(30_000, Math.max(le.retryAfterSeconds ? le.retryAfterSeconds * 1000 : 0, 1000 * 2 ** (i - 1)));
      await this.#sleep(wait);
    }
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const j = json as { error?: { message?: string; code?: string }; topUpUrl?: unknown; topUp?: { url?: unknown; checkoutUrl?: unknown }; retryAfterSeconds?: unknown; limit?: unknown } | null;
      const err = j?.error;
      const link = [j?.topUpUrl, j?.topUp?.checkoutUrl, j?.topUp?.url].find((x): x is string => typeof x === "string" && x !== "");
      const after = num(j?.retryAfterSeconds) ?? num(res.headers?.get?.("retry-after") ?? undefined);
      throw new LoootError(err?.message ?? `looot answered HTTP ${res.status}`, res.status, err?.code, link, after, num(j?.limit));
    }
    return json as T;
  }

  /** Paid. One job run with fallback inside the per-call ceiling. Waits up to 30 s inline. */
  run(job: string, input: Record<string, unknown>, key: string, maxCostUsd: number): Promise<LoootRun> {
    return this.#request("POST", "/v1/runs?wait=30", {
      endpointId: JOBS[job]?.endpoint ?? `job:${job}`,
      input,
      idempotencyKey: key,
      fallback: { enabled: true, maxAttempts: 3, maxCostUsd },
    });
  }

  /** Free. Reads a run again. */
  getRun(runId: string): Promise<LoootRun> {
    return this.#request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  /** How long a job may poll. Slow async jobs (chatgpt.search.answer) get a longer wait. */
  pollTimeoutFor(job: string): number {
    return Math.max(this.#pollTimeoutMs, JOBS[job]?.pollTimeoutMs ?? 0);
  }

  /** Runs and polls until the run settles or the poll timeout passes. `seen` gets the run id as soon as looot gives one. */
  async runAndWait(job: string, input: Record<string, unknown>, key: string, maxCostUsd: number, seen?: (run: LoootRun) => void): Promise<LoootRun> {
    let run = await this.run(job, input, key, maxCostUsd);
    seen?.(run);
    const deadline = this.#now() + this.pollTimeoutFor(job);
    while (!TERMINAL.has(run.status) && this.#now() < deadline) {
      await this.#sleep(this.#pollIntervalMs);
      run = await this.getRun(run.runId);
      seen?.(run);
    }
    return run;
  }

  /** Reads a run again until it settles or readBackMs passes. Null when it cannot be read or is still not settled. */
  async #readBack(runId: string): Promise<LoootRun | null> {
    const deadline = this.#now() + this.#readBackMs;
    for (;;) {
      try {
        const run = await this.getRun(runId);
        if (TERMINAL.has(run.status)) return run;
      } catch {
        // A lost answer while reading back: try again until the deadline.
      }
      if (this.#now() >= deadline) return null;
      await this.#sleep(this.#pollIntervalMs);
    }
  }

  async call(job: string, input: Record<string, unknown>, opts: CallOptions): Promise<CallResult> {
    const started = this.#now();
    const ts = new Date(started).toISOString();
    const key = idempotencyKey(opts.module, opts.step, input);
    let run: LoootRun;
    // True when looot may have admitted the run (and may charge up to its ceiling) but its cost is not known.
    let unknown = false;
    const attempt = async (k: string): Promise<LoootRun> => {
      let last: LoootRun | undefined;
      unknown = false;
      try {
        const r = await this.#gatedRunAndWait(job, input, k, opts.maxCostUsd, (x) => (last = x));
        if (TERMINAL.has(r.status)) return r;
        // Still running when the poll timeout passed: looot may still charge it. Read it back.
        const back = await this.#readBack(r.runId);
        if (back) return back;
        unknown = true;
        return r;
      } catch (e) {
        // Out of credits, bad token and other refusals before admission hold nothing and charge nothing.
        const err = e as LoootError;
        // A workspace guardrail refusal is an answer for this one call: the step is skipped, the run goes on.
        if (isGuardrailCode(err.code)) return { runId: "", status: "blocked", error: { code: err.code, message: err.message, whoseError: "customer" } };
        if (isBalanceStop(e) || err.status === 401 || err.status === 403) throw e;
        // A lost answer (disconnect) or a 5xx: the run may exist and be charged. Read it back when its id is known.
        const lost = !(e instanceof LoootError) || err.status >= 500;
        if (lost && last?.runId) {
          const back = await this.#readBack(last.runId);
          if (back) return back;
        }
        if (lost) unknown = true;
        const code = e instanceof LoootError ? (err.code ?? `http_${err.status}`) : "connection_lost";
        return { runId: last?.runId ?? "", status: last?.status ?? "blocked", error: { code, message: (e as Error).message } };
      }
    };
    run = await attempt(key);
    // The same step once ran with another endpoint or ceiling (google.company.ads replaced ads.google.search
    // under the same step name), so looot refuses the old key. One retry with a key that also carries the
    // endpoint and ceiling: a run with exactly this request still replays for free next time.
    if (run.error?.code === "idempotency_conflict") run = await attempt(conflictKey(opts.module, opts.step, input, job, opts.maxCostUsd));
    let record = toRecord(run, job, opts, this.#now() - started, ts);
    // The cap must hold: a call that may have been charged counts at its ceiling until looot says otherwise.
    if (unknown) record = { ...record, outcome: "fail", charged: opts.maxCostUsd, costUnknown: true, note: `${COST_UNKNOWN}${record.note ? `; ${record.note}` : ""}` };
    return { record, run, data: run.normalized ?? run.result ?? null };
  }

  /** Free. The workspace guardrails that apply to this key (GET /v1/guardrails/effective). Throws when the gateway cannot answer. */
  async effectiveGuardrails(): Promise<unknown> {
    return this.#request("GET", "/v1/guardrails/effective");
  }

  /** Free. Asks the workspace budgets whether amountUsd still fits (POST /v1/budgets/preview). Needs budgets:read. */
  async budgetPreview(amountUsd: number): Promise<unknown> {
    return this.#request("POST", "/v1/budgets/preview", { dimensions: {}, amountMicros: Math.max(1, Math.ceil(amountUsd * 1_000_000)), currency: "USD" });
  }

  /** Free. The workspace budget policies with their period (GET /v1/budgets). Needs budgets:read. */
  async budgets(): Promise<unknown> {
    return this.#request("GET", "/v1/budgets");
  }

  /** Free. What the workspace spend limits leave for a run whose worst case is worstUsd. Never throws. */
  spendLimit(worstUsd: number): Promise<SpendLimitRead> {
    return readSpendLimit(this, worstUsd);
  }

  /** Free. Prepaid balance in USD, or null when the answer has no number. */
  async balanceUsd(): Promise<number | null> {
    const b = await this.#request<Record<string, unknown>>("GET", "/v1/balance");
    return num(b?.available) ?? num(b?.balanceUsd) ?? null;
  }
}

/** Path of the token `looot login` saves: `$XDG_CONFIG_HOME/looot/config.json`, else `$HOME/.config/looot/config.json`. */
export function savedLoginPath(env: Record<string, string | undefined> = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const home = env.HOME?.trim() || homedir();
  return join(xdg || join(home, ".config"), "looot", "config.json");
}

/** Reads the token and API address `looot login` saved, or null. Never throws and never prints the token. */
export function readSavedLogin(env: Record<string, string | undefined> = process.env): { token: string; apiUrl?: string } | null {
  if (env.LOOOT_ZEUS_NO_SAVED_LOGIN === "1") return null;
  try {
    const v = JSON.parse(readFileSync(savedLoginPath(env), "utf8")) as Record<string, unknown>;
    const token = typeof v?.token === "string" ? v.token.trim() : "";
    if (!token) return null;
    return { token, apiUrl: typeof v.apiUrl === "string" && /^https:\/\//.test(v.apiUrl) ? v.apiUrl : undefined };
  } catch {
    return null;
  }
}

/** Builds a client from LOOOT_TOKEN, else from the login `looot login` saved. The token value never leaves this function. */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): LoootClient | null {
  const token = env.LOOOT_TOKEN?.trim();
  if (token) return new LoootClient({ token, baseUrl: env.LOOOT_API_URL });
  const saved = readSavedLogin(env);
  if (!saved) return null;
  return new LoootClient({ token: saved.token, baseUrl: env.LOOOT_API_URL || saved.apiUrl });
}

/** The gateway's guardrail refusal codes (docs/engineering/CLI-MCP-CONTRACT.md). */
export function isGuardrailCode(code: string | undefined): boolean {
  return code === "guardrail_blocked" || code === "guardrail_unavailable";
}

/** A 402 refusal: the wallet (insufficient_balance) or the key's own monthly limit (key_spend_limit_reached). No further paid call can pass. */
export function isBalanceStop(e: unknown): e is LoootError {
  return e instanceof LoootError && (e.status === 402 || e.code === "insufficient_balance" || e.code === "key_spend_limit_reached");
}

/**
 * Reads the workspace guardrails before the quote. Never throws: no client, an older gateway, offline or any
 * error gives no rule and a one-line note saying so.
 */
export async function readWorkspaceRule(client: { effectiveGuardrails(): Promise<unknown> } | null, offline = false): Promise<GuardrailRead> {
  const none = "Workspace guardrails not read";
  if (offline) return { rule: null, note: `${none} (offline), the quote assumes none. looot still applies them on every run.` };
  if (!client) return { rule: null, note: `${none} (no LOOOT_TOKEN), the quote assumes none. looot still applies them on every run.` };
  try {
    const rule = ruleFromEffective(await client.effectiveGuardrails());
    return rule ? { rule, note: `Workspace guardrails read: blockedPlatforms ${rule.blockedPlatforms.join(", ")}.` } : { rule: null, note: "Workspace guardrails read: none block a Zeus step." };
  } catch (e) {
    const why = e instanceof LoootError ? `looot answered ${e.code ?? `HTTP ${e.status}`}` : "the gateway could not be reached";
    return { rule: null, note: `${none} (${why}), the quote assumes none. looot still applies them on every run.` };
  }
}

/** The run was refused by a workspace spend limit (a looot budget, daily or monthly). No further paid call can pass. */
export function isSpendLimitCode(code: string | undefined | null): boolean {
  return code === "budget_exceeded";
}

/** Where a customer raises a workspace spend limit. */
export const SPEND_LIMIT_URL = "https://looot.ai/usage";

/**
 * What the workspace spend limits leave for this run, read before the quote is accepted.
 * none     no limit applies
 * ok       every limit has room for the worst case
 * below    a limit has less left than the worst case (availableUsd is the smallest room)
 * unknown  the key cannot read the limits (no budgets:read) or looot did not answer: the run goes on and stops at the first refusal
 */
export interface SpendLimitRead {
  state: "none" | "ok" | "below" | "unknown";
  availableUsd?: number;
  /** daily, monthly or lifetime, when the tightest limit's period is known. */
  period?: string;
  note: string;
}

/** "daily spend limit", or "spend limit" when the period is not known. */
export function limitName(period?: string): string {
  return `${period && period !== "lifetime" ? `${period} ` : ""}spend limit`;
}

function usd4(n: number): string {
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/** Reads the workspace spend limits for a run whose worst case is worstUsd. Never throws. */
export async function readSpendLimit(client: { budgetPreview(amountUsd: number): Promise<unknown>; budgets?(): Promise<unknown> } | null, worstUsd: number): Promise<SpendLimitRead> {
  const goOn = "the run goes on and stops at the first spend-limit refusal, keeping what it found.";
  if (!client) return { state: "unknown", note: `Workspace spend limits not read (no LOOOT_TOKEN), ${goOn}` };
  let body: { allowed?: unknown; checks?: { policyId?: unknown; availableMicros?: unknown }[] };
  try {
    body = ((await client.budgetPreview(worstUsd)) ?? {}) as typeof body;
  } catch (e) {
    if (e instanceof LoootError && (e.status === 403 || e.status === 401)) return { state: "unknown", note: `This key cannot read the workspace spend limits (budgets:read), so the quote cannot check them; ${goOn}` };
    const why = e instanceof LoootError ? `looot answered ${e.code ?? `HTTP ${e.status}`}` : "the gateway could not be reached";
    return { state: "unknown", note: `Workspace spend limits not read (${why}), ${goOn}` };
  }
  const checks = (Array.isArray(body.checks) ? body.checks : []).map((c) => ({ policyId: typeof c?.policyId === "string" ? c.policyId : "", available: num(c?.availableMicros) })).filter((c): c is { policyId: string; available: number } => c.available !== undefined);
  if (checks.length === 0) return { state: "none", note: "Workspace spend limits read: none apply." };
  const tight = checks.reduce((a, b) => (b.available < a.available ? b : a));
  const availableUsd = tight.available / 1_000_000;
  let period: string | undefined;
  try {
    const list = ((await client.budgets?.()) ?? {}) as { budgets?: { policyId?: unknown; period?: unknown }[] };
    const p = (Array.isArray(list.budgets) ? list.budgets : []).find((b) => b?.policyId === tight.policyId)?.period;
    if (typeof p === "string") period = p;
  } catch {
    // The period only names the limit. The preview already gave the room.
  }
  const name = limitName(period);
  const below = body.allowed === false || availableUsd < worstUsd;
  return below
    ? { state: "below", availableUsd, ...(period ? { period } : {}), note: `Your ${name} has ${usd4(availableUsd)} left, below this run's worst case of ${usd4(worstUsd)}.` }
    : { state: "ok", availableUsd, ...(period ? { period } : {}), note: `Workspace spend limits read: your ${name} has ${usd4(availableUsd)} left, room for the worst case.` };
}

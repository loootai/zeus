// The looot calls /gtm makes. Lifted from looot-js and looot-signals (MIT, loootai) and cut down.
// Every paid call goes to "job:<id>" with fallback on and a per-call ceiling (fallback.maxCostUsd),
// so looot walks the job's providers inside one hold and stops before a charge past that ceiling.
// Idempotency key = sha256(module, step, input): a re-run of the same step with the same input
// replays the stored run and is never charged twice.

import { JOBS } from "./modules/jobs.js";
import { sha256, stableStringify } from "./util.js";

export const DEFAULT_BASE_URL = "https://api.looot.ai";
export const TERMINAL = new Set(["completed", "failed", "blocked", "stopped"]);

export type Outcome = "hit" | "miss" | "fail" | "fallback";

export class LoootError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
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
  note?: string;
}

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
}

export class LoootClient implements JobRunner {
  readonly #token: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #pollTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;

  constructor(o: LoootClientOptions) {
    this.#token = o.token;
    this.#base = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = o.fetch ?? fetch;
    this.#pollTimeoutMs = o.pollTimeoutMs ?? 120_000;
    this.#pollIntervalMs = o.pollIntervalMs ?? 2_000;
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = o.now ?? Date.now;
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
      const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
      throw new LoootError(err?.message ?? `looot answered HTTP ${res.status}`, res.status, err?.code);
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

  /** Runs and polls until the run settles or the poll timeout passes. */
  async runAndWait(job: string, input: Record<string, unknown>, key: string, maxCostUsd: number): Promise<LoootRun> {
    let run = await this.run(job, input, key, maxCostUsd);
    const deadline = this.#now() + this.pollTimeoutFor(job);
    while (!TERMINAL.has(run.status) && this.#now() < deadline) {
      await this.#sleep(this.#pollIntervalMs);
      run = await this.getRun(run.runId);
    }
    return run;
  }

  async call(job: string, input: Record<string, unknown>, opts: CallOptions): Promise<CallResult> {
    const started = this.#now();
    const ts = new Date(started).toISOString();
    const key = idempotencyKey(opts.module, opts.step, input);
    let run: LoootRun;
    const attempt = async (k: string): Promise<LoootRun> => {
      try {
        return await this.runAndWait(job, input, k, opts.maxCostUsd);
      } catch (e) {
        // Out of credits, bad token and other refusals before admission hold nothing and charge nothing.
        const err = e as LoootError;
        if (err.code === "insufficient_balance" || err.status === 401 || err.status === 403) throw e;
        return { runId: "", status: "blocked", error: { code: err.code ?? `http_${err.status ?? "error"}`, message: err.message } };
      }
    };
    run = await attempt(key);
    // The same step once ran with another endpoint or ceiling (google.company.ads replaced ads.google.search
    // under the same step name), so looot refuses the old key. One retry with a key that also carries the
    // endpoint and ceiling: a run with exactly this request still replays for free next time.
    if (run.error?.code === "idempotency_conflict") run = await attempt(conflictKey(opts.module, opts.step, input, job, opts.maxCostUsd));
    const record = toRecord(run, job, opts, this.#now() - started, ts);
    return { record, run, data: run.normalized ?? run.result ?? null };
  }

  /** Free. Prepaid balance in USD, or null when the answer has no number. */
  async balanceUsd(): Promise<number | null> {
    const b = await this.#request<Record<string, unknown>>("GET", "/v1/balance");
    return num(b?.available) ?? num(b?.balanceUsd) ?? null;
  }
}

/** Builds a client from LOOOT_TOKEN. The token value never leaves this function. */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): LoootClient | null {
  const token = env.LOOOT_TOKEN?.trim();
  if (!token) return null;
  return new LoootClient({ token, baseUrl: env.LOOOT_API_URL });
}

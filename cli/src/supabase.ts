// `looot-zeus import-supabase`: load a run's results into your own Supabase project.
// Tables come from supabase/migrations/20261125120000_zeus.sql. Rows are upserted by domain
// through Supabase's REST API with the service role key, which is read from the environment
// and never printed, logged or written to a file.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RunState } from "./more.js";

/** The rows one import writes, per table. */
export interface SupabaseRows {
  run: { domain: string; mode: "live" | "demo"; finished_at: string | null; charged_usd: number | null; calls: number | null };
  accounts: Record<string, unknown>[];
  committees: Record<string, unknown>[];
  people: Record<string, unknown>[];
  plays: Record<string, unknown>[];
  rivals: Record<string, unknown>[];
}

/** Conflict columns per table: the dedupe key each upsert merges on. */
export const SUPABASE_CONFLICT: Record<"accounts" | "committees" | "people" | "plays" | "rivals", string> = {
  accounts: "domain",
  committees: "account_domain",
  people: "account_domain,person_key",
  plays: "run_domain,title",
  rivals: "domain",
};

const s = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === "" ? null : String(v));
const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? Math.round(x) : null;
};
const dom = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const personKey = (p: any): string => String(p?.linkedin ?? "").trim().toLowerCase().replace(/\/+$/, "") || String(p?.name ?? "").trim().toLowerCase();

/**
 * Turns a run's state.json (and receipt.json) into table rows, deduped by domain.
 * Emails and phones stay null unless contactDetails is true and the run was not safe.
 */
export function supabaseRowsOf(state: RunState, receipt: any, o: { contactDetails: boolean }): SupabaseRows {
  const out = (id: string): any => state.results[id]?.out ?? {};
  const details = o.contactDetails && state.safe !== true && state.mode === "live";
  const runDomain = dom((state.cfg as any)?.domain ?? receipt?.run?.domain);

  const accounts = new Map<string, Record<string, unknown>>();
  for (const a of (out("accounts").rows ?? []) as any[]) {
    const d = dom(a?.domain);
    if (!d || accounts.has(d)) continue;
    accounts.set(d, { domain: d, name: s(a.name), industry: s(a.industry), employees: n(a.employees ?? a.size), country: s(a.country), grade: s(a.grade), score: n(a.score), reasons: Array.isArray(a.reasons) ? a.reasons.join("; ") : s(a.reasons), provider: s(a.provider) });
  }

  const committees = new Map<string, Record<string, unknown>>();
  const people = new Map<string, Record<string, unknown>>();
  const addPerson = (d: string, p: any, role: string | null): void => {
    if (!d || !p?.name) return;
    const key = personKey(p);
    const k = `${d}|${key}`;
    const prev = people.get(k);
    const row = { account_domain: d, person_key: key, name: String(p.name), role: role ?? (prev?.role as string | null) ?? null, title: s(p.title) ?? (prev?.title as string | null) ?? null, linkedin: s(p.linkedin), email: details ? s(p.email) : null, email_status: s(p.emailStatus ?? p.status), phone: details ? s(p.phone) : null };
    people.set(k, prev ? { ...prev, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) } : row);
  };
  for (const c of (out("committee").accounts ?? []) as any[]) {
    const d = dom(c?.domain);
    if (!d) continue;
    const members = Array.isArray(c.members) ? c.members : [];
    committees.set(d, { account_domain: d, account_name: s(c.account), grade: s(c.grade), score: n(c.score), members: members.length });
    if (!accounts.has(d)) accounts.set(d, { domain: d, name: s(c.account), grade: s(c.grade), score: n(c.score) });
    for (const m of members) addPerson(d, m, s(m?.role));
  }
  for (const p of [...((out("people").rows ?? []) as any[]), ...((out("enrich").rows ?? []) as any[])]) {
    const d = dom(p?.domain);
    if (d && !accounts.has(d)) accounts.set(d, { domain: d, name: s(p.account) });
    addPerson(d, p, null);
  }

  const plays = new Map<string, Record<string, unknown>>();
  for (const p of (out("synthesis").plays ?? out("plays").plays ?? []) as any[]) {
    const t = s(p?.title);
    if (!t || plays.has(t)) continue;
    plays.set(t, { run_domain: runDomain, title: t, evidence: s(p.evidence), list: s(p.list), command: s(p.command), cost: s(p.cost), basis: s(p.basis) });
  }

  const rivals = new Map<string, Record<string, unknown>>();
  for (const r of (out("competitors").cards ?? []) as any[]) {
    const d = dom(r?.domain);
    if (!d || rivals.has(d)) continue;
    rivals.set(d, { domain: d, name: s(r.name), positioning: s(r.positioning), card: r });
  }

  const charged = typeof receipt?.run?.charged === "number" ? receipt.run.charged : null;
  return {
    run: { domain: runDomain, mode: state.mode, finished_at: s(receipt?.run?.finishedAt), charged_usd: charged, calls: Array.isArray(receipt?.calls) ? receipt.calls.length : null },
    accounts: [...accounts.values()],
    committees: [...committees.values()],
    people: [...people.values()],
    plays: [...plays.values()],
    rivals: [...rivals.values()],
  };
}

export interface SupabaseTarget {
  url: string;
  key: string;
}

/** Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env. Returns which names are missing, never a value. */
export function supabaseFromEnv(env: NodeJS.ProcessEnv = process.env): { target: SupabaseTarget | null; missing: string[] } {
  const url = (env.SUPABASE_URL ?? "").trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[];
  if (missing.length) return { target: null, missing };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a URL.");
  }
  if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new Error("SUPABASE_URL must be https (or localhost).");
  return { target: { url: u.origin, key }, missing: [] };
}

/** Removes the key from any text before it reaches a log or an error. */
export function redact(text: string, key: string): string {
  return key ? text.split(key).join("[redacted]") : text;
}

/** Upserts every table through PostgREST (runs first, then accounts before the tables that reference them). */
export async function importToSupabase(rows: SupabaseRows, target: SupabaseTarget, fetchFn: typeof fetch = fetch): Promise<{ runId: string; counts: Record<string, number> }> {
  const headers = (prefer: string): Record<string, string> => ({ apikey: target.key, Authorization: `Bearer ${target.key}`, "Content-Type": "application/json", Prefer: prefer });
  const call = async (path: string, body: unknown, prefer: string): Promise<any> => {
    const res = await fetchFn(`${target.url}/rest/v1/${path}`, { method: "POST", headers: headers(prefer), body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(redact(`Supabase ${path.split("?")[0]} answered ${res.status}: ${text.slice(0, 300)}${res.status === 404 ? " (did you apply supabase/migrations/20261125120000_zeus.sql?)" : ""}`, target.key));
    return text ? JSON.parse(text) : null;
  };
  const created = await call("runs", [rows.run], "return=representation");
  const runId = String(created?.[0]?.id ?? "");
  if (!runId) throw new Error("Supabase created the run row but returned no id.");
  const counts: Record<string, number> = {};
  for (const t of ["accounts", "committees", "people", "plays", "rivals"] as const) {
    // PostgREST bulk inserts need the same keys on every object (PGRST102): fill missing ones with null.
    const cols = [...new Set(rows[t].flatMap((r) => Object.keys(r)))];
    const list = rows[t].map((r) => ({ ...Object.fromEntries(cols.map((c) => [c, null])), ...r, run_id: runId, updated_at: new Date().toISOString() }));
    counts[t] = list.length;
    if (!list.length) continue;
    await call(`${t}?on_conflict=${encodeURIComponent(SUPABASE_CONFLICT[t])}`, list, "resolution=merge-duplicates,return=minimal");
  }
  return { runId, counts };
}

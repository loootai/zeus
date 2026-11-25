// The learning rules. Pure functions: the same learnings and the same outcomes always give the same
// weights. learn calls `learnFrom`. A run calls `runEntry` to keep one line per run.
//
// Rules (numbers in LEARN, schema.ts):
// - A weight moves toward the group's reply rate divided by the average reply rate, by at most
//   25 percent of its old value per learn. It stays between 0.5 and 1.5.
// - Nothing moves on a group (an industry, a size band, a country or a title) under 30 sends.
// - An angle ranks only with 30 sends and 3 replies.
// - An industry with under 40 percent valid emails on 30 or more lookups loses 10 percent, once it
//   also has 30 sends in the results. Under 30 sends the cut is held and a note says so.
// - A title weight is keyed on the ICP title it matches ("Head of Sales EMEA" counts for
//   "head of sales"), so run --apply-learnings finds it. A title with no ICP match keeps its own key.
// - A provider is noted on a job after 20 calls when its hit rate leads the next one by 15 points.
// - Bounced addresses go on the suppress list and are left out of the next exports.

import { matchTerm } from "../modules/accounts.js";
import type { Receipt } from "../receipt.js";
import { sha256, stableStringify } from "../util.js";
import type { Lead, Outcome } from "./results.js";
import {
  type Angle,
  type Change,
  DIMENSIONS,
  type Dimension,
  type EmailTally,
  keyOf,
  LEARN,
  type Learnings,
  type ProviderPref,
  type RunEntry,
  type Segment,
  sizeBandOf,
  type Tally,
  type Weights,
} from "./schema.js";

export interface Send extends Lead {
  angle?: string;
  campaign?: string;
}

export interface Scored extends Send {
  replied: boolean;
  bounced: boolean;
  meeting: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const per100 = (r: number, n: number) => (n > 0 ? Math.round((1000 * r) / n) / 10 : 0);

/** One step of a weight toward a target, inside the cap and the bounds. */
export function stepWeight(old: number, target: number): number {
  const lo = Math.max(LEARN.min, old * (1 - LEARN.stepCap));
  const hi = Math.min(LEARN.max, old * (1 + LEARN.stepCap));
  // Rounding to two decimals can step past the cap (0.71 up gives 0.8875, which rounds to 0.89).
  // Round inward instead, so the step never moves more than 25 percent.
  let next = round2(clamp(target, lo, hi));
  if (next < lo) next = Math.ceil(lo * 100) / 100;
  if (next > hi) next = Math.floor(hi * 100) / 100;
  return round2(clamp(next, LEARN.min, LEARN.max));
}

export const DIM_WORD: Record<Dimension, string> = { industry: "industry", sizeBand: "size", country: "country", title: "title" };
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The ICP title a provider title counts for, in lower case. The title itself when no ICP title matches. */
export function titleKey(title: string, icpTitles: string[] = []): string {
  if (!title) return "";
  const hit = icpTitles.length > 0 ? matchTerm(title, icpTitles) : undefined;
  return keyOf(hit ?? title);
}

function keyFor(s: Scored, d: Dimension, icpTitles: string[]): string {
  return d === "title" ? titleKey(s.title, icpTitles) : keyOf(s[d]);
}

/** Joins sends and outcomes by email. A send with no outcome row counts as sent with no reply. */
export function joinOutcomes(sends: Send[], outcomes: Outcome[]): Scored[] {
  const by = new Map<string, Outcome>();
  for (const o of outcomes) {
    const p = by.get(o.email);
    by.set(o.email, p ? { ...p, replied: p.replied || o.replied, bounced: p.bounced || o.bounced, meeting: p.meeting || o.meeting, interested: p.interested || o.interested } : o);
  }
  return sends.map((s) => {
    const o = by.get(s.email);
    return { ...s, replied: !!o?.replied && !o?.bounced, bounced: !!o?.bounced, meeting: !!o?.meeting };
  });
}

export interface LearnResult {
  next: Learnings;
  changes: Change[];
  /** Plain lines on why something did not move. */
  notes: string[];
  sends: number;
  replies: number;
  bounces: number;
  already: boolean;
}

/** The fingerprint of a set of outcomes, so the same file never moves a weight twice. */
export function fingerprint(scored: Scored[]): string {
  const rows = scored.map((s) => [s.email, s.campaign ?? "", s.replied, s.bounced, s.meeting]).sort((a, b) => String(a).localeCompare(String(b)));
  return `results:${sha256(stableStringify(rows)).slice(0, 16)}`;
}

function aggregateAngles(scored: Scored[]): Angle[] {
  const m = new Map<string, Angle>();
  for (const s of scored) {
    if (!s.angle) continue;
    const a = m.get(s.angle) ?? { name: s.angle, sends: 0, replies: 0, meetings: 0 };
    a.sends++;
    if (s.replied) a.replies++;
    if (s.meeting) a.meetings++;
    m.set(s.angle, a);
  }
  return [...m.values()].sort((a, b) => b.sends - a.sends || a.name.localeCompare(b.name));
}

/** Angles that may rank, best reply rate first. */
export function rankedAngles(angles: Angle[]): Angle[] {
  return angles.filter((a) => a.sends >= LEARN.angleSends && a.replies >= LEARN.angleReplies).sort((a, b) => b.replies / b.sends - a.replies / a.sends || b.sends - a.sends);
}

function aggregateSegments(scored: Scored[]): Segment[] {
  const m = new Map<string, Segment>();
  for (const s of scored) {
    const k = `${s.grade}|${keyOf(s.industry)}|${keyOf(s.title)}`;
    const g = m.get(k) ?? { grade: s.grade, industry: keyOf(s.industry), title: s.title, sends: 0, replies: 0, bounces: 0, meetings: 0 };
    g.sends++;
    if (s.replied) g.replies++;
    if (s.bounced) g.bounces++;
    if (s.meeting) g.meetings++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.sends - a.sends);
}

/** Providers noted per job, from every run kept. Reported only, never pinned. */
export function providerPrefs(runs: RunEntry[]): ProviderPref[] {
  const jobs = new Map<string, Map<string, Tally>>();
  for (const r of runs)
    for (const [job, provs] of Object.entries(r.providers ?? {}))
      for (const [p, t] of Object.entries(provs)) {
        const j = jobs.get(job) ?? new Map<string, Tally>();
        const cur = j.get(p) ?? { hit: 0, miss: 0, fail: 0, fallback: 0 };
        j.set(p, { hit: cur.hit + (t.hit ?? 0), miss: cur.miss + (t.miss ?? 0), fail: cur.fail + (t.fail ?? 0), fallback: cur.fallback + (t.fallback ?? 0) });
        jobs.set(job, j);
      }
  const out: ProviderPref[] = [];
  for (const [job, provs] of jobs) {
    const rows = [...provs.entries()].map(([provider, t]) => {
      const calls = t.hit + t.miss + t.fail + t.fallback;
      return { provider, calls, hitRate: calls > 0 ? Math.round((100 * (t.hit + t.fallback)) / calls) : 0 };
    });
    const total = rows.reduce((n, r) => n + r.calls, 0);
    if (total < LEARN.providerCalls || rows.length < 2) continue;
    rows.sort((a, b) => b.hitRate - a.hitRate || b.calls - a.calls);
    if (rows[0].hitRate - rows[1].hitRate >= LEARN.providerLead) out.push({ job, provider: rows[0].provider, hitRate: rows[0].hitRate, calls: rows[0].calls, status: "noted" });
  }
  return out.sort((a, b) => a.job.localeCompare(b.job));
}

/**
 * One learn. Takes the learnings so far and what happened, returns the new learnings, the
 * changes (one per weight that moved) and the reasons nothing else moved.
 */
export function learnFrom(prev: Learnings, sends: Send[], outcomes: Outcome[], date: string, o: { icpTitles?: string[] } = {}): LearnResult {
  const icpTitles = o.icpTitles ?? [];
  const scored = joinOutcomes(sends, outcomes);
  const total = scored.length;
  const replies = scored.filter((s) => s.replied).length;
  const bounces = scored.filter((s) => s.bounced).length;
  const fp = fingerprint(scored);
  const newRuns = prev.runs.filter((r) => !prev.learnedFrom.includes(`run:${r.at}`));
  const notes: string[] = [];
  const base = { sends: total, replies, bounces };

  if (total > 0 && prev.learnedFrom.includes(fp) && newRuns.length === 0) {
    notes.push(`These results were already learned from${prev.lastLearn ? ` on ${prev.lastLearn.date}` : ""}. Nothing changed.`);
    return { next: prev, changes: [], notes, ...base, already: true };
  }

  const weights: Weights = { industry: { ...prev.weights.industry }, sizeBand: { ...prev.weights.sizeBand }, country: { ...prev.weights.country }, title: { ...prev.weights.title } };
  const targets = new Map<string, { d: Dimension; key: string; target: number; sends: number; replies: number; why: string[]; signal: string }>();
  const avg = total > 0 ? replies / total : 0;

  // Replies. Only from outcomes not learned before.
  if (total > 0 && !prev.learnedFrom.includes(fp)) {
    let biggest = 0;
    let moved = 0;
    for (const d of DIMENSIONS) {
      const groups = new Map<string, { n: number; r: number }>();
      for (const s of scored) {
        const k = keyFor(s, d, icpTitles);
        if (!k) continue;
        const g = groups.get(k) ?? { n: 0, r: 0 };
        g.n++;
        if (s.replied) g.r++;
        groups.set(k, g);
      }
      for (const [key, g] of groups) {
        biggest = Math.max(biggest, g.n);
        if (g.n < LEARN.minSends || avg === 0) continue;
        const ratio = g.r / g.n / avg;
        const old = weights[d][key] ?? 1;
        const target = clamp(ratio, LEARN.min, LEARN.max);
        if (Math.abs(stepWeight(old, target) - old) < 0.01) continue;
        moved++;
        targets.set(`${d}|${key}`, {
          d,
          key,
          target,
          sends: g.n,
          replies: g.r,
          signal: "replies",
          why: [`replied ${per100(g.r, g.n)} per 100 sends against ${per100(replies, total)} on average`],
        });
      }
    }
    if (biggest < LEARN.minSends) notes.push(`Nothing changed from the replies. The biggest group has ${biggest} sends. A weight moves only after ${LEARN.minSends} sends on one industry, size, country or title.`);
    else if (avg === 0) notes.push(`Nothing changed from the replies. ${total} sends and no replies yet, so there is nothing to compare.`);
    else if (moved === 0) notes.push(`Nothing changed from the replies. Every group with ${LEARN.minSends} or more sends replied close to the average of ${per100(replies, total)} per 100.`);
  } else if (total === 0) {
    notes.push("No sends or replies to learn from yet.");
  }

  // Email quality from the runs not learned from yet.
  const valid = new Map<string, EmailTally>();
  for (const r of newRuns)
    for (const [k, t] of Object.entries(r.emails?.industry ?? {})) {
      const v = valid.get(k) ?? { attempts: 0, found: 0, valid: 0 };
      valid.set(k, { attempts: v.attempts + t.attempts, found: v.found + t.found, valid: v.valid + t.valid });
    }
  const sendsByIndustry = new Map<string, number>();
  for (const s of scored) {
    const k = keyOf(s.industry);
    if (k) sendsByIndustry.set(k, (sendsByIndustry.get(k) ?? 0) + 1);
  }
  for (const [key, t] of [...valid.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!key || t.attempts < LEARN.validAttempts || t.valid / t.attempts >= LEARN.validShare) continue;
    const n = sendsByIndustry.get(key) ?? 0;
    if (n < LEARN.minSends) {
      notes.push(`Industry ${key} had ${t.valid} of ${t.attempts} valid emails, under ${Math.round(LEARN.validShare * 100)} percent. Its weight is held because it has ${n} ${n === 1 ? "send" : "sends"} in these results and a weight moves only after ${LEARN.minSends}. The next run's lookups count again.`);
      continue;
    }
    const id = `industry|${key}`;
    const cur = targets.get(id);
    const why = `${t.valid} of ${t.attempts} emails were valid, under ${Math.round(LEARN.validShare * 100)} percent, so it loses ${Math.round(LEARN.validCut * 100)} percent`;
    const old = weights.industry[key] ?? 1;
    if (cur) {
      cur.target = cur.target * (1 - LEARN.validCut);
      cur.why.push(why);
      cur.signal = "replies and valid emails";
    } else targets.set(id, { d: "industry", key, target: old * (1 - LEARN.validCut), sends: t.attempts, replies: 0, signal: "valid emails", why: [why] });
  }

  const changes: Change[] = [];
  for (const t of [...targets.values()].sort((a, b) => a.d.localeCompare(b.d) || a.key.localeCompare(b.key))) {
    const old = weights[t.d][t.key] ?? 1;
    const neu = stepWeight(old, t.target);
    if (Math.abs(neu - old) < 0.01) continue;
    const capped = Math.abs(round2(clamp(t.target, LEARN.min, LEARN.max)) - neu) >= 0.01;
    weights[t.d][t.key] = neu;
    changes.push({
      date,
      dimension: t.d,
      key: t.key,
      signal: t.signal,
      sends: t.sends,
      replies: t.replies,
      old,
      new: neu,
      why: `${cap1(t.why.join(". Also "))}${capped ? `. Held to ${Math.round(LEARN.stepCap * 100)} percent per learn` : ""}.`,
    });
  }

  const suppress = [...new Set([...prev.suppress, ...scored.filter((s) => s.bounced).map((s) => s.email)])].sort();
  const learnedFrom = [...new Set([...prev.learnedFrom, ...(total > 0 ? [fp] : []), ...newRuns.map((r) => `run:${r.at}`)])];
  const next: Learnings = {
    ...prev,
    updatedAt: new Date().toISOString(),
    weights,
    angles: total > 0 ? aggregateAngles(scored) : prev.angles,
    segments: total > 0 ? aggregateSegments(scored) : prev.segments,
    providerPrefs: providerPrefs(prev.runs),
    suppress,
    lastLearn: { date, changes },
    learnedFrom,
  };
  return { next, changes, notes, ...base, already: false };
}

// ---- one line per run ---------------------------------------------------------------------------

/** What a run keeps in learnings.json: spend, grades, emails per industry and size, providers per job. */
export function runEntry(receipt: Receipt, outputs: Record<string, any>): RunEntry {
  const accountRows: any[] = outputs.accounts?.rows ?? [];
  const accounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const a of accountRows) accounts[a.grade] = (accounts[a.grade] ?? 0) + 1;
  const byDomain = new Map(accountRows.map((a) => [keyOf(a.domain), a]));
  const emails: RunEntry["emails"] = { industry: {}, sizeBand: {} };
  const bump = (m: Record<string, EmailTally>, k: string, found: boolean, ok: boolean) => {
    if (!k) return;
    const t = m[k] ?? { attempts: 0, found: 0, valid: 0 };
    m[k] = { attempts: t.attempts + 1, found: t.found + (found ? 1 : 0), valid: t.valid + (ok ? 1 : 0) };
  };
  for (const p of outputs.enrich?.rows ?? []) {
    if (p.status === "not looked up" || p.status === "not checked") continue;
    const a = byDomain.get(keyOf(p.domain));
    const found = !!p.email;
    const ok = p.status === "valid";
    bump(emails.industry, keyOf(a?.industry), found, ok);
    bump(emails.sizeBand, sizeBandOf(a?.employees), found, ok);
  }
  const providers: RunEntry["providers"] = {};
  const tally = (job: string, p: string) => {
    providers[job] ??= {};
    return (providers[job][p] ??= { hit: 0, miss: 0, fail: 0, fallback: 0 });
  };
  for (const c of receipt.calls) {
    if (!c.provider) continue;
    tally(c.job, c.provider)[c.outcome]++;
    if (c.outcome === "fallback" && c.fallbackFrom) tally(c.job, c.fallbackFrom).miss++;
  }
  return {
    date: receipt.run.startedAt.slice(0, 10),
    at: receipt.run.startedAt,
    charged: receipt.run.charged,
    calls: receipt.run.calls,
    worst: receipt.run.worst,
    accounts,
    emails,
    providers,
  };
}

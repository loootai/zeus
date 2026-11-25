// gtm/learnings.json. What Zeus keeps between runs: one line per run, the weights it learned from
// replies, the angles and segments it saw plus the providers it noted. The schema file is
// schema/learnings.schema.json. Zeus reads this file. It never sends anything.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFile } from "../util.js";

export const LEARN = {
  /** A weight never goes below or above these. */
  min: 0.5,
  max: 1.5,
  /** The most one learn may move a weight, as a share of its old value. */
  stepCap: 0.25,
  /** A group needs this many sends before its weight moves. */
  minSends: 30,
  /** An angle ranks only with this many sends and replies. */
  angleSends: 30,
  angleReplies: 3,
  /** An industry with valid emails under this share on at least `validAttempts` lookups loses `validCut`, once it has `minSends` sends. */
  validShare: 0.4,
  validAttempts: 30,
  validCut: 0.1,
  /** A provider is noted on a job after this many calls when its hit rate leads the next one by `providerLead` points. */
  providerCalls: 20,
  providerLead: 15,
} as const;

export type Dimension = "industry" | "sizeBand" | "country" | "title";
export const DIMENSIONS: Dimension[] = ["industry", "sizeBand", "country", "title"];

export interface Tally {
  hit: number;
  miss: number;
  fail: number;
  fallback: number;
}

export interface EmailTally {
  attempts: number;
  found: number;
  valid: number;
}

export interface RunEntry {
  date: string;
  at: string;
  charged: number;
  calls: number;
  /** Worst case quoted for the run, used for the suggested cap. */
  worst?: number;
  accounts: Record<string, number>;
  emails: { industry: Record<string, EmailTally>; sizeBand: Record<string, EmailTally> };
  /** job -> provider -> outcomes. A fallback row counts as a miss for the provider that missed first. */
  providers: Record<string, Record<string, Tally>>;
}

export interface Weights {
  industry: Record<string, number>;
  sizeBand: Record<string, number>;
  country: Record<string, number>;
  title: Record<string, number>;
}

export interface Angle {
  name: string;
  sends: number;
  replies: number;
  meetings: number;
}

export interface Segment {
  grade: string;
  industry: string;
  title: string;
  sends: number;
  replies: number;
  bounces: number;
  meetings: number;
}

export interface ProviderPref {
  job: string;
  provider: string;
  hitRate: number;
  calls: number;
  status: "noted";
}

export interface Change {
  date: string;
  dimension: Dimension;
  key: string;
  signal: string;
  sends: number;
  replies: number;
  old: number;
  new: number;
  why: string;
}

export interface Learnings {
  schemaVersion: "1";
  updatedAt: string;
  runs: RunEntry[];
  weights: Weights;
  angles: Angle[];
  segments: Segment[];
  providerPrefs: ProviderPref[];
  /** Addresses that bounced. They are left out of the next exports. */
  suppress: string[];
  /** The changes the last learn made, so a run can say how many it uses. */
  lastLearn?: { date: string; changes: Change[] };
  /** Fingerprints of the outcome files already learned from, so the same file never moves a weight twice. */
  learnedFrom: string[];
  placeholder?: string;
}

export function emptyWeights(): Weights {
  return { industry: {}, sizeBand: {}, country: {}, title: {} };
}

export function emptyLearnings(): Learnings {
  return { schemaVersion: "1", updatedAt: new Date(0).toISOString(), runs: [], weights: emptyWeights(), angles: [], segments: [], providerPrefs: [], suppress: [], learnedFrom: [] };
}

export const learningsPath = (outDir: string) => join(outDir, "learnings.json");

/** Reads gtm/learnings.json. A missing or broken file gives empty learnings. */
export function readLearnings(outDir: string): Learnings | null {
  const f = learningsPath(outDir);
  if (!existsSync(f)) return null;
  try {
    return normalizeLearnings(JSON.parse(readFileSync(f, "utf8")));
  } catch {
    return null;
  }
}

export function normalizeLearnings(raw: any): Learnings {
  const e = emptyLearnings();
  const w = raw?.weights ?? {};
  return {
    ...e,
    ...raw,
    schemaVersion: "1",
    runs: Array.isArray(raw?.runs) ? raw.runs : [],
    weights: { industry: w.industry ?? {}, sizeBand: w.sizeBand ?? {}, country: w.country ?? {}, title: w.title ?? {} },
    angles: Array.isArray(raw?.angles) ? raw.angles : [],
    segments: Array.isArray(raw?.segments) ? raw.segments : [],
    providerPrefs: Array.isArray(raw?.providerPrefs) ? raw.providerPrefs : [],
    suppress: Array.isArray(raw?.suppress) ? raw.suppress : [],
    learnedFrom: Array.isArray(raw?.learnedFrom) ? raw.learnedFrom : [],
  };
}

export function writeLearnings(outDir: string, l: Learnings): void {
  writeFile(learningsPath(outDir), JSON.stringify(l, null, 2) + "\n");
}

/** Number of weights that differ from 1. */
export function weightCount(w: Weights): number {
  return DIMENSIONS.reduce((n, d) => n + Object.values(w[d]).filter((x) => x !== 1).length, 0);
}

/** "1-10", "11-50", "51-200", "201-1000", "1001+" from a headcount. "" when unknown. */
export function sizeBandOf(employees: unknown): string {
  const n = typeof employees === "number" ? employees : Number(String(employees ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || String(employees ?? "").trim() === "") return "";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 1000) return "201-1000";
  return "1001+";
}

/** Keys are compared in lower case with single spaces. */
export function keyOf(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

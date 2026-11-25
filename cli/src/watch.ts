// `looot-zeus watch --demo`: shows what gtm/changes.md looks like, on placeholder data, with no call.
// The live `watch` is a capped re-run (see cmdWatch in commands.ts): every run compares itself with
// the last one and writes gtm/changes.md. See src/history.ts.

import { join } from "node:path";
import { normalizeConfig } from "./config.js";
import { buildSnapshot, changesMarkdown, type Snapshot } from "./history.js";
import { loadFixture } from "./modules/fixture.js";
import type { Receipt } from "./receipt.js";
import { writeFile } from "./util.js";

export { diffRows, rowsOf, type RowDiff } from "./history.js";

const FIXTURES = ["accounts", "competitors", "ads", "seo", "signals", "mentions", "people", "enrich"];

function fakeReceipt(at: string, charged: number, calls: number): Receipt {
  return { schemaVersion: "1", run: { domain: "yourdomain.com", mode: "demo", startedAt: at, finishedAt: at, cap: 5, expected: 0, worst: 0, charged, calls, durationMs: 0, capStopped: false, priceSource: "placeholder" }, modules: [], calls: [] };
}

/** Two placeholder snapshots a week apart, with a few invented changes between them. */
export function demoSnapshots(): { prev: Snapshot; next: Snapshot } {
  const cfg = normalizeConfig(loadFixture("config").config);
  const outputs: Record<string, any> = Object.fromEntries(FIXTURES.map((f) => [f, loadFixture(f)]));
  const prev = buildSnapshot(cfg, outputs, fakeReceipt("2026-10-30T09:00:00.000Z", 1.58, 298));
  const next = buildSnapshot(cfg, outputs, fakeReceipt("2026-11-06T09:00:00.000Z", 1.61, 301));
  next.accounts = [{ domain: "northpeak-supply.example", name: "Northpeak Supply", grade: "A", score: 88, industry: "wholesale" }, ...next.accounts.slice(1)];
  next.signals = [{ account: "Northpeak Supply", date: "2026-11-05", type: "hiring", title: "Posted 2 Account Executive roles" }, ...next.signals];
  next.rivals = next.rivals.map((r) => (r.competitor === "Rival A" && r.what === "price" && r.plan === "Pro" ? { ...r, price: "$59/user/mo" } : r));
  next.ranks = next.ranks.map((r, i) => (i === 0 && typeof r.you === "number" ? { ...r, you: Math.max(1, r.you - 3) } : r));
  next.mentions = [{ date: "2026-11-05", platform: "Reddit", title: "Which CRM after the Rival A price change?", url: "https://example.com/r/10" }, ...next.mentions];
  return { prev, next };
}

export function watchDemo(outDir: string): string {
  const { prev, next } = demoSnapshots();
  const file = join(outDir, "changes.md");
  writeFile(file, `> PLACEHOLDER. An example on invented data.\n\n${changesMarkdown(prev, next)}`);
  return file;
}

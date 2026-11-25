// Week over week. Every run writes gtm/snapshot.json, a small copy of what the dossier found.
// Before a new run writes its files, the last snapshot, receipt and dossier.md are copied to
// gtm/history/<date of that run>/. After the run, gtm/changes.md says what changed since then:
// new accounts, rival changes, rank moves, new signals, new mentions and ad changes.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GtmConfig } from "./config.js";
import type { Receipt } from "./receipt.js";
import { stableStringify, usd, writeFile } from "./util.js";

type Row = Record<string, unknown>;

export interface Snapshot {
  schemaVersion: "1";
  at: string;
  domain: string;
  brand: string;
  charged: number;
  calls: number;
  competitors: { domain: string; name: string }[];
  accounts: { domain: string; name: string; grade: string; score: number; industry?: string }[];
  /** Lookalike candidates from icp and your seed customers. Used by export --public --mask-accounts. */
  lookalikes?: { domain: string; name: string; industry: string }[];
  seeds?: string[];
  people: { name: string; email: string; linkedin: string; phone: string; account: string }[];
  rivals: Row[];
  ranks: { keyword: string; you: number | null }[];
  signals: Row[];
  mentions: Row[];
  ads: Row[];
}

export interface RowDiff {
  added: Row[];
  removed: Row[];
}

/** Rows keyed by the given fields. Same key, different content counts as removed plus added. */
export function diffRows(prev: Row[], next: Row[], key: (r: Row) => string = stableStringify): RowDiff {
  const p = new Set(prev.map(key));
  const n = new Set(next.map(key));
  return { added: next.filter((r) => !p.has(key(r))), removed: prev.filter((r) => !n.has(key(r))) };
}

/** The rows `watch --demo` and the snapshot compare, per module output. */
export function rowsOf(id: string, out: any): Row[] {
  if (!out) return [];
  if (id === "competitors") return (out.cards ?? []).flatMap((c: any) => [...(c.pricing ?? []).map((p: any) => ({ what: "price", competitor: c.name, plan: p.plan, price: p.price })), ...(c.news ?? []).map((x: any) => ({ what: "news", competitor: c.name, date: x.date, title: x.title }))]);
  if (id === "ads") return (out.advertisers ?? []).map((a: any) => ({ advertiser: a.name, headline: a.sample?.headline ?? "", angles: (a.angles ?? []).join(", ") }));
  return out.rows ?? [];
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function buildSnapshot(cfg: GtmConfig, outputs: Record<string, any>, receipt: Receipt): Snapshot {
  const cards: any[] = outputs.competitors?.cards ?? [];
  const names = new Map<string, string>(cards.map((c) => [str(c.domain), str(c.name)]));
  const peopleRows: any[] = (outputs.enrich?.rows?.length ? outputs.enrich.rows : outputs.people?.rows) ?? [];
  return {
    schemaVersion: "1",
    at: receipt.run.startedAt,
    domain: cfg.domain,
    brand: cfg.brand,
    charged: receipt.run.charged,
    calls: receipt.run.calls,
    competitors: [...new Set([...cfg.competitors, ...cards.map((c) => str(c.domain)).filter(Boolean)])].map((d) => ({ domain: d, name: names.get(d) ?? "" })),
    accounts: (outputs.accounts?.rows ?? []).map((a: any) => ({ domain: str(a.domain), name: str(a.name), grade: str(a.grade), score: Number(a.score) || 0, industry: str(a.industry) })),
    lookalikes: (outputs.icp?.lookalikes ?? []).map((a: any) => ({ domain: str(a.domain), name: str(a.name), industry: str(a.industry) })),
    seeds: [...cfg.seeds],
    people: [
      ...peopleRows.map((p) => ({ name: str(p.name), email: str(p.email), linkedin: str(p.linkedin), phone: str(p.phone), account: str(p.account) })),
      ...((outputs.committee?.accounts ?? []) as any[]).flatMap((a) => (a.members ?? []).map((m: any) => ({ name: str(m.name), email: str(m.email), linkedin: str(m.linkedin), phone: str(m.phone), account: str(a.account) }))),
    ],
    rivals: rowsOf("competitors", outputs.competitors),
    ranks: (outputs.seo?.ranks ?? []).map((r: any) => ({ keyword: str(r.keyword), you: typeof r.you === "number" ? r.you : null })),
    signals: (outputs.signals?.rows ?? []).map((r: any) => ({ account: r.account, date: r.date, type: r.type, title: r.title })),
    mentions: (outputs.mentions?.rows ?? []).map((r: any) => ({ date: r.date, platform: r.platform, title: r.title, url: r.url })),
    ads: rowsOf("ads", outputs.ads),
  };
}

export function readSnapshot(outDir: string): Snapshot | null {
  const f = join(outDir, "snapshot.json");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

/** Copies the last run's snapshot, receipt and dossier.md to gtm/history/<its date>/. Returns that snapshot. */
export function archivePrevious(outDir: string): Snapshot | null {
  const prev = readSnapshot(outDir);
  if (!prev) return null;
  const dir = join(outDir, "history", prev.at.slice(0, 16).replace(/:/g, "-"));
  mkdirSync(dir, { recursive: true });
  for (const f of ["snapshot.json", "receipt.json", "dossier.md"]) if (existsSync(join(outDir, f))) copyFileSync(join(outDir, f), join(dir, f));
  return prev;
}

export interface Changes {
  accounts: RowDiff;
  rivals: RowDiff;
  ranks: { keyword: string; was: number | null; now: number | null }[];
  signals: Row[];
  mentions: Row[];
  ads: RowDiff;
  total: number;
}

export function diffSnapshots(prev: Snapshot, next: Snapshot): Changes {
  const accounts = diffRows(prev.accounts, next.accounts, (r) => str(r.domain));
  const rivals = diffRows(prev.rivals, next.rivals);
  const was = new Map(prev.ranks.map((r) => [r.keyword, r.you]));
  const ranks = next.ranks.filter((r) => was.has(r.keyword) && was.get(r.keyword) !== r.you).map((r) => ({ keyword: r.keyword, was: was.get(r.keyword) ?? null, now: r.you }));
  const signals = diffRows(prev.signals, next.signals).added;
  const mentions = diffRows(prev.mentions, next.mentions, (r) => str(r.url) || stableStringify(r)).added;
  const ads = diffRows(prev.ads, next.ads);
  const total = accounts.added.length + accounts.removed.length + rivals.added.length + rivals.removed.length + ranks.length + signals.length + mentions.length + ads.added.length + ads.removed.length;
  return { accounts, rivals, ranks, signals, mentions, ads, total };
}

const rank = (n: number | null) => (n === null ? "not in the top results" : `#${n}`);

function rankLine(r: { keyword: string; was: number | null; now: number | null }): string {
  let move = "";
  if (r.was !== null && r.now !== null) move = r.now < r.was ? `, up ${r.was - r.now}` : `, down ${r.now - r.was}`;
  return `- "${r.keyword}" went from ${rank(r.was)} to ${rank(r.now)}${move}`;
}

export function changesMarkdown(prev: Snapshot, next: Snapshot, c: Changes = diffSnapshots(prev, next)): string {
  const out = [
    "# What changed since last week",
    "",
    `Last run ${prev.at.slice(0, 10)}, this run ${next.at.slice(0, 10)}. This run cost ${usd(next.charged)} for ${next.calls} calls. The last one cost ${usd(prev.charged)}.`,
    `${c.total === 0 ? "Nothing changed." : `${c.total} changes.`} The last run's files are in history/${prev.at.slice(0, 16).replace(/:/g, "-")}/.`,
    "",
  ];
  const section = (title: string, lines: string[]) => {
    out.push(`## ${title} (${lines.length})`, "");
    out.push(...(lines.length > 0 ? lines : ["No change."]), "");
  };
  section("New accounts", c.accounts.added.map((a) => `- ${a.name || a.domain} (${a.domain}), grade ${a.grade}`));
  if (c.accounts.removed.length > 0) section("Accounts no longer found", c.accounts.removed.map((a) => `- ${a.name || a.domain} (${a.domain})`));
  section("Rival changes", [
    ...c.rivals.added.map((r) => `- new ${r.what} for ${r.competitor}, ${r.what === "price" ? `${r.plan} at ${r.price}` : `${r.date} ${r.title}`}`),
    ...c.rivals.removed.map((r) => `- gone ${r.what} for ${r.competitor}, ${r.what === "price" ? `${r.plan} at ${r.price}` : `${r.date} ${r.title}`}`),
  ]);
  section("Rank moves", c.ranks.map(rankLine));
  section("New signals", c.signals.map((s) => `- ${s.account}, ${s.type}, ${s.title} (${s.date})`));
  section("New mentions", c.mentions.map((m) => `- ${m.platform}, ${m.title} (${m.date})`));
  section("Ad changes", [...c.ads.added.map((a) => `- new ad from ${a.advertiser}, "${a.headline}"`), ...c.ads.removed.map((a) => `- ad gone from ${a.advertiser}, "${a.headline}"`)]);
  return out.join("\n");
}

/** Writes snapshot.json and, when there was a run before, changes.md. Returns the changes. */
export function recordRun(outDir: string, prev: Snapshot | null, next: Snapshot): Changes | null {
  writeFile(join(outDir, "snapshot.json"), JSON.stringify(next, null, 2) + "\n");
  if (!prev) return null;
  const c = diffSnapshots(prev, next);
  writeFile(join(outDir, "changes.md"), changesMarkdown(prev, next, c));
  return c;
}

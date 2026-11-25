// `looot-zeus more <what>`. Fetches more of one thing into an existing gtm/ folder: more accounts
// (with their people and emails), a buying committee for more accounts, the next page of ads, the
// next page of social posts, or rankings for more of the keyword gaps. It reads gtm/state.json,
// prices the extra calls first, asks for a yes, runs only those modules, merges the new rows into
// what the folder has and writes the dossier again. In a demo folder it adds placeholder rows and
// makes no call.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GtmConfig } from "./config.js";
import type { ModuleResult } from "./modules/types.js";
import { SEARCH_ROWS } from "./modules/accounts.js";
import { gaps as adGaps } from "./modules/ads.js";
import { FREE_COMMITTEE_ACCOUNTS, summarize as committeeSummary } from "./modules/committee.js";
import { summarize as socialSummary } from "./modules/social.js";
import { buildQuote, type PriceBook, type Quote } from "./quote.js";
import type { Receipt } from "./receipt.js";
import { round6, usd, writeFile } from "./util.js";
import { MODULES } from "./modules/index.js";

export const MORE_WHAT = ["accounts", "committee", "ads", "social", "seo"] as const;
export type MoreWhat = (typeof MORE_WHAT)[number];

/** Everything `more` needs to run again on a folder. Written next to the dossier by every run. */
export interface RunState {
  schemaVersion: "1";
  mode: "live" | "demo";
  placeholder?: string;
  /** The run was --public or --safe-demo: export --crm never writes contacts for it. */
  safe?: boolean;
  cfg: GtmConfig;
  /** Module ids in the order the run had them. */
  modules: string[];
  results: Record<string, { status: ModuleResult["status"]; summary: string; out: unknown }>;
  /** The page each paged source is on, so the next `more` asks for the one after. */
  pages?: Record<string, number>;
  /** One line per `more` pull, newest last. */
  pulls?: { what: MoreWhat; at: string; calls: number; charged: number; added: string }[];
}

export const STATE_FILE = "state.json";

export function readState(outDir: string): RunState | null {
  const f = join(outDir, STATE_FILE);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as RunState;
  } catch {
    return null;
  }
}

export function writeState(outDir: string, s: RunState): void {
  writeFile(join(outDir, STATE_FILE), JSON.stringify(s, null, 1) + "\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rowsOf = (s: RunState | null, id: string, key = "rows"): Any[] => {
  const o = s?.results[id]?.out as Any;
  return Array.isArray(o?.[key]) ? o[key] : [];
};

export interface MoreSpec {
  what: MoreWhat;
  label: string;
  /** Modules that run, in order. */
  mods: string[];
  /** Default --count, when the pull takes one. */
  count?: number;
  /** The config the pull runs with. Throws an Error with a plain message when there is nothing more to get. */
  patch(cfg: GtmConfig, s: RunState | null, count: number): GtmConfig;
}

const withMore = (cfg: GtmConfig, more: Record<string, unknown>, extra: Partial<GtmConfig> = {}): GtmConfig => ({ ...cfg, ...extra, more } as GtmConfig);

export const SPECS: Record<MoreWhat, MoreSpec> = {
  accounts: {
    what: "accounts",
    label: "More accounts, with their people and emails",
    mods: ["accounts", "people", "enrich"],
    count: 25,
    patch: (cfg, s, count) => {
      const have = rowsOf(s, "accounts");
      return withMore(cfg, { skipDomains: have.map((a) => a.domain), pageOffset: Math.ceil((Math.max(have.length, cfg.limits.accounts) * 2) / SEARCH_ROWS) }, { limits: { ...cfg.limits, accounts: count } });
    },
  },
  committee: {
    what: "committee",
    label: "Buying committees for the next accounts",
    mods: ["committee"],
    count: 10,
    patch: (cfg, s, count) => {
      const have = rowsOf(s, "committee", "accounts").map((a) => a.domain);
      const left = rowsOf(s, "accounts").filter((a) => (a.grade === "A" || a.grade === "B") && !have.includes(a.domain)).length;
      if (s && left === 0) throw new Error("Every A and B account already has a buying committee. Run looot-zeus more accounts first.");
      // Without --people a committee is names and roles for at most 5 accounts (committeeCount).
      if (!cfg.people && count > FREE_COMMITTEE_ACCOUNTS) process.stderr.write(`Without --people a pull gets names and roles for at most ${FREE_COMMITTEE_ACCOUNTS} accounts. Add --people for ${count}, with emails.\n`);
      return withMore(cfg, { skipDomains: have }, { limits: { ...cfg.limits, committeeAccounts: s ? Math.min(count, left) : count } });
    },
  },
  ads: {
    what: "ads",
    label: "The next page of ads for you and each rival",
    mods: ["ads"],
    patch: (cfg, s) => withMore(cfg, { page: (s?.pages?.ads ?? 1) + 1 }),
  },
  social: {
    what: "social",
    label: "The next page of LinkedIn and X posts",
    mods: ["social"],
    patch: (cfg, s) => withMore(cfg, { page: (s?.pages?.social ?? 1) + 1 }),
  },
  seo: {
    what: "seo",
    label: "Rankings for more of the keyword gaps",
    mods: ["seo"],
    count: 10,
    patch: (cfg, s, count) => {
      const checked = new Set([...cfg.keywords, ...rowsOf(s, "seo", "ranks").map((r) => String(r.keyword))].map((k) => k.toLowerCase()));
      const next = rowsOf(s, "seo", "gaps").map((g) => String(g.keyword)).filter((k) => k && !checked.has(k.toLowerCase())).slice(0, count);
      if (s && next.length === 0) throw new Error("Every keyword gap in this folder is already checked. Add keywords to config.yaml and run looot-zeus run --only seo.");
      return withMore(cfg, {}, { keywords: s ? next : cfg.keywords.slice(0, count), competitors: [], questions: [] });
    },
  },
};

export function moreCommand(what: MoreWhat, count?: number): string {
  const c = count ?? SPECS[what].count;
  return `npx looot-zeus more ${what}${c ? ` --count ${c}` : ""}`;
}

export function moreQuote(what: MoreWhat, cfg: GtmConfig, s: RunState | null, book: PriceBook, count?: number): { cfg: GtmConfig; q: Quote } {
  const spec = SPECS[what];
  const patched = spec.patch(cfg, s, count ?? spec.count ?? 0);
  const mods = spec.mods.map((id) => MODULES.find((m) => m.id === id)!).map((m) => ({ ...m, needs: [] }));
  return { cfg: patched, q: buildQuote(mods, patched, book) };
}

/** "about $0.38, at most $3.10", for the buttons in the dossier. */
export function priceLine(q: Quote): string {
  return `about ${usd(q.expected)}, at most ${usd(q.worst)}`;
}

// ---------- merging new rows into the folder ----------

const keyBy = <T>(xs: T[], k: (x: T) => string): T[] => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const key = k(x).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const strip = (a: string) => a.replace(/ \(\d+\)$/, "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** The merged output of one module: what the folder had plus what the pull found. */
export function mergeOut(id: string, oldOut: Any, add: Any): Any {
  if (!add) return oldOut;
  if (!oldOut || oldOut.skipped) return add;
  switch (id) {
    case "accounts": {
      const rows = keyBy([...(oldOut.rows ?? []), ...(add.rows ?? [])], (r: Any) => r.domain).sort((a: Any, b: Any) => b.score - a.score || String(a.domain).localeCompare(String(b.domain)));
      const g = (x: string) => rows.filter((r: Any) => r.grade === x).length;
      return { ...oldOut, rows, calls: [...(oldOut.calls ?? []), ...(add.calls ?? [])], summary: `${rows.length} accounts scored, ${g("A")} A, ${g("B")} B, ${g("C")} C, ${g("D")} D` };
    }
    case "people":
    case "enrich": {
      const rows = keyBy([...(oldOut.rows ?? []), ...(add.rows ?? [])], (r: Any) => `${r.domain}|${r.linkedin || r.name}`);
      const summary = id === "people" ? `${rows.length} people found` : `${rows.filter((r: Any) => r.status === "valid").length} emails verified of ${rows.length} people`;
      return { ...oldOut, rows, calls: [...(oldOut.calls ?? []), ...(add.calls ?? [])], summary };
    }
    case "committee": {
      const accounts = keyBy([...(oldOut.accounts ?? []), ...(add.accounts ?? [])], (a: Any) => a.domain);
      return { ...oldOut, accounts, calls: [...(oldOut.calls ?? []), ...(add.calls ?? [])], summary: committeeSummary(accounts) };
    }
    case "ads": {
      // Same advertiser when the domain matches, else the name.
      const key = (a: Any) => String(a.domain || a.name).toLowerCase();
      const byName = new Map<string, Any>((oldOut.advertisers ?? []).map((a: Any) => [key(a), { ...a, ads: [...(a.ads ?? [])] }]));
      for (const a of add.advertisers ?? []) {
        const cur = byName.get(key(a)) ?? [...byName.values()].find((x) => String(x.name).toLowerCase() === String(a.name).toLowerCase());
        if (!cur) {
          byName.set(key(a), a);
          continue;
        }
        cur.ads = keyBy([...cur.ads, ...(a.ads ?? [])], (x: Any) => x.url || `${x.headline}|${x.body}`);
        for (const p of ["meta", "linkedin", "google"]) cur[p] = n(cur[p]) + n(a[p]);
        cur.angles = [...new Set([...cur.angles.map(strip), ...(a.angles ?? []).map(strip)])];
        cur.offers = [...new Set([...cur.offers.map(strip), ...(a.offers ?? []).map(strip)])];
      }
      const advertisers = [...byName.values()];
      const total = advertisers.reduce((x, a) => x + n(a.meta) + n(a.linkedin) + n(a.google), 0);
      return { ...oldOut, advertisers, gaps: adGaps(advertisers), summary: `${total} live ads across ${advertisers.filter((a) => n(a.meta) + n(a.linkedin) + n(a.google) > 0).length} of ${advertisers.length} advertisers, ${advertisers.reduce((x, a) => x + (a.ads?.length ?? 0), 0)} pulled` };
    }
    case "social": {
      const byDomain = new Map<string, Any>((oldOut.brands ?? []).map((b: Any) => [b.domain, { ...b, posts: [...(b.posts ?? [])] }]));
      for (const b of add.brands ?? []) {
        const cur = byDomain.get(b.domain);
        if (!cur) byDomain.set(b.domain, b);
        else cur.posts = keyBy([...cur.posts, ...(b.posts ?? [])], (p: Any) => p.url || p.text);
      }
      const brands = [...byDomain.values()];
      return { ...oldOut, brands, summary: socialSummary(brands) };
    }
    case "seo": {
      const ranks = keyBy([...(oldOut.ranks ?? []), ...(add.ranks ?? [])], (r: Any) => r.keyword);
      const base = oldOut.baseSummary ?? oldOut.summary ?? "";
      const extra = (oldOut.extraChecked ?? 0) + (add.ranks ?? []).length;
      return { ...oldOut, ranks, baseSummary: base, extraChecked: extra, summary: `${base}${base ? ". " : ""}${extra} more keywords checked with looot-zeus more` };
    }
    default:
      return add;
  }
}

/** What the pull added, in one line for the console and the cost view. */
export function addedLine(what: MoreWhat, oldOut: Record<string, Any>, merged: Record<string, Any>): string {
  const d = (id: string, key: string) => (merged[id]?.[key]?.length ?? 0) - (oldOut[id]?.[key]?.length ?? 0);
  switch (what) {
    case "accounts":
      return `${d("accounts", "rows")} new accounts, ${d("people", "rows")} new people, ${Math.max(0, d("enrich", "rows"))} new email rows`;
    case "committee":
      { const k = d("committee", "accounts"); return `${k} new buying ${k === 1 ? "committee" : "committees"}`; }
    case "ads": {
      const c = (o: Any) => (o?.advertisers ?? []).reduce((x: number, a: Any) => x + (a.ads?.length ?? 0), 0);
      const k = c(merged.ads) - c(oldOut.ads);
      return `${k} new ${k === 1 ? "ad" : "ads"}`;
    }
    case "social": {
      const c = (o: Any) => (o?.brands ?? []).reduce((x: number, b: Any) => x + (b.posts?.length ?? 0), 0);
      const k = c(merged.social) - c(oldOut.social);
      return `${k} new ${k === 1 ? "post" : "posts"}`;
    }
    case "seo":
      return `${d("seo", "ranks")} more keywords checked`;
  }
}

/** The receipt of the folder plus the calls of one pull. */
export function mergeReceipt(r: Receipt, add: Receipt): Receipt {
  const modules = r.modules.map((m) => ({ ...m }));
  for (const m of add.modules) {
    const cur = modules.find((x) => x.id === m.id);
    if (!cur) modules.push({ ...m });
    else {
      cur.calls += m.calls;
      cur.quoted = round6(cur.quoted + m.quoted);
      cur.worst = round6(cur.worst + m.worst);
      cur.charged = round6(cur.charged + m.charged);
      cur.summary = m.summary;
      if (m.status === "done") cur.status = "done";
    }
  }
  const calls = [...r.calls, ...add.calls];
  return {
    ...r,
    run: {
      ...r.run,
      finishedAt: add.run.finishedAt,
      cap: round6(r.run.cap + add.run.cap),
      expected: round6(r.run.expected + add.run.expected),
      worst: round6(r.run.worst + add.run.worst),
      charged: round6(calls.reduce((x, c) => x + c.charged, 0)),
      calls: calls.length,
      durationMs: r.run.durationMs + add.run.durationMs,
      capStopped: r.run.capStopped || add.run.capStopped,
    },
    modules,
    calls,
  };
}

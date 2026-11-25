import type { GtmConfig } from "../config.js";
import type { GtmModule, ModuleResult } from "../modules/types.js";
import { MORE_WHAT, moreCommand, moreQuote, priceLine, type MoreWhat, type RunState } from "../more.js";
import { usd as money } from "../util.js";
import { billingBreakdown, type Receipt } from "../receipt.js";
import { round6, usd } from "../util.js";
import type { Bar, Block, Card, Section, StatItem } from "./blocks.js";

export interface Dossier {
  domain: string;
  brand: string;
  generatedAt: string;
  placeholder?: string;
  public: boolean;
  /** The module sections, in run order, receipt last. */
  sections: Section[];
  /** Headline numbers built from the run. Both writers put it first. */
  overview?: Section;
  /** The plays as cards, or an empty state. */
  plays?: Section;
  /** What to copy to run the same sweep every week. */
  weekly?: Weekly;
}

export interface Weekly {
  domain: string;
  cap: number;
  /** "about $2.04 a week, at most $10" */
  price: string;
  command: string;
  cron: string;
  yml: string;
  prompt: string;
}

export const COST_TITLE = "How much this cost";

export interface SectionCostRow {
  id: string;
  label: string;
  status: string;
  /** Quoted expected cost in USD under the section's cap, never above worst. */
  expected: number;
  /** Quoted worst case in USD under the section's cap. */
  worst: number;
  /** Sum of charged over this section's calls in the receipt. */
  spent: number;
  paidCalls: number;
  cap: string;
}

const capText = (c?: { usd?: number; runs?: number }) => !c ? "none" : [c.usd !== undefined ? usd(c.usd) : "", c.runs !== undefined ? plural(c.runs, "call") : ""].filter(Boolean).join(", ") || "none";

/** Quoted against spent per section, from the receipt's module rows and its call rows grouped by module. */
export function sectionCostRows(r: Receipt): { rows: SectionCostRow[]; total: Omit<SectionCostRow, "id" | "label" | "status" | "cap"> } {
  const rows = r.modules.map((m) => {
    const mine = r.calls.filter((c) => c.module === m.id);
    return { id: m.id, label: m.label, status: m.status, expected: Math.min(m.expectedCapped ?? m.quoted, m.worstCapped ?? m.worst), worst: m.worstCapped ?? m.worst, spent: round6(mine.reduce((n, c) => n + c.charged, 0)), paidCalls: mine.filter((c) => !c.replayed).length, cap: capText(m.cap) };
  });
  const sum = (k: "expected" | "worst" | "spent" | "paidCalls") => round6(rows.reduce((n, x) => n + x[k], 0));
  return { rows, total: { expected: sum("expected"), worst: sum("worst"), spent: sum("spent"), paidCalls: sum("paidCalls") } };
}

function sectionCostBlocks(r: Receipt): Block[] {
  const { rows, total } = sectionCostRows(r);
  const fmt = (x: { expected: number; worst: number; spent: number; paidCalls: number }) => ({ expected: usd(x.expected), worst: usd(x.worst), spent: usd(x.spent), paidCalls: x.paidCalls });
  const runCap = [usd(r.run.cap), r.run.totalRuns !== undefined ? plural(r.run.totalRuns, "paid call") : ""].filter(Boolean).join(", ");
  return [
    { kind: "table", caption: "Quoted and spent by section", columns: [{ key: "label", label: "Section" }, { key: "status", label: "Status" }, { key: "expected", label: "Quoted, expected", num: true }, { key: "worst", label: "Quoted, worst case under caps", num: true }, { key: "spent", label: "Spent", num: true }, { key: "paidCalls", label: "Paid calls", num: true }, { key: "cap", label: "Section cap" }],
      rows: [...rows.map((x) => ({ label: x.label, status: x.status, cap: x.cap, ...fmt(x) })), { label: "Total", status: "", cap: `run cap ${runCap}`, ...fmt(total) }] },
    { kind: "note", text: `The run cap was ${runCap}. Spent is the sum of what looot charged for each call in receipt.json. Model tokens of your agent are not included.` },
  ];
}

export function receiptSection(r: Receipt): Section {
  const b = billingBreakdown(r);
  const blocks: Block[] = [
    { kind: "stat", items: [
      { label: "Cap", value: usd(r.run.cap) },
      { label: "Quoted", value: usd(r.run.expected) },
      { label: "New spend", value: usd(r.run.charged) },
      { label: "Paid calls", value: String(r.run.calls - (r.run.replayedCalls ?? 0)) },
      ...(r.run.replayedCalls ? [{ label: "Replayed free", value: String(r.run.replayedCalls), hint: `${usd(r.run.replayedValue ?? 0)} when they first ran, not charged again` }] : []),
      { label: r.run.mode === "demo" ? "Example run time" : "Time", value: `${Math.floor(r.run.durationMs / 60000)}m${String(Math.round((r.run.durationMs % 60000) / 1000)).padStart(2, "0")}s` },
    ] },
    { kind: "table", caption: "By outcome", columns: [{ key: "o", label: "Outcome" }, { key: "calls", label: "Calls", num: true }, { key: "charged", label: "Charged", num: true }], rows: [
      { o: "hit", calls: b.hit.calls, charged: usd(b.hit.charged) },
      { o: "fallback, a later provider answered", calls: b.fallback.calls, charged: usd(b.fallback.charged) },
      { o: "miss", calls: b.miss.calls, charged: usd(b.miss.charged) },
      { o: "fail", calls: b.fail.calls, charged: usd(b.fail.charged) },
    ] },
  ];
  blocks.splice(1, 0, ...sectionCostBlocks(r));
  if (b.singleProvider.length > 0) {
    blocks.push({ kind: "table", caption: "One provider, no fallback", columns: [{ key: "job", label: "Job" }, { key: "calls", label: "Calls", num: true }, { key: "misses", label: "Miss or fail", num: true }, { key: "charged", label: "Charged", num: true }], rows: b.singleProvider.map((j) => ({ ...j, charged: usd(j.charged) })) });
    blocks.push({ kind: "note", text: "These jobs have one provider only. When it missed or failed, there was no second provider to try. Every such call is flagged in receipt.json." });
  }
  if (r.run.replayedCalls) blocks.push({ kind: "note", text: `${r.run.replayedCalls} calls asked exactly what an earlier run asked, so looot answered from that run at no new charge. They first cost ${usd(r.run.replayedValue ?? 0)}. New spend counts only the calls paid in this run.` });
  if (b.overQuote.calls > 0) blocks.push({ kind: "note", text: `${b.overQuote.calls} calls were charged above their quote, ${usd(b.overQuote.extra)} in total. Every one is in receipt.md.` });
  if (r.run.capStopped) blocks.push({ kind: "note", text: "The run stopped at the cap. Sections marked capped are partial." });
  else {
    const sec = r.modules.filter((m) => m.capScope === "section").map((m) => m.label);
    if (sec.length > 0) blocks.push({ kind: "note", text: `${sec.join(", ")} stopped at ${sec.length === 1 ? "its" : "their"} cap (the limit set for ${sec.length === 1 ? "that section" : "those sections"}). ${sec.length === 1 ? "That section is" : "Those sections are"} partial. The other sections went on.` });
    const short = r.modules.filter((m) => m.status === "capped" && m.capScope !== "section").map((m) => m.label);
    if (short.length > 0) blocks.push({ kind: "note", text: `${short.join(", ")} used up ${short.length === 1 ? "its share of the cap and stopped early. That section is" : "their share of the cap and stopped early. Those sections are"} partial. The rest of the run went on.` });
  }
  blocks.push({ kind: "note", text: `Every call with its provider, outcome and charge is in receipt.json and receipt.md. Prices quoted from ${r.run.priceSource}.` });
  return { num: "11", id: "receipt", title: COST_TITLE, status: "done", source: r.placeholder ? "PLACEHOLDER cost lines, invented from the quote. No looot call was made." : `looot ledger, ${r.run.finishedAt.slice(0, 10)}`, blocks };
}

/** A module's own section when its host module ended with no rows, else null. */
function standInSection(m: GtmModule, r: ModuleResult, results: Map<string, ModuleResult>, pub: boolean): Section | null {
  if (!m.standIn || !r.out) return null;
  const rows = (r.out as { rows?: unknown[] }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const host = results.get(m.standIn.host)?.out as { rows?: unknown[] } | null | undefined;
  if (Array.isArray(host?.rows) && host!.rows!.length > 0) return null;
  return m.standIn.render(r.out, r.status, { public: pub });
}

// ---------- overview and plays, built from the run itself ----------

type Rec = Record<string, unknown>;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const outOf = (results: Map<string, ModuleResult>, id: string): Rec | null => {
  const o = results.get(id)?.out;
  return o && typeof o === "object" ? (o as Rec) : null;
};
const statusOf = (results: Map<string, ModuleResult>, id: string): string | undefined => results.get(id)?.status;
const ratio = (a: number, b: number): number | undefined => (b > 0 ? Math.max(0, Math.min(1, a / b)) : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a card says when its module did not run or found nothing. */
function quiet(results: Map<string, ModuleResult>, id: string): string {
  const s = statusOf(results, id);
  if (!s) return "not in this run";
  if (s === "skipped") return "skipped in this run";
  if (s === "capped") return "stopped at the cap";
  return "nothing found";
}

export interface PlayLike {
  title: string;
  evidence?: string;
  list?: string;
  command?: string;
  cost?: string;
  basis?: "fact" | "inferred";
}

export function playsOf(results: Map<string, ModuleResult>): PlayLike[] {
  return arr(outOf(results, "synthesis")?.plays).filter((p) => typeof p.title === "string" && p.title) as unknown as PlayLike[];
}

export const PLAYS_EMPTY =
  "No plays this run. A play shows up only when the data backs it, for example hot accounts, ad angles your rivals run, keyword gaps, rival weak spots, hiring news or AI answers that skip you. Run it again with a higher cap or more rivals, or ask your own agent to read dossier.md and suggest next steps.";

function playCards(plays: PlayLike[]): Card[] {
  return plays.map((p, i) => ({
    title: p.title,
    tag: `#${i + 1}`,
    basis: p.basis ?? "inferred",
    rows: [
      ...(p.evidence ? [{ label: "Evidence", value: p.evidence }] : []),
      ...(p.list ? [{ label: "Applies to", value: p.list }] : []),
      ...(p.cost ? [{ label: "Expected cost", value: p.cost }] : []),
    ],
    command: p.command || undefined,
  }));
}

export function playsSection(results: Map<string, ModuleResult>, placeholder?: string): Section {
  const plays = playsOf(results);
  return {
    num: "",
    id: "plays",
    title: "Plays",
    status: "done",
    source: placeholder ? "PLACEHOLDER plays, invented to show the layout. A real run replaces them." : "Rules over this run's data. Each play names its evidence, the list it applies to, the next command and the cost.",
    blocks: [{ kind: "cards", items: playCards(plays), empty: PLAYS_EMPTY }],
  };
}

export function overviewSection(results: Map<string, ModuleResult>, receipt: Receipt, placeholder?: string): Section {
  const stats: StatItem[] = [];

  const accounts = arr(outOf(results, "accounts")?.rows);
  const gradeOf = (g: string) => accounts.filter((a) => String(a.grade ?? "").toUpperCase() === g).length;
  stats.push(accounts.length > 0
    ? { label: "Target accounts", value: String(accounts.length), hint: `${gradeOf("A")} grade A`, meter: ratio(gradeOf("A"), accounts.length), tone: "go", view: "buyers" }
    : { label: "Target accounts", value: "0", hint: quiet(results, "accounts"), tone: "plain", view: "buyers" });

  const enrich = arr(outOf(results, "enrich")?.rows);
  const people = arr(outOf(results, "people")?.rows);
  const verified = enrich.filter((r) => ["valid", "verified"].includes(String(r.status ?? "").toLowerCase())).length;
  stats.push(enrich.length > 0
    ? { label: "Verified emails", value: String(verified), hint: `of ${plural(enrich.length, "person", "people")} checked`, meter: ratio(verified, enrich.length), tone: "go", view: "buyers" }
    : { label: "Verified emails", value: "0", hint: people.length > 0 ? `${plural(people.length, "person", "people")} found, no email checked` : quiet(results, "enrich"), tone: "plain", view: "buyers" });

  const comm = arr(outOf(results, "committee")?.accounts);
  const members = comm.flatMap((a) => arr(a.members));
  const reach = new Set<string>();
  for (const p of enrich) if (p.email) reach.add(String(p.linkedin || p.name || p.email).toLowerCase());
  for (const m of members) if (m.email || m.phone) reach.add(String(m.linkedin || m.name || m.email).toLowerCase());
  const withPhone = members.filter((m) => m.phone).length;
  stats.unshift(reach.size > 0
    ? { label: "Leads to reach", value: String(reach.size), hint: `people with an email or phone, ${withPhone} with a phone`, meter: ratio(reach.size, Math.max(reach.size, people.length + members.length)), tone: "go", view: "buyers" }
    : { label: "Leads to reach", value: "0", hint: quiet(results, "enrich"), tone: "plain", view: "buyers" });
  const mEmail = members.filter((m) => m.email).length;
  stats.push(comm.length > 0
    ? { label: "Buying committees", value: String(comm.length), hint: `${members.length} people, ${mEmail} emails and ${withPhone} phones found`, meter: ratio(mEmail + withPhone, members.length * 2), tone: "go", view: "buyers" }
    : { label: "Buying committees", value: "0", hint: quiet(results, "committee"), tone: "plain", view: "buyers" });

  const sig = arr(outOf(results, "signals")?.accounts);
  const tier = (t: string) => sig.filter((a) => String(a.intent ?? "").toLowerCase() === t).length;
  stats.push(sig.length > 0
    ? { label: "Hot accounts", value: String(tier("hot")), hint: `${tier("warm")} warm, of ${sig.length} scored`, meter: ratio(tier("hot"), sig.length), tone: "warm", view: "signals" }
    : { label: "Hot accounts", value: "0", hint: quiet(results, "signals"), tone: "plain", view: "signals" });

  const ads = outOf(results, "ads");
  const gaps = (ads?.gaps ?? {}) as { yoursMissing?: unknown; nobody?: unknown };
  const missing = Array.isArray(gaps.yoursMissing) ? gaps.yoursMissing.length : 0;
  const nobody = Array.isArray(gaps.nobody) ? gaps.nobody.length : 0;
  const angles = new Set(arr(ads?.advertisers).flatMap((a) => (Array.isArray(a.angles) ? (a.angles as unknown[]).map(String) : [])));
  stats.push(ads && angles.size > 0
    ? { label: "Ad angles you miss", value: String(missing), hint: `${nobody} nobody runs yet, ${angles.size} seen`, meter: ratio(missing, angles.size), tone: "warm", view: "ads" }
    : { label: "Ad angles you miss", value: "0", hint: quiet(results, "ads"), tone: "plain", view: "ads" });

  const soc = arr(outOf(results, "social")?.brands);
  const rivalPosts = soc.filter((b) => !b.you).reduce((n, b) => n + arr(b.posts).length, 0);
  const yourPosts = soc.filter((b) => b.you).reduce((n, b) => n + arr(b.posts).length, 0);
  stats.push(soc.length > 0
    ? { label: "Rival posts read", value: String(rivalPosts), hint: `${yourPosts} of yours, on LinkedIn and X`, meter: ratio(rivalPosts, rivalPosts + yourPosts), tone: "warm", view: "social" }
    : { label: "Rival posts read", value: "0", hint: quiet(results, "social"), tone: "plain", view: "social" });

  const seo = outOf(results, "seo");
  const kw = arr(seo?.gaps).length;
  const share = (seo?.share ?? {}) as Record<string, number>;
  const you = typeof share.you === "number" ? share.you : undefined;
  stats.push(seo && (kw > 0 || you !== undefined)
    ? { label: "Keyword gaps", value: String(kw), hint: you !== undefined ? `AI answers name you ${Math.round(you * 100)}% of the time` : "rivals rank, you do not", meter: you, tone: "warm", view: "seo" }
    : { label: "Keyword gaps", value: "0", hint: quiet(results, "seo"), tone: "plain", view: "seo" });

  stats.push({ label: "Spend vs cap", value: usd(receipt.run.charged), hint: `of ${usd(receipt.run.cap)} cap, ${plural(receipt.run.calls - (receipt.run.replayedCalls ?? 0), "paid call")}${receipt.run.replayedCalls ? `, ${receipt.run.replayedCalls} replayed free` : ""}`, meter: ratio(receipt.run.charged, receipt.run.cap), tone: "go", view: "receipt" });

  const blocks: Block[] = [{ kind: "stat", items: stats }];

  if (accounts.length > 0) {
    blocks.push({ kind: "bars", caption: "Accounts by grade", items: ["A", "B", "C", "D"].map((g) => ({ label: `Grade ${g}`, value: gradeOf(g), tone: g === "A" ? "go" : g === "B" ? "warm" : g === "D" ? "cold" : "plain" })) });
  }
  if (sig.length > 0) {
    blocks.push({ kind: "bars", caption: "Buying intent", items: [
      { label: "Hot", value: tier("hot"), tone: "go" },
      { label: "Warm", value: tier("warm"), tone: "warm" },
      { label: "Cold", value: tier("cold"), tone: "cold" },
    ] });
  }
  const shareRows = Object.entries(share).filter(([, v]) => typeof v === "number");
  if (shareRows.length > 0) {
    blocks.push({ kind: "bars", caption: "AI answers that name the brand", max: 1, items: shareRows
      .map(([k, v]) => ({ label: k === "you" ? "You" : k, value: v, display: `${Math.round(v * 100)}%`, tone: (k === "you" ? "go" : "plain") as Bar["tone"] }))
      .sort((a, b) => b.value - a.value) });
  }
  const advs = arr(ads?.advertisers);
  if (advs.length > 0) {
    const n = (v: unknown) => (typeof v === "number" ? v : 0);
    blocks.push({ kind: "bars", caption: "Live ads, you and each rival", items: advs.map((a) => {
      const parts = [{ label: "Meta", value: n(a.meta), tone: "go" as const }, { label: "LinkedIn", value: n(a.linkedin), tone: "warm" as const }, { label: "Google", value: n(a.google), tone: "plain" as const }];
      const t = parts.reduce((x, p) => x + p.value, 0);
      return { label: a.you ? `${String(a.name)} (you)` : String(a.name), value: t, display: String(t), tone: a.you ? "go" : "plain", parts };
    }) });
  }
  if (members.length > 0) {
    blocks.push({ kind: "bars", caption: "Buying committee coverage", max: members.length, items: [
      { label: "LinkedIn found", value: members.filter((m) => m.linkedin).length, display: `${members.filter((m) => m.linkedin).length} of ${members.length}`, tone: "go" },
      { label: "Email found", value: mEmail, display: `${mEmail} of ${members.length}`, tone: "go" },
      { label: "Phone found", value: withPhone, display: `${withPhone} of ${members.length}`, tone: "warm" },
    ] });
  }
  const spent = receipt.modules.filter((m) => m.charged > 0).sort((a, b) => b.charged - a.charged);
  if (spent.length > 0) blocks.push({ kind: "bars", caption: "Charged by module", items: spent.map((m) => ({ label: m.label, value: m.charged, display: usd(m.charged) })) });

  const plays = playsOf(results);
  if (plays.length > 0) blocks.push({ kind: "cards", caption: `First ${Math.min(3, plays.length)} of ${plural(plays.length, "play")}`, items: playCards(plays.slice(0, 3)) });

  return {
    num: "",
    id: "overview",
    title: "Overview",
    status: "done",
    source: placeholder ? "PLACEHOLDER numbers, invented to show the layout. A real run replaces them." : `Counted from this run on ${receipt.run.finishedAt.slice(0, 10)}.`,
    blocks,
  };
}

/** A bar chart of the keyword gaps by monthly searches, on top of the SEO section. */
function withGapChart(s: Section, out: unknown): Section {
  const gaps = arr((out as Rec | null)?.gaps).filter((g) => typeof g.volume === "number" && (g.volume as number) > 0);
  if (gaps.length === 0) return s;
  const top = [...gaps].sort((a, b) => (b.volume as number) - (a.volume as number)).slice(0, 10);
  const chart: Block = { kind: "bars", caption: "Keyword gaps by monthly searches", items: top.map((g) => ({ label: String(g.keyword), value: g.volume as number, display: `${(g.volume as number).toLocaleString("en-US")}${g.rival ? `, ${String(g.rival)}` : ""}`, tone: "warm" })) };
  const at = s.blocks.findIndex((b) => b.kind === "text");
  const blocks = [...s.blocks];
  blocks.splice(at + 1, 0, chart);
  return { ...s, blocks };
}

/** The plays table moves to the plays view, so the summary does not repeat it. */
function withoutPlaysTable(s: Section): Section {
  const isPlays = (b: Block) => b.kind === "table" && b.columns.some((c) => c.key === "evidence") && b.columns.some((c) => c.key === "command");
  return s.blocks.some(isPlays) ? { ...s, blocks: s.blocks.filter((b) => !isPlays(b)) } : s;
}

/** Which section gets which "run more" button. */
const MORE_AT: Record<string, MoreWhat[]> = { accounts: ["accounts"], committee: ["committee"], competitors: ["social"], ads: ["ads"], social: ["social"], seo: ["seo"] };

/** The run more buttons, priced from the dated price table. A pull with nothing left gets no button. */
export function moreBlocks(cfg: GtmConfig, results: Map<string, ModuleResult>, pages?: Record<string, number>): Partial<Record<MoreWhat, Block>> {
  const state = { results: Object.fromEntries([...results].map(([id, r]) => [id, { status: r.status, summary: r.summary, out: r.out }])), pages } as unknown as RunState;
  const out: Partial<Record<MoreWhat, Block>> = {};
  for (const what of MORE_WHAT) {
    try {
      const { q } = moreQuote(what, cfg, state, { source: "the dated price table", live: {} });
      const label = { accounts: "More accounts to reach, with people and emails", committee: "Buying committees for more A and B accounts", ads: "Pull more ads", social: "Pull more rival posts", seo: "Check more keyword gaps" }[what];
      out[what] = { kind: "more", label, command: moreCommand(what), price: priceLine(q), text: "It shows the price and asks before it spends." };
    } catch {
      // Nothing more to pull for this one.
    }
  }
  return out;
}

/** The weekly sweep: the watch command, a GitHub Actions file and a prompt for your agent. */
export function weeklyOf(cfg: GtmConfig, expected: number, cap: number): Weekly {
  const capS = Number.isInteger(cap) ? String(cap) : cap.toFixed(2);
  const command = `npx looot-zeus watch --cap ${capS}`;
  const cron = `0 7 * * 1 cd /path/to/your/folder && LOOOT_TOKEN=... npx looot-zeus watch --cap ${capS} --yes --no-open`;
  const yml = [
    "# .github/workflows/gtm-watch.yml, every Monday at 07:00 UTC",
    "# Commit gtm/config.yaml first and add LOOOT_TOKEN as a repository secret. Keep the repo private.",
    "name: gtm-watch",
    "on:",
    "  schedule:",
    '    - cron: "0 7 * * 1"',
    "  workflow_dispatch:",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  watch:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    `      - name: Weekly sweep of ${cfg.domain} inside a ${capS} USD cap`,
    "        env:",
    "          LOOOT_TOKEN: ${{ secrets.LOOOT_TOKEN }}",
    `        run: npx looot-zeus watch --cap ${capS} --yes`,
    "      - run: |",
    '          git config user.name "gtm-watch"',
    '          git config user.email "gtm-watch@users.noreply.github.com"',
    "          git add gtm",
    '          git diff --cached --quiet || git commit -m "gtm: weekly run $(date -u +%F)"',
    "          git push",
  ].join("\n");
  const prompt = `Set up a weekly looot-zeus sweep for ${cfg.domain}. In the folder that holds gtm/config.yaml, schedule "npx looot-zeus watch --cap ${capS} --yes" every Monday at 07:00, with LOOOT_TOKEN read from my environment or a secret, never written into a file. Use a GitHub Actions workflow if this folder is a git repo, else a cron line. The cap is ${capS} USD a week and the run stops there. After each run, read gtm/changes.md and tell me in five lines what changed since last week.`;
  return { domain: cfg.domain, cap, price: `about ${money(expected)} a week, never more than the ${money(cap)} cap`, command, cron, yml, prompt };
}

export function assemble(o: { domain: string; brand: string; mods: GtmModule[]; results: Map<string, ModuleResult>; receipt: Receipt; public: boolean; placeholder?: string; now?: Date; cfg?: GtmConfig; pages?: Record<string, number>; pulls?: { what: string; at: string; calls: number; charged: number; added: string }[] }): Dossier {
  const sections: Section[] = [];
  const synth = o.mods.find((m) => m.id === "synthesis");
  const sr = o.results.get("synthesis");
  if (synth && sr?.out) {
    const s = synth.render(sr.out, sr.status, { public: o.public });
    if (s) sections.push(withoutPlaysTable(s));
  }
  for (const m of o.mods) {
    if (m.id === "synthesis") continue;
    const r = o.results.get(m.id);
    if (!r) continue;
    let s = m.render(r.out, r.status, { public: o.public }) ?? standInSection(m, r, o.results, o.public);
    if (s && m.id === "seo") s = withGapChart(s, o.results.get("seo")?.out);
    if (s && o.cfg && !o.public && MORE_AT[s.id]) {
      const more = moreBlocks(o.cfg, o.results, o.pages);
      const add = MORE_AT[s.id].map((w) => more[w]).filter((b): b is Block => !!b);
      if (add.length > 0) s = { ...s, blocks: [...add, ...s.blocks] };
    }
    if (s) sections.push(s);
  }
  const cost = receiptSection(o.receipt);
  if (o.pulls?.length) cost.blocks.splice(1, 0, { kind: "table", caption: "Pulled later with looot-zeus more", columns: [{ key: "what", label: "Pull" }, { key: "at", label: "Date" }, { key: "added", label: "Added" }, { key: "calls", label: "Calls", num: true }, { key: "charged", label: "Charged", num: true }], rows: o.pulls.map((p) => ({ ...p, at: p.at.slice(0, 10), charged: money(p.charged) })) });
  if (o.cfg?.linkedin === false) cost.blocks.push({ kind: "note", text: "LinkedIn steps off. The run made no LinkedIn call: no LinkedIn ads, no LinkedIn company posts and no LinkedIn page search. Turn them on by removing linkedin: false from gtm/config.yaml." });
  sections.push(cost);
  return {
    domain: o.domain,
    brand: o.brand,
    generatedAt: (o.now ?? new Date()).toISOString(),
    placeholder: o.placeholder,
    public: o.public,
    sections,
    overview: overviewSection(o.results, o.receipt, o.placeholder),
    plays: playsSection(o.results, o.placeholder),
    ...(o.cfg ? { weekly: weeklyOf(o.cfg, o.receipt.run.expected, o.receipt.run.cap) } : {}),
  };
}

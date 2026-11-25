// Next steps (hooks). After a run, Zeus SUGGESTS what the user's own agent could do next, each as a
// structured entry: title, why (from this run's data where there is any), a price estimate, the looot job
// it uses, the looot-zeus command, an optional schedule and a ready prompt for the agent. Nothing here
// runs anything. Schedules run in the user's own agent's scheduler; Zeus keeps no memory of its own and
// points to the agent's or a provider's memory instead (looot-zeus#11, call of 2026-11-25).

import type { GtmConfig } from "../config.js";
import { buildQuote } from "../quote.js";
import { searchJob } from "./accounts.js";
// A cycle (index imports synthesis imports this file), safe because MODULES is only read inside a call.
import { MODULES } from "./index.js";
import type { GtmModule } from "./types.js";

export type NextStepId =
  | "hiring-signals"
  | "lookalikes-50"
  | "competitor-pricing-watch"
  | "trigger-alerts"
  | "monthly-refresh"
  | "send-to-crm"
  | "weekly-prospecting"
  | "weekly-digest"
  | "memory"
  | "next-best-move";

export interface NextStep {
  id: NextStepId;
  title: string;
  /** Why this step, read from the run where the data has it. */
  why: string;
  /** Expected USD per run: the same quote the command prints (dated price table, default caps). 0 when it makes no paid call. */
  priceUsd: number;
  /** The most one run can spend under the caps the command applies. */
  maxUsd: number;
  /** The price in words: per run, a ceiling, or $0. */
  price: string;
  /** The main looot job it runs, or null when it calls none. */
  job: string | null;
  /** Every looot job the command's quote has a paid line for. */
  jobs: string[];
  /** The looot-zeus command, or null when the step is the agent's own work. */
  command: string | null;
  /** A suggested cadence for the user's own agent's scheduler, or null for once. */
  schedule: "weekly" | "monthly" | null;
  /** A prompt the user can hand to their agent as is. */
  prompt: string;
}

/** The modules a command runs: the named ones plus everything they need, like `--only` in the CLI. */
function withNeeds(ids: string[] | null): GtmModule[] {
  if (!ids) return MODULES;
  const want = new Set<string>();
  const add = (id: string) => {
    if (want.has(id)) return;
    const m = MODULES.find((x) => x.id === id);
    if (!m) return;
    want.add(id);
    m.needs.forEach(add);
  };
  ids.forEach(add);
  return MODULES.filter((m) => want.has(m.id));
}

interface Priced { priceUsd: number; maxUsd: number; jobs: string[] }

/** The quote the CLI prints for these modules (dated price table, default caps), no network. noNeeds: the modules alone, as `more` runs them. */
export function priceRun(cfg: GtmConfig, ids: string[] | null, opts: { noNeeds?: boolean; capUsd?: number } = {}): Priced {
  const mods = opts.noNeeds && ids ? MODULES.filter((m) => ids.includes(m.id)) : withNeeds(ids);
  const q = buildQuote(mods, cfg, { source: "dated", live: {} });
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const max = opts.capUsd !== undefined ? Math.min(q.worstCapped, opts.capUsd) : q.worstCapped;
  return { priceUsd: r(Math.min(q.expectedCapped, max)), maxUsd: r(max), jobs: [...new Set(q.rows.flatMap((x) => x.lines).map((l) => l.job))] };
}

const money = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `under $0.01` : `about $${n.toFixed(2)}`);
const priced = (p: Priced, per: string) => `${money(p.priceUsd)} ${per}, at most $${p.maxUsd.toFixed(2)}`;
const FREE: Priced = { priceUsd: 0, maxUsd: 0, jobs: [] };

const SCHEDULER = "Use your own scheduler (for example cron, Claude Code /schedule or your agent's routines). Zeus does not schedule anything.";
const ASK = "Show me the price first and run nothing paid without my yes.";

/**
 * Up to 10 next steps for the user's agent, built from the brief and this run's outputs. Pure: no network,
 * no paid call. The order is the order to offer them in.
 */
export function buildNextSteps(cfg: GtmConfig, outputs: Readonly<Record<string, unknown>> = {}): NextStep[] {
  const d = cfg.domain;
  const sigRows = ((outputs.signals as { accounts?: { account: string; events?: { type: string }[]; intent?: string }[] } | null)?.accounts ?? []);
  const hiring = sigRows.filter((a) => (a.events ?? []).some((e) => e.type === "hiring")).length;
  const hot = sigRows.filter((a) => a.intent === "hot").length;
  const accRows = ((outputs.accounts as { rows?: unknown[] } | null)?.rows ?? []).length;
  const rivals = cfg.competitors.length;

  const sig = priceRun(cfg, ["signals"]);
  const rivalsP = priceRun(cfg, ["competitors"]);
  const MORE_ACCOUNTS = ["accounts", "people", "enrich"];
  const look = priceRun({ ...cfg, limits: { ...cfg.limits, accounts: 50 } }, MORE_ACCOUNTS, { noNeeds: true });
  const weekly = priceRun({ ...cfg, limits: { ...cfg.limits, accounts: 25 } }, MORE_ACCOUNTS, { noNeeds: true });
  const full = priceRun(cfg, null);
  const watch = priceRun(cfg, null, { capUsd: 5 });

  return [
    {
      id: "hiring-signals",
      title: "Check who is hiring for the roles you sell to",
      why: hiring > 0 ? `${hiring} of your accounts post open roles now. Hiring is the strongest buying signal Zeus scores.` : "Open roles are the strongest buying signal Zeus scores. They change every week.",
      ...sig, price: priced(sig, "a run"), job: "jobs.search",
      command: "npx looot-zeus run --only signals", schedule: "weekly",
      prompt: `In my ${d} project folder, run \`npx looot-zeus run --only signals\` every Monday. ${ASK} Then tell me which accounts started hiring for a role we sell to. ${SCHEDULER}`,
    },
    {
      id: "lookalikes-50",
      title: "Find 50 more accounts like your best ones",
      why: accRows > 0 ? `This run kept ${accRows} accounts. 50 more like your best ones widen the list without changing the brief.` : "50 more accounts like your best ones, from the same brief.",
      ...look, price: priced(look, "once"), job: searchJob(cfg),
      command: "npx looot-zeus more accounts --count 50", schedule: null,
      prompt: `In my ${d} project folder, run \`npx looot-zeus more accounts --count 50\`. ${ASK}`,
    },
    {
      id: "competitor-pricing-watch",
      title: "Watch your rivals' pricing pages",
      why: rivals > 0 ? `${rivals} rivals in your brief. A price change is the moment to compare.` : "A rival's price change is the moment to compare.",
      ...rivalsP, price: priced(rivalsP, "a run"), job: "web.scrape.markdown",
      command: "npx looot-zeus run --only competitors", schedule: "weekly",
      prompt: `In my ${d} project folder, run \`npx looot-zeus run --only competitors\` every week. ${ASK} Tell me only when a rival's pricing page changed. ${SCHEDULER}`,
    },
    {
      id: "trigger-alerts",
      title: "Alert me when an account turns hot",
      why: hot > 0 ? `${hot} accounts are hot today. An alert catches the next one the week it happens.` : "No account is hot today. An alert catches the first one the week it happens.",
      ...watch, price: `${priced(watch, "a run")} (watch re-runs the whole dossier)`, job: null,
      command: "npx looot-zeus watch --cap 5", schedule: "weekly",
      prompt: `In my ${d} project folder, run \`npx looot-zeus watch --cap 5\` every week. ${ASK} Read gtm/changes.md and message me only when an account turned hot. ${SCHEDULER}`,
    },
    {
      id: "monthly-refresh",
      title: "Refresh the whole dossier each month",
      why: "Accounts, rivals, ads and rankings drift. A monthly run keeps the dossier current.",
      ...full, price: priced(full, "a run"), job: null,
      command: `npx looot-zeus run ${d}`, schedule: "monthly",
      prompt: `On the 1st of each month, in my ${d} project folder, run \`npx looot-zeus run ${d}\` and show me the quote. Run it only after my yes, with the cap it suggests. ${SCHEDULER}`,
    },
    {
      id: "send-to-crm",
      title: "Send the accounts to your CRM",
      why: "The exports are already written in gtm/exports (Instantly, HubSpot, Attio, CSV).",
      ...FREE, price: "$0 on looot", job: null, command: null, schedule: null,
      prompt: `Import gtm/exports from my ${d} project folder into my CRM with the CRM tool you are connected to. Show me what you will create before you write anything.`,
    },
    {
      id: "weekly-prospecting",
      title: "Add 25 new accounts every week",
      why: "A steady weekly list beats one big list that goes stale.",
      ...weekly, price: priced(weekly, "a run"), job: searchJob(cfg),
      command: "npx looot-zeus more accounts --count 25", schedule: "weekly",
      prompt: `Every Monday, in my ${d} project folder, run \`npx looot-zeus more accounts --count 25\`. ${ASK} ${SCHEDULER}`,
    },
    {
      id: "weekly-digest",
      title: "A weekly digest of what changed",
      why: "One message a week: new hot accounts, rival moves, ranking changes.",
      ...FREE, price: "$0, reads the files the scheduled runs wrote", job: null, command: null, schedule: "weekly",
      prompt: `Every Friday, read gtm/changes.md and gtm/plays.md in my ${d} project folder and send me five lines on what changed this week. ${SCHEDULER}`,
    },
    {
      id: "memory",
      title: "Remember what worked",
      why: "Zeus keeps no memory of its own. Your agent's memory (or a memory provider you use) can keep which angles and accounts worked.",
      ...FREE, price: "$0 on looot", job: null, command: null, schedule: null,
      prompt: `After each campaign, save in your own memory (or the memory provider I use) which angle, accounts and titles got replies for ${d}, with the date. Read it before you suggest the next run.`,
    },
    {
      id: "next-best-move",
      title: "Pick the next best move",
      why: "gtm/plays.md ranks what to do next from this run's data, each with its evidence and price.",
      ...FREE, price: "$0, reads the dossier", job: null, command: null, schedule: null,
      prompt: `Read gtm/plays.md in my ${d} project folder and tell me the one play to do this week, with its evidence and price.`,
    },
  ];
}

/** next-steps.json for the user's agent. */
export function nextStepsFile(steps: NextStep[]): string {
  return `${JSON.stringify({ note: "Suggestions only. Nothing runs without the user's yes. Schedules run in the user's own agent.", nextSteps: steps }, null, 2)}\n`;
}

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
import type { NextPlay } from "../plays/match.js";
import { HOOKS, hookCommand, hookPrompt, keptHooks, type HookId } from "../plays/hooks.js";

export type NextStepId = HookId;


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

/** Title, command and prompt of a hook, from plays/hooks.ts (the one source the city page reads too). */
const hook = (id: HookId, d: string) => ({ id, title: HOOKS[id].title, command: hookCommand(id, d), prompt: hookPrompt(id, d) });

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
      ...hook("hiring-signals", d),
      why: hiring > 0 ? `${hiring} of your accounts post open roles now. Hiring is the strongest buying signal Zeus scores.` : "Open roles are the strongest buying signal Zeus scores. They change every week.",
      ...sig, price: priced(sig, "a run"), job: "jobs.search",
      schedule: "weekly",
    },
    {
      ...hook("lookalikes-50", d),
      why: accRows > 0 ? `This run kept ${accRows} accounts. 50 more like your best ones widen the list without changing the brief.` : "50 more accounts like your best ones, from the same brief.",
      ...look, price: priced(look, "once"), job: searchJob(cfg),
      schedule: null,
    },
    {
      ...hook("competitor-pricing-watch", d),
      why: rivals > 0 ? `${rivals} rivals in your brief. A price change is the moment to compare.` : "A rival's price change is the moment to compare.",
      ...rivalsP, price: priced(rivalsP, "a run"), job: "web.scrape.markdown",
      schedule: "weekly",
    },
    {
      ...hook("trigger-alerts", d),
      why: hot > 0 ? `${hot} accounts are hot today. An alert catches the next one the week it happens.` : "No account is hot today. An alert catches the first one the week it happens.",
      ...watch, price: `${priced(watch, "a run")} (watch re-runs the whole dossier)`, job: null,
      schedule: "weekly",
    },
    {
      ...hook("monthly-refresh", d),
      why: "Accounts, rivals, ads and rankings drift. A monthly run keeps the dossier current.",
      ...full, price: priced(full, "a run"), job: null,
      schedule: "monthly",
    },
    {
      ...hook("send-to-crm", d),
      why: "The exports are already written in gtm/exports (Instantly, HubSpot, Attio, CSV).",
      ...FREE, price: "$0 on looot", job: null, schedule: null,
    },
    {
      ...hook("weekly-prospecting", d),
      why: "A steady weekly list beats one big list that goes stale.",
      ...weekly, price: priced(weekly, "a run"), job: searchJob(cfg),
      schedule: "weekly",
    },
    {
      ...hook("weekly-digest", d),
      why: "One message a week: new hot accounts, rival moves, ranking changes.",
      ...FREE, price: "$0, reads the files the scheduled runs wrote", job: null, schedule: "weekly",
    },
    {
      ...hook("memory", d),
      why: "Zeus keeps no memory of its own. Your agent's memory (or a memory provider you use) can keep which angles and accounts worked.",
      ...FREE, price: "$0 on looot", job: null, schedule: null,
    },
    {
      ...hook("next-best-move", d),
      why: "gtm/plays.md ranks what to do next from this run's data, each with its evidence and price.",
      ...FREE, price: "$0, reads the dossier", job: null, schedule: null,
    },
  ];
}

/** next-steps.json for the user's agent. */
export function nextStepsFile(steps: (NextStep | AgentStep)[]): string {
  return `${JSON.stringify({ note: "Suggestions only. Nothing runs without the user's yes. Schedules run in the user's own agent.", nextSteps: steps }, null, 2)}\n`;
}

/** One entry of next-steps.json: a top Atlas play (kind "play", the same 5 the city page shows under
 * "Your next plays") or a hook Zeus can run next (kind "hook"). The /gtm skill offers the first three. */
export type AgentStep =
  | (NextStep & { kind: "hook" })
  | (Omit<NextStep, "id" | "schedule"> & { kind: "play"; id: string; goal: string; schedule: null });

/** The steps for the user's agent, in the city page's order: the top plays first, then the hooks no top play already covers. */
export function agentSteps(steps: NextStep[], plays: NextPlay[]): AgentStep[] {
  const kept = new Set(keptHooks(plays.map((p) => p.goal)));
  return [
    ...plays.map((p) => ({ kind: "play" as const, id: `play-${p.id}`, goal: p.goal, title: p.title, why: p.why, priceUsd: p.lowUsd, maxUsd: p.capUsd, price: `${p.priceText}, capped at $${p.capUsd.toFixed(2)}`, job: p.jobs[0] ?? null, jobs: p.jobs, command: p.runCommand ?? null, schedule: null, prompt: p.prompt })),
    ...steps.filter((s) => kept.has(s.id)).map((s) => ({ kind: "hook" as const, ...s })),
  ];
}

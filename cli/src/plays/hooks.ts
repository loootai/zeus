// The hooks that sit next to the Atlas plays in "Your next plays": what the user's own agent can do with
// Zeus after the run (get more, keep it running, your own tools). One source for their titles, commands
// and prompts, used by next-steps.json (modules/nextSteps.ts) and by the city page (city/index.ts).
// No imports with side effects: the hosted looot-pages bundle renders these too.

/** The 10 hooks Zeus can suggest (looot-zeus#11, the 2026-11-25 call). */
export type HookId =
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

/** Hook order: the order to offer them in. */
export const HOOK_IDS: HookId[] = ["hiring-signals", "lookalikes-50", "competitor-pricing-watch", "trigger-alerts", "monthly-refresh", "send-to-crm", "weekly-prospecting", "weekly-digest", "memory", "next-best-move"];

export const SCHEDULER = "Use your own scheduler (for example cron, Claude Code /schedule or your agent's routines). Zeus does not schedule anything.";
export const ASK = "Show me the price first and run nothing paid without my yes.";

/** One hook: its title, the chip on its card, the Atlas goal whose icon it borrows, the command and the
 * Atlas goals that already cover it (a top play in one of them makes this hook a duplicate). */
export interface Hook { title: string; tag: "Get more" | "Keep it running" | "Your tools"; icon: string; command: string | null; coveredBy: string[]; always?: "drop" }

export const HOOKS: Record<HookId, Hook> = {
  "hiring-signals": { title: "Check who is hiring for the roles you sell to", tag: "Keep it running", icon: "Buying signals", command: "npx looot-zeus run --only signals", coveredBy: ["Buying signals"] },
  "lookalikes-50": { title: "Find 50 more accounts like your best ones", tag: "Get more", icon: "Market sizing and ICP", command: "npx looot-zeus more accounts --count 50", coveredBy: [] },
  "competitor-pricing-watch": { title: "Watch your rivals' pricing pages", tag: "Keep it running", icon: "Competitor displacement", command: "npx looot-zeus run --only competitors", coveredBy: ["Competitor displacement"] },
  "trigger-alerts": { title: "Alert me when an account turns hot", tag: "Keep it running", icon: "Buying signals", command: "npx looot-zeus watch --cap 5", coveredBy: [] },
  "monthly-refresh": { title: "Refresh the whole dossier each month", tag: "Keep it running", icon: "GTM operations", command: null, coveredBy: [] },
  "send-to-crm": { title: "Send the accounts to your CRM", tag: "Your tools", icon: "CRM and data quality", command: null, coveredBy: [] },
  "weekly-prospecting": { title: "Add 25 new accounts every week", tag: "Get more", icon: "Outbound research", command: "npx looot-zeus more accounts --count 25", coveredBy: [] },
  "weekly-digest": { title: "A weekly digest of what changed", tag: "Your tools", icon: "GTM operations", command: null, coveredBy: [] },
  "memory": { title: "Remember what worked", tag: "Your tools", icon: "Positioning and research", command: null, coveredBy: [] },
  // "Your next plays" is this step, so it is never shown next to the plays.
  "next-best-move": { title: "Pick the next best move", tag: "Your tools", icon: "GTM operations", command: null, coveredBy: [], always: "drop" },
};

/** The command a hook runs for this domain (monthly-refresh runs the whole dossier again). */
export function hookCommand(id: HookId, domain: string): string | null {
  return id === "monthly-refresh" ? `npx looot-zeus run ${domain}` : HOOKS[id].command;
}

/** What Tell your agent copies for a hook. */
export function hookPrompt(id: HookId, d: string): string {
  switch (id) {
    case "hiring-signals": return `In my ${d} project folder, run \`npx looot-zeus run --only signals\` every Monday. ${ASK} Then tell me which accounts started hiring for a role we sell to. ${SCHEDULER}`;
    case "lookalikes-50": return `In my ${d} project folder, run \`npx looot-zeus more accounts --count 50\`. ${ASK}`;
    case "competitor-pricing-watch": return `In my ${d} project folder, run \`npx looot-zeus run --only competitors\` every week. ${ASK} Tell me only when a rival's pricing page changed. ${SCHEDULER}`;
    case "trigger-alerts": return `In my ${d} project folder, run \`npx looot-zeus watch --cap 5\` every week. ${ASK} Read gtm/changes.md and message me only when an account turned hot. ${SCHEDULER}`;
    case "monthly-refresh": return `On the 1st of each month, in my ${d} project folder, run \`npx looot-zeus run ${d}\` and show me the quote. Run it only after my yes, with the cap it suggests. ${SCHEDULER}`;
    case "send-to-crm": return `Import gtm/exports from my ${d} project folder into my CRM with the CRM tool you are connected to. Show me what you will create before you write anything.`;
    case "weekly-prospecting": return `Every Monday, in my ${d} project folder, run \`npx looot-zeus more accounts --count 25\`. ${ASK} ${SCHEDULER}`;
    case "weekly-digest": return `Every Friday, read gtm/changes.md and gtm/plays.md in my ${d} project folder and send me five lines on what changed this week. ${SCHEDULER}`;
    case "memory": return `After each campaign, save in your own memory (or the memory provider I use) which angle, accounts and titles got replies for ${d}, with the date. Read it before you suggest the next run.`;
    case "next-best-move": return `Read gtm/plays.md in my ${d} project folder and tell me the one play to do this week, with its evidence and price.`;
  }
}

/** The hooks to show next to the top plays: not always dropped and not covered by a top play's Atlas goal. */
export function keptHooks(topGoals: Iterable<string>): HookId[] {
  const goals = new Set(topGoals);
  return HOOK_IDS.filter((id) => HOOKS[id].always !== "drop" && !HOOKS[id].coveredBy.some((g) => goals.has(g)));
}

/** The hook a title names, for rows that carry only the title (the summary table of a saved run). */
export function hookByTitle(title: string): HookId | undefined {
  return HOOK_IDS.find((id) => HOOKS[id].title === title);
}

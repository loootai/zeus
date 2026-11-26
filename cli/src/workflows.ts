// "Run any workflow". The 1,000 GTM workflows in 20 categories and the one
// prompt each workflow hands to the user's agent. workflows.json is built by build/make_workflows.py and
// copied next to this file by the build. The Zeus page embeds the same catalog and builds the same prompt
// in its own script (test/workflows.test.ts checks the two agree), so a page with no server can still copy it.
import { readFileSync } from "node:fs";

/** outcome: the headline the page shows for the category (build/make_workflows.py OUTCOMES); name stays the key. */
export interface WorkflowCategory { name: string; slug: string; lead: string; count: number; featured: number; outcome: string }
/** p: the looot providers the workflow uses, most relevant first, as positions in CATALOG.providers. */
export interface Workflow { id: number; cat: number; task: string; check: string; output: string; featured: boolean; p: number[] }
/** A looot data provider: logo is its file under src/city/shell/ (build/workflow_providers.py). */
export interface WorkflowProvider { id: string; name: string; logo: string }
export interface WorkflowCatalog { source: string; providers: WorkflowProvider[]; categories: WorkflowCategory[]; workflows: Workflow[] }

export const CATALOG: WorkflowCatalog = JSON.parse(readFileSync(new URL("./workflows.json", import.meta.url), "utf8"));

const BY_ID = new Map(CATALOG.workflows.map((w) => [w.id, w]));

/** The workflow with this id, or undefined. Only whole numbers in the catalog count. */
export function findWorkflow(id: unknown): Workflow | undefined {
  const n = typeof id === "string" && /^\d{1,5}$/.test(id.trim()) ? Number(id.trim()) : id;
  return typeof n === "number" && Number.isInteger(n) ? BY_ID.get(n) : undefined;
}

/** Who the workflow runs for. A domain from the run, the brand name when there is one. */
export interface WorkflowContext { domain?: string; company?: string }

function forWhom(ctx: WorkflowContext): string {
  const d = (ctx.domain ?? "").trim();
  const c = (ctx.company ?? "").trim();
  if (d && c && c.toLowerCase() !== d.toLowerCase()) return `${c} (${d})`;
  return d || c || "my company";
}

/**
 * The prompt for one workflow: the task, the check and what to hand back, for the company on the page.
 * It always asks the agent to price first and wait for a yes, and to send or change nothing without one.
 * Keep in step with zwfPrompt in build/runany.py (the page builds the same text).
 */
export function workflowPrompt(w: Workflow, ctx: WorkflowContext = {}): string {
  const cat = CATALOG.categories[w.cat]?.name ?? "GTM";
  return [
    `Run this GTM workflow with looot for ${forWhom(ctx)}. It is workflow ${w.id} in ${cat}.`,
    `Task. ${w.task}`,
    `Check first. ${w.check}`,
    `Then. ${w.output}`,
    "Use looot for every data call. Before anything runs, show me the looot jobs you plan to use with the price and the most it can cost, then wait for my yes. Send nothing, post nothing and change nothing in my CRM or outreach tools without my yes.",
  ].join("\n");
}

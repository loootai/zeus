// "Run any workflow" on every city page: the same view as the demo page (build/runany.py writes it into
// shell/workflows.*). The page carries only the view, its styles and script. The 1,000 workflow catalog with
// the provider logos (shell/workflows-data.js, about 340 KB) loads only when the view opens: from
// zeus/workflows.js beside the page (writeWorkflowFiles), or from a same-origin URL on the hosted site.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = (f: string) => new URL(`./shell/${f}`, import.meta.url);
const read = (f: string) => readFileSync(shell(f), "utf8");

export const WORKFLOWS_FILE = "workflows.js";
export const RUN_ANY_CSS = read("workflows.css").trim();
export const RUN_ANY_JS = read("workflows.view.js").trim();
const VIEW = read("workflows.html").trim();
// Counts from the view build/runany.py wrote (no catalog import: looot-pages bundles this file without it).
const N = VIEW.match(/placeholder="Search ([\d,]+) workflows"/)?.[1] ?? "1,000";
const NC = VIEW.match(/<b>(\d+)<\/b>categories/)?.[1] ?? "20";

const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The voxel lightning bolt that pulses beside the menu item (build/runany.py NAV_ICON; styles in workflows.css).
const ICON = read("workflows-nav.svg").trim();

/** The menu item, right under the city link. */
export const RUN_ANY_NAV = `<div class="ngroup solo"><div class="nav"><a href="#workflows">${ICON}<span class="mt">Run any workflow</span><span class="n">${N}</span></a></div></div>`;

/** The link "Your next plays" ends on. */
export const RUN_ANY_LINK = `<div class="sec ztop zwf-all"><div class="ztop-m"><h3>Want more than these 5?</h3><p>Browse all ${N} GTM workflows in ${NC} goals. Each one shows the looot data it uses. Your agent shows the price before anything runs.</p></div><a class="ztop-b" href="#workflows">See all ${N} workflows</a></div>`;

/** The view. src: where the page loads the catalog from (default zeus/workflows.js beside the page). */
export function runAnyView(domain: string, company: string, src = `zeus/${WORKFLOWS_FILE}`): string {
  return VIEW.replaceAll("{{domain}}", e(domain)).replaceAll("{{company}}", e(company)).replaceAll("{{src}}", e(src));
}

/** Copies the catalog into `<dir>/zeus/workflows.js`, next to a city page in `<dir>`. Returns the file written. */
export function writeWorkflowFiles(dir: string): string {
  const out = join(dir, "zeus");
  mkdirSync(out, { recursive: true });
  copyFileSync(fileURLToPath(shell("workflows-data.js")), join(out, WORKFLOWS_FILE));
  return join(out, WORKFLOWS_FILE);
}

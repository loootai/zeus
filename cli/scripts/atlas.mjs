// Keeps src/plays/atlas.vendored.json equal to Walid's Workflow Atlas on looot.ai, the one source of truth.
//   node scripts/atlas.mjs check [--from <file or URL>]   diffs the vendored copy against the live one, exit 1 on a difference
//   node scripts/atlas.mjs sync  [--from <file or URL>]   rewrites the vendored copy from the live one
// --from defaults to https://looot.ai/workflow-atlas/workflows-atlas.json. Needs `npm run build` first (it uses the
// same projection the CLI uses, dist/src/plays/atlasSource.js). Exit 2 when the live file cannot be read or used.
import { readFileSync, writeFileSync } from "node:fs";
import { ATLAS_SOURCE_URL, toVendored } from "../dist/src/plays/atlasSource.js";

const [mode, ...rest] = process.argv.slice(2);
if (mode !== "check" && mode !== "sync") {
  console.error("usage: node scripts/atlas.mjs check|sync [--from <file or URL>]");
  process.exit(2);
}
const at = rest.indexOf("--from");
const from = at >= 0 && rest[at + 1] ? rest[at + 1] : ATLAS_SOURCE_URL;
const vendoredFile = new URL("../src/plays/atlas.vendored.json", import.meta.url);

async function readLive() {
  if (!/^https?:\/\//.test(from)) return JSON.parse(readFileSync(from, "utf8"));
  const res = await fetch(from, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${from} answered HTTP ${res.status}`);
  return res.json();
}

let live;
try {
  live = toVendored(await readLive());
} catch (err) {
  console.error(`Could not read the live Atlas: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

// One line per play, so the vendored file diffs by play in git; still under the repo's 400 KB file limit.
const text = (v) => JSON.stringify(v).replace(/\],\[(\d+),(\d+),"/g, '],\n[$1,$2,"') + "\n";

if (mode === "sync") {
  writeFileSync(vendoredFile, text(live));
  console.log(`Wrote src/plays/atlas.vendored.json: ${live.plays.length} plays in ${live.goals.length} goals, generated ${live.generatedAt}.`);
  process.exit(0);
}

const vendored = JSON.parse(readFileSync(vendoredFile, "utf8"));
const out = [];
if (vendored.schemaVersion !== live.schemaVersion) out.push(`schemaVersion: vendored ${vendored.schemaVersion}, live ${live.schemaVersion}`);
for (const g of live.goals) if (!vendored.goals.includes(g)) out.push(`goal added: ${g}`);
for (const g of vendored.goals) if (!live.goals.includes(g)) out.push(`goal removed: ${g}`);
const expand = (v) => new Map(v.plays.map(([id, g, slug, title, rule, next, steps]) => [id, { goal: v.goals[g], slug, title, rule, next, steps: steps.map((k) => `${v.providers[k].provider}: ${v.providers[k].purpose}`).join(" > ") }]));
const a = expand(vendored);
const b = expand(live);
for (const [id, p] of b) {
  const o = a.get(id);
  if (!o) { out.push(`play ${id} added: ${p.title}`); continue; }
  for (const k of ["goal", "slug", "title", "rule", "next", "steps"]) if (o[k] !== p[k]) out.push(`play ${id} ${k}: "${o[k]}" -> "${p[k]}"`);
}
for (const [id, p] of a) if (!b.has(id)) out.push(`play ${id} removed: ${p.title}`);
const order = (m) => [...m.keys()].join(",");
if (out.length === 0 && order(a) !== order(b)) out.push("play order changed");

if (out.length === 0) {
  console.log(`atlas check ok: the vendored copy equals ${from} (${live.plays.length} plays, generated ${live.generatedAt}).`);
  process.exit(0);
}
console.log(`atlas check: ${out.length} difference${out.length === 1 ? "" : "s"} between the vendored copy and ${from}:`);
for (const line of out.slice(0, 50)) console.log(`  ${line}`);
if (out.length > 50) console.log(`  ... and ${out.length - 50} more`);
console.log("Run `npm run atlas:sync` and commit src/plays/atlas.vendored.json.");
process.exit(1);

// Extracts Walid's Workflow Atlas (https://looot-gtm-atlas.walidboulanouar.chatgpt.site/) into
// src/plays/atlas.json: goal, title, decision rule, what to do with the result, the provider route and
// its steps. The route rules are copied from the Atlas page's own app.js (workflow()), so the steps
// match what the Atlas shows. Usage: node scripts/extractAtlas.mjs <cases.js> <app.js> > src/plays/atlas.json
// Reads the two files as text and evaluates nothing from them but the useCases array literal (JSON).
import { readFileSync } from "node:fs";

const [casesFile, appFile] = process.argv.slice(2);
if (!casesFile || !appFile) throw new Error("usage: extractAtlas.mjs <cases.js> <app.js>");
const casesText = readFileSync(casesFile, "utf8");
const rows = JSON.parse(casesText.slice(casesText.indexOf("["), casesText.lastIndexOf("]") + 1));
const app = readFileSync(appFile, "utf8");

// Provider nodes: const name = ['Provider', 'logo', 'Purpose'];
const nodes = {};
for (const m of app.matchAll(/const (\w+) = \['([^']+)', '[^']+', '([^']+)'\];/g)) nodes[m[1]] = { provider: m[2], purpose: m[3] };
// Routes: 'Goal':[a,b,c],
const routes = {};
for (const m of app.matchAll(/'([^']+)':\[([\w,]+)\]/g)) routes[m[1]] = m[2].split(",").map((k) => nodes[k]);
if (Object.keys(routes).length !== 20) throw new Error(`expected 20 goals, found ${Object.keys(routes).length}`);

function route([, goal, title, rule, , action]) {
  const context = [title, rule].join(" ").toLowerCase();
  let r = routes[goal];
  if (goal === "SEO and AI search" && /ai answer|llm|citations?|model/.test(context)) r = [nodes.aiSearch, ...r];
  else if (/\b(hir(e|es|ing)|vacanc(y|ies)|job (post|description|opening)|open role)/.test(context)) r = [nodes.jobs, ...r];
  const needsContact = /reveal|verify their work email/.test(title) || (goal === "Outbound research" && [0, 1, 4].includes(action)) || (goal === "CRM and data quality" && action === 1);
  if (needsContact) r = [...r, nodes.person, nodes.email, nodes.verify];
  return [...new Map(r.map((n) => [n.provider, n])).values()];
}

// Zeus's copy rule (no comma before "and", no em dash) applies to every generated page, so the Atlas
// wording is kept with only that one change.
const copy = (t) => t.replace(/, and /g, " and ").replace(/\s*\u2014\s*/g, ", ");
const plays = rows.map((row) => ({ id: row[0], goal: row[1], title: copy(row[2]), rule: copy(row[3]), delivery: copy(row[4]), steps: route(row).map((n) => ({ provider: n.provider, purpose: copy(n.purpose) })) }));
// Compact form (the repo keeps tracked files under 400 KB): each step is an index into one providers list,
// each play a row [id, goal index, title, decision rule, what to do with the result, step indexes].
const providers = [];
const at = (n) => { let k = providers.findIndex((x) => x.provider === n.provider && x.purpose === n.purpose); if (k < 0) { k = providers.length; providers.push(n); } return k; };
const goals = Object.keys(routes);
const rowsOut = plays.map((p) => [p.id, goals.indexOf(p.goal), p.title, p.rule, p.delivery, p.steps.map(at)]);
process.stdout.write(JSON.stringify({
  source: "Workflow Atlas by Walid, https://looot-gtm-atlas.walidboulanouar.chatgpt.site/",
  extracted: new Date().toISOString().slice(0, 10),
  format: "plays: [id, goal index, title, rule, delivery, provider indexes]",
  goals,
  providers,
  plays: rowsOut,
}).replace(/\],\[(\d+),/g, "],\n[$1,") + "\n");

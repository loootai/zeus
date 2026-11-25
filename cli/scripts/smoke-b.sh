#!/usr/bin/env bash
# Live smoke test for module B (signals, competitors, ads, market). PAID: it spends real looot credit.
# One tiny input per module, a separate cap of 0.50 USD per module. Prints the quote and asks
# before any call unless --yes is passed. Needs LOOOT_TOKEN and a built dist (npm run build).
#
#   SMOKE_DOMAIN=yourdomain.com SMOKE_COMPETITOR=rival-a.com bash scripts/smoke-b.sh   # quote, then asks
#   bash scripts/smoke-b.sh --yes           # no question
#   bash scripts/smoke-b.sh --only ads      # one module
#
# Writes gtm-smoke-b/<module>.json (module output) and gtm-smoke-b/calls.json (every call with its
# provider, outcome and charge). Read calls.json before trusting any parser: misses and failures
# can be charged, the charged column is what looot settled.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${SMOKE_DOMAIN:-}" ] || [ -z "${SMOKE_COMPETITOR:-}" ]; then echo "Set SMOKE_DOMAIN (your domain) and SMOKE_COMPETITOR (one competitor domain). Nothing was run." >&2; exit 2; fi
if [ -z "${LOOOT_TOKEN:-}" ]; then echo "LOOOT_TOKEN is not set. Nothing was run." >&2; exit 2; fi
if [ ! -f "$ROOT/dist/src/modules/signals.js" ]; then echo "Build first: npm run build" >&2; exit 2; fi
OUT="${SMOKE_OUT:-gtm-smoke-b}"
mkdir -p "$OUT"
ROOT="$ROOT" OUT="$OUT" node --input-type=module - "$@" <<'NODE'
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
const R = `${process.env.ROOT}/dist/src`;
const { clientFromEnv } = await import(`${R}/client.js`);
const { normalizeConfig } = await import(`${R}/config.js`);
const { CapLedger } = await import(`${R}/cap.js`);
const { runPipeline } = await import(`${R}/modules/index.js`);
const { buildQuote } = await import(`${R}/quote.js`);
const { usd } = await import(`${R}/util.js`);
const { signals } = await import(`${R}/modules/signals.js`);
const { competitors } = await import(`${R}/modules/competitors.js`);
const { ads } = await import(`${R}/modules/ads.js`);
const { market } = await import(`${R}/modules/market.js`);

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1]?.split(",") : null;
const CAP = 0.5;

// The tiniest useful input: one competitor, one account for signals.
const DOMAIN = process.env.SMOKE_DOMAIN;
const BRAND = DOMAIN.split(".")[0];
const cfg = normalizeConfig({ domain: DOMAIN, brand: BRAND, icp: { titles: ["Head of Sales"] }, competitors: [process.env.SMOKE_COMPETITOR], limits: { accounts: 1, peoplePerAccount: 1, signalAccounts: 1 } });
const intake = { id: "intake", label: "Intake", needs: [], quote: () => ({ lines: [] }), run: async () => ({ status: "done", summary: "preset", out: {} }), render: () => null };
const accounts = { id: "accounts", label: "Accounts", needs: [], quote: () => ({ lines: [] }), run: async () => ({ status: "done", summary: "preset", out: { rows: [{ domain: DOMAIN, name: BRAND, grade: "A", score: 90 }] } }), render: () => null };
const mods = [signals, competitors, ads, market].filter((m) => !only || only.includes(m.id));

const plans = mods.map((m) => ({ m, q: buildQuote([intake, accounts, m], cfg, { source: "the dated price table checked 2026-10-30", live: {} }) }));
console.log(`Module B smoke, cap ${usd(CAP)} per module. PAID calls.\n`);
for (const { m, q } of plans) {
  const row = q.rows.find((r) => r.module === m.id);
  console.log(`${m.id.padEnd(12)} ${String(row.calls).padStart(3)} calls  expected ${usd(row.expected)}  worst ${usd(row.worst)}${row.skip ? `  skip: ${row.skip}` : ""}`);
}
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question("\nRun these paid calls? Type yes: ");
  rl.close();
  if (a.trim() !== "yes") { console.log("Nothing was run."); process.exit(0); }
}
const client = clientFromEnv();
const allCalls = [];
for (const { m, q } of plans) {
  const ledger = new CapLedger(CAP, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods: [intake, accounts, m], cfg, quote: q, runner: client, ledger, mode: "live", outDir: process.env.OUT, onCall: (c) => console.log(`  ${c.module} ${c.job} ${c.outcome} ${c.provider} ${usd(c.charged)}${c.note ? ` ${c.note}` : ""}`) });
  const r = res.results.get(m.id);
  allCalls.push(...res.calls);
  writeFileSync(join(process.env.OUT, `${m.id}.json`), JSON.stringify({ status: r.status, summary: r.summary, out: r.out }, null, 2));
  const charged = res.calls.reduce((n, c) => n + c.charged, 0);
  console.log(`${r.status === "done" ? "done" : r.status} ${m.id} · ${res.calls.length} calls · charged ${usd(charged)} · ${r.summary}`);
}
writeFileSync(join(process.env.OUT, "calls.json"), JSON.stringify(allCalls, null, 2));
const total = allCalls.reduce((n, c) => n + c.charged, 0);
const by = (o) => allCalls.filter((c) => c.outcome === o);
console.log(`\n${allCalls.length} calls · charged ${usd(total)} · hit ${by("hit").length} · fallback ${by("fallback").length} · miss ${by("miss").length} (charged ${usd(by("miss").reduce((n, c) => n + c.charged, 0))}) · fail ${by("fail").length} (charged ${usd(by("fail").reduce((n, c) => n + c.charged, 0))})`);
NODE

// Integration step: the real modules are registered, intake fills the auto fields, competitor ids
// for reviews and commerce, the slow-job poll wait, the cap-share stop line, the people stand-in
// section, funding price, synthesis highlights, singleProvider on every call, the example config
// and the placeholder receipt.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import { LoootClient, toRecord, withSingleProvider, type CallResult, type JobRunner, type LoootRun } from "../src/client.js";
import { asinEntries, ConfigError, configToYaml, loadConfig, normalizeConfig, reviewEntries } from "../src/config.js";
import { placeholderReceipt } from "../src/demo.js";
import { assemble, receiptSection } from "../src/dossier/index.js";
import { commerceQuote } from "../src/modules/commerce.js";
import { loadFixture } from "../src/modules/fixture.js";
import { MODULES, runPipeline, stopLine } from "../src/modules/index.js";
import { deriveConfig, type IntakePage } from "../src/modules/intake.js";
import { JOBS } from "../src/modules/jobs.js";
import { people } from "../src/modules/people.js";
import { reviewsQuote, targetsOf } from "../src/modules/reviews.js";
import { highlights, synthesis } from "../src/modules/synthesis.js";
import type { GtmModule, ModuleResult } from "../src/modules/types.js";
import { buildQuote, loadPriceBook } from "../src/quote.js";
import { receiptMarkdown, validateReceipt, type Receipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const EXAMPLE = join(PKG_ROOT, "examples", "yourdomain.yaml");

// ---- 1. registry --------------------------------------------------------------------------

test("every module is the real one, no stub is left and stubs.ts is gone", () => {
  // 17 since round 2 (3 Nov 2026): committee and social joined.
  assert.equal(MODULES.length, 19);
  for (const m of MODULES) assert.ok(!m.stub, `${m.id} is still a stub`);
  assert.deepEqual(MODULES.map((m) => m.id), ["intake", "icp", "accounts", "people", "enrich", "committee", "signals", "competitors", "ads", "social", "seo", "reviews", "mentions", "market", "local", "commerce", "readiness", "domains", "synthesis"]);
  assert.ok(!existsSync(join(PKG_ROOT, "src", "modules", "stubs.ts")));
  assert.ok(!existsSync(join(PKG_ROOT, "dist", "src", "modules", "stubs.js")) || statSync(join(PKG_ROOT, "dist", "src", "modules", "stubs.js")).mtimeMs < statSync(join(PKG_ROOT, "dist", "src", "modules", "index.js")).mtimeMs);
});

// ---- 2. intake auto fields ------------------------------------------------------------------

const page = (kind: IntakePage["kind"], markdown: string): IntakePage => ({ kind, url: `https://shop.example/${kind}`, ok: true, chars: markdown.length, markdown });

test("intake fills App Store ids, the local flag, the store flag and ASINs from the pages", () => {
  const home = [
    "Title: Shop Example | Coffee gear",
    "# Coffee gear for home baristas",
    "Great grinders and kettles for people who care about every cup, shipped fast.",
    "Get the app [here](https://apps.apple.com/us/app/shop-example/id1234567890).",
    "Add to cart. Free shipping over $50. Visit our store in Utrecht, opening hours 9 to 6.",
    "Also on [Amazon](https://www.amazon.com/dp/B0ABC12345) and [here](https://amazon.de/gp/product/B0XYZ98765).",
    "[Rival alternative](https://shop.example/vs/rival-a), see rival-a.com",
  ].join("\n");
  const { config, guessed } = deriveConfig("shop.example", [page("home", home), page("pricing", ""), page("customers", ""), page("alternatives", "")]);
  assert.deepEqual(config.reviews.appStoreIds, ["1234567890"]);
  assert.equal(config.local.mode, "on");
  assert.equal(config.local.queries.length, 1);
  assert.match(config.local.queries[0], /@/);
  assert.ok(guessed.includes("local.queries"));
  assert.equal(config.commerce.mode, "on");
  assert.deepEqual(config.commerce.asins, ["B0ABC12345", "B0XYZ98765"]);
  // Every competitor gets an empty slot for its own ids, so the user sees where they go.
  for (const c of config.competitors) {
    assert.deepEqual(config.reviews.competitors[c], { appStoreIds: [], mapsPlaces: [] });
    assert.deepEqual(config.commerce.competitors[c], []);
  }
  const yaml = configToYaml(config);
  assert.match(yaml, /competitors:\n\s+rival-a\.com:/);
});

test("intake leaves reviews, local and commerce quiet on a plain B2B site", () => {
  const home = "Title: Acme | Sales software\n# Sales software for small teams\nTrack every deal from first call to signed contract in one place.";
  const { config } = deriveConfig("acme.example", [page("home", home)]);
  assert.deepEqual(config.reviews.appStoreIds, []);
  assert.equal(config.local.mode, "auto");
  assert.deepEqual(config.local.queries, []);
  assert.equal(config.commerce.mode, "off");
  assert.deepEqual(config.commerce.asins, []);
  assert.deepEqual(config.commerce.competitors, {});
});

// ---- 3. competitor config fields -------------------------------------------------------------

test("competitor ids for reviews and commerce are read, merged and priced", () => {
  const cfg = normalizeConfig({
    domain: "yourdomain.com",
    competitors: ["rival-a.com"],
    reviews: { appStoreIds: ["111111"], mapsPlaces: [], competitors: { "https://www.Rival-A.com/": { appStoreIds: ["222222"], mapsPlaces: ["ChIJabc"] } } },
    commerce: { mode: "on", asins: ["B0ABC12345"], competitors: { "rival-a.com": ["B0XYZ98765"] } },
  });
  assert.deepEqual(reviewEntries(cfg), { appStore: ["111111", "rival-a.com:222222"], maps: ["rival-a.com:ChIJabc"] });
  assert.deepEqual(asinEntries(cfg), ["B0ABC12345", "rival-a.com:B0XYZ98765"]);
  const targets = targetsOf(cfg);
  assert.equal(targets.filter((t) => t.you).length, 1);
  assert.deepEqual(targets.filter((t) => !t.you).map((t) => `${t.owner} ${t.source} ${t.id}`), ["rival-a.com App Store 222222", "rival-a.com Google Maps ChIJabc"]);
  const rq = reviewsQuote(cfg);
  assert.equal(rq.skip, undefined);
  assert.equal(rq.lines.find((l) => l.job === "reviews.appstore.reviews")!.calls, 2 * 3);
  assert.equal(rq.lines.find((l) => l.job === "maps.place.reviews")!.calls, 1);
  assert.equal(commerceQuote(cfg).lines[0].calls, 2);
});

test("competitor ids alone are enough to run reviews, and bad keys are refused", () => {
  const only = normalizeConfig({ domain: "yourdomain.com", reviews: { competitors: { "rival-b.com": { appStoreIds: ["333333"] } } } });
  assert.equal(reviewsQuote(only).skip, undefined);
  assert.throws(() => normalizeConfig({ domain: "yourdomain.com", reviews: { competitors: { notadomain: { appStoreIds: [] } } } }), ConfigError);
  assert.throws(() => normalizeConfig({ domain: "yourdomain.com", commerce: { competitors: ["rival-a.com"] } }), ConfigError);
  const none = normalizeConfig({ domain: "yourdomain.com" });
  assert.deepEqual(none.reviews.competitors, {});
  assert.deepEqual(none.commerce.competitors, {});
});

// ---- 4. slow job poll wait ------------------------------------------------------------------

test("chatgpt.search.answer polls for about 240 s, other jobs keep 120 s", async () => {
  assert.equal(JOBS["chatgpt.search.answer"].pollTimeoutMs, 240_000);
  let clock = 0;
  const statusAt = (t: number) => (t >= 200_000 ? "completed" : "running");
  const fakeFetch = (async (url: string) => {
    const body: LoootRun = { runId: "r1", status: statusAt(clock), outcome: statusAt(clock) === "completed" ? "hit" : undefined, actualCost: 0.0015, route: { servedBy: "Bright Data", outcome: "hit", attempts: [{ provider: "Bright Data", outcome: "hit" }] } } as LoootRun;
    return new Response(JSON.stringify(body), { status: url.includes("/v1/runs?") ? 201 : 200 });
  }) as typeof fetch;
  const c = new LoootClient({ token: "t", fetch: fakeFetch, now: () => clock, sleep: async (ms) => { clock += ms; }, pollIntervalMs: 10_000 });
  assert.equal(c.pollTimeoutFor("chatgpt.search.answer"), 240_000);
  assert.equal(c.pollTimeoutFor("news.search"), 120_000);
  const slow = await c.call("chatgpt.search.answer", { query: "q" }, { module: "seo", step: "q", maxCostUsd: 0.01, quotedUsd: 0.0015 });
  assert.equal(slow.record.outcome, "hit");
  clock = 0;
  const fast = await c.call("news.search", { query: "q" }, { module: "x", step: "q", maxCostUsd: 0.01, quotedUsd: 0.001 });
  assert.equal(fast.record.outcome, "fail");
  assert.match(fast.record.note ?? "", /still running/);
});

// ---- 5. cap-share stop line -------------------------------------------------------------------

test("a module that used up its share of the cap is named in the last line", async () => {
  const cfg = normalizeConfig({ domain: "acme.example" });
  const mk = (id: string, needs: string[]): GtmModule => ({
    id, label: id, needs,
    quote: () => ({ lines: [{ job: "news.search", calls: 5 }] }),
    async run(ctx) {
      const got: number[] = [];
      for (let i = 0; i < 5; i++) {
        await ctx.call("news.search", { q: `${id}-${i}` }, `q${i}`);
        got.push(i);
        ctx.partial({ got });
      }
      return { status: "done", summary: "all", out: { got } };
    },
    render: () => null,
  });
  const mods = [mk("one", []), mk("two", ["one"])];
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      return { record: { module: opts.module, job, provider: "p", outcome: "hit", quoted: 0.001, charged: 0.01, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed" }, data: input };
    },
  };
  // "one" gets 0.03 of a 1.00 cap, three calls at a 0.01 ceiling. "two" has plenty.
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger: new CapLedger(1, [{ id: "one", worst: 0.03 }, { id: "two", worst: 0.97 }]), mode: "live", outDir: "" });
  assert.equal(res.capStopped, false);
  assert.deepEqual(res.moduleCapped, ["one"]);
  assert.equal(res.results.get("one")!.status, "capped");
  assert.match(res.results.get("one")!.summary, /used its share of the cap/);
  assert.equal(res.results.get("two")!.status, "done");
  assert.equal(stopLine(res), "done, but one used up its share of the cap and stopped early, so its section is partial");
  assert.equal(stopLine({ capStopped: false, moduleCapped: ["ads", "seo", "signals"] }), "done, but ads, seo and signals used up their share of the cap and stopped early, so their sections are partial");
  assert.equal(stopLine({ capStopped: true, moduleCapped: ["ads"] }), "stopped at the cap, partial dossier");
  assert.equal(stopLine({ capStopped: false, moduleCapped: [] }), "done");
  // Every call row now carries singleProvider.
  for (const c of res.calls) assert.equal(c.singleProvider, false);
});

// ---- 6. people stand-in section ----------------------------------------------------------------

const fakeReceipt = (): Receipt => ({ schemaVersion: "1", run: { domain: "yourdomain.com", mode: "live", startedAt: "2026-10-30T09:00:00.000Z", finishedAt: "2026-10-30T09:01:00.000Z", cap: 1, expected: 0, worst: 0, charged: 0, calls: 0, durationMs: 60000, capStopped: false, priceSource: "test" }, modules: [], calls: [] });

function sectionsWith(enrichOut: unknown, enrichStatus: ModuleResult["status"], pub = false) {
  const peopleOut = loadFixture("people");
  delete peopleOut.placeholder;
  const enrich = MODULES.find((m) => m.id === "enrich")!;
  const results = new Map<string, ModuleResult>([
    ["people", { status: "done", summary: peopleOut.summary, out: peopleOut }],
    ["enrich", { status: enrichStatus, summary: "x", out: enrichOut }],
  ]);
  return assemble({ domain: "yourdomain.com", brand: "YourBrand", mods: [people, enrich], results, receipt: fakeReceipt(), public: pub }).sections;
}

test("people render their own section when enrich returns nothing", () => {
  const capped = sectionsWith(null, "capped");
  const ps = capped.find((s) => s.id === "people");
  assert.ok(ps, "people section is missing");
  assert.equal(ps!.num, "03");
  const table = ps!.blocks.find((b) => b.kind === "table") as { rows: unknown[] } | undefined;
  assert.ok(table && table.rows.length > 0);
  assert.ok(ps!.blocks.some((b) => b.kind === "note" && /without emails/.test((b as { text: string }).text)));
  // Empty rows from enrich count as nothing too.
  assert.ok(sectionsWith({ summary: "0 emails", rows: [] }, "done").some((s) => s.id === "people"));
});

test("people stay inside the enrich section when enrich has rows", () => {
  const enrichOut = loadFixture("enrich");
  const s = sectionsWith(enrichOut, "done");
  assert.ok(!s.some((x) => x.id === "people"));
  assert.ok(s.some((x) => x.id === "enrich"));
});

// ---- 7. funding price -------------------------------------------------------------------------

test("company.funding is priced at the provider that answers, $0.05", () => {
  assert.equal(JOBS["company.funding"].typicalUsd, 0.05);
  const cfg = normalizeConfig({ domain: "yourdomain.com", competitors: ["rival-a.com"] });
  const market = MODULES.find((m) => m.id === "market")!;
  const q = buildQuote([market], cfg, { source: "test", live: {} });
  const line = q.rows[0].lines.find((l) => l.job === "company.funding")!;
  assert.ok(Math.abs(line.expected - line.calls * 0.05) < 1e-9);
});

// ---- 8. synthesis reads the scores, the ad gaps and the weak spots ---------------------------------

test("synthesis lines name hot accounts, ad gaps and weak spots first", async () => {
  const outputs = {
    signals: { summary: "s", accounts: [{ account: "Northwind", score: 86, intent: "hot" }, { account: "Lumen", score: 30, intent: "warm" }, { account: "Fern", score: 91, intent: "hot" }] },
    ads: { summary: "a", gaps: { yoursMissing: ["Social proof"], nobody: ["Urgency"] } },
    competitors: { summary: "c", cards: [{ name: "Rival A", weakSpots: ["pricing jumps 3x from Starter to Pro"] }, { name: "Rival B", weakSpots: [] }] },
    reviews: { summary: "r", weakSpots: [{ competitor: "Rival A", theme: "mobile sync", count: 12 }] },
  };
  const lines = highlights(outputs);
  assert.equal(lines[0], "Hot accounts: Fern (91), Northwind (86). Reach these first. From signals.");
  assert.ok(lines.includes("Ad angles your rivals run and you do not: Social proof. From ads."));
  assert.ok(lines.includes("Ad angles nobody runs yet: Urgency. From ads."));
  assert.ok(lines.includes("Rival A weak spot: pricing jumps 3x from Starter to Pro. From competitors."));
  assert.ok(lines.includes("Rival A reviewers complain about mobile sync (12 reviews). From reviews."));
  assert.ok(!lines.some((l) => l.startsWith("Rival B")));
  assert.match(highlights({ signals: { accounts: [{ account: "Lumen", score: 30, intent: "warm" }] } })[0], /No hot account this week/);
  assert.deepEqual(highlights({}), []);

  const cfg = normalizeConfig({ domain: "yourdomain.com" });
  const r = await synthesis.run({ cfg, mode: "live", outputs, outDir: "", partial() {}, log() {}, call: async () => { throw new Error("no calls"); } });
  const out = r.out as { lines: string[] };
  assert.equal(out.lines[0], lines[0]);
  assert.ok(out.lines.some((l) => l.startsWith("signals: ")));
});

// ---- 9. singleProvider on each call -------------------------------------------------------------

test("toRecord and withSingleProvider set singleProvider from the job table", () => {
  const opts = { module: "seo", step: "s", maxCostUsd: 0.01, quotedUsd: 0.0015 };
  const one = toRecord({ runId: "r", status: "completed", outcome: "miss", actualCost: 0.0015 }, "chatgpt.search.answer", opts, 5, "2026-10-30T09:00:00.000Z");
  assert.equal(one.singleProvider, true);
  assert.deepEqual(Object.keys(one).slice(0, 4), ["module", "job", "provider", "singleProvider"]);
  const many = toRecord({ runId: "r", status: "completed", outcome: "hit" }, "news.search", opts, 5, "2026-10-30T09:00:00.000Z");
  assert.equal(many.singleProvider, false);
  const fixed = withSingleProvider({ module: "x", job: "company.traffic", provider: "Datagma", outcome: "hit", quoted: 0.06, charged: 0.06, ms: 1, ts: "2026-10-30T09:00:00.000Z" });
  assert.equal(fixed.singleProvider, true);
});

test("the schema, receipt.md and the dossier carry singleProvider", () => {
  const schema = JSON.parse(readFileSync(join(PKG_ROOT, "schema", "receipt.schema.json"), "utf8"));
  assert.equal(schema.properties.calls.items.properties.singleProvider.type, "boolean");
  const r = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8")) as Receipt;
  for (const c of r.calls) assert.equal(typeof c.singleProvider, "boolean", `${c.job} has no singleProvider`);
  for (const c of r.calls) assert.equal(c.singleProvider, JOBS[c.job].singleProvider, c.job);
  assert.deepEqual(validateReceipt({ ...r, calls: r.calls.map((c) => ({ ...c, singleProvider: "yes" })) }).slice(0, 1), ["receipt.calls[0].singleProvider should be boolean"]);
  const md = receiptMarkdown(r);
  assert.match(md, /## One provider, no fallback/);
  assert.match(md, /\| [a-z.]+ \| \d+ \|/); // the demo stops a section at its cap, so which single-provider job appears depends on the caps
  const sec = receiptSection(r);
  assert.ok(sec.blocks.some((b) => b.kind === "table" && (b as { caption?: string }).caption === "One provider, no fallback"));
});

test("a module stopped by its share shows up in receipt.md and the receipt section", () => {
  const r = fakeReceipt();
  r.modules = [{ id: "ads", label: "Ads", status: "capped", calls: 0, quoted: 0, worst: 0, charged: 0, summary: "ads used its share of the cap", startedAtMs: 0, endedAtMs: 1 }];
  assert.match(receiptMarkdown(r), /Used up their share of the cap \| Ads, those sections are partial/);
  assert.ok(receiptSection(r).blocks.some((b) => b.kind === "note" && /Ads used up its share of the cap and stopped early/.test((b as { text: string }).text)));
});

// ---- 10. yourdomain.com everywhere ------------------------------------------------------------------

test("the example is examples/yourdomain.yaml with generic rivals and competitor id slots", () => {
  // gtm-watch.yml is the scheduled-watch workflow example, shipped on purpose. Any other file is a leftover.
  assert.deepEqual(readdirSync(join(PKG_ROOT, "examples")).sort(), ["gtm-watch.yml", "yourdomain.yaml"]);
  const cfg = loadConfig(EXAMPLE);
  assert.equal(cfg.domain, "yourdomain.com");
  assert.deepEqual(cfg.competitors, ["rival-a.com", "rival-b.com", "rival-c.com"]);
  assert.deepEqual(Object.keys(cfg.reviews.competitors), cfg.competitors);
  assert.deepEqual(Object.keys(cfg.commerce.competitors), cfg.competitors);
});

test("no file in the repo names the old example company", () => {
  const skip = new Set(["node_modules", ".git", "dist", ".looot-zeus", "runs"]);
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (skip.has(e.name) ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const old = ["pipe", "drive"].join("");
  for (const f of walk(PKG_ROOT)) {
    if (f.endsWith(join("test", "integration.test.ts"))) continue;
    assert.ok(!f.toLowerCase().includes(old), f);
    assert.ok(!readFileSync(f, "utf8").toLowerCase().includes(old), `${f} names it`);
  }
});

// ---- 11. placeholder receipt ----------------------------------------------------------------------

test("fixtures/placeholder-receipt.json is fresh: all modules, yourdomain.com, schema valid", async () => {
  const file = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8")) as Receipt;
  assert.deepEqual(validateReceipt(file), []);
  assert.equal(file.run.domain, "yourdomain.com");
  assert.ok(file.placeholder);
  const ids = file.modules.map((m) => m.id);
  for (const m of MODULES) assert.ok(ids.includes(m.id), m.id);
  // 5 Nov 2026: the phone waterfall and the company line added about 60 calls.
  // 25 Nov 2026: the demo now stops each section at its cap (#13), like a real run, so far fewer calls.
  assert.ok(file.run.calls >= 100 && file.run.calls <= 500, `calls ${file.run.calls}`);
  // Rebuild it the way `looot-zeus fixtures` does. It must match byte for byte.
  const cfg = normalizeConfig(loadFixture("config").config);
  const q = buildQuote(MODULES, cfg, await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  const noCalls: JobRunner = { call: async () => { throw new Error("demo makes no calls"); } };
  const res = await runPipeline({ mods: MODULES, cfg, quote: q, runner: noCalls, ledger: new CapLedger(10, q.rows.map((r) => ({ id: r.module, worst: r.worst }))), mode: "demo", outDir: "", preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "config draft from 4 pages (placeholder)" } } });
  const again = placeholderReceipt({ cfg, quote: q, mods: MODULES, results: res.results, cap: 10 });
  assert.deepEqual(JSON.parse(JSON.stringify(again)), file);
});

test("demo and quote work offline on the new receipt and the example", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-int-"));
  const out = execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } }).toString();
  assert.match(out, /yourdomain\.com/);
  assert.match(out, /done \(placeholder\)/);
  const r = JSON.parse(readFileSync(join(dir, "gtm", "receipt.json"), "utf8")) as Receipt;
  assert.equal(r.run.domain, "yourdomain.com");
  const html = readFileSync(join(dir, "gtm", "dossier.html"), "utf8");
  assert.match(html, /One provider, no fallback/);
  const quote = spawnSync(process.execPath, [cli, "quote", "--config", EXAMPLE, "--offline", "--cap", "10"], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  assert.equal(quote.status, 0);
  assert.match(quote.stdout.toString(), /^total\s+\d+\s+\$\d/m);
  const refused = spawnSync(process.execPath, [cli, "run", "--config", EXAMPLE, "--offline", "--cap", "0.5"], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  assert.equal(refused.status, 3);
});

// ---- 13. README -----------------------------------------------------------------------------------

test("README has the sections and follows the claims and copy rules", () => {
  const md = readFileSync(join(PKG_ROOT, "README.md"), "utf8");
  for (const h of ["## Quickstart", "## Modules", "## Outputs", "## The cap", "## What each call cost"]) assert.ok(md.includes(h), h);
  for (const w of ["Instantly", "HubSpot", "Attio", "looot-zeus init", "looot-zeus quote", "looot-zeus run", "one command. one key. one cap.", "Real run for higgsfield.ai"]) assert.ok(md.includes(w), w);
  assert.ok(!md.includes("—"), "em dash");
  assert.ok(!md.includes(", and"), "comma before and");
  for (const bad of [/paid once/i, /cost \$0/i, /billed \$0/i, /SOC ?2/, /\bDPA\b/, /\bG2\b/, /Capterra/, /\bdelve\b|\bunlock|\bseamless|\bgame-chang|\bharness|\blandscape\b|\bunleash/i, /\btreg\b/i, /looot (monitors|watches)/i, /[0-9],[0-9]{3}\+? (jobs|providers|endpoints)/]) assert.ok(!bad.test(md), String(bad));
});

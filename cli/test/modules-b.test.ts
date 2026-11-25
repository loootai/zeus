// Module B (signals, competitors, ads, market) against a mocked looot client. No network, no key.
// Each module is checked for hit, miss, fail, fallback, a cap stop and a skip.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import type { CallResult, JobRunner, Outcome } from "../src/client.js";
import { normalizeConfig, type GtmConfig } from "../src/config.js";
import { placeholderReceipt } from "../src/demo.js";
import { assemble } from "../src/dossier/index.js";
import { renderHtml } from "../src/dossier/html.js";
import { renderMarkdown } from "../src/dossier/md.js";
import { ads, findAdArray, parseAds } from "../src/modules/ads.js";
import { competitors, extractPlans, weakSpots } from "../src/modules/competitors.js";
import { MODULES, runPipeline } from "../src/modules/index.js";
import { market, parseTraffic } from "../src/modules/market.js";
import { pickAccounts, scoreEvents, signals, tallyNote } from "../src/modules/signals.js";
import type { GtmModule, ModuleResult } from "../src/modules/types.js";
import { buildQuote } from "../src/quote.js";

const MINE: Record<string, GtmModule> = { signals, competitors, ads, market };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

interface Reply {
  outcome: Outcome;
  data?: unknown;
  provider?: string;
  charged?: number;
  fallbackFrom?: string;
  note?: string;
}

type Script = (job: string, input: Record<string, unknown>, step: string) => Reply;

function mockRunner(script: Script) {
  const seen: { job: string; input: Record<string, unknown>; step: string }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      seen.push({ job, input, step: opts.step });
      const r = script(job, input, opts.step);
      const answered = r.outcome === "hit" || r.outcome === "fallback";
      return {
        record: { module: opts.module, job, provider: r.provider ?? "MockProvider", outcome: r.outcome, ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}), quoted: opts.quotedUsd, charged: r.charged ?? (answered ? opts.quotedUsd : 0), ms: 1, ts: new Date().toISOString(), ...(r.note ? { note: r.note } : {}) },
        run: { runId: "run-1", status: r.outcome === "fail" ? "failed" : "completed" },
        data: answered ? r.data : null,
      };
    },
  };
  return { runner, seen };
}

const fakeIntake: GtmModule = { id: "intake", label: "Intake", needs: [], quote: () => ({ lines: [] }), run: async () => ({ status: "done", summary: "", out: {} }), render: () => null };
const fakeAccounts = (rows: unknown[]): GtmModule => ({ id: "accounts", label: "Accounts", needs: [], quote: () => ({ lines: [] }), run: async () => ({ status: "done", summary: "", out: { rows } }), render: () => null });

async function runOne(mod: GtmModule, cfg: GtmConfig, runner: JobRunner, o: { cap?: number; accounts?: unknown[] } = {}) {
  const mods = [fakeIntake, fakeAccounts(o.accounts ?? []), mod];
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const ledger = new CapLedger(o.cap ?? 10, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger, mode: "live", outDir: "" });
  const r = res.results.get(mod.id)!;
  const section = mod.render(r.out, r.status, { public: false });
  return { r, res, section, text: JSON.stringify(section) };
}

const cfgOf = (extra: Record<string, unknown> = {}) => normalizeConfig({ domain: "yourdomain.com", brand: "YourBrand", icp: { titles: ["Head of Sales", "Revenue Operations Manager"] }, competitors: ["rival.example"], ...extra });

/** Copy rules on everything a section prints. Misses and failures are never called free. */
function copyOk(text: string) {
  assert.ok(!text.includes("—"), "em dash");
  assert.ok(!text.includes(", and "), "comma before and");
  assert.ok(!/\b(free of charge|cost \$0|costs \$0|not charged|never charged|at no cost)\b/i.test(text), "a miss or failure called free");
}

// ---------- signals ----------

const ACCOUNTS = [
  { domain: "cobalt.example", name: "Cobalt", grade: "C", score: 60 },
  { domain: "northwind.example", name: "Northwind", grade: "A", score: 91 },
  { domain: "fernway.example", name: "Fernway", grade: "B", score: 74 },
];

test("signals hit: A and B accounts only, dated timeline, intent score and tier", async () => {
  const { runner, seen } = mockRunner((job, input) => {
    const nw = JSON.stringify(input).includes("orthwind");
    if (!nw) return { outcome: "miss", charged: 0 };
    if (job === "jobs.search") return { outcome: "hit", provider: "AnyAPI", data: { jobs: [
      { title: "Account Executive", companyName: "Northwind", postedAt: daysAgo(3), url: "https://jobs.example/1" },
      { title: "Head of Sales", companyName: "Northwind", postedAt: daysAgo(8), url: "https://jobs.example/2" },
      { title: "Backend Engineer", companyName: "Someone Else", postedAt: daysAgo(1), url: "https://jobs.example/3" },
    ] } };
    if (job === "company.funding") return { outcome: "hit", provider: "Aviato", data: { fundingRounds: [{ roundName: "Series B", moneyRaised: 40_000_000, announcedOn: daysAgo(20) }] } };
    return { outcome: "hit", provider: "Serper", data: { news: [{ title: "Northwind raises $40M to expand in Europe", link: "https://news.example/a", date: daysAgo(20) }, { title: "A story about the weather", link: "https://news.example/b" }] } };
  });
  const cfg = cfgOf({ limits: { signalAccounts: 5 } });
  const { r, text } = await runOne(signals, cfg, runner, { accounts: ACCOUNTS });
  assert.equal(r.status, "done");
  assert.equal(seen.length, 6, "two A/B accounts x three lookups, the C account is left out");
  assert.ok(!seen.some((s) => JSON.stringify(s.input).includes("cobalt")));
  const out = r.out as any;
  const nw = out.accounts.find((a: any) => a.account === "Northwind");
  assert.equal(nw.intent, "hot");
  assert.ok(nw.score >= 45);
  const fw = out.accounts.find((a: any) => a.account === "Fernway");
  assert.equal(fw.intent, "cold");
  assert.equal(fw.score, 0);
  assert.equal(out.rows.length, 4, "2 roles, 1 round, 1 news item that names the company");
  for (const row of out.rows) {
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(row.provider);
  }
  const dates = out.rows.map((x: any) => x.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
  assert.match(text, /Intent by account/);
  copyOk(text);
});

test("signals miss: a charged miss is counted and the note never calls it free", async () => {
  const { runner } = mockRunner(() => ({ outcome: "miss", provider: "Aviato", charged: 0.002 }));
  const { r, text } = await runOne(signals, cfgOf({ limits: { signalAccounts: 1 } }), runner, { accounts: ACCOUNTS });
  const out = r.out as any;
  assert.equal(out.tally.miss, 3);
  assert.equal(out.tally.charged, 0.006);
  assert.match(out.summary, /No dated signal/);
  assert.match(tallyNote(out.tally), /A miss can still be charged/);
  assert.match(text, /\$0\.0060/);
  copyOk(text);
});

test("signals fail and fallback: the module finishes, the lookup trail says what happened", async () => {
  const { runner } = mockRunner((job) => {
    if (job === "jobs.search") return { outcome: "fail", note: "provider_timeout (provider)", provider: "AnyAPI" };
    if (job === "news.search") return { outcome: "fallback", provider: "AnyAPI", fallbackFrom: "Serper", data: { news: [{ title: "Northwind opens a Berlin office", link: "https://news.example/c", date: daysAgo(2) }] } };
    return { outcome: "miss" };
  });
  const { r } = await runOne(signals, cfgOf({ limits: { signalAccounts: 1 } }), runner, { accounts: ACCOUNTS });
  assert.equal(r.status, "done");
  const out = r.out as any;
  assert.match(out.accounts[0].lookups, /jobs fail \(provider_timeout/);
  assert.match(out.accounts[0].lookups, /news hit via AnyAPI after Serper/);
  assert.equal(out.rows[0].provider, "AnyAPI");
  assert.equal(out.tally.fail, 1);
  assert.equal(out.tally.fallback, 1);
});

test("signals cap stop: keeps the accounts already read and marks the section partial", async () => {
  const { runner, seen } = mockRunner(() => ({ outcome: "hit", charged: 0.03, data: { jobs: [] } }));
  // Ceilings: jobs 0.03, funding 0.07, news 0.01. At 0.03 a call, the second funding call would pass 0.12.
  const { r, res, text } = await runOne(signals, cfgOf({ limits: { signalAccounts: 2 } }), runner, { cap: 0.12, accounts: ACCOUNTS });
  assert.equal(r.status, "capped");
  assert.equal(res.capStopped, true);
  assert.equal(seen.length, 4);
  assert.equal((r.out as any).accounts.length, 1);
  assert.ok(res.calls.reduce((n, c) => n + c.charged, 0) <= 0.12 + 1e-9);
  assert.match(text, /Stopped at the cap/);
});

test("signals skip: no scored accounts means no call", async () => {
  const { runner, seen } = mockRunner(() => ({ outcome: "hit" }));
  const { r, text } = await runOne(signals, cfgOf(), runner, { accounts: [] });
  assert.equal(r.status, "skipped");
  assert.equal(seen.length, 0);
  assert.match(text, /no scored accounts/);
});

test("intent score: recent beats old, off-ICP counts less", () => {
  const now = new Date();
  const fresh = scoreEvents([{ type: "hiring", date: daysAgo(1), title: "x", source: null, provider: "p", relevant: true }], now);
  const old = scoreEvents([{ type: "hiring", date: daysAgo(200), title: "x", source: null, provider: "p", relevant: true }], now);
  const off = scoreEvents([{ type: "hiring", date: daysAgo(1), title: "x", source: null, provider: "p", relevant: false }], now);
  assert.ok(fresh.score > old.score);
  assert.ok(fresh.score > off.score);
  assert.equal(pickAccounts({ rows: ACCOUNTS }, 1)[0].name, "Northwind");
});

// ---------- competitors ----------

const COMP_PAGES: Script = (job, input) => {
  if (job === "web.scrape.markdown" && String(input.url).endsWith("/pricing")) return { outcome: "hit", provider: "Jina Reader", data: { markdown: "## Starter\nStarter $10/user/month\n## Pro\nPro $49/user/month\nEnterprise plan, contact sales" } };
  if (job === "web.scrape.markdown") return { outcome: "hit", provider: "Jina Reader", data: { data: { title: "Rival | CRM for agencies", content: "# The CRM for agencies\nRival helps agencies track every deal and close more of them each month.\n" } } };
  if (job === "company.technographics") return { outcome: "hit", provider: "Tomba", data: { data: [{ name: "HubSpot" }, { name: "Segment" }] } };
  if (job === "news.search") return { outcome: "hit", provider: "Serper", data: { news: [{ title: "Rival launches an AI assistant", link: "https://news.example/r", date: daysAgo(5), source: "TechNews" }] } };
  return { outcome: "hit", provider: "ScrapeCreators", data: { posts: [{ text: "A new feature", url: "https://www.linkedin.com/posts/1", datePublished: daysAgo(40) }] } };
};

test("competitors hit: every claim has a source and a date, weak spots come from rules", async () => {
  const { runner, seen } = mockRunner(COMP_PAGES);
  const { r, text } = await runOne(competitors, cfgOf(), runner);
  assert.equal(r.status, "done");
  assert.equal(seen.length, 5);
  const card = (r.out as any).cards[0];
  assert.ok(card.claims.length >= 8);
  for (const c of card.claims) {
    assert.match(c.source, /^https:\/\//, `source on ${c.text}`);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/, `date on ${c.text}`);
    assert.ok(c.provider);
  }
  assert.equal(card.claims.find((c: any) => c.topic === "news").dateKind, "published");
  assert.equal(card.claims.find((c: any) => c.topic === "pricing").dateKind, "read");
  assert.ok(card.weakSpots.some((w: string) => /Price jumps 4\.9x/.test(w)));
  assert.ok(card.weakSpots.includes("Top tier price is only given by sales"));
  assert.ok(card.weakSpots.includes("No LinkedIn company post in the last 30 days"));
  assert.deepEqual(card.stack, ["HubSpot", "Segment"]);
  assert.ok(competitors.files!(r.out)["competitors.json"].includes("rival.example"));
  assert.match(text, /every claim with its source/);
  copyOk(text);
});

test("competitors pricing page fails: prices come from the home page and the claim points there", async () => {
  const { runner } = mockRunner((job, input, step) => {
    if (step.startsWith("pricing:")) return { outcome: "fail", note: "http_404 (provider)" };
    if (step.startsWith("home:")) return { outcome: "hit", provider: "Jina Reader", data: "Title: Rival\n# Rival CRM\nPlus $12/mo for small teams" };
    return { outcome: "miss" };
  });
  const { r } = await runOne(competitors, cfgOf(), runner);
  const card = (r.out as any).cards[0];
  assert.deepEqual(card.pricing, [{ plan: "Plus", price: "$12/mo" }]);
  assert.equal(card.claims.find((c: any) => c.topic === "pricing").source, "https://rival.example");
  assert.match(card.lookups, /pricing fail/);
  assert.match(card.lookups, /stack miss/);
});

test("competitors skip: none in the config means no call", async () => {
  const { runner, seen } = mockRunner(COMP_PAGES);
  const { r } = await runOne(competitors, cfgOf({ competitors: [] }), runner);
  assert.equal(r.status, "skipped");
  assert.equal(seen.length, 0);
  assert.match(r.summary, /no competitors/);
});

test("competitors cap stop: partial cards survive", async () => {
  const { runner } = mockRunner((j, i, st) => ({ ...COMP_PAGES(j, i, st), charged: 0.01 }));
  // 2 competitors x 5 calls at 0.01 each. The second card stops after its home page.
  const { r, res } = await runOne(competitors, cfgOf({ competitors: ["rival.example", "other.example"] }), runner, { cap: 0.06 });
  assert.equal(r.status, "capped");
  assert.equal(res.capStopped, true);
  assert.equal((r.out as any).cards.length, 1);
});

test("pricing and weak-spot rules", () => {
  assert.deepEqual(extractPlans("Basic $5/mo\nTeam $25/mo"), [{ plan: "Basic", price: "$5/mo" }, { plan: "Team", price: "$25/mo" }]);
  assert.deepEqual(weakSpots([], "Start for free today", [], false, new Date()), []);
});

// ---------- ads ----------

const META = { searchResults: [
  { ad_archive_id: "1", page_name: "YourBrand", snapshot: { title: "The CRM sales teams love", body: { text: "Start your free trial. Trusted by 100,000 customers." } }, start_date: 1_760_000_000 },
  { ad_archive_id: "2", page_name: "Another Brand", snapshot: { body: { text: "Cheaper shoes" } } },
] };
/** The real google.company.ads shape (ScrapeCreators, by domain). The second ad points at the domain but a reseller runs it. */
const GOOGLE = { ads: [
  { adUrl: "https://adstransparency.google.com/advertiser/AR1/creative/CR1", domain: "yourdomain.com", format: "text", title: "Save 20% off annual plans", imageUrl: "https://tpc.googlesyndication.com/archive/simgad/1", firstShown: "2026-10-01T00:00:00.000Z", advertiserName: "YourBrand Inc" },
  { adUrl: "https://adstransparency.google.com/advertiser/AR2/creative/CR2", domain: "yourdomain.com", format: "text", imageUrl: "https://tpc.googlesyndication.com/archive/simgad/2", firstShown: "2026-09-01T00:00:00.000Z", advertiserName: "TRAN THI DUNG" },
], success: true };

test("ads hit: board with angles and offers, Google flagged as one provider", async () => {
  const { runner, seen: sent } = mockRunner((job) => (job === "ads.meta.search" ? { outcome: "hit", provider: "ScrapeCreators", data: META } : job === "google.company.ads" ? { outcome: "hit", provider: "ScrapeCreators", data: GOOGLE } : { outcome: "miss" }));
  const { r, text } = await runOne(ads, cfgOf(), runner);
  // Each library is searched by the advertiser, never by a keyword.
  assert.deepEqual(sent.filter((x: any) => x.job === "ads.meta.search").map((x: any) => x.input), [{ companyName: "YourBrand" }, { companyName: "Rival" }]);
  assert.deepEqual(sent.filter((x: any) => x.job === "google.company.ads").map((x: any) => x.input.domain), ["yourdomain.com", "rival.example"]);
  assert.equal(r.status, "done");
  const out = r.out as any;
  const you = out.advertisers.find((a: any) => a.you);
  assert.equal(you.meta, 1, "the other brand's ad is left out");
  assert.equal(you.linkedin, 0);
  // The reseller's ad on Google points at the domain but its advertiser is someone else: dropped.
  assert.equal(you.google, 1);
  assert.ok(you.dropped.some((d: any) => /Google: advertiser another name is not YourBrand/.test(d.reason) && d.count === 1), JSON.stringify(you.dropped));
  assert.ok(you.dropped.some((d: any) => /Meta: advertiser/.test(d.reason)));
  assert.match(text, /Ads dropped because they were not the advertiser's own/);
  assert.match(text, /Landing domain/);
  assert.ok(you.angles.some((a: string) => a.startsWith("Social proof")));
  assert.ok(you.angles.some((a: string) => a.startsWith("Price and savings")));
  assert.ok(you.offers.some((a: string) => a.startsWith("Free trial")));
  assert.ok(you.offers.some((a: string) => a.startsWith("Percent off")));
  assert.deepEqual(out.singleProvider, ["google.company.ads"]);
  assert.match(text, /Google \(one provider\)/);
  assert.match(text, /One provider, no fallback for google\.company\.ads/);
  assert.ok(Array.isArray(out.gaps.nobody));
  copyOk(text);
});

test("ads fail and fallback cells", async () => {
  const { runner } = mockRunner((job) => (job === "ads.linkedin.search" ? { outcome: "fail", note: "provider_error (provider)" } : job === "ads.meta.search" ? { outcome: "fallback", provider: "SearchAPI.io", fallbackFrom: "ScrapeCreators", data: META } : { outcome: "miss", charged: 0.002 }));
  const { r } = await runOne(ads, cfgOf(), runner);
  const you = (r.out as any).advertisers[0];
  assert.equal(you.linkedin, "fail");
  assert.equal(you.google, 0);
  assert.match(you.lookups, /meta hit via SearchAPI\.io after ScrapeCreators/);
  assert.match(you.lookups, /google miss/);
  assert.ok((r.out as any).tally.charged > 0);
});

test("ads cap stop and parser shapes", async () => {
  const { runner } = mockRunner(() => ({ outcome: "hit", data: META, charged: 0.01 }));
  const { r } = await runOne(ads, cfgOf(), runner, { cap: 0.035 });
  assert.equal(r.status, "capped");
  assert.equal((r.out as any).advertisers.length, 1, "you done, the rival not started");
  assert.equal(findAdArray(GOOGLE).length, 2);
  assert.equal(parseAds({ nothing: true }, "meta", "p").length, 0);
});

// ---------- market ----------

test("market hit: traffic, funding, roles and news per company with provider and date", async () => {
  const { runner } = mockRunner((job, input) => {
    if (job === "company.traffic") return { outcome: "hit", provider: "Datagma", data: { data: { monthlyVisits: input.domain === "yourdomain.com" ? 4_100_000 : 410_000 } } };
    if (job === "company.funding") return { outcome: "hit", provider: "Aviato", data: { fundingRounds: [{ roundName: "Series C", moneyRaised: 90_000_000, announcedOn: "2024-03-01" }] } };
    if (job === "jobs.search") return { outcome: "hit", provider: "AnyAPI", data: { jobs: [{ title: "AE", companyName: String(input.company), postedAt: daysAgo(2) }, { title: "SDR", companyName: String(input.company) }] } };
    return { outcome: "hit", provider: "Serper", data: { news: [{ title: `${input.query} launches a new app`.replace(/"/g, ""), link: "https://n.example/1", date: daysAgo(3) }, { title: `${input.query} story`.replace(/"/g, ""), link: "https://n.example/2", date: daysAgo(90) }] } };
  });
  const { r, text } = await runOne(market, cfgOf(), runner);
  assert.equal(r.status, "done");
  const rows = (r.out as any).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].traffic, "4.1M/mo");
  assert.equal(rows[1].traffic, "410K/mo");
  assert.equal(rows[0].funding, "Series C $90M, 2024-03-01");
  assert.equal(rows[0].openRoles, 2);
  assert.equal(rows[0].news30d, 1);
  assert.match(rows[0].sources, /traffic Datagma \d{4}-\d{2}-\d{2}/);
  assert.match(text, /One provider, no fallback for company\.traffic/);
  copyOk(text);
});

test("market miss and fail cells", async () => {
  const { runner } = mockRunner((job) => (job === "company.traffic" ? { outcome: "miss", charged: 0.06532 } : job === "company.funding" ? { outcome: "fail" } : { outcome: "miss" }));
  const { r } = await runOne(market, cfgOf(), runner);
  const row = (r.out as any).rows[0];
  assert.equal(row.traffic, "not found");
  assert.equal(row.funding, "fail");
  assert.equal(row.openRoles, "not found");
  assert.ok((r.out as any).tally.charged >= 0.13, "two charged traffic misses are on the tally");
  assert.equal(parseTraffic({ a: { b: [{ visits: "1200" }] } }), 1200);
});

test("market under a small cap: cheap lookups for every company first, the costly ones say not checked", async () => {
  const { runner, seen } = mockRunner(() => ({ outcome: "hit" }));
  const { r, text } = await runOne(market, cfgOf(), runner, { cap: 0.05 });
  assert.equal(r.status, "capped");
  assert.ok(seen.every((x) => x.job === "jobs.search" || x.job === "news.search"), seen.map((x) => x.job).join(","));
  // every company, rivals included, is in the table
  const rows = (r.out as any).rows;
  assert.equal(rows.length, 1 + cfgOf().competitors.length);
  assert.ok(rows.every((x: any) => x.traffic === "not checked, section cap"));
  assert.match(text, /cap/);
});

test("market reads DataForSEO's estimated organic visits (metrics.organic.etv)", async () => {
  const { parseTraffic } = await import("../src/modules/market.js");
  assert.equal(parseTraffic({ items: [{ target: "looot.ai", metrics: { organic: { etv: 81.467, count: 68 } } }] }), 81.467);
});

// ---------- the four modules in the demo dossier ----------

test("demo with module B swapped in: offline, sections render, copy rules hold", async () => {
  const { loadFixture } = await import("../src/modules/fixture.js");
  const cfg = normalizeConfig(loadFixture("config").config);
  const mods = MODULES.map((m) => MINE[m.id] ?? m);
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const noCalls: JobRunner = { call: async () => { throw new Error("demo makes no calls"); } };
  const res = await runPipeline({ mods, cfg, quote: q, runner: noCalls, ledger: new CapLedger(10, q.rows.map((r) => ({ id: r.module, worst: r.worst }))), mode: "demo", outDir: "", preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "placeholder" } } });
  for (const id of Object.keys(MINE)) assert.equal(res.results.get(id)!.status, "done", id);
  assert.equal(res.calls.length, 0);
  const receipt = placeholderReceipt({ cfg, quote: q, mods, results: res.results as Map<string, ModuleResult>, cap: 10 });
  const d = assemble({ domain: cfg.domain, brand: cfg.brand, mods, results: res.results, receipt, public: false, placeholder: "PLACEHOLDER" });
  const html = renderHtml(d);
  const md = renderMarkdown(d);
  for (const t of ["Signals and intent", "Rival cards", "Ad board", "Market snapshot", "every claim with its source", "Intent by account"]) assert.ok(md.includes(t), t);
  copyOk(html);
  copyOk(md);
});

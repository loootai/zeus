// The whole motion: rivals fallback before the quote, rule based plays from the data, and the
// dossier opening at the end of `run <domain>` (with --no-open to skip). Offline, mocks only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallResult, JobRunner } from "../src/client.js";
import { cmdRun, cmdRunDomain, type Args, type OneShotDeps } from "../src/commands.js";
import { normalizeConfig } from "../src/config.js";
import { assumeRivals, pickRivals, rivalsNeeded } from "../src/modules/rivals.js";
import { MAX_PLAYS, NEXT_ACTIONS, rulePlays, synthesis, type Play } from "../src/modules/synthesis.js";
import { validateReceipt, type Receipt } from "../src/receipt.js";

const SIMILAR = { companies: [{ domain: "rivalone.example", name: "Rival One" }, { domain: "rivaltwo.example", name: "Rival Two" }, { domain: "rivalthree.example", name: "Rival Three" }, { domain: "seedone.example", name: "Seed One" }, { domain: "competitors.com", name: "Competitors" }, { domain: "acme.example", name: "Acme itself" }] };

/** Home pages the rival check reads. Three are deal tracking tools, one is a coffee shop. */
const HOMES: Record<string, string> = {
  "rivalone.example": "Title: Rival One | Deal tracking\n# Deal tracking for sales teams\nTrack every deal. Pricing. Sign up free.\n[LinkedIn](https://www.linkedin.com/company/rival-one-hq)",
  "rivaltwo.example": "Title: Rival Two\n# Deal tracking software\nThe deal tracking tool for small teams. Start free trial. Pricing",
  "rivalthree.example": "Title: Rival Three\n# Deal tracking and pipeline\nTracking deals made simple. Get started. Pricing",
  "seedone.example": "Title: Seed One Coffee\n# Fresh coffee beans\nSingle origin coffee roasted weekly. Shop now. Pricing for subscriptions.",
};

/** Mock runner. company.similar answers with SIMILAR, home pages with HOMES, everything else misses. */
function mock() {
  const calls: { job: string; module: string; input: Record<string, unknown> }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      calls.push({ job, module: opts.module, input });
      const home = job === "web.scrape.markdown" ? HOMES[String(input.url).replace(/^https:\/\//, "").replace(/\/$/, "")] : undefined;
      const hit = job === "company.similar" || !!home;
      return {
        record: { module: opts.module, job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: opts.quotedUsd, charged: 0.001, ms: 1, ts: new Date().toISOString() },
        run: { runId: `r${calls.length}`, status: "completed", outcome: hit ? "hit" : "miss" },
        data: home ? { markdown: `${home}\n${"About us. Our company has a team in two cities and a blog. ".repeat(4)}` } : hit ? SIMILAR : {},
      };
    },
  };
  return { runner, calls };
}

// ---- rival check ------------------------------------------------------------------------------

test("rival check: needed when the brief has no rivals, only a site draft, or no logos and social pages", () => {
  const all = ["icp", "competitors", "ads", "seo"];
  assert.deepEqual(rivalsNeeded(normalizeConfig({ domain: "acme.example" }), all), { competitors: true, seeds: true, profiles: true });
  const done = { name: "x", logo: "https://x/l.png", linkedin: "https://www.linkedin.com/company/x", linkedinId: "", x: "", facebook: "" };
  const full = normalizeConfig({ domain: "acme.example", competitors: ["b.example"], seeds: ["c.example"], profiles: { "acme.example": done, "b.example": done } });
  assert.deepEqual(rivalsNeeded(full, all), { competitors: false, seeds: false, profiles: false });
  assert.deepEqual(rivalsNeeded(normalizeConfig({ domain: "acme.example", competitors: ["b.example"] }), all), { competitors: false, seeds: true, profiles: true });
  // a draft from the site is checked again
  assert.equal(rivalsNeeded(normalizeConfig({ domain: "acme.example", competitors: ["b.example"], discovery: { by: "draft" } }), all).competitors, true);
  // --only accounts reads neither list, so no call is added
  assert.deepEqual(rivalsNeeded(normalizeConfig({ domain: "acme.example" }), ["accounts"]), { competitors: false, seeds: false, profiles: false });
  const q = assumeRivals(normalizeConfig({ domain: "acme.example" }), { competitors: true, seeds: true });
  assert.equal(q.competitors.length, 3);
  assert.equal(q.seeds.length, 5);
  const cfg = normalizeConfig({ domain: "acme.example" });
  const p = pickRivals(["acme.example", "a.example", "b.example", "competitors.com", "c.example", "d.example", "a.example", "www.acme.example"], cfg, { competitors: true, seeds: true });
  assert.deepEqual(p, { competitors: ["a.example", "b.example", "c.example"], seeds: ["d.example"] });
});

test("rival check: quoted, runs first after the yes, keeps real rivals and drops the coffee shop and competitors.com", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-rivals-"));
  const outDir = join(dir, "gtm");
  mkdirSync(outDir, { recursive: true });
  const configPath = join(outDir, "config.yaml");
  writeFileSync(configPath, "domain: acme.example\noffer: Deal tracking for sales teams\nkeywords: [deal tracking, deal tracking tool]\n");
  const events: string[] = [];
  const m = mock();
  const deps: OneShotDeps = { client: () => m.runner, isTTY: false, log: (l) => events.push(l) };
  const receipt = (await cmdRun({ offline: true, yes: true, cap: "10" }, configPath, outDir, deps)) as Receipt;
  const text = events.join("\n");
  // the quote has a rivals row, printed before any paid call
  assert.match(text, /^rivals\s+google\.serp\.organic/m);
  // the first paid calls are the rival check
  assert.equal(m.calls[0].module, "rivals");
  assert.ok(m.calls.some((c) => c.module === "rivals" && c.job === "company.similar" && c.input.domain === "acme.example"));
  // competitors.com is never even read: a generic domain is never a candidate
  assert.deepEqual(m.calls.filter((c) => JSON.stringify(c.input).includes("competitors.com")).map((c) => `${c.module} ${c.job} ${JSON.stringify(c.input)}`), []);
  const cfg = readFileSync(configPath, "utf8");
  for (const d of ["rivalone.example", "rivaltwo.example", "rivalthree.example"]) assert.ok(new RegExp(`competitors:[\\s\\S]*- ${d.replace(".", "\\.")}`).test(cfg), `${d}\n${cfg}`);
  // the coffee shop shares no category word, so it is turned down with its reason
  const cands = JSON.parse(readFileSync(join(outDir, "candidates.json"), "utf8"));
  const coffee = cands.candidates.find((c: any) => c.domain === "seedone.example");
  assert.equal(coffee.kept, false);
  assert.match(coffee.reason, /category word/);
  assert.match(cfg, /excluded:\n\s+- seedone\.example/);
  // the LinkedIn page comes from the rival's own site, not a guess from the domain
  assert.match(cfg, /linkedin: https:\/\/www\.linkedin\.com\/company\/rival-one-hq/);
  assert.match(text, /Rivals rivalone\.example, rivaltwo\.example, rivalthree\.example|Rivals rivalone\.example, rivalthree\.example, rivaltwo\.example|Rivals rival/);
  // the competitor module ran on the kept rivals
  assert.ok(m.calls.some((c) => c.module === "competitors" && JSON.stringify(c.input).includes("rivalone.example")));
  assert.ok(!m.calls.some((c) => c.module === "competitors" && JSON.stringify(c.input).includes("seedone.example")));
  // the receipt keeps the rival check calls and a measured time
  assert.deepEqual(validateReceipt(receipt), []);
  assert.ok(receipt.modules.some((x) => x.id === "rivals" && x.calls > 1));
  assert.equal(receipt.run.durationMs, Date.parse(receipt.run.finishedAt) - Date.parse(receipt.run.startedAt));
  assert.ok(Date.parse(receipt.run.startedAt) <= Date.parse(receipt.calls.find((c) => c.module === "rivals")!.ts));
  assert.ok(receipt.run.charged <= receipt.run.cap);
});

test("rival check: a brief with rivals, seeds and profiles makes no rival call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-rivals-"));
  const outDir = join(dir, "gtm");
  mkdirSync(outDir, { recursive: true });
  const configPath = join(outDir, "config.yaml");
  const p = "{name: X, logo: 'https://x.example/l.png', linkedin: 'https://www.linkedin.com/company/x'}";
  writeFileSync(configPath, `domain: acme.example\ncompetitors: [bigco.example]\nseeds: [northwind.example]\nprofiles:\n  acme.example: ${p}\n  bigco.example: ${p}\n`);
  const m = mock();
  const events: string[] = [];
  await cmdRun({ offline: true, yes: true, cap: "10" }, configPath, outDir, { client: () => m.runner, isTTY: false, log: (l) => events.push(l) });
  assert.ok(!m.calls.some((c) => c.module === "rivals"));
  assert.doesNotMatch(events.join("\n"), /^rivals\s/m);
});

// ---- rule based plays -----------------------------------------------------------------------------

const FULL = {
  signals: {
    accounts: [
      { account: "Northwind", score: 86, intent: "hot", events: [{ type: "hiring", title: "Head of Sales", relevant: true }, { type: "hiring", title: "SDR", relevant: true }] },
      { account: "Fern", score: 91, intent: "hot", events: [] },
      { account: "Lumen", score: 30, intent: "warm", events: [{ type: "hiring", title: "Growth Lead", relevant: true }] },
    ],
  },
  enrich: { rows: [{ account: "Northwind", email: "ana@northwind.example", status: "valid" }, { account: "Lumen", email: "bo@lumen.example", status: "valid" }] },
  ads: { gaps: { yoursMissing: ["Social proof"], nobody: ["Urgency"] }, advertisers: [{ name: "Rival A", you: false, angles: ["Social proof (3)"] }, { name: "You", you: true, angles: [] }] },
  seo: {
    gaps: [{ keyword: "deal tracking", volume: 900, you: "-", rival: "Rival A" }, { keyword: "crm for agencies", volume: 1400, you: "-", rival: "Rival B" }],
    ai: [{ question: "best crm for agencies", named: ["Rival A", "Rival B"], you: false, status: "answered" }, { question: "is acme worth it", named: ["Acme"], you: true, status: "answered" }],
  },
  competitors: { cards: [{ name: "Rival A", weakSpots: ["pricing jumps 3x from Starter to Pro"] }] },
  reviews: { weakSpots: [{ competitor: "Rival A", theme: "mobile sync", count: 12 }] },
  mentions: { rows: [{ title: "Looking for a simple CRM", intent: true, url: "https://reddit.example/p/1", about: "you", platform: "Reddit" }] },
};

function checkPlay(p: Play) {
  for (const k of ["title", "evidence", "list", "command", "cost"] as const) assert.ok(typeof p[k] === "string" && p[k].trim().length > 0, `${p.title} has no ${k}`);
  assert.match(p.command, /^looot-zeus /, p.title);
  assert.match(p.evidence, /From (signals|ads|seo|competitors|reviews|mentions)\./, p.title);
  const all = Object.values(p).join(" ");
  assert.doesNotMatch(all, /, and |—/, p.title);
  assert.doesNotMatch(all, /\b(write|writes|drafts?)\b.*\b(email|emails|opener|openers|page|pages)\b/i, p.title);
}

test("rule plays: 5 to 7 plays from full data, each with evidence, list, next command and cost", () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.example"], keywords: ["deal tracking"], questions: ["best crm for agencies"] });
  const plays = rulePlays(FULL, cfg);
  assert.ok(plays.length >= 5 && plays.length <= MAX_PLAYS, `${plays.length} plays`);
  plays.forEach(checkPlay);
  const titles = plays.map((p) => p.title).join("\n");
  assert.match(titles, /hot accounts/);
  assert.match(titles, /ad angle "Social proof"/);
  assert.match(titles, /"crm for agencies"/, "the keyword with the most searches comes first");
  assert.match(titles, /switch campaign aimed at Rival A/);
  assert.match(titles, /hiring/);
  assert.match(titles, /AI answers/);
  assert.match(titles, /buying-intent posts/);
  // verified emails at a hot account point at the Instantly export
  assert.match(plays[0].list, /instantly\.csv/);
  assert.match(plays[0].cost, /^\$0/);
});

test("rule plays: a play is only written when its data exists", () => {
  const cfg = normalizeConfig({ domain: "acme.example" });
  assert.deepEqual(rulePlays({}, cfg), []);
  const onlyGaps = rulePlays({ seo: { gaps: [{ keyword: "deal tracking", volume: null, you: "-", rival: "Rival A" }], ai: [] } }, cfg);
  assert.equal(onlyGaps.length, 1);
  checkPlay(onlyGaps[0]);
  // a warm account with no hiring event, no ad gap and AI answers that name you give no play
  assert.deepEqual(rulePlays({ signals: { accounts: [{ account: "Lumen", score: 30, intent: "warm", events: [] }] }, ads: { gaps: { yoursMissing: [], nobody: [] } }, seo: { gaps: [], ai: [{ question: "q", named: ["Acme"], you: true, status: "answered" }] } }, cfg), []);
  // hot accounts with no verified email point at finding emails, with a price
  const noMail = rulePlays({ signals: { accounts: [{ account: "Fern", score: 91, intent: "hot", events: [] }] } }, cfg);
  assert.equal(noMail.length, 1);
  assert.equal(noMail[0].command, "looot-zeus run --only enrich --people");
  assert.match(noMail[0].cost, /about \$/);
});

test("synthesis writes the rule plays to the summary and plays.md, next actions have no openers row", async () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.example"] });
  const r = await synthesis.run({ cfg, mode: "live", outputs: FULL, outDir: "", partial() {}, log() {}, call: async () => { throw new Error("no calls"); } });
  const out = r.out as { plays: Play[] };
  assert.ok(out.plays.length >= 5);
  assert.match(r.summary, /plays from the data/);
  const md = synthesis.files!(r.out)["plays.md"];
  assert.match(md, /## 1\. /);
  assert.match(md, /Scale it: `looot-zeus /);
  const section = synthesis.render(r.out, "done", { public: false })!;
  assert.ok(section.blocks.some((b) => b.kind === "table" && /plays/.test((b as { caption?: string }).caption ?? "")));
  assert.ok(!NEXT_ACTIONS.some((a) => /opener|loootai/i.test(`${a.action} ${a.cost}`)));
  const empty = await synthesis.run({ cfg, mode: "live", outputs: {}, outDir: "", partial() {}, log() {}, call: async () => { throw new Error("no calls"); } });
  assert.deepEqual((empty.out as { plays: Play[] }).plays, []);
});

// ---- the dossier opens at the end of run <domain> -------------------------------------------------

const HOME = `<html><head><title>Acme CRM | Sales pipeline software</title></head><body>
<h1>The sales CRM for small teams</h1>
<p>Acme CRM helps small sales teams track every deal and close more of them each month. Built for agencies and software teams.</p>
<a href="/pricing">Pricing</a> <a href="/customers">Customers</a> <a href="/vs/bigco">Acme vs Bigco</a>
<p>sales pipeline tool, deal tracking, deal tracking for agencies and software teams, forecasting for sales managers.</p>
</body></html>`;
const PAGE = `<html><head><title>Acme</title></head><body><h1>Acme</h1>
<p>Trusted by <a href="https://northwind.example">Northwind</a> and <a href="https://contoso.example/story">Contoso</a>. Compare Acme with Bigco and Megacrm. Plans start at 29 USD per seat per month with a free trial for every team.</p>
</body></html>`;
const fakeFetch = (async (input: string | URL | Request) => new Response(/\/(pricing|customers|vs\/bigco)/.test(String(input)) ? PAGE : HOME, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;

async function oneShot(a: Args, isTTY: boolean, push?: OneShotDeps["push"]) {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-open-"));
  const outDir = join(dir, "gtm");
  const opened: string[] = [];
  const events: string[] = [];
  const m = mock();
  await cmdRunDomain("acme.example", { offline: true, ...a }, join(outDir, "config.yaml"), outDir, { fetch: fakeFetch, client: () => m.runner, isTTY, ask: async () => "y", open: (f) => opened.push(f), log: (l) => events.push(l), ...(push ? { push } : {}) });
  return { outDir, opened, events };
}

const ZEUS_PAGE = "https://zeus.looot.ai/p/acme.example";
const pushedOk: OneShotDeps["push"] = async () => ({ ok: true, status: 200, url: ZEUS_PAGE, domain: "acme.example" });

test("run <domain> that pushed opens and prints the Zeus page, not the local dossier", async () => {
  const s = await oneShot({}, true, pushedOk);
  assert.deepEqual(s.opened, [ZEUS_PAGE]);
  const text = s.events.join("\n");
  assert.match(text, /Your GTM engine: https:\/\/zeus\.looot\.ai\/p\/acme\.example/);
  assert.doesNotMatch(text, /Opened .*dossier\.html/);
  // the local files are still written
  for (const f of ["dossier.html", "dossier.md", "receipt.json", join("city", "index.html")]) assert.ok(existsSync(join(s.outDir, f)), f);
  // the last run line points at the page, not at the local dossier
  assert.doesNotMatch(s.events.find((e) => /calls · /.test(e)) ?? "", /dossier\.html/);
});

test("run <domain> that pushed prints the Zeus page even without a terminal, and opens nothing", async () => {
  const s = await oneShot({ yes: true }, false, pushedOk);
  assert.deepEqual(s.opened, []);
  assert.match(s.events.join("\n"), /Your GTM engine: https:\/\/zeus\.looot\.ai\/p\/acme\.example/);
});

test("run <domain> whose push was refused opens the local dossier and says why and how to push", async () => {
  const s = await oneShot({}, true, async () => ({ ok: false, status: 401, message: "key not accepted" }));
  assert.equal(s.opened.length, 1);
  assert.ok(s.opened[0].endsWith(join("gtm", "dossier.html")));
  const text = s.events.join("\n");
  assert.match(text, /Push refused \(401\): key not accepted/);
  assert.match(text, /looot-zeus push/);
  assert.match(text, /Opened the local dossier/);
});

test("run <domain> whose push threw opens the local dossier and says why", async () => {
  const s = await oneShot({}, true, async () => { throw new Error("network down"); });
  assert.ok(s.opened[0].endsWith(join("gtm", "dossier.html")));
  assert.match(s.events.join("\n"), /Not pushed to Zeus: network down.*looot-zeus push/s);
});

test("run <domain> never opens a non-Zeus link from the push answer", async () => {
  const s = await oneShot({}, true, async () => ({ ok: true, status: 200, url: "https://evil.example/p/acme.example" }));
  assert.equal(s.opened.length, 1);
  assert.ok(s.opened[0].endsWith(join("gtm", "dossier.html")));
  assert.doesNotMatch(s.events.join("\n"), /Your GTM engine/);
  const q = await oneShot({}, true, async () => ({ ok: true, status: 200, url: "https://zeus.looot.ai/p/acme.example?x=1&calc" }));
  assert.ok(q.opened[0].endsWith(join("gtm", "dossier.html")));
});

test("run <domain> --no-push opens the local dossier and says how to push", async () => {
  let pushed = 0;
  const s = await oneShot({ "no-push": true }, true, async () => { pushed++; return { ok: true, status: 200, url: ZEUS_PAGE }; });
  assert.equal(pushed, 0);
  assert.ok(s.opened[0].endsWith(join("gtm", "dossier.html")));
  const text = s.events.join("\n");
  assert.match(text, /Not pushed to Zeus \(--no-push\)/);
  assert.match(text, /looot-zeus push/);
});

test("run <domain> opens the dossier at the end in a terminal", async () => {
  const s = await oneShot({}, true);
  assert.equal(s.opened.length, 1);
  assert.ok(s.opened[0].endsWith(join("gtm", "dossier.html")));
  assert.ok(existsSync(s.opened[0]));
  assert.match(s.events.join("\n"), /--no-open/);
});

test("run <domain> --no-open skips it, and no terminal never opens anything", async () => {
  const off = await oneShot({ "no-open": true }, true);
  assert.deepEqual(off.opened, []);
  const pipe = await oneShot({ yes: true }, false);
  assert.deepEqual(pipe.opened, []);
});

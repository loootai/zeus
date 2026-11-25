// icp, accounts, people and enrich against a mocked looot client. No network, no spend.
// Covers hit, miss (charged and not), fail, fallback with its provider trail, and the cap stop.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger, CapReached } from "../src/cap.js";
import { type CallOptions, type CallResult, type JobRunner, type LoootRun, toRecord } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import type { Section } from "../src/dossier/blocks.js";
import { renderHtml } from "../src/dossier/html.js";
import { renderMarkdown } from "../src/dossier/md.js";
import { accounts, criteriaFrom, scoreAccount } from "../src/modules/accounts.js";
import { enrich, type EnrichOut } from "../src/modules/enrich.js";
import { icp, type IcpOut, normalizeCompany, rowsOf, trailOf } from "../src/modules/icp.js";
import { runPipeline } from "../src/modules/index.js";
import { intake } from "../src/modules/intake.js";
import { normalizePerson, people, type PeopleOut, titleKeyword } from "../src/modules/people.js";
import type { GtmModule, ModuleContext } from "../src/modules/types.js";
import { buildQuote } from "../src/quote.js";

const MODS: GtmModule[] = [intake, icp, accounts, people, enrich];

const cfg = normalizeConfig({ people: true,
  domain: "acme.example",
  brand: "Acme",
  offer: "CRM for small sales teams",
  icp: { industries: ["software"], sizeBand: "11-200", geos: ["Netherlands"], titles: ["Head of Sales", "VP Sales", "Founder"] },
  seeds: ["seed-one.example", "seed-two.example"],
  competitors: ["rival.example"],
  limits: { accounts: 3, peoplePerAccount: 2, signalAccounts: 1 },
});

type Reply = { outcome: "hit" | "miss" | "fail" | "fallback"; data?: unknown; charged?: number; providers?: string[] };
type Script = (job: string, input: Record<string, any>) => Reply;

/** A JobRunner that answers from a script and records every call, built through the real toRecord. */
function mockRunner(script: Script) {
  const sent: { job: string; input: Record<string, any>; opts: CallOptions }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push({ job, input, opts });
      const r = script(job, input);
      const providers = r.providers ?? [r.outcome === "fallback" ? "first-provider" : "provider-a", "provider-b"];
      let run: LoootRun;
      if (r.outcome === "fail") run = { runId: `r${sent.length}`, status: "failed", outcome: "error", actualCost: r.charged ?? 0, error: { code: "provider_error", whoseError: "provider" }, route: { servedBy: providers[0], attempts: [{ provider: providers[0], outcome: "error" }] } };
      else if (r.outcome === "miss") run = { runId: `r${sent.length}`, status: "completed", outcome: "miss", actualCost: r.charged ?? 0, route: { servedBy: providers[0], outcome: "miss", attempts: [{ provider: providers[0], outcome: "miss" }] } };
      else if (r.outcome === "fallback") run = { runId: `r${sent.length}`, status: "completed", outcome: "hit", actualCost: r.charged ?? 0.002, result: r.data, route: { servedBy: providers[1], outcome: "hit", attempts: [{ provider: providers[0], outcome: "miss" }, { provider: providers[1], outcome: "hit" }] } };
      else run = { runId: `r${sent.length}`, status: "completed", outcome: "hit", actualCost: r.charged ?? 0.001, result: r.data, route: { servedBy: providers[0], outcome: "hit", attempts: [{ provider: providers[0], outcome: "hit" }] } };
      const record = toRecord(run, job, opts, 5, "2026-10-30T09:00:00.000Z");
      return { record, run, data: run.result ?? null };
    },
  };
  return { runner, sent };
}

const COMPANIES: Record<string, any> = {
  "acme.example": { name: "Acme", industry: "Software", employees: 40, country: "Netherlands" },
  "seed-one.example": { name: "Seed One", industry: "Software", employee_count: "51-200", country: "NL" },
  "seed-two.example": { name: "Seed Two", industries: ["software", "consulting"], employees: 90, country: "Netherlands" },
  "north.example": { name: "Northwind", industry: "software", employees: 140, country: "Netherlands" },
  "big.example": { name: "Bigcorp", industry: "Mining", employees: 9000, country: "Brazil" },
  "mid.example": { name: "Midway", industry: "Software", employees: 300, country: "Netherlands" },
};

/** The happy path script. Variations override single jobs. */
const happy: Script = (job, input) => {
  switch (job) {
    case "company.enrich":
      return COMPANIES[input.domain] ? { outcome: "hit", data: { data: { domain: input.domain, ...COMPANIES[input.domain] } } } : { outcome: "miss", charged: 0.0019 };
    case "company.technographics":
      return { outcome: "hit", data: { technologies: [{ name: "Stripe" }, { name: "HubSpot" }] } };
    case "company.similar":
      return { outcome: "hit", data: { companies: [{ domain: "north.example", name: "Northwind", industry: "Software", employees: 140, country: "Netherlands" }, { domain: "seed-two.example", name: "Seed Two" }, { domain: "rival.example", name: "Rival" }, { domain: "big.example", name: "Bigcorp", industry: "Mining", employees: 9000, country: "Brazil" }] } };
    case "company.search":
    case "company.search.filtered":
      return { outcome: "hit", data: { items: [{ website: "https://www.mid.example/", name: "Midway", industry: "Software", employees: 300, location: { country: "Netherlands" } }, { domain: "acme.example", name: "Acme" }, { domain: "berlin.example", name: "Berlin Soft", industry: "Software", employees: 100, location: { country: "Germany" } }] } };
    case "people.search":
      return { outcome: "hit", data: { people: [
        { full_name: "Ann Engineer", title: "Software Engineer", linkedin_url: "https://linkedin.com/in/ann" },
        { first_name: "Mara", last_name: "Vermeer", title: "Head of Sales", linkedin_url: "https://linkedin.com/in/mara" },
        { full_name: "J*** D***", title: "VP Sales" },
        { full_name: "Tom Founder", title: "Founder & CEO", email: `tom@${input.domain}` },
      ] } };
    case "people.email.find":
      return { outcome: "hit", data: { email: `${String(input.first_name).toLowerCase()}@${input.domain}` } };
    case "people.email.verify":
      return { outcome: "hit", data: { status: "deliverable" } };
    default:
      return { outcome: "miss" };
  }
};

async function pipeline(script: Script, cap = 5, phones = false) {
  const c = phones ? { ...cfg, phones: true } : cfg;
  const { runner, sent } = mockRunner(script);
  const q = buildQuote(MODS, c, { source: "test", live: {} }, { skipDone: new Set(["intake"]) });
  const ledger = new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })));
  const res = await runPipeline({ mods: MODS, cfg: c, quote: q, runner, ledger, mode: "live", outDir: "/tmp/unused", preset: { intake: { out: { config: c }, summary: "done at init" } } });
  return { res, sent, q };
}

function ctxFor(outputs: Record<string, unknown>, runner: JobRunner, mode: "live" | "demo" = "live", c = cfg): ModuleContext {
  const q = buildQuote(MODS, c, { source: "test", live: {} });
  return {
    cfg: c, mode, outputs, outDir: "/tmp/unused", log: () => {}, partial: () => {},
    call: (job, input, step) => {
      const line = q.rows.flatMap((r) => r.lines).find((l) => l.job === job)!;
      return runner.call(job, input, { module: "t", step, maxCostUsd: line.capPerCall, quotedUsd: line.unitUsd });
    },
  };
}

const text = (s: Section | null) => (s ? JSON.stringify(s) : "");

// ------------------------------------------------------------------ normalising and scoring

test("company and person normalising reads the usual provider shapes", () => {
  const c = normalizeCompany({ website: "https://www.mid.example/about", company_name: "Midway", employees_range: "51-200", location: { country: { code: "de" } }, industries: ["Software", "SaaS"] })!;
  assert.equal(c.domain, "mid.example");
  assert.equal(c.employees, 126);
  assert.equal(c.country, "DE");
  assert.deepEqual(c.industries, ["software", "saas"]);
  assert.equal(normalizeCompany({ name: "no domain" }), null);
  assert.equal(rowsOf({ data: { companies: [{ a: 1 }] } }).length, 1);
  const p = normalizePerson({ first_name: "Mara", last_name: "Vermeer", job_title: "Head of Sales", profile_url: "https://www.linkedin.com/in/mara" })!;
  assert.equal(p.name, "Mara Vermeer");
  assert.equal(p.masked, false);
  assert.equal(normalizePerson({ full_name: "J*** D***" })!.masked, true);
  assert.equal(titleKeyword(["Head of Sales", "VP Sales", "Founder"]), "sales");
});

test("accounts scoring: A with reasons, D on a poor fit, missing data earns no points and says so", () => {
  const crit = { industries: ["software"], band: [11, 200] as [number, number], countries: ["Netherlands"], stack: [] };
  const a = scoreAccount({ company: { domain: "n.example", name: "N", industries: ["software"], employees: 140, country: "NL", technologies: [], keywords: [] }, similarity: 0.9, searchRank: null }, crit);
  assert.equal(a.grade, "A");
  assert.match(a.reasons, /140 staff in band/);
  assert.match(a.reasons, /software fits/);
  const d = scoreAccount({ company: { domain: "b.example", name: "B", industries: ["mining"], employees: 9000, country: "BR", technologies: [], keywords: [] }, similarity: null, searchRank: 20 }, crit);
  assert.equal(d.grade, "D");
  assert.match(d.reasons, /outside/);
  const u = scoreAccount({ company: { domain: "u.example", name: null, industries: [], employees: null, country: null, technologies: [], keywords: [] }, similarity: null, searchRank: 1 }, crit);
  assert.ok(u.lines.filter((l) => !l.known).every((l) => l.points === 0));
  assert.ok(u.lines.some((l) => l.detail === "no headcount returned"));
  assert.deepEqual(criteriaFrom(cfg, null).industries, ["software"]);
});

// ------------------------------------------------------------------ icp

test("icp hit: card from the seeds, lookalikes without seeds, competitors or you, best first", async () => {
  const { runner, sent } = mockRunner(happy);
  const r = await icp.run(ctxFor({}, runner));
  const out = r.out as IcpOut;
  assert.equal(r.status, "done");
  assert.equal(out.card.from.industries, "seeds");
  assert.equal(out.card.sizeBand, "90-126");
  assert.deepEqual(out.card.geos, ["Netherlands"]);
  assert.ok(out.card.stack.some((s) => /stripe \(2 of 2 seeds\)/.test(s)));
  const doms = out.lookalikes.map((l) => l.domain);
  assert.deepEqual(doms, ["north.example", "big.example"]);
  assert.ok(!doms.includes("rival.example") && !doms.includes("seed-two.example"));
  assert.equal(out.lookalikes[0].seed, "seed-one.example, seed-two.example");
  assert.equal(sent.filter((s) => s.job === "company.similar").length, 2);
  assert.deepEqual(sent.find((s) => s.job === "company.similar")!.input, { domain: "seed-one.example", limit: 5 });
  assert.ok(text(icp.render(out, "done", { public: false })).includes("Lookalike candidates"));
});

test("icp miss: no seed resolves, the card keeps the intake draft and the charged misses are shown", async () => {
  const { runner } = mockRunner((job) => (job === "company.technographics" ? { outcome: "fail" } : { outcome: "miss", charged: 0.002 }));
  const r = await icp.run(ctxFor({}, runner));
  const out = r.out as IcpOut;
  assert.equal(out.card.from.industries, "config");
  assert.deepEqual(out.card.industries, ["software"]);
  assert.equal(out.lookalikes.length, 0);
  const s = text(icp.render(out, "done", { public: false }));
  assert.match(s, /misses charged \$0\.0100 in total/);
  assert.match(s, /3 failed calls charged \$0\.0000/);
  assert.ok(!/free/i.test(s));
});

// ------------------------------------------------------------------ accounts

test("accounts: lookalikes plus search, enrich falls back to a second provider, scored A to D", async () => {
  const { runner: r1 } = mockRunner(happy);
  const icpOut = (await icp.run(ctxFor({}, r1))).out;
  const { runner, sent } = mockRunner((job, input) => (job === "company.enrich" && input.domain === "mid.example" ? { outcome: "fallback", providers: ["kittai", "tomba"], data: { domain: "mid.example", industry: "Software", employees: 150, country: "Netherlands" } } : happy(job, input)));
  const r = await accounts.run(ctxFor({ icp: icpOut }, runner));
  const out = r.out as any;
  // Bigcorp (9,000 staff, mining, Brazil) fails the hard ICP filter: dropped, never shown, counted by reason.
  assert.equal(out.rows.length, 2);
  assert.ok(!out.rows.some((x: any) => x.domain === "acme.example"));
  assert.ok(!out.rows.some((x: any) => x.domain === "big.example"));
  // Berlin Soft fits on size and industry but sits outside the target countries: dropped too.
  assert.ok(!out.rows.some((x: any) => x.domain === "berlin.example"));
  assert.deepEqual(out.dropped.map((d: any) => d.reason).sort(), ["outside the target countries", "over 5,000 staff"]);
  const mid = out.rows.find((x: any) => x.domain === "mid.example");
  assert.equal(mid.employees, 150);
  assert.equal(mid.provider, "tomba");
  assert.ok(out.calls.some((c: any) => c.trail === "kittai miss → tomba hit"));
  assert.equal(out.rows[0].grade, "A");
  const search = sent.find((s) => s.job === "company.search.filtered")!.input;
  // the size band, industry and country also go as AI Ark's own filter, so giants are not returned first
  assert.deepEqual(search, { size: 25, page: 0, account: { employeeSize: { type: "RANGE", range: [{ start: 45, end: 252 }] }, industries: { any: { include: { mode: "WORD", content: ["software"] } } }, location: { any: { include: ["Netherlands"] } } } });
  assert.match(r.summary, /2 accounts scored, \d A, \d B, \d C, \d D, 2 dropped by the ICP filter/);
  // Fewer than 5 fits: the view says so and shows the more accounts command, no padding.
  const sec = JSON.stringify(accounts.render(out, "done", { public: false }));
  assert.match(sec, /Only 2 accounts fit the ICP/);
  assert.match(sec, /looot-zeus more accounts/);
});

// ------------------------------------------------------------------ people

test("people: the title keyword goes to the provider, two best titles kept per account, masked names flagged", async () => {
  const acc = { rows: [{ domain: "north.example", name: "Northwind", grade: "A", score: 90 }, { domain: "big.example", name: "Bigcorp", grade: "D", score: 10 }] };
  const { runner, sent } = mockRunner((job, input) => (input.domain === "big.example" ? { outcome: "miss", charged: 0.001 } : happy(job, input)));
  const r = await people.run(ctxFor({ accounts: acc }, runner));
  const out = r.out as PeopleOut;
  assert.equal(sent[0].input.job_title, "sales");
  assert.equal(sent[0].input.domain, "north.example");
  const north = out.rows.filter((p) => p.domain === "north.example");
  assert.equal(north.length, 2);
  assert.deepEqual(north.map((p) => p.name), ["Mara Vermeer", "Tom Founder"]);
  assert.match(out.summary, /1 accounts came back empty/);
  assert.equal(people.render(out, "done", { public: false }), null);
});

// ------------------------------------------------------------------ enrich

test("enrich: hit, fallback trail, charged miss, fail, masked skip and an email from search", async () => {
  const ppl: PeopleOut = { summary: "", rows: [
    { account: "A", domain: "a.example", grade: "A", name: "Mara Vermeer", firstName: "Mara", lastName: "Vermeer", title: "Head of Sales", linkedin: "", email: "", masked: false, provider: "p", date: "" },
    { account: "B", domain: "b.example", grade: "A", name: "Bo Fall", firstName: "Bo", lastName: "Fall", title: "VP Sales", linkedin: "https://linkedin.com/in/bo", email: "", masked: false, provider: "p", date: "" },
    { account: "C", domain: "c.example", grade: "B", name: "Cy Miss", firstName: "Cy", lastName: "Miss", title: "Founder", linkedin: "", email: "", masked: false, provider: "p", date: "" },
    { account: "D", domain: "d.example", grade: "B", name: "Di Fail", firstName: "Di", lastName: "Fail", title: "Founder", linkedin: "", email: "", masked: false, provider: "p", date: "" },
    { account: "E", domain: "e.example", grade: "C", name: "J*** D***", firstName: "J***", lastName: "D***", title: "VP Sales", linkedin: "", email: "", masked: true, provider: "p", date: "" },
    { account: "F", domain: "f.example", grade: "C", name: "Tom Founder", firstName: "Tom", lastName: "Founder", title: "Founder", linkedin: "", email: "tom@f.example", masked: false, provider: "dropleads", date: "" },
  ] };
  const { runner, sent } = mockRunner((job, input) => {
    if (job === "people.email.find" && input.domain === "b.example") return { outcome: "fallback", providers: ["kittai", "findymail"], data: { result: { email: "bo@b.example" } }, charged: 0.0086 };
    if (job === "people.email.find" && input.domain === "c.example") return { outcome: "miss", providers: ["kittai"], charged: 0.0036 };
    if (job === "people.email.find" && input.domain === "d.example") return { outcome: "fail", providers: ["kittai"] };
    if (job === "people.email.verify" && input.email === "bo@b.example") return { outcome: "hit", providers: ["dropleads"], data: { verdict: "catch-all" } };
    return happy(job, input);
  });
  const r = await enrich.run(ctxFor({ people: ppl }, runner));
  const out = r.out as EnrichOut;
  const by = (d: string) => out.rows.find((x) => x.domain === d)!;
  assert.equal(by("a.example").status, "valid");
  assert.equal(by("a.example").email, "mara@a.example");
  assert.equal(by("b.example").status, "catch_all");
  assert.equal(by("b.example").trail, "kittai miss → findymail hit · verified by dropleads");
  assert.equal(by("c.example").status, "miss");
  assert.equal(by("c.example").charged, 0.0036);
  assert.equal(by("d.example").status, "fail");
  assert.equal(by("e.example").status, "not looked up");
  assert.equal(by("f.example").status, "valid");
  assert.match(by("f.example").trail, /email from people search/);
  assert.ok(!sent.some((s) => s.job === "people.email.find" && s.input.domain === "f.example"));
  assert.ok(!sent.some((s) => s.input.domain === "e.example"));
  assert.ok(sent.find((s) => s.input.domain === "b.example")!.input.linkedin_url);
  assert.match(out.summary, /2 emails verified · 1 catch-all, risky or unconfirmed · 1 miss · 1 failed · 1 not looked up/);
  const sec = enrich.render(out, "done", { public: false })!;
  const s = text(sec);
  assert.match(s, /1 misses charged \$0\.0036/);
  // --public masks names and emails in the HTML and the markdown.
  const d = { domain: "x.example", brand: "X", generatedAt: "2026-10-30T09:00:00.000Z", public: true, sections: [sec] };
  const html = renderHtml(d);
  const md = renderMarkdown(d);
  for (const t of [html, md]) {
    assert.ok(!t.includes("mara@a.example") && !t.includes("Mara Vermeer"));
    assert.match(t, /m\*\*\*@a\.example/);
    assert.ok(!t.includes(", and ") && !t.includes("—"));
  }
});

test("enrich: --phones adds a phone lookup on the LinkedIn URL", async () => {
  const ppl = { rows: [{ account: "B", domain: "b.example", grade: "A", name: "Bo Fall", firstName: "Bo", lastName: "Fall", title: "VP Sales", linkedin: "https://linkedin.com/in/bo", email: "", masked: false, provider: "p", date: "" }] };
  const { runner, sent } = mockRunner((job, input) => (job === "people.phone.find" ? { outcome: "hit", data: { phone: "+31 6 1234 5678" } } : happy(job, input)));
  const ctx = ctxFor({ people: ppl }, runner, "live", { ...cfg, phones: true });
  const out = (await enrich.run(ctx)).out as EnrichOut;
  // Stored in E.164 with its line type. The input carries the LinkedIn URL under each provider's name for it.
  assert.equal(out.rows[0].phone, "+31612345678");
  assert.equal(out.rows[0].phoneType, "Mobile");
  const input = sent.find((s) => s.job === "people.phone.find")!.input;
  assert.equal(input.linkedin_url, "https://linkedin.com/in/bo");
  assert.equal(input.linkedin, "https://linkedin.com/in/bo");
  assert.equal(input.profile_url, "https://linkedin.com/in/bo");
  const html = renderHtml({ domain: "x", brand: "X", generatedAt: "2026-10-30T09:00:00.000Z", public: true, sections: [enrich.render(out, "done", { public: true })!] });
  assert.ok(!html.includes("1234 5678") && !html.includes("12345678"));
});

// ------------------------------------------------------------------ the four in a pipeline

test("pipeline: icp → accounts → people → enrich end to end, every call on the ledger", async () => {
  const { res, sent } = await pipeline(happy, 5);
  for (const id of ["icp", "accounts", "people", "enrich"]) assert.equal(res.results.get(id)!.status, "done", id);
  assert.equal(res.calls.length, sent.length);
  assert.ok(res.calls.every((c) => ["icp", "accounts", "people", "enrich"].includes(c.module)));
  const e = res.results.get("enrich")!.out as EnrichOut;
  assert.ok(e.rows.length >= 2);
  assert.ok(e.rows.some((r) => r.status === "valid"));
  assert.equal(res.capStopped, false);
});

test("pipeline: cap stop keeps partial output, later modules are capped and nothing passes the cap", async () => {
  // Every answer costs a cent here, so the 10 cent cap binds partway through.
  const cap = 0.1;
  const pricey: Script = (job, input) => ({ ...happy(job, input), charged: 0.01 });
  const { res } = await pipeline(pricey, cap);
  // A module can stop on its own share of the cap (scope module) or the whole run can stop (scope run).
  const statuses = ["icp", "accounts", "people", "enrich"].map((id) => res.results.get(id)!.status);
  assert.ok(statuses.includes("capped"), statuses.join(","));
  const charged = res.calls.reduce((n, c) => n + c.charged, 0);
  assert.ok(charged <= cap);
  for (const id of ["icp", "accounts", "enrich"]) {
    const r = res.results.get(id)!;
    if (r.status !== "capped") continue;
    const s = MODS.find((m) => m.id === id)!.render(r.out, r.status, { public: false })!;
    assert.match(text(s), /cap/);
  }
  // The first capped module kept what it found before the stop.
  const firstCapped = ["icp", "accounts", "people", "enrich"].find((id) => res.results.get(id)!.status === "capped")!;
  const partial = res.results.get(firstCapped)!.out as any;
  assert.ok(partial && (partial.rows ?? partial.lookalikes ?? partial.card), `partial output kept for ${firstCapped}`);
});

test("worst-case ceilings: a module that would pass its share stops before the call, not after", async () => {
  const { res, q } = await pipeline(happy, 0.05);
  const worstPerCall = Math.max(...q.rows.flatMap((r) => r.lines.map((l) => l.capPerCall)));
  assert.ok(res.calls.reduce((n, c) => n + c.charged, 0) <= 0.05);
  assert.ok(worstPerCall > 0);
  assert.equal(res.capStopped || [...res.results.values()].some((r) => r.status === "capped"), true);
});

// ------------------------------------------------------------------ demo

test("demo mode renders the placeholder fixtures for sections 01, 02 and 03 without a call", async () => {
  const noCalls: JobRunner = { call: async () => { throw new Error("demo makes no calls"); } };
  const sections = [];
  for (const m of MODS.slice(1)) {
    const r = await m.run(ctxFor({}, noCalls, "demo"));
    assert.equal(r.status, "done");
    const s = m.render(r.out, r.status, { public: false });
    if (s) sections.push(s);
  }
  assert.deepEqual(sections.map((s) => s.num), ["01", "02", "03"]);
  assert.ok(sections.every((s) => /PLACEHOLDER/.test(s.source)));
});

test("provider trail falls back to the ledger line when looot returns no attempts", () => {
  const record = { module: "enrich", job: "people.email.find", provider: "kittai", outcome: "fail" as const, quoted: 0, charged: 0, ms: 1, ts: "", note: "provider_error (provider)" };
  assert.equal(trailOf({ record, run: { runId: "x", status: "failed" }, data: null }), "kittai fail (provider_error (provider))");
});

test("enrich at the cap: finished rows keep their result, the rest say not checked, the partial renders", async () => {
  const ppl = { rows: ["a", "b", "c", "d", "e", "f"].map((x) => ({ account: x.toUpperCase(), domain: `${x}.example`, grade: "A", name: `${x.toUpperCase()}nn Person`, firstName: `${x.toUpperCase()}nn`, lastName: "Person", title: "VP Sales", linkedin: "", email: "", masked: false, provider: "p", date: "" })) };
  const { runner } = mockRunner(happy);
  let n = 0;
  let partial: any = null;
  const base = ctxFor({ people: ppl }, runner);
  const ctx: ModuleContext = {
    ...base,
    partial: (o) => { partial = o; },
    call: async (job, input, step) => {
      if (++n > 5) throw new CapReached("enrich", "run", "cap reached: 0.0500 spent of 0.05");
      return base.call(job, input, step);
    },
  };
  await assert.rejects(enrich.run(ctx), CapReached);
  const rows = partial.rows as EnrichOut["rows"];
  assert.ok(rows.filter((r) => r.status === "valid").length >= 1);
  assert.ok(rows.some((r) => r.status === "not checked"));
  assert.ok(rows.every((r) => r.status !== "miss"));
  const s = text(enrich.render(partial, "capped", { public: false }));
  assert.match(s, /stopped at the cap during this module/);
  assert.match(s, /not checked, cap reached/);
});

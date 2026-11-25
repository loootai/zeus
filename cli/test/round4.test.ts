// Round 4: accounts that are buyers for the use case (never rivals, no holding group subsidiaries, no row
// without a country), the Google idempotency conflict and the Meta fallback, ad images retried and kept,
// social pages found by a web search with a 180 day rule, new spend and replayed calls apart, SEO gaps
// by intent and the committee kept to buying titles. Offline, mocks only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AD_MAX_BYTES, fetchImageRetry } from "../src/assets.js";
import { type CallResult, conflictKey, idempotencyKey, type JobRunner, LoootClient, toRecord } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { receiptSection } from "../src/dossier/index.js";
import { accounts, criteriaFrom, holdingOf, nameFitsDomain, outOfIcp, scoreAccount, searchInputs, sellsSameProduct, useCaseFit } from "../src/modules/accounts.js";
import { ads } from "../src/modules/ads.js";
import { buyingTitle, pickCommittee, type Candidate } from "../src/modules/committee.js";
import type { Company } from "../src/modules/icp.js";
import { linksIn, social } from "../src/modules/social.js";
import { keywordIntent, relevantKeyword } from "../src/modules/target.js";
import type { ModuleContext } from "../src/modules/types.js";
import { buildReceipt, receiptMarkdown } from "../src/receipt.js";

const TERMS = ["linkedin", "post", "ghostwriter", "hook", "carousel", "creator", "founder", "content", "viral", "calendar", "schedule", "engagement"];
const USE = ["linkedin content", "ghostwriting", "personal branding", "b2b social", "founder-led marketing"];

const co = (domain: string, name: string, industries: string[], employees: number | null, country: string | null, description = "", keywords: string[] = []): Company => ({ domain, name, industries, employees, country, technologies: [], keywords, description });

const rec = (opts: { module: string }, job: string, hit: boolean, charged = 0.001) => ({ module: opts.module, job, provider: "mock", outcome: hit ? ("hit" as const) : ("miss" as const), quoted: 0, charged, ms: 1, ts: new Date().toISOString() });
const ctxFor = (cfg: ReturnType<typeof normalizeConfig>, runner: JobRunner, module: string, outputs: Record<string, unknown> = {}): ModuleContext => ({ cfg, mode: "live", outputs, outDir: "", partial: () => {}, log: () => {}, call: (job, input, step) => runner.call(job, input, { module, step, maxCostUsd: 0.01, quotedUsd: 0.001 }) });

// ---- 1. accounts: buyers for the use case, never rivals ------------------------------------------------

test("accounts: the use case words on an account's own profile lift its score, a generic agency drops a grade", () => {
  const c = { industries: ["marketing services", "advertising services"], band: [2, 50] as [number, number], countries: ["United States"], stack: [], useCaseTerms: USE, categoryTerms: TERMS };
  const fit = co("thebetterpost.com", "The Better Post", ["advertising services"], 8, "US", "We build influence on LinkedIn for B2B founders.", ["linkedin content", "ghostwriting", "social media management"]);
  const generic = co("camginc.com", "Consumer Attorney Marketing Group", ["marketing services"], 30, "US", "Marketing for law firms.", ["legal marketing", "seo"]);
  const a = scoreAccount({ company: fit, similarity: null, searchRank: 1 }, c);
  const b = scoreAccount({ company: generic, similarity: null, searchRank: 1 }, c);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  assert.equal(a.grade, "A");
  assert.notEqual(b.grade, "A");
  assert.match(a.reasons, /says linkedin content, ghostwriting/);
  assert.deepEqual(useCaseFit("", USE), { f: null, hits: [] });
  assert.equal(useCaseFit("Branding that feels personal, for founders", USE).f, 0.25);
});

test("accounts: an account that sells the same kind of product is a rival and is dropped, an agency doing the work stays", () => {
  const toolSite = "Title: PostPilot | AI LinkedIn post generator\nWrite viral LinkedIn posts with hooks and carousels. Content calendar, schedule posts. Start free trial, no credit card. $29/month. Sign up. Chrome extension for creators and founders.";
  const agencySite = "Title: Sculpt\nWe are a B2B social media agency. Our services: LinkedIn content and ghostwriting for founders. Book a call. Our clients see engagement grow. Case studies.";
  assert.equal(sellsSameProduct(co("postpilot.io", "PostPilot", ["software development"], 10, "US"), toolSite, TERMS), true);
  assert.equal(sellsSameProduct(co("sculpt.com", "Sculpt", ["advertising services"], 20, "GB"), agencySite, TERMS), false);
  // Without a page, the profile decides: a tool for LinkedIn posts is a rival, an agency is not.
  assert.equal(sellsSameProduct(co("imagine.example", "Imagine AI", ["software development"], 10, "US", "AI app that writes your LinkedIn posts and content", ["ai", "linkedin", "ghostwriting"]), "", TERMS), true);
  assert.equal(sellsSameProduct(co("nomiddle.com", "No Middle", ["software development"], 10, "US", "A creative agency for LinkedIn content", ["content"]), "", TERMS), false);
});

test("accounts: holding group subsidiaries, website builder domains and rows with no country are dropped", () => {
  const c = { industries: ["advertising services", "marketing services"], band: [2, 50] as [number, number], countries: ["United States", "United Kingdom"], stack: [] };
  assert.match(outOfIcp(co("republicahavas.com", "Republica Havas", ["advertising services"], 6, "US"), c)!, /Havas group/);
  assert.equal(holdingOf(co("ogilvy-social.example", "Ogilvy Social Lab", [], 20, "US")), "WPP");
  assert.equal(holdingOf(co("tiny.example", "Tiny", [], 5, "US", "Part of the Publicis network since 2019")), "Publicis");
  assert.equal(holdingOf(co("greyhound-media.example", "Greyhound Media", [], 5, "US")), null);
  assert.match(outOfIcp(co("clickfunnels.com", "LSC Agency", ["advertising services"], 5, "US"), c)!, /website builder/);
  assert.match(outOfIcp(co("avelana.ru", "Avelana", ["advertising services"], 6, null), c)!, /no country/);
  // Before enrich a missing country is not held against the row yet.
  assert.equal(outOfIcp(co("avelana.ru", "Avelana", ["advertising services"], 6, null), c, [], true), null);
  assert.equal(outOfIcp(co("sculpt.com", "Sculpt", ["advertising services"], 20, "GB"), c), null);
  // A name joined to someone else's site is dropped. Real names on their own domains stay.
  assert.match(outOfIcp(co("patentbusinesslawyer.com", "Dev Academy by Dr. Rahul Dev", ["business consulting and services"], 29, "US"), c)!, /does not match the company name/);
  for (const [n, d] of [["MAVERRIK® - Social Selling Training", "maverrik.io"], ["JSMedia - Jasmine Sandler Media", "jasminesandlerdigitalmarketingmedia.com"], ["StraightIn", "straight-in.co"], ["100 Pound Social", "100poundsocial.com"], ["Sculpt - B2B Social Media Agency", "wearesculpt.com"]]) assert.equal(nameFitsDomain(n, d), true, n);
});

test("accounts: the search asks AI Ark for the use case phrases first, then the industries", () => {
  const cfg = normalizeConfig({ domain: "acmeposts.ai", icp: { industries: ["advertising services"], sizeBand: "2-50", geos: ["United States", "United Kingdom"], useCaseTerms: ["LinkedIn content", "ghostwriting"] } });
  assert.deepEqual(cfg.icp.useCaseTerms, ["linkedin content", "ghostwriting"]);
  const crit = criteriaFrom(cfg, null);
  const ins = searchInputs(cfg, crit, 6) as any[];
  assert.deepEqual(ins.slice(0, 4).map((i) => [i.account.productAndServices.any.include.content[0], i.account.location.any.include[0]]), [["linkedin content", "United States"], ["linkedin content", "United Kingdom"], ["ghostwriting", "United States"], ["ghostwriting", "United Kingdom"]]);
  assert.equal(ins[0].account.productAndServices.any.include.mode, "SMART");
  assert.ok(ins[4].account.industries, "the industry searches follow");
  const q = accounts.quote(cfg);
  assert.deepEqual(q.lines.map((l) => [l.job, l.calls]), [["company.search.filtered", 7], ["company.enrich", 25], ["web.scrape.markdown", 25]]); // 6 plus one wider search when all are empty
});

test("accounts: a full run keeps the LinkedIn content agency and drops the rival tool, the Havas shop and the row with no country", async () => {
  const cfg = normalizeConfig({ domain: "acmeposts.ai", brand: "AcmePosts", competitors: ["taplio.com"], categoryTerms: TERMS, discovery: { by: "agent", at: "2026-11-03" }, icp: { industries: ["advertising services", "marketing services"], sizeBand: "2-50", geos: ["United States"], useCaseTerms: USE }, limits: { accounts: 10 } });
  const row = (domain: string, name: string, staff: number, desc: string, kw: string[], country: string | null) => ({ link: { domain }, summary: { name, description: desc, staff: { total: staff } }, industries: ["advertising services"], keywords: kw, ...(country ? { location: { headquarter: { country } } } : {}) });
  const search = { content: [
    row("thebetterpost.com", "The Better Post", 8, "We build influence on LinkedIn for B2B founders, an agency.", ["linkedin content", "ghostwriting"], "United States"),
    row("postpilot.io", "PostPilot", 10, "Write LinkedIn posts with AI.", ["linkedin", "post"], "United States"),
    row("republicahavas.com", "Republica Havas", 6, "Agency.", ["advertising"], "United States"),
    row("avelana.ru", "Avelana", 6, "Marketing agency.", ["marketing"], null),
    row("camginc.com", "CAMG", 30, "Marketing for law firms.", ["legal marketing"], "United States"),
  ] };
  const sites: Record<string, string> = {
    "https://postpilot.io/": "Title: PostPilot\nAI LinkedIn post generator for founders and creators. Hooks, carousels, content calendar, schedule. Start free trial, no credit card, $19/month, sign up, chrome extension. Viral engagement.",
    "https://thebetterpost.com/": "Title: The Better Post\nLinkedIn content agency. Our services: ghostwriting and personal branding for founders. Book a call.",
  };
  const sent: { job: string; input: any }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push({ job, input });
      if (job.startsWith("company.search")) return { record: rec(opts, job, true), run: { runId: "r", status: "completed", outcome: "hit" }, data: search };
      if (job === "web.scrape.markdown") {
        const md = sites[String(input.url)] ?? "";
        return { record: rec(opts, job, !!md), run: { runId: "r", status: "completed", outcome: md ? "hit" : "miss" }, data: { markdown: md } };
      }
      return { record: rec(opts, job, false), run: { runId: "r", status: "completed", outcome: "miss" }, data: {} };
    },
  };
  const r = await accounts.run(ctxFor(cfg, runner, "accounts", { icp: null }));
  const out = r.out as any;
  const kept = out.rows.map((x: any) => x.domain);
  assert.ok(kept.includes("thebetterpost.com"), kept.join(","));
  for (const d of ["postpilot.io", "republicahavas.com", "avelana.ru"]) assert.ok(!kept.includes(d), d);
  assert.equal(out.rows[0].domain, "thebetterpost.com");
  const why = Object.fromEntries(out.dropped.map((d: any) => [d.reason, d.count]));
  assert.equal(why["sells the same kind of product, a rival"], 1);
  assert.equal(why["part of a holding group"], 1);
  assert.equal(why["no country returned"], 1);
  assert.ok(sent.some((s) => s.job === "company.search.filtered" && s.input.account?.productAndServices));
});

// ---- 2. Google conflict, Meta fallback, ad images --------------------------------------------------------

test("client: an idempotency conflict gets one retry with a key that carries the endpoint and the ceiling", async () => {
  const keys: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    keys.push(body.idempotencyKey);
    if (keys.length === 1) return new Response(JSON.stringify({ error: { code: "idempotency_conflict", message: "key used with another request" } }), { status: 409 });
    return new Response(JSON.stringify({ runId: "r2", status: "completed", outcome: "hit", actualCost: 0.00188, result: { ads: [] } }), { status: 200 });
  };
  const c = new LoootClient({ token: "t", fetch: fake, sleep: async () => {}, baseUrl: "https://api.test" });
  const r = await c.call("google.company.ads", { domain: "taplio.com" }, { module: "ads", step: "google:taplio.com", maxCostUsd: 0.01, quotedUsd: 0.00188 });
  assert.equal(r.record.outcome, "hit");
  assert.deepEqual(keys, [idempotencyKey("ads", "google:taplio.com", { domain: "taplio.com" }), conflictKey("ads", "google:taplio.com", { domain: "taplio.com" }, "google.company.ads", 0.01)]);
  assert.notEqual(keys[0], keys[1]);
});

test("ads: the Meta company page fails, a keyword search on the profile name runs and keeps only that brand's ads", async () => {
  const cfg = normalizeConfig({ domain: "acmeposts.ai", brand: "AcmePosts", competitors: ["contentin.io"], profiles: { "contentin.io": { name: "ContentIn", facebook: "contentinapp" } } });
  const sent: { job: string; input: any; step: string }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push({ job, input, step: opts.step });
      if (job === "ads.meta.search" && "companyName" in input) return { record: { ...rec(opts, job, false), outcome: "fail", note: "timeout (provider)" }, run: { runId: "", status: "failed" }, data: null };
      if (job === "ads.meta.search" && input.query === "ContentIn") return { record: rec(opts, job, true), run: { runId: "r", status: "completed", outcome: "hit" }, data: { results: [{ ad_archive_id: "1", page_name: "ContentIn", snapshot: { body: { text: "Write LinkedIn posts in your voice. Free trial." }, link_url: "https://contentin.io/" } }, { ad_archive_id: "2", page_name: "Content Inc Plumbing", snapshot: { body: { text: "Pipes" }, link_url: "https://plumb.example/" } }] } };
      return { record: rec(opts, job, false), run: { runId: "r", status: "completed", outcome: "miss" }, data: {} };
    },
  };
  const r = await ads.run(ctxFor(cfg, runner, "ads"));
  const ci = (r.out as any).advertisers.find((a: any) => a.domain === "contentin.io");
  assert.equal(ci.name, "ContentIn");
  assert.equal(ci.meta, 1);
  assert.match(ci.lookups, /meta keyword search hit/);
  assert.ok(sent.some((s) => s.step === "meta-kw:contentin.io"));
});

test("ad images: a large signed creative is kept and a failed download is tried once more", async () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700_000, 1)]);
  let n = 0;
  const flaky = (async () => {
    n++;
    if (n === 1) throw new Error("socket hang up");
    return new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as unknown as typeof fetch;
  const img = await fetchImageRetry("https://scontent.example/x.jpg", flaky, AD_MAX_BYTES);
  assert.ok(img && img.bytes.length > 400_000);
  assert.equal(n, 2);
});

// ---- 3. social pages found by a web search, 180 day rule -----------------------------------------------

test("social: links in a web search answer keep the ones named like the brand", () => {
  const raw = { results: [{ link: "https://x.com/aakashgupta/status/1" }, { link: "https://x.com/TaplioHQ" }, { snippet: "see twitter.com/intent/tweet" }] };
  assert.deepEqual(linksIn(raw, "x", "Taplio", "taplio.com"), ["TaplioHQ"]);
  assert.deepEqual(linksIn({ r: "https://www.linkedin.com/company/taplio/ and https://www.linkedin.com/company/other-co" }, "linkedin", "Taplio", "taplio.com"), ["taplio"]);
});

test("social: a stale account is not used, the web search finds the live page and handle", async () => {
  const now = Date.now();
  const day = (ago: number) => new Date(now - ago * 86_400_000).toISOString();
  const sent: { job: string; input: any }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push({ job, input });
      const ok = (data: unknown) => ({ record: rec(opts, job, true), run: { runId: "r", status: "completed" as const, outcome: "hit" }, data });
      if (job === "google.serp.organic" && String(input.query).startsWith("site:linkedin.com/company")) return ok({ results: [{ link: "https://www.linkedin.com/company/taplio-app" }] });
      if (job === "google.serp.organic") return ok({ results: [{ link: "https://x.com/TaplioHQ" }] });
      if (job === "linkedin.company.posts" && String(input.url ?? input.company).includes("taplio-app")) return ok({ posts: [{ text: "Introducing carousels", url: "https://www.linkedin.com/posts/1", datePublished: day(3) }] });
      if (job === "x.post.search" && input.query === "from:taplio") return ok({ output: { data: { items: [{ id: "9", text: "old", authorUsername: "taplio", createdUtc: String(Math.floor((now - 900 * 86_400_000) / 1000)) }] } } });
      if (job === "x.post.search" && input.query === "from:TaplioHQ") return ok({ output: { data: { items: [{ id: "10", text: "new post", authorUsername: "TaplioHQ", createdUtc: String(Math.floor((now - 5 * 86_400_000) / 1000)) }] } } });
      return { record: rec(opts, job, false), run: { runId: "r", status: "completed", outcome: "miss" }, data: {} };
    },
  };
  const cfg = normalizeConfig({ domain: "acmeposts.ai", brand: "AcmePosts", competitors: ["taplio.com"], profiles: { "taplio.com": { name: "Taplio", linkedin: "https://www.linkedin.com/company/taplio" } } });
  const r = await social.run(ctxFor(cfg, runner, "social"));
  const t = (r.out as any).brands.find((b: any) => b.domain === "taplio.com");
  assert.equal(t.linkedinUrl, "https://www.linkedin.com/company/taplio-app");
  assert.equal(t.handle, "TaplioHQ");
  assert.equal(t.posts.length, 2);
  assert.match(t.lookups, /X @taplio last posted \d{4}-\d{2}-\d{2}, older than 180 days, not used/);
  assert.ok(sent.some((s) => s.job === "google.serp.organic" && s.input.query === "site:linkedin.com/company Taplio"));
});

// ---- 4. new spend and replayed calls apart -----------------------------------------------------------------

test("cost: a replayed call costs nothing new, the summary shows new spend and replayed calls apart", () => {
  const opts = { module: "ads", step: "s", maxCostUsd: 0.01, quotedUsd: 0.002 };
  const ts = "2026-11-03T10:00:00.000Z";
  const fresh = toRecord({ runId: "a", status: "completed", outcome: "hit", actualCost: 0.002 }, "ads.linkedin.search", opts, 5, ts);
  const replay = toRecord({ runId: "b", status: "completed", outcome: "hit", actualCost: 0.0049, replayed: true }, "company.enrich", opts, 5, ts);
  assert.equal(replay.charged, 0);
  assert.equal(replay.firstCharged, 0.0049);
  const quote = { rows: [{ module: "ads", expected: 0.01, worst: 0.02, lines: [] }], expected: 0.01, worst: 0.02, priceSource: "test" } as any;
  const r = buildReceipt({ domain: "x.example", mode: "live", cap: 3, quote, labels: { ads: "Ads" }, results: new Map([["ads", { status: "done", summary: "ok", out: null }]]), timings: new Map(), calls: [fresh, replay], startedAt: new Date(ts), finishedAt: new Date(ts), capStopped: false });
  assert.equal(r.run.charged, 0.002);
  assert.equal(r.run.replayedCalls, 1);
  assert.equal(r.run.replayedValue, 0.0049);
  const md = receiptMarkdown(r);
  assert.match(md, /\| New spend \| \$0\.002/);
  assert.match(md, /\| Replayed free \| 1 calls/);
  const stat = receiptSection(r).blocks[0] as any;
  assert.deepEqual(stat.items.map((i: any) => i.label).slice(2, 5), ["New spend", "Paid calls", "Replayed free"]);
  assert.equal(stat.items.find((i: any) => i.label === "Paid calls").value, "1");
});

// ---- 5. SEO gaps by intent ---------------------------------------------------------------------------------

test("seo: how-to and definition searches go unless they name the category, buyers' searches come first", () => {
  assert.equal(relevantKeyword("what are impressions on linkedin", TERMS), false);
  assert.equal(relevantKeyword("how to cancel linkedin premium", TERMS), false);
  assert.equal(relevantKeyword("linkedin post job", TERMS), false);
  assert.equal(relevantKeyword("what is a linkedin post generator", TERMS), true);
  assert.equal(relevantKeyword("linkedin carousel maker", TERMS), true);
  assert.equal(relevantKeyword("taplio alternatives", TERMS, ["taplio"]), true);
  assert.equal(keywordIntent("supergrow vs taplio"), "comparison");
  assert.equal(keywordIntent("linkedin post scheduler"), "commercial");
  assert.equal(keywordIntent("how to write a linkedin post"), "informational");
  assert.equal(keywordIntent("best time to post on linkedin"), "informational");
});

// ---- 6. committee kept to buying titles --------------------------------------------------------------------

test("committee: only buying titles for the ICP, odd titles are dropped", () => {
  const titles = ["Founder", "CEO", "Agency Owner", "Head of Marketing", "Content Lead", "Head of Growth", "Partnerships Lead"];
  for (const t of ["Founder & CEO", "Managing Director", "Head of Marketing", "Content Strategist", "Growth Lead", "Head of Partnerships", "Agency Owner"]) assert.equal(buyingTitle(t, titles), true, t);
  for (const t of ["Marine Engineer", "Software Engineer", "Office Assistant", "Marketing Intern", "Accountant", "", "Customer Success Manager at 100 Pound Social", "Vice President Emea & Latam"]) assert.equal(buyingTitle(t, titles), false, t);
  const cand = (name: string, title: string): Candidate => ({ name, firstName: name, lastName: "", title, linkedin: "", email: "", emailStatus: "", phone: "", masked: false });
  const picked = pickCommittee([cand("Ann", "Marine Engineer"), cand("Bo", "Founder"), cand("Cy", "Head of Marketing"), cand("Di", "Receptionist"), cand("Ed", "Content Manager")], 4, titles);
  assert.deepEqual(picked.map((p) => p.c.name).sort(), ["Bo", "Cy", "Ed"]);
});

// ---- 7. committee emails stay with the person they were found for ------------------------------------------

test("committee emails: ben@ on Mira Sanders and an email on harborplc.example at Northwind are dropped, one email never on two people", async () => {
  const { emailMismatch, cleanCommitteeEmails, committeeBlocks } = await import("../src/modules/committee.js");
  assert.match(emailMismatch("ben@northwind.example", { name: "Mira Sanders" }, "northwind.example")!, /someone else/);
  assert.equal(emailMismatch("ben@northwind.example", { name: "Ben Lakeman" }, "northwind.example"), null);
  assert.match(emailMismatch("zavery@harborplc.example", { name: "Zane Avery" }, "northwind.example")!, /harborplc\.example is not northwind\.example/);
  assert.match(emailMismatch("victorbellamy@gmail.com", { name: "Victor Bellamy" }, "fernway.example")!, /gmail\.com/);
  assert.match(emailMismatch("info@northwind.example", { name: "Hazel Kerr" }, "northwind.example")!, /shared inbox/);
  assert.equal(emailMismatch("toby.hartley@willowmedia.example", { name: "Toby Hartley" }, "willowmedia.agency"), null);
  assert.equal(emailMismatch("zh@tidepool.example", { name: "Zed Hanley" }, "tidepool.co"), null);
  assert.match(emailMismatch("jade@jadesutter.example", { name: "Jade Sutter" }, "jadesutterdigitalmarketingmedia.example")!, /is not/);
  for (const [e, n] of [["Dale@fernway.example", "Dale Sedgwick"], ["j.smith@fernway.example", "John Smith"], ["jsmith@fernway.example", "John Smith"], ["johns@fernway.example", "John Smith"]]) assert.equal(emailMismatch(e, { name: n }, "fernway.example"), null, e);
  const m = (name: string, email: string) => ({ role: "Influencer", name, title: "x", email, emailStatus: email ? "found" : "not looked up", linkedin: "", phone: "", phoneStatus: "not looked up" });
  const accounts = [{ account: "Northwind Digital", domain: "northwind.example", grade: "A", score: 88, provider: "p", members: [m("Hazel Kerr", "hazel@northwind.example"), m("Zane Avery", "zavery@harborplc.example"), m("Mira Sanders", "ben@northwind.example"), m("Ben Lakeman", "ben@northwind.example")] }];
  // The same address on two people who both fit it: only the first keeps it.
  const twins = [{ account: "A", domain: "a.example", grade: "A", score: 80, provider: "p", members: [m("Ann Lee", "ann@a.example"), m("Ann Lee-Ross", "ann@a.example")] }];
  assert.equal(cleanCommitteeEmails(accounts as any), 2);
  assert.deepEqual(accounts[0].members.map((x) => [x.name, x.email, x.emailStatus]), [["Hazel Kerr", "hazel@northwind.example", "found"], ["Zane Avery", "", "not found"], ["Mira Sanders", "", "not found"], ["Ben Lakeman", "ben@northwind.example", "found"]]);
  assert.equal(cleanCommitteeEmails(twins as any), 1);
  assert.deepEqual(twins[0].members.map((x) => x.email), ["ann@a.example", ""]);
  const dup = [{ account: "C", domain: "c.example", grade: "B", score: 65, provider: "p", members: [m("Lucy Barton", "lucy@c.example"), m("Susan Dickie", ""), m("Lucy Barton", "")] }];
  cleanCommitteeEmails(dup as any);
  assert.deepEqual(dup[0].members.map((x) => x.name), ["Lucy Barton", "Susan Dickie"]);
  const blocks = committeeBlocks({ summary: "", accounts: accounts as any, emailsDropped: 2 });
  assert.ok(blocks.some((b: any) => b.kind === "note" && /2 emails were taken off/.test(b.text)));
});

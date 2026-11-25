// Round 2 (3 Nov 2026): buying committees, the ad gallery, social listening, `looot-zeus more`,
// the nav order, the "How much this cost" label, the weekly sweep panel and public masking.
// Offline, mocks and fixtures only.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallResult, JobRunner } from "../src/client.js";
import { cmdMore, type Args } from "../src/commands.js";
import { normalizeConfig } from "../src/config.js";
import { adGallery, adVisuals, parseAds, type AdsOut } from "../src/modules/ads.js";
import { committee, pickCommittee, rolesOf, type Candidate, type CommitteeOut } from "../src/modules/committee.js";
import { loadFixture } from "../src/modules/fixture.js";
import { parseLinkedinPosts, parseXPosts, social, socialBlocks, topicsOf, type SocialOut } from "../src/modules/social.js";
import { mergeOut, moreQuote, readState } from "../src/more.js";
import { buildQuote, loadPriceBook } from "../src/quote.js";
import { validateReceipt, type Receipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function demo(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-r2-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), ...extra], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
}

const cand = (name: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({ name, firstName: name.split(" ")[0], lastName: name.split(" ")[1] ?? "", title, linkedin: `https://www.linkedin.com/in/${name.toLowerCase().replace(/ /g, "-")}`, email: "", emailStatus: "", phone: "", masked: false, ...extra });

// ---- committee ------------------------------------------------------------------------------------

test("committee: title rules give each role, one person per role, filled to the size", () => {
  assert.deepEqual(rolesOf("CEO"), ["Economic buyer"]);
  assert.ok(rolesOf("Head of Revenue Operations").includes("Technical or ops lead"));
  assert.ok(rolesOf("Director of Sales").includes("Champion"));
  assert.deepEqual(rolesOf("Sales Manager"), ["User lead"]);
  const picked = pickCommittee([cand("Ann One", "Sales Manager"), cand("Bob Two", "Founder"), cand("Cy Three", "RevOps Manager"), cand("Di Four", "Head of Sales", { email: "di@x.example" }), cand("Ed Five", "Account Executive"), cand("F. G.", "VP Sales", { masked: true })], 4, ["Head of Sales"]);
  assert.deepEqual(picked.map((p) => [p.role, p.c.name]), [["Economic buyer", "Bob Two"], ["Champion", "Di Four"], ["Technical or ops lead", "Cy Three"], ["User lead", "Ann One"]]);
  // A masked name is never picked.
  assert.ok(!picked.some((p) => p.c.masked));
});

test("committee: quoted per account, reuses known emails, looks up the rest and says found or not found", async () => {
  const cfg = normalizeConfig({ people: true, committeePhones: true, domain: "acme.example", icp: { titles: ["Head of Sales"] }, limits: { committeeAccounts: 2 } });
  const q = buildQuote([committee], cfg, await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  const lines = q.rows[0].lines.map((l) => [l.job, l.calls]);
  // Phones: step 1 for all 8 people, step 2 for the first two per committee, the company line from 2 pages per account.
  assert.deepEqual(lines, [["people.search", 2], ["people.email.find", 4], ["people.phone.find", 8], ["people.phone.find.mobile", 4], ["web.scrape.markdown", 4]]);
  const accounts = { rows: [{ domain: "a.example", name: "A Co", grade: "A", score: 90 }, { domain: "b.example", name: "B Co", grade: "B", score: 70 }, { domain: "c.example", name: "C Co", grade: "C", score: 50 }] };
  const enrich = { rows: [{ domain: "a.example", account: "A Co", name: "Di Four", title: "Head of Sales", linkedin: "https://www.linkedin.com/in/di-four", email: "di@a.example", status: "valid", phone: "" }] };
  const calls: { job: string; input: Record<string, unknown> }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      calls.push({ job, input });
      let data: unknown = {};
      if (job === "people.search") data = { results: [{ full_name: "Bob Two", title: "CEO", linkedin_url: "https://www.linkedin.com/in/bob-two" }, { full_name: "Cy Three", title: "Sales Ops Lead", linkedin_url: "https://www.linkedin.com/in/cy-three" }, { full_name: "Ann One", title: "Sales Manager", linkedin_url: "https://www.linkedin.com/in/ann-one" }] };
      if (job === "people.email.find" && String(input.linkedin_url).includes("bob")) data = { email: "bob@a.example" };
      if (job === "people.phone.find" && String(input.linkedin_url).includes("cy")) data = { phone: "+1 646 555 0100" };
      const hit = Object.keys(data as object).length > 0;
      return { record: { module: opts.module, job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: opts.quotedUsd, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed", outcome: hit ? "hit" : "miss" }, data };
    },
  };
  const ctxOut = await committee.run({ cfg, mode: "live", outputs: { accounts, enrich, people: { rows: [] } }, outDir: "", partial: () => {}, log: () => {}, call: (job, input, step) => runner.call(job, input, { module: "committee", step, maxCostUsd: 0.1, quotedUsd: 0.001 }) });
  const out = ctxOut.out as CommitteeOut;
  assert.deepEqual(out.accounts.map((a) => a.domain), ["a.example", "b.example"]);
  const a = out.accounts[0];
  assert.equal(a.members.length, 4);
  const di = a.members.find((m) => m.name === "Di Four")!;
  assert.equal(di.emailStatus, "verified");
  assert.equal(a.members.find((m) => m.name === "Bob Two")!.emailStatus, "found");
  assert.equal(a.members.find((m) => m.name === "Cy Three")!.phone, "+16465550100");
  assert.equal(a.members.find((m) => m.name === "Cy Three")!.phoneType, "Mobile");
  assert.ok(a.members.some((m) => m.phoneStatus === "not found"));
  // Di's email was known, so no email lookup was made for Di.
  assert.ok(!calls.some((c) => c.job === "people.email.find" && String(c.input.linkedin_url).includes("di-four")));
  // Email lookups never pass the quoted budget.
  assert.ok(calls.filter((c) => c.job === "people.email.find").length <= 4);
  assert.match(out.summary, /people across 2 buying committees/);
});

// ---- ads --------------------------------------------------------------------------------------------

test("ads: the creatives are kept with landing page, image and button, and render as a gallery", () => {
  const raw = { results: [{ ad_archive_id: "123", page_name: "Rival A", snapshot: { title: "Switch in a day", body: { text: "Free migration, book a demo" }, link_url: "https://rival-a.com/switch", cta_text: "Book a demo", images: [{ original_image_url: "https://cdn.example/ad.jpg" }] }, start_date: 1761955200 }] };
  const ads = parseAds(raw, "meta", "ScrapeCreators");
  assert.equal(ads.length, 1);
  assert.equal(ads[0].landing, "https://rival-a.com/switch");
  assert.equal(ads[0].image, "https://cdn.example/ad.jpg");
  assert.equal(ads[0].cta, "Book a demo");
  const f = loadFixture<AdsOut>("ads");
  const gallery = adGallery(f);
  assert.equal(gallery.length, f.advertisers.length);
  const rivalA = gallery[1];
  assert.ok(rivalA.kind === "cards" && rivalA.items.length === 5 && rivalA.items[0].links!.length === 2);
  const vis = adVisuals(f);
  assert.ok(vis[0].kind === "bars" && vis[0].items.every((b) => Array.isArray(b.parts) && b.parts.length === 3));
});

// ---- social -------------------------------------------------------------------------------------------

test("social: LinkedIn and X posts parse with links, engagement and topics, quoted per brand", async () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const li = parseLinkedinPosts({ posts: [{ text: "Introducing our AI agent. Join the webinar.", url: "https://www.linkedin.com/feed/update/1", datePublished: "2026-10-30T10:00:00Z", stats: { total_reactions: 40, comments: 3 } }] }, now, "ScrapeCreators");
  assert.equal(li[0].likes, 40);
  assert.deepEqual(li[0].topics, ["Product news", "AI", "Event or webinar"]);
  const x = parseXPosts({ tweets: [{ text: "20% off this week", id: "9", author: { userName: "rivala" }, likeCount: 5 }] }, now, "AnyAPI");
  assert.equal(x[0].url, "https://x.com/rivala/status/9");
  assert.deepEqual(topicsOf("We're hiring two AEs"), ["Hiring and team"]);
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.com", "rival-b.com"] });
  const q = buildQuote([social], cfg, await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  assert.deepEqual(q.rows[0].lines.map((l) => [l.job, l.calls]), [["linkedin.company.posts", 6], ["x.post.search", 3], ["google.serp.organic", 3]]);
  const blocks = socialBlocks(loadFixture<SocialOut>("social"));
  assert.ok(blocks.some((b) => b.kind === "list" && /Topics your rivals post about and you do not yet/.test(b.items[0])));
  assert.ok(blocks.filter((b) => b.kind === "cards").length === 4);
});

// ---- the page -------------------------------------------------------------------------------------------

test("nav: the analysis views come first, then plays, brief and How much this cost", () => {
  const html = readFileSync(join(demo(), "dossier.html"), "utf8");
  const order = [...html.matchAll(/data-v="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["overview", "buyers", "rivals", "ads", "social", "seo", "reviews", "signals", "market", "readiness", "plays", "brief", "receipt"]);
  assert.ok(html.indexOf(">Analysis</h6>") < html.indexOf(">Next steps</h6>"));
});

test("label: no Receipt left in the dossier, it says How much this cost", () => {
  const out = demo();
  for (const f of ["dossier.html", "dossier.md"]) {
    const t = readFileSync(join(out, f), "utf8").replace(/receipt\.(json|md)/g, "").replace(/id="(s|v)-receipt"|data-v(iew)?="receipt"|href="#receipt"/g, "");
    assert.ok(!/receipt/i.test(t), `${f} still says receipt`);
    assert.match(t, /How much this cost/);
  }
});

test("page: committees, ad gallery, social, run more buttons and the weekly panel are on the demo", () => {
  const html = readFileSync(join(demo(), "dossier.html"), "utf8");
  assert.ok((html.match(/class="cc"/g) ?? []).length === 8, "8 committee cards");
  assert.match(html, /mailto:/);
  assert.match(html, /href="tel:/);
  assert.match(html, /class="crea /);
  assert.match(html, /Topics rivals post about/);
  for (const w of ["accounts --count 25", "committee --count 10", "ads<", "social<", "seo --count 10"]) assert.ok(html.includes(`npx looot-zeus more ${w}`), w);
  assert.match(html, /<dialog class="wk" id="weekly"/);
  assert.match(html, /npx looot-zeus watch --cap 10/);
  assert.match(html, /Leads to reach/);
  // Ad images load only from data-src when the view opens, nothing loads on first paint.
  assert.ok(!/<img[^>]+ src=/.test(html));
  assert.ok(!html.includes(", and "));
});

test("public: committee names, emails, phones and LinkedIn are masked, and export --public leaves none", () => {
  const out = demo(["--public"]);
  const html = readFileSync(join(out, "dossier.html"), "utf8");
  const md = readFileSync(join(out, "dossier.md"), "utf8");
  const f = loadFixture<CommitteeOut>("committee");
  for (const m of f.accounts.flatMap((a) => a.members)) {
    for (const t of [html, md]) {
      if (m.email) assert.ok(!t.includes(m.email), m.email);
      if (m.phone) assert.ok(!t.includes(m.phone), m.phone);
      assert.ok(!t.includes(m.linkedin), m.linkedin);
      assert.ok(!t.includes(`>${m.name}<`), m.name);
    }
  }
  assert.ok(!html.includes("mailto:") && !html.includes("tel:"));
  assert.ok(!html.includes("npx looot-zeus more"), "no run more buttons in a public copy");
  // export --public from a normal folder swaps every committee person too.
  const norm = demo();
  const msg = execFileSync(process.execPath, [cli, "export", "--public", "--out", norm], { env: { ...process.env, LOOOT_TOKEN: "" } }).toString();
  assert.match(msg, /0 left/);
  const pub = readFileSync(join(norm, "public", "dossier.html"), "utf8");
  for (const m of f.accounts.flatMap((a) => a.members)) if (m.email) assert.ok(!pub.includes(m.email), m.email);
});

// ---- more ------------------------------------------------------------------------------------------------

test("more: in a demo folder every pull adds placeholder rows for free and keeps the receipt valid", () => {
  const out = demo();
  const run = (...args: string[]) => execFileSync(process.execPath, [cli, "more", ...args, "--out", out], { env: { ...process.env, LOOOT_TOKEN: "" } }).toString();
  assert.match(run("accounts"), /5 new accounts, 5 new people/);
  assert.match(run("committee"), /1 new buying committee /);
  assert.match(run("ads"), /3 new ads/);
  assert.match(run("social"), /2 new posts/);
  assert.match(run("seo"), /3 more keywords checked/);
  assert.match(run("ads"), /no more placeholder rows/);
  const s = readState(out)!;
  assert.equal((s.results.accounts.out as { rows: unknown[] }).rows.length, 17);
  assert.equal(s.pages?.ads, 2);
  assert.equal(s.pulls?.length, 5);
  const r = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8")) as Receipt;
  assert.deepEqual(validateReceipt(r), []);
  assert.equal(r.calls.length, r.run.calls);
  const html = readFileSync(join(out, "dossier.html"), "utf8");
  assert.match(html, /Pulled later with looot-zeus more/);
  assert.ok((html.match(/class="cc"/g) ?? []).length === 9);
  assert.throws(() => execFileSync(process.execPath, [cli, "more", "everything", "--out", out], { stdio: "pipe" }));
});

test("more: live, it quotes first, needs a yes, runs only its modules and merges the rows", async () => {
  const out = demo();
  // Make the folder look like a live run.
  const statePath = join(out, "state.json");
  const s = JSON.parse(readFileSync(statePath, "utf8"));
  s.mode = "live";
  delete s.placeholder;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(statePath, JSON.stringify(s));
  const logs: string[] = [];
  const calls: string[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      calls.push(`${job} ${JSON.stringify(input)}`);
      const data = job === "ads.meta.search" ? { results: [{ ad_archive_id: `n${calls.length}`, page_name: String(input.companyName ?? input.query), title: "New angle, free trial", body: "Try free" }] } : {};
      const hit = job === "ads.meta.search";
      return { record: { module: opts.module, job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: opts.quotedUsd, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed", outcome: hit ? "hit" : "miss" }, data };
    },
  };
  // Without a terminal and without --yes nothing runs.
  await assert.rejects(cmdMore("ads", {} as Args, out, { client: () => runner, isTTY: false, log: (l) => logs.push(l) }), /nothing was spent/);
  assert.equal(calls.length, 0);
  assert.match(logs.join("\n"), /ads\.meta\.search/);
  const r = await cmdMore("ads", { yes: true, offline: true } as Args, out, { client: () => runner, isTTY: false, log: (l) => logs.push(l) });
  assert.ok(r);
  assert.ok(calls.every((c) => c.startsWith("ads.") || c.startsWith("google.company.ads")));
  assert.ok(calls.every((c) => c.includes('"page":2')), "asks for the next page");
  const after = readState(out)!;
  const advs = (after.results.ads.out as AdsOut).advertisers;
  assert.ok(advs.find((a) => a.name === "Rival A")!.ads.some((a) => a.headline === "New angle, free trial"));
  assert.deepEqual(validateReceipt(r!), []);
});

test("more: the quote for each pull and the merge keep what the folder had", async () => {
  const cfg = normalizeConfig(loadFixture("config").config);
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: true });
  const state = { schemaVersion: "1", mode: "live", cfg, modules: [], results: { accounts: { status: "done", summary: "", out: loadFixture("accounts") }, committee: { status: "done", summary: "", out: loadFixture("committee") }, seo: { status: "done", summary: "", out: loadFixture("seo") } } } as never;
  const acc = moreQuote("accounts", cfg, state, book, 10);
  assert.equal(acc.cfg.limits.accounts, 10);
  assert.ok((acc.cfg as unknown as { more: { skipDomains: string[] } }).more.skipDomains.includes("northwind-logistics.example"));
  assert.deepEqual(acc.q.rows.map((r) => r.module), ["accounts", "people", "enrich"]);
  const com = moreQuote("committee", cfg, state, book);
  assert.equal(com.cfg.limits.committeeAccounts, 1, "only Willow Digital is left");
  const seo = moreQuote("seo", cfg, state, book);
  assert.deepEqual(seo.cfg.keywords.length, 5);
  assert.deepEqual(seo.q.rows[0].lines.map((l) => l.job), ["keywords.domain.overview", "google.serp.organic"]);
  const merged = mergeOut("accounts", { rows: [{ domain: "a", score: 50, grade: "C" }] }, { rows: [{ domain: "a", score: 50, grade: "C" }, { domain: "b", score: 80, grade: "A" }] });
  assert.deepEqual(merged.rows.map((r: { domain: string }) => r.domain), ["b", "a"]);
});

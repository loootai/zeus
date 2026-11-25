// Round 3: target and rivals found from the site, the hard ICP filter, logos and ad creatives saved
// at run time, ads matched to their advertiser, social pages from the site with a second provider,
// SEO gaps kept to the category, and `prepare` for the agent step. Offline, mocks only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectAssets, loadLogos, logoData, logoHtml, setLogos, stripAssets } from "../src/assets.js";
import type { CallResult, JobRunner } from "../src/client.js";
import { cmdPrepare } from "../src/commands.js";
import { normalizeConfig } from "../src/config.js";
import { htmlToMarkdown } from "../src/direct.js";
import { outOfIcp, industryFit } from "../src/modules/accounts.js";
import { belongsTo, parseAds } from "../src/modules/ads.js";
import type { Company } from "../src/modules/icp.js";
import { isGeneric, logoOf, looksLikeProduct, siteCandidates, socialsOf } from "../src/modules/rivals.js";
import { parseXPosts, social } from "../src/modules/social.js";
import { categoryTerms, customersFrom, extractTarget, overlap, relevantKeyword, socialLinks } from "../src/modules/target.js";
import type { ModuleContext } from "../src/modules/types.js";

// ---- A. target from your own pages ------------------------------------------------------------------

const HOME = `Title: AcmePosts | LinkedIn posts on autopilot
# Put your next 90 days of LinkedIn content on autopilot
AcmePosts writes LinkedIn posts for founders and creators, trained on viral posts. Built for founders, creators and agencies.
## For Agencies
Run your clients' LinkedIn content in one place. Agencies love the calendar.
Trusted by ![GoodCall logo](/l/goodcall.png) ![Omniconvert logo](/l/omni.png) ![arrow](/a.svg)
"It doubled our reach." Jane Doe, Founder at Highline Beta
"Best LinkedIn post generator." Sam Lee, CEO @ VaynerMedia
Founders use the hook library. Creators use the post generator. Pricing. Start free.
[LinkedIn](https://www.linkedin.com/company/humanoidz) [LinkedIn](https://www.linkedin.com/company/acmeposts/) [X](https://twitter.com/acmeposts_ai) [Share](https://twitter.com/intent/tweet)`;

test("target: roles, size words, named customers, use cases and the brand's own social pages from the site", () => {
  const t = extractTarget([{ kind: "home", url: "https://acmeposts.ai/", markdown: HOME }], "AcmePosts");
  const roles = t.roles.map((r) => r.replace(/ \(.*$/, ""));
  assert.ok(roles.includes("Founders") && roles.includes("Creators") && roles.includes("Agencies"), roles.join(","));
  assert.ok(t.sizes.includes("solo") && t.sizes.includes("agency"));
  assert.ok(t.industries.includes("marketing services"));
  for (const c of ["GoodCall", "Omniconvert", "Highline Beta", "VaynerMedia"]) assert.ok(t.customers.includes(c), c);
  assert.ok(!t.customers.includes("arrow"));
  assert.ok(t.useCases.some((u) => /Agencies/.test(u)));
  assert.deepEqual(t.sources, ["https://acmeposts.ai/"]);
  // The footer link named like the brand wins over another company's page.
  assert.deepEqual(socialLinks(HOME, "AcmePosts", "acmeposts.ai"), { linkedin: "https://www.linkedin.com/company/acmeposts", x: "acmeposts_ai", facebook: "" });
  assert.deepEqual(customersFrom("Ana Ruiz, Head of Growth at Acme Labs said so", "x"), ["Acme Labs"]);
});

test("target: image alt text survives the free page read, entities are decoded", () => {
  const md = htmlToMarkdown(`<html><title>A</title><body><p>Trusted by <img src="/x.png" alt="Northwind logo"> and clients&#x27; teams</p></body></html>`);
  assert.match(md, /!\[Northwind logo\]\(\/x\.png\)/);
  assert.match(md, /clients' teams/);
});

// ---- B. rivals, checked ------------------------------------------------------------------------------

const TERMS = categoryTerms(`${HOME}\n${HOME}`, "AcmePosts", "acmeposts.ai");

test("rivals: a word on the page never becomes a domain, generic domains are never rivals", () => {
  assert.ok(isGeneric("competitors.com"));
  assert.ok(isGeneric("g2.com") && isGeneric("blog.hubspot.com") && isGeneric("linkedin.com") && isGeneric("army.mil"));
  assert.ok(!isGeneric("taplio.com"));
  assert.ok(isGeneric("framerusercontent.com") && isGeneric("cdn.prod.website-files.com") && isGeneric("d1.cloudfront.net") && isGeneric("calendly.com"));
  // "Competitors" and "Every" are plain words: no competitors.com or every.com comes out of them.
  const pages = [{ kind: "alternatives", url: "https://acmeposts.ai/compare", markdown: "# AcmePosts vs Competitors\nWhy AcmePosts beats Every tool. [AcmePosts vs Taplio](/compare/taplio) Taplio (taplio.com) is pricier." }];
  assert.deepEqual(siteCandidates(pages, "acmeposts.ai", "AcmePosts"), ["taplio.com"]);
});

test("rivals: the home page check keeps a LinkedIn content tool and turns down a listicle and an off-category site", () => {
  assert.ok(TERMS.includes("linkedin") && TERMS.includes("post"), TERMS.join(","));
  const taplio = "Title: Taplio | Grow on LinkedIn\n# The all-in-one LinkedIn tool\nWrite LinkedIn posts with AI, schedule content on autopilot with a calendar, find viral hooks in the hook library, a post generator. Loved by founders, creators and agencies with many clients. Pricing. Start free trial.";
  const coffee = "Title: Bean Co\n# Fresh coffee\nSingle origin coffee roasted weekly. Pricing. Shop now.";
  const listicle = "Title: Top 10 Taplio alternatives in 2026\n# Best LinkedIn tools\nLinkedIn posts, AI, founders, creators, content. Pricing";
  assert.ok(overlap(taplio, TERMS).score >= 0.45, String(overlap(taplio, TERMS).score));
  assert.ok(overlap(coffee, TERMS).score < 0.2);
  assert.equal(looksLikeProduct(taplio), true);
  assert.equal(looksLikeProduct(listicle), false);
});

test("rivals: logo and social pages read from a company.enrich answer", () => {
  const row = { assets: { logoSquare: { src: "https://cdn.example/logos/taplio.png" } }, socials: { linkedin: { url: "https://www.linkedin.com/company/1441", idNumeric: "1441" }, twitter: { id: "taplio" }, facebook: { id: "taplio" } } };
  assert.equal(logoOf(row), "https://cdn.example/logos/taplio.png");
  assert.deepEqual(socialsOf(row), { linkedin: "https://www.linkedin.com/company/1441", linkedinId: "1441", x: "taplio", facebook: "taplio" });
  assert.equal(logoOf({ logo: "https://logos.hunter.io/acmeposts.ai" }), "https://logos.hunter.io/acmeposts.ai");
});

// ---- D. the hard ICP filter --------------------------------------------------------------------------

const co = (domain: string, name: string, industries: string[], employees: number | null): Company => ({ domain, name, industries, employees, country: "US", technologies: [], keywords: [] });

test("ICP filter: Google, IBM, EY, a government body and a giant are dropped, a small agency stays", () => {
  const c = { industries: ["marketing services", "advertising services", "software development"], band: [1, 50] as [number, number], countries: ["United States"], stack: [] };
  assert.match(outOfIcp(co("google.com", "Google", ["legal-services"], 15610), c)!, /mega brand/);
  assert.match(outOfIcp(co("ibm.com", "IBM", ["it services"], 280000), c)!, /mega brand/);
  assert.match(outOfIcp(co("ey.com", "EY", ["accounting"], 300000), c)!, /mega brand/);
  assert.match(outOfIcp(co("army.mil", "US Army", ["armed forces"], null), c)!, /government or military/);
  assert.match(outOfIcp(co("bigsoft.example", "Bigsoft", ["software development"], 12000), c)!, /giant/);
  assert.match(outOfIcp(co("law.example", "Law LLP", ["law practice"], 20), c)!, /outside the ICP industries/);
  assert.match(outOfIcp(co("mid.example", "Mid", ["software development"], 400), c)!, /outside 1-50/);
  assert.match(outOfIcp(co("mix.example", "Mix", ["legal services"], 20), c, ["marketing & advertising"])!, /outside the ICP industries|providers disagree/);
  assert.equal(outOfIcp(co("smallagency.example", "Small Agency", ["marketing & advertising"], 12), c), null);
  assert.equal(industryFit(["computer software"], ["software development"]), "software development");
  // Before enrich only the hard cases go, so rough search data does not drop a fit.
  assert.equal(outOfIcp(co("mid.example", "Mid", ["software development"], 400), c, [], true), null);
});

// ---- E. logos and ad creatives saved at run time -------------------------------------------------------

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);

function imageFetch(seen: string[]): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("broken")) return new Response("nope", { status: 404 });
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}

test("logos: saved once at run time, embedded as data URIs, a lettered tile without one, none in the public copy", async () => {
  const out = mkdtempSync(join(tmpdir(), "looot-zeus-assets-"));
  const cfg = normalizeConfig({ domain: "acmeposts.ai", competitors: ["taplio.com"], profiles: { "taplio.com": { name: "Taplio", logo: "https://cdn.example/taplio.png" } } });
  const outputs = {
    accounts: { rows: [{ domain: "smallagency.example" }] },
    ads: { advertisers: [{ name: "Taplio", domain: "taplio.com", ads: [{ image: "https://scontent.example/ad1.jpg", firstSeen: "2026-10-01" }, { image: "https://broken.example/ad2.jpg", firstSeen: "2026-09-01" }] }] },
  };
  const seen: string[] = [];
  const r = await collectAssets(out, cfg, outputs, imageFetch(seen));
  assert.equal(r.logos, 3);
  assert.equal(r.ads, 1);
  // the enrich logo is used for the rival, Google's favicon service for the others
  assert.ok(seen.includes("https://cdn.example/taplio.png"));
  assert.ok(seen.some((u) => u.startsWith("https://www.google.com/s2/favicons?domain=smallagency.example")));
  // the ad creative is a file under gtm/assets/ads, referenced relatively
  const ad = (outputs.ads.advertisers[0].ads[0] as any).imageFile as string;
  assert.match(ad, /^assets\/ads\/[0-9a-f]{16}\.png$/);
  assert.ok(existsSync(join(out, ad)));
  assert.equal((outputs.ads.advertisers[0].ads[1] as any).imageFile, undefined);
  // embedded offline
  loadLogos(out);
  assert.match(logoData("taplio.com")!, /^data:image\/png;base64,/);
  const html = logoHtml("taplio.com", "Taplio", false);
  assert.match(html, /<img class="lg-i" src="data:image\/png;base64,/);
  assert.match(logoHtml("nologo.example", "Nologo", false), /class="lg tile"[^>]*>N</);
  // a second run fetches nothing new
  const again: string[] = [];
  await collectAssets(out, cfg, outputs, imageFetch(again));
  assert.ok(!again.includes("https://cdn.example/taplio.png"));
  // public copy: blank tiles, no image
  assert.equal(logoHtml("taplio.com", "Taplio", true).includes("<img"), false);
  const pub = stripAssets(`${html}<img data-src="assets/ads/x.png" alt="Ad creative"><span class="mark" aria-hidden="true"><img src="data:x"></span>${logoHtml("nologo.example", "Nologo", false)}`);
  assert.ok(!/<img/.test(pub), pub);
  assert.ok(!/>N</.test(pub));
  setLogos(new Map());
});

// ---- ads matched to the advertiser ---------------------------------------------------------------------

test("ads: an ad whose advertiser or landing page is not the rival's is dropped", () => {
  const who = { name: "Taplio", domain: "taplio.com" };
  assert.equal(belongsTo({ advertiser: "Taplio", landing: "https://taplio.com/linkedin-mcp?utm_source=meta" }, who).ok, true);
  assert.equal(belongsTo({ advertiser: null, landing: "https://www.taplio.com/" }, who).ok, true);
  const reseller = belongsTo({ advertiser: "TRAN THI DUNG", landing: "https://taplio.com" }, who);
  assert.equal(reseller.ok, false);
  assert.match(reseller.why, /not Taplio/);
  assert.equal(belongsTo({ advertiser: "Taplio", landing: "https://acuseeds.co.uk/products/x" }, who).ok, false);
  assert.equal(belongsTo({ advertiser: "Competitors View", landing: null }, { name: "Competitors", domain: "competitors.com" }).ok, false);
  assert.equal(belongsTo({ advertiser: null, landing: null }, who).ok, false);
  // name match is exact once legal and web suffixes are gone
  const buffer = { name: "Buffer", domain: "buffer.com" };
  assert.equal(belongsTo({ advertiser: "Buffer Inc.", landing: null }, buffer).ok, true);
  assert.equal(belongsTo({ advertiser: "Creative Buffer Consultancy Private Limited", landing: null }, buffer).ok, false);
  assert.equal(belongsTo({ advertiser: "TEPLOBAK | Buffer Tanks & Thermal Storage Manufacturer", landing: "https://teplobak.eu" }, buffer).ok, false);
  assert.equal(belongsTo({ advertiser: "2PR.io", landing: null }, { name: "2pr", domain: "2pr.io" }).ok, true);
  // Meta company ads shape: page name, link and the creative image
  const ads = parseAds({ searchResults: [{ ad_archive_id: "9", page_name: "Taplio", snapshot: { title: "Grow on LinkedIn", cards: [{ body: "Write posts", link_url: "https://taplio.com/x", original_image_url: "https://scontent.example/9.jpg" }], link_url: "https://taplio.com/x" }, start_date: 1_760_000_000 }] }, "meta", "scrapecreators");
  assert.equal(ads[0].advertiser, "Taplio");
  assert.equal(ads[0].landing, "https://taplio.com/x");
  assert.equal(ads[0].image, "https://scontent.example/9.jpg");
});

// ---- F. social ---------------------------------------------------------------------------------------

test("social: X answers from AnyAPI and TikHub parse, posts by another account are left out", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const anyapi = { hint: "large_result", items: "2", output: { data: { items: [
    { id: "211", url: "https://x.com/i/web/status/211", text: "Before AI can write for you, decide what it needs to know.", authorUsername: "every", createdUtc: "1793731447", likeCount: "3", replyCount: "1", retweetCount: "0", authorImage: "https://pbs.twimg.com/a.jpg" },
    { id: "212", text: "someone else", authorUsername: "other", createdUtc: "1793731447" },
  ] }, found: true } };
  const a = parseXPosts(anyapi, now, "anyapi", "every");
  assert.equal(a.length, 1);
  assert.equal(a[0].url, "https://x.com/every/status/211");
  assert.equal(a[0].date, "2026-11-03");
  assert.equal(a[0].likes, 3);
  const tikhub = { code: 200, data: { status: "ok", timeline: [{ text: "New: carousels", tweet_id: "98", created_at: "Tue Aug 02 15:19:13 +0000 2026", favorites: "4", user_info: { screen_name: "supergrowai", name: "Supergrow" } }] } };
  const t = parseXPosts(tikhub, now, "tikhub", "supergrowai");
  assert.equal(t[0].url, "https://x.com/supergrowai/status/98");
  assert.equal(t[0].date, "2026-08-02");
});

test("social: the LinkedIn page and X handle come from the profile, a second provider tries when the first misses", async () => {
  const sent: { job: string; input: Record<string, unknown> }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push({ job, input });
      const second = job === "linkedin.company.posts" && "company" in input;
      const hit = second || job === "x.post.search";
      const data = second ? { posts: [{ text: "Introducing our AI hook library", url: "https://www.linkedin.com/posts/x", datePublished: "2026-10-30T10:00:00Z" }] } : job === "x.post.search" ? { output: { data: { items: [{ id: "1", text: "hi", authorUsername: "supergrowai", createdUtc: "1793731447" }] } } } : {};
      return { record: { module: opts.module, job, provider: second ? "harvestapi" : "mock", outcome: hit ? "hit" : "miss", quoted: 0, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed", outcome: hit ? "hit" : "miss" }, data };
    },
  };
  const cfg = normalizeConfig({ domain: "acmeposts.ai", brand: "AcmePosts", competitors: ["supergrow.ai"], profiles: { "supergrow.ai": { name: "Supergrow", linkedin: "https://www.linkedin.com/company/supergrowai", x: "supergrowai" } } });
  const ctx: ModuleContext = { cfg, mode: "live", outputs: {}, outDir: "", partial: () => {}, log: () => {}, call: (job, input, step) => runner.call(job, input, { module: "social", step, maxCostUsd: 0.01, quotedUsd: 0.001 }) };
  const r = await social.run(ctx);
  const sg = (r.out as any).brands.find((b: any) => b.domain === "supergrow.ai");
  assert.equal(sg.linkedinUrl, "https://www.linkedin.com/company/supergrowai");
  assert.equal(sg.handle, "supergrowai");
  assert.deepEqual(sent.filter((s) => s.job === "linkedin.company.posts" && JSON.stringify(s.input).includes("supergrowai")).map((s) => Object.keys(s.input)[0]), ["url", "company"]);
  assert.ok(sent.some((s) => s.job === "x.post.search" && s.input.query === "from:supergrowai"));
  assert.equal(sg.posts.filter((p: any) => p.network === "LinkedIn").length, 1);
  assert.equal(sg.posts.filter((p: any) => p.network === "X").length, 1);
  // our own handle was not in the profile, so the lookup says it was guessed
  const own = (r.out as any).brands.find((b: any) => b.you);
  assert.match(own.lookups, /guessed from the domain/);
});

// ---- SEO gaps on topic -----------------------------------------------------------------------------------

test("seo: gaps must share category words, off-topic searches are left out", () => {
  const terms = ["linkedin", "post", "founder", "tool", "content", "ai", "creator", "generator", "hook", "calendar", "ghostwriter"];
  assert.equal(relevantKeyword("linkedin post generator", terms), true);
  assert.equal(relevantKeyword("ai linkedin ghostwriter", terms), true);
  assert.equal(relevantKeyword("how to cancel linkedin premium", terms), false);
  assert.equal(relevantKeyword("linkedin header dimensions", terms), false);
  assert.equal(relevantKeyword("competitors", terms), false);
  assert.equal(relevantKeyword("ai image generators", terms), false);
  assert.equal(relevantKeyword("anything", []), true);
});

// ---- prepare, the agent step ------------------------------------------------------------------------------

test("prepare: free site read, quoted rival check, candidates.json and a brief for the agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-prepare-"));
  const outDir = join(dir, "gtm");
  mkdirSync(outDir, { recursive: true });
  const site: Record<string, string> = {
    "https://acmeposts.ai/": `<html><title>AcmePosts | LinkedIn posts</title><body>${HOME.replace(/\n/g, "<br>").replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')}<a href="/compare">Compare</a></body></html>`,
    "https://acmeposts.ai/compare": "<html><body><h1>AcmePosts vs Competitors</h1><p>Better than Every tool. See taplio.com and <a href=\"https://taplio.com\">Taplio</a>.</p><p>Pricing and more words to pass two hundred characters in the page body for the reader to keep it as usable.</p></body></html>",
  };
  const fetchSite = (async (url: string | URL) => {
    const html = site[String(url)];
    return html ? new Response(html, { status: 200, headers: { "content-type": "text/html" } }) : new Response("", { status: 404 });
  }) as typeof fetch;
  const homes: Record<string, string> = {
    "taplio.com": "Title: Taplio | LinkedIn tool\n# The LinkedIn tool for founders and creators\nWrite LinkedIn posts with AI, hooks, a content calendar and a post generator. Pricing. Start free trial.\n[LinkedIn](https://www.linkedin.com/company/taplio-hq)\n" + "More about the team and the company. ".repeat(5),
    "beanco.example": "Title: Bean Co\n# Coffee\nCoffee beans roasted weekly. Pricing. Shop now.\n" + "More about the farm. ".repeat(10),
  };
  const sent: string[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      sent.push(`${job} ${JSON.stringify(input)}`);
      let data: unknown = null;
      if (job === "google.serp.organic") data = { output: { data: { results: [{ link: "https://taplio.com/blog/acmeposts-alternatives", title: "AcmePosts vs Taplio", snippet: "Taplio alternatives" }, { link: "https://competitors.com/x", title: "Competitors", snippet: "" }, { link: "https://www.g2.com/products/taplio", title: "Taplio reviews", snippet: "Founders love it" }, { link: "https://beanco.example/", title: "Bean Co", snippet: "" }] } } };
      if (job === "web.scrape.markdown") {
        const h = String(input.url).replace(/^https:\/\//, "").replace(/\/$/, "");
        data = homes[h] ? { markdown: homes[h] } : null;
      }
      if (job === "company.enrich" && input.domain === "taplio.com") data = { assets: { logoSquare: { src: "https://cdn.example/taplio.png" } }, name: "Taplio", domain: "taplio.com" };
      const hit = data !== null;
      return { record: { module: opts.module, job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: opts.quotedUsd, charged: 0.001, ms: 1, ts: new Date().toISOString() }, run: { runId: "r", status: "completed", outcome: hit ? "hit" : "miss" }, data };
    },
  };
  const logs: string[] = [];
  const out = await cmdPrepare("acmeposts.ai", { yes: true, offline: true }, join(outDir, "config.yaml"), outDir, { fetch: fetchSite, client: () => runner, isTTY: false, log: (l) => logs.push(l) });
  assert.ok(out);
  const text = logs.join("\n");
  // the price is printed before any paid call
  assert.ok(text.indexOf("google.serp.organic") < text.indexOf("Rivals the rules kept"));
  assert.deepEqual(out!.competitors, ["taplio.com"]);
  // g2.com may be read as a list of the category's products, never checked or kept as a rival.
  assert.ok(!sent.some((s) => s.includes("competitors.com") || s.includes("every.com") || (s.includes("g2.com") && !s.startsWith("web.scrape.markdown {\"url\":\"https://www.g2.com/"))), sent.join("\n"));
  assert.ok(!sent.some((s) => s.startsWith("company.enrich") && s.includes("g2.com")));
  const cands = JSON.parse(readFileSync(join(outDir, "candidates.json"), "utf8"));
  assert.equal(cands.candidates.find((c: any) => c.domain === "beanco.example").kept, false);
  assert.match(cands.picked.reasons["taplio.com"], /category words/);
  assert.equal(cands.profiles["taplio.com"].linkedin, "https://www.linkedin.com/company/taplio-hq");
  assert.equal(cands.profiles["taplio.com"].logo, "https://cdn.example/taplio.png");
  assert.ok(cands.target.roles.some((r: string) => r.startsWith("Founders")));
  const yaml = readFileSync(join(outDir, "config.yaml"), "utf8");
  assert.match(yaml, /# Agent step\. Read gtm\/candidates\.json/);
  assert.match(yaml, /discovery:\n\s+by: rules/);
  assert.match(yaml, /excluded:\n\s+- beanco\.example/);
  // the calls are kept next to the intake calls, so the next run's receipt counts them
  const calls = JSON.parse(readFileSync(join(outDir, "intake", "calls.json"), "utf8"));
  assert.ok(calls.some((c: any) => c.module === "rivals"));
  writeFileSync(join(dir, "ok"), "");
});

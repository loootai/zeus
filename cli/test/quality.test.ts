// The launch-test fixes (looot.ai run, 25 Nov 2026): category phrases, rival category match,
// seed hygiene, honest SEO zeros and the accounts empty state. No network, no spend.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { accounts } from "../src/modules/accounts.js";
import { isSeedDomain, rivalsModule } from "../src/modules/rivals.js";
import { seo } from "../src/modules/seo.js";
import { categoryPhrases, extractTarget, saysPhrase } from "../src/modules/target.js";
import type { ModuleContext } from "../src/modules/types.js";
import type { CallResult } from "../src/client.js";

const LOOOT_HOME = "Title: looot: one key for every data API your agent needs\n# Your AI can now find LinkedIn profiles at the lowest price\nlooot connects your AI agent to data APIs. Google Maps reviews, Claude Code skills. One data API key for every agent.\n";

test("category phrases come from the title and headings, never a third-party product name", () => {
  const p = categoryPhrases([{ kind: "home", url: "https://looot.ai/", markdown: LOOOT_HOME }, { kind: "usecases", url: "https://looot.ai/agent-skills/google-maps-reviews", markdown: "Title: Read Google Maps reviews: agent skill | looot\nGoogle Maps reviews API. Claude Code." }], "looot", "looot.ai");
  assert.equal(p[0], "data api");
  assert.ok(!p.some((x) => /google|maps|claude/.test(x)), p.join(","));
  assert.equal(saysPhrase("The best Data APIs for agents", ["data api"]), "data api");
  assert.equal(saysPhrase("Email marketing and SMS for ecommerce, AI agents, data", ["data api"]), null);
});

test("a seed is a company site, never an app host, a generated project id or a platform", () => {
  assert.equal(isSeedDomain("qwtacnykulkgtsveodvs.supabase.co"), false);
  assert.equal(isSeedDomain("myapp.vercel.app"), false);
  assert.equal(isSeedDomain("github.com"), false);
  assert.equal(isSeedDomain("acme-logistics.com"), true);
});

function ctxWith(cfg: ReturnType<typeof normalizeConfig>, reply: (job: string, input: any) => unknown, sent: string[] = []): ModuleContext {
  return {
    cfg, mode: "live", outputs: {}, outDir: "/nonexistent-zeus-test", log: () => {}, partial: () => {},
    call: async (job, input, step): Promise<CallResult> => {
      sent.push(`${job} ${JSON.stringify(input)}`);
      const data = reply(job, input);
      const hit = data !== null && data !== undefined;
      return { record: { module: "t", job, provider: "mock", outcome: hit ? "hit" : "miss", quoted: 0, charged: 0, ms: 1, ts: "" }, run: { runId: step, status: "completed", outcome: hit ? "hit" : "miss" }, data };
    },
  };
}

test("rivals: a page that shares common words but never says the category is dropped; a category rival is kept", async () => {
  const cfg = normalizeConfig({ domain: "looot.ai", brand: "looot", category: ["data api"], categoryTerms: ["agent", "data", "ai", "api", "key"] });
  const homes: Record<string, string> = {
    "klaviyo.com": "Title: Klaviyo\nEmail and SMS marketing with AI agents and your customer data. Pricing. Sign up. " + "Grow with data. ".repeat(20),
    "rapidapi.com": "Title: RapidAPI\nThe data API hub for every agent: one key, AI ready, find and connect APIs. Pricing. Sign up. " + "APIs for data. ".repeat(20),
  };
  const sent: string[] = [];
  const ctx = ctxWith(cfg, (job, input) => {
    if (job === "google.serp.organic") return { results: [{ link: "https://klaviyo.com/", title: "Klaviyo", snippet: "" }, { link: "https://rapidapi.com/", title: "RapidAPI", snippet: "data API" }] };
    if (job === "web.scrape.markdown") { const h = String(input.url).replace(/^https:\/\//, "").replace(/\/.*$/, ""); return homes[h] ? { markdown: homes[h] } : null; }
    return null;
  }, sent);
  const r = await rivalsModule({ competitors: true, seeds: false, profiles: false }).run(ctx);
  const out = r.out as any;
  assert.deepEqual(out.competitors, ["rapidapi.com"]);
  assert.match(out.candidates.find((c: any) => c.domain === "klaviyo.com").reason, /never says "data api"/);
  assert.match(out.reasons["rapidapi.com"], /says "data api"/);
  // the domain is searched, and the category is searched as a buyer would
  assert.ok(sent.some((s) => s.includes('"looot.ai alternatives"')));
  assert.ok(sent.some((s) => s.includes('"best data api"')));
});

test("seo: checks that did not come back say not measured, and real zeros are written as findings", () => {
  const base = { summary: "", provider: "", date: "2026-11-25", location: "United States", footprint: [{ domain: "looot.ai", keywords: 17, traffic: 44, status: "answered", fallback: "" }], gaps: [], share: { you: 0 }, singleProvider: [] };
  const failed = seo.render({ ...base, ranks: [], ai: [{ question: "best data api", engine: "ChatGPT", named: [], you: false, cited: [], status: "failed, too_many_inflight_runs", provider: "", fallback: "" }] }, "done", { public: false });
  const t1 = JSON.stringify(failed);
  assert.match(t1, /not measured/);
  assert.ok(!/AI answer share, answers that name/.test(t1), "no 0% share table when nothing was measured");
  const zero = seo.render({ ...base, ranks: [{ keyword: "data api", you: null, best: "-", top: "rapidapi.com", status: "answered", provider: "x", fallback: "" }], ai: [{ question: "best data api", engine: "ChatGPT", named: ["RapidAPI"], you: false, cited: [], status: "answered", provider: "", fallback: "" }] }, "done", { public: false });
  const t2 = JSON.stringify(zero);
  assert.match(t2, /not in Google's top 10 for any of the 1 keywords/);
  assert.match(t2, /No AI answer named you in 1 answers/);
});

test("accounts: 0 accounts says why and gives the next step, not an empty grid", () => {
  const s = JSON.stringify(accounts.render({ summary: "0 accounts scored", date: "2026-11-25", rows: [], considered: 0, calls: [], dropped: [] } as any, "done", { public: false }));
  assert.match(s, /No account fits yet/);
  assert.match(s, /seeds: in gtm\/config.yaml/);
  assert.match(s, /looot-zeus more accounts/);
});

test("generic phrases never make the category: 'ai agent' and 'agent skill' are dropped, 'data api' stays", async () => {
  const { isSpecificPhrase } = await import("../src/modules/target.js");
  assert.equal(isSpecificPhrase("ai agent"), false);
  assert.equal(isSpecificPhrase("agent skill"), false);
  assert.equal(isSpecificPhrase("data api"), true);
  const p = categoryPhrases([{ kind: "home", url: "https://looot.ai/", markdown: "Title: looot: one key for every data API your AI agent needs\n# Agent skills for AI agents\nAI agent. AI agent. Agent skill. Data API." }], "looot", "looot.ai");
  assert.deepEqual(p.slice(0, 1), ["data api"]);
  assert.ok(!p.includes("ai agent") && !p.includes("agent skill"), p.join(","));
});

test("seeds: tracking, ads, analytics, consent and CDN hosts are never a seed, and a seed is a registered domain", async () => {
  const { isTrackingHost } = await import("../src/modules/rivals.js");
  for (const d of ["bat.bing.com", "googleadservices.com", "stats.g.doubleclick.net", "www.google-analytics.com", "connect.facebook.net", "static.hotjar.com", "cdn.segment.com", "d1abc.cloudfront.net", "cdn.cookielaw.org", "onetrust.com"]) {
    assert.equal(isTrackingHost(d) || !isSeedDomain(d), true, d);
    assert.equal(isSeedDomain(d), false, d);
  }
  assert.equal(isSeedDomain("app.acme.com"), false);
  assert.equal(isSeedDomain("acme.co.uk"), true);
});

test("masking matches whole names only: the word Search in a heading stays when an account is search.com", async () => {
  const { thirdPartySwaps, applyThirdParties } = await import("../src/thirdParties.js");
  const swaps = thirdPartySwaps({ domain: "looot.ai", accounts: [{ domain: "search.com", name: "Search.com" }, { domain: "veed.io", name: "VEED" }, { domain: "metro.co.uk", name: "Metro.co.uk" }] as any, competitors: [] });
  const out = applyThirdParties("<h3>Search + AI</h3> Google Search results. VEED and veed.io. Metro.co.uk ran a story. Search.com is an account.", swaps);
  assert.match(out, /<h3>Search \+ AI<\/h3>/);
  assert.match(out, /Google Search results/);
  assert.match(out, /a story/);
  assert.ok(!/VEED|veed\.io|Metro\.co\.uk|Search\.com/.test(out), out);
});

test("review fixes: any-casing leaks are still caught; real companies stay possible rivals; country domains are seeds", async () => {
  const { thirdPartySwaps, thirdPartyLeaks } = await import("../src/thirdParties.js");
  const swaps = thirdPartySwaps({ domain: "looot.ai", accounts: [{ domain: "acmecorp.com", name: "Acme Corp" }] as any, competitors: [] });
  assert.ok(thirdPartyLeaks("we met ACME CORP and acme corp", swaps).length > 0);
  const { isGeneric, isTrackingHost } = await import("../src/modules/rivals.js");
  // stripe.com and intercom were never-rivals before this PR (isGeneric site-widget rule); these are not added.
  for (const d of ["mixpanel.com", "posthog.com", "perplexity.ai", "events.com", "stats.com"]) assert.equal(isGeneric(d), false, d);
  for (const d of ["stripe.com", "posthog.com", "onetrust.com"]) assert.equal(isSeedDomain(d), false, d);
  assert.equal(isTrackingHost("ads.example.com"), true);
  assert.equal(isSeedDomain("acme.ltd.uk"), true);
});

test("round 3: when no candidate passes the category check, products named next to vs at least twice are kept", async () => {
  const cfg = normalizeConfig({ domain: "looot.ai", brand: "looot", category: ["data api"], categoryTerms: ["agent", "data"] });
  const home = (n: string) => `Title: ${n}\nWorkflow automation for teams. Pricing. Sign up. ` + "More words about the product. ".repeat(20);
  const ctx = ctxWith(cfg, (job, input) => {
    if (job === "google.serp.organic") return { results: [{ link: "https://x.example/a", title: "looot vs Apify", snippet: "Apify vs looot, Apify alternatives" }, { link: "https://y.example/b", title: "Zapier vs Make", snippet: "" }] };
    if (job === "web.scrape.markdown") { const h = String(input.url).replace(/^https:\/\//, "").replace(/\/.*$/, ""); return h === "apify.com" ? { markdown: home("Apify") } : null; }
    return null;
  });
  const out = (await rivalsModule({ competitors: true, seeds: false, profiles: false }).run(ctx)).out as any;
  assert.deepEqual(out.competitors, ["apify.com"]);
  assert.match(out.reasons["apify.com"], /Named next to "vs"/);
});

test("round 3: Stripe, Zendesk, OpenAI and Loom can be rivals when their home page says the category, never as seeds", async () => {
  const { isGeneric } = await import("../src/modules/rivals.js");
  for (const d of ["stripe.com", "zendesk.com", "openai.com", "loom.com"]) { assert.equal(isGeneric(d), false, d); assert.equal(isSeedDomain(d), false, d); }
  const cfg = normalizeConfig({ domain: "paycorp.example", brand: "PayCorp", category: ["payment processing"], categoryTerms: ["payment", "processing", "internet"] });
  const ctx = ctxWith(cfg, (job, input) => {
    if (job === "google.serp.organic") return { results: [{ link: "https://stripe.com/", title: "Stripe", snippet: "" }, { link: "https://loom.com/", title: "Loom", snippet: "" }] };
    if (job === "web.scrape.markdown") {
      const h = String(input.url).replace(/^https:\/\//, "").replace(/\/.*$/, "");
      if (h === "stripe.com") return { markdown: "Title: Stripe\nPayment processing for the internet. Pricing. Sign up. " + "Payments and payment processing. ".repeat(15) };
      if (h === "loom.com") return { markdown: "Title: Loom\nVideo messages for work. Pricing. Sign up. " + "Record your screen and payment. ".repeat(15) };
    }
    return null;
  });
  const out = (await rivalsModule({ competitors: true, seeds: false, profiles: false }).run(ctx)).out as any;
  assert.ok(out.competitors.includes("stripe.com"));
  assert.ok(!out.competitors.includes("loom.com"));
});

test("round 3: ICP industries come from what the site leads with, not roles named in passing", () => {
  const body = "Examples: creators, creators and writers use it. Creators love it. ".repeat(3);
  const t = extractTarget([{ kind: "home", url: "https://acme.example/", markdown: `Title: Acme: the data API for developers\n# Built for developers and engineering teams\n${body}` + "x ".repeat(120) }, { kind: "pricing", url: "https://acme.example/pricing", markdown: "Plans for developers and engineering teams. Developers pay per call. " + "y ".repeat(120) }], "Acme");
  assert.ok(!t.industries.includes("online audio and video media"), t.industries.join(","));
});

test("round 3 review: the fallback keeps one per name and never you; widget subdomains of embedded products stay generic", async () => {
  const { isGeneric, SOFT_GENERIC } = await import("../src/modules/rivals.js");
  for (const d of ["js.stripe.com", "acme.zendesk.com", "widget.intercom.io", "js.intercomcdn.com"]) assert.equal(isGeneric(d), true, d);
  assert.ok(SOFT_GENERIC.has("hubspot.com"));
  const cfg = normalizeConfig({ domain: "looot.ai", brand: "looot", category: ["data api"], categoryTerms: ["agent", "data"] });
  const home = (n: string) => `Title: ${n}\nWorkflow automation. Pricing. Sign up. ` + "More words about the product. ".repeat(20);
  const ctx = ctxWith(cfg, (job, input) => {
    if (job === "google.serp.organic") return { results: [{ link: "https://x.example/a", title: "Looot vs Apify", snippet: "Apify vs Looot.ai, Apify alternatives, Looot alternatives" }] };
    if (job === "web.scrape.markdown") { const h = String(input.url).replace(/^https:\/\//, "").replace(/\/.*$/, ""); return /^apify\.|^looot\./.test(h) ? { markdown: home(h) } : null; }
    return null;
  });
  const out = (await rivalsModule({ competitors: true, seeds: false, profiles: false }).run(ctx)).out as any;
  assert.equal(out.competitors.filter((d: string) => d.startsWith("apify.")).length, 1, out.competitors.join(","));
  assert.ok(!out.competitors.some((d: string) => d.startsWith("looot.")));
});

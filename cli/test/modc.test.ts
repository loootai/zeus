// Tests for the seo, reviews, mentions, local and commerce modules on a mocked looot client.
// No network, no key. Covers hit, miss, fail, fallback, cap stop and skip.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import type { CallRecord, CallResult, JobRunner, Outcome } from "../src/client.js";
import { normalizeConfig, type GtmConfig } from "../src/config.js";
import { renderMarkdown as toMarkdown } from "../src/dossier/md.js";
import { runPipeline } from "../src/modules/index.js";
import { commerce, asinsIn, looksLikeStore, parseProduct } from "../src/modules/commerce.js";
import { local, looksLocal, splitQuery } from "../src/modules/local.js";
import { mentions, intentsOf, hasBuyingIntent } from "../src/modules/mentions.js";
import { reviews, appStoreIdsIn, parseTarget } from "../src/modules/reviews.js";
import { seo, brandsInAnswer, brandsOf, parseGaps, parseOrganic } from "../src/modules/seo.js";
import type { GtmModule } from "../src/modules/types.js";
import { buildQuote } from "../src/quote.js";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

interface Answer {
  outcome: Outcome;
  data?: unknown;
  charged?: number;
  provider?: string;
  fallbackFrom?: string;
}

/** A mocked JobRunner. `answer` decides each call. Records every call it saw. */
function mock(answer: (job: string, input: Record<string, any>) => Answer) {
  const seen: { job: string; input: Record<string, any>; step: string; max: number }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      seen.push({ job, input: input as Record<string, any>, step: opts.step, max: opts.maxCostUsd });
      const a = answer(job, input as Record<string, any>);
      const record: CallRecord = {
        module: opts.module, job, provider: a.provider ?? "p1", outcome: a.outcome, quoted: opts.quotedUsd,
        charged: a.charged ?? (a.outcome === "fail" ? 0 : opts.quotedUsd), ms: 1, ts: new Date().toISOString(),
        ...(a.fallbackFrom ? { fallbackFrom: a.fallbackFrom } : {}),
        ...(a.outcome === "fail" ? { note: "provider_error (provider)" } : {}),
      };
      const status = a.outcome === "fail" ? "failed" : "completed";
      return { record, run: { runId: `r${seen.length}`, status }, data: a.outcome === "hit" || a.outcome === "fallback" ? a.data ?? null : null };
    },
  };
  return { runner, seen };
}

function cfgOf(extra: Record<string, unknown> = {}): GtmConfig {
  return normalizeConfig({
    domain: "acme.example",
    brand: "Acme",
    competitors: ["rivalone.example", "rivaltwo.example"],
    keywords: ["sales crm", "simple crm"],
    questions: ["best crm for a small team"],
    icp: { geos: ["United Kingdom"] },
    ...extra,
  });
}

async function runOne(mod: GtmModule, cfg: GtmConfig, runner: JobRunner, cap = 10) {
  const m = { ...mod, needs: [] };
  const q = buildQuote([m], cfg, { source: "test", live: {} });
  const row = q.rows[0];
  const res = await runPipeline({ mods: [m], cfg, quote: q, runner, ledger: new CapLedger(cap, [{ id: m.id, worst: Math.max(row.worst, 0.0001) }]), mode: "live", outDir: "" });
  return { r: res.results.get(m.id)!, res, q };
}

const md = (mod: GtmModule, out: unknown, status: "done" | "skipped" | "capped") => {
  const s = mod.render(out, status, { public: false })!;
  return toMarkdown({ domain: "acme.example", brand: "Acme", generatedAt: "2026-10-30T00:00:00Z", public: false, sections: [s] });
};

function sweep(text: string) {
  assert.ok(!text.includes("—"), "em dash");
  assert.ok(!text.includes(", and "), "comma before and");
  assert.ok(!/\bfree\b/i.test(text), "no claim that anything is free");
}

// ---------- seo ----------

const serp = (hosts: string[]) => ({ organic: hosts.map((h, i) => ({ title: h, link: `https://www.${h}/page`, position: i + 1 })) });

function seoAnswer(over: Partial<Record<string, Answer>> = {}) {
  return (job: string, input: Record<string, any>): Answer => {
    if (over[job]) return over[job]!;
    if (job === "keywords.domain.overview") return { outcome: "hit", provider: "DataForSEO", data: { tasks: [{ result: [{ items: [{ metrics: { organic: { count: input.target === "acme.example" ? 1200 : 5000, etv: 9000.4 } } }] }] }] } };
    if (job === "dataforseolabs.google.domain-intersection.live-ai") return { outcome: "hit", provider: "DataForSEO", data: { items: [{ keyword_data: { keyword: `crm for ${input.target1.split(".")[0]}`, keyword_info: { search_volume: input.target1 === "rivalone.example" ? 900 : 400 } }, first_domain_serp_element: { rank_group: 3 } }, { keyword_data: { keyword: "pipeline template", keyword_info: { search_volume: 2400 } }, first_domain_serp_element: { rank_group: input.target1 === "rivalone.example" ? 5 : 2 } }] } };
    if (job === "google.serp.organic") return input.query === "sales crm" ? { outcome: "hit", provider: "Serper", data: serp(["rivalone.example", "blog.example", "acme.example"]) } : { outcome: "fallback", provider: "Serper", fallbackFrom: "AnyAPI", data: serp(["rivaltwo.example"]) };
    if (job === "google.serp.ai-mode") return { outcome: "hit", provider: "DataForSEO", data: { items: [{ markdown: "For a small team, Rivalone and Acme are common picks.", references: [{ url: "https://rivaltwo.example/blog" }] }] } };
    if (job === "chatgpt.search.answer") return { outcome: "hit", provider: "Bright Data", data: [{ answer_text: "Rivalone is the usual answer.", citations: [{ url: "https://rivalone.example/" }] }] };
    throw new Error(`unexpected ${job}`);
  };
}

test("seo hit: gaps, ranks, AI share and one-provider flags", async () => {
  const cfg = cfgOf();
  const { runner, seen } = mock(seoAnswer());
  const { r } = await runOne(seo, cfg, runner);
  assert.equal(r.status, "done");
  const o = r.out as any;
  // Gaps merge across rivals, sorted by volume, best rival rank kept.
  assert.equal(o.gaps[0].keyword, "pipeline template");
  assert.equal(o.gaps[0].rival, "rivaltwo.example #2");
  assert.equal(o.gaps[0].fallback, "one provider, no fallback");
  assert.equal(o.gaps.length, 3);
  // Ranks: you at #3 on "sales crm", absent on "simple crm".
  assert.equal(o.ranks[0].you, 3);
  assert.equal(o.ranks[0].best, "rivalone.example #1");
  assert.equal(o.ranks[1].you, null);
  // AI: Google AI Mode names Acme and Rivalone and cites Rivaltwo, ChatGPT names only Rivalone.
  const chat = o.ai.find((a: any) => a.engine === "ChatGPT");
  const gai = o.ai.find((a: any) => a.engine === "Google AI Mode");
  assert.deepEqual(gai.named.sort(), ["Acme", "Rivalone", "Rivaltwo"]);
  assert.equal(gai.you, true);
  assert.equal(chat.you, false);
  assert.equal(chat.fallback, "one provider, no fallback");
  assert.equal(gai.fallback, "yes");
  assert.equal(o.share.you, 0.5);
  assert.equal(o.share.Rivalone, 1);
  assert.deepEqual(o.singleProvider, ["keywords.domain.overview", "dataforseolabs.google.domain-intersection.live-ai", "chatgpt.search.answer"]);
  // Inputs use verified field names and the first ICP geography.
  assert.ok(seen.some((s) => s.job === "dataforseolabs.google.domain-intersection.live-ai" && s.input.target1 === "rivalone.example" && s.input.target2 === "acme.example" && s.input.intersections === false));
  assert.ok(seen.every((s) => s.job !== "google.serp.organic" || s.input.location === "United Kingdom"));
  assert.equal(seen.length, 3 + 2 + 2 + 2);
  const text = md(seo, o, "done");
  assert.match(text, /one provider, no fallback/);
  sweep(text);
});

test("seo fallback: the rank row names the provider that answered and the one before it", async () => {
  const { runner } = mock(seoAnswer());
  const { r } = await runOne(seo, cfgOf(), runner);
  const row = (r.out as any).ranks.find((x: any) => x.keyword === "simple crm");
  assert.equal(row.provider, "Serper after AnyAPI");
});

test("seo miss and fail: rows say so, charges on misses are counted, never called free", async () => {
  const { runner } = mock(seoAnswer({
    "dataforseolabs.google.domain-intersection.live-ai": { outcome: "miss", charged: 0.012, provider: "DataForSEO" },
    "chatgpt.search.answer": { outcome: "fail", provider: "Bright Data" },
  }));
  const { r, res } = await runOne(seo, cfgOf(), runner);
  assert.equal(r.status, "done");
  const o = r.out as any;
  assert.equal(o.gaps.length, 0);
  const chat = o.ai.find((a: any) => a.engine === "ChatGPT");
  assert.match(chat.status, /^failed/);
  // Share counts only answered answers.
  assert.equal(o.share.you, 1);
  assert.match(o.calls, /2 miss/);
  assert.match(o.calls, /\$0\.0240 of it on misses or failures/);
  assert.equal(res.calls.filter((c) => c.outcome === "miss").reduce((n, c) => n + c.charged, 0), 0.024);
  sweep(md(seo, o, "done"));
});

test("seo cap stop: stops before passing the cap, keeps the rows it has", async () => {
  const { runner, seen } = mock(seoAnswer());
  // Ceilings: overview 0.02, gap 0.02, serp 0.01, ai-mode 0.02, chatgpt 0.01. A 0.05 cap allows two overview calls.
  const { r, res } = await runOne(seo, cfgOf(), runner, 0.05);
  assert.equal(r.status, "capped");
  assert.equal(res.capStopped, true);
  assert.ok(seen.length < 9);
  assert.ok(res.calls.reduce((n, c) => n + c.charged, 0) <= 0.05);
  assert.ok((r.out as any).footprint.length >= 1);
  const text = md(seo, r.out, "capped");
  assert.match(text, /partial/);
});

test("seo parsers read DataForSEO and Serper shapes", () => {
  assert.deepEqual(parseGaps({ tasks: [{ result: [{ items: [{ keyword_data: { keyword: "a", keyword_info: { search_volume: 10 } }, first_domain_serp_element: { rank_absolute: 4 } }] }] }] }), [{ keyword: "a", volume: 10, rank: 4 }]);
  assert.deepEqual(parseOrganic({ items: [{ type: "paid", url: "https://x.example" }, { type: "organic", url: "https://www.y.example/a", rank_group: 1 }] }), [{ position: 1, host: "y.example" }]);
  const b = brandsInAnswer({ answer_html: "<b>Acme</b>", text: "nothing here" }, brandsOf(cfgOf()));
  assert.deepEqual(b.named, []);
});

// ---------- reviews ----------

test("reviews auto-skips with an honest reason and makes no call", async () => {
  const { runner, seen } = mock(() => ({ outcome: "hit" }));
  const { r, q } = await runOne(reviews, cfgOf(), runner);
  assert.equal(r.status, "skipped");
  assert.match(r.summary, /no App Store app or Google Maps listing found for acme\.example/);
  assert.match(r.summary, /B2B review sites have no looot job yet/);
  assert.equal(seen.length, 0);
  assert.equal(q.rows[0].calls, 0);
  sweep(md(reviews, r.out, "skipped"));
});

test("reviews hit: themes for you, weak spots for a competitor, pages stop when empty", async () => {
  const mineTexts = ["Easy to use and quick setup", "Setup took ten minutes, easy to use", "Mobile app sync is broken", "Easy to use, support was quick", "Great support team"];
  const theirTexts = ["Price went up again, too expensive", "Expensive for what you get", "Pricing is a rip off, cancelled", "Support never replied"];
  const { runner, seen } = mock((job, input) => {
    if (job === "reviews.appstore.reviews") {
      if (input.page > 1) return { outcome: "hit", provider: "SearchAPI.io", data: { reviews: [] } };
      const texts = input.product_id === "111111" ? mineTexts : theirTexts;
      return { outcome: "hit", provider: "SearchAPI.io", data: { reviews: texts.map((t, i) => ({ rating: input.product_id === "111111" ? (i === 2 ? 2 : 5) : 1, text: t, iso_date: "2026-10-01" })) } };
    }
    if (job === "maps.place.reviews") return { outcome: "miss", charged: 0.001, provider: "Serper" };
    throw new Error(job);
  });
  const cfg = cfgOf({ reviews: { appStoreIds: ["111111", "rivalone.example:222222"], mapsPlaces: ["ChIJabc"] } });
  const { r } = await runOne(reviews, cfg, runner);
  assert.equal(r.status, "done");
  const o = r.out as any;
  assert.equal(o.count, 5);
  assert.equal(o.themes[0].theme, "Ease of use");
  assert.equal(o.themes[0].tone, "praise");
  assert.ok(o.weakSpots.some((w: any) => w.competitor === "Rivalone" && w.theme === "Price and value"));
  // Page 2 came back empty, so page 3 was never asked for.
  assert.equal(seen.filter((s) => s.job === "reviews.appstore.reviews").length, 4);
  assert.equal(seen.find((s) => s.job === "maps.place.reviews")!.input.placeId, "ChIJabc");
  const maps = o.listings.find((l: any) => l.source === "Google Maps");
  assert.equal(maps.status, "no answer (miss)");
  assert.equal(maps.fallback, "yes");
  assert.equal(o.listings.find((l: any) => l.id === "111111").fallback, "one provider, no fallback");
  sweep(md(reviews, o, "done"));
});

test("reviews helpers: owner prefixes and App Store ids in page text", () => {
  assert.deepEqual(parseTarget("rival-a.com:123456", "App Store", { domain: "acme.example" }), { owner: "rival-a.com", id: "123456", you: false, source: "App Store" });
  assert.deepEqual(appStoreIdsIn("get it on https://apps.apple.com/us/app/acme-crm/id284882215 today"), ["284882215"]);
});

// ---------- mentions ----------

test("mentions: 7-day window, brand match, buying intent, dedupe and a failed search", async () => {
  const { runner } = mock((job, input) => {
    if (job === "reddit.post.search") {
      if (input.query !== "Acme") return { outcome: "miss", charged: 0, provider: "ScrapeCreators" };
      return { outcome: "hit", provider: "ScrapeCreators", data: { posts: [
        { title: "Can anyone recommend a CRM? Acme or Rivalone?", permalink: "/r/sales/1", created_utc: Math.floor(Date.now() / 1000) - 3600, subreddit: "sales" },
        { title: "Acme release notes", permalink: "/r/sales/2", created_utc: Math.floor((Date.now() - 20 * DAY) / 1000) },
        { title: "Unrelated post", permalink: "/r/sales/3", created_utc: Math.floor(Date.now() / 1000) },
      ] } };
    }
    if (job === "x.post.search") {
      if (input.query === "Rivalone") return { outcome: "fallback", provider: "TikHub", fallbackFrom: "AnyAPI", data: { tweets: [{ text: "Moving off Rivalone after the price increase, what do people use?", id: "9", author: { userName: "ops_jo" }, createdAt: daysAgo(2) }] } };
      return { outcome: "hit", provider: "AnyAPI", data: { tweets: [] } };
    }
    if (job === "news.search") {
      if (input.query === "Rivaltwo") return { outcome: "fail", provider: "Serper" };
      return { outcome: "hit", provider: "Serper", data: { news: [{ title: "Acme raises a round", link: "https://news.example/a", date: daysAgo(1) }, { title: "Can anyone recommend a CRM? Acme or Rivalone?", link: "https://www.reddit.com/r/sales/1" }] } };
    }
    throw new Error(job);
  });
  const { r } = await runOne(mentions, cfgOf(), runner);
  assert.equal(r.status, "done");
  const o = r.out as any;
  const titles = o.rows.map((x: any) => x.title);
  assert.ok(titles.some((t: string) => t.startsWith("Can anyone recommend")));
  assert.ok(!titles.some((t: string) => t.startsWith("Acme release notes")), "older than 7 days is dropped");
  assert.ok(!titles.some((t: string) => t.startsWith("Unrelated")), "posts must name the brand");
  assert.equal(titles.filter((t: string) => t.startsWith("Can anyone recommend")).length, 1, "same URL kept once");
  const rival = o.rows.find((x: any) => x.about === "Rivalone");
  assert.equal(rival.intent, true);
  assert.equal(rival.provider, "TikHub after AnyAPI");
  assert.match(o.summary, /mentions in 7 days, 2 buying-intent posts/);
  assert.ok(o.searches.some((s: any) => s.about === "Rivaltwo" && s.platform === "News" && /^failed/.test(s.status)));
  const text = md(mentions, o, "done");
  assert.match(text, /Searches that did not answer/);
  sweep(text);
});

test("mentions intent rules", () => {
  assert.deepEqual(intentsOf("Looking for alternatives to Rivalone"), ["asks for a tool", "compares"]);
  assert.equal(hasBuyingIntent(["complains"], true), false);
  assert.equal(hasBuyingIntent(["complains"], false), true);
});

test("mentions cap stop marks the module capped with partial rows", async () => {
  const { runner } = mock(() => ({ outcome: "hit", provider: "p", data: { posts: [{ title: "Acme is great", permalink: "/r/x/1", created_utc: Math.floor(Date.now() / 1000) }] } }));
  const { r, res } = await runOne(mentions, cfgOf(), runner, 0.025);
  assert.equal(r.status, "capped");
  assert.ok(res.calls.length >= 1 && res.calls.length < 9);
  assert.ok(res.calls.reduce((n, c) => n + c.charged, 0) <= 0.025);
});

// ---------- local ----------

test("local skips unless the config lists local searches", async () => {
  const { runner, seen } = mock(() => ({ outcome: "hit" }));
  const { r } = await runOne(local, cfgOf(), runner);
  assert.equal(r.status, "skipped");
  assert.match(r.summary, /no physical locations in the config/);
  assert.equal(seen.length, 0);
  sweep(md(local, r.out, "skipped"));
});

test("local hit, miss and fallback rows", async () => {
  const { runner, seen } = mock((_, input) => {
    if (input.query === "crm consultant") return { outcome: "hit", provider: "Serper", data: { places: [{ title: "Big Rival Ltd", rating: 4.8, ratingCount: 120 }, { title: "Acme Amsterdam", website: "https://acme.example/nl", rating: 4.5, ratingCount: 31 }] } };
    if (input.query === "sales training") return { outcome: "miss", charged: 0.001, provider: "Serper" };
    return { outcome: "fallback", provider: "AnyAPI", fallbackFrom: "Serper", data: { local_results: [{ title: "Other Co" }] } };
  });
  const cfg = cfgOf({ local: { mode: "auto", queries: ["crm consultant @ Amsterdam", "sales training @ London", "crm setup"] } });
  const { r } = await runOne(local, cfg, runner);
  const o = r.out as any;
  assert.equal(o.rows[0].you, "#2");
  assert.equal(o.rows[0].rating, "4.5");
  assert.equal(o.rows[0].top, "Big Rival Ltd (4.8)");
  assert.equal(o.rows[1].status, "no answer (miss)");
  assert.equal(o.rows[2].you, "not listed");
  assert.equal(o.rows[2].provider, "AnyAPI after Serper");
  assert.deepEqual(seen[0].input, { query: "crm consultant", location: "Amsterdam" });
  assert.match(o.summary, /listed on 1 of 3 local searches/);
  assert.deepEqual(splitQuery("dentist"), { query: "dentist" });
  assert.equal(looksLocal("Opening hours Mon to Fri"), true);
  sweep(md(local, o, "done"));
});

// ---------- commerce ----------

test("commerce auto-skips when the domain is not a store and says it covers Amazon only", async () => {
  const { runner, seen } = mock(() => ({ outcome: "hit" }));
  const { r } = await runOne(commerce, cfgOf(), runner);
  assert.equal(r.status, "skipped");
  assert.match(r.summary, /not a store/);
  assert.match(r.summary, /Amazon listings only/);
  assert.equal(seen.length, 0);
  sweep(md(commerce, r.out, "skipped"));
});

test("commerce hit and fail rows with owners", async () => {
  const { runner, seen } = mock((_, input) =>
    input.asin === "B0ABC12345"
      ? { outcome: "hit", provider: "SearchAPI.io", data: { product: { title: "Acme Widget", price: { raw: "$19.99", value: 19.99 }, rating: 4.6, reviews_count: 812, brand: "Acme" } } }
      : { outcome: "fail", provider: "SearchAPI.io" },
  );
  const cfg = cfgOf({ commerce: { mode: "auto", asins: ["B0ABC12345", "rivalone.example:B0XYZ98765"] } });
  const { r } = await runOne(commerce, cfg, runner);
  const o = r.out as any;
  assert.equal(o.rows[0].name, "Acme Widget");
  assert.equal(o.rows[0].price, "$19.99");
  assert.equal(o.rows[0].whose, "you");
  assert.equal(o.rows[1].whose, "Rivalone");
  assert.match(o.rows[1].status, /^failed/);
  assert.deepEqual(seen.map((s) => s.input), [{ asin: "B0ABC12345" }, { asin: "B0XYZ98765" }]);
  assert.match(o.summary, /1 of 2 Amazon listings read/);
  sweep(md(commerce, o, "done"));
});

test("commerce helpers: store detection and ASINs in page text", () => {
  assert.equal(looksLikeStore("Add to cart. Free shipping over $50."), true);
  assert.equal(looksLikeStore("Book a demo"), false);
  assert.equal(looksLikeStore("Top up at checkout. GRAFFEO.COM Shop now"), false);
  assert.equal(looksLikeStore("Add to cart, then checkout"), true);
  assert.deepEqual(asinsIn("buy at https://www.amazon.com/Acme-Widget/dp/B0ABC12345?ref=x"), ["B0ABC12345"]);
  assert.equal(parseProduct({}), null);
});

// ---------- demo ----------

test("demo mode renders every fixture offline with no call", async () => {
  const cfg = normalizeConfig({ domain: "yourdomain.com", competitors: ["a.example"], keywords: ["k"], questions: ["q"], reviews: { appStoreIds: ["000000000"] } });
  const mods = [seo, reviews, mentions, local, commerce].map((m) => ({ ...m, needs: [] }));
  const { runner, seen } = mock(() => ({ outcome: "hit" }));
  const q = buildQuote(mods, cfg, { source: "test", live: {} });
  const res = await runPipeline({ mods, cfg, quote: q, runner, ledger: new CapLedger(10, mods.map((m) => ({ id: m.id, worst: 1 }))), mode: "demo", outDir: "" });
  assert.equal(seen.length, 0);
  assert.equal(res.results.get("seo")!.status, "done");
  assert.equal(res.results.get("reviews")!.status, "done");
  assert.equal(res.results.get("mentions")!.status, "done");
  assert.equal(res.results.get("local")!.status, "skipped");
  assert.equal(res.results.get("commerce")!.status, "skipped");
  for (const m of mods) {
    const r = res.results.get(m.id)!;
    const text = md(m, r.out, r.status);
    assert.ok(text.length > 0);
    sweep(text);
  }
  assert.match(md(seo, res.results.get("seo")!.out, "done"), /PLACEHOLDER/);
});

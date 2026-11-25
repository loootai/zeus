// The launch-test fixes (looot.ai run, 25 Nov 2026): category phrases, rival category match,
// seed hygiene, honest SEO zeros and the accounts empty state. No network, no spend.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { accounts } from "../src/modules/accounts.js";
import { isSeedDomain, rivalsModule } from "../src/modules/rivals.js";
import { seo } from "../src/modules/seo.js";
import { categoryPhrases, saysPhrase } from "../src/modules/target.js";
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

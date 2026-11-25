// Tests for the readiness (web.agent.readiness) and domains (domain.rdap.lookup) modules on a mocked
// looot client. No network, no key. Answers follow the gateway's own shapes (AgentReadinessAnswer and
// RdapLookupAnswer on looot master), with example domains only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import type { CallRecord, CallResult, JobRunner } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { renderCity } from "../src/city/index.js";
import { domains, domainsQuote, parseRawRdap, parseRdap, yearsBetween } from "../src/modules/domains.js";
import { intake } from "../src/modules/intake.js";
import { loadFixture } from "../src/modules/fixture.js";
import { MODULES, runPipeline } from "../src/modules/index.js";
import { CHECK_LABEL, label, parseReadiness, readiness, readinessQuote } from "../src/modules/readiness.js";
import { buildQuote, loadPriceBook } from "../src/quote.js";

const cfg = () => normalizeConfig({ domain: "acme.example", brand: "Acme", competitors: ["rivalone.example", "rivaltwo.example"] });

const READY = { url: "https://acme.example", finalUrl: "https://acme.example/", checkedAt: "2026-11-25T10:00:00Z", browser: false, score: 42, level: 2, levelName: "agent-aware",
  checks: [
    { id: "robots", group: "bot_access", pass: true, status: 200 },
    { id: "robots.ai_rules", group: "bot_access", pass: false, status: 200, fix: "name the AI crawlers in robots.txt" },
    { id: "llms_txt", group: "content", pass: false, status: 404, fix: "publish /llms.txt (llmstxt.org) as text/plain or text/markdown" },
    { id: "mcp_discovery", group: "api_auth_mcp", pass: false, status: 404, fix: "publish /.well-known/mcp.json" },
  ] };
const RDAP = { domain: "acme.example", unicodeName: null, status: ["client transfer prohibited"], registrar: { name: "Example Registrar, Inc.", ianaId: "9999" },
  createdAt: "2015-08-20T12:00:00Z", updatedAt: "2025-01-01T00:00:00Z", expiresAt: "2027-08-20T12:00:00Z", nameservers: ["ns1.example"], dnssec: false,
  registry: "Verisign", rdapServer: "https://rdap.verisign.com/com/v1/", source: { text: "Verisign", url: "https://example.com" }, checkedAt: "2026-11-25T10:00:00Z" };

function mock(answer: (job: string, input: Record<string, any>) => { outcome: "hit" | "miss"; data?: unknown }) {
  const seen: { job: string; input: Record<string, any> }[] = [];
  const runner: JobRunner = {
    async call(job, input, opts): Promise<CallResult> {
      seen.push({ job, input: input as Record<string, any> });
      const a = answer(job, input as Record<string, any>);
      const record: CallRecord = { module: opts.module, job, provider: "p1", outcome: a.outcome, quoted: opts.quotedUsd, charged: a.outcome === "hit" ? opts.quotedUsd : 0, ms: 1, ts: new Date().toISOString() };
      return { record, run: { runId: `r${seen.length}`, status: "completed" }, data: a.outcome === "hit" ? a.data : null };
    },
  };
  return { runner, seen };
}

async function runOne(mod: typeof readiness, runner: JobRunner) {
  const c = cfg();
  const q = buildQuote([mod], c, await loadPriceBook({ cacheDir: ".looot-zeus-test", offline: true }));
  return runPipeline({ mods: [intake, mod], cfg: c, quote: q, runner, ledger: new CapLedger(1, q.rows.map((r) => ({ id: r.module, worst: r.worst }))), mode: "live", outDir: "", preset: { intake: { out: { pages: [], config: c, guessed: [] }, summary: "intake" } } });
}

test("quote lines: one call per site, you plus each rival, no LinkedIn job", () => {
  assert.deepEqual(readinessQuote(cfg()).lines.map((l) => [l.job, l.calls]), [["web.agent.readiness", 3]]);
  assert.deepEqual(domainsQuote(cfg()).lines.map((l) => [l.job, l.calls]), [["domain.rdap.lookup", 3]]);
  const off = normalizeConfig({ domain: "acme.example", competitors: ["rivalone.example"] }, { noLinkedin: true });
  assert.equal(off.linkedin, false);
  assert.equal(readinessQuote(off).lines[0].calls, 2);
});

test("parses real-shaped answers, also inside a data wrapper", () => {
  const r = parseReadiness({ data: READY })!;
  assert.equal(r.score, 42);
  assert.equal(r.checks.filter((c) => !c.pass).length, 3);
  assert.equal(parseReadiness({ nothing: 1 }), null);
  const d = parseRdap({ result: RDAP })!;
  assert.deepEqual(d, { registrar: "Example Registrar, Inc.", createdAt: "2015-08-20", expiresAt: "2027-08-20", registry: "Verisign" });
  assert.equal(yearsBetween("2015-08-20", "2026-11-25"), 11);
  assert.equal(yearsBetween("2015-12-01", "2026-11-25"), 10);
});

test("readiness run scores each site and lists what you miss; a miss row says so", async () => {
  const { runner, seen } = mock((_j, input) => (input.url === "https://rivaltwo.example" ? { outcome: "miss" } : { outcome: "hit", data: READY }));
  const res = await runOne(readiness, runner);
  assert.deepEqual(seen.map((s) => s.input.url).sort(), ["https://acme.example", "https://rivalone.example", "https://rivaltwo.example"]);
  const out = res.results.get("readiness")!.out as any;
  assert.equal(out.rows[0].about, "you");
  assert.equal(out.rows[0].missing, "AI-crawler rules, llms.txt, MCP discovery");
  assert.match(out.rows[2].status, /miss/);
  assert.match(out.summary, /42\/100/);
  const sec = readiness.render(out, "done", { public: false })!;
  assert.equal(sec.title, "Agent readiness");
  assert.ok(sec.blocks.some((b) => b.kind === "bars"));
});

test("domains run reads age, registrar and dates per domain", async () => {
  const { runner } = mock(() => ({ outcome: "hit", data: RDAP }));
  const res = await runOne(domains as any, runner);
  const out = res.results.get("domains")!.out as any;
  assert.equal(out.rows.length, 3);
  assert.equal(out.rows[0].registrar, "Example Registrar, Inc.");
  assert.equal(out.rows[0].expires, "2027-08-20");
  assert.match(out.rows[0].age, /years/);
  const sec = domains.render(out, "done", { public: false })!;
  assert.ok(sec.blocks.some((b) => b.kind === "table"));
});

test("demo fixtures render and the city has an agent readiness building", async () => {
  for (const m of [readiness, domains]) {
    const f = loadFixture(m.id);
    assert.ok(f.placeholder);
    const sec = m.render(f, "done", { public: false })!;
    assert.equal(sec.id, m.id);
    assert.ok(sec.blocks.length > 2);
  }
  const html = renderCity({ sections: [readiness.render(loadFixture("readiness"), "done", { public: false })!, domains.render(loadFixture("domains"), "done", { public: false })!, { id: "receipt", blocks: [] }], public: false, domain: "yourdomain.com", brand: "YourBrand" } as any);
  assert.match(html, /data-view="readiness"/);
  assert.match(html, /Agent readiness/);
  assert.match(html, /<a class="za zrecipe" href="https:\/\/looot\.ai\/recipes\/website-agent-readiness-check"[^>]*>Open the recipe<\/a>/);
});

test("both modules are registered, synthesis needs them, and the default worst case stays under 2", async () => {
  const ids = MODULES.map((m) => m.id);
  assert.ok(ids.includes("readiness") && ids.includes("domains"));
  assert.ok(MODULES.find((m) => m.id === "synthesis")!.needs.includes("readiness"));
  const c = normalizeConfig(loadFixture("config").config, { depth: "full" });
  const q = buildQuote(MODULES, c, await loadPriceBook({ cacheDir: ".looot-zeus-test", offline: true }));
  const sum = q.rows.reduce((n, r) => n + r.worstCapped, 0);
  assert.ok(sum < 2, `sum ${sum}`);
  assert.ok(q.rows.find((r) => r.module === "readiness")!.worstCapped <= 0.06);
});

// A raw registry record as Verisign answers it (RFC 9083), example domain, registrar only, no contact vCard.
const RAW = { objectClassName: "domain", ldhName: "EXAMPLE.COM", port43: "whois.verisign-grs.com",
  events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }, { eventAction: "expiration", eventDate: "2026-08-13T04:00:00Z" }, { eventAction: "last changed", eventDate: "2025-08-14T07:01:39Z" }],
  entities: [{ objectClassName: "entity", handle: "376", roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]] }] };

test("raw registry RDAP records (events, registrar entity) fill the fields", () => {
  assert.deepEqual(parseRdap(RAW), { registrar: "RESERVED-Internet Assigned Numbers Authority", createdAt: "1995-08-14", expiresAt: "2026-08-13", registry: "whois.verisign-grs.com" });
  assert.deepEqual(parseRdap({ data: RAW })!.createdAt, "1995-08-14");
  assert.equal(parseRawRdap({ events: [] }).registrar, null);
});

test("readiness labels use the gateway's check ids; an unknown id still reads as words", () => {
  for (const id of ["robots", "robots.ai_rules", "robots.content_signal", "robots.ai_blocked", "sitemap", "link_headers", "structured_data", "dns_aid", "llms_txt", "llms_full_txt", "markdown_negotiation", "text_without_js", "mcp_discovery", "mcp_server_card", "a2a_agent_card", "agent_skills", "api_catalog", "oauth_authorization_server", "oauth_protected_resource"]) assert.ok(CHECK_LABEL[id], id);
  assert.equal(label("robots.new_rule"), "robots new rule");
  const known = new Set(Object.values(CHECK_LABEL));
  for (const r of loadFixture("readiness").rows) for (const m of r.missing.split(", ")) assert.ok(known.has(m), `fixture label ${m}`);
});

test("section numbers are their own: not the receipt's 11, not each other's", () => {
  const r = readiness.render(loadFixture("readiness"), "done", { public: false })!.num;
  const d = domains.render(loadFixture("domains"), "done", { public: false })!.num;
  assert.deepEqual([r, d], ["12", "12B"]);
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MENU, renderCity } from "../src/city/index.js";
import { COPY_PROMPT, defaultAction, parseRequestBody, readRequests, REQUEST_SECTIONS, startServer } from "../src/requests.js";
import { PKG_ROOT } from "../src/util.js";
import type { Dossier } from "../src/dossier/index.js";

const items = MENU.flatMap((c) => c.items);
const unlock = items.filter((i) => i.state === "unlock");

test("menu.json: categories in order, unique keys, plain labels", () => {
  assert.deepEqual(MENU.map((c) => c.name), ["Get customers", "Get found", "Make content", "Watch the market", "Keep it running", "Under the hood"]);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
  for (const i of items) {
    assert.ok(i.state === "free" || i.state === "unlock", i.key);
    assert.ok(typeof i.usd === "number" && i.usd >= 0, i.key);
    for (const t of [i.label, i.sub ?? "", i.prompt]) {
      assert.ok(!t.includes(", and ") && !t.includes("—") && !t.includes("–"), `${i.key}: ${t}`);
    }
    assert.ok(!i.label.includes(":"), i.key);
    if (i.state === "unlock") assert.match(i.prompt, /\{domain\}/, i.key);
  }
  assert.equal(items.find((i) => i.key === "lookalikes")?.label, "Find 50 lookalike target accounts");
  assert.equal(items.find((i) => i.key === "readiness")?.recipe, "https://looot.ai/recipes/website-agent-readiness-check");
  assert.match(items.find((i) => i.key === "lookalikes")!.prompt, /50 lookalike accounts of the top 5/);
  for (const gone of ["Reply inbox", "Weekly report", "LinkedIn campaign", "ABM", "Demand sensing", "Battlecards", "Guardrails", "Data providers", "Next to plug in"]) {
    assert.ok(!items.some((i) => i.label === gone), gone);
  }
});

test("every unlock item is a known request section, and only refresh falls to a re-run", () => {
  for (const i of unlock) {
    assert.ok((REQUEST_SECTIONS as readonly string[]).includes(i.key), i.key);
    const a = defaultAction(i.key);
    if (i.key === "refresh") assert.equal(a, "rerun");
    else assert.notEqual(a, "rerun", i.key);
  }
  assert.equal(defaultAction("lookalikes"), "more-accounts");
  assert.equal(defaultAction("dmu"), "more-committee");
  assert.equal(defaultAction("more-creators"), "more-social");
  assert.equal(defaultAction("ranktracker"), "more-seo");
  for (const k of ["hiring", "pricing", "news", "brief", "alerts", "crm", "prospecting", "more-pages", "more-weeks", "geo", "reddit"]) assert.equal(defaultAction(k), null, k);
});

test("a section with no command asks the page to copy its prompt, never a re-run", () => {
  assert.deepEqual(parseRequestBody('{"section":"lookalikes","estCostUsd":3}'), { section: "lookalikes", action: "more-accounts", count: 10, estCostUsd: 3 });
  assert.deepEqual(parseRequestBody('{"section":"refresh"}'), { section: "refresh", action: "rerun", count: 10, estCostUsd: null });
  assert.equal(parseRequestBody('{"section":"hiring"}'), COPY_PROMPT);
  assert.equal(parseRequestBody('{"section":"brief","estCostUsd":0.5}'), COPY_PROMPT);
  assert.equal(parseRequestBody('{"section":"abm"}'), "unknown section");
});

test("serve answers 422 with copyPrompt for a section with no command and stores nothing", async () => {
  const d = mkdtempSync(join(tmpdir(), "zeus-menu-"));
  const server = await startServer({ root: d, projectDir: d, port: 0, log: () => {} });
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/zeus/next`, { method: "POST", headers: { "X-Looot-Zeus-Token": server.zeusToken }, body: JSON.stringify({ section: "hiring", estCostUsd: 1 }) });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).copyPrompt, true);
    assert.equal(readRequests(d).length, 0);
    const ok = await fetch(`http://127.0.0.1:${port}/zeus/next`, { method: "POST", headers: { "X-Looot-Zeus-Token": server.zeusToken }, body: JSON.stringify({ section: "lookalikes", estCostUsd: 3 }) });
    assert.equal(ok.status, 200);
    assert.equal(readRequests(d)[0].action, "more-accounts");
  } finally {
    server.close();
  }
});

const bare: Dossier = { domain: "acme.example", brand: "Acme", generatedAt: "2026-11-25T09:00:00.000Z", public: false, sections: [] };

test("the CLI city sidebar uses the menu categories and greys the unlock items with their prompt to copy", () => {
  const html = renderCity(bare);
  // David's sidebar: one group per menu category with an h6 heading, unlock items greyed (zun) with a copy prompt.
  const nav = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  const heads = [...nav.matchAll(/<h6>([^<]+)<\/h6>/g)].map((m) => m[1]);
  assert.deepEqual(heads, [...MENU.map((c) => c.name), "Your looot GTM OS", "More credit"]);
  for (const i of unlock) assert.ok(nav.includes(`<span class="mt">${i.label.replace("&", "&amp;")}</span>`), i.label);
  assert.match(nav, /class="zun cp" data-copy="Continue Zeus for acme\.example with looot\. Find 50 lookalike accounts/);
  assert.ok(!html.includes("{domain}"));
  assert.ok(!nav.includes("zshare"), "a private page is never offered for sharing");
  const pub = renderCity({ ...bare, public: true });
  assert.ok(!pub.includes("acme.example"));
  assert.match(pub, /Find 50 lookalike accounts of the top 5 target accounts/);
  assert.match(pub, /class="znb zshare"/);
  // Free stays what Luisa's free run makes, people stay off. One view per free menu section (David's menu, #26):
  // overview, 13 sections, the GTM OS preview, the paid list. Pages, Reddit and Market map show only what the run already made.
  assert.equal((html.match(/<section class="view"/g) ?? []).length, 16);
});

test("the hosted example page has the same menu with one-click unlock buttons", () => {
  const f = join(PKG_ROOT, "..", "city", "index.html");
  if (!existsSync(f)) return;
  const html = readFileSync(f, "utf8");
  const side = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  assert.deepEqual([...side.matchAll(/<h6>([^<]+)<\/h6>/g)].map((m) => m[1]), MENU.map((c) => c.name));
  for (const i of unlock) assert.match(side, new RegExp(`class="zun zdo" data-section="${i.key}"`), i.key);
  assert.ok(!side.includes("Available after top up"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCity, ownerBar } from "../src/city/index.js";
import { ownerCta, ctaItems } from "../src/city/ownerCta.js";
import type { Dossier } from "../src/dossier/index.js";

// A run that found SEO rows but no target accounts, no rivals and no signals.
const d: Dossier = {
  domain: "acme.test",
  brand: "Acme",
  generatedAt: "2026-11-20T10:00:00Z",
  public: true,
  sections: [
    { num: "02", id: "accounts", title: "Target accounts", status: "done", source: "looot", blocks: [{ kind: "note", text: "No accounts found." }] },
    { num: "08", id: "seo", title: "SEO", status: "done", source: "looot", blocks: [{ kind: "table", caption: "Top keywords", columns: [{ key: "kw", label: "Keyword" }], rows: [{ kw: "acme anvils" }] }] },
  ],
} as unknown as Dossier;

test("owner view: A, B and C instead of the visitor pill, Fork it and For developers; Share and CRM stay", () => {
  const owner = renderCity(d, { showBrand: true, owner: ownerCta(d) });
  const visitor = renderCity(d, { showBrand: true });
  assert.match(owner, /Complete your GTM engine/);
  assert.match(owner, />Map another company</);
  assert.match(owner, />Refresh my engine</);
  assert.doesNotMatch(owner, /Make it yours, tell your agent/);
  assert.doesNotMatch(owner, />Fork it</);
  assert.doesNotMatch(owner, /For developers/);
  assert.match(owner, /class="za zshare">Share</);
  // Export to CRM: the hosted wrapPage banner adds it on /p (web/test), and a private local page has it in the bar.
  assert.match(renderCity({ ...d, public: false }, { showBrand: true, owner: ownerCta(d) }), /Export to CRM/);
  // Visitors and the demo keep theirs and never see the owner's buttons.
  assert.match(visitor, /Make it yours, tell your agent/);
  assert.match(visitor, />Fork it</);
  assert.match(visitor, /For developers/);
  assert.doesNotMatch(visitor, /Complete your GTM engine|Complete this section|Refresh this section/);
});

test("the title is <company>'s GTM engine everywhere, City only as the picture", () => {
  for (const html of [renderCity(d, { showBrand: true, owner: ownerCta(d) }), renderCity(d, { showBrand: true })]) {
    assert.match(html, /<title>Acme&#39;s GTM engine<\/title>|<title>Acme's GTM engine<\/title>/);
    assert.match(html, /<h1>Acme(&#39;|')s GTM engine<\/h1>/);
    assert.match(html, /<span class="mt">GTM engine<\/span>/);
    assert.match(html, /Your GTM engine, drawn as a city/);
    assert.doesNotMatch(html, /Acme City/);
  }
});

test("A names exactly the missing sections, the price, the cap and ask before spending", () => {
  const c = ownerCta(d);
  const labels = c.items.map((i) => i.label);
  assert.ok(labels.includes("Target accounts"), labels.join());
  assert.ok(!labels.includes("SEO"), "SEO has data, so A does not list it");
  assert.ok(labels.includes("Signal engine") && labels.includes("Daily rhythm") && labels.includes("Campaign lanes"), labels.join());
  assert.equal(c.items.find((i) => i.label === "Target accounts")!.state, "0 found");
  const t = c.items.find((i) => i.label === "Target accounts")!;
  assert.ok(t.expected !== null && t.expected > 0 && t.worst! >= t.expected, "priced from the dated table");
  assert.ok(c.cap >= 1 && c.cap >= Math.ceil(c.items.reduce((n, i) => n + (i.worst ?? 0), 0)) - 0.001);
  for (const l of labels) assert.ok(c.prompt.includes(l), l);
  assert.ok(!c.prompt.includes("SEO ("));
  assert.match(c.prompt, new RegExp(`cap of \\$${c.cap}\\.00`));
  assert.match(c.prompt, /ask me before spending/);
  assert.match(c.prompt, /acme\.test/);
  assert.match(c.mapPrompt, /^run zeus\.looot\.ai for <their-company>\.com$/);
  assert.match(c.refreshPrompt, /what changed since 2026-11-20/);
});

test("A is hidden when nothing is missing; B and C stay", () => {
  const html = ownerBar({ ...ownerCta(d), items: [] });
  assert.doesNotMatch(html, /Complete your GTM engine/);
  assert.match(html, /Map another company/);
  assert.match(html, /Refresh my engine/);
  assert.equal(ctaItems(d).length > 0, true);
});

test("every owner section view has Refresh this section; empty ones also Complete this section, inline in the empty card", () => {
  const c = ownerCta(d);
  assert.match(c.views["targets"]!.complete!, /Complete the Target accounts section/);
  assert.match(c.views["targets"]!.complete!, /cap of \$\d+\.00/);
  assert.match(c.views["targets"]!.complete!, /ask me before spending/);
  assert.equal(c.views["seo"]!.complete, undefined);
  assert.match(c.views["seo"]!.refresh, /Refresh only the SEO section .* since 2026-11-20/);
  const html = renderCity(d, { showBrand: true, owner: c });
  const view = (id: string) => html.slice(html.indexOf(`data-view="${id}"`), html.indexOf("</section>", html.indexOf(`data-view="${id}"`)));
  assert.match(view("targets"), /Complete this section/);
  assert.match(view("targets"), /Refresh this section/);
  assert.match(view("seo"), /Refresh this section/);
  assert.doesNotMatch(view("seo"), /Complete this section/);
  assert.match(view("competitive"), /Nothing here yet[\s\S]*Complete this section/);
  assert.match(html, /data-note="Paste it into your agent \(Claude Code, Cursor, ChatGPT\)\."/);
});

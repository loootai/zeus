// "Your next plays" is the one next-steps section, last on the page and in the menu, with the old next
// steps folded in; and the city's motion never hides anything at rest (no script, a failing script or
// reduced motion leaves a complete, still page).
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCity } from "../src/city/index.js";
import { CITY_CSS } from "../src/city/style.js";
import { CITY_JS, HEAD_JS } from "../src/city/script.js";
import { MOTION_CSS } from "../src/city/motion.js";
import { matchPlays } from "../src/plays/index.js";
import { buildNextSteps } from "../src/modules/nextSteps.js";
import { synthesis, type SynthesisOut } from "../src/modules/synthesis.js";
import { normalizeConfig } from "../src/config.js";
import { HOOKS } from "../src/plays/hooks.js";
import type { Dossier } from "../src/dossier/index.js";

const findings = [
  { topic: "hiring" as const, text: "Northwind posts 3 open roles", safe: "1 account posts open roles" },
  { topic: "rivals" as const, text: "3 rivals", safe: "3 rivals" },
  { topic: "seo" as const, text: "ranks for 40 keywords", safe: "ranks for 40 keywords" },
];

function dossier(pub = false): Dossier {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.com"] });
  const plays = matchPlays({ company: "Acme", domain: "acme.example", findings });
  const out: SynthesisOut = { lines: [], plays: [], brief: { offer: "", icp: "", competitors: "" }, nextSteps: buildNextSteps(cfg, {}) };
  const summary = synthesis.render(out, "done", { public: pub })!;
  return { domain: "acme.example", brand: "Acme", generatedAt: "2026-11-26T09:00:00Z", public: pub, sections: [summary, { num: "99", id: "receipt", title: "Run log", status: "done", source: "", blocks: [] }], nextPlays: plays };
}

test("one next-steps section: Your next plays, at the end of the page and last in the menu; the old section is gone", () => {
  for (const pub of [false, true]) {
    const html = renderCity(dossier(pub), pub ? { showBrand: true, share: {} } : {});
    assert.ok(!html.includes("Next steps your agent can offer"), "the old section is removed");
    const views = [...html.matchAll(/<section class="view" data-view="([a-z-]+)"/g)].map((m) => m[1]);
    assert.equal(views.at(-1), "plays", `plays is the last view: ${views.join(",")}`);
    const side = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
    const hrefs = [...side.matchAll(/<a href="#([a-z-]+)"/g)].map((m) => m[1]);
    assert.equal(hrefs.at(-1), "plays", "the last menu entry");
    assert.equal(hrefs.filter((h) => h === "plays").length, 1, "one menu entry");
    const over = html.slice(html.indexOf('data-view="overview"'), html.indexOf("</section>", html.indexOf('data-view="overview"')));
    assert.ok(over.lastIndexOf('href="#plays"') > over.indexOf("What a paid run adds"), "the overview's plays card is its last card");
  }
});

test("the old next steps are folded into Your next plays as cards, deduped against the Atlas plays", () => {
  const d = dossier();
  const html = renderCity(d);
  const plays = html.slice(html.indexOf('data-view="plays"'));
  const hooks = plays.slice(plays.indexOf('id="play-hooks"'), plays.indexOf('id="atlas-browse"'));
  assert.ok(hooks.length > 0, "a hooks block");
  const goals = new Set(d.nextPlays!.map((p) => p.goal));
  // next-best-move is this section, so it never shows; a hook a top play covers does not show twice.
  assert.ok(!hooks.includes(HOOKS["next-best-move"].title));
  if (goals.has("Buying signals")) assert.ok(!hooks.includes(HOOKS["hiring-signals"].title));
  if (goals.has("Competitor displacement")) assert.ok(!hooks.includes(HOOKS["competitor-pricing-watch"].title));
  for (const t of [HOOKS["lookalikes-50"].title, HOOKS["trigger-alerts"].title, HOOKS["send-to-crm"].title]) assert.ok(hooks.includes(t), t);
  // Same card as a play: icon tile, chip, price, numbered title, why, Tell your agent. Numbers continue after the top plays.
  const cards = hooks.match(/<article class="card zg-card">/g) ?? [];
  assert.ok(cards.length >= 7);
  assert.equal((hooks.match(/class="zatl-i /g) ?? []).length, cards.length);
  assert.equal((hooks.match(/>Tell your agent</g) ?? []).length, cards.length);
  assert.match(hooks, new RegExp(`<h4>${d.nextPlays!.length + 1}\\. `));
  // What a paid run adds that no hook offers: people data, phones, the deeper run.
  assert.match(hooks, /Paid run/);
  assert.match(hooks, /npx looot-zeus run --people --phones --cap 10/);
  assert.match(hooks, /Run it/, "the private page can copy the command");
  const pub = renderCity(dossier(true), { showBrand: true, share: {} });
  const pubHooks = pub.slice(pub.indexOf('id="play-hooks"'), pub.indexOf('id="atlas-browse"'));
  assert.ok(pubHooks.includes(HOOKS["lookalikes-50"].title));
  assert.ok(!/zrun-h/.test(pubHooks), "no Run it on the shared page");
  assert.ok(!/<dt>Command<\/dt>/.test(pubHooks), "no command on the shared page");
});

test("motion: hidden start states need a class a script set, reduced motion sets none, the page is complete without scripts", () => {
  const html = renderCity(dossier());
  // HEAD_JS marks the page only when reduced motion is not asked for.
  assert.match(HEAD_JS, /prefers-reduced-motion: reduce/);
  assert.match(HEAD_JS, /classList\.add\('zm'\)/);
  assert.ok(html.indexOf(`<script>${HEAD_JS}</script>`) < html.indexOf("<style>"), "runs in the head, before the first paint");
  assert.ok(CITY_CSS.includes(MOTION_CSS) && CITY_JS.includes("IntersectionObserver"));
  // Every rule that hides (opacity:0) in the motion CSS is scoped to .zm or .zio.
  for (const rule of MOTION_CSS.split("}").filter((r) => /opacity:0[;}]|opacity:0$/.test(r))) assert.match(rule.trim(), /^(\.zm|\.zio)\b/, rule);
  // No script: the city's buildings are shown (David's shell hides .isd until JS adds .in).
  assert.match(MOTION_CSS, /html:not\(\.zm\) \.iso \.isd\{opacity:1!important;transform:none!important\}/);
  // A script that marks the page but never builds the city: a CSS failsafe shows it after 3.5 s.
  assert.match(MOTION_CSS, /\.zm \.iso:not\(\.in\) \.isd\{animation:zshow 0s 3\.5s forwards\}/);
  // Reduced motion: no pulses, no lift, no hidden cards, no shimmer.
  const rm = MOTION_CSS.slice(MOTION_CSS.indexOf("@media (prefers-reduced-motion:reduce)"));
  for (const s of [".zrpl{display:none}", ".zio .zrv:not(.zin){opacity:1;transform:none}", ".zsh::after{display:none}"]) assert.ok(rm.includes(s), s);
  // The motion script stops at once without .zm, and only moves opacity, transform and stroke-dashoffset.
  assert.match(CITY_JS, /if\(!H\.classList\.contains\('zm'\)\)return;/);
  for (const prop of ["width", "height", "top", "left", "margin", "padding"]) assert.ok(!new RegExp(`@keyframes [a-z]+\\{[^}]*\\b${prop}:`).test(MOTION_CSS), prop);
  // No script: every view is on the page (the router hides the others only once its script runs).
  assert.ok(CITY_JS.startsWith("document.documentElement.classList.add('zj');"));
  assert.match(MOTION_CSS, /html:not\(\.zj\) \.view\{display:block\}/);
  // The plays cards are not marked in the HTML: the script adds the hidden class only once its observer runs.
  assert.ok(!html.includes('class="card zg-card zrv"'));
});

test("the shared page header shimmers once", () => {
  assert.match(MOTION_CSS, /\.zm \.zsh::after\{[^}]*animation:zshim [^}]* 1 forwards/);
  const pub = renderCity(dossier(true), { showBrand: true, share: {} });
  assert.match(pub, /<div class="zsh">/);
});

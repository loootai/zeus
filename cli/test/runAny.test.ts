// "Run any workflow" on every generated city page (David, 26 Nov 2026): the view, the menu item, the link
// from "Your next plays", and the catalog loaded only when the view opens (zeus/workflows.js beside the page).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { CATALOG } from "../src/workflows.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

test("the city page carries the Run any workflow view and menu, loads the catalog lazily and links it from Your next plays", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-runany-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const html = readFileSync(join(dir, "gtm", "city", "index.html"), "utf8");
  assert.match(html, /<section class="view zwf-view" data-view="workflows" data-title="Run any workflow"[^>]* data-src="zeus\/workflows\.js">/);
  const side = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  assert.match(side, /href="#workflows"[^]*Run any workflow/);
  assert.doesNotMatch(html, /id="zwf-data"/, "the catalog is not inlined");
  assert.ok(html.length < 1_200_000, `page stays light (${html.length} bytes)`);
  const plays = html.slice(html.indexOf('data-view="plays"'));
  assert.match(plays, /href="#workflows">See all 1,000 workflows</);
  // The catalog file beside the page holds every workflow with its providers and the logos.
  const f = join(dir, "gtm", "city", "zeus", "workflows.js");
  assert.ok(existsSync(f));
  const src = readFileSync(f, "utf8");
  let got: { c: { name: string; o: string }[]; pv: [string, string][]; w: unknown[][] } | undefined;
  new Function("window", src)({ zwfData: (d: typeof got) => { got = d; } });
  assert.equal(got!.w.length, 1000);
  assert.deepEqual(got!.c.map((c) => c.o), CATALOG.categories.map((c) => c.outcome));
  assert.ok(got!.pv.every(([n, u]) => n && /^data:image\/webp;base64,/.test(u)));
  assert.ok(src.length < 400_000, `catalog file ${src.length} bytes`);
});

test("the city shell has Zeus's 'Do this first.' bubble pointing at the agent pill, and the pulsing bolt on the menu item", () => {
  const shell = (f: string) => readFileSync(join(PKG_ROOT, "src", "city", "shell", f), "utf8");
  assert.match(shell("dofirst.html"), /<p class="zdf-b">Do this first\.<\/p>/);
  assert.match(shell("dofirst.js"), /localStorage\.setItem\(K,'1'\)/, "Copy stops it for good");
  assert.match(shell("dofirst.css"), /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(shell("dofirst.css") + shell("workflows.css"), /@keyframes[^{]*\{[^}]*(width|height|top|left)\s*:/, "motion is transform and opacity only");
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-dofirst-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const html = readFileSync(join(dir, "gtm", "city", "index.html"), "utf8");
  const ov = html.slice(html.indexOf('data-view="overview"'), html.indexOf('<div class="sec iso-sec">'));
  assert.match(ov, /class="obar"[^]*<div class="zdf" role="note">[^]*Do this first\./, "the bubble sits right after the pill");
  const side = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  assert.match(side, /<a href="#workflows"><svg class="zwf-bolt"/);
  assert.match(html, /\.nav a \.zwf-bolt[^}]*animation:zwfbolt 2\.4s/);
});

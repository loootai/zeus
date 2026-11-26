// The Zeus mascot is on every city page: the page the CLI generates, its shell and the demo city page.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const shell = join(PKG_ROOT, "src", "city", "shell");
const LAYERS = ["body", "glow", "bolt"];

test("the generated city page carries the mascot, its three layers inline as CSS, its styles and its throw loop", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-mascot-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const html = readFileSync(join(dir, "gtm", "city", "index.html"), "utf8");
  assert.equal(html.match(/<div class="zmas-wrap" aria-hidden="true">/g)?.length, 1);
  assert.ok(html.indexOf('class="zmas-wrap"') < html.indexOf('<div class="iso" data-iso'), "mascot sits in the city section, before the map");
  for (const n of LAYERS) {
    const b64 = readFileSync(join(shell, `zeus-${n}.webp`)).toString("base64");
    assert.ok(html.includes(`.zmas-${n}{background-image:url("data:image/webp;base64,${b64}")`), n);
  }
  assert.ok(html.includes(readFileSync(join(shell, "mascot.css"), "utf8").split("{{")[0]), "mascot css");
  assert.ok(html.includes(readFileSync(join(shell, "mascot.js"), "utf8")), "mascot js");
  assert.doesNotMatch(html, /\{\{(body|glow|bolt)\}\}|<img[^>]*zmas/);
});

test("the mascot respects reduced motion, pauses when the tab is hidden and animates transform and opacity only", () => {
  const css = readFileSync(join(shell, "mascot.css"), "utf8");
  const js = readFileSync(join(shell, "mascot.js"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  for (const kf of css.match(/@keyframes [\w-]+\{.*?\}\}/g) ?? []) {
    for (const prop of kf.match(/[{;]([a-z-]+):/g) ?? []) assert.ok(/[{;](transform|opacity|stroke-dashoffset):/.test(prop), `${kf.slice(0, 30)} animates ${prop}`);
  }
});

test("each mascot layer is a small webp with no metadata chunk", () => {
  for (const n of LAYERS) {
    const f = join(shell, `zeus-${n}.webp`);
    assert.ok(statSync(f).size < 120 * 1024, n);
    const buf = readFileSync(f);
    assert.equal(buf.subarray(8, 12).toString("latin1"), "WEBP");
    assert.ok(!buf.includes(Buffer.from("EXIF")) && !buf.includes(Buffer.from("XMP ")), `${n} has no EXIF or XMP`);
  }
});

const page = join(PKG_ROOT, "..", "city", "index.html");
test("the demo city page has the same mascot, with its layers in city/assets/zeus", { skip: !existsSync(page) && "no city/index.html next to the package" }, () => {
  const html = readFileSync(page, "utf8");
  assert.equal(html.match(/<div class="zmas-wrap" aria-hidden="true">/g)?.length, 1);
  for (const n of LAYERS) {
    assert.ok(html.includes(`.zmas-${n}{background-image:url("assets/zeus/zeus-${n}.webp")`), n);
    assert.deepEqual(readFileSync(join(PKG_ROOT, "..", "city", "assets", "zeus", `zeus-${n}.webp`)), readFileSync(join(shell, `zeus-${n}.webp`)), n);
  }
  assert.ok(html.includes(readFileSync(join(shell, "mascot.js"), "utf8")));
});

// The Zeus mascot (the smiling voxel Zeus from the launch film) is on every city page: the page the CLI
// generates, its shell and the demo city page. Idle and throw clips with alpha, a still for Safari, iOS and
// reduced motion.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeSafeView } from "../src/safeView.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const shell = join(PKG_ROOT, "src", "city", "shell");
const CLIPS = ["zeus-idle.webm", "zeus-throw.webm"];
const FILES = [...CLIPS, "zeus-still.webp"];

test("the generated city page carries the mascot: still inline as CSS, both clips beside the page, styles and script", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-mascot-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const html = readFileSync(join(dir, "gtm", "city", "index.html"), "utf8");
  assert.equal(html.match(/<div class="zmas-wrap" aria-hidden="true">/g)?.length, 1);
  assert.ok(html.indexOf('class="zmas-wrap"') < html.indexOf('<div class="iso" data-iso'), "mascot sits in the city section, before the map");
  const still = readFileSync(join(shell, "zeus-still.webp")).toString("base64");
  assert.ok(html.includes(`url("data:image/webp;base64,${still}")`), "still inline");
  for (const f of CLIPS) {
    assert.ok(html.includes(`data-src="zeus/${f}"`), f);
    assert.deepEqual(readFileSync(join(dir, "gtm", "city", "zeus", f)), readFileSync(join(shell, f)), `${f} written beside the page`);
  }
  assert.ok(html.includes(readFileSync(join(shell, "mascot.css"), "utf8").split("{{")[0]), "mascot css");
  assert.ok(html.includes(readFileSync(join(shell, "mascot.js"), "utf8")), "mascot js");
  assert.doesNotMatch(html, /\{\{(still|zeus)\}\}|<img[^>]*zmas|zeus-(body|glow|bolt)|zmas-(body|glow|bolt)/);
  // the clips load only through the script (data-src), never by a src attribute in the markup
  assert.doesNotMatch(html, /<video[^>]* src=/);
});

test("the public export and the safe view get the clips next to their city pages", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-mascot-pub-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), "--public"], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  for (const f of CLIPS) assert.ok(existsSync(join(dir, "gtm", "public", "city", "zeus", f)), `public/city/zeus/${f}`);
  const view = writeSafeView(join(dir, "gtm"), join(dir, "safe-view"));
  assert.ok(view, "safe view written");
  for (const f of CLIPS) for (const sub of ["zeus", join("city", "zeus")]) assert.ok(existsSync(join(dir, "safe-view", sub, f)), `safe-view/${sub}/${f}`);
});

test("Safari, iOS and reduced motion get the still: no video, a CSS bob and the SVG bolt", () => {
  const css = readFileSync(join(shell, "mascot.css"), "utf8");
  const js = readFileSync(join(shell, "mascot.js"), "utf8");
  // reduced motion: the clips are hidden and nothing animates, the script never starts a clip or a throw
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.zmas-v\{display:none\}[^}]*animation:none/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /if\(RM\)return;/);
  assert.match(js, /VID=!RM&&alphaOk\(\)/);
  // Safari and iOS cannot draw VP9 alpha: they are detected and fall back to the still with a bob and the streak
  assert.match(js, /iP\(hone\|ad\|od\)/);
  assert.match(js, /Safari\\\//);
  assert.match(js, /canPlayType\('video\/webm; codecs="vp9"'\)/);
  assert.match(css, /\.zmas-wrap\.zmas-css \.zmas-fig\{animation:zmas-bob/);
  assert.match(js, /addEventListener\('error',css\)/, "a clip that fails falls back to the still");
  // no black box: a clip is invisible until it plays, the still is under it
  assert.match(css, /\.zmas-v\{[^}]*opacity:0/);
  assert.match(css, /\.zmas-wrap\.zmas-vid \.zmas-idle\{opacity:1\}/);
  // paused when the tab is hidden, throws on hover and every 4 to 6 s
  assert.match(js, /visibilitychange/);
  assert.match(js, /idle\.pause\(\);thr\.pause\(\)/);
  assert.match(js, /mouseenter/);
  assert.match(js, /4000\+Math\.random\(\)\*2000/);
  for (const kf of css.match(/@keyframes [\w-]+\{.*?\}\}/g) ?? []) {
    for (const prop of kf.match(/[{;]([a-z-]+):/g) ?? []) assert.ok(/[{;](transform|opacity|stroke-dashoffset):/.test(prop), `${kf.slice(0, 30)} animates ${prop}`);
  }
});

test("the mascot files are small, alpha, and carry no metadata", () => {
  assert.deepEqual(readdirSync(shell).filter((f) => /^zeus-.*\.(webp|webm|png)$/.test(f)).sort(), [...FILES].sort(), "only the new mascot files");
  const still = readFileSync(join(shell, "zeus-still.webp"));
  assert.ok(still.length < 24 * 1024, "still");
  assert.equal(still.subarray(8, 12).toString("latin1"), "WEBP");
  assert.ok(still.includes(Buffer.from("ALPH")), "still has alpha");
  assert.ok(!still.includes(Buffer.from("EXIF")) && !still.includes(Buffer.from("XMP ")), "still has no EXIF or XMP");
  for (const f of CLIPS) {
    const b = readFileSync(join(shell, f));
    assert.ok(statSync(join(shell, f)).size < 300 * 1024, f);
    assert.equal(b.readUInt32BE(0), 0x1a45dfa3, `${f} is EBML (WebM)`);
    assert.ok(b.includes(Buffer.from("V_VP9")), `${f} is VP9`);
    assert.ok(b.includes(Buffer.from([0x53, 0xc0, 0x81, 0x01])), `${f} has AlphaMode 1`);
    for (const tell of ["Lavf", "Lavc", "libvpx", "ffmpeg"]) assert.ok(!b.includes(Buffer.from(tell)), `${f} carries ${tell}`);
  }
});

const page = join(PKG_ROOT, "..", "city", "index.html");
test("the demo city page has the same mascot, with its files in city/assets/zeus", { skip: !existsSync(page) && "no city/index.html next to the package" }, () => {
  const html = readFileSync(page, "utf8");
  assert.equal(html.match(/<div class="zmas-wrap" aria-hidden="true">/g)?.length, 1);
  assert.ok(html.includes('url("assets/zeus/zeus-still.webp")'));
  for (const f of CLIPS) assert.ok(html.includes(`data-src="assets/zeus/${f}"`), f);
  for (const f of FILES) assert.deepEqual(readFileSync(join(PKG_ROOT, "..", "city", "assets", "zeus", f)), readFileSync(join(shell, f)), f);
  assert.doesNotMatch(html, /zeus-(body|glow|bolt)/);
  assert.ok(html.includes(readFileSync(join(shell, "mascot.js"), "utf8")));
});

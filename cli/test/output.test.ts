import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function demo(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), ...extra], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
}

test("demo writes the whole dossier offline", () => {
  const out = demo();
  const files = readdirSync(out);
  for (const f of ["dossier.html", "dossier.md", "receipt.json", "receipt.md", "accounts.csv", "people.csv", "plays.md", "config.yaml", "exports"]) assert.ok(files.includes(f), f);
  const html = readFileSync(join(out, "dossier.html"), "utf8");
  assert.match(html, /PLACEHOLDER DATA/);
  for (const n of ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]) assert.match(html, new RegExp(`class="num">${n}<`), `section ${n}`);
});

test("copy rules hold in every generated file: no em dash, no comma before and", () => {
  const out = demo();
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(out)) {
    const t = readFileSync(f, "utf8");
    assert.ok(!t.includes("—"), `em dash in ${f}`);
    assert.ok(!t.includes(", and "), `comma before and in ${f}`);
  }
});

test("the HTML carries no generator tag, comment or library name", () => {
  const html = readFileSync(join(demo(), "dossier.html"), "utf8");
  assert.ok(!/<meta[^>]+generator/i.test(html));
  assert.ok(!html.includes("<!--"));
  for (const w of ["typescript", "node.js", "claude", "anthropic", "openai", "generator"]) assert.ok(!html.toLowerCase().includes(w), w);
});

test("--public removes contacts and skips the outreach exports", () => {
  const out = demo(["--public"]);
  const html = readFileSync(join(out, "dossier.html"), "utf8");
  assert.ok(!html.includes("mara.vermeer@"));
  assert.doesNotMatch(html, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]+/, "a public run holds no email, masked or not");
  assert.ok(!readdirSync(out).includes("exports"));
});

// Safe demo mode: company-level data only. People show as their role with an invented name, and no
// email, phone, profile link or photo reaches output that is shared or served.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, cmdServe } from "../src/commands.js";
import { safeDossier } from "../src/dossier/safe.js";
import type { Dossier } from "../src/dossier/index.js";
import { PKG_ROOT } from "../src/util.js";
import { renderCity } from "../src/city/index.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+\d[\d ()-]{7,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/;

function run(args: string[], dir: string): string {
  return execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, LOOOT_TOKEN: "" } });
}
function demo(extra: string[] = []): { dir: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-safe-"));
  const out = join(dir, "gtm");
  run(["demo", "--out", out, ...extra], dir);
  return { dir, out };
}
const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** Real fixture names, read from the private city page. */
function realNames(out: string): string[] {
  const names = [...read(out, "city", "index.html").matchAll(/<li class="mem">.*?<b>([^<]+)<\/b>/g)].map((m) => m[1]!);
  assert.ok(names.length >= 3, "the fixture has people");
  return names;
}

function assertSafe(html: string, names: string[], what: string): void {
  assert.doesNotMatch(html, EMAIL, `${what}: email`);
  assert.doesNotMatch(html, PHONE, `${what}: phone`);
  assert.doesNotMatch(html, /linkedin\.com\/in\//i, `${what}: profile link`);
  assert.doesNotMatch(html, /<img/i, `${what}: image tag`);
  for (const n of names) assert.ok(!html.includes(n), `${what}: real name ${n}`);
}

test("private output keeps the contacts", () => {
  const { out } = demo();
  const html = read(out, "city", "index.html");
  assert.match(html, EMAIL);
  assert.match(html, /linkedin\.com\/in\//);
  assert.match(read(out, "dossier.html"), EMAIL);
  assert.ok(existsSync(join(out, "people.csv")));
  assert.match(read(out, "people.csv"), EMAIL);
});

test("demo --safe-demo: city page, dossier and markdown hold roles and invented names only", () => {
  const priv = demo();
  const names = realNames(priv.out);
  const { out } = demo(["--safe-demo"]);
  for (const f of ["city/index.html", "dossier.html", "dossier.md"]) assertSafe(read(out, f), names, f);
  const city = read(out, "city", "index.html");
  assert.match(city, /class="mem"/);
  assert.match(city, /Champion/);
  assert.match(city, /Alex Rivera/);
  assert.ok(!existsSync(join(out, "exports")), "no outreach exports in safe output");
  assert.doesNotMatch(read(out, "people.csv"), EMAIL);
});

test("--public run: city page is safe too", () => {
  const names = realNames(demo().out);
  const { out } = demo(["--public"]);
  assertSafe(read(out, "city", "index.html"), names, "city");
  assertSafe(read(out, "dossier.html"), names, "dossier");
});

test("export --public writes a safe city page from a private folder", () => {
  const { dir, out } = demo();
  const names = realNames(out);
  run(["export", "--public", "--out", out], dir);
  const pub = join(out, "public");
  for (const f of ["city/index.html", "dossier.html", "dossier.md", "receipt.json"]) assert.ok(existsSync(join(pub, f)), f);
  for (const f of ["city/index.html", "dossier.html", "dossier.md"]) assertSafe(read(pub, f), names, `public/${f}`);
  assert.match(read(pub, "city", "index.html"), /Champion/);
  assert.match(read(out, "city", "index.html"), EMAIL, "the private page is untouched");
});

async function get(port: number, path: string): Promise<string> {
  return await (await fetch(`http://127.0.0.1:${port}${path}`)).text();
}

test("serve is safe by default and --private opts out with a warning", async () => {
  const { dir, out } = demo();
  const names = realNames(out);
  const lines: string[] = [];
  const s1 = await cmdServe({ port: "43911" }, out, { projectDir: dir, log: (l) => lines.push(l) });
  try {
    assertSafe(await get(43911, "/"), names, "served city");
    assertSafe(await get(43911, "/dossier.html"), names, "served dossier");
  } finally {
    s1.close();
  }
  const lines2: string[] = [];
  const s2 = await cmdServe({ port: "43912", private: true }, out, { projectDir: dir, log: (l) => lines2.push(l) });
  try {
    assert.match(await get(43912, "/city/index.html"), EMAIL);
    assert.ok(lines2.some((l) => /private/i.test(l) && /contact/i.test(l)), "warning line");
  } finally {
    s2.close();
  }
  const s3 = await cmdServe({ port: "43913", private: true, "safe-demo": true }, out, { projectDir: dir, log: () => {} });
  try {
    assertSafe(await get(43913, "/"), names, "--safe-demo wins over --private");
  } finally {
    s3.close();
  }
});

test("safeDossier is deterministic and scrubs free text and non-people cells", () => {
  const d: Dossier = {
    domain: "acme.test", brand: "Acme", generatedAt: "2026-01-01T00:00:00Z", public: false,
    sections: [{ num: "", id: "committee", title: "C", status: "done", source: "t", blocks: [
      { kind: "committee", items: [{ account: "Co", domain: "co.test", grade: "A", companyPhone: "+31 20 555 0101", members: [
        { role: "Champion", name: "Pat Example", title: "Head of Growth", email: "pat@co.test", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/pat", phone: "+31612345678", phoneStatus: "found" },
        { role: "Economic buyer", name: "Sam Sample", title: "CFO", email: "", emailStatus: "not found", linkedin: "", phone: "", phoneStatus: "not found" },
      ] }] },
      { kind: "text", text: "Pat Example (pat@co.test, +31 6 1234 5678, linkedin.com/in/pat) replied." },
      { kind: "table", columns: [{ key: "n", label: "Name", pii: "name" }, { key: "e", label: "Email", pii: "email" }], rows: [{ n: "Sam Sample", e: "sam@co.test" }] },
    ] }],
  };
  const a = renderCity(safeDossier(d));
  assert.equal(renderCity(safeDossier(d)), a);
  assertSafe(a, ["Pat Example", "Sam Sample"], "unit");
  assert.match(a, /Head of Growth/);
  assert.match(a, /CFO/);
  assert.match(a, /Champion/);
  assert.notEqual(renderCity(d), a);
});

test("plain serve ignores a ./city page with real contacts in the project folder", async () => {
  const { dir, out } = demo();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(dir, "city"), { recursive: true });
  writeFileSync(join(dir, "city", "index.html"), "<p>real@contact.test</p>");
  const names = realNames(out);
  const s = await cmdServe({ port: "43921" }, out, { projectDir: dir, log: () => {} });
  try {
    const html = await get(43921, "/");
    assert.doesNotMatch(html, /real@contact\.test/);
    assertSafe(html, names, "served city");
  } finally {
    s.close();
  }
  const s2 = await cmdServe({ port: "43922", private: true }, out, { projectDir: dir, log: () => {} });
  try {
    assert.match(await get(43922, "/"), /real@contact\.test/);
  } finally {
    s2.close();
  }
});

test("plain serve with no saved run refuses instead of serving the folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-safe-"));
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(dir, "gtm"), { recursive: true });
  writeFileSync(join(dir, "gtm", "dossier.html"), "<p>real@contact.test</p>");
  await assert.rejects(cmdServe({ port: "43923" }, join(dir, "gtm"), { projectDir: dir, log: () => {} }), (e: unknown) => e instanceof CliExit && e.code === 2);
});

test("serve --dir refuses an unsafe folder, accepts the run folder and gtm/public, and never exposes CSVs or state.json", async () => {
  const { dir, out } = demo();
  const names = realNames(out);
  run(["export", "--public", "--out", out], dir);
  await assert.rejects(cmdServe({ port: "43924", dir: join(out, "exports") }, out, { projectDir: dir, log: () => {} }), (e: unknown) => e instanceof CliExit && e.code === 2);
  // The run folder itself is replaced by the safe copy: no CSV, no state.json.
  const s = await cmdServe({ port: "43925", dir: out }, out, { projectDir: dir, log: () => {} });
  try {
    assertSafe(await get(43925, "/"), names, "--dir run folder");
    for (const f of ["/people.csv", "/state.json", "/exports/instantly.csv"]) assert.equal((await fetch(`http://127.0.0.1:43925${f}`)).status, 404, f);
  } finally {
    s.close();
  }
  const s2 = await cmdServe({ port: "43926", dir: join(out, "public") }, out, { projectDir: dir, log: () => {} });
  try {
    assertSafe(await get(43926, "/city/index.html"), names, "--dir public");
  } finally {
    s2.close();
  }
  const lines: string[] = [];
  const s3 = await cmdServe({ port: "43927", dir: join(out, "exports"), private: true }, out, { projectDir: dir, log: (l) => lines.push(l) });
  s3.close();
  assert.ok(lines.some((l) => /WARNING/.test(l)));
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cmdDelete } from "../src/commands.js";
import { privatePaths, UnsafeDeleteError } from "../src/deleteLocal.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function fixture(): string {
  const d = mkdtempSync(join(tmpdir(), "zeus-del-"));
  const put = (rel: string, body = "x") => {
    mkdirSync(join(d, rel, ".."), { recursive: true });
    writeFileSync(join(d, rel), body);
  };
  for (const f of ["gtm/config.yaml", "gtm/people.csv", "gtm/accounts.csv", "gtm/committee.csv", "gtm/state.json", "gtm/dossier.html", "gtm/exports/instantly.csv", "gtm/city/index.html", "gtm/public/dossier.html", "gtm/public/city/index.html", ".looot-zeus/requests.json", ".looot-zeus/safe-view/index.html", "city/data/contacts.json", "city/data/contacts-extra.json", "city/data/accounts.json", "city/img/people/p1.png", "city/img/logo.png", "notes.txt", "gtm/my-own-notes.txt"]) put(f);
  return d;
}

test("delete --yes removes the private output and keeps config, public city data and other files", async () => {
  const d = fixture();
  const logs: string[] = [];
  const removed = await cmdDelete({ yes: true }, "gtm", { projectDir: d, log: (l) => logs.push(l) });
  for (const gone of ["gtm/people.csv", "gtm/accounts.csv", "gtm/committee.csv", "gtm/state.json", "gtm/dossier.html", "gtm/exports", "gtm/city", "gtm/public", ".looot-zeus", "city/data/contacts.json", "city/data/contacts-extra.json", "city/img/people"]) assert.equal(existsSync(join(d, gone)), false, gone);
  for (const kept of ["gtm/config.yaml", "gtm/my-own-notes.txt", "city/data/accounts.json", "city/img/logo.png", "notes.txt"]) assert.equal(existsSync(join(d, kept)), true, kept);
  assert.equal(removed.length, logs.filter((l) => l.startsWith("Removed ")).length);
  assert.match(logs.join("\n"), /Removed .*people\.csv/);
});

test("delete --keep-public keeps gtm/public", async () => {
  const d = fixture();
  await cmdDelete({ yes: true, "keep-public": true }, "gtm", { projectDir: d, log: () => {} });
  assert.equal(existsSync(join(d, "gtm/public/dossier.html")), true);
  assert.equal(existsSync(join(d, "gtm/people.csv")), false);
});

test("delete asks y/N and deletes nothing on no", async () => {
  const d = fixture();
  const asked: string[] = [];
  const logs: string[] = [];
  const removed = await cmdDelete({}, "gtm", { projectDir: d, isTTY: true, ask: async (q) => (asked.push(q), "n"), log: (l) => logs.push(l) });
  assert.deepEqual(removed, []);
  assert.match(asked[0], /\[y\/N\]/);
  assert.equal(existsSync(join(d, "gtm/people.csv")), true);
  assert.match(logs.join("\n"), /Nothing was deleted/);
  await cmdDelete({}, "gtm", { projectDir: d, isTTY: true, ask: async () => "y", log: () => {} });
  assert.equal(existsSync(join(d, "gtm/people.csv")), false);
});

test("delete without a terminal and without --yes deletes nothing", () => {
  const d = fixture();
  assert.throws(() => execFileSync(process.execPath, [cli, "delete"], { cwd: d, stdio: "pipe" }));
  assert.equal(existsSync(join(d, "gtm/people.csv")), true);
  const out = execFileSync(process.execPath, [cli, "delete", "--yes"], { cwd: d, encoding: "utf8" });
  assert.match(out, /Deleted \d+ items/);
  assert.equal(existsSync(join(d, "gtm/people.csv")), false);
  assert.match(execFileSync(process.execPath, [cli, "delete", "--yes"], { cwd: d, encoding: "utf8" }), /Nothing to delete/);
});

test("help lists delete and the retention", () => {
  const h = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(h, /delete .*Remove the local files/);
  assert.match(h, /30 days/);
});

test("delete refuses the project folder, a parent, anything outside the project and /", () => {
  const d = fixture();
  for (const out of [".", "", d, "..", join(d, ".."), "/", "../elsewhere", "gtm/../..", tmpdir()]) {
    assert.throws(() => privatePaths({ outDir: out, projectDir: d }), UnsafeDeleteError, out);
  }
  assert.throws(() => execFileSync(process.execPath, [cli, "delete", "--yes", "--out", "."], { cwd: d, stdio: "pipe" }));
  assert.throws(() => execFileSync(process.execPath, [cli, "delete", "--yes", "--out", "/"], { cwd: d, stdio: "pipe" }));
  assert.equal(existsSync(join(d, "notes.txt")), true);
  assert.equal(existsSync(join(d, "gtm/people.csv")), true);
});

test("delete removes only known Zeus output names", () => {
  const d = fixture();
  const paths = privatePaths({ outDir: "gtm", projectDir: d });
  assert.equal(paths.some((p) => p.endsWith("my-own-notes.txt") || p.endsWith("config.yaml") || p.endsWith("notes.txt")), false);
});

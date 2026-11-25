import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT, round6 } from "../src/util.js";
import { sectionCostRows } from "../src/dossier/index.js";
import { validateReceipt, type Receipt } from "../src/receipt.js";
import { PAID_ADDS } from "../src/city/index.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const out = (() => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-cost-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
})();
const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8")) as Receipt;

test("the demo receipt still matches the schema with the section caps in it", () => {
  assert.deepEqual(validateReceipt(receipt), []);
  assert.ok(receipt.modules.every((m) => typeof m.worstCapped === "number"));
});

test("spent per section equals the receipt's charged calls summed by module, and totals match", () => {
  const { rows, total } = sectionCostRows(receipt);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    const mine = receipt.calls.filter((c) => c.module === r.id);
    assert.equal(r.spent, round6(mine.reduce((n, c) => n + c.charged, 0)), r.id);
    assert.equal(r.paidCalls, mine.filter((c) => !c.replayed).length, r.id);
    assert.ok(r.worst <= (receipt.modules.find((m) => m.id === r.id)!.worst) + 1e-9, r.id);
  }
  assert.equal(total.spent, receipt.run.charged);
  for (const r of rows) assert.ok(r.expected <= r.worst + 1e-9, `${r.id} expected ${r.expected} above worst ${r.worst}`);
  assert.equal(total.expected, round6(rows.reduce((n, r) => n + r.expected, 0)));
  assert.equal(total.worst, round6(rows.reduce((n, r) => n + r.worst, 0)));
  assert.equal(total.paidCalls, receipt.calls.filter((c) => !c.replayed).length);
});

for (const page of ["dossier.html", join("city", "index.html")]) {
  test(`${page} shows the quoted and spent table with a totals row and the token line`, () => {
    const html = readFileSync(join(out, page), "utf8");
    assert.match(html, /Quoted and spent by section/);
    for (const h of ["Quoted, expected", "Quoted, worst case under caps", "Spent", "Paid calls", "Section cap"]) assert.match(html, new RegExp(h), h);
    assert.match(html, />Total</);
    assert.match(html, /run cap /);
    assert.match(html, /Model tokens of your agent are not included/);
  });
}

test("the paid card lists only commands Zeus has", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  for (const p of PAID_ADDS) {
    const [, cmd, ...rest] = p.command.split(" ");
    assert.match(help, new RegExp(`\\b${cmd}\\b`), p.command);
    for (const f of rest.filter((x) => x.startsWith("--"))) assert.match(help, new RegExp(f), f);
  }
});

test("the demo receipt never spends above a section cap or the run cap", () => {
  for (const m of receipt.modules) {
    const mine = receipt.calls.filter((c) => c.module === m.id);
    if (m.cap?.usd !== undefined) assert.ok(m.charged <= m.cap.usd + 1e-9, `${m.id} ${m.charged} > ${m.cap.usd}`);
    if (m.cap?.runs !== undefined) assert.ok(mine.length <= m.cap.runs, `${m.id} ${mine.length} calls > ${m.cap.runs}`);
  }
  assert.ok(receipt.run.charged <= receipt.run.cap + 1e-9);
  const fixture = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8")) as Receipt;
  for (const m of fixture.modules) if (m.cap?.usd !== undefined) assert.ok(m.charged <= m.cap.usd + 1e-9, `fixture ${m.id}`);
});

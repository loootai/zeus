import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { validateReceipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";

test("fixtures/placeholder-receipt.json matches the schema and says it is a placeholder", () => {
  const r = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8"));
  assert.deepEqual(validateReceipt(r), []);
  assert.match(r.placeholder, /PLACEHOLDER/);
  assert.ok(r.calls.length > 100);
  for (const o of ["hit", "miss", "fail", "fallback"]) assert.ok(r.calls.some((c: any) => c.outcome === o), `has a ${o} row`);
});

test("the validator catches a wrong outcome, a missing field and a bad total", () => {
  const r = JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), "utf8"));
  const bad = structuredClone(r);
  bad.calls[0].outcome = "ok";
  assert.ok(validateReceipt(bad).some((e) => e.includes("outcome")));
  const missing = structuredClone(r);
  delete missing.run.cap;
  assert.ok(validateReceipt(missing).some((e) => e.includes("cap")));
  const total = structuredClone(r);
  total.run.charged += 1;
  assert.ok(validateReceipt(total).some((e) => e.includes("differs")));
});

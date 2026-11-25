import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger, CapReached, checkQuoteAgainstCap, suggestCap } from "../src/cap.js";

test("allocation follows the worst-case quote share", () => {
  const l = new CapLedger(10, [{ id: "a", worst: 6 }, { id: "b", worst: 2 }, { id: "c", worst: 2 }]);
  assert.equal(l.allocation("a"), 6);
  assert.equal(l.allocation("b"), 2);
  assert.equal(l.allocation("c"), 2);
});

test("allocation scales down when the worst case is above the cap", () => {
  const l = new CapLedger(1, [{ id: "a", worst: 3 }, { id: "b", worst: 1 }]);
  assert.equal(l.allocation("a"), 0.75);
  assert.equal(l.allocation("b"), 0.25);
});

test("hard stop when spent plus the next ceiling would pass the cap", () => {
  const l = new CapLedger(0.1, [{ id: "a", worst: 1 }]);
  for (let i = 0; i < 4; i++) l.reserve("a", 0.02)(0.02);
  assert.equal(l.spent, 0.08);
  l.reserve("a", 0.02)(0.02);
  assert.equal(l.spent, 0.1);
  assert.throws(() => l.reserve("a", 0.001), (e: unknown) => e instanceof CapReached && e.scope === "run");
});

test("a call is checked at its ceiling, then settled at its real charge", () => {
  const l = new CapLedger(0.05, [{ id: "a", worst: 1 }]);
  const settle = l.reserve("a", 0.04);
  assert.throws(() => l.reserve("a", 0.02), CapReached, "reserved ceiling counts while the call is open");
  settle(0.001);
  assert.equal(l.spent, 0.001);
  l.reserve("a", 0.04)(0);
});

test("a module stops at its share while others still run", () => {
  const l = new CapLedger(1, [{ id: "a", worst: 1 }, { id: "b", worst: 1 }]);
  l.reserve("a", 0.5)(0.5);
  assert.throws(() => l.reserve("a", 0.01), (e: unknown) => e instanceof CapReached && e.scope === "module");
  l.reserve("b", 0.3)(0.3);
});

test("what a finished module left unspent goes to the pool", () => {
  const l = new CapLedger(1, [{ id: "a", worst: 1 }, { id: "b", worst: 1 }]);
  l.reserve("b", 0.1)(0.1);
  l.finish("b");
  assert.equal(l.pool(), 0.4);
  l.reserve("a", 0.5)(0.5);
  l.reserve("a", 0.4)(0.4);
  assert.throws(() => l.reserve("a", 0.01), CapReached);
});

test("a quote above the cap is refused, a worst case above it warns", () => {
  assert.equal(checkQuoteAgainstCap(11, 20, 10).ok, false);
  const warn = checkQuoteAgainstCap(5, 20, 10);
  assert.equal(warn.ok, true);
  assert.match(warn.message, /partial dossier/);
  assert.equal(checkQuoteAgainstCap(1, 2, 10).ok, true);
  assert.equal(suggestCap(6.27), 7);
  assert.equal(suggestCap(0.2), 1);
});

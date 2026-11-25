import assert from "node:assert/strict";
import { test } from "node:test";
import { CapLedger } from "../src/cap.js";
import { COST_UNKNOWN, LoootClient } from "../src/client.js";

const opts = { module: "enrich", step: "find:1", maxCostUsd: 0.03, quotedUsd: 0.0036 };

/** A fake clock that moves on every sleep, so poll and read-back deadlines pass without waiting. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("timeout: the run is still running, the call counts at its ceiling, a later read-back settles the real charge", async () => {
  const c = clock();
  let gets = 0;
  const fake: typeof fetch = async (_u, init) => {
    if (init?.method === "POST") return json({ runId: "r1", status: "running" }, 201);
    gets++;
    // Still running through the poll timeout, settled during the read-back.
    return json(c.now() > 1000 ? { runId: "r1", status: "completed", outcome: "hit", actualCost: 0.004 } : { runId: "r1", status: "running" });
  };
  const client = new LoootClient({ token: "t", fetch: fake, ...c, pollTimeoutMs: 1000, pollIntervalMs: 500, readBackMs: 5000 });
  const { record } = await client.call("people.email.find", {}, opts);
  assert.ok(gets > 2);
  assert.equal(record.charged, 0.004);
  assert.equal(record.costUnknown, undefined);
});

test("timeout and the read-back never settles: the ceiling stays on the cap and the line says cost unknown", async () => {
  const c = clock();
  const fake: typeof fetch = async (_u, init) => (init?.method === "POST" ? json({ runId: "r1", status: "running" }, 201) : json({ runId: "r1", status: "running" }));
  const client = new LoootClient({ token: "t", fetch: fake, ...c, pollTimeoutMs: 1000, pollIntervalMs: 500, readBackMs: 2000 });
  const { record } = await client.call("people.email.find", {}, opts);
  assert.equal(record.charged, 0.03);
  assert.equal(record.costUnknown, true);
  assert.match(record.note!, new RegExp(COST_UNKNOWN));
  // --cap holds: the ledger counts the ceiling, not $0.
  const ledger = new CapLedger(0.05, [{ id: "enrich", worst: 1 }]);
  ledger.reserve("enrich", 0.03)(record.charged);
  assert.equal(ledger.spent, 0.03);
  assert.throws(() => ledger.reserve("enrich", 0.03));
});

test("disconnect while polling: the run id is known, the read-back settles it", async () => {
  const c = clock();
  let gets = 0;
  const fake: typeof fetch = async (_u, init) => {
    if (init?.method === "POST") return json({ runId: "r2", status: "running" }, 201);
    if (++gets === 1) throw new TypeError("fetch failed");
    return json({ runId: "r2", status: "completed", outcome: "miss", actualCost: 0.001 });
  };
  const client = new LoootClient({ token: "t", fetch: fake, ...c, pollIntervalMs: 100 });
  const { record } = await client.call("people.email.find", {}, opts);
  assert.equal(record.charged, 0.001);
  assert.equal(record.outcome, "miss");
  assert.equal(record.costUnknown, undefined);
});

test("disconnect on the POST: no run id to read back, the call counts at its ceiling", async () => {
  const c = clock();
  const client = new LoootClient({ token: "t", fetch: async () => { throw new TypeError("fetch failed"); }, ...c });
  const { record } = await client.call("people.email.find", {}, opts);
  assert.equal(record.charged, 0.03);
  assert.equal(record.costUnknown, true);
  assert.match(record.note!, /connection_lost/);
});

test("5xx on the POST counts at the ceiling; a 4xx refusal still costs nothing", async () => {
  const c = clock();
  const five = new LoootClient({ token: "t", fetch: async () => json({ error: { code: "internal_error" } }, 502), ...c });
  const r5 = (await five.call("people.email.find", {}, opts)).record;
  assert.equal(r5.charged, 0.03);
  assert.equal(r5.costUnknown, true);
  const four = new LoootClient({ token: "t", fetch: async () => json({ error: { code: "validation_error" } }, 400), ...c });
  const r4 = (await four.call("people.email.find", {}, opts)).record;
  assert.equal(r4.charged, 0);
  assert.equal(r4.costUnknown, undefined);
});

test("read-back fails (every GET errors): the ceiling stays and the line says cost unknown", async () => {
  const c = clock();
  const fake: typeof fetch = async (_u, init) => (init?.method === "POST" ? json({ runId: "r3", status: "running" }, 201) : json({ error: { code: "internal_error" } }, 503));
  const client = new LoootClient({ token: "t", fetch: fake, ...c, pollIntervalMs: 500, readBackMs: 2000 });
  const { record } = await client.call("people.email.find", {}, opts);
  assert.equal(record.charged, 0.03);
  assert.equal(record.costUnknown, true);
});

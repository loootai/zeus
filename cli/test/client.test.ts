import assert from "node:assert/strict";
import { test } from "node:test";
import { idempotencyKey, LoootClient, toRecord } from "../src/client.js";

const opts = { module: "enrich", step: "find:1", maxCostUsd: 0.03, quotedUsd: 0.0036 };

test("idempotency key is stable across key order and changes with module, step or input", () => {
  const a = idempotencyKey("enrich", "find:1", { name: "Jane", domain: "a.example" });
  assert.equal(a, idempotencyKey("enrich", "find:1", { domain: "a.example", name: "Jane" }));
  assert.notEqual(a, idempotencyKey("enrich", "find:2", { name: "Jane", domain: "a.example" }));
  assert.notEqual(a, idempotencyKey("people", "find:1", { name: "Jane", domain: "a.example" }));
  assert.notEqual(a, idempotencyKey("enrich", "find:1", { name: "Jan", domain: "a.example" }));
});

test("outcome mapping: hit, fallback, miss, fail", () => {
  const ts = "2026-10-30T09:00:00.000Z";
  const hit = toRecord({ runId: "r1", status: "completed", outcome: "hit", actualCost: 0.0036, route: { servedBy: "kittai", attempts: [{ provider: "kittai", outcome: "hit" }] } }, "people.email.find", opts, 10, ts);
  assert.equal(hit.outcome, "hit");
  assert.equal(hit.charged, 0.0036);
  const fb = toRecord({ runId: "r2", status: "completed", outcome: "hit", actualCost: 0.0086, route: { servedBy: "findymail", attempts: [{ provider: "kittai", outcome: "miss" }, { provider: "findymail", outcome: "hit" }] } }, "people.email.find", opts, 10, ts);
  assert.equal(fb.outcome, "fallback");
  assert.equal(fb.fallbackFrom, "kittai");
  assert.equal(fb.provider, "findymail");
  const miss = toRecord({ runId: "r3", status: "completed", outcome: "miss", actualCost: 0 }, "people.email.find", opts, 10, ts);
  assert.equal(miss.outcome, "miss");
  const fail = toRecord({ runId: "r4", status: "failed", outcome: "error", actualCost: null, error: { code: "provider_error", whoseError: "provider" } }, "people.email.find", opts, 10, ts);
  assert.equal(fail.outcome, "fail");
  assert.equal(fail.charged, 0);
  assert.match(fail.note!, /provider_error/);
  const pending = toRecord({ runId: "r5", status: "running" }, "chatgpt.search.answer", opts, 10, ts);
  assert.equal(pending.outcome, "fail");
  assert.match(pending.note!, /still running/);
});

test("a run goes to job:<id> with fallback and the per-call ceiling, then polls", async () => {
  const sent: any[] = [];
  let polls = 0;
  const fake: typeof fetch = async (url, init) => {
    const u = String(url);
    if (init?.method === "POST") {
      sent.push(JSON.parse(String(init.body)));
      assert.match(String((init.headers as Record<string, string>).Authorization), /^Bearer /);
      return new Response(JSON.stringify({ runId: "run_1", status: "queued" }), { status: 201 });
    }
    polls++;
    assert.ok(u.endsWith("/v1/runs/run_1"));
    return new Response(JSON.stringify({ runId: "run_1", status: "completed", outcome: "hit", actualCost: 0.001, route: { servedBy: "serper", attempts: [{ provider: "serper", outcome: "hit" }] }, result: { ok: 1 } }), { status: 200 });
  };
  const c = new LoootClient({ token: "test-token", fetch: fake, sleep: async () => {}, baseUrl: "https://api.test" });
  const r = await c.call("news.search", { query: "acme" }, { module: "signals", step: "news:acme", maxCostUsd: 0.01, quotedUsd: 0.001 });
  assert.equal(sent[0].endpointId, "job:news.search");
  assert.deepEqual(sent[0].fallback, { enabled: true, maxAttempts: 3, maxCostUsd: 0.01 });
  assert.equal(sent[0].idempotencyKey, idempotencyKey("signals", "news:acme", { query: "acme" }));
  assert.equal(polls, 1);
  assert.equal(r.record.outcome, "hit");
  assert.equal(r.record.charged, 0.001);
  assert.deepEqual(r.data, { ok: 1 });
});

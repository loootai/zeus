// looot-zeus push: the city goes to zeus.looot.ai as plain data with the user's own key. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildPushBundle, pushCity, pushHostAllowed, pushLines, pushToken } from "../src/push.js";
import { cmdPush, CliExit } from "../src/commands.js";
import { PKG_ROOT } from "../src/util.js";

const RUN = "run_" + "d".repeat(32);

/** A demo folder turned into a "real" run for acme.com: no placeholder, a receipt with a looot run id. */
function realRun(): string {
  const root = mkdtempSync(join(tmpdir(), "looot-zeus-push-"));
  const dir = join(root, "gtm");
  execFileSync(process.execPath, [join(PKG_ROOT, "dist", "src", "cli.js"), "demo", "--out", dir], { cwd: root, env: { ...process.env, LOOOT_TOKEN: "" } });
  const sf = join(dir, "state.json");
  const state = JSON.parse(readFileSync(sf, "utf8").split("yourdomain.com").join("acme.com"));
  delete state.placeholder;
  writeFileSync(sf, JSON.stringify(state));
  const receipt = {
    schemaVersion: "1",
    run: { domain: "acme.com", startedAt: "2026-11-26T09:00:00.000Z", finishedAt: "2026-11-26T09:02:00.000Z", cap: 1, expected: 0.5, charged: 0.4, calls: 3, durationMs: 120000 },
    modules: [{ id: "intake", label: "Intake", status: "done", calls: 1, quoted: 0.1, worst: 0.2, charged: 0.1, summary: "config draft from 4 pages", startedAtMs: 0, endedAtMs: 10 }],
    calls: [{ module: "intake", job: "web.scrape.markdown", provider: "x", outcome: "hit", quoted: 0.1, charged: 0.1, ms: 10, ts: "2026-11-26T09:00:01.000Z", runId: RUN }],
  };
  writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt));
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ schemaVersion: "1", at: "2026-11-26T09:02:00.000Z", domain: "acme.com", brand: "Acme", charged: 0.4, calls: 3, competitors: [{ domain: "globex.com", name: "Globex" }], accounts: [], people: [], rivals: [], ranks: [], signals: [], mentions: [], ads: [] }));
  return dir;
}

test("the push bundle is the safe city as data: no HTML, no contacts, the public share copy beside it", () => {
  const b = buildPushBundle(realRun());
  assert.equal(b.schema, "zeus.push.v1");
  assert.equal(b.domain, "acme.com");
  assert.equal(b.city.domain, "acme.com");
  assert.equal(b.city.public, true);
  // The weekly GitHub Actions file names a noreply bot address; that is not a contact.
  const text = JSON.stringify({ ...b.city, weekly: undefined });
  assert.doesNotMatch(text, /<html|<script|<div/i, "no HTML in the bundle");
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, "no email address in the city");
  assert.equal(b.share?.schema, "zeus.share.v2");
});

test("a demo or placeholder run is never pushed", () => {
  const root = mkdtempSync(join(tmpdir(), "looot-zeus-push-demo-"));
  const dir = join(root, "gtm");
  execFileSync(process.execPath, [join(PKG_ROOT, "dist", "src", "cli.js"), "demo", "--out", dir], { cwd: root, env: { ...process.env, LOOOT_TOKEN: "" } });
  assert.throws(() => buildPushBundle(dir), /demo or placeholder/);
  assert.throws(() => buildPushBundle(join(root, "nothing")), /No run/);
});

test("the key only goes to Zeus hosts", () => {
  for (const ok of ["https://zeus.looot.ai", "https://zeus.looot.ai/", "http://127.0.0.1:3000", "http://localhost:8080"]) assert.ok(pushHostAllowed(ok), ok);
  for (const no of ["http://zeus.looot.ai", "https://zeus.looot.ai.evil.test", "https://evil.test", "https://user:pw@zeus.looot.ai", "http://10.0.0.1", "file:///etc/passwd", "not a url", "https://looot-zeus-x.vercel.app", "https://api.looot.ai", "https://zeus.looot.ai:8443"]) assert.ok(!pushHostAllowed(no), no);
});

test("pushCity sends the bundle with Bearer to /api/cities and reads the answer; another host is refused before any call", async () => {
  const seen: { url: string; auth: string; method: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), auth: String((init?.headers as Record<string, string>).authorization), method: String(init?.method) });
    return Response.json({ ok: true, domain: "acme.com", url: "https://zeus.looot.ai/p/acme.com", share: { available: true, hint: "Open it and press Share." } }, { status: 201 });
  }) as unknown as typeof fetch;
  const b = buildPushBundle(realRun());
  const r = await pushCity(b, { token: "tok_test_value_123456", fetch: f });
  assert.deepEqual(seen, [{ url: "https://zeus.looot.ai/api/cities", auth: "Bearer tok_test_value_123456", method: "POST" }]);
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://zeus.looot.ai/p/acme.com");
  assert.match(pushLines(r).join("\n"), /Pushed to Zeus: https:\/\/zeus\.looot\.ai\/p\/acme\.com[\s\S]*Share/);
  await assert.rejects(pushCity(b, { token: "tok", baseUrl: "https://evil.test", fetch: f }), /not a Zeus host/);
  assert.equal(seen.length, 1);
});

test("push refused: the errors are printed one per line and the command exits 1", async () => {
  const lines: string[] = [];
  await assert.rejects(cmdPush(realRun(), { log: (l) => lines.push(l), push: async () => ({ ok: false, status: 422, message: "The city has 1 problem.", errors: ["city.sections[0].id must be a short lowercase id"] }) }), (e) => e instanceof CliExit && e.code === 1);
  assert.match(lines.join("\n"), /Push refused \(422\)[\s\S]*- city\.sections\[0\]\.id must be a short lowercase id/);
});

test("pushToken: LOOOT_TOKEN, then LOOOT_API_KEY; none means no push", () => {
  assert.equal(pushToken({ LOOOT_TOKEN: " a ", LOOOT_API_KEY: "b", LOOOT_ZEUS_NO_SAVED_LOGIN: "1" }), "a");
  assert.equal(pushToken({ LOOOT_API_KEY: "b", LOOOT_ZEUS_NO_SAVED_LOGIN: "1" }), "b");
  assert.equal(pushToken({ LOOOT_ZEUS_NO_SAVED_LOGIN: "1" }), null);
});

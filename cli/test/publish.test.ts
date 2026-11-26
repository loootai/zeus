// export --public --publish and export --unpublish: the share bundle and the call to looot-pages. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildShareBundle, publishShare, unpublishShare } from "../src/publish.js";
import { PKG_ROOT } from "../src/util.js";

const RUN = "run_" + "c".repeat(32);

function out(over: { placeholder?: boolean; summary?: string } = {}): string {
  // A saved run (state.json) from the demo, so the bundle can carry the city; receipt and snapshot are this test's.
  const root = mkdtempSync(join(tmpdir(), "looot-zeus-publish-"));
  const dir = join(root, "gtm");
  execFileSync(process.execPath, [join(PKG_ROOT, "dist", "src", "cli.js"), "demo", "--out", dir], { cwd: root, env: { ...process.env, LOOOT_TOKEN: "" } });
  const receipt = {
    schemaVersion: "1",
    ...(over.placeholder ? { placeholder: "PLACEHOLDER" } : {}),
    run: { domain: "acme.com", startedAt: "2026-11-25T09:00:00.000Z", finishedAt: "2026-11-25T09:02:00.000Z", cap: 10, expected: 2, charged: 2.2, calls: 3, durationMs: 120000 },
    modules: [{ id: "intake", label: "Intake", status: "done", calls: 1, quoted: 0.1, worst: 0.2, charged: 0.1, summary: over.summary ?? "config draft from 4 pages", startedAtMs: 0, endedAtMs: 10 }],
    calls: [{ module: "intake", job: "web.scrape.markdown", provider: "x", outcome: "hit", quoted: 0.1, charged: 0.1, ms: 10, ts: "2026-11-25T09:00:01.000Z", runId: RUN }],
  };
  const snap = { schemaVersion: "1", at: "2026-11-25T09:02:00.000Z", domain: "acme.com", brand: "Acme", charged: 2.2, calls: 3, competitors: [{ domain: "globex.com", name: "Globex" }], accounts: [], people: [{ name: "Jane Doe", email: "jane@example.com", linkedin: "", phone: "", account: "acme.com" }], rivals: [], ranks: [], signals: [], mentions: [], ads: [] };
  const sf = join(dir, "state.json");
  writeFileSync(sf, readFileSync(sf, "utf8").split("yourdomain.com").join("acme.com"));
  writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt));
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snap));
  return dir;
}

test("the share bundle is company-level only: no people, run ids from the receipt", () => {
  const b = buildShareBundle(out());
  assert.equal(b.schema, "zeus.share.v2");
  assert.equal(b.domain, "acme.com");
  assert.deepEqual(b.runIds, [RUN]);
  assert.deepEqual(b.rivals, [{ name: "Rival 1" }]);
  assert.equal(b.city.domain, "acme.com");
  assert.equal(b.city.public, true);
  assert.doesNotMatch(JSON.stringify(b), /Jane|jane@|Globex|globex/i);
});

test("the public bundle names no rival or target account, even inside a summary", () => {
  const dir = out({ summary: "Globex leads on price; Initech scored 92 (initech.io)" });
  const snapFile = join(dir, "snapshot.json");
  const snap = JSON.parse(readFileSync(snapFile, "utf8"));
  snap.accounts = [{ domain: "initech.io", name: "Initech", grade: "A", score: 92 }];
  writeFileSync(snapFile, JSON.stringify(snap));
  const b = buildShareBundle(dir);
  const text = JSON.stringify(b);
  assert.doesNotMatch(text, /Globex|globex|Initech|initech/);
  assert.match(b.modules[0].summary, /Rival 1 leads on price; Account A scored 92/);
});

test("a placeholder or demo receipt is never published", () => {
  assert.throws(() => buildShareBundle(out({ placeholder: true })), /placeholder/i);
});

test("a contact in a summary stops the publish before any call", () => {
  assert.throws(() => buildShareBundle(out({ summary: "write to jane@example.com" })), /contact/i);
});

test("publish posts JSON with the looot key and returns the URL; unpublish deletes", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    if (init.method === "POST") return Response.json({ slug: "acme", url: "https://looot-pages.vercel.app/p/acme" }, { status: 201 });
    return Response.json({ slug: "acme", unpublished: true });
  }) as unknown as typeof fetch;
  const r = await publishShare(buildShareBundle(out()), { token: "lk_test_1234567890abcd", baseUrl: "https://looot-pages.vercel.app", fetch: f });
  assert.equal(r.url, "https://looot-pages.vercel.app/p/acme");
  assert.equal(seen[0].url, "https://looot-pages.vercel.app/api/publish");
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer lk_test_1234567890abcd");
  await unpublishShare("acme", { token: "lk_test_1234567890abcd", baseUrl: "https://looot-pages.vercel.app", fetch: f });
  assert.equal(seen[1].url, "https://looot-pages.vercel.app/api/pages/acme");
  assert.equal(seen[1].init.method, "DELETE");
});

test("a refused publish surfaces the server's message", async () => {
  const f = (async () => Response.json({ error: { code: "domain_not_verified", message: "None of the runs is about acme.com" } }, { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(publishShare(buildShareBundle(out()), { token: "lk_test_1234567890abcd", baseUrl: "https://x.example", fetch: f }), /None of the runs/);
});

test("export --unpublish <name> calls looot-pages with LOOOT_TOKEN and LOOOT_PAGES_URL", async () => {
  const { cmdExport } = await import("../src/commands.js");
  const seen: string[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push(`${init.method} ${url}`); return Response.json({ unpublished: true }); }) as unknown as typeof fetch;
  const lines: string[] = [];
  await cmdExport({ unpublish: "acme" }, out(), { log: (l) => lines.push(l), env: { LOOOT_TOKEN: "lk_test_1234567890abcd", LOOOT_PAGES_URL: "https://looot-pages.vercel.app" }, fetch: f });
  assert.deepEqual(seen, ["DELETE https://looot-pages.vercel.app/api/pages/acme"]);
  assert.match(lines[0], /Unpublished acme/);
  await assert.rejects(cmdExport({ unpublish: "acme" }, out(), { log: () => {}, env: {}, fetch: f }), /LOOOT_TOKEN/);
});

test("the key is never sent to a non-looot pages URL", async () => {
  const { cmdExport } = await import("../src/commands.js");
  const f = (async () => Response.json({})) as unknown as typeof fetch;
  await assert.rejects(cmdExport({ unpublish: "acme" }, out(), { log: () => {}, env: { LOOOT_TOKEN: "lk_test_1234567890abcd", LOOOT_PAGES_URL: "https://evil.example" }, fetch: f }), /not a looot pages address/);
});

test("the bundle carries the run's category words (names only), never other text", () => {
  const dir = out();
  writeFileSync(join(dir, "candidates.json"), JSON.stringify({ categoryTerms: ["crm", "sales pipeline", "<script>", 42] }));
  assert.deepEqual(buildShareBundle(dir).categoryWords, ["crm", "sales pipeline"]);
  assert.equal(buildShareBundle(out()).categoryWords, undefined);
});

// The Workflow Atlas comes from Walid's dataset on looot.ai: the projection, the daily cache, the fallbacks and the
// looot.ai workflow links. Written before src/plays/atlasSource.ts (test first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATLAS, ATLAS_SOURCE_URL, checkVendored, expandAtlas, forgetAtlasMemo, loadAtlas, matchPlays, toVendored, useAtlas, vendoredAtlas, workflowUrl, type LiveAtlas, type VendoredAtlas } from "../src/plays/index.js";

/** Walid's file shape (workflowAtlasData.ts), rebuilt from the vendored copy, plus fields Zeus ignores. */
function liveFrom(v: VendoredAtlas): LiveAtlas & Record<string, unknown> {
  return {
    schemaVersion: v.schemaVersion,
    name: "Looot GTM Engineering Workflows",
    generatedAt: v.generatedAt,
    stats: { totalWorkflows: v.plays.length },
    goals: v.goals.map((name) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name, count: 50, defaultProviders: [] })),
    workflows: v.plays.map(([id, g, slug, title, decisionRule, nextAction, steps]) => ({ id, code: String(id).padStart(4, "0"), slug, goalId: "x", goal: v.goals[g]!, title, decisionRule, nextAction, needsContact: false, steps: steps.map((k, n) => ({ step: n + 1, providerId: "p", providerName: v.providers[k]!.provider, purpose: v.providers[k]!.purpose })), agentPrompt: "ignored" })),
  };
}
const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const dir = () => mkdtempSync(join(tmpdir(), "zeus-atlas-"));
const hiring = { topic: "hiring" as const, text: "Northwind posted 3 AE roles", safe: "1 account posted sales roles" };

test("the vendored copy is Walid's dataset projected: 1,000 plays in 20 goals, each with its own looot.ai slug", () => {
  const v = vendoredAtlas();
  assert.equal(v.source, ATLAS_SOURCE_URL);
  assert.equal(v.source, "https://looot.ai/workflow-atlas/workflows-atlas.json");
  assert.match(v.schemaVersion, /^1\./);
  assert.equal(v.plays.length, 1000);
  assert.equal(v.goals.length, 20);
  assert.equal(new Set(v.plays.map((p) => p[2])).size, 1000, "slugs are unique");
  assert.deepEqual(toVendored(liveFrom(v)), v, "projecting Walid's shape gives the vendored copy back");
  assert.ok(readFileSync(new URL("../../src/plays/atlas.vendored.json", import.meta.url)).length < 400 * 1024, "under the repo's 400 KB file limit");
});

test("a file Zeus cannot read is refused, never half used", () => {
  const v = liveFrom(vendoredAtlas());
  assert.throws(() => toVendored({ ...v, schemaVersion: "2.0.0" }), /schemaVersion/);
  assert.throws(() => toVendored({ ...v, workflows: [] }), /no goals or workflows/);
  assert.throws(() => toVendored({ ...v, workflows: [{ ...v.workflows[0]!, slug: "" }] }), /incomplete/);
  assert.throws(() => toVendored({ ...v, workflows: [{ ...v.workflows[0]!, goal: "Not a goal" }] }), /incomplete/);
  assert.throws(() => toVendored({ ...v, workflows: [v.workflows[0]!, v.workflows[0]!] }), /incomplete/, "a repeated id");
  assert.throws(() => toVendored({ ...v, workflows: [{ ...v.workflows[0]!, steps: [{ providerName: "", purpose: "x" }] }] }), /step/);
  assert.throws(() => toVendored(null), /schemaVersion/);
});

test("loadAtlas: offline uses the vendored copy and makes no request", async () => {
  const r = await loadAtlas({ cacheDir: dir(), offline: true, fetch: (() => { throw new Error("no request offline"); }) as unknown as typeof fetch });
  assert.equal(r.origin, "vendored");
  assert.deepEqual(r.atlas, vendoredAtlas());
});

test("loadAtlas: reads looot.ai, caches it for a day, and the cached copy is used without a request", async () => {
  const v = vendoredAtlas();
  const live = liveFrom(v);
  live.workflows[0] = { ...live.workflows[0]!, title: "A newer title from looot.ai." };
  const d = dir();
  let calls = 0;
  const f = (async (url: string) => { calls++; assert.equal(url, ATLAS_SOURCE_URL); return new Response(JSON.stringify(live)); }) as unknown as typeof fetch;
  const now = new Date("2026-11-27T10:00:00Z");
  const first = await loadAtlas({ cacheDir: d, fetch: f, now });
  assert.equal(first.origin, "live");
  assert.equal(first.atlas.plays[0]![3], "A newer title from looot.ai.");
  assert.ok(existsSync(join(d, "atlas.json")));
  const again = await loadAtlas({ cacheDir: d, fetch: f, now: new Date("2026-11-27T20:00:00Z") });
  assert.equal(again.origin, "cache");
  assert.equal(calls, 1, "one request a day");
  assert.equal(again.atlas.plays[0]![3], "A newer title from looot.ai.");
});

test("loadAtlas: looot.ai down uses a stale cache, else the vendored copy, and never throws", async () => {
  const v = vendoredAtlas();
  const down = (async () => { throw new Error("getaddrinfo ENOTFOUND looot.ai"); }) as unknown as typeof fetch;
  const empty = await loadAtlas({ cacheDir: dir(), fetch: down });
  assert.equal(empty.origin, "vendored");
  assert.match(empty.note, /could not be read \(getaddrinfo ENOTFOUND looot\.ai\)/);
  assert.equal((await loadAtlas({ cacheDir: dir(), fetch: json({ error: "not found" }, 404) })).origin, "vendored");
  const d = dir();
  const old = { ...v, plays: v.plays.slice(0, 3) };
  writeFileSync(join(d, "atlas.json"), JSON.stringify({ at: "2026-11-01T00:00:00Z", atlas: old }));
  const stale = await loadAtlas({ cacheDir: d, fetch: down, now: new Date("2026-11-27T00:00:00Z") });
  assert.equal(stale.origin, "cache");
  assert.equal(stale.atlas.plays.length, 3);
});

test("loadAtlas: a live file that is broken or names other goals is not used", async () => {
  const v = vendoredAtlas();
  assert.equal((await loadAtlas({ cacheDir: dir(), fetch: json({ schemaVersion: "1.0.0", goals: [], workflows: [] }) })).origin, "vendored");
  const other = liveFrom(v);
  other.goals[0] = { id: "x", name: "A goal Zeus does not know" };
  other.workflows = other.workflows.map((w) => (w.goal === v.goals[0] ? { ...w, goal: "A goal Zeus does not know" } : w));
  const r = await loadAtlas({ cacheDir: dir(), fetch: json(other) });
  assert.equal(r.origin, "vendored");
  assert.match(r.note, /goals differ/);
});

test("useAtlas swaps the plays the matcher and the city page use", () => {
  const before = ATLAS;
  const v = vendoredAtlas();
  try {
    useAtlas({ ...v, plays: v.plays.filter((p) => p[0] === 13) });
    assert.equal(ATLAS.plays.length, 1);
    const plays = matchPlays({ company: "Acme", domain: "acme.com", findings: [hiring] });
    assert.deepEqual(plays.map((p) => p.id), [13]);
  } finally {
    useAtlas(v);
  }
  assert.equal(ATLAS.plays.length, before.plays.length);
});

test("Zeus's copy rule is applied on load, Walid's words are kept otherwise", () => {
  const v = vendoredAtlas();
  const a = expandAtlas({ ...v, plays: [[1, 0, "s", "Find X, and verify — fast.", "Rule.", "Next.", [0]]] });
  assert.equal(a.plays[0]!.title, "Find X and verify, fast.");
});

test("every play links to its full workflow on looot.ai, in the top 5 and in the browse view", async () => {
  const plays = matchPlays({ company: "Acme", domain: "acme.com", findings: [hiring] });
  assert.ok(plays.length > 0);
  for (const p of plays) {
    assert.ok(p.slug, `play ${p.id} has a slug`);
    assert.equal(p.url, `https://looot.ai/workflow-atlas/${p.slug}`);
    assert.equal(p.url, workflowUrl(p.slug));
  }
  const { renderCity } = await import("../src/city/index.js");
  const html = renderCity({ domain: "acme.com", brand: "Acme", generatedAt: "", public: false, sections: [], nextPlays: plays });
  for (const p of plays) assert.ok(html.includes(`<a class="za zread" href="${p.url}" target="_blank" rel="noopener noreferrer">Read the full workflow</a>`), `link for play ${p.id}`);
  assert.match(html, /<a href="https:\/\/looot\.ai\/workflow-atlas" target="_blank" rel="noopener noreferrer">Open the Atlas<\/a>/);
  assert.ok(!html.includes("chatgpt.site"), "no link to the old Atlas copy");
  const d = JSON.parse(/id="atlas-data">([\s\S]*?)<\/script>/.exec(html)![1]!);
  assert.equal(d.page, "https://looot.ai/workflow-atlas");
  const row = d.plays.find((r: unknown[]) => r[0] === plays[0]!.id);
  assert.equal(row[6], plays[0]!.slug);
  assert.match(html, /Read the full workflow'\);rd\.href=D\.page\+'\/'\+encodeURIComponent\(p\[6\]\)/);
});

test("a looot.page bundle carries no slug or url (looot.page refuses links); its renderer finds the page from the play id", async () => {
  const { publicDossier } = await import("../src/publicCity.js");
  const { renderCity } = await import("../src/city/index.js");
  const plays = matchPlays({ company: "Acme", domain: "acme.com", findings: [hiring], isPublic: true });
  const d = publicDossier({ domain: "acme.com", brand: "Acme", generatedAt: "2026-11-26T09:00:00Z", public: true, sections: [], nextPlays: plays } as never, []);
  assert.ok(d.nextPlays!.length > 0);
  for (const p of d.nextPlays!) {
    assert.ok(!("slug" in p) && !("url" in p), `play ${p.id} has no link field`);
  }
  const html = renderCity(d);
  for (const p of plays) assert.ok(html.includes(`href="${p.url}"`), `shared page still links play ${p.id}`);
});

test("a cache Zeus cannot read (damaged, or another Zeus's format) is ignored, never crashes a quote (review of #72)", async () => {
  const v = vendoredAtlas();
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const now = new Date("2026-11-27T10:00:00Z");
  for (const bad of [
    { ...v, plays: [[13, 0, "s", "t", "r", "n", [999]]] },
    { ...v, plays: [[13, 99, "s", "t", "r", "n", [0]]] },
    { ...v, plays: [[13, 0, "", "t", "r", "n", [0]]] },
    { ...v, format: "plays: something else" },
    { ...v, providers: [{ provider: "" }] },
  ]) {
    const d = dir();
    writeFileSync(join(d, "atlas.json"), JSON.stringify({ at: "2026-11-27T09:00:00Z", atlas: bad }));
    const r = await loadAtlas({ cacheDir: d, fetch: down, now });
    assert.equal(r.origin, "vendored", JSON.stringify(bad.plays[0]).slice(0, 60));
    assert.doesNotThrow(() => useAtlas(r.atlas));
  }
  assert.throws(() => checkVendored({ ...v, plays: [[13, 0, "s", "t", "r", "n", [999]]] }), /cannot be read/);
  assert.equal(checkVendored(v), v);
});

test("one read of looot.ai per day per process, even without a disk cache", async () => {
  forgetAtlasMemo();
  const live = liveFrom(vendoredAtlas());
  let calls = 0;
  const f = (async () => { calls++; return new Response(JSON.stringify(live)); }) as unknown as typeof fetch;
  const d = join(dir(), "ro");
  const now = new Date("2026-11-27T10:00:00Z");
  assert.equal((await loadAtlas({ cacheDir: d, fetch: f, now })).origin, "live");
  const { rmSync } = await import("node:fs");
  rmSync(d, { recursive: true, force: true });
  assert.equal((await loadAtlas({ cacheDir: d, fetch: f, now: new Date("2026-11-27T12:00:00Z") })).origin, "cache");
  assert.equal(calls, 1);
  forgetAtlasMemo();
});

test("the looot.page copy of the vendored Atlas is the CLI's (run npm run vendor in pages/)", (t) => {
  // The public loootai/zeus repo has no pages/ folder: nothing to compare there.
  if (!existsSync(new URL("../../../pages/lib/city/atlas.vendored.json", import.meta.url))) return t.skip("no pages/ in this repo");
  const cli = readFileSync(new URL("../../src/plays/atlas.vendored.json", import.meta.url), "utf8");
  const pages = readFileSync(new URL("../../../pages/lib/city/atlas.vendored.json", import.meta.url), "utf8");
  assert.equal(pages, cli);
});

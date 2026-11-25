import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchImage } from "../src/assets.js";
import type { CallOptions, CallResult, JobRunner } from "../src/client.js";
import { idempotencyKey } from "../src/client.js";
import { withWatchDay } from "../src/commands.js";
import { renderPeople } from "../src/city/people.js";
import { DirectRunner } from "../src/direct.js";
import type { Block, Member } from "../src/dossier/blocks.js";
import { renderHtml } from "../src/dossier/html.js";
import { assertPublicUrl, guardedFetch, isPrivateAddress, type Resolver } from "../src/netGuard.js";
import { safeUrl } from "../src/util.js";

const EVIL = ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "//evil.example/x", "assets/../../x"];

test("safeUrl keeps http(s) and drops every other scheme", () => {
  assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeUrl("http://example.com"), "http://example.com");
  for (const x of EVIL) assert.equal(safeUrl(x), null, x);
  assert.equal(safeUrl(undefined), null);
});

const member = (linkedin: string): Member => ({ role: "Champion", name: "Placeholder Person", title: "Head of Ops", email: "", emailStatus: "not found", linkedin, phone: "", phoneStatus: "not looked up" });

test("dossier: javascript: and data: URLs from provider data never reach href or data-src", () => {
  const blocks: Block[] = [
    { kind: "cards", items: [{ title: "Ad", sub: "first seen 2026-11-01", tag: "Meta", image: "javascript:alert(1)", links: [{ href: "javascript:alert(2)", label: "Landing page" }, { href: "https://example.com/ok", label: "Post" }] }] },
    { kind: "cards", items: [{ title: "Ad 2", sub: "first seen 2026-11-02", tag: "Meta", image: "assets/ads/abc.png" }] },
    { kind: "committee", items: [{ account: "Acme", domain: "acme.example", grade: "A", members: [member("data:text/html,x"), member("https://www.linkedin.com/in/placeholder")] }] },
  ];
  const html = renderHtml({ domain: "yourdomain.com", brand: "YourBrand", generatedAt: "2026-11-25T00:00:00.000Z", public: false, sections: [{ num: "01", id: "ads", title: "Ads", status: "done", source: "test", blocks }] });
  assert.doesNotMatch(html, /(href|src|data-src)="(javascript|data:text)/i);
  assert.match(html, /Landing page/); // the label stays, as text
  assert.match(html, /href="https:\/\/example.com\/ok"/);
  assert.match(html, /data-src="assets\/ads\/abc.png"/);
  assert.match(html, /href="https:\/\/www.linkedin.com\/in\/placeholder"/);
});

test("city people: a javascript: LinkedIn URL renders no link", () => {
  const html = renderPeople([{ account: "Acme", domain: "acme.example", grade: "A", members: [member("javascript:alert(1)")] }], false);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /LinkedIn<\/a>/);
});

test("isPrivateAddress: loopback, private, CGNAT, link-local, metadata, v6 and IPv4-mapped", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "169.254.169.254", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fc00::1", "fd00:ec2::254", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "not-an-ip"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(ip), false, ip);
});

const fakeDns = (table: Record<string, string[]>): Resolver => async (h) => table[h] ?? [];

test("assertPublicUrl: schemes, ports, credentials, literals and every resolved address", async () => {
  const dns = fakeDns({ "good.example": ["93.184.216.34", "2606:4700::1111"], "mixed.example": ["93.184.216.34", "::ffff:10.0.0.1"], "meta.example": ["169.254.169.254"] });
  await assertPublicUrl("https://good.example/", dns);
  await assertPublicUrl("http://good.example:443/x", dns);
  for (const bad of ["ftp://good.example/", "https://good.example:8443/", "https://a@good.example/", "https://127.0.0.1/", "https://[::1]/", "https://[::ffff:7f00:1]/", "https://localhost/", "https://intranet/", "https://mixed.example/", "https://meta.example/", "https://nowhere.example/", "https://0x7f000001/", "https://2130706433/"])
    await assert.rejects(assertPublicUrl(bad, dns), Error, bad);
});

test("guardedFetch follows redirects by hand and refuses a hop to the metadata address", async () => {
  const dns = fakeDns({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"] });
  const seen: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push(url);
    assert.equal(init.redirect, "manual");
    if (url === "https://a.example/") return new Response("", { status: 301, headers: { location: "https://b.example/next" } });
    if (url === "https://b.example/next") return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    return new Response("secret");
  }) as unknown as typeof fetch;
  await assert.rejects(guardedFetch("https://a.example/", {}, { fetch: f, resolve: dns }), /169.254.169.254/);
  assert.deepEqual(seen, ["https://a.example/", "https://b.example/next"]);
  const ok = await guardedFetch("https://b.example/next", {}, { fetch: (async () => new Response("hi")) as unknown as typeof fetch, resolve: dns });
  assert.equal(await ok.text(), "hi");
});

const opts: CallOptions = { module: "intake", step: "page", maxCostUsd: 0, quotedUsd: 0 };

test("DirectRunner refuses a private domain and never calls fetch for it", async () => {
  let calls = 0;
  const f = (async () => { calls++; return new Response("<p>x</p>"); }) as unknown as typeof fetch;
  const dns = fakeDns({ "rebind.example": ["10.0.0.5"] });
  for (const url of ["https://127.0.0.1/", "https://localhost:8787/", "https://169.254.169.254/", "https://rebind.example/"]) {
    const r = await new DirectRunner(f, dns).call("web.scrape.markdown", { url }, opts);
    assert.equal(r.record.outcome, "fail", url);
    assert.match(String(r.record.note), /refused|resolve/, url);
  }
  assert.equal(calls, 0);
});

test("ad image fetch refuses a private address and a redirect to one", async () => {
  let calls = 0;
  const f = (async () => { calls++; return new Response("", { status: 302, headers: { location: "http://192.168.0.1/x.png" } }); }) as unknown as typeof fetch;
  const dns = fakeDns({ "cdn.example": ["93.184.216.34"] });
  assert.equal(await fetchImage("http://10.0.0.1/a.png", f, 1e6, dns), null);
  assert.equal(calls, 0);
  assert.equal(await fetchImage("https://cdn.example/a.png", f, 1e6, dns), null);
  assert.equal(calls, 1);
});

test("watch adds the UTC day to the repeat-protection key, so next week is not a replay", async () => {
  const keys: string[] = [];
  const inner: JobRunner = { call: async (_job, input, o): Promise<CallResult> => { keys.push(idempotencyKey(o.module, o.step, input)); return { record: {} as any, run: { runId: "", status: "completed" }, data: {} }; } };
  await withWatchDay(inner, "2026-11-25").call("news.search", { q: "acme" }, { ...opts, step: "news:acme.example" });
  await withWatchDay(inner, "2026-11-25").call("news.search", { q: "acme" }, { ...opts, step: "news:acme.example" });
  await withWatchDay(inner, "2026-12-02").call("news.search", { q: "acme" }, { ...opts, step: "news:acme.example" });
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.notEqual(keys[0], idempotencyKey("intake", "news:acme.example", { q: "acme" }));
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { renderCity } from "../src/city/index.js";
import type { Dossier } from "../src/dossier/index.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function demo(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-city-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), ...extra], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
}

const HEADINGS = ["Target accounts", "Influencers", "SEO", "GEO", "Competitive analysis", "Format finder", "Content calendar", "Run log and cost"];

test("demo writes city/index.html next to the dossier", () => {
  const out = demo();
  assert.ok(existsSync(join(out, "city", "index.html")));
  assert.ok(existsSync(join(out, "dossier.html")));
});

test("the city page has every section heading, works from disk and names no local path", () => {
  const html = readFileSync(join(demo(), "city", "index.html"), "utf8");
  for (const h of HEADINGS) assert.match(html, new RegExp(`<h1>${h}</h1>`), h);
  assert.doesNotMatch(html, /~\/Desktop|\/Users\/|\/home\/|C:\\\\|\/tmp\//);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|@import|url\(http/i);
  assert.doesNotMatch(html, /zlk|Available after top up|Morning brief|Battlecards/);
  assert.match(html, /<h1>What a paid run adds<\/h1>/);
});

test("a --public run has no unmasked email in the city page", () => {
  const html = readFileSync(join(demo(["--public"]), "city", "index.html"), "utf8");
  const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const m of emails) assert.match(m, /^.\*\*\*@/, `unmasked ${m}`);
});

test("the demo city page shows people in a non-public run", () => {
  const html = readFileSync(join(demo(), "city", "index.html"), "utf8");
  assert.match(html, /class="mem"/);
});

const bare: Dossier = { domain: "example.com", brand: "Example", generatedAt: "2026-01-01T00:00:00Z", public: false, sections: [] };

test("renderCity is pure and shows honest empty states for a run with no data", () => {
  const a = renderCity(bare);
  assert.equal(renderCity(bare), a);
  for (const h of HEADINGS) assert.match(a, new RegExp(`<h1>${h}</h1>`));
  assert.match(a, /Nothing here yet/);
});

test("renderCity masks people when the dossier is public", () => {
  const d: Dossier = { ...bare, public: true, sections: [{ num: "", id: "committee", title: "Committees", status: "done", source: "test", blocks: [{ kind: "committee", items: [{ account: "Acme", domain: "acme.test", grade: "A", members: [{ role: "Champion", name: "Pat Example", title: "Head of X", email: "pat@acme.test", emailStatus: "verified", linkedin: "https://www.linkedin.com/in/pat", phone: "+31612345678", phoneStatus: "found" }] }] }] }] };
  const html = renderCity(d);
  assert.doesNotMatch(html, /pat@acme\.test|Pat Example|612345678|linkedin\.com\/in\/pat/);
  assert.match(html, /p\*\*\*@acme\.test/);
  assert.match(renderCity({ ...d, public: false }), /pat@acme\.test/);
});

test("city page: fork it, tell your agent and powered by looot on every page; share only on the public (safe) page", async () => {
  const { renderCity, ZEUS_REPO_URL } = await import("../src/city/index.js");
  const base = { domain: "acme.example", brand: "Acme", generatedAt: "2026-11-25T09:00:00.000Z", sections: [] };
  const priv = renderCity({ ...base, public: false } as never);
  const pub = renderCity({ ...base, public: true } as never);
  for (const h of [priv, pub]) {
    assert.ok(h.includes(`href="${ZEUS_REPO_URL}"`) && h.includes(">Fork it<"));
    assert.ok(h.includes(">Tell your agent<") && h.includes("npx looot-zeus skill"));
    assert.ok(h.includes('href="https://looot.ai"') && h.includes("Powered by looot"));
    assert.ok(!h.includes(", and ") && !h.includes("—"));
  }
  assert.ok(pub.includes('class="za zshare"'));
  assert.ok(!priv.includes('class="za zshare"'), "a private page is never offered for sharing");
});

test("the city page is David's shell filled from the run: isometric city, every slot filled, no Higgsfield data, no image", async () => {
  const html = readFileSync(join(demo(), "city", "index.html"), "utf8");
  assert.match(html, /<svg class="iso-svg" viewBox="0 -680 1100 1470"/);
  assert.equal((html.match(/<a class="isa/g) ?? []).length, 64);
  assert.doesNotMatch(html, /\{\{[\w.]+\}\}/, "an unfilled slot");
  assert.doesNotMatch(html, /higgsfield|runwayml|<img|<image|fonts\.googleapis/i);
  assert.match(html, /data-t="Northwind Logistics"/, "buildings carry the run's accounts");
  assert.match(html, /<aside class="side"[\s\S]*<h6>Watch the market<\/h6>[\s\S]*>Reddit</);
  for (const v of ["pages", "reddit", "mmap", "paid"]) assert.match(html, new RegExp(`data-view="${v}"`), v);
});

test("not-yet features come from paid.json: off shows only its district, locked; coming-soon is named as coming soon", async () => {
  const { PAID_FEATURES, LOCKED_LINE } = await import("../src/city/index.js");
  const html = renderCity(bare);
  const districts = new Set(PAID_FEATURES.map((f) => f.district).filter(Boolean));
  for (const f of PAID_FEATURES.filter((x) => x.state === "off" && !districts.has(x.label))) assert.ok(!html.includes(`>${f.label}<`) && !html.includes(`"${f.label}"`), f.label);
  assert.equal(LOCKED_LINE, "Not in the free run");
  // Each district callout, as on David's page, greyed and opening the paid list with the locked line.
  for (const d of ["Signal engine", "Guardrails", "Daily rhythm", "Campaign lanes"]) assert.match(html, new RegExp(`<a class="isl zoff" href="#paid" aria-label="${d}">[\\s\\S]*?class="islt">${d}</text><text[^>]*class="isls">Not in the free run<`), d);
  assert.match(html, /class="isa[^"]* zoff" href="#paid"[^>]*data-t="Signal engine" data-s="Not in the free run"/);
  // Push to my CRM (key crm) is coming soon since David's Export to CRM ask (2026-11-25).
  assert.match(html, /data-t="Push to my CRM" data-s="Coming soon"/);
  assert.match(html, /<h3>Coming soon<\/h3>[\s\S]*<li>Push to my CRM<\/li>/);
});

test("the sidebar shows the company logo the run fetched, on its own public page too, never an SVG", async () => {
  const { setLogos } = await import("../src/assets.js");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  try {
    setLogos(new Map([[bare.domain, png]]));
    assert.ok(renderCity(bare).includes(`<span class="logo"><img src="${png}"`));
    assert.ok(renderCity({ ...bare, public: true }).includes(`<span class="logo"><img src="${png}"`), "the owner keeps its logo on its public page");
    setLogos(new Map([[bare.domain, "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]]));
    assert.ok(!renderCity(bare).includes("svg+xml"));
    assert.match(renderCity(bare), /<span class="logo"><span class="lgt"/);
  } finally { setLogos(new Map()); }
});

// The looot.page city (#24 follow-up): the public dossier keeps the owner, labels third parties, drops
// people, links and cap text, and the city rendered from it looks like the private one.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderCity } from "../src/city/index.js";
import { PARTIAL, publicDossier, publicText } from "../src/publicCity.js";
import { safeRun } from "../src/safeView.js";
import { PKG_ROOT } from "../src/util.js";

function demo(): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-pubcity-"));
  execFileSync(process.execPath, [join(PKG_ROOT, "dist", "src", "cli.js"), "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
}

test("public text: cap and debug text becomes the plain partial line", () => {
  assert.equal(publicText("stopped at its cap: 0.1095 of 0.15 USD used, next call could cost up to 0.0400", "acme.com", []), PARTIAL);
  assert.equal(publicText("12 rows. Stopped at the cap. More below.", "acme.com", []), `12 rows. ${PARTIAL} More below.`);
});

test("public text: placeholder domains read as their label, other hosts and URLs go, the owner stays", () => {
  assert.equal(publicText("rival-2.example and account-b.example", "acme.com", []), "Rival 2 and Account B");
  assert.equal(publicText("see https://x.com/a/b and techcrunch.com/x on acme.com", "acme.com", []), "see and a web source on acme.com");
});

test("the public dossier names no third party, has no people, links, logos of others or cap text", () => {
  const r = safeRun(demo())!;
  const d = publicDossier(r.d, r.tp);
  const text = JSON.stringify(d);
  for (const s of r.tp) assert.ok(!new RegExp(`(?<![\\p{L}\\p{N}])${s.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text), `names ${s.from}`);
  assert.doesNotMatch(text, /"kind":"committee"|"image"|"links"|https?:|\.example\b|stopped at (its|the) cap/i);
  assert.ok(!d.sections.some((s) => s.id === "committee" || s.id === "enrich"));
  const accounts = d.sections.find((s) => s.id === "accounts")!.blocks.find((b) => b.kind === "table");
  assert.ok(accounts && accounts.kind === "table" && accounts.rows.every((x) => /^Account [A-Z]{1,2}$/.test(String(x.name))));
  assert.ok(accounts.kind === "table" && accounts.columns.some((c) => c.key === "industry"), "sector stays");
});

test("the shared city is the private city's shell with a share header, no Share button and no people menu", () => {
  const r = safeRun(demo())!;
  const priv = renderCity(r.d, { showBrand: true });
  const pub = renderCity(publicDossier(r.d, r.tp), { showBrand: true, share: {} });
  for (const k of ['<aside class="side"', "data-iso", "iso-sec", "powered by", "Build your own", "What the free run made"]) {
    assert.ok(priv.includes(k), `private has ${k}`);
    assert.ok(pub.includes(k), `shared has ${k}`);
  }
  assert.match(pub, /GTM map by Zeus/);
  assert.match(pub, /Map my company/);
  assert.doesNotMatch(pub, /class="za zshare"|class="znb zshare"|href="#committees"|href="#openers"|Export to CRM/);
  assert.doesNotMatch(priv, /GTM map by Zeus/);
});

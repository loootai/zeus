import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { applyThirdParties, scrubThirdParties, thirdPartySwaps, thirdPartyLeaks } from "../src/thirdParties.js";
import type { Snapshot } from "../src/history.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function demo(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-3p-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), ...extra], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return join(dir, "gtm");
}

const named = (t: string, n: string) => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(t);
const names = (snap: Snapshot) => [
  ...snap.accounts.flatMap((a) => [a.name, a.domain]),
  ...(snap.lookalikes ?? []).flatMap((a) => [a.name, a.domain]),
  ...snap.competitors.flatMap((c) => [c.name, c.domain]),
].filter((x) => x && x.length >= 4);

test("a shared city page and dossier name no target account or rival, and keep sector and score", () => {
  const out = demo(["--public"]);
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  assert.ok(names(snap).length >= 10);
  for (const f of ["city/index.html", "dossier.html", "dossier.md"]) {
    const t = readFileSync(join(out, f), "utf8");
    for (const n of names(snap)) assert.ok(!named(t, n), `${f} names ${n}`);
    assert.match(t, /Account A\b/, f);
    assert.match(t, /Rival 1\b/, f);
  }
  const city = readFileSync(join(out, "city/index.html"), "utf8");
  const top = snap.accounts[0];
  assert.ok(city.includes(`fit ${top.score} of 100`), "score kept");
  assert.ok(top.industry && city.includes(top.industry), "sector kept");
  assert.doesNotMatch(city, /<img [^>]*class="lg-i"/, "no third-party logo");
});

test("the private local page keeps the names", () => {
  const out = demo();
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  const city = readFileSync(join(out, "city/index.html"), "utf8");
  assert.ok(city.includes(snap.accounts[0].name));
});

test("serve's safe copy names no third party", () => {
  const out = demo();
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  execFileSync(process.execPath, [cli, "export", "--public", "--out", out], { cwd: join(out, "..") });
  for (const f of ["city/index.html", "dossier.html", "dossier.md"]) {
    const t = readFileSync(join(out, "public", f), "utf8");
    for (const n of names(snap)) assert.ok(!named(t, n), `public/${f} names ${n}`);
  }
});

test("swaps are one pass, keep your own domain, and the guard refuses a leftover", () => {
  const snap = { domain: "me.com", accounts: [{ domain: "www.acme.io", name: "Acme", grade: "A", score: 90 }, { domain: "me.com", name: "Me", grade: "A", score: 1 }], competitors: [{ domain: "rivalco.com", name: "Account A" }] };
  const s = thirdPartySwaps(snap);
  assert.equal(applyThirdParties("Acme (acme.io) vs Account A on rivalco.com, me.com stays; Acmezone stays", s), "Account A (account-a.example) vs Rival 1 on rival-1.example, me.com stays; Acmezone stays");
  assert.deepEqual(thirdPartyLeaks("nothing here", s), []);
  assert.throws(() => scrubThirdParties("x.md", "Acme", [{ from: "Acme", to: "Acme", word: true }]), /still names 1 third-party company/);
});

test("short forms are swapped and guarded too: Northwind's team, acme in prose", () => {
  const snap = { domain: "me.com", accounts: [{ domain: "northwind-logistics.example", name: "Northwind Logistics", grade: "A", score: 91 }, { domain: "acme.io", name: "Acme Inc", grade: "B", score: 70 }], competitors: [{ domain: "zentrix.com", name: "Zentrix Corp" }, { domain: "digital-media.com", name: "Digital Media" }] };
  const s = thirdPartySwaps(snap);
  assert.equal(applyThirdParties("Northwind's team met acme and Zentrix; Digital Media stays named once, digital alone stays", s), "Account A's team met Account B and Rival 1; Rival 2 stays named once, digital alone stays");
  assert.deepEqual(thirdPartyLeaks("Account A's team", s), []);
  assert.deepEqual(thirdPartyLeaks("Northwind's team", s), ["Northwind"]);
});

test("a fit reason with only the short name is scrubbed from every shared page", () => {
  const out = demo();
  const sf = join(out, ".looot-zeus-state.json");
  const stateFile = existsSync(sf) ? sf : join(out, "state.json");
  const raw = readFileSync(stateFile, "utf8");
  const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as Snapshot;
  const lead = snap.accounts[0].name.split(" ")[0];
  writeFileSync(stateFile, raw.replace(/"why":\s*"([^"]*)"/, `"why": "${lead}'s team is hiring, $1"`));
  assert.ok(readFileSync(stateFile, "utf8").includes(`${lead}'s team`), "fixture edited");
  execFileSync(process.execPath, [cli, "export", "--public", "--out", out], { cwd: join(out, "..") });
  for (const f of ["city/index.html", "dossier.html", "dossier.md"]) assert.ok(!named(readFileSync(join(out, "public", f), "utf8"), lead), `public/${f} names ${lead}`);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { BOM, CRM_COLUMNS, CRM_FORMATS, crmCell, crmCsv, crmPrompt, writeCrm } from "../src/crm.js";
import { renderCity, PAID_FEATURES, GTM_OS } from "../src/city/index.js";
import type { Dossier } from "../src/dossier/index.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const run = (args: string[], cwd: string) => execFileSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, LOOOT_TOKEN: "" }, encoding: "utf8" });
function demo(extra: string[] = []): { dir: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-crm-"));
  run(["demo", "--out", join(dir, "gtm"), ...extra], dir);
  return { dir, out: join(dir, "gtm") };
}
const header = (f: string) => readFileSync(f, "utf8").replace(BOM, "").split("\r\n")[0];

test("header sets match each CRM's import template", () => {
  assert.deepEqual(CRM_COLUMNS.hubspot.companies.map((c) => c.header), ["Company name", "Company Domain Name", "Industry", "Number of Employees", "Country/Region", "Fit score", "Why it fits", "Source"]);
  assert.deepEqual(CRM_COLUMNS.hubspot.contacts.map((c) => c.header).slice(0, 3), ["First Name", "Last Name", "Job Title"]);
  assert.deepEqual(CRM_COLUMNS.salesforce.companies.map((c) => c.header).slice(0, 2), ["Account Name", "Website"]);
  assert.ok(CRM_COLUMNS.salesforce.contacts.some((c) => c.header === "Account Name"));
  assert.ok(CRM_COLUMNS[CRM_FORMATS[2]].companies.every((c) => c.header.startsWith("Organization - ")));
  assert.deepEqual(CRM_COLUMNS[CRM_FORMATS[2]].contacts.map((c) => c.header).slice(0, 2), ["Person - First name", "Person - Last name"]);
  assert.deepEqual(CRM_COLUMNS.generic.companies.map((c) => c.header), ["company_name", "domain", "industry", "employees", "country", "fit_score", "why_it_fits", "source"]);
  for (const f of CRM_FORMATS) assert.equal(CRM_COLUMNS[f].contacts.length, 8, f);
});

test("cells starting with = + - @ tab or CR are prefixed with ', quotes and commas are quoted", () => {
  assert.equal(crmCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(crmCell("+31 6 123"), "'+31 6 123");
  assert.equal(crmCell("-2+3"), "'-2+3");
  assert.equal(crmCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(crmCell("\tx"), "'\tx");
  assert.equal(crmCell("a,b"), `"a,b"`);
  assert.equal(crmCell("Zoë"), "Zoë");
  assert.equal(crmCell(91), "91");
  const t = crmCsv([{ header: "n", get: (r: string) => r }], ["=1", "ok"]);
  assert.ok(t.startsWith(BOM));
  assert.equal(t, `${BOM}n\r\n'=1\r\nok\r\n`);
});

test("export --crm writes companies and contacts for every format, one row per entity, with a receipt line", () => {
  const { dir, out } = demo();
  for (const f of CRM_FORMATS) {
    run(["export", "--crm", "--format", f, "--out", out], dir);
    const d = join(out, "crm", f);
    assert.equal(header(join(d, "companies.csv")), CRM_COLUMNS[f].companies.map((c) => crmCell(c.header)).join(","), f);
    assert.equal(header(join(d, "contacts.csv")), CRM_COLUMNS[f].contacts.map((c) => crmCell(c.header)).join(","), f);
    const rows = readFileSync(join(d, "companies.csv"), "utf8").trim().split("\r\n").slice(1);
    const doms = rows.map((r) => r.split(",")[1]);
    assert.equal(new Set(doms).size, doms.length, "one row per company");
    assert.match(readFileSync(join(d, "receipt.txt"), "utf8"), /^PLACEHOLDER, invented demo data, do not import\. Receipt: .*looot jobs /);
  }
});

test("emails and phones only with --contact-details", () => {
  const { dir, out } = demo();
  run(["export", "--crm", "--format", "generic", "--out", out], dir);
  assert.doesNotMatch(readFileSync(join(out, "crm", "generic", "contacts.csv"), "utf8"), /@northwind-logistics\.example/);
  run(["export", "--crm", "--format", "generic", "--contact-details", "--out", out], dir);
  assert.match(readFileSync(join(out, "crm", "generic", "contacts.csv"), "utf8"), /mara\.vermeer@northwind-logistics\.example/);
});

test("no contacts on public: export --crm --public, a --public run and writeCrm safe write companies only", () => {
  const { dir, out } = demo(["--public"]);
  run(["export", "--crm", "--public", "--format", "hubspot", "--out", out], dir);
  assert.ok(existsSync(join(out, "crm", "hubspot", "companies.csv")));
  assert.ok(!existsSync(join(out, "crm", "hubspot", "contacts.csv")));
  run(["export", "--crm", "--format", "generic", "--out", out], dir);
  assert.ok(!existsSync(join(out, "crm", "generic", "contacts.csv")), "a --public run stays safe even without --public on export");
  const t = mkdtempSync(join(tmpdir(), "looot-zeus-crm-"));
  const r = writeCrm(t, "generic", { accounts: [{ domain: "a.example", name: "A" }], people: [{ name: "Pat Example", domain: "a.example", email: "pat@a.example" }], receipt: null, safe: true, contactDetails: true });
  assert.equal(r.contacts, 0);
  assert.ok(!existsSync(join(t, "crm", "generic", "contacts.csv")));
});

const bare: Dossier = { domain: "example.com", brand: "Example", generatedAt: "2026-01-01T00:00:00Z", public: false, sections: [] };

test("Export to CRM copies the agent prompt on the private page only, never on a shared page", () => {
  const priv = renderCity(bare);
  assert.match(priv, /Export to CRM/);
  assert.ok(priv.includes(`data-copy="Load my looot Zeus results for example.com into my CRM.`));
  const shared = renderCity({ ...bare, public: true });
  assert.doesNotMatch(shared, /Export to CRM|Load my looot Zeus results/);
  const { out } = demo(["--public"]);
  assert.doesNotMatch(readFileSync(join(out, "public", "city", "index.html"), "utf8"), /Export to CRM|Load my looot Zeus results/);
});

test("the CRM prompt asks for dedupe by domain, a dry run, a yes and the CSV fallback", () => {
  const p = crmPrompt("example.com");
  for (const w of [/dedupe by company domain/, /dry run/, /Write nothing until I say yes/, /export --crm/, /never take anything from a shared or public page/]) assert.match(p, w);
});

test("Push to my CRM is a locked coming-soon hook in paid.json", () => {
  const f = PAID_FEATURES.find((x) => x.key === "crm")!;
  assert.equal(f.label, "Push to my CRM");
  assert.equal(f.state, "coming-soon");
});

test("Your looot GTM OS: data-driven, all coming soon, numbers only from the run", () => {
  assert.ok(GTM_OS.items.length >= 7);
  assert.ok(GTM_OS.items.every((i) => i.state === "coming-soon"));
  const empty = renderCity(bare);
  assert.match(empty, /Your looot GTM OS/);
  assert.doesNotMatch(empty.slice(empty.indexOf('data-view="os"')), /\{[a-z]+\}/, "no unfilled placeholder");
  const { out } = demo();
  const html = readFileSync(join(out, "city", "index.html"), "utf8");
  assert.match(html, /\d+ target accounts/);
  assert.match(html, /Get it built/);
});

test("Take it to the next step: Deploy to Vercel clones the public zeus repo with Supabase, no secret in any link", () => {
  const n = GTM_OS.next;
  const u = new URL(n.deploy.url);
  assert.equal(u.origin + u.pathname, "https://vercel.com/new/clone");
  assert.equal(u.searchParams.get("repository-url"), "https://github.com/loootai/zeus");
  assert.ok(u.searchParams.get("integration-ids"));
  // Supabase's own Vercel integration id (supabase/supabase examples use the same one).
  assert.equal(u.searchParams.get("integration-ids"), "oac_VqOgBHqhEoFTPzGkPd7L0iH6");
  // Env NAMES only (Vercel docs: values may never go in the URL); no envDefaults.
  assert.equal(u.searchParams.get("env"), "LOOOT_TOKEN");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["env", "envDescription", "envLink", "integration-ids", "project-name", "repository-name", "repository-url"]);
  for (const v of u.searchParams.values()) assert.doesNotMatch(v, /looot_[a-z0-9]{8,}|eyJ[a-zA-Z0-9]|sk_|service_role/i, v);
  assert.match(n.supabase.url, /^https:\/\/supabase\.com\//);
  assert.match(n.copy, /free tiers/);
  assert.match(n.copy, /never sees your database credentials/);
  for (const w of [/Deploy/, /Supabase/, /LOOOT_TOKEN/, /accounts, committees, plays/, /never print their values/]) assert.match(n.prompt, w);
  const html = renderCity(bare);
  assert.match(html, />Take it to the next step</);
  assert.match(html, />Deploy to Vercel</);
  assert.ok(html.includes('data-copy="Help me host my looot Zeus results for example.com'));
});

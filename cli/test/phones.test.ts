// Phones (5 Nov 2026): the reader for each provider's answer shape, E.164, the Mobile / Direct / Company line
// labels, the committee waterfall and company line, --no-phones, people.csv and committee.csv columns and the
// dossier. Offline, fixtures only. fixtures/phones.json holds the answer shapes seen live on 5 Nov.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallResult } from "../src/client.js";
import { normalizeConfig } from "../src/config.js";
import { renderHtml } from "../src/dossier/html.js";
import { writeArtifacts } from "../src/exports.js";
import { committee, type CommitteeOut } from "../src/modules/committee.js";
import { loadFixture } from "../src/modules/fixture.js";
import { MODULES } from "../src/modules/index.js";
import { findCompanyLine, findPersonPhone, formatPhone, normalizePhone, readPhoneInfo } from "../src/modules/phone.js";
import { buildQuote, loadPriceBook } from "../src/quote.js";

const F = loadFixture("phones");

function res(job: string, result: unknown, outcome: "hit" | "miss" = "hit", charged = 0.001): CallResult {
  return { record: { module: "committee", job, provider: `${job}-mock`, outcome, quoted: 0.001, charged, ms: 1, ts: "2026-11-05T10:00:00.000Z" }, run: { runId: "r", status: "completed", outcome, result } as never, data: undefined };
}

test("phones: the reader handles QuickEnrich, Dropleads, Lusha and a direct line", () => {
  // QuickEnrich: national digits plus a separate country_code. r4 lost 8 of these.
  assert.deepEqual(readPhoneInfo(res("people.phone.find", F.quickenrich)), { phone: "+447700900123", type: "Mobile", source: "people.phone.find-mock" });
  // Dropleads: mobile_number with the country code and no plus.
  assert.equal(readPhoneInfo(res("people.phone.find", F.dropleads), "United Kingdom").phone, "+447700900456");
  // Lusha: a list of phones with a type each.
  const l = readPhoneInfo(res("people.phone.find", F.lusha));
  assert.equal(l.phone, "+16465550142");
  assert.equal(l.type, "Mobile");
  // A landline from the provider is a Direct line.
  assert.equal(readPhoneInfo(res("people.phone.find", F.direct)).type, "Direct");
  // A truncated number fails the check and reads as no phone.
  assert.equal(readPhoneInfo(res("people.phone.find", F.limadata_short), "NL").phone, "");
});

test("phones: E.164 and display, with basic validity checks", () => {
  assert.equal(normalizePhone("07700 900123", "GB"), "+447700900123");
  assert.equal(normalizePhone("(646) 555-0142", "United States"), "+16465550142");
  assert.equal(normalizePhone("0044 20 7946 0321"), "+442079460321");
  assert.equal(normalizePhone("7700900123"), "", "no country, no prefix, no guess");
  assert.equal(normalizePhone("+1 111 111 1111"), "", "one digit repeated");
  assert.equal(normalizePhone("+44 123456789"), "", "a run of digits");
  assert.equal(normalizePhone("12345", "GB"), "", "too short");
  assert.equal(formatPhone("+16465550142"), "+1 646 555 0142");
  assert.match(formatPhone("+447700900123"), /^\+44 7700 900 123$/);
});

test("phones: the waterfall stops at the first hit, keeps the later steps to the first people and Limadata to --phones", async () => {
  const seen: string[] = [];
  const ctx = { call: async (job: string) => { seen.push(job); return job === "people.phone.find.mobile" ? res(job, F.lusha) : res(job, {}, "miss", 0); } };
  const p = { name: "Bob Two", firstName: "Bob", lastName: "Two", linkedin: "https://www.linkedin.com/in/bob-two", email: "bob@a.example" };
  const hit = await findPersonPhone(ctx, p, "a.example", "US", "s");
  assert.deepEqual(seen, ["people.phone.find", "people.phone.find.mobile"]);
  assert.equal(hit.info.phone, "+16465550142");
  assert.equal(hit.calls.length, 2);
  seen.length = 0;
  const later = await findPersonPhone(ctx, p, "a.example", "US", "s", { later: false });
  assert.deepEqual(seen, ["people.phone.find"], "a third or fourth person gets step 1 only");
  assert.equal(later.info.phone, "");
  seen.length = 0;
  const none = { call: async (job: string) => { seen.push(job); return res(job, {}, "miss", 0); } };
  await findPersonPhone(none, p, "a.example", "US", "s", { deep: true });
  assert.deepEqual(seen, ["people.phone.find", "people.phone.find.mobile", "people.phone.find.deep"]);
});

test("phones: the company line comes from a tel: link on the site", async () => {
  const seen: { job: string; input: Record<string, unknown> }[] = [];
  const ctx = { call: async (job: string, input: Record<string, unknown>) => { seen.push({ job, input }); return res(job, F.site); } };
  const r = await findCompanyLine(ctx, "a.example", "GB", "line");
  assert.deepEqual(r.info, { phone: "+442079460000", type: "Company line", source: "website (a.example)" });
  assert.deepEqual(seen.map((s) => [s.job, s.input.url]), [["web.scrape.markdown", "https://a.example"]]);
});

const accounts = { rows: [{ domain: "a.example", name: "A Co", grade: "A", score: 90, country: "United Kingdom" }] };
const search = { results: [{ full_name: "Bob Two", title: "CEO", linkedin_url: "https://www.linkedin.com/in/bob-two" }, { full_name: "Cy Three", title: "Head of Marketing", linkedin_url: "https://www.linkedin.com/in/cy-three" }] };

async function runCommittee(cfg = normalizeConfig({ people: true, committeePhones: true, domain: "acme.example", limits: { committeeAccounts: 1 } })) {
  const seen: string[] = [];
  const call = async (job: string, input: Record<string, unknown>) => {
    seen.push(job);
    if (job === "people.search") return res(job, search);
    if (job === "people.phone.find" && String(input.linkedin_url).includes("bob")) return res(job, F.quickenrich);
    if (job === "web.scrape.markdown") return res(job, F.site);
    return res(job, {}, "miss", 0);
  };
  const out = (await committee.run({ cfg, mode: "live", outputs: { accounts, enrich: { rows: [] }, people: { rows: [] } }, outDir: "", partial: () => {}, log: () => {}, call })).out as CommitteeOut;
  return { out, seen };
}

test("phones: the committee labels each phone, adds the company line and prices the waterfall in the quote", async () => {
  const { out, seen } = await runCommittee();
  const a = out.accounts[0];
  const bob = a.members.find((m) => m.name === "Bob Two")!;
  assert.equal(bob.phone, "+447700900123");
  assert.equal(bob.phoneType, "Mobile");
  assert.equal(bob.phoneSource, "people.phone.find-mock");
  const cy = a.members.find((m) => m.name === "Cy Three")!;
  assert.equal(cy.phone, "");
  assert.equal(cy.phoneStatus, "not found");
  assert.equal(a.companyPhone, "+442079460000");
  assert.ok(seen.includes("people.phone.find.mobile"), "Cy missed step 1, so step 2 ran");
  assert.match(out.summary, /1 phone numbers found, 1 company line/);
  // Cost section: one line for phones with mobile, direct and company line counts.
  const section = committee.render(out, "done", { public: false })!;
  const html = renderHtml({ domain: "acme.example", brand: "Acme", generatedAt: "2026-11-05T09:00:00.000Z", public: false, sections: [section] });
  assert.match(html, /Phones: \d+ lookups, \$[\d.]+ charged\. 1 mobile, 0 direct, 1 company line/);
  assert.match(html, /href="tel:\+447700900123"/);
  assert.match(html, /\+44 7700 900 123/);
  assert.match(html, /Company line/);
  assert.ok(!html.includes(", and ") && !html.includes("—"));
  // committee.csv carries the type, the source and the company line.
  const file = committee.files!(out)["committee.csv"];
  assert.match(file.split("\n")[0], /phone,phone_type,phone_source,phoneStatus,company_line/);
  // The quote prices step 1 for everyone, step 2 for the first two per committee, the site read for the line.
  const q = buildQuote([committee], normalizeConfig({ people: true, committeePhones: true, domain: "acme.example", limits: { committeeAccounts: 2 } }), await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  const mobile = q.rows[0].lines.find((l) => l.job === "people.phone.find.mobile")!;
  assert.equal(mobile.calls, 4);
  assert.ok(mobile.expected < mobile.worst / 5, "a hit-only step is expected to bill a share of its calls");
});

test("phones: --no-phones skips every phone lookup and the quote drops the phone lines", async () => {
  const cfg = normalizeConfig({ people: true, committeePhones: true, domain: "acme.example", limits: { committeeAccounts: 1 } }, { noPhones: true });
  assert.equal(cfg.committeePhones, false);
  assert.equal(cfg.phones, false);
  const { out, seen } = await runCommittee(cfg);
  assert.ok(!seen.some((j) => j.startsWith("people.phone") || j === "web.scrape.markdown"), seen.join(","));
  assert.ok(out.accounts[0].members.every((m) => m.phoneStatus === "skipped" && !m.phone));
  const q = buildQuote([committee], cfg, await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  assert.ok(!q.rows[0].lines.some((l) => l.job.startsWith("people.phone")));
  // The yaml key turns committee phones off too, and --phones never turns them back on over --no-phones.
  assert.equal(normalizeConfig({ domain: "x.example", committeePhones: false }).committeePhones, false);
  assert.equal(normalizeConfig({ domain: "x.example" }, { phones: true, noPhones: true }).phones, false);
});

test("phones: people.csv gets phone and phone_type, filled from the committee, masked in public", async () => {
  const { out } = await runCommittee();
  const enrichRows = [{ account: "A Co", domain: "a.example", name: "Bob Two", title: "CEO", email: "bob@a.example", status: "valid", linkedin: "https://www.linkedin.com/in/bob-two", phone: "" }];
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-phones-"));
  writeArtifacts(dir, { enrich: { rows: enrichRows }, committee: out }, { public: false });
  const lines = readFileSync(join(dir, "people.csv"), "utf8").trim().split("\n");
  assert.match(lines[0], /,phone,phone_type$/);
  assert.match(lines[1], /,\+447700900123,Mobile$/);
  const pubDir = mkdtempSync(join(tmpdir(), "looot-zeus-phones-pub-"));
  writeArtifacts(pubDir, { enrich: { rows: enrichRows }, committee: out }, { public: true });
  const pub = readFileSync(join(pubDir, "people.csv"), "utf8");
  assert.ok(!pub.includes("7700900123"), "public people.csv masks the phone");
});

test("free run: no people or enrich calls, a names-and-roles committee for the top 5 accounts only, phones need people and an opt-in", async () => {
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: true });
  const free = normalizeConfig({ domain: "acme.example" });
  assert.equal(free.people, false);
  assert.equal(free.phones, false);
  assert.equal(free.committeePhones, false);
  const q = buildQuote(MODULES, free, book);
  for (const id of ["people", "enrich"]) assert.match(q.rows.find((r) => r.module === id)!.skip ?? "", /company-level/);
  // Luisa, looot-zeus#11 2026-11-25: "Free run includes top-5 committees". Names and roles: 5 people.search, nothing else.
  const peopleJobs = q.rows.flatMap((r) => r.lines).filter((l) => l.job.startsWith("people."));
  assert.deepEqual(peopleJobs.map((l) => `${l.job}x${l.calls}`), ["people.searchx5"]);
  // phones without people stay off
  assert.equal(normalizeConfig({ domain: "x.example" }, { phones: true }).committeePhones, false);
  // people on: emails yes, phones still off until asked
  const paid = normalizeConfig({ domain: "x.example" }, { people: true });
  assert.equal(paid.committeePhones, false);
  assert.ok(!buildQuote(MODULES, paid, book).rows.flatMap((r) => r.lines).some((l) => l.job.startsWith("people.phone")));
  assert.ok(buildQuote(MODULES, paid, book).rows.flatMap((r) => r.lines).some((l) => l.job === "people.email.find"));
  const withPhones = normalizeConfig({ domain: "x.example" }, { people: true, phones: true });
  assert.equal(withPhones.committeePhones, true);
});

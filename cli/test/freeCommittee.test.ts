import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { committee, type CommitteeOut } from "../src/modules/committee.js";

// Luisa, looot-zeus#11 2026-11-25: "Free run includes top-5 committees". Names and roles only.
test("free run: committees for the top 5 accounts, names and roles, no email or phone lookups, emails from a search dropped", async () => {
  const cfg = normalizeConfig({ domain: "acme.example" });
  assert.equal(cfg.people, false);
  const rows = Array.from({ length: 8 }, (_, i) => ({ name: `Acct ${i}`, domain: `a${i}.example`, grade: i < 6 ? "A" : "B", score: 100 - i }));
  const jobs: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (job: string, input: any): Promise<any> => {
    jobs.push(job);
    const people = [
      { full_name: "Ann One", title: "CEO", email: `ann@${input.domain}`, linkedin_url: "https://www.linkedin.com/in/ann-one-test" },
      { full_name: "Bob Two", title: "Head of Marketing", email: `bob@${input.domain}` },
    ];
    return { record: { module: "committee", job, provider: "mock", outcome: "hit", quoted: 0.01, charged: 0.001, ms: 1, ts: "" }, run: { runId: "r", status: "completed", outcome: "hit" }, data: { results: people } };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await committee.run({ cfg, mode: "live", outputs: { accounts: { rows } as any }, outDir: "", partial: () => {}, log: () => {}, call: call as any });
  const out = res.out as CommitteeOut;
  assert.deepEqual(out.accounts.map((a) => a.domain), ["a0.example", "a1.example", "a2.example", "a3.example", "a4.example"]);
  assert.deepEqual([...new Set(jobs)], ["people.search"]);
  assert.equal(jobs.length, 5);
  const m = out.accounts.flatMap((a) => a.members);
  assert.ok(m.length >= 5 && m.every((x) => x.name && x.role));
  assert.ok(m.every((x) => x.email === "" && x.emailStatus === "paid run" && x.phone === ""), "no email or phone on the free run");
  assert.ok(!JSON.stringify(out).includes("@a0.example"), "an email a search handed back is not kept");
});

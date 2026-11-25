import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";
import { AGENT_ONE_LINER, agentPill } from "../src/city/index.js";

const repo = join(PKG_ROOT, "..");

test("the city pill is the agent one-liner; npx is only the developer note", () => {
  assert.equal(AGENT_ONE_LINER, "run zeus.looot.ai for mycompany.com");
  const p = agentPill();
  assert.match(p, /<span>Make yours, tell your agent<\/span><code>run zeus\.looot\.ai for mycompany\.com<\/code>/);
  assert.match(p, /class="zdev src">For developers: <code>npx looot-zeus run yourdomain\.com<\/code>/);
});

test("no page or README says 'Made by one command' with the npx command any more", () => {
  // The public loootai/zeus repo has no city/ or build/ folder: check the files that exist.
  for (const f of ["README.md", "city/index.html", "build/make_hf.py", "cli/src/city/index.ts"].filter((f) => existsSync(join(repo, f)))) {
    const t = readFileSync(join(repo, f), "utf8");
    assert.doesNotMatch(t, /Made by one command/, f);
    assert.match(t, /run zeus\.looot\.ai for mycompany\.com/, f);
  }
});

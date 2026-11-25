import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CAPS, USE_DEFAULT_CAPS, resolveCaps, unknownCapSections } from "../src/capDefaults.js";
import { normalizeConfig } from "../src/config.js";
import { loadFixture } from "../src/modules/fixture.js";
import { MODULES } from "../src/modules/index.js";
import { buildQuote, loadPriceBook } from "../src/quote.js";

for (const depth of ["sample", "full"] as const) {
  test(`worst-case quote of a full default run on the demo fixtures is under 2.00 USD (${depth})`, async () => {
    assert.equal(USE_DEFAULT_CAPS, true);
    const cfg = normalizeConfig(loadFixture("config").config, { depth });
    const q = buildQuote(MODULES, cfg, await loadPriceBook({ cacheDir: ".looot-zeus-test", offline: true }));
    assert.ok(q.worstCapped < 2, `worst under caps ${q.worstCapped}`);
    const sum = q.rows.reduce((n, r) => n + r.worstCapped, 0);
    assert.ok(sum < 2, `sum of section worst cases ${sum}`);
    assert.ok(q.worst > 2, "the uncapped worst case is above 2, so the caps do the work");
  });
}

test("every section with paid calls has a default cap, and a brief's own caps win", () => {
  for (const id of Object.keys(DEFAULT_CAPS.sections)) assert.ok(MODULES.some((m) => m.id === id), `${id} is not a module`);
  const r = resolveCaps({ caps: { totalRuns: 20, sections: { seo: { runs: 3 } } } });
  assert.equal(r.totalRuns, 20);
  assert.equal(r.totalUsd, DEFAULT_CAPS.totalUsd);
  assert.deepEqual(r.sections.seo, { usd: DEFAULT_CAPS.sections.seo!.usd, runs: 3 });
});

test("a section name that is not a module is reported", () => {
  const ids = MODULES.map((m) => m.id);
  assert.deepEqual(unknownCapSections(resolveCaps({ caps: { sections: { seo: { runs: 3 }, seoo: { runs: 1 } } } }), ids), ["seoo"]);
  assert.deepEqual(unknownCapSections(DEFAULT_CAPS, ids), []);
});

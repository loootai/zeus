import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

function cityHtml(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-counts-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm"), ...extra], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  return readFileSync(join(dir, "gtm", "city", "index.html"), "utf8");
}

/** The items the first list on a piece of page shows, counted from the HTML a reader gets: rows, cards,
 * committees or bar rows, up to the next caption or section. */
function firstListItems(html: string): number {
  const kinds = [{ open: "<tbody>", item: /<tr>/g }, { open: '<div class="zg-cards">', item: /<article class="card zg-card">/g }, { open: '<div class="zg-ccs">', item: /<article class="zg-cc">/g }, { open: '<div class="zg-brow">', item: /<div class="zg-brow">/g }];
  const first = kinds.map((k) => ({ ...k, at: html.indexOf(k.open) })).filter((k) => k.at >= 0).sort((x, y) => x.at - y.at)[0];
  if (!first) return 0;
  const rest = html.slice(first.at);
  const end = rest.slice(1).search(/<p class="zg-cap">|<div class="sec|<\/tbody>/);
  return (rest.slice(0, end < 0 ? undefined : end + 1).match(first.item) ?? []).length;
}

function viewHtml(html: string, view: string): string {
  const i = html.indexOf(`data-view="${view}"`);
  assert.ok(i >= 0, `no ${view} view`);
  return html.slice(i, html.indexOf("</section>", i));
}

for (const mode of [[], ["--public"]]) {
  test(`every menu count equals the items its view shows${mode.length ? " (public)" : ""}`, () => {
    const html = cityHtml(mode);
    const badges = [...html.matchAll(/<a href="#(\w+)">(?:(?!<\/a>).)*?<span class="n">(\d+)<\/span><\/a>/g)].map((m) => ({ view: m[1], n: Number(m[2]) }));
    assert.ok(badges.length >= 8, `only ${badges.length} menu counts`);
    for (const { view, n } of badges) {
      let part: string;
      if (view === "committees") {
        const t = viewHtml(html, "targets");
        part = t.slice(t.indexOf('id="committees"'), t.indexOf('id="openers"'));
      } else part = viewHtml(html, view);
      assert.equal(firstListItems(part), n, `${view}: menu says ${n}`);
    }
    // The map and the overview say the same number of target accounts as the menu.
    const targets = badges.find((b) => b.view === "targets")!.n;
    assert.match(html, new RegExp(`>${targets} target accounts?<|${targets} target accounts?\\b`));
    for (const m of html.matchAll(/class="flw" href="#(\w+)"><span class="fln">\d+<\/span>[^<,]*, (\d+)</g)) {
      const b = badges.find((x) => x.view === m[1]);
      if (b) assert.equal(Number(m[2]), b.n, `overview ${m[1]}`);
    }
  });
}

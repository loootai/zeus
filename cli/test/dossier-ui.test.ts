import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Block, Section } from "../src/dossier/blocks.js";
import { renderHtml } from "../src/dossier/html.js";
import { assemble, overviewSection, PLAYS_EMPTY, playsSection, type Dossier } from "../src/dossier/index.js";
import { renderMarkdown } from "../src/dossier/md.js";
import { loadFixture } from "../src/modules/fixture.js";
import type { ModuleResult } from "../src/modules/types.js";
import type { Receipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");

const receipt = (): Receipt => ({
  schemaVersion: "1",
  run: { domain: "yourdomain.com", mode: "live", startedAt: "2026-10-30T09:00:00.000Z", finishedAt: "2026-10-30T09:01:00.000Z", cap: 10, expected: 2, worst: 3, charged: 2.5, calls: 40, durationMs: 60000, capStopped: false, priceSource: "test" },
  modules: [
    { id: "accounts", label: "Accounts", status: "done", calls: 20, quoted: 1, worst: 1, charged: 1.5, summary: "x", startedAtMs: 0, endedAtMs: 1 },
    { id: "ads", label: "Ads", status: "done", calls: 20, quoted: 1, worst: 1, charged: 1, summary: "x", startedAtMs: 0, endedAtMs: 1 },
  ],
  calls: [],
});

const dossierOf = (blocks: Block[], pub = false): Dossier => ({
  domain: "yourdomain.com",
  brand: "YourBrand",
  generatedAt: "2026-11-03T10:00:00.000Z",
  public: pub,
  sections: [{ num: "01", id: "accounts", title: "Accounts", status: "done", source: "test", blocks } satisfies Section],
});

const CARDS: Block = {
  kind: "cards",
  caption: "Three cards",
  items: [
    { title: "Mara Vermeer", titlePii: "name", tag: "#1", basis: "fact", rows: [{ label: "Email", value: "mara.vermeer@northwind-logistics.example", pii: "email" }, { label: "Applies to", value: "accounts.csv grade A" }], command: "looot-zeus watch --cap 5" },
    { title: "Setup speed ad angle", basis: "inferred", text: "no rival ad uses setup speed", meter: { value: 3, max: 4, label: "Rivals" } },
  ],
};
const BARS: Block = { kind: "bars", caption: "Accounts by grade", items: [{ label: "Grade A", value: 4 }, { label: "Grade B", value: 2, display: "two" }] };

test("cards and bars say the same thing in markdown and html", () => {
  const d = dossierOf([CARDS, BARS]);
  const md = renderMarkdown(d);
  const html = renderHtml(d);
  for (const s of ["Three cards", "Mara Vermeer", "Setup speed ad angle", "no rival ad uses setup speed", "accounts.csv grade A", "looot-zeus watch --cap 5", "Accounts by grade", "Grade A", "Grade B", "two", "inferred", "fact", "#1"]) {
    assert.ok(md.includes(s), `md misses ${s}`);
    assert.ok(html.includes(s), `html misses ${s}`);
  }
  assert.match(md, /Rivals 3 of 4/);
  assert.match(html, /Rivals 3 of 4/);
  // one card per line in both, so public masking sees each card on its own
  assert.equal(md.split("\n").filter((l) => l.startsWith("- **")).length, 2);
  assert.equal(html.split("\n").filter((l) => l.startsWith('<article class="pc">')).length, 2);
  // bars: the longest is full, the other half
  assert.match(md, /\| Grade A \| `█{20}` \| 4 \|/);
  assert.match(md, /\| Grade B \| `█{10}░{10}` \| two \|/);
  assert.match(html, /--v:1\.000/);
  assert.match(html, /--v:0\.500/);
});

test("cards mask people in a public copy, in both files", () => {
  const d = dossierOf([CARDS], true);
  for (const t of [renderMarkdown(d), renderHtml(d)]) {
    assert.ok(!t.includes("Mara Vermeer"));
    assert.ok(!t.includes("mara.vermeer@"));
    assert.match(t, /M\. V\./);
    assert.match(t, /m\*\*\*@northwind-logistics\.example/);
  }
});

test("an empty plays list reads as a plain empty state", () => {
  const s = playsSection(new Map(), undefined);
  assert.equal(s.id, "plays");
  const d: Dossier = { ...dossierOf([]), plays: s };
  assert.ok(renderMarkdown(d).includes(PLAYS_EMPTY));
  const html = renderHtml(d);
  assert.ok(html.includes("Nothing here yet"));
  assert.ok(html.includes(PLAYS_EMPTY.split(".")[0]));
  assert.match(html, /data-v="plays"><svg[^]*?<span class="n z">0<\/span>/);
});

test("the overview counts from the run and says when a module found nothing", () => {
  const acc = loadFixture("accounts");
  const results = new Map<string, ModuleResult>([
    ["accounts", { status: "done", summary: "x", out: acc }],
    ["ads", { status: "skipped", summary: "x", out: null }],
  ]);
  const s = overviewSection(results, receipt());
  const stat = s.blocks.find((b) => b.kind === "stat") as Extract<Block, { kind: "stat" }>;
  const by = Object.fromEntries(stat.items.map((i) => [i.label, i]));
  assert.equal(by["Target accounts"].value, String(acc.rows.length));
  assert.equal(by["Ad angles you miss"].hint, "skipped in this run");
  assert.equal(by["Hot accounts"].hint, "not in this run");
  assert.equal(by["Spend vs cap"].value, "$2.50");
  assert.equal(by["Spend vs cap"].meter, 0.25);
  assert.ok(s.blocks.some((b) => b.kind === "bars" && b.caption === "Charged by module"));
});

test("the plays table moves out of the summary into the plays view", () => {
  const synth = { id: "synthesis", label: "Synthesis", needs: [], quote: () => ({ lines: [] }), run: async () => ({ status: "done" as const, summary: "", out: null }),
    render: (): Section => ({ num: "00", id: "summary", title: "Summary", status: "done", source: "", blocks: [{ kind: "table", columns: [{ key: "title", label: "Play" }, { key: "evidence", label: "Evidence" }, { key: "command", label: "Scale it" }], rows: [{ title: "x", evidence: "y", command: "z" }] }, { kind: "note", text: "kept" }] }) };
  const plays = [{ title: "Hiring sales now", evidence: "3 accounts posted AE roles", list: "signals.json intent hot", command: "looot-zeus watch --cap 5", cost: "about $0.10 a week" }];
  const results = new Map<string, ModuleResult>([["synthesis", { status: "done", summary: "", out: { lines: [], plays, brief: { offer: "", icp: "", competitors: "" } } }]]);
  const d = assemble({ domain: "yourdomain.com", brand: "YourBrand", mods: [synth], results, receipt: receipt(), public: false });
  const sum = d.sections.find((x) => x.id === "summary")!;
  assert.ok(!sum.blocks.some((b) => b.kind === "table"));
  assert.ok(sum.blocks.some((b) => b.kind === "note"));
  const cards = d.plays!.blocks.find((b) => b.kind === "cards") as Extract<Block, { kind: "cards" }>;
  assert.equal(cards.items.length, 1);
  assert.equal(cards.items[0].command, "looot-zeus watch --cap 5");
  assert.match(renderMarkdown(d), /## Plays[^]*Hiring sales now[^]*## 00 Summary/);
});

test("the demo page is one offline app: views, counts, keys, print, phone width", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-ui-"));
  execFileSync(process.execPath, [cli, "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  const html = readFileSync(join(dir, "gtm", "dossier.html"), "utf8");
  for (const v of ["overview", "plays", "buyers", "signals", "rivals", "ads", "seo", "reviews", "market", "brief", "receipt"]) {
    assert.match(html, new RegExp(`id="v-${v}" data-view="${v}"`), `view ${v}`);
    assert.match(html, new RegExp(`href="#${v}" data-v="${v}"`), `nav ${v}`);
  }
  assert.match(html, /data-v="plays"><svg[^]*?<span class="n">10<\/span>/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /hashchange/);
  assert.match(html, /@media print/);
  assert.match(html, /@media \(max-width:900px\)/);
  assert.match(html, /name="viewport"/);
  // offline: nothing loads from the network
  assert.ok(!/<link[^>]+href="http/i.test(html));
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/@import|url\(http/i.test(html));
  // no emoji as icons
  assert.ok(!/\p{Extended_Pictographic}/u.test(html.replace(/[←→]/g, "")));
  const md = readFileSync(join(dir, "gtm", "dossier.md"), "utf8");
  assert.match(md, /^## Overview$/m);
  assert.match(md, /^## Plays$/m);
});

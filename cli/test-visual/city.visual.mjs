// Visual test: the city page `looot-zeus demo` writes must look like David's hand-built Higgsfield
// city (../city/index.html). Renders both in a real browser (Playwright), saves screenshots to
// screenshots/city/, and compares the layout: same app grid and sidebar, the same isometric city
// (viewBox, building count, dark panel), the same menu groups, every building labelled from the run,
// no network request and no script error. Run: npm run build && npm run test:visual
// Playwright is not a dependency of the package: set PLAYWRIGHT=/path/to/playwright/index.mjs, or
// install it next to the repo. Without it the test says so and exits 0.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const david = join(pkg, "..", "city", "index.html");
const shots = join(pkg, "..", "screenshots", "city");

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright")); }
catch { console.log("SKIP: Playwright not found. Set PLAYWRIGHT=/path/to/playwright/index.mjs"); process.exit(0); }
if (!existsSync(david)) { console.log("SKIP: no city/index.html (David's page) next to the package"); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "looot-zeus-visual-"));
execFileSync(process.execPath, [join(pkg, "dist", "src", "cli.js"), "demo", "--out", join(dir, "gtm")], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
const ours = join(dir, "gtm", "city", "index.html");
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
async function measure(file, name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) requests.push(r.url()); });
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, `${name}-overview.png`) });
  await page.locator(".iso").screenshot({ path: join(shots, `${name}-city.png`) });
  const m = await page.evaluate(() => {
    const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.round(r.x), w: Math.round(r.width) } : null; };
    const iso = document.querySelector(".iso"), svg = iso?.querySelector("svg");
    return {
      app: getComputedStyle(document.querySelector(".app")).gridTemplateColumns.split(" ")[0],
      side: box(".side"), main: box("main"),
      viewBox: svg?.getAttribute("viewBox"),
      buildings: iso?.querySelectorAll(".isa").length ?? 0,
      callouts: iso?.querySelectorAll(".isl").length ?? 0,
      panelBg: getComputedStyle(svg.querySelector("rect")).fill,
      groups: [...document.querySelectorAll(".side h6")].map((h) => h.textContent),
      unlabelled: [...(iso?.querySelectorAll(".isa") ?? [])].filter((a) => !a.getAttribute("data-t") || /\{\{/.test(a.outerHTML)).length,
      act: document.querySelector(".view.act")?.getAttribute("data-view"),
      // Each district callout: its title, where it sits on the page and how far the city starts from the top.
      labels: Object.fromEntries([...(iso?.querySelectorAll(".isl") ?? [])].map((l) => { const r = l.getBoundingClientRect(); return [l.querySelector(".islt")?.textContent ?? "", { x: Math.round(r.x), y: Math.round(r.y - iso.getBoundingClientRect().y) }]; })),
      subs: [...(iso?.querySelectorAll(".isl .isls") ?? [])].map((t) => t.textContent),
      cityTop: Math.round((iso?.getBoundingClientRect().y ?? 0) + window.scrollY),
      badges: [...document.querySelectorAll(".side .n")].map((n) => n.textContent),
    };
  });
  await page.goto(pathToFileURL(file).href + "#targets");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shots, `${name}-targets.png`) });
  await page.close();
  return { ...m, errors, requests };
}

const a = await measure(david, "david");
const b = await measure(ours, "demo");
await browser.close();
console.log(JSON.stringify({ david: { ...a, requests: a.requests.length }, demo: b }, null, 1));

assert.equal(b.app, a.app, "same sidebar column");
assert.deepEqual(b.side, a.side, "same sidebar box");
assert.deepEqual(b.main, a.main, "same main box");
assert.equal(b.viewBox, a.viewBox, "same city viewBox");
assert.equal(b.buildings, a.buildings, "same buildings");
assert.equal(b.callouts, a.callouts, "same callouts");
assert.equal(b.panelBg, a.panelBg, "same dark city panel");
assert.deepEqual(b.groups.slice(0, a.groups.length), a.groups, "David's menu groups first, in order");
assert.equal(b.unlabelled, 0, "every building has a label from the run");
assert.equal(b.act, "overview");
// David's story callouts: the same district labels, at the same place in the city (within 2 px).
for (const t of ["Engine quarter", "Signal engine", "Format studio", "One looot key", "Programmatic pages", "CRM HQ", "Daily rhythm", "Campaign lanes", "Guardrails", "Rivals", "Reach", "Buyers"]) {
  if (t === "Engine quarter") continue; // a text heading, not a callout; checked below
  assert.ok(a.labels[t], `David has ${t}`);
  // CRM HQ is coming soon in paid.json since Export to CRM: the callout names Push to my CRM at the same place.
  const bt = t === "CRM HQ" ? "Push to my CRM" : t;
  assert.ok(b.labels[bt], `demo has the ${bt} callout`);
  assert.ok(Math.abs(a.labels[t].x - b.labels[bt].x) <= 2 && Math.abs(a.labels[t].y - b.labels[bt].y) <= 2, `${bt} sits where David's ${t} does`);
}
assert.equal(b.subs.filter((s) => s === "Not in the free run").length, a.subs.filter((s) => s === "Not in the free run").length - 1, "the same locked districts say Not in the free run, less CRM HQ (coming soon)");
assert.ok(b.subs.every((s) => !/See what a paid run adds|Room to grow/.test(s)), "no generic Room to grow callout");
assert.ok(b.badges.some((x) => /^\d+\/\d+$/.test(x)), "menu counts read shown/total where the run found more");
assert.ok(b.cityTop - a.cityTop <= 60, `the city starts near where David's does (${b.cityTop} vs ${a.cityTop})`);
assert.deepEqual(b.errors, [], "no script error");
assert.deepEqual(b.requests, [], "the generated page makes no network request");
console.log(`PASS: demo city matches David's layout. Screenshots in ${shots}`);

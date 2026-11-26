// "Your next plays": the Atlas matcher and its masking. Written before src/plays (test first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ATLAS, findingsOf, goalsFor, matchPlays, OUTCOMES, type Finding } from "../src/plays/index.js";
import { JOBS } from "../src/modules/jobs.js";

const hiring: Finding = { topic: "hiring", text: "Northwind Logistics posted 3 Account Executive roles on 27 Oct", safe: "1 target account posted sales roles in the last 60 days" };
const rivals: Finding = { topic: "rivals", text: "3 rivals found: Rival A, Rival B, Rival C", safe: "3 rivals found" };
const seo: Finding = { topic: "seo", text: "5 keyword gaps a rival ranks for, the biggest \"crm for real estate agents\" (2,900 US searches)", safe: "5 keyword gaps a rival ranks for (2,900 US searches on the biggest)" };
const base = { company: "YourBrand", domain: "yourdomain.com" };

test("the Atlas has 1,000 plays in 20 goals, each with steps", () => {
  assert.equal(ATLAS.plays.length, 1000);
  assert.equal(ATLAS.goals.length, 20);
  for (const p of ATLAS.plays) {
    assert.ok(p.title && p.goal && p.rule && p.delivery, `play ${p.id} is complete`);
    assert.ok(p.steps.length > 0, `play ${p.id} has steps`);
  }
});

test("no findings, no plays: nothing is recommended without a real reason", () => {
  assert.deepEqual(matchPlays({ ...base, findings: [] }), []);
});

test("top 5, each 'why' is one real finding about the company, and its topic is a trigger of the play", () => {
  const findings = [hiring, rivals, seo];
  const plays = matchPlays({ ...base, findings });
  assert.equal(plays.length, 5);
  for (const p of plays) {
    const f = findings.find((x) => p.why === `Why it fits YourBrand: ${x.text}.`);
    assert.ok(f, `"${p.why}" is built from a finding`);
    assert.ok(p.triggers.includes(f!.topic), `${p.title} is triggered by ${f!.topic}`);
  }
});

test("a play whose trigger is not in the findings never shows", () => {
  const plays = matchPlays({ ...base, findings: [hiring] });
  assert.ok(plays.length > 0);
  for (const p of plays) assert.ok(p.triggers.includes("hiring"), `${p.title} needs a hiring trigger`);
});

test("at most 2 plays per Atlas goal, and the same input gives the same answer", () => {
  const a = matchPlays({ ...base, findings: [hiring, rivals, seo] });
  const counts = new Map<string, number>();
  for (const p of a) counts.set(p.goal, (counts.get(p.goal) ?? 0) + 1);
  for (const [g, n] of counts) assert.ok(n <= 2, `${g} has ${n}`);
  assert.deepEqual(matchPlays({ ...base, findings: [hiring, rivals, seo] }), a);
});

test("a goal keeps the plays inside its Atlas goals", () => {
  assert.equal(OUTCOMES.length, 6);
  assert.equal(new Set(OUTCOMES.flatMap((o) => o.goals)).size, 20, "the 6 outcomes cover the 20 Atlas goals");
  const want = goalsFor("more customers")!;
  assert.ok(want.includes("Buying signals"));
  const plays = matchPlays({ ...base, findings: [hiring, rivals, seo], goal: "more customers" });
  assert.ok(plays.length > 0);
  for (const p of plays) assert.ok(want.includes(p.goal), `${p.goal} is a 'more customers' goal`);
  assert.equal(goalsFor("SEO and AI search")?.[0], "SEO and AI search", "an Atlas goal name works as is");
  assert.equal(goalsFor("make me rich"), null);
});

test("public pages use the masked finding: no account or rival name in any why or prompt", () => {
  const plays = matchPlays({ ...base, findings: [hiring, rivals, seo], isPublic: true });
  assert.ok(plays.length > 0);
  for (const p of plays) {
    for (const name of ["Northwind", "Rival A", "Rival B", "real estate agents"]) {
      assert.ok(!p.why.includes(name), `why names ${name}: ${p.why}`);
      assert.ok(!p.prompt.includes(name), `prompt names ${name}`);
    }
  }
});

test("price range and prompt come from looot jobs Zeus knows, with a cost cap", () => {
  for (const p of matchPlays({ ...base, findings: [hiring, rivals, seo] })) {
    assert.ok(p.jobs.length > 0);
    for (const j of p.jobs) assert.ok(JOBS[j], `${j} is a looot job in the catalog snapshot`);
    assert.ok(p.lowUsd > 0 && p.lowUsd <= p.highUsd && p.highUsd <= p.capUsd, `${p.lowUsd} <= ${p.highUsd} <= ${p.capUsd}`);
    for (const j of p.jobs) assert.ok(p.prompt.includes(`job:${j}`), `prompt names job:${j}`);
    assert.match(p.prompt, /yourdomain\.com/);
    assert.match(p.prompt, /Budget \$\d/);
    assert.match(p.prompt, /price first/);
  }
});

test("Run it shows only where Zeus has the command", () => {
  const plays = matchPlays({ ...base, findings: [hiring, rivals, seo] });
  for (const p of plays) if (p.runCommand) assert.match(p.runCommand, /^npx looot-zeus (more (accounts|committee|ads|social|seo)|run --only signals)/);
  const seoPlays = matchPlays({ ...base, findings: [seo], goal: "SEO and AI search" });
  assert.ok(seoPlays.every((p) => p.runCommand === "npx looot-zeus more seo"));
  const ops = matchPlays({ ...base, findings: [rivals], goal: "Competitor displacement" });
  assert.ok(ops.length > 0 && ops.every((p) => p.runCommand === undefined), "no Zeus command for competitor displacement");
});

test("findings from the demo run: real facts, and the safe text names no third party", () => {
  const out: Record<string, any> = {};
  for (const f of ["signals", "competitors", "ads", "seo", "readiness", "accounts", "reviews", "mentions", "icp", "market"]) out[f] = JSON.parse(readFileSync(new URL(`../../fixtures/${f}.json`, import.meta.url), "utf8"));
  const fs = findingsOf(out);
  const topics = new Set(fs.map((f) => f.topic));
  for (const t of ["hiring", "rivals", "ads", "seo", "geo", "readiness", "accounts", "stack"]) assert.ok(topics.has(t as Finding["topic"]), `found ${t}`);
  const hire = fs.find((f) => f.topic === "hiring")!;
  assert.match(hire.text, /Northwind Logistics/);
  const names = ["Northwind", "Silverline", "Fernway", "Rival A", "Rival B", "Rival C", "rival-a.com", "HubSpot"];
  for (const f of fs) for (const n of names) assert.ok(!f.safe.includes(n), `${f.topic} safe text names ${n}: ${f.safe}`);
});

test("the city page lists the plays with Tell your agent, Run it only where Zeus has the command, and the Atlas credit", async () => {
  const { renderCity } = await import("../src/city/index.js");
  const plays = matchPlays({ ...base, findings: [hiring, rivals, seo] });
  const html = renderCity({ domain: "yourdomain.com", brand: "YourBrand", generatedAt: "2026-11-26T09:00:00Z", public: false, sections: [], nextPlays: plays, goal: "more customers" });
  assert.match(html, /<section class="view" data-view="plays"/);
  assert.match(html, /href="#plays"[^>]*>.*?Your next plays/s);
  assert.match(html, /Workflow Atlas by Walid/);
  assert.match(html, /Goal: More customers/);
  assert.equal((html.match(/id="play-\d+"/g) ?? []).length, plays.length);
  assert.equal((html.match(/zrun-it/g) ?? []).length, plays.filter((p) => p.runCommand).length);
  const empty = renderCity({ domain: "yourdomain.com", brand: "YourBrand", generatedAt: "", public: false, sections: [], nextPlays: [] });
  assert.match(empty, /found nothing a play can be built on yet/);
});

test("a public run's plays (assembled from module outputs) name no account or rival", async () => {
  const { nextPlaysOf } = await import("../src/dossier/index.js");
  const results = new Map<string, any>();
  for (const f of ["signals", "competitors", "ads", "seo", "readiness", "accounts", "reviews", "mentions", "icp", "market"]) results.set(f, { status: "done", summary: "", out: JSON.parse(readFileSync(new URL(`../../fixtures/${f}.json`, import.meta.url), "utf8")) });
  const priv = nextPlaysOf({ domain: "yourdomain.com", brand: "YourBrand", results, public: false });
  const pub = nextPlaysOf({ domain: "yourdomain.com", brand: "YourBrand", results, public: true });
  assert.equal(pub.length, 5);
  assert.ok(priv.some((p) => /Northwind|Rival A/.test(p.why)), "the private page names them");
  for (const p of pub) for (const n of ["Northwind", "Silverline", "Brightpath", "Rival A", "Rival B", "HubSpot"]) assert.ok(!`${p.why} ${p.prompt}`.includes(n), `${n} in ${p.why}`);
});

test("the plays view lets you browse all 20 goals and 1,000 workflows, data inline and script-safe", async () => {
  const { renderCity } = await import("../src/city/index.js");
  const html = renderCity({ domain: "yourdomain.com", brand: "YourBrand", generatedAt: "", public: true, sections: [], nextPlays: [] });
  const m = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "atlas data inline");
  assert.ok(!m![1]!.includes("<"), "no raw < in the data");
  const d = JSON.parse(m![1]!);
  assert.equal(d.goals.length, 20);
  assert.equal(d.plays.length, 1000);
  assert.equal(d.domain, "yourdomain.com");
  assert.match(html, /All plays by goal/);
});

test("goal fit counts use the matcher, and the goal cards carry icon, promise and fit", async () => {
  const { fitCounts } = await import("../src/plays/index.js");
  const fits = fitCounts([hiring, rivals, seo]);
  assert.ok((fits["Buying signals"] ?? 0) > 0);
  assert.equal(fitCounts([])["Buying signals"], undefined);
  const { renderCity, GOAL_META } = await import("../src/city/index.js");
  assert.equal(Object.keys(GOAL_META).length, 20);
  for (const g of ATLAS.goals) assert.ok(GOAL_META[g], g);
  const html = renderCity({ domain: "yourdomain.com", brand: "YourBrand", generatedAt: "", public: false, sections: [], nextPlays: matchPlays({ ...base, findings: [hiring] }), playFits: fits });
  const d = JSON.parse(/id="atlas-data">([\s\S]*?)<\/script>/.exec(html)![1]!);
  assert.equal(d.fits["Buying signals"], fits["Buying signals"]);
  assert.match(html, /<details class="zdet"><summary>Details<\/summary>/);
});

test("goal icons: one distinct line icon on a soft tile per Atlas goal, same stroke as the menu", async () => {
  const { GOAL_ICONS, goalSvg, goalTile } = await import("../src/city/goalIcons.js");
  const { ATLAS } = await import("../src/plays/index.js");
  assert.equal(Object.keys(GOAL_ICONS).length, 20);
  for (const g of ATLAS.goals) {
    assert.ok(GOAL_ICONS[g], g);
    assert.match(goalSvg(g), /^<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">/);
    assert.match(goalTile(g), /^<span class="zatl-i zgi-(green|blue|violet|amber|rose|teal)"><svg /);
  }
  assert.equal(new Set(Object.values(GOAL_ICONS).map((x) => x.d)).size, 20, "every goal has its own icon");
  assert.ok(!Object.values(GOAL_ICONS).some((x) => /<(script|image|use|text)|href|style=/.test(x.d)), "plain paths only");
});

test("public plays go through the third-party scrubber too", async () => {
  const { nextPlaysOf } = await import("../src/dossier/index.js");
  const results = new Map<string, any>([["signals", { status: "done", summary: "", out: { rows: [{ account: "Northwind Logistics", type: "hiring", title: "Posted 3 AE roles", date: "2026-10-27" }] } }], ["accounts", { status: "done", summary: "", out: { rows: [{ name: "Northwind Logistics", domain: "northwind.example", grade: "A" }] } }]]);
  for (const p of nextPlaysOf({ domain: "yourdomain.com", brand: "YourBrand", results, public: true })) assert.ok(!/Northwind/i.test(p.why + p.prompt));
});

test("atlasUrl: the hosted page fetches the Atlas browse data instead of inlining it; a page from disk keeps it inline", async () => {
  const { renderCity } = await import("../src/city/index.js");
  const base = { domain: "acme.com", brand: "Acme", generatedAt: "", public: true, sections: [] };
  const inline = renderCity(base as never);
  const hosted = renderCity(base as never, { atlasUrl: "/atlas.json" });
  const data = (h: string) => JSON.parse(/id="atlas-data">([\s\S]*?)<\/script>/.exec(h)![1]!);
  assert.ok(Array.isArray(data(inline).plays) && data(inline).plays.length === 1000);
  assert.equal(data(hosted).src, "/atlas.json");
  assert.equal(data(hosted).plays, undefined);
  assert.equal(Object.keys(data(hosted).meta).length, 20);
  assert.ok(inline.length - hosted.length > 200_000, `${inline.length - hosted.length} bytes saved`);
  assert.match(hosted, /fetch\(D\.src,\{credentials:'same-origin'\}\)/);
});

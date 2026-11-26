import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { buildNextSteps, nextStepsFile } from "../src/modules/nextSteps.js";
import { MODULES } from "../src/modules/index.js";
import { buildQuote } from "../src/quote.js";
import { selectModules } from "../src/commands.js";
import { synthesis, type SynthesisOut } from "../src/modules/synthesis.js";

// Hooks from the 2026-11-25 call (looot-zeus#11): suggestions to the user's agent, priced, schedules in the user's own agent, no looot-side memory.
test("next steps: 10 structured suggestions, each with title, why, price, job, prompt; no launch-a-campaign or repo scan", () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.com", "rival-b.com"] });
  const steps = buildNextSteps(cfg, { signals: { accounts: [{ account: "A", intent: "hot", events: [{ type: "hiring" }] }] }, accounts: { rows: [{}, {}, {}] } });
  assert.deepEqual(steps.map((s) => s.id), ["hiring-signals", "lookalikes-50", "competitor-pricing-watch", "trigger-alerts", "monthly-refresh", "send-to-crm", "weekly-prospecting", "weekly-digest", "memory", "next-best-move"]);
  for (const s of steps) {
    assert.ok(s.title && s.why && s.price && s.prompt, s.id);
    assert.ok(Number.isFinite(s.priceUsd) && s.priceUsd >= 0 && s.priceUsd <= 2, `${s.id} ${s.priceUsd}`);
    assert.ok(s.command === null || s.command.startsWith("npx looot-zeus "), s.id);
    assert.ok(!/--yes/.test(s.prompt) && !/--yes/.test(s.command ?? ""), "never pre-approves a paid run");
    if (s.schedule) assert.match(s.prompt, /your own scheduler/);
    if (s.priceUsd > 0 && s.command) assert.match(s.prompt, /without my yes|after my yes/);
  }
  assert.match(steps[0].why, /^1 of your accounts/);
  assert.match(steps.find((s) => s.id === "memory")!.why, /no memory of its own/);
  const text = JSON.stringify(steps).toLowerCase();
  assert.ok(!text.includes("launch a campaign") && !text.includes("repo scan"));
  assert.ok(!text.includes(", and ") && !text.includes("—"));
  assert.deepEqual(JSON.parse(nextStepsFile(steps)).nextSteps.length, 10);
});

test("the demo run writes next-steps.json next to plays.md", async () => {
  const cfg = normalizeConfig({ domain: "acme.example" });
  const r = await synthesis.run({ cfg, mode: "demo", outputs: {}, outDir: "", partial: () => {}, log: () => {}, call: (async () => { throw new Error("no calls"); }) as never });
  const out = r.out as SynthesisOut;
  // The demo has no findings, so no Atlas play: the 9 hooks (next-best-move is "Your next plays" itself).
  assert.equal(out.nextSteps?.length, 9);
  assert.ok(!out.nextSteps!.some((s) => s.id === "next-best-move"));
  const files = synthesis.files!(out);
  assert.ok(files["next-steps.json"] && files["plays.md"]);
});

test("each priced step shows the quote its command prints: watch and monthly are the whole run, signals and competitors include what they need", () => {
  const cfg = normalizeConfig({ domain: "acme.example", competitors: ["rival-a.com", "rival-b.com"] });
  const steps = Object.fromEntries(buildNextSteps(cfg, {}).map((s) => [s.id, s]));
  const book = { source: "dated", live: {} } as const;
  const q = (only?: string) => buildQuote(selectModules(only), cfg, book);
  const near = (a: number, b: number, id: string) => assert.ok(Math.abs(a - b) < 0.0002, `${id}: ${a} vs ${b}`);
  near(steps["hiring-signals"].priceUsd, q("signals").expectedCapped, "signals");
  near(steps["competitor-pricing-watch"].priceUsd, q("competitors").expectedCapped, "competitors");
  near(steps["monthly-refresh"].priceUsd, q().expectedCapped, "monthly");
  near(steps["monthly-refresh"].maxUsd, q().worstCapped, "monthly max");
  near(steps["trigger-alerts"].maxUsd, Math.min(q().worstCapped, 5), "watch max");
  assert.ok(steps["hiring-signals"].jobs.includes(q("signals").rows.flatMap((r) => r.lines)[0].job), "signals quote includes what it needs");
  assert.ok(steps["hiring-signals"].priceUsd > buildQuote(MODULES.filter((m) => m.id === "signals"), cfg, book).expectedCapped - 1e-9);
  for (const s of Object.values(steps)) assert.ok(s.maxUsd >= s.priceUsd, s.id);
});

test("next-steps.json offers what the city page shows: the top Atlas plays first, then the hooks no top play covers", async () => {
  const { agentSteps } = await import("../src/modules/nextSteps.js");
  const { matchPlays } = await import("../src/plays/index.js");
  const { keptHooks } = await import("../src/plays/hooks.js");
  const cfg = normalizeConfig({ domain: "acme.example" });
  const hiring = { topic: "hiring" as const, text: "Northwind posts 3 open roles", safe: "1 account posts open roles" };
  const rivals = { topic: "rivals" as const, text: "3 rivals", safe: "3 rivals" };
  const plays = matchPlays({ company: "Acme", domain: "acme.example", findings: [hiring, rivals] });
  assert.ok(plays.length > 0);
  const steps = agentSteps(buildNextSteps(cfg, {}), plays);
  assert.deepEqual(steps.slice(0, plays.length).map((s) => s.id), plays.map((p) => `play-${p.id}`));
  assert.ok(steps.slice(0, plays.length).every((s) => s.kind === "play" && s.prompt && s.price));
  const hooks = steps.slice(plays.length);
  assert.deepEqual(hooks.map((s) => s.id), keptHooks(plays.map((p) => p.goal)));
  assert.ok(hooks.every((s) => s.kind === "hook"));
  if (plays.some((p) => p.goal === "Buying signals")) assert.ok(!hooks.some((s) => s.id === "hiring-signals"), "a top Buying signals play covers the hiring hook");
  if (plays.some((p) => p.goal === "Competitor displacement")) assert.ok(!hooks.some((s) => s.id === "competitor-pricing-watch"));
  assert.ok(!hooks.some((s) => s.id === "next-best-move"));
});

test("the summary table holds only hooks: a play's unmasked reason never reaches a public dossier", async () => {
  const { agentSteps } = await import("../src/modules/nextSteps.js");
  const { matchPlays } = await import("../src/plays/index.js");
  const cfg = normalizeConfig({ domain: "acme.example" });
  const hiring = { topic: "hiring" as const, text: "Northwind Traders: hiring a Head of RevOps on 20 Nov", safe: "1 account posts open roles" };
  const plays = matchPlays({ company: "Acme", domain: "acme.example", findings: [hiring] });
  assert.ok(plays.length > 0);
  const out: SynthesisOut = { lines: [], plays: [], brief: { offer: "", icp: "", competitors: "" }, nextSteps: agentSteps(buildNextSteps(cfg, {}), plays) };
  const sec = JSON.stringify(synthesis.render(out, "done", { public: true }));
  assert.ok(!sec.includes("Head of RevOps") && !sec.includes("Northwind"));
});

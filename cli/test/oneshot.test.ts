// The one command: looot-zeus run <domain>. Free site read, the quote, a yes, then the run.
// Everything here is offline. The page read uses a fake fetch and the paid runner is a mock that
// records every call, so the tests can prove nothing paid happens before a yes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, cmdRunDomain, NEEDS_YES, type Args, type OneShotDeps } from "../src/commands.js";
import type { CallResult, JobRunner } from "../src/client.js";
import { validateReceipt, type Receipt } from "../src/receipt.js";
import { PKG_ROOT } from "../src/util.js";

const cli = join(PKG_ROOT, "dist", "src", "cli.js");
const EXAMPLE = join(PKG_ROOT, "examples", "yourdomain.yaml");

const HOME = `<html><head><title>Acme CRM | Sales pipeline software</title></head><body>
<h1>The sales CRM for small teams</h1>
<p>Acme CRM helps small sales teams track every deal and close more of them each month. Built for agencies and software teams.</p>
<a href="/pricing">Pricing</a> <a href="/customers">Customers</a> <a href="/vs/bigco">Acme vs Bigco</a>
<p>sales pipeline tool, deal tracking, deal tracking for agencies and software teams, forecasting for sales managers.</p>
</body></html>`;
const PAGE = `<html><head><title>Acme</title></head><body><h1>Acme</h1>
<p>Trusted by <a href="https://northwind.example">Northwind</a> and <a href="https://contoso.example/story">Contoso</a>. Compare Acme with Bigco and Megacrm. Plans start at 29 USD per seat per month with a free trial for every team.</p>
</body></html>`;

/** Fake fetch for the free page read. Counts requests and never touches the network. */
function fakeFetch() {
  const urls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return new Response(/\/(pricing|customers|vs\/bigco)/.test(url) ? PAGE : HOME, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  return { f, urls };
}

/** Mock paid runner. Each call is logged into the shared event list, so order can be checked. */
function mockClient(events: string[], charge: (maxCostUsd: number) => number = () => 0.001) {
  const calls: string[] = [];
  const runner: JobRunner = {
    async call(job, _input, opts): Promise<CallResult> {
      calls.push(job);
      events.push(`PAID ${job}`);
      return {
        record: { module: opts.module, job, provider: "mock", outcome: "miss", quoted: opts.quotedUsd, charged: charge(opts.maxCostUsd), ms: 1, ts: new Date().toISOString() },
        run: { runId: `r${calls.length}`, status: "completed", outcome: "miss" },
        data: {},
      };
    },
  };
  return { runner, calls };
}

function setup(extra: Partial<OneShotDeps> = {}, charge?: (maxCostUsd: number) => number) {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-oneshot-"));
  const outDir = join(dir, "gtm");
  const events: string[] = [];
  const page = fakeFetch();
  const paid = mockClient(events, charge);
  const deps: OneShotDeps = {
    fetch: page.f,
    client: () => paid.runner,
    isTTY: false,
    log: (l) => events.push(l),
    ...extra,
  };
  const go = (a: Args) => cmdRunDomain("acme.example", { offline: true, ...a }, join(outDir, "config.yaml"), outDir, deps);
  return { dir, outDir, events, page, paid, deps, go };
}

const firstIndex = (events: string[], re: RegExp) => events.findIndex((e) => re.test(e));

test("one command with --yes: free read, quote, run, dossier and receipt", async () => {
  const s = setup();
  const receipt = (await s.go({ yes: true })) as Receipt;
  // 1. the free bootstrap read the site with plain fetch and wrote the brief
  assert.ok(s.page.urls.length >= 1);
  assert.ok(s.page.urls.every((u) => u.includes("acme.example")));
  assert.ok(existsSync(join(s.outDir, "config.yaml")));
  assert.match(readFileSync(join(s.outDir, "config.yaml"), "utf8"), /domain: acme\.example/);
  // 2. the quote was printed with calls, expected, worst case and the suggested cap
  const text = s.events.join("\n");
  assert.match(text, /^total\s+\d+\s+\$\d/m);
  assert.match(text, /Suggested cap \d+ USD\./);
  assert.match(text, /No paid call was made/);
  // 4. the run wrote the dossier and the receipt
  for (const f of ["dossier.html", "dossier.md", "receipt.json", "receipt.md"]) assert.ok(existsSync(join(s.outDir, f)), f);
  assert.deepEqual(validateReceipt(receipt), []);
  assert.ok(s.paid.calls.length > 0);
  // the cap defaults to the suggested cap and the receipt keeps the free intake rows
  const suggested = Number(text.match(/Suggested cap (\d+) USD/)![1]);
  assert.equal(receipt.run.cap, suggested);
  assert.ok(receipt.calls.some((c) => c.module === "intake" && c.provider === "direct fetch" && c.charged === 0));
  assert.ok(receipt.run.charged <= receipt.run.cap);
});

test("nothing paid happens before the price is shown and the yes is given", async () => {
  let callsWhenAsked = -1;
  let question = "";
  const s = setup({
    isTTY: true,
    ask: async (q) => {
      question = q;
      callsWhenAsked = s.paid.calls.length;
      s.events.push("ASKED");
      return "y";
    },
  });
  await s.go({});
  assert.equal(callsWhenAsked, 0, "a paid call ran before the yes");
  assert.match(question, /^Run it with a cap of \$\d+(\.\d\d)?\? \[y\/N\] $/);
  const quoteAt = firstIndex(s.events, /^total\s+\d+/m);
  const askedAt = s.events.indexOf("ASKED");
  const firstPaid = firstIndex(s.events, /^PAID /);
  assert.ok(quoteAt >= 0 && askedAt > quoteAt, "the quote comes before the question");
  assert.ok(firstPaid > askedAt, "the first paid call comes after the yes");
});

test("a no, or just Enter, runs nothing and spends nothing", async () => {
  for (const answer of ["", "n", "no", "maybe"]) {
    const s = setup({ isTTY: true, ask: async () => answer });
    const r = await s.go({});
    assert.equal(r, null);
    assert.equal(s.paid.calls.length, 0, `paid call after answer "${answer}"`);
    assert.ok(!existsSync(join(s.outDir, "receipt.json")));
    assert.ok(!existsSync(join(s.outDir, "dossier.html")));
    assert.match(s.events.join("\n"), /Nothing ran and nothing was spent[\s\S]*looot-zeus run acme\.example --cap \d+ --yes/);
  }
});

test("without a terminal and without --yes it refuses, spends nothing and prints the next command", async () => {
  const s = setup({ isTTY: false, ask: async () => assert.fail("must not ask without a terminal") });
  await assert.rejects(s.go({}), (e: unknown) => {
    assert.ok(e instanceof CliExit);
    assert.equal(e.code, NEEDS_YES);
    assert.match(e.message, /nothing ran and nothing was spent/);
    assert.match(e.message, /looot-zeus run acme\.example --cap \d+ --yes/);
    return true;
  });
  assert.equal(s.paid.calls.length, 0);
  assert.ok(existsSync(join(s.outDir, "config.yaml")), "the free brief is kept");
  assert.ok(!existsSync(join(s.outDir, "receipt.json")));
  assert.match(s.events.join("\n"), /^total\s+\d+\s+\$\d/m, "the price was still shown");
});

test("--yes with --cap runs under that cap and never past it", async () => {
  // Every call charges its full ceiling, the worst case, so the cap is what stops the run.
  const s = setup({}, (max) => max);
  const receipt = (await s.go({ yes: true, cap: "2.5" })) as Receipt;
  assert.equal(receipt.run.cap, 2.5);
  assert.ok(receipt.run.charged <= 2.5 + 1e-9, `charged ${receipt.run.charged} past the cap`);
  assert.ok(receipt.run.worst > 2.5, "the worst case is above the cap, so the cap has to bind");
  assert.ok(s.paid.calls.length > 0);
  assert.match(s.events.join("\n"), /Running inside a \$2.50 cap/);
  assert.match(s.events.join("\n"), /stopped at the cap|used up (its|their) share of the cap|^done/m);
  // the next command keeps the user's cap
  const t = setup({ isTTY: false });
  await assert.rejects(t.go({ cap: "2.5", depth: "sample" }), (e: unknown) => e instanceof CliExit && /--cap 2\.5 --yes --out \S+ --depth sample --offline$/.test(e.message));
});

test("a cap below the expected cost is refused before anything paid", async () => {
  const s = setup();
  await assert.rejects(s.go({ yes: true, cap: "0.01" }), (e: unknown) => e instanceof CliExit && e.code === 3);
  assert.equal(s.paid.calls.length, 0);
  assert.match(s.events.join("\n"), /Refused\. The expected cost/);
});

test("no LOOOT_TOKEN stops after the free read and the quote, nothing spent", async () => {
  const s = setup({ client: () => null });
  await assert.rejects(s.go({ yes: true }), (e: unknown) => e instanceof CliExit && e.code === 2 && /LOOOT_TOKEN is not set[\s\S]*Nothing was spent[\s\S]*looot-zeus run acme\.example --cap \d+ --yes/.test(e.message));
  assert.match(s.events.join("\n"), /^total\s+\d+/m);
});

test("an existing brief for the same domain is reused, one for another domain is refused", async () => {
  const s = setup();
  await s.go({ yes: true });
  const reads = s.page.urls.length;
  await s.go({ yes: true });
  assert.equal(s.page.urls.length, reads, "the second run did not read the site again");
  assert.match(s.events.join("\n"), /Using your brief in/);
  await assert.rejects(cmdRunDomain("other.example", { offline: true, yes: true }, join(s.outDir, "config.yaml"), s.outDir, s.deps), (e: unknown) => e instanceof CliExit && e.code === 2 && /brief for acme\.example/.test(e.message));
});

test("the CLI: run <domain> without a terminal exits 4 and makes no call", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-oneshot-cli-"));
  mkdirSync(join(dir, "gtm"));
  copyFileSync(EXAMPLE, join(dir, "gtm", "config.yaml"));
  // A fake token and an unreachable API. Any paid call would fail loudly instead of exiting 4.
  const env = { ...process.env, LOOOT_TOKEN: "fake-token-for-test", LOOOT_API_URL: "http://127.0.0.1:9" };
  const r = spawnSync(process.execPath, [cli, "run", "yourdomain.com", "--offline"], { cwd: dir, env, input: "" });
  assert.equal(r.status, NEEDS_YES, r.stderr.toString());
  assert.match(r.stdout.toString(), /^total\s+\d+\s+\$\d/m);
  // Section caps are on by default (PR B): the suggested cap is the worst case under the caps, 2 USD.
  assert.match(r.stdout.toString(), /Suggested cap 2 USD\./);
  assert.match(r.stderr.toString(), /looot-zeus run yourdomain\.com --cap 2 --yes --offline/);
  // --no-phones drops every phone line from the quote and keeps the flag in the next command.
  const np = spawnSync(process.execPath, [cli, "run", "yourdomain.com", "--offline", "--no-phones"], { cwd: dir, env, input: "" });
  assert.equal(np.status, NEEDS_YES, np.stderr.toString());
  assert.ok(!/people\.phone\.find/.test(np.stdout.toString()));
  assert.match(np.stdout.toString(), /Suggested cap 2 USD\./);
  assert.match(np.stderr.toString(), /--no-phones/);
  assert.ok(!existsSync(join(dir, "gtm", "receipt.json")));
  // run without a domain still works as before: the quote, then the cap check
  const old = spawnSync(process.execPath, [cli, "run", "--config", EXAMPLE, "--offline", "--cap", "0.5"], { cwd: dir, env: { ...process.env, LOOOT_TOKEN: "" } });
  assert.equal(old.status, 3);
});

// ---- the same gate on every other paid path: init without --direct, run without a domain ----------

import { cmdInit, cmdRun } from "../src/commands.js";

function gateSetup(extra: Partial<OneShotDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-gate-"));
  const outDir = join(dir, "gtm");
  const events: string[] = [];
  const paid = mockClient(events);
  const deps: OneShotDeps = { client: () => paid.runner, isTTY: false, log: (l) => events.push(l), ...extra };
  return { dir, outDir, events, paid, deps };
}

test("init without --direct shows the price and asks before the paid page reads", async () => {
  let callsWhenAsked = -1;
  let question = "";
  const s = gateSetup({ isTTY: true, ask: async (q) => { question = q; callsWhenAsked = s.paid.calls.length; s.events.push("ASKED"); return "y"; } });
  await cmdInit("acme.example", {}, s.outDir, s.deps);
  assert.equal(callsWhenAsked, 0, "a page read was paid before the yes");
  assert.match(question, /^Read them for at most \$[\d.]+\? \[y\/N\] $/);
  const priceAt = firstIndex(s.events, /costs about \$[\d.]+, at most \$[\d.]+\. No paid call was made\./);
  assert.ok(priceAt >= 0 && priceAt < s.events.indexOf("ASKED"));
  assert.ok(firstIndex(s.events, /^PAID web\.scrape\.markdown/) > s.events.indexOf("ASKED"));
  assert.ok(existsSync(join(s.outDir, "config.yaml")));
});

test("init without --direct: a no, no terminal or no token spends nothing; --yes reads", async () => {
  const no = gateSetup({ isTTY: true, ask: async () => "n" });
  assert.equal(await cmdInit("acme.example", {}, no.outDir, no.deps), null);
  assert.equal(no.paid.calls.length, 0);
  assert.ok(!existsSync(join(no.outDir, "config.yaml")));

  const pipe = gateSetup({ ask: async () => assert.fail("must not ask without a terminal") });
  await assert.rejects(cmdInit("acme.example", {}, pipe.outDir, pipe.deps), (e: unknown) => e instanceof CliExit && e.code === NEEDS_YES && /looot-zeus init acme\.example --cap 0\.25 --yes/.test(e.message));
  assert.equal(pipe.paid.calls.length, 0);

  const noKey = gateSetup({ client: () => null });
  await assert.rejects(cmdInit("acme.example", { yes: true }, noKey.outDir, noKey.deps), (e: unknown) => e instanceof CliExit && e.code === 2 && /--direct/.test(e.message));

  const yes = gateSetup();
  await cmdInit("acme.example", { yes: true }, yes.outDir, yes.deps);
  assert.ok(yes.paid.calls.length > 0 && yes.paid.calls.every((j) => j === "web.scrape.markdown"));
});

test("init --direct stays free and never asks", async () => {
  const page = fakeFetch();
  const s = gateSetup({ fetch: page.f, ask: async () => assert.fail("--direct must not ask") });
  await cmdInit("acme.example", { direct: true }, s.outDir, s.deps);
  assert.equal(s.paid.calls.length, 0);
  assert.ok(page.urls.length >= 1);
  assert.ok(existsSync(join(s.outDir, "config.yaml")));
});

test("run without a domain shows the quote and asks before any paid call", async () => {
  const mk = () => {
    const s = gateSetup();
    mkdirSync(s.outDir);
    copyFileSync(EXAMPLE, join(s.outDir, "config.yaml"));
    return s;
  };
  const cfgOf = (s: { outDir: string }) => join(s.outDir, "config.yaml");

  const pipe = mk();
  await assert.rejects(cmdRun({ offline: true }, cfgOf(pipe), pipe.outDir, pipe.deps), (e: unknown) => e instanceof CliExit && e.code === NEEDS_YES && /looot-zeus run --cap 10 --yes --out \S+ --offline$/.test(e.message));
  assert.equal(pipe.paid.calls.length, 0);
  assert.match(pipe.events.join("\n"), /^total\s+\d+\s+\$\d/m);
  assert.ok(!existsSync(join(pipe.outDir, "receipt.json")));

  const no = mk();
  no.deps.isTTY = true;
  no.deps.ask = async () => "";
  assert.equal(await cmdRun({ offline: true }, cfgOf(no), no.outDir, no.deps), null);
  assert.equal(no.paid.calls.length, 0);

  let callsWhenAsked = -1;
  const y = mk();
  y.deps.isTTY = true;
  y.deps.ask = async (q) => { assert.match(q, /^Run it with a cap of \$7\? \[y\/N\] $/); callsWhenAsked = y.paid.calls.length; return "yes"; };
  const r = (await cmdRun({ offline: true, cap: "7" }, cfgOf(y), y.outDir, y.deps)) as Receipt;
  assert.equal(callsWhenAsked, 0);
  assert.ok(y.paid.calls.length > 0);
  assert.equal(r.run.cap, 7);

  const auto = mk();
  const r2 = (await cmdRun({ offline: true, yes: true }, cfgOf(auto), auto.outDir, auto.deps)) as Receipt;
  assert.ok(auto.paid.calls.length > 0 && r2.run.charged <= r2.run.cap);
});

test("watch is the same capped run: quote first, then the question, default cap 5", () => {
  const dir = mkdtempSync(join(tmpdir(), "looot-zeus-watch-"));
  mkdirSync(join(dir, "gtm"));
  copyFileSync(EXAMPLE, join(dir, "gtm", "config.yaml"));
  const env = { ...process.env, LOOOT_TOKEN: "fake-token-for-test", LOOOT_API_URL: "http://127.0.0.1:9" };
  const r = spawnSync(process.execPath, [cli, "watch", "--offline"], { cwd: dir, env, input: "" });
  assert.equal(r.status, NEEDS_YES, r.stderr.toString());
  assert.match(r.stdout.toString(), /No earlier run/);
  assert.match(r.stdout.toString(), /^total\s+\d+\s+\$\d/m);
  assert.match(r.stderr.toString(), /looot-zeus run --cap 5 --yes/);
  assert.ok(!existsSync(join(dir, "gtm", "receipt.json")));
});

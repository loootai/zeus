// The commands behind the CLI. cli.ts parses the arguments and calls these. They throw CliExit
// instead of calling process.exit, so tests can run them in-process with mocks.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveCaps, unknownCapSections } from "./capDefaults.js";
import { CapLedger, CapReached, checkQuoteAgainstCap, suggestCap } from "./cap.js";
import { clientFromEnv, readWorkspaceRule, LoootError, SPEND_LIMIT_URL, limitName, type CallRecord, type JobRunner, type SpendLimitRead } from "./client.js";
import { configToYaml, loadConfig, normalizeConfig, type Depth, type GtmConfig } from "./config.js";
import { placeholderReceipt } from "./demo.js";
import { DirectRunner } from "./direct.js";
import { assemble } from "./dossier/index.js";
import { renderHtml } from "./dossier/html.js";
import { renderCity } from "./city/index.js";
import { renderMarkdown } from "./dossier/md.js";
import { withCommitteePhones, writeArtifacts } from "./exports.js";
import { CRM_FORMATS, IMPORT_HOW, writeCrm, type CrmFormat } from "./crm.js";
import { MODULES, runPipeline, stopLine, type GtmModule, type ModuleResult } from "./modules/index.js";
import { PAGE_KINDS, type IntakeOut } from "./modules/intake.js";
import { collectAssets, loadLogos } from "./assets.js";
import { loadFixture } from "./modules/fixture.js";
import type { WorkspaceRule } from "./guardrails.js";
import { buildQuote, formatQuote, loadPriceBook, type Quote } from "./quote.js";
import { buildReceipt, receiptMarkdown, validateReceipt, type Receipt } from "./receipt.js";
import { PKG_ROOT, usd, writeFile } from "./util.js";
import { archivePrevious, buildSnapshot, readSnapshot, recordRun } from "./history.js";
import { exportPublic } from "./public.js";
import { scrubThirdParties, thirdPartySwaps } from "./thirdParties.js";
import { safeDossier } from "./dossier/safe.js";
import { renderSafePages, writeSafeView } from "./safeView.js";
import { watchDemo } from "./watch.js";
import { emptyLearnings, keyOf, normalizeLearnings, readLearnings, weightCount, writeLearnings, type Learnings } from "./learn/schema.js";
import { leadFrom, leadIndex, readOutreach, readResults, ResultsError, slug, type Outcome, type OutreachLog } from "./learn/results.js";
import { pullInstantly } from "./learn/instantly.js";
import { learnFrom, runEntry, type Send } from "./learn/update.js";
import { writeProposal } from "./learn/propose.js";
import type { WithLearnings } from "./modules/accounts.js";
import { addedLine, MORE_WHAT, mergeOut, mergeReceipt, moreQuote, readState, SPECS, STATE_FILE, writeState, type MoreWhat, type RunState } from "./more.js";
import { rulePlays } from "./modules/synthesis.js";
import { privatePaths, removePaths, UnsafeDeleteError } from "./deleteLocal.js";
import { commandFor, costText, DEFAULT_PORT, pendingRequests, readRequests, REQUESTS_FILE, setStatus, startServer, writeAgentHints } from "./requests.js";
import { importToSupabase, redact, supabaseFromEnv, supabaseRowsOf } from "./supabase.js";
import { applyRivals, assumeRivals, needsAny, rivalsModule, rivalsNeeded, type RivalsOut } from "./modules/rivals.js";

/** Thrown instead of process.exit. cli.ts prints the message and exits with the code. */
export class CliExit extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "CliExit";
  }
}

export function fail(msg: string, code = 1): never {
  throw new CliExit(msg, code);
}

export type Args = Record<string, string | boolean | undefined>;
export type Log = (line: string) => void;

export function depthOf(a: Args): Depth | undefined {
  if (a.depth === undefined) return undefined;
  if (a.depth !== "sample" && a.depth !== "full") fail("--depth is sample or full", 2);
  return a.depth;
}

export function capOf(a: Args, dflt: number): number {
  const c = a.cap === undefined ? dflt : Number(a.cap);
  if (!(c > 0)) fail("--cap must be a positive dollar amount", 2);
  return c;
}

/** --max-runs N: the most paid calls the whole run may make. */
export function maxRunsOf(a: Args): number | undefined {
  if (a["max-runs"] === undefined) return undefined;
  const n = Number(a["max-runs"]);
  if (!Number.isInteger(n) || n <= 0) fail("--max-runs must be a whole number above 0", 2);
  return n;
}

/** Modules in the run. --only keeps the named ones and everything they need. */
export function selectModules(only: string | undefined): GtmModule[] {
  if (!only) return MODULES;
  const want = new Set<string>(["synthesis"]);
  const add = (id: string) => {
    if (want.has(id) && id !== "synthesis") return;
    const m = MODULES.find((x) => x.id === id);
    if (!m) fail(`unknown module ${id}. Modules: ${MODULES.map((x) => x.id).join(", ")}`, 2);
    want.add(id);
    m.needs.forEach(add);
  };
  only.split(",").map((s) => s.trim()).filter(Boolean).forEach(add);
  return MODULES.filter((m) => want.has(m.id)).map((m) => ({ ...m, needs: m.needs.filter((n) => want.has(n)) }));
}

function ms(d: number): string {
  return `${Math.floor(d / 60000)}m${String(Math.round((d % 60000) / 1000)).padStart(2, "0")}s`;
}

function moduleLine(id: string, r: ModuleResult, calls: CallRecord[]): string {
  const mine = calls.filter((c) => c.module === id);
  const spent = mine.reduce((n, c) => n + c.charged, 0);
  const mark = r.status === "done" ? "✔" : r.status === "capped" ? "■" : "–";
  const fb = mine.filter((c) => c.outcome === "fallback").map((c) => `${c.fallbackFrom} miss, ${c.provider} hit`);
  const trail = fb.length > 0 ? ` · ${fb[0]}${fb.length > 1 ? ` (+${fb.length - 1})` : ""}` : "";
  return `${mark} ${id.padEnd(12)} ${r.status === "done" ? `${mine.length} calls ${usd(spent)}` : `${r.status} ${usd(spent)}`}  ${r.summary}${trail}`;
}

export function writeAll(outDir: string, o: { cfg: GtmConfig; mods: GtmModule[]; results: Map<string, ModuleResult>; receipt: Receipt; public: boolean; /** --safe-demo: the same safe output as --public, without the public export. */ safe?: boolean; placeholder?: string; writeConfig: boolean; pages?: Record<string, number>; pulls?: RunState["pulls"] }): string[] {
  const errs = validateReceipt(o.receipt);
  if (errs.length > 0) fail(`receipt does not match schema/receipt.schema.json:\n  ${errs.slice(0, 10).join("\n  ")}`);
  loadLogos(outDir);
  // Anything shared (--public) or forced (--safe-demo) is company-level only: people are a role and an invented name.
  const safe = o.public || o.safe === true;
  const built = assemble({ domain: o.cfg.domain, brand: o.cfg.brand, mods: o.mods, results: o.results, receipt: o.receipt, public: safe, placeholder: o.placeholder, cfg: o.cfg, pages: o.pages, pulls: o.pulls });
  const d = safe ? safeDossier(built) : built;
  // What `looot-zeus more` reads to fetch more into this folder.
  const { more: _hints, ...cleanCfg } = o.cfg as GtmConfig & { more?: unknown };
  writeState(outDir, { schemaVersion: "1", mode: o.receipt.run.mode, ...(o.placeholder ? { placeholder: o.placeholder } : {}), ...(safe ? { safe: true } : {}), cfg: cleanCfg as GtmConfig, modules: o.mods.map((m) => m.id), results: Object.fromEntries([...o.results].map(([id, r]) => [id, { status: r.status, summary: r.summary, out: r.out }])), ...(o.pages ? { pages: o.pages } : {}), ...(o.pulls ? { pulls: o.pulls } : {}) });
  // A safe page names no target account or rival: Account A, B, C and Rival 1, 2, 3, checked before writing.
  const tp = safe ? thirdPartySwaps(buildSnapshot(o.cfg, outputsOf(o.results), o.receipt)) : [];
  const page = (f: string, t: string) => (safe ? scrubThirdParties(f, t, tp) : t);
  writeFile(join(outDir, "dossier.html"), page("dossier.html", renderHtml(d)));
  writeFile(join(outDir, "dossier.md"), page("dossier.md", renderMarkdown(d)));
  writeFile(join(outDir, "city", "index.html"), page("city/index.html", renderCity(d)));
  writeFile(join(outDir, "receipt.json"), JSON.stringify(o.receipt, null, 2) + "\n");
  writeFile(join(outDir, "receipt.md"), receiptMarkdown(o.receipt));
  if (o.writeConfig) writeFile(join(outDir, "config.yaml"), configToYaml(o.cfg, [o.placeholder ? "PLACEHOLDER config used by looot-zeus demo." : "looot-zeus config"]));
  const written = ["dossier.html", "dossier.md", "city/index.html", "receipt.json", "receipt.md", STATE_FILE];
  const outputs: Record<string, unknown> = {};
  for (const [id, r] of o.results) outputs[id] = r.out;
  for (const m of o.mods) {
    const r = o.results.get(m.id);
    if (!m.files || !r?.out || r.status !== "done") continue;
    for (const [rel, text] of Object.entries(m.files(r.out))) {
      writeFile(join(outDir, rel), text);
      written.push(rel);
    }
  }
  written.push(...writeArtifacts(outDir, outputs as Record<string, any>, { public: safe, suppress: o.placeholder ? [] : readLearnings(outDir)?.suppress ?? [] }));
  return written;
}

export function outputsOf(results: Map<string, ModuleResult>): Record<string, any> {
  return Object.fromEntries([...results.entries()].map(([id, r]) => [id, r.out]));
}

/** Writes the public export and says where. A leak stops the command. */
function publicLine(outDir: string, log: Log, maskAccounts = false): void {
  try {
    // The public copy is rebuilt from the saved run, so the private pages never feed it.
    const e = exportPublic(outDir, undefined, { maskAccounts, rendered: renderSafePages(outDir) ?? undefined });
    log(`Public copy in ${e.dir}/ (receipt.json, dossier.html, dossier.md, city/index.html). People are a role and an invented name, no email, phone or profile link. Your domain, brand, rivals${maskAccounts ? ", target accounts" : ""} and people are swapped out, checked against ${e.checked} original strings, 0 left.`);
  } catch (err) {
    fail((err as Error).message, 5);
  }
}

function printSummary(results: Map<string, ModuleResult>, log: Log): void {
  const s = results.get("synthesis")?.out as { lines?: string[]; plays?: { title: string; cost: string }[] } | undefined;
  if (!s) return;
  log("");
  for (const l of (s.lines ?? []).slice(0, 10)) log(`  ${l}`);
  if (s.plays && s.plays.length > 0) {
    log("\n  Plays");
    s.plays.slice(0, 10).forEach((p, i) => log(`  ${String(i + 1).padStart(2)}. ${p.title}, ${p.cost}`));
  }
}

/**
 * Reads 4 pages of the site and writes the config draft. With a DirectRunner the pages are read
 * with a plain web request, no looot call and no charge.
 */
export async function initDomain(domainArg: string, o: { runner: JobRunner; direct: boolean; cap: number; outDir: string; configPath: string; log?: Log; next?: string }): Promise<GtmConfig> {
  const log = o.log ?? console.log;
  const outDir = o.outDir;
  let cfg: GtmConfig;
  try {
    cfg = normalizeConfig({ domain: domainArg });
  } catch (e) {
    fail((e as Error).message, 2);
  }
  const mods = MODULES.filter((m) => m.id === "intake");
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: true });
  const quote = buildQuote(mods, cfg, book);
  log(`Reading ${PAGE_KINDS.length} pages of ${cfg.domain}${o.direct ? " directly, no looot call" : `, quoted ${usd(quote.expected)}, at most ${usd(quote.worst)}`}.`);
  let res;
  try {
    res = await runPipeline({ mods, cfg, quote, runner: o.runner, ledger: new CapLedger(o.cap, [{ id: "intake", worst: quote.worst }], resolveCaps(cfg)), mode: "live", outDir });
  } catch (e) {
    if (e instanceof LoootError) fail(`looot refused the call, ${e.code ?? e.status}. ${e.message}`);
    throw e;
  }
  const r = res.results.get("intake")!;
  if (r.status !== "done" || !r.out) fail(`intake ${r.status}, ${r.summary}`);
  const out = r.out as IntakeOut;
  for (const p of out.pages) writeFile(join(outDir, "intake", `${p.kind}.md`), `<!-- ${p.url} -->\n${p.markdown}`);
  writeFile(join(outDir, "intake", "calls.json"), JSON.stringify(res.calls, null, 2) + "\n");
  const header = [
    `Draft built from ${out.pages.filter((p) => p.ok).length} pages of ${cfg.domain} on ${new Date().toISOString().slice(0, 10)}.`,
    "Edit anything, then run looot-zeus quote.",
    out.guessed.length > 0 ? `Guessed because the pages did not say: ${out.guessed.join(", ")}.` : "",
  ].filter(Boolean);
  writeFile(o.configPath, configToYaml(out.config, header));
  const spent = res.calls.reduce((n, c) => n + c.charged, 0);
  for (const p of out.pages) log(`  ${p.ok ? "✔" : "–"} ${p.kind.padEnd(13)} ${p.ok ? `${p.chars} chars` : "nothing usable"}  ${p.url}`);
  const c = out.config;
  log(`
${c.brand}. ${c.offer}
  ICP          ${c.icp.industries.join(", ") || "(fill in)"}, ${c.icp.sizeBand}, ${c.icp.geos.join(", ")}
  Titles       ${c.icp.titles.join(", ")}
  Seeds        ${c.seeds.join(", ") || "(add 5 of your best customers)"}
  Competitors  ${c.competitors.join(", ") || "(add 3)"}
  Keywords     ${c.keywords.length}, buyer questions ${c.questions.length}
  Reviews      ${c.reviews.appStoreIds.length > 0 ? `App Store ids ${c.reviews.appStoreIds.join(", ")}` : "no app found on the site, add ids under reviews to run it"}
  Local        ${c.local.mode === "on" ? `on, searches ${c.local.queries.join(", ")}` : "not run, the site does not look like a local business"}
  Commerce     ${c.commerce.mode === "on" ? `on, ${c.commerce.asins.length} Amazon ASINs found` : "not run, the site does not look like a store"}
  Competitor ids for reviews and commerce go under reviews.competitors and commerce.competitors.

Wrote ${o.configPath}. Spent ${usd(spent)}.
${o.next ?? "Edit anything or say go. Next, looot-zeus quote"}`);
  return out.config;
}

/** Exit code when a paid run needs a yes and there is no terminal to ask in. Nothing was spent. */
export const NEEDS_YES = 4;

export interface PaidDeps {
  /** fetch for the free page read. Default the global fetch. */
  fetch?: typeof fetch;
  /** The paid runner. Default the looot client from LOOOT_TOKEN. Only used after a yes. */
  client?: () => JobRunner | null;
  /** Asks the question and returns the answer. Default reads one line from the terminal. */
  ask?: (question: string) => Promise<string>;
  /** Whether a person can answer. Default stdin and stdout are a terminal. */
  isTTY?: boolean;
  /** Opens the finished dossier. Default the system opener, used only when isTTY is not injected. */
  open?: (file: string) => void;
  log?: Log;
  /** fetch for logos and ad creatives after the run. Default the global fetch, off when a test injects a client. */
  assetsFetch?: typeof fetch;
  /** The clock, for the watch day in the repeat-protection key. Default now. */
  now?: () => Date;
}

async function askLine(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function capText(cap: number): string {
  return Number.isInteger(cap) ? `$${cap}` : `$${cap.toFixed(2)}`;
}

/** The same deps under the name the one-command tests use. */
export type OneShotDeps = PaidDeps;

/** The command that runs the same thing again with a yes, keeping the user's flags. */
function nextCommand(cmd: "run" | "init" | "prepare", domain: string | undefined, cap: number, a: Args, outDir: string): string {
  const parts = ["looot-zeus", cmd, ...(domain ? [domain] : []), "--cap", String(cap), "--yes"];
  if (outDir !== "gtm") parts.push("--out", outDir);
  if (typeof a.config === "string") parts.push("--config", a.config);
  if (typeof a.depth === "string") parts.push("--depth", a.depth);
  if (a.phones === true) parts.push("--phones");
  if (a["no-phones"] === true) parts.push("--no-phones");
  if (a.people === true) parts.push("--people");
  if (a.public === true) parts.push("--public");
  if (typeof a.only === "string") parts.push("--only", a.only);
  if (a.offline === true) parts.push("--offline");
  if (a["mask-accounts"] === true) parts.push("--mask-accounts");
  if (a["apply-learnings"] === true) parts.push("--apply-learnings");
  if (a["no-open"] === true) parts.push("--no-open");
  return parts.join(" ");
}

/**
 * The gate in front of every paid call. The price is already printed when this runs.
 * --yes passes. Without a terminal it stops with NEEDS_YES and prints the next command.
 * In a terminal it asks the [y/N] question. Only y or yes passes. Anything else spends nothing.
 */
async function confirmPaid(question: string, next: string, a: Args, deps: PaidDeps): Promise<boolean> {
  if (a.yes === true) return true;
  const log = deps.log ?? console.log;
  const tty = deps.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!tty) fail(`No terminal to ask in, so nothing ran and nothing was spent. To run it, type this.\n  ${next}`, NEEDS_YES);
  const answer = (await (deps.ask ?? askLine)(`${question} [y/N] `)).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  log(`Nothing ran and nothing was spent. To run it later, type this.\n  ${next}`);
  return false;
}

export async function cmdInit(domainArg: string | undefined, a: Args, outDir: string, deps: PaidDeps = {}): Promise<GtmConfig | null> {
  if (!domainArg) fail("Usage: looot-zeus init <domain>", 2);
  const log = deps.log ?? console.log;
  const cap = capOf(a, 0.25);
  const configPath = join(outDir, "config.yaml");
  if (a.direct) return initDomain(domainArg, { runner: new DirectRunner(deps.fetch ?? fetch), direct: true, cap, outDir, configPath, log });
  let domain: string;
  try {
    domain = normalizeConfig({ domain: domainArg }).domain;
  } catch (e) {
    fail((e as Error).message, 2);
  }
  // The price of the 4 page reads, printed before the client exists and before any paid call.
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: true });
  const q = buildQuote(MODULES.filter((m) => m.id === "intake"), normalizeConfig({ domain }), book);
  const most = Math.min(q.worst, cap);
  log(`Reading ${PAGE_KINDS.length} pages of ${domain} on looot costs about ${usd(q.expected)}, at most ${usd(most)}. No paid call was made.`);
  const next = nextCommand("init", domain, cap, {}, outDir);
  const client = (deps.client ?? clientFromEnv)();
  if (!client) fail(`LOOOT_TOKEN is not set. Nothing was spent. No looot account yet? Sign up at https://looot.ai/auth/sign-up ($2 free credit). Then sign in with npx -y looot@latest login (a browser page to approve), or create an agent token at looot.ai (Settings, Agent tokens) and set LOOOT_TOKEN, then run this.\n  export LOOOT_TOKEN=...\n  ${next}\nOr run looot-zeus init ${domain} --direct to read the pages without looot, no key and no charge.`, 2);
  if (!(await confirmPaid(`Read them for at most ${usd(most)}?`, next, a, deps))) return null;
  return initDomain(domain, { runner: client, direct: false, cap, outDir, configPath, log });
}

/** gtm/candidates.json: every rival candidate with its check, the target read from the site, profiles and review snippets. */
export function writeCandidates(outDir: string, out: RivalsOut): void {
  const { summary, competitors, seeds, candidates, reasons, excluded, categoryTerms, target, profiles, rivalCustomers, reviews, unresolved } = out;
  writeFile(join(outDir, "candidates.json"), JSON.stringify({ generatedAt: new Date().toISOString(), summary, picked: { competitors, seeds, reasons }, excluded, categoryTerms, target, candidates, profiles, rivalCustomers, reviews, unresolved }, null, 2) + "\n");
}

/**
 * The quote for a run. When the brief has no competitors (or no seeds) the run starts with one
 * company.similar call on your own domain, so that call is quoted first and the other modules are
 * priced on 3 rivals (and 3 seeds). Returns the module to run first, or undefined.
 */
export async function getQuote(cfg: GtmConfig, mods: GtmModule[], offline: boolean, rule: WorkspaceRule | null = null): Promise<{ q: Quote; rivals?: GtmModule }> {
  const unknown = unknownCapSections(resolveCaps(cfg), MODULES.map((m) => m.id));
  if (unknown.length > 0) console.error(`Warning: caps.sections has ${unknown.map((u) => `"${u}"`).join(", ")}, not a module. Modules: ${MODULES.map((m) => m.id).join(", ")}. That cap does nothing.`);
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline });
  const need = rivalsNeeded(cfg, mods.map((m) => m.id));
  if (!needsAny(need)) return { q: buildQuote(mods, cfg, book, { skipDone: new Set(["intake"]), rule }) };
  const rivals = rivalsModule(need);
  return { q: buildQuote([rivals, ...mods], assumeRivals(cfg, need), book, { skipDone: new Set(["intake"]), rule }), rivals };
}

/** Reads the workspace guardrails (free) so the quote can mark steps they may refuse. Never changes the brief. Prints one line. Never throws. */
async function workspaceRule(cfg: GtmConfig, offline: boolean, client: (() => JobRunner | null) | undefined, log: Log): Promise<{ cfg: GtmConfig; rule: WorkspaceRule | null }> {
  const c = (client ?? clientFromEnv)() as (JobRunner & { effectiveGuardrails?: () => Promise<unknown> }) | null;
  const read = await readWorkspaceRule(c && typeof c.effectiveGuardrails === "function" ? { effectiveGuardrails: () => c.effectiveGuardrails!() } : null, offline);
  log(read.note);
  return { cfg, rule: read.rule };
}

/**
 * The spend-limit check in front of a paid run. Refuses when a workspace spend limit has less left than the most the run
 * can cost (the worst case under every cap, and never above --cap), and offers a smaller cap when the expected cost fits.
 * A limit that cannot be read never refuses: the run goes on and stops at the first refusal.
 */
export function spendLimitGate(read: SpendLimitRead, q: Pick<Quote, "expectedCapped" | "worstCapped">, cap: number): { ok: boolean; message: string } {
  const most = Math.min(q.worstCapped, cap);
  if (read.state !== "below" || read.availableUsd === undefined || read.availableUsd >= most) return { ok: true, message: read.note };
  const left = read.availableUsd;
  const name = limitName(read.period);
  const leftText = left >= 0.01 ? `$${left.toFixed(2)}` : `$${left.toFixed(4)}`;
  const smaller = Math.floor(left * 100) / 100;
  const offer = smaller > 0 && checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, smaller).ok
    ? ` Or run a smaller one inside what is left: add --cap ${smaller} (the run stops at that cap with a partial dossier).`
    : "";
  return { ok: false, message: `Refused. Your ${name} has ${leftText} left and this run can cost up to $${most.toFixed(2)}, so looot would refuse most of its calls. Nothing ran and nothing was spent. Raise the limit at ${SPEND_LIMIT_URL} (Budgets) or wait for it to reset, then run again.${offer}` };
}

/** Reads the workspace spend limits (free) and refuses the run when they cannot hold its worst case. Prints one line. */
async function checkSpendLimit(client: JobRunner, q: Quote, cap: number, log: Log): Promise<SpendLimitRead | null> {
  const c = client as JobRunner & { spendLimit?: (worstUsd: number) => Promise<SpendLimitRead> };
  if (typeof c.spendLimit !== "function") return null;
  const read = await c.spendLimit(Math.min(q.worstCapped, cap));
  const gate = spendLimitGate(read, q, cap);
  if (read.state === "below") log(read.note);
  // The refusal is the exit message, so a caller without a log (the hosted page) still shows it.
  if (!gate.ok) fail(gate.message, 3);
  log(gate.message);
  return read;
}

export async function cmdQuote(a: Args, configPath: string, deps: Pick<PaidDeps, "client"> = {}): Promise<void> {
  const cfg = loadConfig(configPath, { depth: depthOf(a), phones: a.phones === true ? true : undefined, noPhones: a["no-phones"] === true, maxRuns: maxRunsOf(a), noLinkedin: a["no-linkedin"] === true, people: a.people === true });
  const mods = selectModules(a.only as string | undefined);
  const ws = await workspaceRule(cfg, a.offline === true, deps.client, console.log);
  const { q } = await getQuote(ws.cfg, mods, a.offline === true, ws.rule);
  const cap = a.cap === undefined ? undefined : capOf(a, 10);
  console.log(`Quote for ${cfg.domain}, depth ${cfg.depth}. No paid call was made.\n`);
  console.log(formatQuote(q, cap));
  console.log(`Suggested cap ${suggestCap(q.worstCapped)} USD.`);
  if (cap !== undefined) {
    const chk = checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, cap);
    console.log(chk.message);
    if (!chk.ok) process.exitCode = 3;
  }
}

/**
 * The paid part of a run. Called only after the quote was printed and the cap check passed.
 * The ledger holds each call's ceiling before the call is made, so the run stops at the cap.
 */
export async function runWithCap(o: { cfg: GtmConfig; mods: GtmModule[]; q: Quote; cap: number; client: JobRunner; outDir: string; configPath: string; public: boolean; safe?: boolean; maskAccounts?: boolean; rivals?: GtmModule; log?: Log; assetsFetch?: typeof fetch; /** The period of the spend limit read at quote time. */ limitPeriod?: string }): Promise<Receipt> {
  const log = o.log ?? console.log;
  const { mods, q, cap, client, outDir } = o;
  let cfg = o.cfg;
  const ledger = new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })), resolveCaps(cfg));
  const intakeCalls: CallRecord[] = existsSync(join(outDir, "intake", "calls.json")) ? JSON.parse(readFileSync(join(outDir, "intake", "calls.json"), "utf8")) : [];
  log("");
  const live: CallRecord[] = [];
  let first: Awaited<ReturnType<typeof runPipeline>> | null = null;
  let res: Awaited<ReturnType<typeof runPipeline>>;
  try {
    if (o.rivals) {
      // The brief named no rivals (or no seeds). One quoted call on your own domain fills them first.
      first = await runPipeline({ mods: [o.rivals], cfg, quote: q, runner: client, ledger, mode: "live", outDir, limitPeriod: o.limitPeriod, onModuleEnd: (id, r) => log(moduleLine(id, r, live)), onCall: (c) => live.push(c) });
      const r = first.results.get("rivals");
      const out = r?.status === "done" ? (r.out as RivalsOut) : null;
      if (out) {
        writeCandidates(outDir, out);
        const before = JSON.stringify([cfg.competitors, cfg.seeds, cfg.profiles, cfg.icp]);
        cfg = applyRivals(cfg, out);
        const { learned: _l, more: _m, ...brief } = cfg as GtmConfig & { learned?: unknown; more?: unknown };
        if (before !== JSON.stringify([cfg.competitors, cfg.seeds, cfg.profiles, cfg.icp])) writeFile(o.configPath, configToYaml(brief as GtmConfig, [`Rivals${out.filled.seeds ? " and seeds" : ""}, logos and social pages added on ${new Date().toISOString().slice(0, 10)} by the rival check. gtm/candidates.json has every candidate and why it was kept or dropped. Edit anything.`]));
        log(`  Rivals ${cfg.competitors.join(", ") || "none"}${out.filled.seeds ? `, seeds ${cfg.seeds.join(", ") || "none"}` : ""}. Written to ${o.configPath}.`);
      }
    }
    res = await runPipeline({
      mods, cfg, quote: q, runner: client, ledger, mode: "live", outDir, limitPeriod: o.limitPeriod, limitStopped: first?.limitStopped,
      preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: `config from ${o.configPath}` } },
      onModuleEnd: (id, r) => log(moduleLine(id, r, live)),
      onCall: (c) => live.push(c),
    });
  } catch (e) {
    if (e instanceof LoootError) fail(`looot refused, ${e.code ?? e.status}. ${e.message}`);
    if (e instanceof CapReached) fail(e.message);
    throw e;
  }
  const calls = [...intakeCalls, ...(first?.calls ?? []), ...res.calls];
  // The time is measured, from the first paid call of this run to the last module end.
  const startedAt = first?.startedAt ?? res.startedAt;
  const shift = res.startedAt.getTime() - startedAt.getTime();
  const results = new Map([...(first?.results ?? []), ...res.results]);
  const timings = new Map([...(first?.timings ?? []), ...[...res.timings].map(([id, t]) => [id, { startedAtMs: t.startedAtMs + shift, endedAtMs: t.endedAtMs + shift }] as const)]);
  const labels = Object.fromEntries([...(o.rivals ? [o.rivals] : []), ...mods].map((m) => [m.id, m.label]));
  const receipt = buildReceipt({ domain: cfg.domain, mode: "live", cap, quote: q, labels, results, timings, calls, startedAt, finishedAt: res.finishedAt, capStopped: (first?.capStopped ?? false) || res.capStopped, limitStopped: res.limitStopped ?? first?.limitStopped });
  // Last week's files go to history/ before this run's files replace them.
  const prev = archivePrevious(outDir);
  if (o.assetsFetch) {
    // Logos and ad creatives, plain web requests, no looot call. Saved under gtm/assets/.
    const a = await collectAssets(outDir, cfg, outputsOf(res.results), o.assetsFetch);
    log(`  Assets ${a.logos} logos and ${a.ads} ad creatives saved under ${join(outDir, "assets")}${a.missed > 0 ? `, ${a.missed} could not be fetched (lettered tiles instead)` : ""}.`);
  }
  writeAll(outDir, { cfg, mods, results: res.results, receipt, public: o.public, safe: o.safe, writeConfig: false });
  const changes = recordRun(outDir, prev, buildSnapshot(cfg, outputsOf(res.results), receipt));
  keepRun(outDir, receipt, outputsOf(res.results));
  printSummary(res.results, log);
  if (changes) log(`\n${changes.total === 0 ? "Nothing changed" : `${changes.total} changes`} since the run of ${prev!.at.slice(0, 10)}. See ${join(outDir, "changes.md")}`);
  if (o.public) publicLine(outDir, log, o.maskAccounts === true);
  log(`\n${stopLine({ ...res, results, limitStopped: res.limitStopped ?? first?.limitStopped })} · ${receipt.run.calls} calls · ${usd(receipt.run.charged)} new spend${receipt.run.replayedCalls ? ` · ${receipt.run.replayedCalls} replayed free` : ""} · ${ms(receipt.run.durationMs)} · ${join(outDir, "dossier.html")}`);
  return receipt;
}

export async function cmdRun(a: Args, configPath: string, outDir: string, deps: PaidDeps = {}): Promise<Receipt | null> {
  const log = deps.log ?? console.log;
  const cfg0 = withLearnings(loadConfig(configPath, { depth: depthOf(a), phones: a.phones === true ? true : undefined, noPhones: a["no-phones"] === true, maxRuns: maxRunsOf(a), noLinkedin: a["no-linkedin"] === true, people: a.people === true }), a, outDir, log);
  const mods = selectModules(a.only as string | undefined);
  const cap = capOf(a, 10);
  const ws = await workspaceRule(cfg0, a.offline === true, deps.client, log);
  const cfg = ws.cfg;
  const { q, rivals } = await getQuote(cfg, mods, a.offline === true, ws.rule);
  // The price is printed here, before the client exists and before any paid call.
  log(formatQuote(q, cap));
  const chk = checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, cap);
  log(chk.message);
  if (!chk.ok) fail("", 3);
  const client = (deps.client ?? clientFromEnv)();
  if (!client) fail("LOOOT_TOKEN is not set. No looot account yet? Sign up at https://looot.ai/auth/sign-up ($2 free credit). Then sign in with npx -y looot@latest login (a browser page to approve), or create an agent token at looot.ai (Settings, Agent tokens) and set LOOOT_TOKEN. To see the dossier without a key, run looot-zeus demo.", 2);
  const limits = await checkSpendLimit(client, q, cap, log);
  const next = nextCommand("run", undefined, cap, a, outDir);
  if (!(await confirmPaid(`Run it with a cap of ${capText(cap)}?`, next, a, deps))) return null;
  return runWithCap({ cfg, mods, q, cap, client, outDir, configPath, public: a.public === true, safe: a["safe-demo"] === true, maskAccounts: a["mask-accounts"] === true, rivals, log, limitPeriod: limits?.period, assetsFetch: deps.assetsFetch ?? (deps.client ? undefined : fetch) });
}

// ---- prepare: cheap discovery for the agent ---------------------------------------------------------

/**
 * `looot-zeus prepare <domain>`. The step before the paid run, for the user's agent.
 * 1. Free read of up to 7 pages of the site (no looot call) when there is no brief yet.
 * 2. The rival check, quoted first: Google results, company.similar, rival home pages, rival customer
 *    pages, review snippets and company.enrich for logos and social pages. A few cents.
 * 3. Writes gtm/candidates.json (every candidate with its check, the target read from the site,
 *    customers, review snippets) and the rules' picks into gtm/config.yaml.
 * The agent then reads gtm/candidates.json and gtm/intake/, decides the rivals, the ICP and the
 * category words, writes them into gtm/config.yaml with discovery.by set to agent, and runs.
 */
export async function cmdPrepare(domainArg: string | undefined, a: Args, configPath: string, outDir: string, deps: PaidDeps = {}): Promise<RivalsOut | null> {
  if (!domainArg) fail("Usage: looot-zeus prepare <domain>", 2);
  const log = deps.log ?? console.log;
  let wanted: string;
  try {
    wanted = normalizeConfig({ domain: domainArg }).domain;
  } catch (e) {
    fail((e as Error).message, 2);
  }
  writeAgentHints(dirname(resolve(outDir)));
  if (existsSync(configPath)) {
    const existing = loadConfig(configPath);
    if (existing.domain !== wanted) fail(`${configPath} is the brief for ${existing.domain}, not ${wanted}. Use --out <dir> for a new domain.`, 2);
    log(`Using the pages already read for ${wanted} and your brief in ${configPath}.`);
  } else {
    log("Step 1 of 2. A free read of your site. No looot call and no charge.");
    await initDomain(wanted, { runner: new DirectRunner(deps.fetch ?? fetch), direct: true, cap: 0.25, outDir, configPath, log, next: "" });
  }
  const cfg0 = loadConfig(configPath);
  const need = { competitors: true, seeds: cfg0.seeds.length === 0, profiles: true };
  const mod = rivalsModule(need);
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: a.offline === true });
  const q = buildQuote([mod], assumeRivals(cfg0, need), book);
  const cap = capOf(a, 1);
  log(`\nStep 2 of 2. Find and check rivals, customers and social pages for ${wanted}. No paid call was made yet.\n`);
  log(formatQuote(q, cap));
  const chk = checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, cap);
  log(chk.message);
  if (!chk.ok) fail("Nothing ran and nothing was spent.", 3);
  const client = (deps.client ?? clientFromEnv)();
  const next = nextCommand("prepare", wanted, cap, a, outDir);
  if (!client) fail(`LOOOT_TOKEN is not set. Nothing was spent. No looot account yet? Sign up at https://looot.ai/auth/sign-up ($2 free credit). Then sign in with npx -y looot@latest login (a browser page to approve), or create an agent token at looot.ai (Settings, Agent tokens) and set LOOOT_TOKEN, then run this.\n  export LOOOT_TOKEN=...\n  ${next}`, 2);
  if (!(await confirmPaid(`Run the rival check with a cap of ${capText(cap)}?`, next, a, deps))) return null;
  let res;
  try {
    res = await runPipeline({ mods: [mod], cfg: { ...cfg0, competitors: cfg0.competitors }, quote: q, runner: client, ledger: new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })), resolveCaps(cfg0)), mode: "live", outDir });
  } catch (e) {
    if (e instanceof LoootError) fail(`looot refused, ${e.code ?? e.status}. ${e.message}`);
    if (e instanceof CapReached) fail(e.message);
    throw e;
  }
  const r = res.results.get("rivals");
  if (!r || r.status !== "done") fail(`the rival check ${r?.status ?? "did not run"}, ${r?.summary ?? ""}`);
  const out = r.out as RivalsOut;
  writeCandidates(outDir, out);
  // The calls go next to the intake calls, so the receipt of the run that follows counts them.
  const callsPath = join(outDir, "intake", "calls.json");
  const before: CallRecord[] = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : [];
  writeFile(callsPath, JSON.stringify([...before, ...res.calls], null, 2) + "\n");
  const cfg = applyRivals(cfg0, out);
  writeFile(configPath, configToYaml(cfg, [
    `Brief for ${wanted}, rivals and target picked by the rules on ${new Date().toISOString().slice(0, 10)}.`,
    "Agent step. Read gtm/candidates.json and gtm/intake/*.md, then set competitors (3 to 5 real rivals) with rivalReasons,",
    "icp (industries, sizeBand, titles, useCaseTerms: 3 to 6 phrases a good buyer says on its own site), target, categoryTerms (10 to 20 words) and keywords. Set discovery.by to agent.",
    "Then run looot-zeus run. Every field can be edited.",
  ]));
  const spent = res.calls.reduce((n, c) => n + c.charged, 0);
  const kept = (out.candidates ?? []).filter((c) => c.kept);
  const dropped = (out.candidates ?? []).filter((c) => !c.kept && c.overlap !== null);
  log(`\nRivals the rules kept (${kept.length} of ${(out.candidates ?? []).length} candidates):`);
  for (const c of kept) log(`  ✔ ${c.domain.padEnd(22)} ${Math.round((c.overlap ?? 0) * 100)}% of your category words, ${c.sources.length} ${c.sources.length === 1 ? "source" : "sources"}`);
  if (dropped.length > 0) log("Turned down after reading their home page:");
  for (const c of dropped.slice(0, 8)) log(`  – ${c.domain.padEnd(22)} ${c.reason}`);
  const t = out.target;
  if (t) log(`\nWho your site is for: ${t.roles.join(", ") || "not clear from the pages"}. Size words: ${t.sizes.join(", ") || "none"}.\nNamed customers: ${t.customers.slice(0, 10).join(", ") || "none found"}.`);
  log(`Seeds from customer pages: ${cfg.seeds.join(", ") || "none"}.`);
  log(`Category words: ${(out.categoryTerms ?? []).slice(0, 15).join(", ")}.`);
  log(`\nWrote ${join(outDir, "candidates.json")} and ${configPath}. Spent ${usd(spent)}.`);
  log(`Next, your agent reviews the picks in ${configPath} (see the header), then: ${nextCommand("run", undefined, 5, {}, outDir)}`);
  return out;
}

// ---- one command: looot-zeus run <domain> ---------------------------------------------------------

/**
 * `looot-zeus run <domain>`. One command from a domain to a dossier.
 * 1. With no config yet, reads 4 pages of the site for free (init --direct) and writes the draft.
 * 2. Prints the quote and the suggested cap. Nothing paid has run at this point.
 * 3. Asks "run it with a cap of $X?". --yes skips the question. Without a terminal and without
 *    --yes it stops here, spends nothing and prints the command to run next.
 * 4. Runs under the cap and writes the dossier and the receipt.
 */
export async function cmdRunDomain(domainArg: string, a: Args, configPath: string, outDir: string, deps: PaidDeps = {}): Promise<Receipt | null> {
  const log = deps.log ?? console.log;
  let wanted: string;
  try {
    wanted = normalizeConfig({ domain: domainArg }).domain;
  } catch (e) {
    fail((e as Error).message, 2);
  }
  writeAgentHints(dirname(resolve(outDir)));
  if (existsSync(configPath)) {
    const existing = loadConfig(configPath);
    if (existing.domain !== wanted) fail(`${configPath} is the brief for ${existing.domain}, not ${wanted}. Use --out <dir> for a new domain, or run looot-zeus run without a domain to use that brief.`, 2);
    log(`Using your brief in ${configPath}.`);
  } else {
    log("Step 1 of 3. A free read of your site. No looot call and no charge.");
    await initDomain(wanted, { runner: new DirectRunner(deps.fetch ?? fetch), direct: true, cap: 0.25, outDir, configPath, log, next: `You can edit ${configPath} and run this command again. Nothing paid has run.` });
  }

  const cfg0 = withLearnings(loadConfig(configPath, { depth: depthOf(a), phones: a.phones === true ? true : undefined, noPhones: a["no-phones"] === true, maxRuns: maxRunsOf(a), noLinkedin: a["no-linkedin"] === true, people: a.people === true }), a, outDir, log);
  const mods = selectModules(a.only as string | undefined);
  if (a.offline !== true) log("Reading live prices from looot.");
  const ws = await workspaceRule(cfg0, a.offline === true, deps.client, log);
  const cfg = ws.cfg;
  const { q, rivals } = await getQuote(cfg, mods, a.offline === true, ws.rule);
  const suggested = suggestCap(q.worstCapped);
  const cap = capOf(a, suggested);
  log(`\nStep 2 of 3. The price for ${cfg.domain}, depth ${cfg.depth}. No paid call was made.\n`);
  log(formatQuote(q, cap));
  log(`Suggested cap ${suggested} USD.${a.cap === undefined ? "" : ` Your cap ${capText(cap).slice(1)} USD.`}`);
  const chk = checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, cap);
  log(chk.message);
  if (!chk.ok) fail("Nothing ran and nothing was spent.", 3);

  const next = nextCommand("run", cfg.domain, cap, a, outDir);
  const client = (deps.client ?? clientFromEnv)();
  if (!client) fail(`LOOOT_TOKEN is not set, so the paid run cannot start. Nothing was spent. No looot account yet? Sign up at https://looot.ai/auth/sign-up ($2 free credit). Then sign in with npx -y looot@latest login (a browser page to approve), or create an agent token at looot.ai (Settings, Agent tokens) and set LOOOT_TOKEN, then run this.\n  export LOOOT_TOKEN=...\n  ${next}`, 2);

  const limits = await checkSpendLimit(client, q, cap, log);
  if (!(await confirmPaid(`Run it with a cap of ${capText(cap)}?`, next, a, deps))) return null;

  log(`\nStep 3 of 3. Running inside a ${capText(cap)} cap.`);
  const receipt = await runWithCap({ cfg, mods, q, cap, client, outDir, configPath, public: a.public === true, safe: a["safe-demo"] === true, maskAccounts: a["mask-accounts"] === true, rivals, log, limitPeriod: limits?.period, assetsFetch: deps.assetsFetch ?? (deps.client ? undefined : fetch) });
  // In a terminal the dossier opens at the end. --no-open skips it. Tests pass their own opener.
  const tty = deps.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const opener = deps.open ?? (deps.isTTY === undefined ? openFile : undefined);
  if (tty && a["no-open"] !== true && opener) {
    opener(resolve(outDir, "dossier.html"));
    log(`Opened ${join(outDir, "dossier.html")}. Add --no-open to skip this next time.`);
  }
  return receipt;
}

// ---- demo, fixtures, open ----------------------------------------------------------------------------

/** Demo state shared by `demo` and the fixtures command. */
async function demoRun(a: Args) {
  const cfg = normalizeConfig(loadFixture("config").config);
  const mods = MODULES;
  // Intake is priced here too, so the placeholder receipt looks like init plus run.
  const q = buildQuote(mods, cfg, await loadPriceBook({ cacheDir: ".looot-zeus", offline: true }));
  const cap = 10;
  const noCalls: JobRunner = { call: async () => { throw new Error("demo makes no calls"); } };
  const res = await runPipeline({
    mods, cfg, quote: q, runner: noCalls, ledger: new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })), resolveCaps(cfg)), mode: "demo", outDir: "",
    preset: { intake: { out: { pages: [], config: cfg, guessed: [] }, summary: "config draft from 4 pages (placeholder)" } },
  });
  const receipt = placeholderReceipt({ cfg, quote: q, mods, results: res.results, cap });
  return { cfg, mods, q, res, receipt, cap, pub: a.public === true };
}

export async function cmdDemo(a: Args, outDir: string): Promise<void> {
  const { cfg, mods, res, receipt, pub } = await demoRun(a);
  console.log(`Demo on placeholder data for ${cfg.domain}. No key, no network, no charge.\n`);
  for (const m of mods) {
    const r = res.results.get(m.id)!;
    const mine = receipt.calls.filter((c) => c.module === m.id);
    console.log(moduleLine(m.id, r, mine));
  }
  const files = writeAll(outDir, { cfg, mods, results: res.results, receipt, public: pub, safe: a["safe-demo"] === true, placeholder: "PLACEHOLDER DATA. Every company, person, number and cost line here is invented to show the layout. Run looot-zeus run <your domain> for a real dossier.", writeConfig: true });
  recordRun(outDir, null, buildSnapshot(cfg, outputsOf(res.results), receipt));
  printSummary(res.results, console.log);
  if (pub) publicLine(outDir, console.log, a["mask-accounts"] === true);
  console.log(`\ndone (placeholder) · ${receipt.run.calls} calls · ${usd(receipt.run.charged)} · ${ms(receipt.run.durationMs)} · ${join(outDir, "dossier.html")}`);
  console.log(`Wrote ${files.length} files to ${outDir}/. Open it with looot-zeus open`);
}

export async function cmdFixtures(): Promise<void> {
  const { receipt } = await demoRun({});
  const errs = validateReceipt(receipt);
  if (errs.length > 0) fail(errs.join("\n"));
  writeFile(join(PKG_ROOT, "fixtures", "placeholder-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(`Wrote fixtures/placeholder-receipt.json, ${receipt.calls.length} calls, ${usd(receipt.run.charged)}, schema valid.`);
}

/** Opens a file with the system opener, detached. */
export function openFile(file: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

export function cmdOpen(outDir: string, what?: string): void {
  const file = resolve(outDir, what === "city" ? join("city", "index.html") : "dossier.html");
  if (!existsSync(file)) fail(`${file} does not exist yet. Run looot-zeus demo or looot-zeus run first.`, 2);
  openFile(file);
  console.log(`Opened ${file}`);
}

// ---- export, watch, skill -------------------------------------------------------------------------

/** `looot-zeus export --public`. A copy of the last dossier you can show anyone, in <out>/public/. */
export function cmdExport(a: Args, outDir: string, deps: { log?: Log } = {}): void {
  if (a.crm === true) return crmLine(a, outDir, deps.log ?? console.log);
  if (a.public !== true) fail("export needs --public (a masked copy in <out>/public/) or --crm (CSV files for your CRM in <out>/crm/).", 2);
  publicLine(outDir, deps.log ?? console.log, a["mask-accounts"] === true);
}

/** `looot-zeus export --crm`. Company CSV always, contacts only from a non-safe run with people. */
function crmLine(a: Args, outDir: string, log: Log): void {
  const format = String(a.format ?? "generic").toLowerCase();
  if (!(CRM_FORMATS as readonly string[]).includes(format)) fail(`--format must be one of ${CRM_FORMATS.join(", ")}.`, 2);
  const state = readState(outDir);
  if (!state) fail(`${join(outDir, STATE_FILE)} does not exist yet. Run looot-zeus run first.`, 2);
  const out = (id: string) => (state.results[id]?.out ?? {}) as { rows?: unknown[] };
  const people = withCommitteePhones((out("enrich").rows ?? out("people").rows ?? []) as never[], ((state.results["committee"]?.out as { accounts?: never[] } | undefined)?.accounts ?? []));
  const rf = join(outDir, "receipt.json");
  const receipt = existsSync(rf) ? JSON.parse(readFileSync(rf, "utf8")) : null;
  const safe = a.public === true || a["safe-demo"] === true || state.safe === true;
  if (state.placeholder) log("PLACEHOLDER data: these companies and people are invented by looot-zeus demo. Do not import them into a real CRM.");
  const r = writeCrm(outDir, format as CrmFormat, { accounts: out("accounts").rows ?? [], people, receipt: receipt && state.placeholder ? { ...receipt, placeholder: state.placeholder } : receipt, safe, contactDetails: a["contact-details"] === true });
  log(`CRM files in ${r.dir}/: ${r.companies} companies${r.contacts ? `, ${r.contacts} contacts${a["contact-details"] === true ? "" : " (no emails or phones, add --contact-details)"}` : safe ? ", no contacts (safe output)" : ", no contacts (the run had no people data, a paid --people run adds them)"}, receipt.txt.`);
  log(IMPORT_HOW[format as CrmFormat]);
}

/**
 * `looot-zeus watch`. The same capped run again (default cap 5 USD), with the same price and [y/N]
 * question. The run compares itself with the last one and writes changes.md.
 * `watch --demo` writes an example changes.md from placeholder data, with no call.
 */
export async function cmdWatch(a: Args, configPath: string, outDir: string, deps: PaidDeps = {}): Promise<Receipt | null> {
  const log = deps.log ?? console.log;
  if (a.demo === true) {
    log(`Example of what changed in a week, on placeholder data. No call made. Wrote ${watchDemo(outDir)}`);
    return null;
  }
  if (!readSnapshot(outDir)) log(`No earlier run in ${outDir}/ to compare with. This run becomes the baseline. Next week's run will be compared with it.`);
  const day = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const client = () => {
    const c = (deps.client ?? clientFromEnv)();
    return c ? withWatchDay(c, day) : null;
  };
  return cmdRun({ ...a, cap: a.cap ?? "5" }, configPath, outDir, { ...deps, client, assetsFetch: deps.assetsFetch ?? (deps.client ? undefined : fetch) });
}

/**
 * Adds the UTC day to every step, so a watch run gets fresh idempotency keys and next week's run is
 * not replayed from this week's. Two watch runs on the same day still share keys (a retry is free).
 */
export function withWatchDay(runner: JobRunner, day: string): JobRunner {
  return { call: (job, input, opts) => runner.call(job, input, { ...opts, step: `${opts.step}@watch:${day}` }) };
}

/** `looot-zeus skill`. Prints SKILL.md, the /gtm skill for coding agents. */
export function cmdSkill(): void {
  process.stdout.write(readFileSync(join(PKG_ROOT, "SKILL.md"), "utf8"));
}

// ---- learn and log ------------------------------------------------------------------------------

/** Adds one line for this run to gtm/learnings.json. The same run twice is kept once. */
export function keepRun(outDir: string, receipt: Receipt, outputs: Record<string, any>): void {
  const l = readLearnings(outDir) ?? emptyLearnings();
  const entry = runEntry(receipt, outputs);
  l.runs = [...l.runs.filter((r) => r.at !== entry.at), entry];
  l.updatedAt = new Date().toISOString();
  writeLearnings(outDir, l);
}

/**
 * Reads gtm/learnings.json before a run and says so. With --apply-learnings the learned weights go
 * into this run's scoring and title order. Without it the run scores as before and says how to use them.
 * config.yaml is never changed.
 */
export function withLearnings(cfg: GtmConfig, a: Args, outDir: string, log: Log): GtmConfig {
  const l = readLearnings(outDir);
  const n = l ? weightCount(l.weights) : 0;
  const date = l?.lastLearn?.date ?? l?.updatedAt.slice(0, 10) ?? "";
  if (a["apply-learnings"] === true) {
    if (!l || n === 0) {
      log(`No learned changes in ${outDir}/learnings.json yet, so this run scores as before.`);
      return cfg;
    }
    log(`using learnings from ${date}, ${n} ${n === 1 ? "change" : "changes"}`);
    const out: WithLearnings = { ...cfg, learned: { industry: l.weights.industry, sizeBand: l.weights.sizeBand, country: l.weights.country, title: l.weights.title } };
    return out;
  }
  if (l && n > 0) log(`Learnings from ${date} found, ${n} ${n === 1 ? "change" : "changes"}, not used in this run. Add --apply-learnings to use them. See ${join(outDir, "next-run.md")}`);
  return cfg;
}

export interface LearnDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  log?: Log;
  date?: string;
}

function readResultsFile(file: string): Outcome[] {
  if (!existsSync(file)) fail(`${file} does not exist. Export the replies from your outreach tool or CRM as CSV and pass it with --results.`, 2);
  try {
    return readResults(readFileSync(file, "utf8"));
  } catch (e) {
    if (e instanceof ResultsError) fail(`${file}, ${e.message}.`, 2);
    throw e;
  }
}

/**
 * `looot-zeus learn`. Reads what happened after the last runs and writes what the next run would
 * change: learnings.json, next-run.md, config.next.yaml, learnings.md and the changelog.
 * Sources: --results <csv> (default gtm/results.csv), plus replies from Instantly when
 * INSTANTLY_API_KEY is set (read only). Never writes config.yaml and never sends anything.
 * `learn --demo` runs on placeholder files with no key and writes to <out>/learn-demo/.
 */
export async function cmdLearn(a: Args, configPath: string, outDir: string, deps: LearnDeps = {}): Promise<Learnings | null> {
  const log = deps.log ?? console.log;
  const date = deps.date ?? new Date().toISOString().slice(0, 10);
  const demo = a.demo === true;
  const dir = demo ? join(outDir, "learn-demo") : outDir;
  const cfgPath = demo ? join(PKG_ROOT, "examples", "yourdomain.yaml") : configPath;
  const prev = demo ? normalizeLearnings(JSON.parse(readFileSync(join(PKG_ROOT, "fixtures", "learnings.json"), "utf8"))) : (readLearnings(outDir) ?? emptyLearnings());
  if (demo) log("Learn demo on placeholder data. No key, no network, no charge.");

  const resultsFile = demo ? join(PKG_ROOT, "fixtures", "results.csv") : typeof a.results === "string" ? a.results : existsSync(join(outDir, "results.csv")) ? join(outDir, "results.csv") : null;
  const fromCsv = resultsFile ? readResultsFile(resultsFile) : [];
  const pulled = demo ? null : await pullInstantly({ campaignId: typeof a["campaign-id"] === "string" ? a["campaign-id"] : undefined }, { fetch: deps.fetch, env: deps.env });
  const sources = [resultsFile ? (demo ? "fixtures/results.csv" : resultsFile) : "", pulled ? "Instantly" : ""].filter(Boolean);
  if (pulled) log(pulled.note);

  const logs: OutreachLog[] = demo ? [] : readOutreach(outDir);
  const idx = demo ? new Map() : leadIndex(outDir);
  const sends: Send[] = [];
  const seen = new Set<string>();
  // One send per email per campaign. The same campaign logged twice, or an email listed twice in
  // one log, counts once. The same email in two campaigns counts once in each.
  const sentIn = new Set<string>();
  for (const l of logs)
    for (const lead of l.leads) {
      const k = `${lead.email}|${keyOf(l.campaign)}`;
      if (sentIn.has(k)) continue;
      sentIn.add(k);
      sends.push({ ...lead, angle: l.angle || undefined, campaign: l.campaign });
      seen.add(lead.email);
    }
  for (const o of fromCsv) if (!seen.has(o.email)) sends.push({ ...leadFrom(o, idx), angle: o.angle || undefined, campaign: o.campaign || undefined });
  const outcomes = [...fromCsv, ...(pulled?.outcomes ?? [])];

  const newRuns = prev.runs.filter((r) => !prev.learnedFrom.includes(`run:${r.at}`));
  if (sends.length === 0 && newRuns.length === 0) {
    log(`Nothing to learn from yet, so nothing changed and nothing was written. Drop the replies file from your outreach tool at ${join(outDir, "results.csv")}, pass --results <file> or set INSTANTLY_API_KEY.`);
    return null;
  }

  let icpTitles: string[] = [];
  if (existsSync(cfgPath)) {
    try {
      icpTitles = loadConfig(cfgPath).icp.titles ?? [];
    } catch {
      icpTitles = [];
    }
  }
  const r = learnFrom(prev, sends, outcomes, date, { icpTitles });
  if (r.already) {
    for (const n of r.notes) log(n);
    return r.next;
  }
  log(`Learning from ${r.sends} sends, ${r.replies} replies and ${r.bounces} bounces${sources.length ? ` (${sources.join(" and ")})` : ""}${newRuns.length ? `, plus ${newRuns.length} ${newRuns.length === 1 ? "run" : "runs"}` : ""}.`);
  writeLearnings(dir, r.next);
  const w = writeProposal(dir, cfgPath, r);
  log("");
  if (r.changes.length === 0) for (const n of r.notes) log(n);
  else {
    log(`${r.changes.length} ${r.changes.length === 1 ? "change" : "changes"}`);
    for (const c of r.changes) log(`  ${c.dimension === "sizeBand" ? "size" : c.dimension} ${c.key} ${c.old.toFixed(2)} to ${c.new.toFixed(2)}. ${c.why}`);
    for (const n of r.notes.filter((x) => x.startsWith("Industry "))) log(n);
  }
  log("\nNext run");
  for (const x of w.lines) log(`  - ${x}`);
  log(`  Suggested cap ${w.cap} USD.`);
  log(`\nWrote ${["learnings.json", ...w.files].map((f) => join(dir, f)).join(", ")}. config.yaml is unchanged.`);
  log(r.changes.length > 0 ? `To use them, npx looot-zeus run --apply-learnings --cap ${w.cap}` : "The next run scores as before.");
  return r.next;
}

/**
 * `looot-zeus log --campaign <name> --angle <text> --file gtm/exports/instantly.csv`. Writes
 * gtm/outreach/<date>-<campaign>.json: who was sent which angle, with grade, industry and title from
 * people.csv and accounts.csv. learn joins replies to it by email. Nothing is sent.
 */
export function cmdLog(a: Args, outDir: string, deps: { log?: Log; date?: string } = {}): string {
  const log = deps.log ?? console.log;
  const campaign = typeof a.campaign === "string" ? a.campaign.trim() : "";
  const file = typeof a.file === "string" ? a.file : "";
  if (!campaign || !file) fail("Usage: looot-zeus log --campaign <name> --angle <text> --file gtm/exports/instantly.csv", 2);
  if (!existsSync(file)) fail(`${file} does not exist.`, 2);
  let rows: Outcome[];
  try {
    rows = readResults(readFileSync(file, "utf8"), { requireOutcome: false });
  } catch (e) {
    if (e instanceof ResultsError) fail(`${file}, ${e.message}.`, 2);
    throw e;
  }
  if (rows.length === 0) fail(`${file} has no email addresses.`, 2);
  const date = deps.date ?? new Date().toISOString().slice(0, 10);
  const idx = leadIndex(outDir);
  const entry: OutreachLog = { schemaVersion: "1", date, campaign, angle: typeof a.angle === "string" ? a.angle.trim() : "", file, leads: rows.map((o) => leadFrom(o, idx)) };
  const out = join(outDir, "outreach", `${date}-${slug(campaign)}.json`);
  writeFile(out, JSON.stringify(entry, null, 2) + "\n");
  log(`Logged ${entry.leads.length} sends for ${campaign}${entry.angle ? `, angle "${entry.angle}"` : ""}, in ${out}. Your outreach tool sends them. Zeus keeps the list. Run npx looot-zeus learn after the campaign reply window has closed.`);
  return out;
}

// ---- more: fetch more into an existing folder --------------------------------------------------

/**
 * `looot-zeus more <accounts|committee|ads|social|seo> [--count N] [--cap X] [--yes]`.
 * Reads gtm/state.json, prices the extra calls, asks for a yes, runs only those modules, merges
 * the new rows into the folder and writes the dossier again. In a demo folder it adds placeholder
 * rows, with no key, no network and no charge.
 */
export async function cmdMore(whatArg: string | undefined, a: Args, outDir: string, deps: PaidDeps = {}): Promise<Receipt | null> {
  const log = deps.log ?? console.log;
  if (!whatArg || !(MORE_WHAT as readonly string[]).includes(whatArg)) fail(`Usage: looot-zeus more <${MORE_WHAT.join("|")}> [--count N] [--cap X] [--yes]`, 2);
  const what = whatArg as MoreWhat;
  const state = readState(outDir);
  if (!state || !existsSync(join(outDir, "receipt.json"))) fail(`${join(outDir, STATE_FILE)} does not exist yet. Run looot-zeus run <domain> or looot-zeus demo first, then ask for more.`, 2);
  let count: number | undefined;
  if (a.count !== undefined) {
    count = Number(a.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) fail("--count is a whole number from 1 to 500", 2);
  }
  const cfg = normalizeConfig(state.cfg, { phones: a.phones === true ? true : undefined, noPhones: a["no-phones"] === true, maxRuns: maxRunsOf(a), noLinkedin: a["no-linkedin"] === true, people: a.people === true });
  const book = await loadPriceBook({ cacheDir: ".looot-zeus", offline: a.offline === true || state.mode === "demo" });
  let patched: GtmConfig;
  let q: Quote;
  try {
    ({ cfg: patched, q } = moreQuote(what, cfg, state, book, count));
  } catch (e) {
    fail((e as Error).message, 2);
  }
  const spec = SPECS[what];
  log(`${spec.label} for ${cfg.domain}. No paid call was made yet.\n`);
  const demo = state.mode === "demo";
  const cap = capOf(a, demo ? 10 : suggestCap(q.worstCapped));
  log(formatQuote(q, cap));
  const old = JSON.parse(readFileSync(join(outDir, "receipt.json"), "utf8")) as Receipt;
  const oldOuts: Record<string, any> = Object.fromEntries(Object.entries(state.results).map(([id, r]) => [id, r.out]));
  const added = new Map<string, ModuleResult>();
  let add: Receipt;
  const specMods = spec.mods.map((id) => MODULES.find((m) => m.id === id)!);

  if (demo) {
    log("\nThis is a demo folder, so it adds placeholder rows. No key, no network, no charge.");
    const f = loadFixture<Record<string, Record<string, unknown>>>("more")[what] ?? {};
    for (const id of spec.mods) if (f[id]) added.set(id, { status: "done", summary: String((f[id] as { summary?: string }).summary ?? ""), out: f[id] });
    add = placeholderReceipt({ cfg: patched, quote: q, mods: specMods.map((m) => ({ ...m, needs: [] })), results: added, cap, startedAt: new Date(Date.parse(old.run.finishedAt) + 60_000) });
  } else {
    const chk = checkQuoteAgainstCap(q.expectedCapped, q.worstCapped, cap);
    log(chk.message);
    if (!chk.ok) fail("Nothing ran and nothing was spent.", 3);
    const next = ["looot-zeus", "more", what, ...(count ? ["--count", String(count)] : []), ...(a["no-phones"] === true ? ["--no-phones"] : []), ...(a.phones === true ? ["--phones"] : []), ...(a.people === true ? ["--people"] : []), "--cap", String(cap), "--yes", ...(outDir !== "gtm" ? ["--out", outDir] : [])].join(" ");
    const client = (deps.client ?? clientFromEnv)();
    if (!client) fail(`LOOOT_TOKEN is not set, so nothing ran and nothing was spent. No looot account yet? Sign up at https://looot.ai/auth/sign-up ($2 free credit). Then sign in with npx -y looot@latest login (a browser page to approve), or create an agent token at looot.ai (Settings, Agent tokens) and set LOOOT_TOKEN, then run this.\n  export LOOOT_TOKEN=...\n  ${next}`, 2);
    if (!(await confirmPaid(`Fetch it with a cap of ${capText(cap)}?`, next, a, deps))) return null;
    // The modules this pull needs read what the folder already has.
    const want = new Set(spec.mods);
    const needs = new Set(specMods.flatMap((m) => m.needs).filter((n) => !want.has(n)));
    const mods = MODULES.filter((m) => want.has(m.id) || needs.has(m.id)).map((m) => ({ ...m, needs: m.needs.filter((n) => want.has(n) || needs.has(n)) }));
    const preset = Object.fromEntries([...needs].map((id) => [id, { out: oldOuts[id] ?? null, summary: state.results[id]?.summary ?? "from the folder" }]));
    const live: CallRecord[] = [];
    let res: Awaited<ReturnType<typeof runPipeline>>;
    try {
      res = await runPipeline({ mods, cfg: patched, quote: q, runner: client, ledger: new CapLedger(cap, q.rows.map((r) => ({ id: r.module, worst: r.worst })), resolveCaps(cfg)), mode: "live", outDir, preset, onModuleEnd: (id, r) => (want.has(id) ? log(moduleLine(id, r, live)) : undefined), onCall: (c) => live.push(c) });
    } catch (e) {
      if (e instanceof LoootError) fail(`looot refused, ${e.code ?? e.status}. ${e.message}`);
      throw e;
    }
    for (const id of spec.mods) {
      const r = res.results.get(id);
      if (r) added.set(id, r);
    }
    add = buildReceipt({ domain: cfg.domain, mode: "live", cap, quote: q, labels: Object.fromEntries(specMods.map((m) => [m.id, m.label])), results: added, timings: res.timings, calls: res.calls, startedAt: res.startedAt, finishedAt: res.finishedAt, capStopped: res.capStopped });
  }

  // Merge the new rows into the folder, then write everything again.
  const results = new Map<string, ModuleResult>(Object.entries(state.results).map(([id, r]) => [id, { ...r }]));
  for (const [id, r] of added) {
    const before = results.get(id);
    const out = mergeOut(id, before?.out, r.out);
    results.set(id, { status: before?.status === "done" || r.status === "done" ? "done" : r.status, summary: (out as { summary?: string } | null)?.summary ?? r.summary, out });
  }
  const newOuts: Record<string, any> = Object.fromEntries([...results].map(([id, r]) => [id, r.out]));
  if (!demo && results.get("synthesis")?.out) {
    const syn = results.get("synthesis")!;
    results.set("synthesis", { ...syn, out: { ...(syn.out as object), plays: rulePlays(newOuts, cfg) } });
  }
  const receipt = mergeReceipt(old, add);
  const pages = { ...(state.pages ?? {}) };
  if (what === "ads" || what === "social") pages[what] = (pages[what] ?? 1) + 1;
  const line = addedLine(what, oldOuts, newOuts);
  if (demo && /^0 /.test(line)) {
    log(`\nThe demo has no more placeholder rows for this. Nothing changed. A real run fetches the next ones from looot.`);
    return null;
  }
  const pulls = [...(state.pulls ?? []), { what, at: new Date().toISOString(), calls: add.run.calls, charged: add.run.charged, added: line }];
  const ids = new Set([...state.modules, ...spec.mods]);
  const mods = MODULES.filter((m) => ids.has(m.id));
  writeAll(outDir, { cfg, mods, results, receipt, public: a.public === true, safe: a["safe-demo"] === true, placeholder: state.placeholder, writeConfig: false, pages, pulls });
  recordRun(outDir, null, buildSnapshot(cfg, newOuts, receipt));
  log(`\n${line} · ${add.run.calls} calls · ${usd(add.run.charged)}${demo ? " (placeholder)" : ""} · ${join(outDir, "dossier.html")}`);
  return receipt;
}

// ---- page requests ------------------------------------------------------------------------------

/** Serves the page folder and takes requests from its buttons into .looot-zeus/requests.json. */
export async function cmdServe(a: Args, outDir: string, deps: { log?: Log; projectDir?: string } = {}): Promise<import("node:http").Server> {
  const log = deps.log ?? console.log;
  const projectDir = deps.projectDir ?? process.cwd();
  const explicit = typeof a.dir === "string" ? a.dir : undefined;
  // Served pages are meant to be shared, so they are safe unless you pass --private. --safe-demo wins over --private.
  const safe = a.private !== true || a["safe-demo"] === true;
  let root = explicit ?? (a.private === true && existsSync(join(projectDir, "city", "index.html")) ? join(projectDir, "city") : outDir);
  if (safe) {
    // Default: only pages rebuilt from the saved run, or the public export. Never a folder that may hold contacts, CSVs or state.json.
    if (explicit !== undefined && resolve(explicit) === resolve(outDir, "public")) {
      log("Serving the public export (company-level data only).");
    } else if (explicit === undefined || [resolve(outDir), resolve(outDir, "city")].includes(resolve(explicit))) {
      const view = writeSafeView(outDir, join(projectDir, ".looot-zeus", "safe-view"));
      if (!view) fail(`Nothing safe to serve, ${outDir} has no saved run. Run looot-zeus run <domain> first, or pass --private to serve a folder as it is.`, 2);
      root = view;
      log("Serving the safe demo copy: people are a role and an invented name, no emails, phones or profile links. --private serves your real contacts.");
    } else {
      fail(`Refusing to serve ${explicit}: it may hold contacts. The default serves only the safe copy of ${outDir} or ${join(outDir, "public")}. Pass --private to serve it as it is.`, 2);
    }
  } else {
    log("WARNING --private: this page shows real contacts (emails, phones, LinkedIn). Do not host it or share the link.");
  }
  const port = a.port === undefined ? DEFAULT_PORT : Number(a.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`--port must be a whole number from 1 to 65535, got ${a.port}`, 2);
  if (!existsSync(root)) fail(`Nothing to serve, ${root} does not exist. Run looot-zeus run <domain> first, or pass --dir.`, 2);
  writeAgentHints(projectDir);
  const server = await startServer({ root, projectDir, port, log });
  const page = existsSync(join(root, "index.html")) ? "" : "dossier.html";
  log(`Serving ${root} on http://127.0.0.1:${port}/${page}`);
  log(`Buttons on the page add requests to ${REQUESTS_FILE}. Nothing runs until you approve one. Stop with Ctrl+C.`);
  return server;
}

/** Deletes the local private output (contacts, CSVs, exports, state, caches). Asks [y/N] unless --yes. */
export async function cmdDelete(a: Args, outDir: string, deps: { log?: Log; projectDir?: string; ask?: (q: string) => Promise<string>; isTTY?: boolean } = {}): Promise<string[]> {
  const log = deps.log ?? console.log;
  const projectDir = deps.projectDir ?? process.cwd();
  const keepPublic = a["keep-public"] === true;
  let paths: string[];
  try {
    paths = privatePaths({ outDir, projectDir, keepPublic });
  } catch (e) {
    if (e instanceof UnsafeDeleteError) fail(e.message, 2);
    throw e;
  }
  if (!paths.length) {
    log("Nothing to delete. No local contacts, exports or caches found.");
    return [];
  }
  log(`This removes ${paths.length} local ${paths.length === 1 ? "item" : "items"} that may hold contacts:`);
  for (const f of paths) log(`  ${f}`);
  if (a.yes !== true) {
    const tty = deps.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!tty) fail("No terminal to ask in, so nothing was deleted. Run looot-zeus delete --yes to delete.", NEEDS_YES);
    const answer = (await (deps.ask ?? askLine)("Delete them? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      log("Nothing was deleted.");
      return [];
    }
  }
  removePaths(paths);
  for (const f of paths) log(`Removed ${f}`);
  log(`Deleted ${paths.length} ${paths.length === 1 ? "item" : "items"}.${keepPublic ? " Kept the public copy." : ""} Your config.yaml is kept.`);
  return paths;
}

export function cmdPending(deps: { log?: Log; projectDir?: string } = {}): void {
  const log = deps.log ?? console.log;
  const list = pendingRequests(deps.projectDir ?? process.cwd());
  if (!list.length) return log("No pending requests.");
  log(`${list.length} pending ${list.length === 1 ? "request" : "requests"}:`);
  for (const r of list) log(`  ${r.id}  ${r.section}, ${r.action} x${r.count}, ${costText(r.estCostUsd)}`);
  const total = list.reduce((t, r) => t + (r.estCostUsd ?? 0), 0);
  log(`Approve with looot-zeus approve <id|all>, about USD ${total.toFixed(2)} for all. Reject with looot-zeus reject <id>.`);
}

export function cmdSetStatus(kind: "approve" | "reject" | "done", id: string | undefined, deps: { log?: Log; projectDir?: string } = {}): void {
  const log = deps.log ?? console.log;
  const projectDir = deps.projectDir ?? process.cwd();
  if (!id) fail(`Usage: looot-zeus ${kind} <id${kind === "approve" ? "|all" : ""}>`, 2);
  if (id === "all" && kind !== "approve") fail(`${kind} takes one id at a time.`, 2);
  const known = readRequests(projectDir).find((r) => r.id === id);
  if (id !== "all" && !known) fail(`No request with id ${id} in ${REQUESTS_FILE}. Run looot-zeus pending to see them.`, 2);
  if (kind === "approve" && known && known.status !== "pending") fail(`Request ${id} is ${known.status}, not pending.`, 2);
  const status = kind === "approve" ? "approved" : kind === "reject" ? "rejected" : "done";
  const hit = setStatus(projectDir, id, status);
  if (!hit.length) return log("No pending requests.");
  if (kind === "approve") {
    for (const r of hit) log(`Approved ${r.id}, ${r.section}, ${costText(r.estCostUsd)}. Run this command, it shows the price and asks first:\n${commandFor(r)}`);
    log(`When it has run, mark it with looot-zeus done <id> and rebuild the page.`);
    return;
  }
  log(`${kind === "reject" ? "Rejected" : "Marked done"} ${hit[0].id}.`);
}

/**
 * `looot-zeus import-supabase`. Upserts the run in <out>/state.json into your Supabase tables
 * (supabase/migrations), deduped by domain. --dry-run prints the counts and writes nothing.
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env; the key is never printed.
 */
export async function cmdImportSupabase(a: Args, outDir: string, deps: { log?: Log; env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<void> {
  const log = deps.log ?? console.log;
  const state = readState(outDir);
  if (!state) fail(`${join(outDir, STATE_FILE)} does not exist yet. Run looot-zeus run (or demo) first.`, 2);
  const rf = join(outDir, "receipt.json");
  const receipt = existsSync(rf) ? JSON.parse(readFileSync(rf, "utf8")) : null;
  const rows = supabaseRowsOf(state, receipt, { contactDetails: a["contact-details"] === true });
  if (state.placeholder) log("PLACEHOLDER data: these companies and people are invented by looot-zeus demo. The run row is marked mode demo.");
  const withEmail = rows.people.filter((p) => p.email || p.phone).length;
  const line = `${rows.accounts.length} accounts, ${rows.committees.length} committees, ${rows.people.length} people (${withEmail ? `${withEmail} with email or phone` : "no emails or phones"}), ${rows.plays.length} plays, ${rows.rivals.length} rivals`;
  if (a["dry-run"] === true) {
    log(`Dry run, nothing written. Would upsert by domain: ${line}.`);
    return;
  }
  const env = deps.env ?? process.env;
  const { target, missing } = supabaseFromEnv(env);
  if (!target) fail(`Set ${missing.join(" and ")} in the environment (Vercel's Supabase integration adds both). Add --dry-run to see the counts without them.`, 2);
  try {
    const r = await importToSupabase(rows, target, deps.fetch ?? fetch);
    log(`Imported into ${target.url}: ${line}. Run row ${r.runId}.`);
  } catch (e) {
    fail(redact((e as Error).message, target.key), 1);
  }
}

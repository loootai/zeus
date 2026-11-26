// The city page: one self-contained HTML file (inline CSS and JS, no network, no server) built from
// the same assembled dossier as dossier.html. Pure: a Dossier in, a string out. The look is David's
// hand-built Higgsfield city (city/index.html): the shell (styles, isometric city, router) is extracted
// into ./shell by build/extract_city_shell.py and filled here with this run's data only.
import { GOAL_ICONS, goalSvg, goalTile } from "./goalIcons.js";
import { escapeHtml as e } from "../util.js";
import type { Block, Section } from "../dossier/blocks.js";
import type { Dossier } from "../dossier/index.js";
import { maskValue } from "../dossier/mask.js";
import { emptyState, renderBlock } from "./blocks.js";
import { CITY_CSS } from "./style.js";
import { CITY_JS, HEAD_JS } from "./script.js";
import { readFileSync } from "node:fs";
import { logoData } from "../assets.js";
import { crmPrompt } from "../crm.js";
import { atlasBrowseData, OUTCOMES } from "../plays/index.js";
import { ASK, HOOKS, hookByTitle, hookCommand, hookPrompt, keptHooks, type HookId } from "../plays/hooks.js";

const readJson = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));

/** One item of the left menu. menu.json is the single source, shared with the hosted example page (build/make_hf.py). */
export interface MenuItem { key: string; label: string; state: "free" | "unlock"; prompt: string; usd: number; view?: string; sub?: string; recipe?: string; action?: "share" | "copy" }
export interface MenuCategory { name: string; items: MenuItem[] }
/** The menu categories in order. The build copies menu.json next to this file. */
export const MENU: MenuCategory[] = readJson("./menu.json").categories;

/** What more credit buys (commands Zeus has today) and the city's not-yet features, from paid.json. */
export interface PaidFeature { key: string; label: string; state: "off" | "coming-soon"; /** The city district this feature would live in, named on its callout. */ district?: string; /** How it will work when it ships (the Push to my CRM hook: looot connections). */ via?: string; note?: string }
/** One item of the "Your looot GTM OS" preview. what names run counts as {viewId}; whatEmpty is shown when one is 0. */
export interface OsItem { key: string; label: string; state: "coming-soon"; what: string; whatEmpty: string; prompt: string }
/** "Take it to the next step": host it on the user's own Vercel and Supabase accounts. No secret in any link. */
export interface OsNext { key: string; label: string; /** "live" shows Deploy to Vercel; "coming-soon" shows only the copied agent prompt. */ state: "live" | "coming-soon"; comingSoon: { tag: string; copy: string; button: string }; stack: string; copy: string; deploy: { label: string; url: string }; supabase: { label: string; url: string }; prompt: string }
const PAID: { adds: { what: string; command: string }[]; features: PaidFeature[]; locked: string; os: { title: string; note: string; button: string; items: OsItem[]; next: OsNext } } = readJson("./paid.json");
/** The "Your looot GTM OS" preview section, all coming soon, from paid.json. */
export const GTM_OS = PAID.os;
/** The line under a district the free run does not build ("Not in the free run"). */
export const LOCKED_LINE = PAID.locked;
/** What more credit buys, each one a command Zeus has today. Nothing here is a feature Zeus lacks. */
export const PAID_ADDS = PAID.adds;
/** Buildings for features Zeus does not have yet. Only "coming-soon" ones are named on the page. */
export const PAID_FEATURES = PAID.features;

const ISO_SVG = readFileSync(new URL("./shell/iso.svg", import.meta.url), "utf8");
const ISO: { roads: number[][]; accounts: number; homes: number; rivals: number } = readJson("./shell/iso.json");
const ICONS: Record<string, string> = readJson("./shell/icons.json");
// The Zeus mascot that stands on the top right edge of the city map and throws his bolt (shell/mascot.*).
// No <img>: its layers are CSS backgrounds (style.ts), so the page still loads nothing.
export const MASCOT_HTML = readFileSync(new URL("./shell/mascot.html", import.meta.url), "utf8").trim();

/** The menu category a view sits under. */
function menuGroup(view: string): string {
  const c = MENU.find((x) => x.items.some((i) => i.view === view));
  if (!c) throw new Error(`city/menu.json has no item for the ${view} view`);
  return c.name;
}

interface CityView {
  id: string;
  label: string;
  group: string;
  /** Module section ids that feed this view. */
  ids: string[];
  /** Tells the reader what is missing when the run has no data for it. */
  empty: string;
  /** Picks only some blocks of a shared section. */
  pick?: (b: Block) => boolean;
}

const isAi = (b: Block) => (b.kind === "table" && /^AI answer/i.test(b.caption ?? "")) || (b.kind === "note" && /^(No AI answer|The AI answer checks)/.test(b.text));

/** The free-run views, in menu order. Headings here are what the tests look for. */
export const CITY_VIEWS: CityView[] = [
  { id: "targets", label: "Target accounts", group: menuGroup("targets"), ids: ["accounts", "enrich", "signals"], empty: "This run found no target accounts." },
  { id: "seo", label: "SEO", group: menuGroup("seo"), ids: ["seo"], empty: "This run has no search data.", pick: (b) => !isAi(b) },
  { id: "geo", label: "GEO", group: menuGroup("geo"), ids: ["seo"], empty: "This run has no AI answer data.", pick: isAi },
  { id: "readiness", label: "Agent readiness", group: menuGroup("readiness"), ids: ["readiness"], empty: "This run has no agent readiness data." },
  { id: "domains", label: "Domain lookup", group: menuGroup("domains"), ids: ["domains"], empty: "This run has no domain data." },
  { id: "pages", label: "Programmatic pages", group: menuGroup("pages"), ids: [], empty: "The free run writes no page drafts. Build more pages in the menu copies the request for your agent." },
  { id: "influencers", label: "Influencers", group: menuGroup("influencers"), ids: ["social"], empty: "This run has no social listening data." },
  { id: "formats", label: "Format finder", group: menuGroup("formats"), ids: ["summary", "icp"], empty: "This run has no formats yet." },
  { id: "calendar", label: "Content calendar", group: menuGroup("calendar"), ids: [], empty: "This run has no content calendar. Drafts are not planned in the free run." },
  { id: "competitive", label: "Competitive analysis", group: menuGroup("competitive"), ids: ["competitors", "ads", "reviews"], empty: "This run has no rival data." },
  { id: "reddit", label: "Reddit", group: menuGroup("reddit"), ids: ["mentions"], empty: "This run has no Reddit or web mentions." },
  { id: "mmap", label: "Market map", group: menuGroup("mmap"), ids: ["market"], empty: "This run has no market snapshot." },
  { id: "runlog", label: "Run log and cost", group: menuGroup("runlog"), ids: ["receipt"], empty: "No receipt." },
];

/** Where "Fork it" points: the public Zeus repo. */
export const ZEUS_REPO_URL = "https://github.com/loootai/zeus";
/** What "Tell your agent" copies: install the /gtm skill, then run it on a domain. */
export const TELL_YOUR_AGENT = "Install the /gtm skill with `npx looot-zeus skill > ~/.claude/skills/gtm/SKILL.md`, then run /gtm <my domain>. Show me the price first and spend nothing without my yes.";

/** What a person tells their agent to make a page like this one. The npx command is the developer route. */
export const AGENT_ONE_LINER = "run zeus.looot.ai for mycompany.com";
/** The developer route, shown only in the small "for developers" note. */
export const DEV_COMMAND = "npx looot-zeus run yourdomain.com";

/** The "tell your agent" pill with a copy button, and the small developer note under it. */
export function agentPill(acts = ""): string {
  return `<div class="obar"><span class="tryl zcmd"><span>Make it yours, tell your agent</span><code>${e(AGENT_ONE_LINER)}</code></span><button type="button" class="cp xexp-b" data-copy="${e(AGENT_ONE_LINER)}">Copy</button>${acts}</div><p class="zdev src">For developers: <code>${e(DEV_COMMAND)}</code></p>`;
}

/** Where "Build your own" and "powered by looot" point on a city page made by the CLI (private, demo or served). */
export const ZEUS_CITY_URL = "https://zeus.looot.ai/?utm_source=zeus-city";
/** Where they point on a shared looot.page copy, tagged so Zeus sign-ups from shared pages can be counted. */
export const ZEUS_SHARED_URL = "https://zeus.looot.ai/?utm_source=looot.page&amp;utm_medium=share&amp;utm_campaign=zeus";
/** The Zeus link for this page: the shared one on a looot.page copy, the city one everywhere else. */
export function zeusUrl(shared = false): string {
  return shared ? ZEUS_SHARED_URL : ZEUS_CITY_URL;
}

/** Share, fork it, tell your agent and powered by looot. Share shows on public (safe) pages only: a private page stays on your machine. On a looot.page copy (shared), only the owner shares, so there is no Share button. */
export function actionsHtml(d: Pick<Dossier, "public">, shared = false): string {
  const share = d.public && !shared ? `<button type="button" class="za zshare">Share</button>` : "";
  return `<div class="zacts zacts-c">${share}<a class="za" href="${ZEUS_REPO_URL}" target="_blank" rel="noopener noreferrer">Fork it</a><button type="button" class="za cp" data-copy="${e(TELL_YOUR_AGENT)}">Tell your agent</button><div class="zpow"><a class="zplk" href="${zeusUrl(shared)}" target="_blank" rel="noopener noreferrer" aria-label="Powered by looot"><span class="zlp">powered by</span><svg class="zlm" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><circle cx="5.6" cy="16" r="4.1" fill="none" stroke="rgb(0,147,98)" stroke-width="2.6"/><defs><pattern id="zlbars" patternUnits="userSpaceOnUse" x="0" y="9" width="32" height="3.027"><rect width="32" height="1.892" fill="rgb(0,147,98)"/></pattern></defs><circle cx="16" cy="16" r="5.4" fill="none" stroke="url(#zlbars)" stroke-width="3.2"/><circle cx="26.4" cy="16" r="4.1" fill="none" stroke="rgb(0,147,98)" stroke-width="2.6"/></svg><span class="zlw">looot</span></a><a class="zpb" href="${zeusUrl(shared)}" target="_blank" rel="noopener noreferrer">Build your own</a></div></div>`;
}

const isNextStepsTable = (b: Block) => b.kind === "table" && /^Next steps/.test(b.caption ?? "");

function viewBlocks(d: Dossier, v: CityView): { section: Section; blocks: Block[] }[] {
  const out: { section: Section; blocks: Block[] }[] = [];
  for (const id of v.ids) {
    const s = id === "receipt" ? d.sections.find((x) => x.id === "receipt") ?? d.sections[d.sections.length - 1] : d.sections.find((x) => x.id === id);
    if (!s) continue;
    // The next-steps table is folded into "Your next plays" (hookCards), so no view shows it again.
    const blocks = (v.pick ? (s.blocks ?? []).filter(v.pick) : s.blocks ?? []).filter((b) => !(id === "summary" && isNextStepsTable(b)));
    if (blocks.length > 0) out.push({ section: s, blocks });
  }
  if (v.id === "formats" && d.plays) out.push({ section: d.plays, blocks: d.plays.blocks });
  return out;
}

/** The items one list block shows: rows of a table, cards, committees or bars. Anything else counts 0. */
export function itemsOf(b: Block): number {
  if (b.kind === "committee" || b.kind === "cards" || b.kind === "bars") return b.items.length;
  if (b.kind === "table") return b.rows.length;
  return 0;
}

/** How many things a view shows, for its count in the menu, the overview and the map. One source: the
 * view's first list block, the one a reader sees first (accounts in Target accounts, rivals in Competitive
 * analysis). Supporting tables under it (people, signals, ads) are not added in, so the badge never says
 * 40 while the page lists 12 accounts. */
function countOf(blocks: Block[]): number {
  const first = blocks.find((b) => itemsOf(b) > 0);
  return first ? itemsOf(first) : 0;
}

/** How many the run found for that same first list, when the list shows only some (accounts, rivals). */
function totalOf(blocks: Block[]): number | undefined {
  const first = blocks.find((b) => itemsOf(b) > 0);
  const t = first && (first.kind === "table" || first.kind === "cards") ? first.total : undefined;
  return t !== undefined && t > itemsOf(first!) ? t : undefined;
}

/** The menu badge: "shown/total" when the run found more than the list shows, else the count. */
export function badgeText(shown: number, total?: number): string {
  return total !== undefined && total > shown ? `${shown}/${total}` : String(shown);
}

const secHtml = (title: string, k: string, body: string, id = "") => `<div class="sec"${id ? ` id="${id}"` : ""}><div class="sech"><h3>${e(title)}</h3>${k ? `<span class="k">${e(k)}</span>` : ""}</div>${body}</div>`;
const vhead = (v: { id: string; label: string; group: string }) => `<section class="view" data-view="${v.id}" data-title="${e(v.label)}" data-group="${e(v.group)}"><div class="vhead"><div><div class="kicker">${e(v.group)}</div><h1>${e(v.label)}</h1></div></div>`;

function viewHtml(d: Dossier, v: CityView, shared = false): string {
  const parts = viewBlocks(d, v);
  let body = parts.length === 0 ? emptyState(v.empty) : parts.map(({ section, blocks }) => secHtml(section.title, section.source ? `${section.status} · ${section.source}` : "", blocks.map((b) => renderBlock(b, d.public)).join(""))).join("");
  // A looot.page copy has no people, so no committees or openers anchors either.
  if (v.id === "targets" && !shared) {
    // Buying committees and openers are menu anchors inside this view, as on David's page.
    const c = d.sections.find((x) => x.id === "committee");
    body += `<span id="committees" class="zanc"></span>` + (c ? secHtml(c.title, c.source ? `${c.status} · ${c.source}` : "", c.blocks.map((b) => renderBlock(b, d.public)).join("")) : secHtml("Buying committees", "", emptyState("This run mapped no buying committees.")));
    body += `<span id="openers" class="zanc"></span>` + secHtml("Outreach openers", "", emptyState("This run wrote no openers. Openers come with people data, see what a paid run adds."));
  }
  const extra = v.id === "runlog" && d.weekly ? secHtml("Run it again every week", d.weekly.price, `<p><code>${e(d.weekly.command)}</code> <button type="button" class="cp xexp-b" data-copy="${e(d.weekly.command)}">Copy</button></p>`) : "";
  const recipe = MENU.flatMap((c) => c.items).find((i) => i.view === v.id && i.recipe)?.recipe;
  const link = recipe ? `<div class="zacts"><a class="za zrecipe" href="${e(recipe)}" target="_blank" rel="noopener noreferrer">Open the recipe</a></div>` : "";
  return `${vhead(v)}${link}${body}${extra}</section>`;
}

/** Fills {company} and {viewId} counts. Any count that is 0 or missing gives the item's whatEmpty, never a made-up number. */
export function osText(i: OsItem, company: string, counts: Map<string, number>): string {
  let missing = false;
  const t = i.what.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === "company") return company;
    const n = counts.get(k);
    if (!n) missing = true;
    return String(n ?? 0);
  });
  return (missing ? i.whatEmpty : t).split("{company}").join(company);
}

/** The "Your looot GTM OS" view: one card per item with what it would do for this company and a Get it built prompt. */
function osHtml(brand: string, domain: string, counts: Map<string, number>): string {
  const cards = GTM_OS.items.map((i) => {
    const prompt = i.prompt.split("{domain}").join(domain).split("{label}").join(i.label);
    return `<article class="card zg-card" id="os-${e(i.key)}"><div class="zg-card-h"><div><h4>${e(i.label)}</h4></div><span class="chip zg-tag">Coming soon</span></div><p>${e(osText(i, brand, counts))}</p><div><button type="button" class="za cp" data-copy="${e(prompt)}">${e(GTM_OS.button)}</button></div></article>`;
  }).join("");
  const n = GTM_OS.next;
  const copyPrompt = e(n.prompt.split("{domain}").join(domain));
  const next = n.state === "coming-soon"
    ? `<div class="sec" id="os-${e(n.key)}"><div class="sech"><h3>${e(n.label)}</h3><span class="k">${e(n.comingSoon.tag)}</span></div><p>${e(n.comingSoon.copy)}</p><div class="zacts"><button type="button" class="za cp" data-copy="${copyPrompt}">${e(n.comingSoon.button)}</button></div></div>`
    : `<div class="sec" id="os-${e(n.key)}"><div class="sech"><h3>${e(n.label)}</h3><span class="k">${e(n.stack)}</span></div><p>${e(n.copy)}</p><div class="zacts"><a class="za" href="${e(n.deploy.url)}" target="_blank" rel="noopener noreferrer">${e(n.deploy.label)}</a><a class="za" href="${e(n.supabase.url)}" target="_blank" rel="noopener noreferrer">${e(n.supabase.label)}</a><button type="button" class="za cp" data-copy="${copyPrompt}">Tell your agent</button></div></div>`;
  return `${vhead({ id: "os", label: GTM_OS.title, group: GTM_OS.title })}<div class="sec"><p class="src">${e(GTM_OS.note.split("{company}").join(brand))}</p><div class="zg-cards">${cards}</div></div>${next}</section>`;
}

/** The plays section's title and its menu label. */
export const PLAYS_TITLE = "Your next plays";
/** Where the plays come from, credited on the page. */
export const ATLAS_CREDIT = "Plays from the Workflow Atlas by Walid: 1,000 GTM workflows in 20 goals.";
const ATLAS_URL = "https://looot-gtm-atlas.walidboulanouar.chatgpt.site/";

/** "Your next plays": the 5 Atlas plays matched to this run, each with why it fits (one real finding), what
 * it produces, a price range from looot prices, Tell your agent and, only where Zeus has the command, Run it. */
/** atlasUrl: a same-origin URL the browse data is fetched from instead of inlined (the hosted page); left out, it is inlined so a page opened from disk still works. */
export function playsHtml(d: Pick<Dossier, "nextPlays" | "goal" | "playFits"> & Partial<Pick<Dossier, "sections" | "public">>, brand: string, domain = "yourdomain.com", atlasUrl?: string): string {
  const ps = d.nextPlays ?? [];
  const goal = OUTCOMES.find((o) => o.key === d.goal?.toLowerCase())?.label ?? d.goal;
  const cards = ps.map((p, n) => {
    const run = p.runCommand ? `<button type="button" class="za cp zrun-it" data-copy="${e(p.runCommand)}" title="Copies ${e(p.runCommand)}">Run it</button>` : "";
    const range = `$${p.lowUsd.toFixed(2)} to $${p.highUsd.toFixed(2)}`;
    return `<article class="card zg-card"><div class="zatl-h">${goalTile(p.goal)}<span class="chip">${e(p.goal)}</span><span class="chip zprice" title="${e(p.priceText)}">${e(range)}</span></div><h4 id="play-${e(String(p.id))}">${n + 1}. ${e(p.title)}</h4><p class="zwhy">${e(p.why)}</p><details class="zdet"><summary>Details</summary><dl><dt>Produces</dt><dd>${e(p.produces)}</dd><dt>Price</dt><dd>${e(p.priceText)}, capped at $${p.capUsd.toFixed(2)}</dd><dt>looot jobs</dt><dd>${e(p.jobs.join(", "))}</dd></dl></details><div class="zacts"><button type="button" class="za cp" data-copy="${e(p.prompt)}">Tell your agent</button>${run}</div></article>`;
  }).join("");
  const body = ps.length ? `<div class="zg-cards">${cards}</div>` : emptyState(`This run found nothing a play can be built on yet. Each play needs a real finding about ${brand}.`);
  const note = `<p class="src">${goal ? `Goal: ${e(goal)}. ` : ""}Each reason is one finding from this run. Tell your agent copies the request with the looot jobs and a budget; nothing runs without your yes. ${e(ATLAS_CREDIT)} <a href="${ATLAS_URL}" target="_blank" rel="noopener noreferrer">Open the Atlas</a></p>`;
  const hooks = hookCards(d, domain, ps.length, ps.map((p) => p.goal));
  const hooksHtml = hooks.length ? `<div class="sec" id="play-hooks"><div class="sech"><h3>Zeus can run these next</h3><span class="k">get more, keep it running, your own tools</span></div><p class="src">What your agent can do with Zeus after this run. Each one shows its price first and runs nothing without your yes. Schedules run in your own agent.</p><div class="zg-cards">${hooks.join("")}</div></div>` : "";
  return `${vhead({ id: "plays", label: PLAYS_TITLE, group: "Next" })}<div class="sec"><div class="sech"><h3>Picked for ${e(brand)}</h3><span class="k">top 5 from this run's findings</span></div>${note}${body}</div>${hooksHtml}${browseHtml(domain, units(ps), d.playFits, atlasUrl)}</section>`;
}

/** The short price on a card's chip; the full text is in its Details. */
const chipPrice = (p: string) => (/^\$0\b/.test(p) ? "$0" : /capped at (\$[\d.]+)/.test(p) && /^quoted first/.test(p) ? `up to ${p.match(/capped at (\$[\d.]+)/)![1]}` : p.replace(/, at most .*$/, "").replace(/ \(.*\)$/, "").replace(/^about /, ""));
/** Why each paid add is worth it, in the card's why line (the title is its paid.json "what"). */
const PAID_WHY: [RegExp, string][] = [
  [/--phones/, "Direct dials for the people who sign off, so your agent can call as well as write."],
  [/--people/, "Names, roles and work emails for every buyer at your best accounts. The free run stops at names and roles for 5."],
  [/--depth full/, "The free run keeps 25 accounts. A full run goes to 100 from the same brief, each scored and ranked."],
];

/** What more credit buys, as plays: the paid.json adds no hook already offers (people, phones, a deeper run). */
const PAID_PLAYS: { what: string; command: string; icon: string }[] = PAID.adds
  .filter((a) => !/\b(more|watch)\b/.test(a.command.split(" ")[1] ?? ""))
  .map((a) => ({ ...a, icon: /--people/.test(a.command) ? "Buying committees" : "Market sizing and ICP" }));

/** The old "Next steps your agent can offer" (next-steps.json hooks, looot-zeus#21) folded into "Your next plays":
 * the hooks no top play already covers, with the run's own why and price from the saved summary table, then
 * what a paid run adds. Same card as a play: icon, chip, price, title, why, details, Tell your agent, Run it. */
function hookCards(d: Partial<Pick<Dossier, "sections" | "public">>, domain: string, start: number, topGoals: string[]): string[] {
  const table = (d.sections ?? []).find((s) => s.id === "summary")?.blocks.find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table" && /^Next steps/.test(b.caption ?? ""));
  const rows = new Map<HookId, Record<string, unknown>>();
  for (const r of table?.rows ?? []) { const id = hookByTitle(String(r.title ?? "")); if (id) rows.set(id, r); }
  let n = start;
  const card = (icon: string, tag: string, price: string, title: string, why: string, when: string, prompt: string, command: string | null) => {
    n += 1;
    const run = command && !d.public ? `<button type="button" class="za cp zrun-h" data-copy="${e(command)}" title="Copies ${e(command)}">Run it</button>` : "";
    return `<article class="card zg-card"><div class="zatl-h">${goalTile(icon)}<span class="chip">${e(tag)}</span><span class="chip zprice" title="${e(price)}">${e(chipPrice(price))}</span></div><h4>${n}. ${e(title)}</h4><p class="zwhy">${e(why)}</p><details class="zdet"><summary>Details</summary><dl><dt>Price</dt><dd>${e(price)}</dd><dt>When</dt><dd>${e(when)}</dd>${command && !d.public ? `<dt>Command</dt><dd><code>${e(command)}</code></dd>` : ""}</dl></details><div class="zacts"><button type="button" class="za cp" data-copy="${e(prompt)}">Tell your agent</button>${run}</div></article>`;
  };
  const out = keptHooks(topGoals).filter((id) => rows.has(id)).map((id) => {
    const r = rows.get(id)!;
    const when = String(r.when ?? "once");
    return card(HOOKS[id].icon, HOOKS[id].tag, String(r.price ?? ""), HOOKS[id].title, String(r.why ?? ""), when === "once" ? "once" : `${when}, in your own agent's scheduler`, hookPrompt(id, domain), hookCommand(id, domain));
  });
  for (const a of PAID_PLAYS) {
    const cap = a.command.match(/--cap (\d+(?:\.\d+)?)/)?.[1];
    const command = `npx ${a.command}`;
    out.push(card(a.icon, "Paid run", cap ? `quoted first, capped at $${cap}` : "quoted first", a.what.replace(/ \(.*\)$/, "").replace(/: .*$/, ""), PAID_WHY.find(([r]) => r.test(a.command))?.[1] ?? a.what, "once", `In my ${domain} project folder, run \`${command}\`. ${ASK}`, command));
  }
  return out;
}

/** Each Atlas goal's menu icon key (kept for the left menu) and its one-line promise. The card icons are in goalIcons.ts. */
export const GOAL_META: Record<string, [string, string]> = {
  "Buying signals": ["hiring", "Catch accounts the moment they are ready to buy"],
  "Competitor displacement": ["competitive", "Win the customers your rivals are losing"],
  "Market sizing and ICP": ["mmap", "Know who to sell to and how many there are"],
  "Buying committees": ["committees", "Reach everyone who signs off on the deal"],
  "Pipeline and deal execution": ["targets", "Move open deals forward with fresh evidence"],
  "Inbound and product-led growth": ["openers", "Turn sign-ups and demo requests into pipeline"],
  "Outbound research": ["prospecting", "Write outreach that cites something real"],
  "CRM and data quality": ["crm", "Keep your CRM clean and current"],
  "Partnerships": ["share", "Find partners who already serve your buyers"],
  "SEO and AI search": ["geo", "Get found on Google and in AI answers"],
  "Paid media": ["formats", "Spend ad money where rivals are not"],
  "Expansion and renewals": ["refresh", "Grow and keep the customers you have"],
  "Local market opportunities": ["domains", "Find buyers near your locations"],
  "Commerce and distribution": ["pages", "Sell through more shops and marketplaces"],
  "Technical adoption": ["readiness", "Spot teams adopting the tech you work with"],
  "Events and communities": ["influencers", "Meet buyers where they gather"],
  "Market expansion": ["lookalikes", "Pick the next market and enter it with proof"],
  "GTM operations": ["runlog", "Run go-to-market like a system"],
  "Positioning and research": ["reddit", "Say what buyers actually care about"],
  "Data spend and reliability": ["calendar", "Pay less per usable record"],
};

const units = (ps: { units: number }[]) => ps[0]?.units ?? 10;

/** Every Atlas play to browse: the 20 goals as category cards, a click opens that goal's workflow cards, a
 * click on one opens its steps, providers, price, Tell your agent and Run it. Rendered in the page by a
 * small script from one inline JSON block (text only, no HTML in the data). Prices use the same formula
 * as the top 5 (matchPlays). */
function browseHtml(domain: string, n: number, fits: Record<string, number> = {}, atlasUrl?: string): string {
  const data = JSON.stringify({ ...(atlasUrl ? { src: atlasUrl } : atlasBrowseData()), domain, units: n, fits, meta: Object.fromEntries(Object.entries(GOAL_META).map(([g, [, promise]]) => [g, [goalSvg(g), promise, GOAL_ICONS[g]?.tone ?? "green"]])) }).replace(/</g, "\\u003c");
  return `<div class="sec" id="atlas-browse"><div class="sech"><h3>All plays by goal</h3><span class="k">1,000 workflows in 20 goals</span></div><div class="zatl"></div></div><script type="application/json" id="atlas-data">${data}</script><script>${BROWSE_JS}</script>`;
}

/** The goal browser script, inline on every city page; looot-pages hashes it into its CSP. */
export const BROWSE_JS = `(function(){var D=JSON.parse(document.getElementById('atlas-data').textContent),box=document.querySelector('#atlas-browse .zatl');
function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n}
function money(v){return v<0.01?'under $0.01':'$'+v.toFixed(2)}
function btn(label,copy){var b=el('button','za cp',label);b.type='button';b.setAttribute('data-copy',copy);return b}
function back(label,fn){var b=el('button','za',label);b.type='button';b.onclick=fn;var w=el('div','zacts');w.append(b);return w}
function cats(){box.replaceChildren();var g=el('div','zg-cards');D.goals.map(function(name,i){return{name:name,i:i,fit:D.fits[name]||0}}).sort(function(a,b){return b.fit-a.fit||a.i-b.i}).forEach(function(x){var n=D.plays.filter(function(p){return p[1]===x.i}).length,m=D.meta[x.name]||['',''];var a=el('article','card zg-card zatl-c');a.tabIndex=0;a.setAttribute('role','button');var h=el('div','zatl-h');var ic=el('span','zatl-i zgi-'+(m[2]||'green'));ic.innerHTML=m[0];h.append(ic,el('h4','',x.name));if(x.fit){var f=el('span','chip zfit',x.fit+' fit you');h.append(f)}a.append(h,el('p','',m[1]),el('p','src',n+' workflows'));a.onclick=function(){list(x.i)};a.onkeydown=function(ev){if(ev.key==='Enter')list(x.i)};g.append(a)});box.append(g)}
function list(i){box.replaceChildren(back('All goals',cats),el('h4','',D.goals[i]));var g=el('div','zg-cards');D.plays.filter(function(p){return p[1]===i}).forEach(function(p){var a=el('article','card zg-card zatl-c');a.tabIndex=0;a.setAttribute('role','button');var r=el('div','');p[5].forEach(function(k){r.append(el('span','chip',D.providers[k][0]),document.createTextNode(' '))});a.append(el('h4','',p[2]),r);a.onclick=function(){one(p)};a.onkeydown=function(ev){if(ev.key==='Enter')one(p)};g.append(a)});box.append(g)}
function one(p){var jobs=[],lo=0,hi=0;p[5].forEach(function(k){var v=D.providers[k];if(v[2]&&jobs.indexOf(v[2])<0){jobs.push(v[2]);lo+=v[3];hi+=v[4]}});lo*=D.units;hi*=D.units;var cap=Math.max(0.1,Math.ceil(hi*10)/10);
box.replaceChildren(back('Back to '+D.goals[p[1]],function(){list(p[1])}));var a=el('article','card zg-card');var cw=el('div','');cw.append(el('span','chip',D.goals[p[1]]));a.append(cw,el('h4','',p[2]));
var ol=el('ol','');ol.style.cssText='margin:4px 0;padding-left:20px;font-size:13.5px;line-height:1.5';p[5].forEach(function(k){var v=D.providers[k],li=el('li','');li.append(el('b','',v[0]+': '),document.createTextNode(v[1]+(v[2]?' (looot job '+v[2]+')':' (no looot job yet)')));ol.append(li)});
var dl=el('dl','');[['Decision rule',p[3]],['Produces',p[4]],['Price',jobs.length?'about '+money(lo)+' to '+money(hi)+' for '+D.units+' companies, capped at $'+cap.toFixed(2):'not runnable through looot yet']].forEach(function(x){dl.append(el('dt','',x[0]),el('dd','',x[1]))});
var acts=el('div','zacts');if(jobs.length)acts.append(btn('Tell your agent','Run this play for '+D.domain+' with looot: '+p[2]+' Decision rule: '+p[3]+' Use these looot jobs with fallback on: '+jobs.map(function(j){return 'job:'+j}).join(', ')+'. Then: '+p[4]+' Do it for '+D.units+' companies. Show me the price first and spend nothing without my yes. Budget $'+cap.toFixed(2)+', stop at it.'));var rc=D.run[D.goals[p[1]]];if(rc){var r=btn('Run it',rc);r.title='Copies '+rc;acts.append(r)}
a.append(ol,dl,acts);box.append(a)}
if(D.src){box.append(el('p','src','Loading the plays...'));fetch(D.src,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(x){D.goals=x.goals;D.plays=x.plays;D.providers=x.providers;cats()}).catch(function(){box.replaceChildren(el('p','src','The plays could not load. Reload the page to try again.'))})}else cats()})();`;

/** Export to CRM: copies the prompt for the user's agent. Private page only: a shared or public page never has it. */
export function crmButton(d: Pick<Dossier, "public" | "domain">): string {
  return d.public ? "" : `<button type="button" class="za cp zcrm" data-copy="${e(crmPrompt(d.domain))}">Export to CRM</button>`;
}

function paidHtml(): string {
  const items = PAID_ADDS.map((p) => `<li>${e(p.what)}<br><code>${e(p.command)}</code> <button type="button" class="cp xexp-b" data-copy="${e(p.command)}">Copy</button></li>`).join("");
  const soon = PAID_FEATURES.filter((f) => f.state === "coming-soon");
  const soonHtml = soon.length ? secHtml("Coming soon", "not in Zeus yet", `<ul>${soon.map((f) => `<li>${e(f.label)}</li>`).join("")}</ul>`) : "";
  return `${vhead({ id: "paid", label: "What a paid run adds", group: "More credit" })}<div class="sec zpaid"><p class="src">Every command prices its calls first and spends nothing without your yes and a cap.</p><ul>${items}</ul></div>${soonHtml}</section>`;
}

/** A menu entry: a view link with its count, a greyed unlock item that copies its prompt, or a share or copy action. */
/** Menu items a looot.page copy leaves out: its sections are removed there (people) or only the owner may use them (Share). */
export const SHARED_HIDDEN = new Set(["committees", "openers", "share"]);

function menuEntry(i: MenuItem, domain: string, isPublic: boolean, counts: Map<string, number>, totals: Map<string, number | undefined>, shared = false): string {
  if (shared && SHARED_HIDDEN.has(i.key)) return "";
  const icon = ICONS[i.key] ?? ICONS[i.view ?? ""] ?? "";
  const prompt = i.prompt.split("{domain}").join(domain);
  if (i.state === "unlock") return `<button type="button" class="zun cp" data-copy="${e(prompt)}" data-key="${e(i.key)}" data-tip="Greyed in the free run. Click to copy the request for your agent">${icon}<span class="mt">${e(i.label)}</span>${ICONS._lock ?? ""}</button>`;
  if (i.action === "copy") return `<button type="button" class="znb cp" data-copy="${e(prompt)}">${icon}<span class="mt">${e(i.label)}</span></button>`;
  if (i.action === "share") return isPublic ? `<button type="button" class="znb zshare">${icon}<span class="mt">${e(i.label)}</span></button>` : "";
  if (!i.view) return "";
  const n = counts.get(i.view);
  return `<a href="#${i.view}">${icon}<span class="mt">${e(i.label)}${i.sub ? `<small class="zsub">${e(i.sub)}</small>` : ""}</span>${n ? `<span class="n">${badgeText(n, totals.get(i.view))}</span>` : ""}</a>`;
}

/** Fills the {{key}} slots of the extracted city. Every value is escaped; a missing one is empty. */
function fill(tpl: string, m: Record<string, string>): string {
  return tpl.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => e(m[k] ?? ""));
}

const tableOf = (d: Dossier, sid: string, cap?: RegExp) => d.sections.find((s) => s.id === sid)?.blocks.find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table" && (!cap || cap.test(b.caption ?? "")));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-23" as "23 Nov", as on David's page. */
const dayLabel = (iso: string) => { const [, mo, dd] = iso.split("-").map(Number); return mo && dd ? `${dd} ${MONTHS[mo - 1]}` : iso; };

/** The city's labels from this run: account and rival names, counts and the not-yet buildings. */
function cityValues(d: Dossier, brand: string, domain: string, counts: Map<string, number>, foundAccounts?: number): Record<string, string> {
  const m: Record<string, string> = {};
  const pub = d.public;
  const b = (k: string, h: string, t: string, s: string) => { m[`b.${k}.h`] = `#${h}`; m[`b.${k}.t`] = t; m[`b.${k}.s`] = s; m[`b.${k}.i`] = t === "Open lot" ? "+" : pub && /^(acct|rv|home)/.test(k) ? (k.startsWith("acct") ? "A" : "R") : (t.trim()[0] ?? "").toUpperCase(); };
  const c = (k: string, h: string, t: string, s: string) => { m[`c.${k}.h`] = `#${h}`; m[`c.${k}.t`] = t; m[`c.${k}.s`] = s; };
  const accounts = (tableOf(d, "accounts")?.rows ?? []).map((r) => ({ name: String(maskValue(r.name ?? r.domain ?? "", undefined, pub)), grade: r.grade, score: r.score, industry: r.industry }));
  for (let i = 0; i < ISO.accounts; i++) {
    const a = accounts[i];
    if (a) b(`acct${i}`, "targets", a.name, `Target account${a.industry ? `. ${a.industry}` : ""}${a.grade ? `, grade ${a.grade}` : ""}${a.score != null ? `, fit ${a.score} of 100` : ""}.`);
    else b(`acct${i}`, "targets", "Open lot", "Room for another target account. See what a paid run adds.");
  }
  const rivalCards = d.sections.find((s) => s.id === "competitors")?.blocks.find((x): x is Extract<Block, { kind: "cards" }> => x.kind === "cards")?.items ?? [];
  const rivals = rivalCards.map((r) => ({ name: String(maskValue(r.title, undefined, pub)), site: String(maskValue((r as { logo?: string }).logo ?? "", undefined, pub)) }));
  for (let i = 0; i < ISO.rivals; i++) {
    const r = rivals[i];
    b(`rv${i}`, "competitive", r ? r.name : "Open lot", r ? "Rival. Open the competitive analysis." : "Room for another rival.");
  }
  for (let i = 0; i < ISO.homes; i++) {
    const r = rivals[i];
    b(`home${i}`, "competitive", r ? `${r.site || r.name} homepage` : "Billboard", r ? "Rival homepage, read for the rival cards." : "Room for another homepage.");
  }
  b("hq", "overview", `${brand} HQ`, domain);
  const social = counts.get("influencers") ?? 0;
  b("you", "influencers", `${brand} on social`, social ? `${plural(social, "post")} read from you and your rivals.` : "No social posts in this run.");
  const formats = counts.get("formats") ?? 0;
  b("formats", "formats", "Format studio", formats ? `${plural(formats, "format")} and plays to try.` : "No formats in this run.");
  c("formats", "formats", "Format studio", formats ? plural(formats, "format") : "None in this run");
  b("pages", "pages", "Programmatic pages", "No page drafts in the free run.");
  c("pages", "pages", "Programmatic pages", "No drafts in the free run");
  const r = tableOf(d, "receipt", /^Quoted and spent/);
  const stats = d.sections.find((s) => s.id === "receipt")?.blocks.find((x): x is Extract<Block, { kind: "stat" }> => x.kind === "stat")?.items ?? [];
  const spend = stats.find((s) => /spend/i.test(s.label))?.value ?? "";
  const calls = stats.find((s) => /calls/i.test(s.label))?.value ?? "";
  b("runlog", "runlog", "Run log and cost", spend ? `${spend} spent${calls ? ` on ${calls} paid calls` : ""}.` : "What the run cost.");
  b("sources", "runlog", "Sources", calls ? `${calls} paid looot calls behind the map.` : "The looot calls behind the map.");
  c("sources", "runlog", "Sources", calls ? `${calls} looot calls` : "The run log");
  const L = d.ledger;
  c("key", "runlog", "One looot key", L && L.runs ? `${plural(L.providers, "provider")}, ${plural(L.runs, "run")} on ${dayLabel(L.day)}` : r ? `${plural(r.rows.length, "section")} on one key${spend ? `, ${spend}` : ""}` : "Every call on one key");
  const seo = counts.get("seo") ?? 0;
  b("search", "seo", "Search plaza", seo ? `${plural(seo, "search row")} from Google.` : "No search data in this run.");
  c("search", "seo", "Search plaza", seo ? plural(seo, "search row") : "No search data");
  const share = tableOf(d, "seo", /^AI answer share/)?.rows ?? [];
  const you = share.find((x) => x.you === true || String(x.brand) === "You" || String(x.brand) === d.brand || String(x.brand).startsWith(`${d.brand} `));
  const top = share.filter((x) => x !== you).sort((a, z) => parseFloat(String(z.share)) - parseFloat(String(a.share)))[0];
  m["x.geoYou"] = you ? String(you.share) : "-";
  m["x.geoYouName"] = brand;
  m["x.geoTop"] = top ? String(top.share) : "-";
  m["x.geoTopName"] = top ? String(maskValue(top.brand, undefined, pub)) : "Top rival";
  b("geoYou", "geo", `${brand} in AI answers`, you ? `Named in ${you.share} of AI answers checked.` : "No AI answers checked in this run.");
  b("geoTop", "geo", `${m["x.geoTopName"]} in AI answers`, top ? `Named in ${top.share} of AI answers checked.` : "No AI answers checked in this run.");
  const comp = counts.get("competitive") ?? 0;
  b("activity", "competitive", "Rival activity", comp ? `${plural(comp, "rival row")} with sources.` : "No rival data in this run.");
  c("activity", "competitive", "Activity", rivals.length ? `What ${plural(rivals.length, "rival")} do` : "No rivals yet");
  c("rivals", "competitive", "Rivals", rivals.length ? `${plural(rivals.length, "rival")} measured. Hover for each` : "No rivals in this run");
  c("reach", "influencers", "Reach", social ? `${plural(social, "post")} read` : "No posts read");
  c("homepages", "competitive", "Homepages", rivals.length ? `${plural(rivals.length, "rival homepage")} read` : "None read");
  c("news", "influencers", "News", social ? "Posts from you and your rivals" : "No posts in this run");
  const nAcc = counts.get("targets") ?? accounts.length;
  c("buyers", "targets", "Buyers", nAcc ? `${plural(nAcc, "target account")}` : "No target accounts");
  // "found" counts every account the run found (before the ICP filter), as on David's map (20 found, 5 shown in the menu as 5/20).
  const found = foundAccounts ?? nAcc;
  m["x.accounts"] = String(found);
  m["x.accountsCap"] = found === 1 ? "account found" : "accounts found";
  const red = counts.get("reddit") ?? 0;
  b("reddit", "reddit", "Reddit", red ? `${plural(red, "mention")} read.` : "No mentions in this run.");
  c("reddit", "reddit", "Reddit", red ? plural(red, "mention") : "No mentions");
  const mm = counts.get("mmap") ?? 0;
  b("mmap", "mmap", "Market map", mm ? `${plural(mm, "player")} in the snapshot.` : "No market snapshot in this run.");
  c("mmap", "mmap", "Market map", mm ? plural(mm, "player") : "No snapshot");
  for (const f of ["guard", "brief", "signals", "crm", "campaign", "abm"]) {
    const feat = PAID_FEATURES.find((x) => x.key === f);
    const soon = feat?.state === "coming-soon";
    m[`f.${f}.h`] = "#paid";
    m[`f.${f}.t`] = soon ? feat!.label : feat?.district ?? "Room to grow";
    m[`f.${f}.s`] = soon ? "Coming soon" : feat?.district ? LOCKED_LINE : "See what a paid run adds";
  }
  m["x.aria"] = `Isometric city map of ${brand}. Each building opens a section.`;
  return m;
}

/** Builds the whole city page from an assembled dossier. Pure, no file or network access. */
export function renderCity(d: Dossier, o: { /** Hosted safe page of the user's own run: real brand and domain, people still masked. */ showBrand?: boolean; /** The looot.page copy (#24): a share header and a Build your own footer, and the owner's logo as a checked data: URI. */ share?: { logo?: string }; /** Fetch the Atlas browse data from this same-origin URL instead of inlining it (hosted zeus.looot.ai pages). */ atlasUrl?: string } = {}): string {
  // The run's own brand and domain are shown on every page, public included; only third parties are masked.
  const real = !d.public || o.showBrand !== false;
  const brand = real ? d.brand || d.domain : "Your brand";
  const domain = real ? d.domain : "yourdomain.com";
  const counts = new Map(CITY_VIEWS.map((v) => [v.id, countOf(viewBlocks(d, v).flatMap((p) => p.blocks))]));
  const totals = new Map(CITY_VIEWS.map((v) => [v.id, totalOf(viewBlocks(d, v).flatMap((p) => p.blocks))]));
  const committees = d.sections.find((x) => x.id === "committee");
  if (committees) counts.set("committees", countOf(committees.blocks));
  const nPlays = d.nextPlays?.length ?? 0;
  const nav = `<div class="ngroup solo"><div class="nav"><a href="#overview">${ICONS.overview ?? ""}<span class="mt">${e(brand)} City</span></a></div></div>` +
    MENU.map((c) => `<div class="ngroup zcat"><h6>${e(c.name)}</h6><div class="nav">${c.items.map((i) => menuEntry(i, domain, d.public, counts, totals, Boolean(o.share))).join("")}</div></div>`).join("") +
    `<div class="ngroup zcat"><h6>${e(GTM_OS.title)}</h6><div class="nav">${GTM_OS.items.map((i) => `<a href="#os">${ICONS._lock ?? ""}<span class="mt">${e(i.label)}<small class="zsub">Coming soon</small></span></a>`).join("")}<a href="#os">${ICONS.overview ?? ""}<span class="mt">${e(GTM_OS.next.label)}</span></a></div></div>` +
    `<div class="ngroup zcat"><h6>More credit</h6><div class="nav"><a href="#paid">${ICONS.runlog ?? ""}<span class="mt">What a paid run adds</span></a></div></div>` +
    // "Your next plays" is the last thing in the menu and on the page (Luisa, 2026-11-26).
    `<div class="ngroup zcat zplays-nav"><h6>Next</h6><div class="nav"><a href="#plays">${ICONS.formats ?? ICONS.overview ?? ""}<span class="mt">${PLAYS_TITLE}</span>${nPlays ? `<span class="n">${nPlays}</span>` : ""}</a></div></div>`;
  const date = (d.generatedAt ?? "").slice(0, 10);
  // The real logo, fetched by the run's safe asset fetch (assets.ts) and embedded as a data: URI. Shown on the public page too: it is the owner.
  // The owner's own logo is shown on its public page too; rival and account logos never are.
  const logoSrc = d.public && !real ? undefined : o.share ? o.share.logo : logoData(d.domain);
  const logo = logoSrc && /^data:image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(logoSrc) ? logoSrc : undefined;
  const side = `<aside class="side" aria-label="Sections"><div class="brand"><span class="logo">${logo ? `<img src="${e(logo)}" alt="" width="28" height="28">` : `<span class="lgt" aria-hidden="true">${e((brand.trim()[0] ?? "Z").toUpperCase())}</span>`}</span><b>${e(brand)}</b><small>looot Zeus, ${d.placeholder ? "example run" : "free run"}</small></div>${nav}<div class="sfoot">Built <b>${e(date)}</b><br>Data from looot runs. Each section says where it came from.</div></aside>`;
  // Buildings Zeus does not have yet are greyed and open the paid list, as David greys locked ones.
  const iso = fill(ISO_SVG, cityValues(d, brand, domain, counts, totals.get("targets"))).replace(/<a class="(is[al][^"]*)" href="#paid"/g, '<a class="$1 zoff" href="#paid"');
  const overStats = (d.overview?.blocks.find((x): x is Extract<Block, { kind: "stat" }> => x.kind === "stat")?.items ?? []).slice(0, 8);
  const VIEW_OF: Record<string, string> = { buyers: "targets", signals: "targets", ads: "competitive", social: "influencers", seo: "seo", receipt: "runlog" };
  const kgrid = overStats.length ? secHtml("The run in numbers", "", `<div class="kgrid">${overStats.map((s) => `<a class="kc" href="#${VIEW_OF[(s as { view?: string }).view ?? ""] ?? "overview"}"><div class="kc-top"><span class="kc-l">${e(s.label)}</span></div><div class="kc-mid"><span class="kval">${e(s.value)}</span></div><div class="kc-viz"><div class="kfoot">${e(s.hint ?? "")}</div></div></a>`).join("")}</div>`) : "";
  const flow = secHtml("What the free run made", plural(CITY_VIEWS.length, "part"), `<div class="v2flow">${CITY_VIEWS.map((v, i) => `<a class="flw" href="#${v.id}"><span class="fln">${i + 1}</span>${e(v.label)}${counts.get(v.id) ? `, ${counts.get(v.id)}` : ""}</a>`).join("")}</div>`);
  const playsCard = nPlays ? `<div class="sec ztop"><div class="ztop-m"><h3>${PLAYS_TITLE}</h3><p>${e(d.nextPlays!.slice(0, 3).map((p) => p.title.replace(/\.$/, "")).join(". "))}.</p></div><a class="ztop-b" href="#plays">See ${nPlays} plays</a></div>` : "";
  const paidCard = `<div class="sec ztop"><div class="ztop-m"><h3>What a paid run adds</h3><p>More accounts, people data, phones and a weekly re-run. Every command prices its calls first and spends nothing without your yes.</p></div><a class="ztop-b" href="#paid">See the list</a></div>`;
  const mark = logo ? `<img src="${e(logo)}" alt="" width="24" height="24">` : `<span class="lgt" aria-hidden="true">${e((brand.trim()[0] ?? "Z").toUpperCase())}</span>`;
  const shareHead = o.share ? `<div class="zsh"><span class="zsh-l">${mark}</span><b>${e(brand)}</b><span class="zsh-k">GTM map by Zeus</span><span class="zsh-d">${e(domain)}${date ? ` · ${e(dayLabel(date))} ${e(date.slice(0, 4))}` : ""}</span></div>` : "";
  const shareFoot = o.share ? `<div class="sec ztop zcta"><div class="ztop-m"><h3>Build your own</h3><p>Tell your agent: <code>run zeus.looot.ai for yourcompany.com</code>. The first run is free.</p></div><a class="ztop-b" href="${ZEUS_SHARED_URL}" target="_blank" rel="noopener noreferrer">Map my company</a></div>` : "";
  const overview = `<section class="view" data-view="overview" data-title="${e(brand)} City" data-group="Overview">${shareHead}<div class="vhead"><div><h1>${e(brand)} City</h1></div></div>${d.placeholder ? `<div class="note zslim" title="${e(d.placeholder)}">${e(d.placeholder)}</div>` : ""}${agentPill(actionsHtml(d, Boolean(o.share)) + crmButton(d))}<div class="sec iso-sec"><div class="sech"><h3>${e(brand)} City</h3><span class="k">hover a building, click to open it</span></div>${MASCOT_HTML}<div class="iso" data-iso data-roads="${e(JSON.stringify(ISO.roads))}">${iso}<div class="iso-tip" role="tooltip" hidden><div><b></b><span></span></div></div></div></div>${flow}${kgrid}${paidCard}${playsCard}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${e(brand)} City</title><script>${HEAD_JS}</script><style>${CITY_CSS}</style></head>
<body><div class="scrim"></div>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="zgrey"><feColorMatrix type="saturate" values="0"/></filter></svg>\n<div class="app">${side}
<main><div class="top"><div class="wrap"><button class="menu" type="button" aria-label="Open menu"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><div class="tl"><div class="crumb" id="vtitle">${e(brand)} City</div><div class="hl" id="vgroup">Overview</div></div><span class="date">${e(domain)}${date ? `, ${e(date)}` : ""}</span></div></div><div class="wrap">
${overview}
${CITY_VIEWS.map((v) => viewHtml(d, v, Boolean(o.share))).join("\n")}
${osHtml(brand, domain, counts)}
${paidHtml()}
${playsHtml(d, brand, domain, o.atlasUrl)}
${shareFoot}</div></main></div><script>${CITY_JS}</script></body></html>
`;
}

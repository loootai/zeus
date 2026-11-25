// The city page: one self-contained HTML file (inline CSS and JS, no network, no server) built from
// the same assembled dossier as dossier.html. Pure: a Dossier in, a string out. The look is David's
// hand-built Higgsfield city (city/index.html): the shell (styles, isometric city, router) is extracted
// into ./shell by build/extract_city_shell.py and filled here with this run's data only.
import { escapeHtml as e } from "../util.js";
import type { Block, Section } from "../dossier/blocks.js";
import type { Dossier } from "../dossier/index.js";
import { maskValue } from "../dossier/mask.js";
import { emptyState, renderBlock } from "./blocks.js";
import { CITY_CSS } from "./style.js";
import { CITY_JS } from "./script.js";
import { readFileSync } from "node:fs";

const readJson = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));

/** One item of the left menu. menu.json is the single source, shared with the hosted example page (build/make_hf.py). */
export interface MenuItem { key: string; label: string; state: "free" | "unlock"; prompt: string; usd: number; view?: string; sub?: string; recipe?: string; action?: "share" | "copy" }
export interface MenuCategory { name: string; items: MenuItem[] }
/** The menu categories in order. The build copies menu.json next to this file. */
export const MENU: MenuCategory[] = readJson("./menu.json").categories;

/** What more credit buys (commands Zeus has today) and the city's not-yet features, from paid.json. */
export interface PaidFeature { key: string; label: string; state: "off" | "coming-soon" }
const PAID: { adds: { what: string; command: string }[]; features: PaidFeature[] } = readJson("./paid.json");
/** What more credit buys, each one a command Zeus has today. Nothing here is a feature Zeus lacks. */
export const PAID_ADDS = PAID.adds;
/** Buildings for features Zeus does not have yet. Only "coming-soon" ones are named on the page. */
export const PAID_FEATURES = PAID.features;

const ISO_SVG = readFileSync(new URL("./shell/iso.svg", import.meta.url), "utf8");
const ISO: { roads: number[][]; accounts: number; homes: number; rivals: number } = readJson("./shell/iso.json");
const ICONS: Record<string, string> = readJson("./shell/icons.json");

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

const isAi = (b: Block) => b.kind === "table" && /^AI answer/i.test(b.caption ?? "");

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
export function agentPill(): string {
  return `<div class="obar"><span class="tryl zcmd"><span>Make yours, tell your agent</span><code>${e(AGENT_ONE_LINER)}</code></span><button type="button" class="cp xexp-b" data-copy="${e(AGENT_ONE_LINER)}">Copy</button></div><p class="zdev src">For developers: <code>${e(DEV_COMMAND)}</code></p>`;
}

/** Share, fork it, tell your agent and powered by looot. Share shows on public (safe) pages only: a private page stays on your machine. */
export function actionsHtml(d: Pick<Dossier, "public">): string {
  const share = d.public ? `<button type="button" class="za zshare">Share</button>` : "";
  return `<div class="zacts">${share}<a class="za" href="${ZEUS_REPO_URL}" target="_blank" rel="noopener noreferrer">Fork it</a><button type="button" class="za cp" data-copy="${e(TELL_YOUR_AGENT)}">Tell your agent</button><div class="zpow"><a class="zplk" href="https://looot.ai" target="_blank" rel="noopener noreferrer" aria-label="Powered by looot"><span class="zlp">powered by</span><svg class="zlm" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><circle cx="5.6" cy="16" r="4.1" fill="none" stroke="rgb(0,147,98)" stroke-width="2.6"/><defs><pattern id="zlbars" patternUnits="userSpaceOnUse" x="0" y="9" width="32" height="3.027"><rect width="32" height="1.892" fill="rgb(0,147,98)"/></pattern></defs><circle cx="16" cy="16" r="5.4" fill="none" stroke="url(#zlbars)" stroke-width="3.2"/><circle cx="26.4" cy="16" r="4.1" fill="none" stroke="rgb(0,147,98)" stroke-width="2.6"/></svg><span class="zlw">looot</span></a><a class="zpb" href="https://looot.ai" target="_blank" rel="noopener noreferrer">Build your own</a></div></div>`;
}

function viewBlocks(d: Dossier, v: CityView): { section: Section; blocks: Block[] }[] {
  const out: { section: Section; blocks: Block[] }[] = [];
  for (const id of v.ids) {
    const s = id === "receipt" ? d.sections.find((x) => x.id === "receipt") ?? d.sections[d.sections.length - 1] : d.sections.find((x) => x.id === id);
    if (!s) continue;
    const blocks = v.pick ? (s.blocks ?? []).filter(v.pick) : s.blocks ?? [];
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

const secHtml = (title: string, k: string, body: string, id = "") => `<div class="sec"${id ? ` id="${id}"` : ""}><div class="sech"><h3>${e(title)}</h3>${k ? `<span class="k">${e(k)}</span>` : ""}</div>${body}</div>`;
const vhead = (v: { id: string; label: string; group: string }) => `<section class="view" data-view="${v.id}" data-title="${e(v.label)}" data-group="${e(v.group)}"><div class="vhead"><div><div class="kicker">${e(v.group)}</div><h1>${e(v.label)}</h1></div></div>`;

function viewHtml(d: Dossier, v: CityView): string {
  const parts = viewBlocks(d, v);
  let body = parts.length === 0 ? emptyState(v.empty) : parts.map(({ section, blocks }) => secHtml(section.title, section.source ? `${section.status} · ${section.source}` : "", blocks.map((b) => renderBlock(b, d.public)).join(""))).join("");
  if (v.id === "targets") {
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

function paidHtml(): string {
  const items = PAID_ADDS.map((p) => `<li>${e(p.what)}<br><code>${e(p.command)}</code> <button type="button" class="cp xexp-b" data-copy="${e(p.command)}">Copy</button></li>`).join("");
  const soon = PAID_FEATURES.filter((f) => f.state === "coming-soon");
  const soonHtml = soon.length ? secHtml("Coming soon", "not in Zeus yet", `<ul>${soon.map((f) => `<li>${e(f.label)}</li>`).join("")}</ul>`) : "";
  return `${vhead({ id: "paid", label: "What a paid run adds", group: "More credit" })}<div class="sec zpaid"><p class="src">Every command prices its calls first and spends nothing without your yes and a cap.</p><ul>${items}</ul></div>${soonHtml}</section>`;
}

/** A menu entry: a view link with its count, a greyed unlock item that copies its prompt, or a share or copy action. */
function menuEntry(i: MenuItem, domain: string, isPublic: boolean, counts: Map<string, number>): string {
  const icon = ICONS[i.key] ?? ICONS[i.view ?? ""] ?? "";
  const prompt = i.prompt.split("{domain}").join(domain);
  if (i.state === "unlock") return `<button type="button" class="zun cp" data-copy="${e(prompt)}" data-tip="Greyed in the free run. Click to copy the request for your agent">${icon}<span class="mt">${e(i.label)}</span>${ICONS._lock ?? ""}</button>`;
  if (i.action === "copy") return `<button type="button" class="znb cp" data-copy="${e(prompt)}">${icon}<span class="mt">${e(i.label)}</span></button>`;
  if (i.action === "share") return isPublic ? `<button type="button" class="znb zshare">${icon}<span class="mt">${e(i.label)}</span></button>` : "";
  if (!i.view) return "";
  const n = counts.get(i.view);
  return `<a href="#${i.view}">${icon}<span class="mt">${e(i.label)}${i.sub ? `<small class="zsub">${e(i.sub)}</small>` : ""}</span>${n ? `<span class="n">${n}</span>` : ""}</a>`;
}

/** Fills the {{key}} slots of the extracted city. Every value is escaped; a missing one is empty. */
function fill(tpl: string, m: Record<string, string>): string {
  return tpl.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => e(m[k] ?? ""));
}

const tableOf = (d: Dossier, sid: string, cap?: RegExp) => d.sections.find((s) => s.id === sid)?.blocks.find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table" && (!cap || cap.test(b.caption ?? "")));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The city's labels from this run: account and rival names, counts and the not-yet buildings. */
function cityValues(d: Dossier, brand: string, domain: string, counts: Map<string, number>): Record<string, string> {
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
  c("key", "runlog", "One looot key", r ? `${plural(r.rows.length, "section")} on one key${spend ? `, ${spend}` : ""}` : "Every call on one key");
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
  m["x.accounts"] = String(nAcc);
  m["x.accountsCap"] = nAcc === 1 ? "account found" : "accounts found";
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
    m[`f.${f}.t`] = soon ? feat!.label : "Room to grow";
    m[`f.${f}.s`] = soon ? "Coming soon" : "See what a paid run adds";
  }
  m["x.aria"] = `Isometric city map of ${brand}. Each building opens a section.`;
  return m;
}

/** Builds the whole city page from an assembled dossier. Pure, no file or network access. */
export function renderCity(d: Dossier): string {
  const brand = d.public ? "Your brand" : d.brand || d.domain;
  const domain = d.public ? "yourdomain.com" : d.domain;
  const counts = new Map(CITY_VIEWS.map((v) => [v.id, countOf(viewBlocks(d, v).flatMap((p) => p.blocks))]));
  const committees = d.sections.find((x) => x.id === "committee");
  if (committees) counts.set("committees", countOf(committees.blocks));
  const nav = `<div class="ngroup solo"><div class="nav"><a href="#overview">${ICONS.overview ?? ""}<span class="mt">${e(brand)} City</span></a></div></div>` +
    MENU.map((c) => `<div class="ngroup zcat"><h6>${e(c.name)}</h6><div class="nav">${c.items.map((i) => menuEntry(i, domain, d.public, counts)).join("")}</div></div>`).join("") +
    `<div class="ngroup zcat"><h6>More credit</h6><div class="nav"><a href="#paid">${ICONS.runlog ?? ""}<span class="mt">What a paid run adds</span></a></div></div>`;
  const date = (d.generatedAt ?? "").slice(0, 10);
  const side = `<aside class="side" aria-label="Sections"><div class="brand"><span class="logo"><span class="lgt" aria-hidden="true">${e((brand.trim()[0] ?? "Z").toUpperCase())}</span></span><b>${e(brand)}</b><small>looot Zeus, ${d.placeholder ? "example run" : "free run"}</small></div>${nav}<div class="sfoot">Built <b>${e(date)}</b><br>Data from looot runs. Each section says where it came from.</div></aside>`;
  // Buildings Zeus does not have yet are greyed and open the paid list, as David greys locked ones.
  const iso = fill(ISO_SVG, cityValues(d, brand, domain, counts)).replace(/<a class="(is[al][^"]*)" href="#paid"/g, '<a class="$1 zoff" href="#paid"');
  const overStats = (d.overview?.blocks.find((x): x is Extract<Block, { kind: "stat" }> => x.kind === "stat")?.items ?? []).slice(0, 8);
  const VIEW_OF: Record<string, string> = { buyers: "targets", signals: "targets", ads: "competitive", social: "influencers", seo: "seo", receipt: "runlog" };
  const kgrid = overStats.length ? secHtml("The run in numbers", "", `<div class="kgrid">${overStats.map((s) => `<a class="kc" href="#${VIEW_OF[(s as { view?: string }).view ?? ""] ?? "overview"}"><div class="kc-top"><span class="kc-l">${e(s.label)}</span></div><div class="kc-mid"><span class="kval">${e(s.value)}</span></div><div class="kc-viz"><div class="kfoot">${e(s.hint ?? "")}</div></div></a>`).join("")}</div>`) : "";
  const flow = secHtml("What the free run made", plural(CITY_VIEWS.length, "part"), `<div class="v2flow">${CITY_VIEWS.map((v, i) => `<a class="flw" href="#${v.id}"><span class="fln">${i + 1}</span>${e(v.label)}${counts.get(v.id) ? `, ${counts.get(v.id)}` : ""}</a>`).join("")}</div>`);
  const next = tableOf(d, "summary", /^Next steps/);
  const nextHtml = next && next.rows.length ? secHtml("Next steps your agent can offer", "nothing runs without your yes", renderBlock({ ...next, caption: undefined }, d.public)) : "";
  const paidCard = `<div class="sec ztop"><div class="ztop-m"><h3>What a paid run adds</h3><p>More accounts, people data, phones and a weekly re-run. Every command prices its calls first and spends nothing without your yes.</p></div><a class="ztop-b" href="#paid">See the list</a></div>`;
  const overview = `<section class="view" data-view="overview" data-title="${e(brand)} City" data-group="Overview"><div class="vhead"><div><h1>${e(brand)} City</h1></div></div>${d.placeholder ? `<div class="note">${e(d.placeholder)}</div>` : ""}${agentPill()}${actionsHtml(d)}<div class="sec iso-sec"><div class="sech"><h3>${e(brand)} City</h3><span class="k">hover a building, click to open it</span></div><div class="iso" data-iso data-roads="${e(JSON.stringify(ISO.roads))}">${iso}<div class="iso-tip" role="tooltip" hidden><div><b></b><span></span></div></div></div></div>${flow}${kgrid}${paidCard}${nextHtml}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${e(brand)} City</title><style>${CITY_CSS}</style></head>
<body><div class="scrim"></div>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="zgrey"><feColorMatrix type="saturate" values="0"/></filter></svg>\n<div class="app">${side}
<main><div class="top"><div class="wrap"><button class="menu" type="button" aria-label="Open menu"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><div class="tl"><div class="crumb" id="vtitle">${e(brand)} City</div><div class="hl" id="vgroup">Overview</div></div><span class="date">${e(domain)}${date ? `, ${e(date)}` : ""}</span></div></div><div class="wrap">
${overview}
${CITY_VIEWS.map((v) => viewHtml(d, v)).join("\n")}
${paidHtml()}
</div></main></div><script>${CITY_JS}</script></body></html>
`;
}

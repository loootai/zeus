// The shared looot.page story (Direction A, "Cinematic city", Luisa 2026-11-26): a full-bleed dark city
// with the company name and four stat chips pinned to the buildings their numbers come from, one big
// number per finding tied to its district, "Your next GTM moves", and a "Get your own GTM engine" end card. Only
// the looot.page copy (renderCity with o.share) gets it; the private city page is unchanged.
//
// Every number comes from the public dossier the page is built from (already masked: Rival 1, Account A,
// no people). A finding with no data is left out, never shown as 0. Every value is escaped. No style
// attribute is written: chip positions are classes, so looot-pages' CSP needs only these two hashes.
import { escapeHtml as e } from "../util.js";
import type { Block } from "../dossier/blocks.js";
import type { Dossier } from "../dossier/index.js";
import { readFileSync } from "node:fs";
import { playUrl } from "../plays/index.js";

// David's Zeus mascot, placed once on the shared page: in the end card, beside the small city he throws his bolt at.
// His clips (idle, throw) are served by looot-pages itself (GET /zeus/<clip>.webm) and allowed by media-src for that
// origin only. Without a clip origin the page carries no <video>: mascot.js then shows his still with the CSS bob and
// the SVG bolt (David's own fallback). Reduced motion: mascot.js shows the still only.
const MASCOT_SRC = readFileSync(new URL("./shell/mascot.html", import.meta.url), "utf8").trim();
const CLIP_BASE = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/;
/** The mascot markup: clips from `clipBase` + /zeus/, or none. */
export function mascotHtml(clipBase?: string): string {
  return clipBase && CLIP_BASE.test(clipBase) ? MASCOT_SRC.replaceAll("{{zeus}}", `${clipBase}/zeus/`) : MASCOT_SRC.replace(/<video\b[^>]*><\/video>/g, "");
}

/** One finding: its big number, the chip text, its row on the page and the district it lives in. */
export interface StoryFact {
  id: "buyers" | "ai" | "keywords" | "ads" | "posts" | "readiness";
  /** The big number as shown ("21", "8,100", "20"). */
  big: string;
  /** Small text after the big number ("vs 0", "/100"), or "". */
  after: string;
  /** The chip and Open Graph label under the number. */
  label: string;
  /** The district tag on the row. */
  tag: string;
  head: string;
  body: string;
  /** The result in a few words, for the subtitle and the Open Graph card ("21 companies to sell to"). */
  outcome: string;
  /** One sentence: what to do next with it. */
  next: string;
  /** The city view the row opens. */
  view: string;
  tone: "green" | "amber" | "pink" | "blue" | "violet";
}

type Stat = { label: string; value: string; hint?: string };
type Bar = { label: string; value: number; display?: string };

const blocksOf = (d: Pick<Dossier, "sections" | "overview">, id: string): Block[] => (id === "overview" ? d.overview?.blocks : d.sections.find((s) => s.id === id)?.blocks) ?? [];
const stats = (bs: Block[]): Stat[] => bs.flatMap((b) => (b.kind === "stat" ? (b.items as Stat[]) : []));
const statOf = (bs: Block[], label: RegExp) => stats(bs).find((s) => label.test(s.label));
const barsOf = (bs: Block[], caption: RegExp): Bar[] => (bs.find((b) => b.kind === "bars" && caption.test(b.caption ?? "")) as { items?: Bar[] } | undefined)?.items ?? [];
const textOf = (bs: Block[]) => bs.filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text").map((b) => b.text).join(" ");
const int = (s: unknown) => { const m = String(s ?? "").match(/^\s*(\d[\d,]*)\s*$/); return m ? Number(m[1].replace(/,/g, "")) : undefined; };
const fmt = (n: number) => n.toLocaleString("en-US");
const are = (n: number) => (n === 1 ? "is" : "are");

/** The findings this run supports, in page order. A finding with no data in the run is left out. */
export function storyFacts(d: Pick<Dossier, "sections" | "overview">, brand: string): StoryFact[] {
  const out: StoryFact[] = [];
  const ov = blocksOf(d, "overview");

  const accounts = int(statOf(ov, /^Target accounts$/)?.value);
  if (accounts) {
    const g = Object.fromEntries(stats(blocksOf(d, "accounts")).filter((s) => /^Grade [A-D]$/.test(s.label)).map((s) => [s.label.slice(-1), int(s.value) ?? 0]));
    const a = g.A ?? int(statOf(ov, /^Target accounts$/)?.hint?.match(/^(\d+) grade A/)?.[1]) ?? 0;
    const grades = ["A", "B", "C", "D"].filter((k) => g[k]).map((k) => `${g[k]} ${k}`);
    const committees = int(statOf(ov, /^Buying committees$/)?.value) ?? 0;
    out.push({
      id: "buyers", big: fmt(accounts), after: "", label: a ? `companies to sell to · ${a} best fit` : "companies to sell to", tag: "Who to sell to", view: "targets", tone: "green",
      outcome: `${fmt(accounts)} ${accounts === 1 ? "company" : "companies"} to sell to`,
      next: a ? `Next: start outreach with the ${a} best-fit ${a === 1 ? "company" : "companies"}.` : "Next: start outreach with the highest-scored companies.",
      head: `${fmt(accounts)} ${accounts === 1 ? "company fits" : "companies fit"} what ${brand} sells.${a ? ` ${a} ${are(a)} the best fit.` : ""}`,
      body: `Scored on size, industry and fit${grades.length ? `: ${grades.join(", ")}` : ""}.${committees ? ` The people who decide are mapped at ${committees} of them; names stay off this page.` : ""}`,
    });
  }

  // AI answers only when the run measured them: "not measured" is never shown as 0%.
  // seo.ts writes it as "N of M" answers (or "not measured"); a percent is accepted too.
  const aiv = String(statOf(blocksOf(d, "seo"), /^AI answers naming you$/)?.value ?? "");
  const aiOf = aiv.match(/^(\d+) of (\d+)$/);
  const ai = aiOf ? (Number(aiOf[2]) > 0 && Number(aiOf[1]) <= Number(aiOf[2]) ? String(Math.round((Number(aiOf[1]) / Number(aiOf[2])) * 100)) : undefined) : aiv.match(/^(\d{1,3})%$/)?.[1];
  if (ai !== undefined && Number(ai) <= 100) {
    const pct = Number(ai);
    out.push({
      id: "ai", big: `${pct}%`, after: "", label: `of AI answers name ${brand}`, tag: "Where you can win on AI search", view: "geo", tone: "amber",
      outcome: pct === 0 ? "AI answers to get into" : `${pct}% of AI answers naming ${brand}`,
      next: "Next: publish pages that answer the questions buyers ask AI assistants.",
      head: pct === 0 ? `AI answers never name ${brand}. Yet.` : `AI answers name ${brand} ${pct}% of the time.`,
      body: aiOf ? `${aiOf[1]} of ${aiOf[2]} answers to buyer questions name ${brand}, asked to AI assistants in this run.` : "Buyer questions asked to AI assistants in this run, and who the answers name.",
    });
  }

  const seo = blocksOf(d, "seo");
  const gap = barsOf(seo, /^Keyword gaps by monthly searches/).filter((b) => b.value > 0).sort((x, y) => y.value - x.value)[0];
  if (gap) {
    const gaps = int(statOf(seo, /^Keyword gaps$/)?.value) ?? 1;
    const ranks = statOf(seo, /^Keywords you rank on$/)?.value;
    out.push({
      id: "keywords", big: fmt(gap.value), after: "", label: "searches a month to win", tag: "Where you can win on Google", view: "seo", tone: "amber",
      outcome: `a keyword with ${fmt(gap.value)} searches a month to win`,
      next: "Next: publish a page that answers this search.",
      head: `"${gap.label}" gets ${fmt(gap.value)} searches a month. A rival ranks for it, ${brand} does not.`,
      body: `${gaps > 1 ? `${gaps} keyword gaps like it in this run.` : "The biggest keyword gap in this run."}${ranks && /^\d+ of \d+$/.test(ranks) ? ` ${brand} is in Google's top 10 on ${ranks} keywords checked.` : ""}`,
    });
  }

  const ads = barsOf(ov, /^Live ads, you and each rival/);
  const you = ads.find((b) => /\(you\)$/.test(b.label));
  const rival = ads.filter((b) => /^Rival \d+$/.test(b.label)).sort((x, y) => y.value - x.value)[0];
  // A failed or skipped lookup of your own ads is counted as 0 in the dossier: then "runs none" is not measured, so the finding is left out.
  const lookups = (blocksOf(d, "ads").find((b) => b.kind === "table" && b.caption === "Lookups") as { rows?: Record<string, unknown>[] } | undefined)?.rows ?? [];
  const youName = you?.label.replace(/ \(you\)$/, "");
  const youRow = lookups.find((r) => String(r.who ?? "") === youName);
  const youMeasured = Boolean(youRow) && !/\b(fail|failed|error|skipped|skip|capped|not run)\b/i.test(String(youRow?.lookups ?? ""));
  if (you && rival && youMeasured && rival.value > you.value) {
    const miss = statOf(ov, /^Ad angles you miss$/);
    const missN = int(miss?.value) ?? 0;
    const open = int(miss?.hint?.match(/^(\d+) nobody runs yet/)?.[1]) ?? 0;
    out.push({
      id: "ads", big: fmt(rival.value), after: `vs ${fmt(you.value)}`, label: `rival ads vs ${brand}'s`, tag: "What your rivals advertise", view: "competitive", tone: "pink",
      outcome: `${fmt(rival.value)} rival ads to answer`,
      next: open ? "Next: test one of the messages nobody uses yet in a small ad." : "Next: test the rivals' strongest message in a small ad.",
      head: `A rival runs ${fmt(rival.value)} live ads. ${brand} runs ${you.value === 0 ? "none" : fmt(you.value)}.`,
      body: `${missN ? `Rivals' ads use ${missN} ${missN === 1 ? "message" : "messages"} that ${brand}'s do not.` : "Every live ad read from the public ad libraries."}${open ? ` ${open} ${open === 1 ? "message" : "messages"} nobody uses yet.` : ""}`,
    });
  }

  const mt = textOf(blocksOf(d, "mentions"));
  const posts = int(mt.match(/(\d[\d,]*) buying-intent posts?/)?.[1]);
  if (posts) {
    const m = mt.match(/(\d[\d,]*) mentions? in (\d+) days?/);
    out.push({
      id: "posts", big: fmt(posts), after: "", label: "posts asking for a tool", tag: "People asking for a tool like yours", view: "reddit", tone: "blue",
      outcome: `${fmt(posts)} ${posts === 1 ? "post" : "posts"} asking for a tool like ${brand}'s`,
      next: "Next: reply to these posts while they are fresh.",
      head: `${fmt(posts)} ${posts === 1 ? "post asks" : "posts ask"} for a tool in ${brand}'s space${m ? ` in ${m[2]} days` : ""}.`,
      body: `${m ? `Out of ${m[1]} mentions read. ` : ""}A post counts when it asks for a tool, compares tools or complains about one.`,
    });
  }

  const ready = barsOf(blocksOf(d, "readiness"), /^Agent readiness score/).find((b) => b.label === "You");
  if (ready && Number.isFinite(ready.value)) {
    const s = Math.round(ready.value);
    const hm = textOf(blocksOf(d, "readiness")).match(/(\d+) of (\d+) rivals score higher/);
    out.push({
      id: "readiness", big: String(s), after: "/100", label: "ready for AI agents", tag: "Ready for AI agents", view: "readiness", tone: "violet",
      outcome: `a site AI agents can use (${s}/100)`,
      next: s >= 80 ? "Next: keep it there as the site changes." : "Next: open the full results for the list of fixes.",
      head: `${brand}'s site scores ${s} out of 100 for AI agents.`,
      body: `How easily AI agents such as ChatGPT or Claude can read and use the site, on looot's 0 to 100 scale.${hm ? (hm[1] === "0" ? ` None of the ${hm[2]} rivals checked scores higher.` : ` ${hm[1]} of the ${hm[2]} rivals checked score higher.`) : ""}`,
    });
  }
  return out;
}

/** The three results the subtitle and the Open Graph card name: who to sell to, where to win, rival ads, then the rest. */
export function topOutcomes(facts: StoryFact[]): StoryFact[] {
  const order: StoryFact["id"][] = ["buyers", "keywords", "ai", "ads", "posts", "readiness"];
  return order.map((id) => facts.find((f) => f.id === id)).filter((f): f is StoryFact => Boolean(f)).filter((f, i, a) => !(f.id === "ai" && a.some((x) => x.id === "keywords"))).slice(0, 3);
}

/** The four hero chips: buyers, ads, posts and readiness first, then search. */
export function heroFacts(facts: StoryFact[]): StoryFact[] {
  const order: StoryFact["id"][] = ["buyers", "ads", "posts", "readiness", "ai", "keywords"];
  const picked: StoryFact[] = [];
  for (const id of order) { const f = facts.find((x) => x.id === id); if (f && picked.length < 4 && !(id === "keywords" && picked.some((p) => p.id === "ai"))) picked.push(f); }
  return picked;
}

/**
 * The city art without its labels, links, tooltips or background: for the hero and the Open Graph image.
 * Buildings stay (with their build-in classes); every callout, number and text goes. Its viewBox is the
 * market quarter, where the buyers, search, billboards and HQ stand.
 */
export const HERO_VIEWBOX = "30 170 1040 600";
export function cleanCity(filledIso: string): string {
  return filledIso
    .replace(/<a class="isl"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<text\b[\s\S]*?<\/text>/g, "")
    // Logo pins (a stem and a white disc that holds a letter or logo in the explorer) and any image.
    .replace(/<line [^>]*stroke="#6E8AA6" stroke-width="1\.5"\/><circle [^>]*fill="#fff" stroke="#0E1621" stroke-width="2"\/>/g, "")
    .replace(/<image\b[^>]*\/?>(?:<\/image>)?/g, "")
    .replace(/<rect y="-680" width="1100" height="1470" fill="url\(#isoBg\)"\/>/, "")
    .replace(/<a\b([^>]*)>/g, (_, attrs: string) => `<g${attrs.match(/ class="[^"]*"/)?.[0] ?? ""}>`)
    .replace(/<\/a>/g, "</g>")
    .replace(/<svg class="iso-svg" viewBox="[^"]*"[^>]*>/, `<svg class="zs-svg" viewBox="${HERO_VIEWBOX}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "26 Nov 2026" from an ISO time, or "". */
export function storyDate(iso?: string): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** The big number, its count-up span and the small text after it. */
const bigHtml = (f: StoryFact) => `<span class="zs-n">${e(f.big)}</span>${f.after ? `<small>${e(f.after)}</small>` : ""}`;

export interface StoryInput {
  d: Pick<Dossier, "sections" | "overview" | "nextPlays" | "ledger" | "generatedAt">;
  brand: string;
  domain: string;
  /** The cleaned city SVG (cleanCity). */
  city: string;
  /** The checked logo data: URI, or undefined. */
  logo?: string;
  /** Where Build your own points (utm-tagged, already escaped for an attribute). */
  zeusUrl: string;
  /** The road lines of the iso template, for the light pulses. */
  roads?: number[][];
  /** The https origin that serves the mascot clips (looot-pages), or none for the still only. */
  clipBase?: string;
}

/** The whole shared page body: the story (hero, findings, plays, full-map links) and the end card. */
export function storyHtml(s: StoryInput): { top: string; end: string } {
  const { d, brand, domain } = s;
  const facts = storyFacts(d, brand);
  const hero = heroFacts(facts);
  const date = storyDate(d.generatedAt);
  const mark = s.logo ? `<img src="${e(s.logo)}" alt="" width="22" height="22">` : `<span class="zs-lt" aria-hidden="true">${e((brand.trim()[0] ?? "Z").toUpperCase())}</span>`;
  const runs = typeof d.ledger?.runs === "number" && Number.isInteger(d.ledger.runs) && d.ledger.runs > 0 ? d.ledger.runs : undefined;
  const charged = typeof d.ledger?.charged === "number" && Number.isFinite(d.ledger.charged) && d.ledger.charged >= 0 ? d.ledger.charged : undefined;
  const outs = topOutcomes(facts).map((f) => `<em>${e(f.outcome)}</em>`);
  const list = outs.length > 1 ? `${outs.slice(0, -1).join(", ")} and ${outs.at(-1)}` : outs[0] ?? "";
  const from = runs && charged !== undefined ? ` from ${e(fmt(runs))} data calls ($${e(charged.toFixed(2))})` : "";
  const sub = list ? `Zeus built ${e(brand)} a GTM engine${from}: ${list}.` : `Zeus built ${e(brand)} a GTM engine${from}.`;
  // The owner's private city on zeus.looot.ai (Sign in with looot, their workspace only). The domain is the checked run domain.
  const owner = `https://zeus.looot.ai/p/${e(encodeURIComponent(domain))}`;
  const nameSize = brand.length <= 6 ? "l" : "m";
  const pins = hero.map((f) => `<div class="zs-pin p-${f.id} t-${f.tone}"><i class="zs-dot" aria-hidden="true"></i><div class="zs-chip"><b>${bigHtml(f)}</b><em>${e(f.label)}</em></div></div>`).join("");
  const top = `<div class="zs" id="top">
<header class="zs-bar"><div class="zs-who zs-shim"><span class="zs-mk">${mark}</span><b>${e(brand)}</b><span class="zs-sep">·</span><span>GTM engine by Zeus</span></div><nav class="zs-nav"><a class="zs-btn ghost" href="${owner}" target="_blank" rel="noopener noreferrer" title="Sign in with looot: only ${e(brand)}'s workspace can open it">Open your GTM engine</a><a class="zs-btn" href="${s.zeusUrl}" target="_blank" rel="noopener noreferrer">Get your own <span aria-hidden="true">→</span></a></nav></header>
<section class="zs-hero" aria-label="${e(brand)}'s GTM engine">
<div class="zs-ht"><p class="zs-kick">GTM engine by Zeus${date ? ` · ${e(date)}` : ""}</p><h1 class="zs-name s-${nameSize}">${e(brand)}'s <span>GTM engine</span></h1><p class="zs-sub">${sub}</p></div>
<div class="zs-stage"><div class="iso zs-iso zs-hero-iso" data-roads="${e(JSON.stringify(s.roads ?? []))}">${s.city}</div><div class="zs-pins">${pins}</div></div>
</section>
${facts.length ? `<section class="zs-finds" aria-label="What Zeus found">${facts.map((f, i) => `<article class="zs-row t-${f.tone}${i % 2 ? " flip" : ""}"><div class="zs-big">${bigHtml(f)}</div><div class="zs-txt"><span class="zs-tag">${e(f.tag)}</span><h2>${e(f.head)}</h2><p>${e(f.body)}</p><p class="zs-next">${e(f.next)}</p></div></article>`).join("")}</section>` : ""}
${playsStory(d.nextPlays ?? [])}
<section class="zs-more" aria-label="See every result"><h2>See every result</h2><div class="zs-mc"><a class="zs-card" href="${owner}" target="_blank" rel="noopener noreferrer"><b>Is this your company?</b><span>Open ${e(brand)}'s GTM engine on zeus.looot.ai: every result from this run. Sign in with looot; only your workspace can open it.</span><i>Open your GTM engine <span aria-hidden="true">→</span></i></a><a class="zs-card p" href="${s.zeusUrl}" target="_blank" rel="noopener noreferrer"><b>Everyone else</b><span>Get a GTM engine for your own company. Tell your agent one line; the first run is free.</span><i>Get your own GTM engine <span aria-hidden="true">→</span></i></a></div></section>
</div>`;
  const ledger = runs && charged !== undefined ? `${fmt(runs)} data calls · $${charged.toFixed(2)} · ` : "";
  const end = `<section class="zs-end" aria-label="Get your own GTM engine">${mascotHtml(s.clipBase)}<div class="iso zs-iso zs-mini">${s.city}</div><h2>Get your own GTM engine</h2><p>Tell your agent one line. The first run is free.</p><div class="zs-cmd"><code><span>$</span> run zeus.looot.ai for yourcompany.com</code><button type="button" class="cp zs-cp" data-copy="run zeus.looot.ai for yourcompany.com">Copy</button></div><a class="zs-btn big" href="${s.zeusUrl}" target="_blank" rel="noopener noreferrer">Get your own <span aria-hidden="true">→</span> zeus.looot.ai</a><p class="zs-foot">Built by Zeus on looot · ${ledger}company-level results only</p></section>`;
  return { top, end };
}

/** "Your next plays", restyled for the story: number, title, why, price and Tell your agent. */
/** The play's full workflow on looot.ai, found from its id (a shared bundle carries no link). */
function readLink(p: { id: number; slug?: string }): string {
  const url = playUrl(p);
  return url ? `<a class="zs-open zread" href="${e(url)}" target="_blank" rel="noopener noreferrer">Read the full workflow</a>` : "";
}

function playsStory(ps: NonNullable<Dossier["nextPlays"]>): string {
  if (!ps.length) return "";
  const rows = ps.slice(0, 5).map((p, i) => `<article class="zs-play"><span class="zs-pi">${String(i + 1).padStart(2, "0")}</span><div class="zs-pm"><span class="zs-pg">${e(p.goal)}</span><h3>${e(p.title)}</h3><p>${e(p.why)}</p></div><div class="zs-pa"><span class="zs-pp">$${e(p.lowUsd.toFixed(2))} to $${e(p.highUsd.toFixed(2))}</span><button type="button" class="cp zs-cp" data-copy="${e(p.prompt)}">Tell your agent</button>${readLink(p)}</div></article>`).join("");
  return `<section class="zs-plays" aria-label="Your next GTM moves"><h2>Your next GTM moves</h2><p class="zs-pn">Each move builds on a result above. Tell your agent copies the request with a budget; nothing runs without your yes.</p>${rows}</section>`;
}

// Pins: building positions in the market-quarter viewBox (30 170 1040 600), as % of the stage.
export const STORY_CSS = `
.zshp{background:#060b16}.zshp .zpow{display:none}.zshp a.isl.zoff{display:none}
.zs,.zs-end{--bg:#060b16;--ink:#f3f6fb;--mute:#93a1b8;--line:rgba(255,255,255,.1);--green:#19d98b;--amber:#ffc23d;--pink:#ff5fa2;--blue:#5b97ff;--violet:#a98bff}
.zs{background:var(--bg);color:var(--ink);font-family:Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.zs a{color:inherit}.zs h1,.zs h2,.zs h3,.zs p{margin:0}
.t-green{--c:var(--green)}.t-amber{--c:var(--amber)}.t-pink{--c:var(--pink)}.t-blue{--c:var(--blue)}.t-violet{--c:var(--violet)}
.zs-bar{position:relative;z-index:4;display:flex;justify-content:space-between;align-items:center;gap:12px;max-width:1240px;margin:0 auto;padding:18px 24px;font-size:14px;color:var(--mute)}
.zs-who{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap}.zs-who b{color:var(--ink);font-weight:700;overflow:hidden;text-overflow:ellipsis}
.zs-mk img,.zs-lt{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;object-fit:contain;background:#fff;color:#111;font-weight:800;font-size:12px}
.zs-nav{display:flex;gap:8px;flex:none}
.zs-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 16px;border-radius:999px;background:var(--green,#19d98b);color:#03140c!important;font-weight:700;font-size:14px;text-decoration:none;border:0}
.zs-btn.ghost{background:rgba(255,255,255,.08);color:var(--ink)!important;border:1px solid var(--line)}.zs-btn:hover{filter:brightness(1.08)}
.zs-btn.big{min-height:52px;padding:12px 26px;font-size:17px;margin-top:22px}
.zs-hero{position:relative;padding:4px 0 0;background:radial-gradient(ellipse 75% 60% at 50% 70%,#12305e 0%,#0a1630 45%,var(--bg) 80%)}
.zs-hero:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 75%,rgba(25,217,139,.12),transparent 42%);pointer-events:none}
.zs-ht{position:relative;z-index:2;text-align:center;padding:36px 20px 0}
.zs-kick{font:600 13px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--green)}
.zs-name{font-weight:800;letter-spacing:-.055em;line-height:.92;margin:16px 0 0!important;background:linear-gradient(180deg,#fff 30%,#9fb4d6);-webkit-background-clip:text;background-clip:text;color:transparent;overflow-wrap:anywhere;padding-bottom:.06em}
.zs-name.s-l{font-size:clamp(46px,8.4vw,112px)}.zs-name.s-m{font-size:clamp(36px,6.2vw,84px)}
.zs-sub{font-size:clamp(16px,1.6vw,20px);color:#b9c5d8;margin-top:16px!important;max-width:760px;margin-left:auto!important;margin-right:auto!important}.zs-sub em{font-style:normal;color:var(--ink);font-weight:650}
.zs-stage{position:relative;z-index:1;width:min(1160px,100%);margin:-64px auto 0;aspect-ratio:1040/600}
.zs-iso{position:absolute;inset:0;background:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;filter:drop-shadow(0 40px 80px rgba(0,0,0,.6))}
.zs-svg{display:block;width:100%;height:100%;overflow:hidden}
.zs-pins{position:absolute;inset:0;z-index:2;pointer-events:none}
.zs-pin{position:absolute;width:0;height:0}
.zs-dot{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:var(--c);box-shadow:0 0 0 4px rgba(255,255,255,.08),0 0 18px var(--c)}
.zs-chip{position:absolute;pointer-events:auto;display:block;min-width:200px;padding:12px 16px;border-radius:14px;background:rgba(8,16,34,.8);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.15);text-decoration:none;box-shadow:0 16px 40px -12px rgba(0,0,0,.6)}
.zs-chip:before{content:"";position:absolute;left:18px;top:-1px;width:36px;height:2px;border-radius:2px;background:var(--c)}
.zs-chip b{display:flex;align-items:baseline;white-space:nowrap;font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.03em;color:#fff}.zs-chip b small{font-size:16px;color:var(--mute);font-weight:700;margin-left:6px;letter-spacing:0}
.zs-chip b .zs-n{display:inline;font:inherit;color:inherit;margin:0}.zs-chip em{display:block;font-style:normal;font-size:13px;line-height:1.35;color:var(--mute);margin-top:2px}
.zs-chip:hover,.zs-chip:focus-visible{border-color:var(--c)}
.p-buyers{left:16%;top:50.5%}.p-buyers .zs-chip{right:14px;bottom:14px}
.p-ads{left:80%;top:58%}.p-ads .zs-chip{left:14px;bottom:20px}
.p-posts{left:34.8%;top:70%}.p-posts .zs-chip{right:14px;bottom:14px}
.p-readiness{left:50%;top:48%}.p-readiness .zs-chip{left:150px;top:-150px}
.p-keywords{left:43%;top:87%}.p-keywords .zs-chip{left:16px;top:-30px}
.p-ai{left:54.8%;top:81.7%}.p-ai .zs-chip{left:16px;top:-20px}
.zs-finds,.zs-plays{max-width:1120px;margin:0 auto;padding:72px 24px 24px}
.zs-row{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;padding:64px 0;border-top:1px solid var(--line)}
.zs-row:first-child{border-top:0}
.zs-row.flip .zs-big{order:2;text-align:right}
.zs-big .zs-n{display:inline;font:inherit;color:inherit}.zs-big{font-size:clamp(92px,13vw,168px);font-weight:800;letter-spacing:-.06em;line-height:.85;color:var(--c);white-space:nowrap}.zs-big small{font-size:.36em;color:#5b6780;letter-spacing:-.02em;margin-left:.15em}
.zs-tag{display:inline-block;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;padding:6px 10px;border-radius:6px;margin-bottom:16px;color:var(--c);background:rgba(255,255,255,.06);transition:box-shadow .5s}
.zs-row h2{font-size:clamp(26px,3vw,38px);letter-spacing:-.03em;line-height:1.12;font-weight:750}
.zs-row p{color:#aab6c9;font-size:18px;line-height:1.55;margin-top:14px}.zs-row p.zs-next{color:var(--ink);font-weight:600;margin-top:12px}
.zs-name span{white-space:nowrap}
.zs-open{display:inline-flex;gap:6px;margin-top:18px;font-size:15px;font-weight:600;color:var(--c,var(--green))!important;text-decoration:none}.zs-open:hover{text-decoration:underline}.zs-pa .zs-open{margin-top:0;font-size:14px;white-space:nowrap}
.zs-plays{padding-top:40px}.zs-plays>h2{font-size:clamp(34px,4.4vw,52px);letter-spacing:-.04em;font-weight:800}.zs-pn{color:var(--mute);margin:10px 0 22px!important;font-size:16px}
.zs-play{display:grid;grid-template-columns:64px 1fr auto;gap:20px;align-items:center;padding:24px 0;border-top:1px solid var(--line)}
.zs-pi{font-size:40px;font-weight:800;color:#34425a;letter-spacing:-.03em}
.zs-pg{font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}
.zs-play h3{font-size:21px;letter-spacing:-.02em;line-height:1.25;margin-top:6px}.zs-play p{color:var(--mute);margin-top:6px;font-size:15px}
.zs-pa{display:flex;flex-direction:column;align-items:flex-end;gap:10px}.zs-pp{font:600 13px ui-monospace,Menlo,monospace;color:#cfe;white-space:nowrap}
.zs-cp{min-height:38px;padding:8px 14px;border-radius:10px;border:1px solid rgba(25,217,139,.45);background:#0b1424;color:var(--ink);font:600 14px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.zs-cp:hover{background:#10203a}
.zs-more{max-width:1120px;margin:0 auto;padding:64px 24px 72px;border-top:1px solid var(--line)}.zs-more h2{font-size:clamp(28px,3.4vw,40px);letter-spacing:-.03em;font-weight:800}
.zs-mc{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
.zs-card{display:flex;flex-direction:column;gap:8px;padding:22px 24px;border-radius:16px;border:1px solid var(--line);background:rgba(255,255,255,.04);text-decoration:none;transition:border-color .2s,transform .2s}.zs-card:hover{border-color:var(--green);transform:translateY(-2px)}
.zs-card b{font-size:20px;letter-spacing:-.02em}.zs-card span{color:#aab6c9;font-size:15px;line-height:1.5}.zs-card i{font-style:normal;font-weight:700;color:var(--green);margin-top:4px}
.zs-card.p{background:rgba(25,217,139,.08);border-color:rgba(25,217,139,.35)}
.zs-shim{position:relative;overflow:hidden;isolation:isolate;padding:6px 12px 6px 6px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04)}
.zm .zs-shim::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(105deg,transparent 30%,rgba(25,217,139,.45) 50%,transparent 70%);transform:translateX(-110%);animation:zshim 1.4s .8s cubic-bezier(.3,.6,.3,1) 1 forwards;pointer-events:none}
.zs-hero-iso .isa{pointer-events:auto}.zs-hero-iso .zrpl{position:absolute;inset:0;width:100%;height:100%}
.zs-end{position:relative;text-align:center;padding:96px 20px 64px;overflow:hidden;background:radial-gradient(ellipse 60% 70% at 50% 100%,#0e3b2a,#060b16 70%);color:#f3f6fb;font-family:Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.zs-end .zs-mini{position:relative;width:min(520px,90%);aspect-ratio:1040/600;margin:0 auto 24px;opacity:.95}
.zs-end h2{font-size:clamp(46px,8vw,96px);letter-spacing:-.055em;line-height:.95;font-weight:800;margin:0}
.zs-end p{font-size:19px;color:#b9c5d8;margin:18px 0 26px}
.zs-cmd{display:inline-flex;flex-wrap:wrap;justify-content:center;gap:12px;align-items:center;background:#0b1424;border:1px solid rgba(25,217,139,.4);border-radius:14px;padding:10px 10px 10px 18px;max-width:100%}
.zs-cmd code{font:16px ui-monospace,Menlo,monospace;color:#f3f6fb;background:none;border:0;padding:0;overflow-wrap:anywhere}.zs-cmd code span{color:#19d98b}
.zs-end .zs-btn{--green:#19d98b}
.zs-foot{font-size:13px!important;color:#56637a!important;margin:34px 0 0!important}
.zshp .app{border-top:1px solid #e6e8ec;background:#fff}
.zshp .side .brand,.zshp .side .sfoot{display:none}
.zs-end .zmas{top:92px;right:calc(50% - 380px);width:114px;height:152px}
@media (max-width:760px){.zs-end{padding-top:150px!important}.zs-end .zmas{top:16px;right:calc(50% - 45px);width:90px;height:120px}}
@media (max-width:760px){
.zs-bar{padding:14px 16px}.zs-who>span:not(.zs-mk){display:none}.zs-nav .ghost{display:none}.zs-btn{min-height:36px;padding:6px 12px;font-size:13px}
.zs-ht{padding-top:26px}.zs-sub{font-size:16px}
.zs-stage{width:150%;margin:0 0 0 -25%;aspect-ratio:1040/600}
.zs-pins{position:static;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 16px 0;width:66.6667%;margin:0 auto;pointer-events:auto}
.zs-stage{display:flex;flex-direction:column}.zs-stage .zs-iso{position:relative;inset:auto;aspect-ratio:1040/600}
.zs-pin{position:static;width:auto;height:auto}.zs-dot{display:none}
.zs-chip{position:relative;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;min-width:0;padding:10px 12px}
.zs-chip b{font-size:26px}.zs-chip b small{font-size:13px}.zs-chip em{font-size:12px}
.zs-finds,.zs-plays{padding:48px 16px 16px}
.zs-row{grid-template-columns:1fr;gap:14px;padding:40px 0}.zs-row.flip .zs-big{order:0;text-align:left}
.zs-row p{font-size:16px}
.zs-play{grid-template-columns:40px 1fr;gap:12px}.zs-pi{font-size:26px}.zs-pa{grid-column:2;align-items:flex-start;flex-direction:row;flex-wrap:wrap;align-items:center}
.zs-more{padding:44px 16px 48px}.zs-mc{grid-template-columns:1fr}
.zs-end{padding:64px 16px 48px}.zs-cmd{padding:10px 12px}.zs-cmd code{font-size:13px}
}
@media (max-width:760px){.zs-stage .zs-iso{margin-bottom:0}}
.zm .zs-pin{opacity:0;transform:translateY(10px);transition:opacity .5s ease-out,transform .6s cubic-bezier(.2,.8,.2,1)}
.zm .zs-stage.zon .zs-pin{opacity:1;transform:none}
.zm .zs-stage.zon .zs-pin:nth-child(2){transition-delay:.15s}.zm .zs-stage.zon .zs-pin:nth-child(3){transition-delay:.3s}.zm .zs-stage.zon .zs-pin:nth-child(4){transition-delay:.45s}
.zm .zs-stage:not(.zon) .zs-pin{animation:zshow 0s 3.5s forwards}
.zm .zs-stage.zon .zs-dot{animation:zspulse 2.4s ease-in-out 1.6s infinite}
@keyframes zspulse{50%{box-shadow:0 0 0 10px rgba(255,255,255,0),0 0 28px var(--c)}}
.zm.zio2 .zs-row:not(.zin),.zm.zio2 .zs-play:not(.zin){opacity:0;transform:translateY(24px)}
.zm.zio2 .zs-row,.zm.zio2 .zs-play{transition:opacity .6s ease-out,transform .7s cubic-bezier(.2,.8,.2,1)}
.zm .zs-row.zin .zs-tag{box-shadow:0 0 0 1px var(--c),0 0 24px -4px var(--c)}
@media (prefers-reduced-motion:reduce){.zs-pin,.zs-row,.zs-play{opacity:1!important;transform:none!important;transition:none!important;animation:none!important}.zs-dot{animation:none!important}}
`;

// The story's script: builds the hero city in, shows the chips and counts them up, reveals each finding
// as it scrolls in (its district tag switches on, its number counts up), and runs light pulses along the hero roads
// on the hero. Hidden start states need the zm class (HEAD_JS) or zio2 (set here).
export const STORY_JS = `(function(){
var H=document.documentElement,M=H.classList.contains('zm');
var NUM=/^(\\D*?)(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?(\\D*)$/;
function ease(t){return 1-Math.pow(1-t,3)}
function count(el,ms){if(!M||el.getAttribute('data-zc'))return;var txt=el.textContent,m=txt.match(NUM);if(!m)return;var to=parseFloat(m[2].replace(/,/g,'')+(m[3]||''));if(!(to>1))return;el.setAttribute('data-zc','1');var dec=m[3]?m[3].length-1:0,comma=m[2].indexOf(',')>=0,t0=performance.now();
function f(v){var s=v.toFixed(dec);if(comma)s=s.replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return m[1]+s+m[4]}
(function tick(t){var u=Math.min(1,(t-t0)/ms);el.textContent=u<1?f(to*ease(u)):txt;if(u<1)requestAnimationFrame(tick)})(t0)}
var st=document.querySelector('.zs-stage'),isos=document.querySelectorAll('.zs-iso');
function build(){[].forEach.call(isos,function(i){i.classList.add('in')});if(st){setTimeout(function(){st.classList.add('zon');[].forEach.call(st.querySelectorAll('.zs-n'),function(n){count(n,1200)})},M?1300:0)}}
if(M)requestAnimationFrame(function(){requestAnimationFrame(build)});else build();
var hi=document.querySelector('.zs-hero-iso');
if(M&&hi){setTimeout(function(){var sv=hi.querySelector('svg'),rd=[];try{rd=JSON.parse(hi.getAttribute('data-roads'))||[]}catch(e){}if(!sv||!rd.length)return;var NS='http://www.w3.org/2000/svg',ov=document.createElementNS(NS,'svg');ov.setAttribute('class','zrpl');ov.setAttribute('aria-hidden','true');ov.setAttribute('viewBox',sv.getAttribute('viewBox'));
rd.forEach(function(r,k){['zrp h','zrp'].forEach(function(c){var l=document.createElementNS(NS,'line');l.setAttribute('x1',r[0]);l.setAttribute('y1',r[1]);l.setAttribute('x2',r[2]);l.setAttribute('y2',r[3]);l.setAttribute('pathLength','100');l.setAttribute('class',c);l.style.animationDelay=(-k*0.53)+'s';ov.appendChild(l)})});hi.appendChild(ov)},1300)}
if(M&&'IntersectionObserver' in window){var items=document.querySelectorAll('.zs-row,.zs-play');if(items.length){H.classList.add('zio2');
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(!x.isIntersecting)return;io.unobserve(x.target);x.target.classList.add('zin');var n=x.target.querySelector('.zs-big .zs-n');if(n)count(n,1100)})},{rootMargin:'0px 0px -12% 0px'});
[].forEach.call(items,function(r){io.observe(r)})}}
})();`;

// The city page: one self-contained HTML file (inline CSS and JS, no network, no server) built from
// the same assembled dossier as dossier.html. Pure: a Dossier in, a string out.
import { escapeHtml as e } from "../util.js";
import type { Block, Section } from "../dossier/blocks.js";
import type { Dossier } from "../dossier/index.js";
import { emptyState, renderBlock } from "./blocks.js";
import { CITY_CSS } from "./style.js";
import { CITY_JS } from "./script.js";

interface CityView {
  id: string;
  label: string;
  group: string;
  color: string;
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
  { id: "targets", label: "Target accounts", group: "Get customers", color: "#1E6FD9", ids: ["committee", "accounts", "enrich", "people", "signals"], empty: "This run found no target accounts." },
  { id: "influencers", label: "Influencers", group: "Get customers", color: "#D62976", ids: ["social"], empty: "This run has no social listening data." },
  { id: "seo", label: "SEO", group: "Search", color: "#1E8E5A", ids: ["seo"], empty: "This run has no search data.", pick: (b) => !isAi(b) },
  { id: "geo", label: "GEO", group: "Search", color: "#7A4FD6", ids: ["seo"], empty: "This run has no AI answer data.", pick: isAi },
  { id: "competitive", label: "Competitive analysis", group: "Market", color: "#C0392B", ids: ["competitors", "ads", "reviews", "mentions", "market"], empty: "This run has no rival data." },
  { id: "readiness", label: "Agent readiness", group: "Market", color: "#0F9D8A", ids: ["readiness", "domains"], empty: "This run has no agent readiness data." },
  { id: "formats", label: "Format finder", group: "Organic social", color: "#F2A65A", ids: ["summary", "icp"], empty: "This run has no formats yet." },
  { id: "calendar", label: "Content calendar", group: "Organic social", color: "#2B9EB3", ids: [], empty: "This run has no content calendar. Drafts are not planned in the free run." },
  { id: "runlog", label: "Run log and cost", group: "Under the hood", color: "#4B5563", ids: ["receipt"], empty: "No receipt." },
];

/** What more credit buys, each one a command Zeus has today. Nothing here is a feature Zeus lacks. */
export const PAID_ADDS: { what: string; command: string }[] = [
  { what: "100 target accounts instead of 25", command: "looot-zeus run --depth full --cap 10" },
  { what: "People data: names, work emails and buying committees", command: "looot-zeus run --people --cap 10" },
  { what: "Phone numbers for the buying committees, on top of people data", command: "looot-zeus run --people --phones --cap 10" },
  { what: "More accounts, buying committees, ads, social posts or keyword rankings in this folder", command: "looot-zeus more accounts --count 25 --cap 2" },
  { what: "The run again later, for example each week, with what changed written to changes.md", command: "looot-zeus watch --cap 5" },
];

function paidHtml(): string {
  const items = PAID_ADDS.map((p) => `<li>${e(p.what)}<br><code>${e(p.command)}</code> <button type="button" class="cp" data-copy="${e(p.command)}">Copy</button></li>`).join("");
  return `<section class="view" data-view="paid"><div class="kicker">More credit</div><h1>What a paid run adds</h1><div class="sec"><p class="src">Every command prices its calls first and spends nothing without your yes and a cap.</p><ul>${items}</ul></div></section>`;
}

/** How many things a view shows, for its tile on the map. */
function countOf(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === "committee" || b.kind === "cards") n += b.items.length;
    else if (b.kind === "table") n += b.rows.length;
  }
  return n;
}

function viewBlocks(d: Dossier, v: CityView): { section: Section; blocks: Block[] }[] {
  const out: { section: Section; blocks: Block[] }[] = [];
  for (const id of v.ids) {
    const s = id === "receipt" ? d.sections[d.sections.length - 1] : d.sections.find((x) => x.id === id);
    if (!s) continue;
    const blocks = v.pick ? s.blocks.filter(v.pick) : s.blocks;
    if (blocks.length > 0) out.push({ section: s, blocks });
  }
  if (v.id === "formats" && d.plays) out.push({ section: d.plays, blocks: d.plays.blocks });
  return out;
}

function viewHtml(d: Dossier, v: CityView): string {
  const parts = viewBlocks(d, v);
  const body = parts.length === 0 ? emptyState(v.empty) : parts.map(({ section, blocks }) => `<div class="sec"><h3>${e(section.title)}</h3>${section.source ? `<p class="src">${e(section.status)} · ${e(section.source)}</p>` : ""}${blocks.map((b) => renderBlock(b, d.public)).join("")}</div>`).join("");
  const extra = v.id === "runlog" && d.weekly ? `<div class="sec"><h3>Run it again every week</h3><p class="src">${e(d.weekly.price)}</p><p><code>${e(d.weekly.command)}</code> <button type="button" class="cp" data-copy="${e(d.weekly.command)}">Copy</button></p></div>` : "";
  return `<section class="view" data-view="${v.id}"><div class="kicker">${e(v.group)}</div><h1>${e(v.label)}</h1>${body}${extra}</section>`;
}

/** Builds the whole city page from an assembled dossier. Pure, no file or network access. */
export function renderCity(d: Dossier): string {
  const brand = d.public ? "your brand" : d.brand || d.domain;
  const domain = d.public ? "yourdomain.com" : d.domain;
  const counts = new Map(CITY_VIEWS.map((v) => [v.id, countOf(viewBlocks(d, v).flatMap((p) => p.blocks))]));
  const tiles = CITY_VIEWS.map((v) => `<a class="isa" href="#${v.id}" title="${e(v.label)}" style="--c:${v.color}"><span class="isb"></span><span class="isl"><b>${counts.get(v.id)}</b>${e(v.label)}</span></a>`).join("");
  const legend = CITY_VIEWS.map((v) => `<a href="#${v.id}"><b>${e(v.label)}</b><small>${e(v.group)} · ${counts.get(v.id)} shown</small></a>`).join("");
  let last = "";
  const nav = [`<a href="#overview">City map</a>`, ...CITY_VIEWS.map((v) => { const h = v.group !== last ? `<div class="zgh">${e(v.group)}</div>` : ""; last = v.group; return `${h}<a href="#${v.id}">${e(v.label)}</a>`; })].join("") +
    `<div class="zgh">More credit</div><a href="#paid">What a paid run adds</a>`;
  const overview = `<section class="view on" data-view="overview"><h1>${e(brand)} City</h1>${d.placeholder ? `<div class="note">${e(d.placeholder)}</div>` : ""}<p class="run"><span>Made by one command</span><code>npx looot-zeus run ${e(domain)}</code></p><div class="isowrap"><div class="iso">${tiles}</div></div><div class="legend">${legend}</div></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(brand)} City</title><style>${CITY_CSS}</style></head>
<body><aside class="side" id="side" aria-label="Sections"><div class="brand">${e(brand)} City<small>${e(domain)}</small></div><nav class="nav">${nav}</nav></aside>
<main><button type="button" class="menu">Menu</button>
${overview}
${CITY_VIEWS.map((v) => viewHtml(d, v)).join("\n")}
${paidHtml()}
</main><script>${CITY_JS}</script></body></html>
`;
}

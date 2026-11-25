// Module 11, synthesis. Makes no paid call and no model call. In demo it renders the PLACEHOLDER
// summary and plays. In a live run it writes the facts it can count and up to 7 plays built by fixed
// rules from the data: hot accounts, ad gaps, keyword gaps, rival weak spots, hiring, AI answers and
// buying-intent posts. A play is only written when its data exists. Your own agent can add more.

import type { GtmConfig } from "../config.js";
import type { Section } from "../dossier/blocks.js";
import { priceModule } from "../quote.js";
import { usd } from "../util.js";
import { ads } from "./ads.js";
import { competitors } from "./competitors.js";
import { enrich } from "./enrich.js";
import { loadFixture } from "./fixture.js";
import { mentions } from "./mentions.js";
import { reviews } from "./reviews.js";
import { seo } from "./seo.js";
import { signals } from "./signals.js";
import { buildNextSteps, type NextStep, nextStepsFile } from "./nextSteps.js";
import type { GtmModule } from "./types.js";

export interface Play {
  title: string;
  evidence: string;
  list: string;
  command: string;
  cost: string;
  /** fact: every number in the play is read from this run's data. */
  basis?: "fact" | "inferred";
}

export interface SynthesisOut {
  placeholder?: string;
  lines: string[];
  plays: Play[];
  brief: { offer: string; icp: string; competitors: string };
  /** Suggestions for the user's own agent (hooks): each priced, with the looot job and a ready prompt. Nothing runs from here. */
  nextSteps?: NextStep[];
}

interface ScoredAccount { account: string; score: number; intent: string; reasons?: string }
interface AdGaps { yoursMissing?: string[]; nobody?: string[] }
interface WeakCard { name: string; weakSpots?: string[] }
interface ReviewWeak { competitor: string; theme: string; count?: number }

/**
 * Plain facts from the scores, the ad gaps and the weak spots, for the summary and for the agent
 * that writes the plays. Each line names where it came from. Empty input gives no line.
 */
export function highlights(outputs: Readonly<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  const sig = (outputs.signals as { accounts?: ScoredAccount[] } | null)?.accounts ?? [];
  const ranked = [...sig].filter((a) => typeof a.score === "number").sort((a, b) => b.score - a.score);
  const hot = ranked.filter((a) => a.intent === "hot");
  if (hot.length > 0) lines.push(`Hot accounts: ${hot.slice(0, 5).map((a) => `${a.account} (${a.score})`).join(", ")}. Reach these first. From signals.`);
  else if (ranked.length > 0) lines.push(`No hot account this week. Top scores: ${ranked.slice(0, 3).map((a) => `${a.account} (${a.score}, ${a.intent})`).join(", ")}. From signals.`);
  const gaps = (outputs.ads as { gaps?: AdGaps } | null)?.gaps;
  if (gaps?.yoursMissing?.length) lines.push(`Ad angles your rivals run and you do not: ${gaps.yoursMissing.join(", ")}. From ads.`);
  if (gaps?.nobody?.length) lines.push(`Ad angles nobody runs yet: ${gaps.nobody.join(", ")}. From ads.`);
  const cards = (outputs.competitors as { cards?: WeakCard[] } | null)?.cards ?? [];
  for (const c of cards) if (c.weakSpots?.length) lines.push(`${c.name} weak spot: ${c.weakSpots.slice(0, 2).join("; ")}. From competitors.`);
  const rw = (outputs.reviews as { weakSpots?: ReviewWeak[] } | null)?.weakSpots ?? [];
  for (const w of rw.slice(0, 3)) lines.push(`${w.competitor} reviewers complain about ${w.theme}${w.count ? ` (${w.count} reviews)` : ""}. From reviews.`);
  return lines;
}

export const NEXT_ACTIONS = [
  { action: "Export to Instantly, HubSpot, Attio or CSV", cost: "$0, files are in gtm/exports" },
  { action: "Scale to 100 accounts", cost: "run looot-zeus quote --depth full to see the price" },
  { action: "Check again next week", cost: "looot-zeus watch --cap 5" },
];

export const MAX_PLAYS = 7;

interface SignalAccount extends ScoredAccount { events?: { type: string; title: string; relevant?: boolean }[] }
interface EnrichPerson { account: string; email: string; status: string }
interface AdvertiserIn { name: string; you?: boolean; angles?: string[] }
interface GapIn { keyword: string; volume: number | null; rival: string }
interface AiIn { question: string; named: string[]; you: boolean; status?: string }
interface MentionIn { title: string; intent: boolean; url: string; about: string; platform: string }

/** The dated price of re-running one module on this brief, from the price table. No network. */
function priceOf(m: GtmModule, cfg: GtmConfig): string {
  const r = priceModule(m, cfg, { source: "dated", live: {} });
  return r.skip ? "$0, nothing to look up" : `about ${usd(r.expected)} on looot`;
}

function names(xs: string[], n = 3): string {
  const list = xs.slice(0, n);
  const more = xs.length > n ? ` (+${xs.length - n})` : "";
  return (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`) + more;
}

/**
 * Plays from fixed rules, in this order. Each one is written only when its data exists, and each
 * carries the evidence, the list it applies to, the next command and its cost. At most MAX_PLAYS.
 */
export function rulePlays(outputs: Readonly<Record<string, unknown>>, cfg: GtmConfig): Play[] {
  const out: Play[] = [];
  const sig = ((outputs.signals as { accounts?: SignalAccount[] } | null)?.accounts ?? []).filter((a) => typeof a.score === "number");

  // 1. Hot accounts, reached first with the verified emails.
  const hot = sig.filter((a) => a.intent === "hot").sort((a, b) => b.score - a.score);
  if (hot.length > 0) {
    const people = ((outputs.enrich as { rows?: EnrichPerson[] } | null)?.rows ?? []).filter((p) => p.email && p.status === "valid");
    const hotNames = new Set(hot.map((a) => a.account));
    const reachable = people.filter((p) => hotNames.has(p.account));
    out.push(reachable.length > 0
      ? {
          title: "Email the hot accounts this week",
          evidence: `${hot.length} hot accounts, led by ${names(hot.map((a) => `${a.account} (${a.score})`))}. From signals.`,
          list: `${reachable.length} verified contacts at hot accounts, in gtm/exports/instantly.csv`,
          command: "looot-zeus log --campaign hot-accounts --angle \"<your angle>\" --file gtm/exports/instantly.csv",
          cost: "$0, the emails are already paid for",
        }
      : {
          title: "Find emails at the hot accounts",
          evidence: `${hot.length} hot accounts, led by ${names(hot.map((a) => `${a.account} (${a.score})`))}, with no verified email yet. From signals.`,
          list: `Hot accounts ${names(hot.map((a) => a.account), 5)}, in gtm/accounts.csv`,
          command: cfg.people ? "looot-zeus run --only enrich" : "looot-zeus run --only enrich --people",
          cost: priceOf(enrich, { ...cfg, people: true }) + (cfg.people ? "" : ", a paid run with people data"),
        });
  }

  // 1b. Buying committees with a phone or email, reached as a group.
  const comm = ((outputs.committee as { accounts?: { account: string; members: { email: string; phone: string }[] }[] } | null)?.accounts ?? []).filter((a) => a.members.some((m) => m.email || m.phone));
  if (comm.length > 0) {
    const people = comm.flatMap((a) => a.members);
    out.push({
      title: "Reach each buying committee as a group",
      evidence: `${comm.length} accounts have a committee with ${people.filter((m) => m.email).length} emails and ${people.filter((m) => m.phone).length} phone numbers, led by ${names(comm.map((a) => a.account), 3)}. From committee.`,
      list: `${people.length} people in gtm/committee.csv, with role, email, LinkedIn and phone`,
      command: "npx looot-zeus more committee --count 10",
      cost: "$0 for these, the more command quotes the next 10 accounts first",
    });
  }

  // 2. Ad angles rivals run and you do not, or that nobody runs.
  const adOut = outputs.ads as { gaps?: AdGaps; advertisers?: AdvertiserIn[] } | null;
  const missing = adOut?.gaps?.yoursMissing ?? [];
  const nobody = adOut?.gaps?.nobody ?? [];
  if (missing.length > 0 || nobody.length > 0) {
    const angle = missing[0] ?? nobody[0];
    const runners = (adOut?.advertisers ?? []).filter((a) => !a.you && (a.angles ?? []).some((x) => x.replace(/ \(\d+\)$/, "") === angle)).map((a) => a.name);
    out.push({
      title: `Test the ad angle "${angle}"`,
      evidence: missing.length > 0 ? `${runners.length > 0 ? names(runners) : "Your rivals"} run "${angle}" ads and you do not. From ads.` : `No one in your market runs "${angle}" ads yet. From ads.`,
      list: `Angles to test: ${names([...missing, ...nobody], 4)}`,
      command: "looot-zeus run --only ads",
      cost: `${priceOf(ads, cfg)} to check the ad board again, plus your own ad budget`,
    });
  }

  // 3. Keywords a rival ranks for and you do not.
  const gaps = [...((outputs.seo as { gaps?: GapIn[] } | null)?.gaps ?? [])].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  if (gaps.length > 0) {
    const g = gaps[0];
    out.push({
      title: `Publish a page for "${g.keyword}"`,
      evidence: `${g.rival || "A rival"} ranks for "${g.keyword}"${g.volume ? ` (${g.volume} searches a month)` : ""} and you do not. From seo.`,
      list: `${gaps.length} keyword gaps, top ones ${names(gaps.map((x) => `"${x.keyword}"`), 4)}`,
      command: "looot-zeus run --only seo",
      cost: `${priceOf(seo, cfg)} to check the rankings again`,
    });
  }

  // 4. A rival weak spot, from its card or its reviews.
  const card = ((outputs.competitors as { cards?: WeakCard[] } | null)?.cards ?? []).find((c) => c.weakSpots?.length);
  const rw = ((outputs.reviews as { weakSpots?: ReviewWeak[] } | null)?.weakSpots ?? [])[0];
  if (card || rw) {
    const rival = card?.name ?? rw!.competitor;
    const facts = [
      ...(card ? [`${card.name} weak spot: ${card.weakSpots!.slice(0, 2).join("; ")}. From competitors.`] : []),
      ...(rw ? [`${rw.competitor} reviewers complain about ${rw.theme}${rw.count ? ` (${rw.count} reviews)` : ""}. From reviews.`] : []),
    ];
    out.push({
      title: `Run a switch campaign aimed at ${rival} users`,
      evidence: facts.join(" "),
      list: `People who compare ${rival} with you. Accounts in gtm/accounts.csv that use ${rival}`,
      command: rw ? "looot-zeus run --only competitors,reviews" : "looot-zeus run --only competitors",
      cost: `${priceOf(competitors, cfg)} to refresh the rival cards${rw && !priceModule(reviews, cfg, { source: "dated", live: {} }).skip ? `, ${priceOf(reviews, cfg)} for the reviews` : ""}`,
    });
  }

  // 5. Accounts hiring for go-to-market roles now.
  const hiring = sig
    .map((a) => ({ a, roles: (a.events ?? []).filter((e) => e.type === "hiring" && e.relevant !== false) }))
    .filter((x) => x.roles.length > 0)
    .sort((x, y) => y.roles.length - x.roles.length);
  if (hiring.length > 0) {
    const top = hiring[0];
    out.push({
      title: "Reach the accounts that are hiring for go-to-market roles",
      evidence: `${top.a.account} has ${top.roles.length} open ${top.roles.length === 1 ? "role" : "roles"} such as "${top.roles[0].title}". ${hiring.length} accounts are hiring. From signals.`,
      list: `Hiring accounts ${names(hiring.map((x) => x.a.account), 5)}`,
      command: "looot-zeus watch --cap 5",
      cost: `${priceOf(signals, cfg)} for the signals, the weekly run stops at the $5 cap`,
    });
  }

  // 6. Buyer questions where AI answers name rivals and leave you out.
  const ai = ((outputs.seo as { ai?: AiIn[] } | null)?.ai ?? []).filter((r) => (r.status ?? "answered") === "answered");
  const absent = ai.filter((r) => !r.you && r.named.length > 0);
  if (absent.length > 0) {
    const q = absent[0];
    out.push({
      title: "Get named in AI answers to your buyer questions",
      evidence: `${absent.length} of ${ai.length} AI answers name other brands and not you. "${q.question}" names ${names(q.named)}. From seo.`,
      list: `Questions ${names(absent.map((r) => `"${r.question}"`), 3)}`,
      command: "looot-zeus run --only seo",
      cost: `${priceOf(seo, cfg)} to ask the AI engines again`,
    });
  }

  // 7. Posts where someone asks for a tool like yours or compares tools.
  const intent = ((outputs.mentions as { rows?: MentionIn[] } | null)?.rows ?? []).filter((r) => r.intent);
  if (intent.length > 0) {
    out.push({
      title: "Answer the buying-intent posts",
      evidence: `${intent.length} posts this week ask for a tool or compare tools, such as "${intent[0].title}" on ${intent[0].platform}. From mentions.`,
      list: `Posts ${names(intent.map((r) => r.url).filter((u) => u && u !== "-"), 3) || "in the mentions section"}`,
      command: "looot-zeus run --only mentions",
      cost: `${priceOf(mentions, cfg)} to search again next week`,
    });
  }
  return out.slice(0, MAX_PLAYS).map((p) => ({ ...p, basis: "fact" as const }));
}

export const synthesis: GtmModule = {
  id: "synthesis",
  label: "Synthesis",
  // Filled in by the registry: synthesis needs every other module.
  needs: ["intake", "icp", "accounts", "people", "enrich", "committee", "signals", "competitors", "ads", "social", "seo", "reviews", "mentions", "market", "local", "commerce", "readiness", "domains"],
  quote: () => ({ lines: [] }),
  async run(ctx) {
    const cfg = ctx.cfg;
    const brief = {
      offer: cfg.offer,
      icp: `${cfg.icp.industries.join(", ") || "industries to fill in"}, ${cfg.icp.sizeBand} employees, ${cfg.icp.geos.join(", ")}`,
      competitors: cfg.competitors.join(", "),
    };
    if (ctx.mode === "demo") {
      const f = loadFixture("plays");
      return { status: "done", summary: "summary and 10 plays (placeholder)", out: { placeholder: f.placeholder, lines: f.summary, plays: f.plays, brief, nextSteps: buildNextSteps(cfg, {}) } satisfies SynthesisOut };
    }
    // What the data points to comes first, so it is in the 10 lines printed at the end of the run.
    const lines: string[] = highlights(ctx.outputs);
    for (const [id, out] of Object.entries(ctx.outputs)) {
      const s = (out as { summary?: string } | null)?.summary;
      if (s && id !== "synthesis") lines.push(`${id}: ${s}`);
    }
    const plays = rulePlays(ctx.outputs, cfg);
    return {
      status: "done",
      summary: plays.length > 0 ? `facts collected, ${plays.length} ${plays.length === 1 ? "play" : "plays"} from the data` : "facts collected, no play had enough data",
      out: { lines, plays, brief, nextSteps: buildNextSteps(cfg, ctx.outputs) } satisfies SynthesisOut,
    };
  },
  render(out): Section {
    const o = out as SynthesisOut;
    return {
      num: "00",
      id: "summary",
      title: "Summary",
      status: "done",
      source: o.placeholder ? "PLACEHOLDER data, invented to show the layout. A real run replaces it." : "built from the sections below",
      blocks: [
        { kind: "kv", items: [
          { label: "Offer", value: o.brief.offer },
          { label: "ICP", value: o.brief.icp },
          { label: "Competitors", value: o.brief.competitors },
        ] },
        { kind: "list", items: o.lines },
        ...(o.plays.length > 0
          ? [{ kind: "table" as const, caption: `${o.plays.length} ${o.plays.length === 1 ? "play" : "plays"}${o.placeholder ? "" : ", each from the data above"}`, columns: [{ key: "n", label: "#" }, { key: "title", label: "Play" }, { key: "evidence", label: "Evidence" }, { key: "list", label: "Applies to" }, { key: "command", label: "Scale it" }, { key: "cost", label: "Expected cost" }], rows: o.plays.map((p, i) => ({ n: i + 1, ...p })) }]
          : [{ kind: "note" as const, text: "No play had enough data in this run. Your agent can read gtm/dossier.md and add plays to gtm/plays.md, each with evidence, the list it applies to, the command to scale it and the expected cost." }]),
        { kind: "table", caption: "Next actions, nothing runs without your yes", columns: [{ key: "action", label: "Action" }, { key: "cost", label: "Cost" }], rows: NEXT_ACTIONS },
        ...(o.nextSteps?.length
          ? [{ kind: "table" as const, caption: "Next steps your agent can offer you (gtm/next-steps.json). Schedules run in your own agent, nothing runs without your yes", columns: [{ key: "title", label: "Next step" }, { key: "why", label: "Why" }, { key: "price", label: "Price" }, { key: "when", label: "When" }], rows: o.nextSteps.map((n) => ({ title: n.title, why: n.why, price: n.price, when: n.schedule ?? "once" })) }]
          : []),
      ],
    };
  },
  files(out): Record<string, string> {
    const o = out as SynthesisOut;
    if (!o) return {};
    const body = o.plays.length > 0
      ? o.plays.map((p, i) => `## ${i + 1}. ${p.title}\n\n- Evidence: ${p.evidence}\n- Applies to: ${p.list}\n- Scale it: \`${p.command}\`\n- Expected cost: ${p.cost}\n`).join("\n")
      : "No play had enough data in this run. Your agent can add plays here, each with evidence, the list it applies to, the command to scale it and the expected cost.\n";
    const tail = o.plays.length > 0 && !o.placeholder ? "\nThese come from fixed rules over the data in gtm/dossier.md. Your agent can add more below.\n" : "";
    return { "plays.md": `# Plays\n\n${o.placeholder ? `> ${o.placeholder}\n\n` : ""}${body}${tail}`, ...(o.nextSteps?.length ? { "next-steps.json": nextStepsFile(o.nextSteps) } : {}) };
  },
};

// Module 12, agent readiness. How ready you and each rival are for AI agents: AI-crawler rules and
// Content Signals in robots.txt, llms.txt, a Markdown answer, schema.org data and the agent discovery
// files (MCP, A2A, Agent Skills, API catalog, OAuth metadata). One web.agent.readiness call per site,
// looot's own check (about 13 plain GETs on the site, no page text back), $0.005 a call, a miss is $0.
// Company-level only: no person data, no LinkedIn.

import type { CallRecord } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { answered, emptyTally, fixture, frame, nameOfDomain, obj, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail } from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

const isObj = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

export const READINESS_JOB = "web.agent.readiness";

/** You first, then each rival. Each site is one call. */
export function readinessSites(cfg: Pick<GtmConfig, "domain" | "brand" | "competitors">): { domain: string; about: string; you: boolean }[] {
  return [{ domain: cfg.domain, about: "you", you: true }, ...cfg.competitors.map((d) => ({ domain: d, about: nameOfDomain(d), you: false }))];
}

export function readinessQuote(cfg: GtmConfig): ModuleQuote {
  return { lines: [{ job: READINESS_JOB, calls: readinessSites(cfg).length, note: "you and each rival, one check per site" }] };
}

export interface ReadinessCheck { id: string; group: string; pass: boolean; fix: string | null }
export interface ReadinessAnswer { score: number; level: number; levelName: string; checks: ReadinessCheck[] }

/** Reads a web.agent.readiness answer ({ score, level, levelName, checks[] }), unwrapping data/result. null when it has none. */
export function parseReadiness(raw: unknown, depth = 0): ReadinessAnswer | null {
  if (depth > 3 || !isObj(raw)) return null;
  const o = obj(raw);
  if (typeof o.score === "number" && Array.isArray(o.checks)) {
    const checks = (o.checks as unknown[]).filter(isObj).map((c) => {
      const x = obj(c);
      return { id: str(x.id) ?? "?", group: str(x.group) ?? "-", pass: x.pass === true, fix: str(x.fix) };
    });
    return { score: Math.round(o.score), level: typeof o.level === "number" ? o.level : 0, levelName: str(o.levelName) ?? "-", checks };
  }
  for (const k of ["data", "result", "output", "body"]) {
    const inner = parseReadiness(o[k], depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** Plain words for the check ids the gateway returns. Unknown ids show as they are. */
export const CHECK_LABEL: Record<string, string> = {
  robots: "robots.txt", "robots.ai_rules": "AI-crawler rules", "robots.content_signal": "Content Signals", "robots.ai_blocked": "AI crawlers allowed",
  sitemap: "sitemap", link_headers: "Link headers", structured_data: "schema.org data", dns_aid: "DNS-AID records", llms_txt: "llms.txt",
  llms_full_txt: "llms-full.txt", markdown_negotiation: "Markdown answer", text_without_js: "text without JavaScript", mcp_discovery: "MCP discovery",
  mcp_server_card: "MCP server card", a2a_agent_card: "A2A agent card", agent_skills: "Agent Skills index", api_catalog: "API catalog",
  oauth_authorization_server: "OAuth metadata", oauth_protected_resource: "OAuth resource metadata",
};
/** Plain words for a check id; an id the gateway adds later reads as words ("robots.new_rule" -> "robots new rule"). */
export const label = (id: string): string => CHECK_LABEL[id] ?? id.replace(/[._]+/g, " ").trim();

export type ReadinessRow = { about: string; domain: string; score: number | null; level: string; passed: string; missing: string; status: string; provider: string };
export interface ReadinessOut {
  placeholder?: string;
  summary: string;
  provider: string;
  date: string;
  rows: ReadinessRow[];
  /** The fixes for your own site, one line each. */
  fixes: string[];
  calls?: string;
}

/** One row for a site from its answer. */
export function readinessRow(site: { domain: string; about: string }, a: ReadinessAnswer | null, status: string, provider: string): ReadinessRow {
  if (!a) return { about: site.about, domain: site.domain, score: null, level: "-", passed: "-", missing: "-", status, provider };
  const miss = a.checks.filter((c) => !c.pass).map((c) => label(c.id));
  return { about: site.about, domain: site.domain, score: a.score, level: `${a.level} ${a.levelName}`, passed: `${a.checks.length - miss.length} of ${a.checks.length}`, missing: miss.join(", ") || "nothing", status, provider };
}

function summaryOf(rows: ReadinessRow[]): string {
  const you = rows.find((r) => r.about === "you");
  const rivals = rows.filter((r) => r.about !== "you" && r.score !== null);
  if (!you || you.score === null) return `agent readiness checked for ${rows.filter((r) => r.score !== null).length} of ${rows.length} sites, yours did not answer`;
  const ahead = rivals.filter((r) => (r.score ?? 0) > (you.score ?? 0)).length;
  return `your site scores ${you.score}/100 for AI agents (${you.level}), ${ahead} of ${rivals.length} rivals score higher`;
}

async function run(ctx: ModuleContext) {
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const sites = readinessSites(ctx.cfg);
  const rows: ReadinessRow[] = [];
  let fixes: string[] = [];
  const build = (): ReadinessOut => {
    const ordered = sites.map((s) => rows.find((r) => r.domain === s.domain)).filter((r): r is ReadinessRow => !!r);
    return { summary: summaryOf(ordered), provider: providersOf(calls), date: today(), rows: ordered, fixes, calls: tallyLine(t) };
  };
  try {
    await pool(sites, 3, async (s) => {
      const r = await tracked(ctx, t, calls, READINESS_JOB, { url: `https://${s.domain}` }, `site:${s.domain}`);
      const a = answered(r) ? parseReadiness(r.data) : null;
      rows.push(readinessRow(s, a, answered(r) ? (a ? "answered" : "answered, no score") : outcomeText(r.record), trail(r.record)));
      if (s.you && a) fixes = a.checks.filter((c) => !c.pass && c.fix).map((c) => `${label(c.id)}: ${c.fix}`);
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`readiness: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: ReadinessOut): Block[] {
  const scored = o.rows.filter((r) => r.score !== null);
  const b: Block[] = [];
  if (scored.length) b.push({ kind: "bars", caption: "Agent readiness score, 0 to 100", max: 100, items: scored.map((r) => ({ label: r.about === "you" ? "You" : r.about, value: r.score ?? 0, display: `${r.score}`, tone: r.about === "you" ? "go" as const : "plain" as const })) });
  b.push({ kind: "table", caption: "What each site has and misses", columns: [{ key: "about", label: "Site" }, { key: "domain", label: "Domain" }, { key: "score", label: "Score", num: true }, { key: "level", label: "Level" }, { key: "passed", label: "Checks passed" }, { key: "missing", label: "Missing" }, { key: "status", label: "Answer" }], rows: o.rows.map((r) => ({ ...r, score: r.score ?? "-" })) });
  if (o.fixes.length) b.push({ kind: "list", items: o.fixes });
  b.push({ kind: "note", text: "Score and levels are looot's own scale (0 not ready to 5 agent-native), from plain requests to each site's public files. No page text is kept." });
  return b;
}

export const readiness: GtmModule = {
  id: "readiness",
  label: "Agent readiness",
  needs: ["intake"],
  quote: readinessQuote,
  async run(ctx) {
    if (ctx.mode === "demo") {
      const f = fixture("readiness");
      return { status: "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "12", id: "readiness", title: "Agent readiness", activate: "Publish the missing files on your site, starting with llms.txt and the AI-crawler rules" }, out, status, (o) => blocks(o as ReadinessOut)),
};

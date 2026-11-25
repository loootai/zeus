// What learn writes besides learnings.json. Never config.yaml.
// - gtm/next-run.md       3 to 5 plain lines on what the next run would do differently, plus a suggested cap
// - gtm/config.next.yaml  your config.yaml with industries and titles in the learned order
// - gtm/learnings.md      the same learnings in words
// - gtm/learnings/changelog.md  one line per weight that moved: date, signal, sample, old, new, why

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestCap } from "../cap.js";
import { configToYaml, loadConfig, type GtmConfig } from "../config.js";
import { usd, writeFile } from "../util.js";
import { type Change, DIMENSIONS, keyOf, LEARN, type Learnings, type Weights } from "./schema.js";
import { DIM_WORD, type LearnResult, rankedAngles } from "./update.js";

const pct = (r: number, n: number) => (n > 0 ? `${Math.round((1000 * r) / n) / 10}` : "0");
const w2 = (n: number) => n.toFixed(2);
const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Orders a list by its learned weight, highest first. Ties keep the order you wrote. */
export function byWeight(list: string[], w: Record<string, number>): string[] {
  return list.map((x, i) => ({ x, i, w: w[keyOf(x)] ?? 1 })).sort((a, b) => b.w - a.w || a.i - b.i).map((r) => r.x);
}

export function changelogLine(c: Change): string {
  return `- ${c.date} · ${DIM_WORD[c.dimension]} ${c.key} · ${c.signal} · ${c.sends} ${c.signal === "valid emails" ? "lookups" : `sends, ${pl(c.replies, "reply", "replies")}`} · ${w2(c.old)} to ${w2(c.new)} · ${c.why}`;
}

export function nextRunLines(r: LearnResult, l: Learnings): string[] {
  const lines: string[] = [];
  const up = r.changes.filter((c) => c.new > c.old);
  const down = r.changes.filter((c) => c.new < c.old);
  const word = (c: Change) => `${DIM_WORD[c.dimension]} ${c.key}`;
  if (up.length > 0) lines.push(`These score higher next run, ${up.map((c) => `${word(c)} (${w2(c.old)} to ${w2(c.new)})`).join("; ")}. They got more replies than the average.`);
  if (down.length > 0) lines.push(`These score lower next run, ${down.map((c) => `${word(c)} (${w2(c.old)} to ${w2(c.new)})`).join("; ")}.`);
  if (r.changes.length === 0) lines.push(...r.notes.slice(0, 1));
  else lines.push(`Based on ${pl(r.sends, "send")} with ${pl(r.replies, "reply", "replies")}. Nothing moves on a group under ${LEARN.minSends} sends.`);
  const top = rankedAngles(l.angles)[0];
  if (top) lines.push(`Best angle in these results, "${top.name}", ${pl(top.replies, "reply", "replies")} on ${top.sends} sends.`);
  else if (l.angles.length > 0) lines.push(`No angle ranks yet. An angle needs ${LEARN.angleSends} sends and ${LEARN.angleReplies} replies.`);
  if (r.bounces > 0) lines.push(`${r.bounces} ${r.bounces === 1 ? "address" : "addresses"} bounced. They are left out of the next exports.`);
  for (const p of l.providerPrefs.slice(0, 1)) lines.push(`On ${p.job}, ${p.provider} answered ${p.hitRate} percent of ${p.calls} calls. looot records the provider result. Provider selection stays unchanged.`);
  return lines.slice(0, 5);
}

export function suggestedCap(l: Learnings): number {
  const last = l.runs[l.runs.length - 1];
  if (!last) return 5;
  return suggestCap(Math.max(last.worst ?? 0, last.charged * 1.5));
}

export function learningsMarkdown(l: Learnings): string {
  const out = ["# What Zeus learned", "", `Updated ${l.updatedAt.slice(0, 10)}. ${l.runs.length} ${l.runs.length === 1 ? "run" : "runs"} kept.`, ""];
  if (l.placeholder) out.unshift(`> ${l.placeholder}`, "");
  out.push("## Runs", "");
  out.push(...(l.runs.length > 0 ? l.runs.map((r) => `- ${r.date}, ${r.calls} calls, ${usd(r.charged)}, accounts ${Object.entries(r.accounts).map(([g, n]) => `${n} ${g}`).join(", ")}`) : ["No run kept yet."]), "");
  out.push("## Weights", "", "1.00 is neutral. Weights stay between 0.50 and 1.50.", "");
  const ws = DIMENSIONS.flatMap((d) => Object.entries(l.weights[d]).filter(([, v]) => v !== 1).map(([k, v]) => `- ${d === "sizeBand" ? "size" : d} ${k}, ${w2(v)}`));
  out.push(...(ws.length > 0 ? ws : ["All neutral."]), "");
  out.push("## Angles", "");
  out.push(...(l.angles.length > 0 ? l.angles.map((a) => `- "${a.name}", ${pl(a.sends, "send")}, ${pl(a.replies, "reply", "replies")} (${pct(a.replies, a.sends)} per 100), ${pl(a.meetings, "meeting")}`) : ["No angle logged yet. Use looot-zeus log --campaign <name> --angle <text> --file gtm/exports/instantly.csv"]), "");
  out.push("## Groups", "");
  out.push(...(l.segments.length > 0 ? l.segments.slice(0, 15).map((s) => `- grade ${s.grade || "?"}, ${s.industry || "?"}, ${s.title || "?"}, ${pl(s.sends, "send")}, ${pl(s.replies, "reply", "replies")}, ${pl(s.bounces, "bounce")}, ${pl(s.meetings, "meeting")}`) : ["No sends yet."]), "");
  out.push("## Providers", "", "looot records the provider result. Provider selection stays unchanged.", "");
  out.push(...(l.providerPrefs.length > 0 ? l.providerPrefs.map((p) => `- ${p.job}, ${p.provider}, ${p.hitRate} percent of ${p.calls} calls`) : ["None noted yet."]), "");
  out.push("## Left out of exports", "", `${l.suppress.length} bounced ${l.suppress.length === 1 ? "address" : "addresses"}.`, "");
  return out.join("\n");
}

function proposedConfig(cfg: GtmConfig, w: Weights): GtmConfig {
  return { ...cfg, icp: { ...cfg.icp, industries: byWeight(cfg.icp.industries, w.industry), titles: byWeight(cfg.icp.titles, w.title) } };
}

export interface Written {
  files: string[];
  cap: number;
  lines: string[];
}

/** Writes next-run.md, config.next.yaml (when config.yaml exists), learnings.md and the changelog. */
export function writeProposal(outDir: string, configPath: string, r: LearnResult): Written {
  const l = r.next;
  const files: string[] = [];
  const put = (rel: string, text: string) => {
    writeFile(join(outDir, rel), text);
    files.push(rel);
  };
  const cap = suggestedCap(l);
  const lines = nextRunLines(r, l);
  const head = l.placeholder ? [`> ${l.placeholder}`, ""] : [];
  put(
    "next-run.md",
    [
      ...head,
      `# Next run, from what Zeus learned on ${l.lastLearn?.date ?? l.updatedAt.slice(0, 10)}`,
      "",
      ...lines.map((x) => `- ${x}`),
      "",
      `Suggested cap ${cap} USD.`,
      "",
      "To use these learnings in the next run, type this. Without --apply-learnings the run scores as before.",
      "",
      "```bash",
      `npx looot-zeus run --apply-learnings --cap ${cap}`,
      "```",
      "",
    ].join("\n"),
  );
  if (existsSync(configPath)) {
    const cfg = loadConfig(configPath);
    const weights = DIMENSIONS.flatMap((d) => Object.entries(l.weights[d]).filter(([, v]) => v !== 1).map(([k, v]) => `  ${d === "sizeBand" ? "size" : d} ${k} ${w2(v)}`));
    put("config.next.yaml", configToYaml(proposedConfig(cfg, l.weights), [`Proposed by looot-zeus learn on ${l.lastLearn?.date ?? ""}. Your config.yaml is unchanged.`, "Industries and titles are in the learned order. Compare it with config.yaml and copy what you want.", ...(weights.length > 0 ? ["Learned weights, used by run --apply-learnings:", ...weights] : ["No weight moved yet."])]));
  }
  put("learnings.md", learningsMarkdown(l));
  if (r.changes.length > 0) {
    const f = join(outDir, "learnings", "changelog.md");
    const before = existsSync(f) ? readFileSync(f, "utf8") : "# Every change Zeus made to a weight\n\nDate · signal · sample · old to new · why\n\n";
    writeFile(f, before + r.changes.map(changelogLine).join("\n") + "\n");
    files.push("learnings/changelog.md");
  }
  return { files, cap, lines };
}

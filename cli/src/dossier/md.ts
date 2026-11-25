import type { Bar, Block, Card, CommitteeCard, Member, Section } from "./blocks.js";
import type { Dossier } from "./index.js";
import { maskValue } from "./mask.js";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** One line per card, so a public copy masks each card on its own line. */
function card(c: Card, pub: boolean): string {
  const parts = [`**${maskValue(c.title, c.titlePii, pub)}**${c.basis ? ` (${c.basis})` : ""}${c.tag ? ` ${c.tag}` : ""}`];
  if (c.sub) parts.push(maskValue(c.sub, undefined, pub));
  if (c.text) parts.push(maskValue(c.text, undefined, pub));
  if (c.meter) parts.push(`${c.meter.label} ${c.meter.value} of ${c.meter.max}`);
  for (const r of c.rows ?? []) parts.push(`${r.label}. ${maskValue(r.value, r.pii, pub)}`);
  if (c.chips?.length) parts.push(c.chips.join(", "));
  for (const l of c.links ?? []) parts.push(`[${l.label}](${l.href})`);
  if (c.command) parts.push(`\`${c.command}\``);
  return `- ${parts.join(" · ")}`;
}

/** A bar as text, 20 cells wide. */
export function barText(b: Bar, max: number): string {
  const n = max > 0 ? Math.round((Math.max(0, b.value) / max) * 20) : 0;
  return `${"█".repeat(n)}${"░".repeat(20 - n)}`;
}

/** One line per person, so a public copy masks each person on its own line. */
export function memberLine(m: Member, pub: boolean): string {
  const li = m.linkedin ? (pub ? "LinkedIn hidden in the public copy" : m.linkedin) : "no LinkedIn found";
  const email = m.email ? `${maskValue(m.email, "email", pub)} (${m.emailStatus})` : `email ${m.emailStatus}`;
  const phone = m.phone ? `${maskValue(m.phone, "phone", pub)} (${[m.phoneType, m.phoneStatus].filter(Boolean).join(", ")})` : `phone ${m.phoneStatus}`;
  return `  - ${m.role}. ${maskValue(m.name, "name", pub)}, ${maskValue(m.title, undefined, pub)} · ${email} · ${li} · ${phone}`;
}

function committee(c: CommitteeCard, pub: boolean): string {
  return [`- **${maskValue(c.account, undefined, pub)}** (${c.domain}), grade ${c.grade}${c.companyPhone ? `, company line ${c.companyPhone}` : ""}`, ...c.members.map((m) => memberLine(m, pub))].join("\n");
}

function block(b: Block, pub: boolean): string {
  switch (b.kind) {
    case "text":
      return maskValue(b.text, undefined, pub);
    case "note":
      return `> ${maskValue(b.text, undefined, pub)}`;
    case "list":
      return b.items.map((i) => `- ${maskValue(i, undefined, pub)}`).join("\n");
    case "kv":
      return b.items.map((i) => `- **${i.label}**. ${maskValue(i.value, i.pii, pub)}`).join("\n");
    case "stat":
      return b.items.map((i) => `**${i.value}** ${i.label}${i.hint ? ` (${i.hint})` : ""}`).join(" · ");
    case "cards": {
      const head = b.caption ? `**${b.caption}**\n\n` : "";
      if (b.items.length === 0) return `${head}> ${b.empty ?? "Nothing to show."}`;
      return `${head}${b.items.map((c) => card(c, pub)).join("\n")}`;
    }
    case "bars": {
      const max = b.max ?? Math.max(0, ...b.items.map((i) => i.value));
      const rows = b.items.map((i) => `| ${cell(maskValue(i.label, undefined, pub))} | \`${barText(i, max)}\` | ${i.display ?? i.value} |`);
      return `${b.caption ? `**${b.caption}**\n\n` : ""}| Item | Bar | Value |\n|---|---|---:|\n${rows.join("\n")}`;
    }
    case "committee":
      return `${b.caption ? `**${b.caption}**\n\n` : ""}${b.items.map((c) => committee(c, pub)).join("\n")}`;
    case "more":
      return `> Run more. ${b.label}, ${b.price}. \`${b.command}\`${b.text ? ` ${b.text}` : ""}`;
    case "table": {
      const head = `| ${b.columns.map((c) => c.label).join(" | ")} |\n|${b.columns.map((c) => (c.num ? "---:" : "---")).join("|")}|`;
      const rows = b.rows.map((r) => `| ${b.columns.map((c) => cell(maskValue(r[c.key], c.pii, pub))).join(" | ")} |`);
      return `${b.caption ? `**${b.caption}**\n\n` : ""}${head}\n${rows.join("\n")}`;
    }
  }
}

function section(s: Section, pub: boolean): string {
  const parts = [`## ${s.num ? `${s.num} ` : ""}${s.title}`, ""];
  if (s.status !== "done") parts.push(`*${s.status}*`, "");
  if (s.source) parts.push(`*Source. ${s.source}*`, "");
  for (const b of s.blocks) parts.push(block(b, pub), "");
  if (s.deeper) parts.push(`Go deeper. \`${s.deeper}\``, "");
  if (s.activate) parts.push(`Activate. ${s.activate}`, "");
  return parts.join("\n");
}

const ORDER = ["accounts", "committee", "enrich", "people", "competitors", "ads", "social", "seo", "reviews", "mentions", "signals", "market", "local", "commerce", "readiness", "domains", "*", "plays", "summary", "icp", "receipt"];

export function renderMarkdown(d: Dossier): string {
  const head = [`# GTM dossier, ${d.brand} (${d.domain})`, "", `Built ${d.generatedAt.slice(0, 16).replace("T", " ")} UTC${d.public ? ", public copy with people masked" : ""}.`, ""];
  if (d.placeholder) head.push(`> ${d.placeholder}`, "");
  // Same order as the page: the analysis first, then the plays, the brief and the cost.
  const pos = (id: string) => {
    const i = ORDER.indexOf(id);
    return i < 0 ? ORDER.indexOf("*") : i;
  };
  const secs = [...d.sections].sort((a, b) => pos(a.id) - pos(b.id));
  const analysis = secs.filter((s) => pos(s.id) < ORDER.indexOf("plays"));
  const rest = secs.filter((s) => pos(s.id) > ORDER.indexOf("plays"));
  const all = [...(d.overview ? [d.overview] : []), ...analysis, ...(d.plays ? [d.plays] : []), ...rest];
  const weekly = d.weekly && !d.public ? [`## Run this every week`, "", `${d.weekly.price}.`, "", `\`${d.weekly.command}\``, "", `Or ask your agent. ${d.weekly.prompt}`, ""] : [];
  return [...head, ...all.map((s) => section(s, d.public)), ...weekly].join("\n");
}

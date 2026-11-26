// Draws dossier blocks for the city page. Pure: blocks in, an HTML string out.
import { escapeHtml as e } from "../util.js";
import type { Bar, Block, Card, Tone } from "../dossier/blocks.js";
import { maskValue } from "../dossier/mask.js";
import { renderPeople } from "./people.js";

/** Only the known tones reach a class name; anything else (a shared page's data) reads as none. */
const toneOf = (t: unknown): "go" | "warm" | "cold" | "" => (t === "go" || t === "warm" || t === "cold" ? t : "");
const meter = (frac: number, tone: Tone = "go") => `<span class="zg-meter" aria-hidden="true"><i class="zg-${toneOf(tone) || "go"}" style="width:${Math.round(Math.max(0, Math.min(1, Number(frac) || 0)) * 100)}%"></i></span>`;

/** The honest empty state a view shows when the run has nothing for it. */
export function emptyState(msg: string): string {
  return `<div class="empty zg-empty"><b>Nothing here yet</b> ${e(msg)}</div>`;
}

function cardHtml(c: Card, pub: boolean): string {
  const v = (x: unknown, p?: Parameters<typeof maskValue>[1]) => e(maskValue(x, p, pub));
  const rows = (c.rows ?? []).map((r) => `<dt>${e(r.label)}</dt><dd>${v(r.value, r.pii)}</dd>`).join("");
  const letter = e((c.title || "?").trim().charAt(0).toUpperCase());
  return `<article class="card zg-card"><div class="zg-card-h"><span class="zg-tile">${pub && c.titlePii ? "?" : letter}</span><div><h4>${v(c.title, c.titlePii)}</h4>${c.sub ? `<span class="zg-sub">${v(c.sub)}</span>` : ""}</div>${c.tag ? `<span class="chip zg-tag ${toneOf(c.tone) ? "zg-" + toneOf(c.tone) : ""}">${e(c.tag)}</span>` : ""}</div>${c.text ? `<p>${v(c.text)}</p>` : ""}${c.meter ? `${meter(c.meter.max > 0 ? c.meter.value / c.meter.max : 0, c.tone)}<span class="zg-sub">${e(c.meter.label)}</span>` : ""}${rows ? `<dl>${rows}</dl>` : ""}${c.chips?.length ? `<div>${c.chips.map((x) => `<span class="chip">${v(x)}</span>`).join("")}</div>` : ""}${c.command ? `<div><code>${e(c.command)}</code> <button type="button" class="cp" data-copy="${e(c.command)}">Copy</button></div>` : ""}</article>`;
}

function barRow(i: Bar, max: number, pub: boolean): string {
  return `<div class="zg-brow"><span>${e(maskValue(i.label, undefined, pub))}</span>${meter(max > 0 ? i.value / max : 0, i.tone ?? "go")}<span class="zg-bv">${e(i.display ?? String(i.value))}</span></div>`;
}

/** Draws one block. pub masks people the way the dossier does. */
export function renderBlock(b: Block, pub: boolean): string {
  const v = (x: unknown, p?: Parameters<typeof maskValue>[1]) => e(maskValue(x, p, pub));
  switch (b.kind) {
    case "text": return `<p>${v(b.text)}</p>`;
    case "note": return `<div class="note">${v(b.text)}</div>`;
    case "list": return `<ul>${b.items.map((i) => `<li>${v(i)}</li>`).join("")}</ul>`;
    case "kv": return `<dl class="card zg-kv">${b.items.map((i) => `<dt>${e(i.label)}</dt><dd>${v(i.value, i.pii)}</dd>`).join("")}</dl>`;
    case "stat": return `<div class="zg-stats">${b.items.map((s) => `<div class="zg-stat"><b>${e(s.value)}</b><span>${e(s.label)}</span>${s.hint ? `<span> · ${e(s.hint)}</span>` : ""}</div>`).join("")}</div>`;
    case "table": {
      if (b.rows.length === 0) return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}${emptyState("No rows in this run.")}`;
      const head = b.columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${e(c.label)}</th>`).join("");
      const body = b.rows.map((r) => `<tr>${b.columns.map((c) => `<td${c.num ? ' class="num"' : ""}>${v(r[c.key], c.pii)}</td>`).join("")}</tr>`).join("");
      return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}<div class="tw"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    case "cards":
      if (b.items.length === 0) return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}${emptyState(b.empty ?? "Nothing to show.")}`;
      return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}<div class="zg-cards">${b.items.map((c) => cardHtml(c, pub)).join("")}</div>`;
    case "bars": {
      const max = b.max ?? Math.max(0, ...b.items.map((i) => i.value));
      return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}${b.items.map((i) => barRow(i, max, pub)).join("")}`;
    }
    case "committee": return `${b.caption ? `<p class="zg-cap">${e(b.caption)}</p>` : ""}${renderPeople(b.items, pub)}`;
    case "more": return `<p><span class="chip">${v(b.label)}</span> <code>${e(b.command)}</code> <button type="button" class="cp" data-copy="${e(b.command)}">Copy</button> <span class="src">${e(b.price)}</span></p>`;
  }
}

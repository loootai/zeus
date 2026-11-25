// People on the city page. This is the ONE place a person's name, title, email, phone or profile is
// drawn. A safer demo mode swaps this function and nothing else.
import { escapeHtml as e, safeUrl } from "../util.js";
import type { CommitteeCard, Member } from "../dossier/blocks.js";
import { maskValue } from "../dossier/mask.js";

function memberHtml(m: Member, pub: boolean): string {
  const name = e(maskValue(m.name, "name", pub));
  const title = e(maskValue(m.title, undefined, pub));
  const acts: string[] = [];
  if (m.email) acts.push(`<span>${e(maskValue(m.email, "email", pub))}</span>${pub ? "" : `<button type="button" class="cp" data-copy="${e(m.email)}">Copy</button>`}<span class="chip">${e(m.emailStatus)}</span>`);
  else acts.push(`<span class="zg-t">email ${e(m.emailStatus)}</span>`);
  if (m.phone) acts.push(`<span>${e(maskValue(m.phone, "phone", pub))}</span>${m.phoneType ? `<span class="chip">${e(m.phoneType)}</span>` : ""}`);
  else acts.push(`<span class="zg-t">phone ${e(m.phoneStatus)}</span>`);
  const li = safeUrl(m.linkedin);
  if (li && !pub) acts.push(`<a href="${e(li)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`);
  return `<li class="mem"><span class="chip">${e(m.role)}</span> <b>${name}</b> <span class="zg-t">${title}</span><div class="zg-acts">${acts.join("")}</div></li>`;
}

/** Draws every buying committee, one account per card. Masks names, emails and phones when pub is true. */
export function renderPeople(items: CommitteeCard[], pub: boolean): string {
  return `<div class="zg-ccs">${items.map((c) => {
    const found = c.members.filter((m) => m.email).length;
    const ph = c.members.filter((m) => m.phone).length;
    const tone = ({ A: "go", B: "warm", D: "cold" } as Record<string, string>)[c.grade] ?? "";
    return `<article class="zg-cc"><header class="zg-cc-h"><div><h4>${e(maskValue(c.account, undefined, pub))}</h4><span class="src">${e(maskValue(c.domain, undefined, pub))}</span></div><span class="chip ${tone ? "zg-" + tone : ""}">grade ${e(c.grade)}</span></header><p class="src">${c.members.length} people, ${found} emails, ${ph} phones</p><ul class="zg-mems">${c.members.map((m) => memberHtml(m, pub)).join("")}</ul></article>`;
  }).join("")}</div>`;
}

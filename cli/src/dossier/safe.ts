// Safe demo mode: a dossier you can show or host. Company-level data stays. People stay as their role
// and title with an invented name. No email, phone, profile link or photo is left, and free text is
// scrubbed. Pure: a Dossier in, a Dossier out.
import type { Block, Card, CommitteeCard, Member, Section } from "./blocks.js";
import type { Dossier } from "./index.js";

const FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery", "Jamie", "Robin", "Sasha", "Devon"];
const LAST = ["Rivera", "Nguyen", "Okafor", "Lindqvist", "Moreau", "Haddad", "Castillo", "Varga", "Tanaka", "Brandt", "Iyer", "Kowalski"];

/** The invented name for person number i (0 based). Fixed list, so the same run gives the same names. */
export function placeholderName(i: number): string {
  const base = `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + Math.floor(i / FIRST.length)) % LAST.length]}`;
  const lap = Math.floor(i / (FIRST.length * LAST.length));
  return lap > 0 ? `${base} ${lap + 1}` : base;
}

/** True when the text is one of the invented names, so the --public initials mask leaves it alone. */
export function isPlaceholderName(s: string): boolean {
  return /^(Alex|Jordan|Taylor|Morgan|Casey|Riley|Quinn|Avery|Jamie|Robin|Sasha|Devon) [A-Z][a-z]+( \d+)?$/.test(s) && LAST.some((l) => s.includes(` ${l}`));
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+\d[\d ()-]{7,}\d|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g;
const PROFILE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'<>)\]]*/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who is a person in this dossier: committee members and cells marked as names. Lowercase name to its invented one. */
function collectNames(d: Dossier): Map<string, string> {
  const names = new Map<string, string>();
  const add = (n: unknown) => {
    if (typeof n !== "string") return;
    const k = n.trim().toLowerCase();
    if (k.length >= 3 && !names.has(k)) names.set(k, placeholderName(names.size));
  };
  const blocks = [...d.sections, ...(d.overview ? [d.overview] : []), ...(d.plays ? [d.plays] : [])].flatMap((s) => s.blocks);
  for (const b of blocks) {
    if (b.kind === "committee") {
      for (const c of b.items) for (const m of c.members) add(m.name);
    } else if (b.kind === "table") {
      for (const c of b.columns) if (c.pii === "name") for (const r of b.rows) add(r[c.key]);
    } else if (b.kind === "kv") {
      for (const i of b.items) if (i.pii === "name") add(i.value);
    } else if (b.kind === "cards") {
      for (const c of b.items) {
        if (c.titlePii === "name") add(c.title);
        for (const r of c.rows ?? []) if (r.pii === "name") add(r.value);
      }
    }
  }
  return names;
}

/** Applies the name swap and the pattern scrubs to one string. */
function scrubText(s: string, names: Map<string, string>, order: string[]): string {
  let t = s;
  for (const k of order) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(k)}(?![\\p{L}\\p{N}])`, "giu"), names.get(k)!);
  return t.replace(PROFILE, "").replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");
}

/** Returns a copy of the dossier that is safe to share. Same sections, people reduced to role and title. */
export function safeDossier(d: Dossier): Dossier {
  const names = collectNames(d);
  const order = [...names.keys()].sort((a, b) => b.length - a.length);
  const s = (x: string) => scrubText(x, names, order);
  const who = (n: string) => names.get(n.trim().toLowerCase()) ?? s(n);

  const member = (m: Member): Member => ({
    role: m.role, name: who(m.name), title: s(m.title), email: "", emailStatus: "withheld in safe demo",
    linkedin: "", phone: "", phoneStatus: "withheld in safe demo",
  });
  const committee = (c: CommitteeCard): CommitteeCard => ({ account: s(c.account), domain: c.domain, grade: c.grade, ...(c.score !== undefined ? { score: c.score } : {}), members: c.members.map(member) });
  const piiValue = (v: unknown, pii: string | undefined): unknown => {
    if (pii === "email" || pii === "phone") return "";
    if (pii === "name") return typeof v === "string" ? who(v) : v;
    return typeof v === "string" ? s(v) : v;
  };
  const card = (c: Card): Card => {
    const { image: _image, links, ...rest } = c;
    return {
      ...rest,
      title: c.titlePii ? String(piiValue(c.title, c.titlePii)) : s(c.title),
      ...(c.sub ? { sub: s(c.sub) } : {}),
      ...(c.text ? { text: s(c.text) } : {}),
      ...(c.rows ? { rows: c.rows.map((r) => ({ ...r, value: String(piiValue(r.value, r.pii)) })) } : {}),
      ...(c.chips ? { chips: c.chips.map(s) } : {}),
      ...(c.command ? { command: s(c.command) } : {}),
      ...(links ? { links: links.filter((l) => !/linkedin\.com\/in\//i.test(l.href)).map((l) => ({ ...l, label: s(l.label) })) } : {}),
    };
  };
  const block = (b: Block): Block => {
    switch (b.kind) {
      case "text":
      case "note": return { ...b, text: s(b.text) };
      case "list": return { ...b, items: b.items.map(s) };
      case "kv": return { ...b, items: b.items.map((i) => ({ ...i, value: String(piiValue(i.value, i.pii)) })) };
      case "table": return { ...b, ...(b.caption ? { caption: s(b.caption) } : {}), rows: b.rows.map((r) => Object.fromEntries(b.columns.map((c) => [c.key, piiValue(r[c.key], c.pii)]).concat(Object.entries(r).filter(([k]) => !b.columns.some((c) => c.key === k)).map(([k, v]) => [k, typeof v === "string" ? s(v) : v])))) };
      case "cards": return { ...b, items: b.items.map(card) };
      case "bars": return { ...b, items: b.items.map((i) => ({ ...i, label: s(i.label) })) };
      case "committee": return { ...b, items: b.items.map(committee) };
      case "stat": return { ...b, items: b.items.map((i) => ({ ...i, value: s(i.value), ...(i.hint ? { hint: s(i.hint) } : {}) })) };
      case "more": return b;
    }
  };
  const section = (x: Section): Section => ({ ...x, blocks: x.blocks.map(block) });
  return { ...d, public: true, sections: d.sections.map(section), ...(d.overview ? { overview: section(d.overview) } : {}), ...(d.plays ? { plays: section(d.plays) } : {}) };
}

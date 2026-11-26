// The city dossier for looot.page (#24): the same safe dossier the private city page is built from,
// then made public. Third parties become Rival 1 / Account A (sector, size and score stay), their
// domains, logos, links, images and source URLs go, buying committees go, and internal cap or debug
// text becomes "partial: more on a paid run". looot-pages checks the result again and renders it with
// the same city renderer, so the shared page looks like the private one.
import type { Block, Card, Section } from "./dossier/blocks.js";
import type { Dossier } from "./dossier/index.js";
import { safeRun } from "./safeView.js";
import { applyThirdParties, thirdPartyLeaks, type ThirdParty } from "./thirdParties.js";

/** What replaces any cap or stop message on a public page. */
export const PARTIAL = "partial: more on a paid run";

/** A sentence that talks about the run's cap: the whole sentence becomes PARTIAL. */
const CAP_TEXT = /stopped at (?:its|the|their) cap|reached the cap|cap(?:ped)? reached|share of the cap|next call could cost|of [\d.]+ (?:USD|paid calls) used|budget_exceeded|spend limit/i;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;
/** Hostnames on common TLDs. Anything not the owner's or looot's becomes "a web source". */
const HOST_RE = /(?<![\p{L}\p{N}@.-])(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?!(?:md|json|ya?ml|csv|txt|html?|js|mjs|ts|tsx|xml|pdf|png|jpe?g|gif|svg|webp|css|py|sh|toml|lock|log)(?![\p{L}\p{N}-]))[a-z]{2,24})(?![\p{L}\p{N}-])(?:\/[^\s"'<>)\]]*)?/giu;
/** Columns and card fields that only carry a third party's address or a source link. */
const DROP_COLUMNS = new Set(["domain", "source", "url", "link", "href", "website", "linkedin", "email", "phone", "provider", "job", "trail", "charged"]);
/** Sections a public page does not show: people, and the run's step-by-step trail with its caps. */
const DROP_SECTIONS = new Set(["committee", "enrich"]);

const bare = (d: string) => d.trim().toLowerCase().replace(/^www\./, "");

/** One public string: third parties swapped, placeholder domains read as their label, URLs and other hosts removed, cap text replaced. */
export function publicText(s: string, own: string, tp: ThirdParty[]): string {
  let t = applyThirdParties(s, tp);
  t = t.replace(/(?:www\.)?rival-(\d+)\.example/gi, "Rival $1").replace(/(?:www\.)?account-([a-z]{1,2})\.example/gi, (_, l: string) => `Account ${l.toUpperCase()}`).replace(/(?:www\.)?customer-(\d+)\.example/gi, "Customer $1");
  t = t.replace(URL_RE, "").replace(HOST_RE, (m, h: string) => (bare(h).split("/")[0] === own || /(^|\.)looot\.(ai|page)$/.test(bare(h)) ? m : "a web source"));
  // No markup characters on a public page: looot-pages refuses < and >.
  t = t.replace(/</g, "‹").replace(/>/g, "›");
  if (CAP_TEXT.test(t)) {
    const parts = t.split(/(?<=[.;])\s+|,\s+(?=partial|stopped|next call)/).map((x) => (CAP_TEXT.test(x) ? PARTIAL : x));
    t = parts.filter((x, i) => x !== PARTIAL || parts[i - 1] !== PARTIAL).join(" ");
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

const isTrail = (b: Block) => b.kind === "table" && /provider trail|misses, failures|quoted and spent|every call/i.test(b.caption ?? "");
const isRunNote = (b: Block) => (b.kind === "note" || b.kind === "text") && /paid calls?, \$|lookups\. \d+ hit|receipt\.md|stopped at the cap|partial and shows/i.test(b.text);

function cleanBlock(b: Block, own: string, tp: ThirdParty[]): Block | null {
  const s = (x: string) => publicText(x, own, tp);
  const cap = (c?: string) => (c ? { caption: s(c) } : {});
  switch (b.kind) {
    case "committee": return null;
    case "more": return null;
    case "text": case "note": return { ...b, text: s(b.text) };
    case "list": return { ...b, items: b.items.map(s) };
    case "kv": return { ...b, items: b.items.filter((i) => !i.pii).map((i) => ({ label: s(i.label), value: s(i.value) })) };
    case "stat": return { ...b, items: b.items.filter((i) => !/\bcap\b/i.test(i.label)).map((i) => ({ ...i, label: s(i.label), value: s(i.value), ...(i.hint ? { hint: s(i.hint) } : {}) })) };
    case "bars": return { ...b, ...cap(b.caption), items: b.items.map((i) => ({ ...i, label: s(i.label) })) };
    case "cards": return { ...b, ...cap(b.caption), ...(b.empty ? { empty: s(b.empty) } : {}), items: b.items.map((c) => cleanCard(c, own, tp)) };
    case "table": {
      const columns = b.columns.filter((c) => !DROP_COLUMNS.has(c.key) && !c.pii).map(({ logoKey: _l, ...c }) => ({ ...c, label: s(c.label) }));
      const rows = b.rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, typeof r[c.key] === "string" ? s(r[c.key] as string) : Array.isArray(r[c.key]) ? (r[c.key] as unknown[]).map((x) => (typeof x === "string" ? s(x) : x)) : r[c.key]])));
      return { ...b, ...cap(b.caption), columns, rows };
    }
  }
}

function cleanCard(c: Card, own: string, tp: ThirdParty[]): Card {
  const s = (x: string) => publicText(x, own, tp);
  const { image: _i, links: _l, logo, command: _c, titlePii: _t, ...rest } = c;
  return {
    ...rest,
    title: s(c.title),
    ...(logo && bare(logo) === own ? { logo } : {}),
    ...(c.sub ? { sub: s(c.sub) } : {}),
    ...(c.text ? { text: s(c.text) } : {}),
    ...(c.tag ? { tag: s(c.tag) } : {}),
    ...(c.rows ? { rows: c.rows.filter((r) => !r.pii).map((r) => ({ label: s(r.label), value: s(r.value) })) } : {}),
    ...(c.chips ? { chips: c.chips.map(s) } : {}),
    ...(c.meter ? { meter: { ...c.meter, label: s(c.meter.label) } } : {}),
  };
}

function cleanSection(x: Section, own: string, tp: ThirdParty[]): Section {
  // The run log keeps its headline numbers only: no step table, cap or quote on a public page.
  const kept = x.id === "receipt" ? x.blocks.filter((b) => b.kind === "stat").map((b) => (b.kind === "stat" ? { ...b, items: b.items.filter((i) => !/cap|quote|worst/i.test(i.label)) } : b)) : x.blocks;
  const blocks = kept.filter((b) => !isTrail(b) && !isRunNote(b)).map((b) => cleanBlock(b, own, tp)).filter((b): b is Block => b !== null);
  const status = x.status === "capped" || x.status === "stopped" ? "partial" : x.status;
  return { num: x.num, id: x.id, title: publicText(x.title, own, tp), status, source: x.source ? "looot" : "", blocks };
}

/** A looot catalog job id, such as ads.meta.search. */
const JOB_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+){1,4}$/;

/** Makes a safe dossier public. Pure; throws when a third-party name or domain is still in it. */
export function publicDossier(d: Dossier, tp: ThirdParty[]): Dossier {
  const own = bare(d.domain);
  const sec = (x: Section) => cleanSection(x, own, tp);
  const out: Dossier = {
    domain: own,
    brand: d.brand,
    generatedAt: d.generatedAt,
    public: true,
    sections: d.sections.filter((x) => !DROP_SECTIONS.has(x.id)).map(sec),
    ...(d.overview ? { overview: sec(d.overview) } : {}),
    ...(d.plays ? { plays: sec(d.plays) } : {}),
    ...(d.ledger ? { ledger: d.ledger } : {}),
    // Your next plays: the top 5 and the goal fit counts. No Run it command on a public page; the deep pass below scrubs every why and prompt.
    ...(d.nextPlays?.length ? { nextPlays: d.nextPlays.slice(0, 5).map(({ runCommand: _r, triggers: _t, score: _s, ...p }) => p) as unknown as Dossier["nextPlays"] } : {}),
    ...(d.playFits ? { playFits: d.playFits } : {}),
    ...(d.goal ? { goal: d.goal } : {}),
  };
  // Every other string (bar display values, hints the blocks add later) gets the same pass.
  const KEEP = new Set(["kind", "id", "num", "view", "tone", "basis", "status", "key", "domain", "logo", "generatedAt", "day", "pii"]);
  const deep = (v: unknown, k = ""): unknown => (typeof v === "string" ? (KEEP.has(k) ? v : publicText(v, own, tp)) : Array.isArray(v) ? v.map((x) => deep(x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, deep(x, kk)])) : v);
  Object.assign(out, deep(out));
  // looot job ids (ads.meta.search) look like domains to the scrubber; they name a looot catalog job, not a third party, so put them back.
  out.nextPlays?.forEach((p, i) => {
    const jobs = (d.nextPlays?.[i]?.jobs ?? []).filter((j) => JOB_ID.test(j));
    p.jobs = jobs;
    p.prompt = p.prompt.replace(/Use these looot jobs with fallback on: [^.]*\./, `Use these looot jobs with fallback on: ${jobs.map((j) => `job:${j}`).join(", ")}.`);
  });
  const left = thirdPartyLeaks(JSON.stringify(out), tp);
  if (left.length > 0) throw Object.assign(new Error(`Not published: the city still names ${left.slice(0, 3).join(", ")}. Public pages name no rival or account.`), { at: leakPaths(out, tp) });
  return out;
}

/** The public city dossier of the run in outDir. */
export function publicCityDossier(outDir: string): Dossier {
  const r = safeRun(outDir);
  if (!r) throw new Error(`${outDir} has no saved run. Run looot-zeus run first.`);
  return publicDossier(r.d, r.tp);
}

/** Where in a dossier a third-party name or domain is left, for the error. */
function leakPaths(v: unknown, tp: ThirdParty[], p = "city", out: string[] = []): string[] {
  if (typeof v === "string") { if (thirdPartyLeaks(v, tp).length) out.push(p); }
  else if (Array.isArray(v)) v.forEach((x, i) => leakPaths(x, tp, `${p}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (thirdPartyLeaks(k, tp).length) out.push(`${p} key ${k}`); leakPaths(x, tp, `${p}.${k}`, out); }
  return out.slice(0, 10);
}

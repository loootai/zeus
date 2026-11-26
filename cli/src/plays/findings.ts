// The run's findings as short facts, one per topic, for the "Your next plays" matcher. Pure: module
// outputs in, facts out. Every fact is counted or quoted from the run's own rows; nothing is guessed.
// Each fact has two texts: `text` for the owner's private page (names accounts and rivals) and `safe`
// for a public or shared page (counts only, no account, rival, person or tool name).

/** What a finding is about. A play is triggered by the topics its own words name. */
export type Topic = "hiring" | "funding" | "news" | "rivals" | "ads" | "stack" | "seo" | "geo" | "readiness" | "accounts" | "reviews" | "mentions" | "committee";

/** One fact from the run. */
export interface Finding { topic: Topic; text: string; safe: string }

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: unknown) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso ?? "")); return m ? ` on ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ""; };
const clean = (s: unknown) => String(s ?? "").replace(/\s*\(placeholder[^)]*\)/gi, "").trim();
const lc1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Reads the facts the matcher may cite from the run's module outputs (state.json results.out). */
export function findingsOf(out: Record<string, Any>): Finding[] {
  const f: Finding[] = [];
  const add = (topic: Topic, text: string, safe: string) => f.push({ topic, text, safe });

  // Hiring, funding and news on the target accounts (signals module).
  const sig = arr(out.signals?.rows);
  for (const [type, topic, what] of [["hiring", "hiring", "open roles posted"], ["funding", "funding", "funding news"], ["news", "news", "company news"]] as const) {
    const rows = sig.filter((r) => r?.type === type && r.account && r.title);
    if (rows.length === 0) continue;
    const r = rows[0];
    const more = rows.length > 1 ? ` (${plural(rows.length - 1, "more target account")} too)` : "";
    add(topic, `${clean(r.account)}: ${lc1(clean(r.title))}${day(r.date)}${more}`, `${plural(rows.length, "target account")} with ${what} in the last 60 days`);
  }

  // Rivals (competitors module) and their named weak spots.
  const cards = arr(out.competitors?.cards).filter((c) => c?.name || c?.domain);
  if (cards.length > 0) {
    const names = cards.slice(0, 3).map((c) => clean(c.name || c.domain)).join(", ");
    const weak = cards.find((c) => arr(c.weakSpots).length > 0);
    add("rivals", `${plural(cards.length, "rival")} found: ${names}${weak ? `. ${clean(weak.name || weak.domain)}'s weak spot: ${clean(weak.weakSpots[0])}` : ""}`, `${plural(cards.length, "rival")} found${weak ? ", with weak spots named in their own pages and reviews" : ""}`);
    const stack = [...new Set(cards.flatMap((c) => arr(c.stack).map(clean)).filter(Boolean))];
    if (stack.length > 0) add("stack", `rivals run ${stack.slice(0, 4).join(", ")}`, `${plural(stack.length, "tool")} seen in the rivals' tech stacks`);
  }

  // Ads: rival advertisers, live ads and the angles nobody uses.
  const adv = arr(out.ads?.advertisers);
  const rivalAds = adv.filter((a) => !a?.you);
  const nAds = (a: Any) => (Number(a?.meta) || 0) + (Number(a?.linkedin) || 0) + (Number(a?.google) || 0);
  const totalRival = rivalAds.reduce((n, a) => n + nAds(a), 0);
  if (totalRival > 0) {
    const top = [...rivalAds].sort((a, z) => nAds(z) - nAds(a))[0];
    const nobody = arr(out.ads?.gaps?.nobody).map(clean).filter(Boolean);
    add("ads", `${clean(top.name)} runs ${plural(nAds(top), "live ad")}${arr(top.angles).length ? ` on "${clean(top.angles[0])}"` : ""}${nobody.length ? `; nobody advertises on ${lc1(nobody[0])}` : ""}`, `rivals run ${plural(totalRival, "live ad")}${nobody.length ? `; nobody advertises on ${lc1(nobody[0])}` : ""}`);
  }

  // Search: keyword gaps (SEO) and the AI answer share (GEO).
  const gaps = arr(out.seo?.gaps).filter((g) => g?.keyword);
  if (gaps.length > 0) {
    const g = [...gaps].sort((a, z) => (Number(z.volume) || 0) - (Number(a.volume) || 0))[0];
    const vol = Number(g.volume) > 0 ? ` (${Number(g.volume).toLocaleString("en-US")} US searches)` : "";
    add("seo", `${plural(gaps.length, "keyword gap")} a rival ranks for, the biggest "${clean(g.keyword)}"${vol}`, `${plural(gaps.length, "keyword gap")} a rival ranks for${vol ? ` (${Number(g.volume).toLocaleString("en-US")} US searches on the biggest)` : ""}`);
  }
  const ai = arr(out.seo?.ai).filter((a) => a?.status === "answered" || a?.status === undefined);
  if (ai.length > 0) {
    const named = ai.filter((a) => a.you === true).length;
    add("geo", `named in ${named} of ${plural(ai.length, "AI answer")} checked`, `named in ${named} of ${plural(ai.length, "AI answer")} checked`);
  }

  // Agent readiness of the company's own site.
  const you = arr(out.readiness?.rows).find((r) => r?.about === "you" && typeof r.score === "number");
  if (you) {
    const miss = clean(you.missing).split(",").map((s) => s.trim()).filter(Boolean);
    const t = `the site scores ${you.score}/100 for AI agents${miss.length ? `, missing ${miss.slice(0, 2).join(" and ")}` : ""}`;
    add("readiness", t, t);
  }

  // Target accounts and the ideal customer.
  const acc = arr(out.accounts?.rows);
  if (acc.length > 0) {
    const considered = Number(out.accounts?.considered) || acc.length;
    const a = acc.filter((r) => r?.grade === "A");
    add("accounts", `${plural(considered, "account")} scored, ${a.length} grade A${a[0]?.name ? `, led by ${clean(a[0].name)}` : ""}`, `${plural(considered, "account")} scored, ${a.length} grade A`);
  }
  const icpStack = arr(out.icp?.card?.stack).map(clean).filter(Boolean);
  if (icpStack.length > 0) add("stack", `your best customers run ${icpStack.slice(0, 3).join(", ")}`, `your best customers share ${plural(icpStack.length, "tool")} in their tech stack`);

  // Reviews: complaints about you and rivals' weak spots.
  const weakR = arr(out.reviews?.weakSpots).find((w) => w?.theme);
  const complaint = arr(out.reviews?.themes).find((t) => t?.tone === "complaint");
  if (weakR) add("reviews", `${plural(Number(weakR.count) || 0, "review")} of ${clean(weakR.competitor)} name "${clean(weakR.theme)}"`, `rival reviews name a weak spot ${plural(Number(weakR.count) || 0, "time")}`);
  else if (complaint) add("reviews", `${plural(Number(complaint.count) || 0, "review")} complain about "${clean(complaint.theme)}"`, `${plural(Number(complaint.count) || 0, "review")} name one complaint`);

  // Mentions: posts asking for a tool like yours.
  const intent = arr(out.mentions?.rows).filter((r) => r?.intent === true);
  if (intent.length > 0) add("mentions", `${plural(intent.length, "recent post")} on Reddit and the web ask for a tool like yours`, `${plural(intent.length, "recent post")} on Reddit and the web ask for a tool like yours`);

  // Buying committees mapped.
  const com = arr(out.committee?.accounts).filter((c) => arr(c?.members).length > 0);
  if (com.length > 0) add("committee", `${plural(com.length, "buying committee")} mapped`, `${plural(com.length, "buying committee")} mapped`);

  return f;
}

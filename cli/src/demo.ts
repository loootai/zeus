// Demo mode. No key, no network. Modules render their PLACEHOLDER fixtures and the receipt is
// invented from the quote with a fixed seed, so the page and video teams always get the same file.
// Provider names are real providers of each job (from the 30 Oct catalog check). Every outcome,
// charge and timing is made up and the receipt says so in its placeholder field.

import { withSingleProvider, type CallRecord } from "./client.js";
import type { GtmConfig } from "./config.js";
import { topoOrder } from "./modules/index.js";
import type { GtmModule, ModuleResult } from "./modules/types.js";
import type { Quote } from "./quote.js";
import { buildReceipt, type Receipt } from "./receipt.js";
import { round6 } from "./util.js";

export const PLACEHOLDER_RECEIPT_NOTE = "PLACEHOLDER receipt. Invented from the quote with a fixed seed for design work. No looot call was made. A real run replaces every number.";

/** First and second provider per job, as listed in the catalog on 2026-10-30. */
const PROVIDERS: Record<string, [string, string]> = {
  "web.scrape.markdown": ["Jina Reader", "Olostep"],
  "company.enrich": ["The Companies API", "Tomba"],
  "company.similar": ["The Companies API", "Tomba"],
  "company.technographics": ["Tomba", "PredictLeads"],
  "company.search": ["Anysite", "Icypeas"],
  "company.search.filtered": ["AI Ark", "AI Ark"],
  "people.search": ["Icypeas", "Dropleads"],
  "people.email.find": ["Kitt AI", "Findymail"],
  "people.email.verify": ["Dropleads", "MillionVerifier"],
  "people.phone.find": ["QuickEnrich", "Fundable"],
  "jobs.search": ["AnyAPI", "Anysite"],
  "company.funding": ["Aviato", "Datagma"],
  "news.search": ["Serper", "AnyAPI"],
  "linkedin.company.posts": ["ScrapeCreators", "HarvestAPI"],
  "ads.meta.search": ["ScrapeCreators", "SearchAPI.io"],
  "ads.linkedin.search": ["ScrapeCreators", "SearchAPI.io"],
  "ads.google.search": ["DataForSEO", "DataForSEO"],
  "keywords.domain.overview": ["DataForSEO", "DataForSEO"],
  "dataforseolabs.google.domain-intersection.live-ai": ["DataForSEO", "DataForSEO"],
  "google.serp.organic": ["Serper", "AnyAPI"],
  "google.serp.ai-mode": ["DataForSEO", "SearchAPI.io"],
  "chatgpt.search.answer": ["Bright Data", "Bright Data"],
  "reviews.appstore.reviews": ["SearchAPI.io", "SearchAPI.io"],
  "maps.place.reviews": ["Serper", "Anysite"],
  "reddit.post.search": ["ScrapeCreators", "Anysite"],
  "x.post.search": ["AnyAPI", "TikHub"],
  "company.traffic": ["Datagma", "Datagma"],
  "maps.local.search": ["Serper", "AnyAPI"],
  "amazon.product.get": ["SearchAPI.io", "SearchAPI.io"],
};

/** Small seeded generator, so the placeholder receipt is the same every time. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MISS_RATE: Record<string, number> = { "people.email.find": 0.22, "people.phone.find": 0.6, "company.funding": 0.3, "company.similar": 0.1 };

export interface PlaceholderOptions {
  cfg: GtmConfig;
  quote: Quote;
  mods: GtmModule[];
  results: Map<string, ModuleResult>;
  cap: number;
  startedAt?: Date;
  seed?: number;
}

/** Builds an invented, schema-valid receipt shaped like a real run of this quote. */
export function placeholderReceipt(o: PlaceholderOptions): Receipt {
  const rnd = mulberry32(o.seed ?? 20261030);
  const startedAt = o.startedAt ?? new Date("2026-10-30T09:00:00.000Z");
  const t0 = startedAt.getTime();
  const order = topoOrder(o.mods);
  const ends = new Map<string, number>();
  const timings = new Map<string, { startedAtMs: number; endedAtMs: number }>();
  const calls: CallRecord[] = [];
  const capped = new Set<string>();
  let runSpent = 0;
  for (const id of order) {
    const m = o.mods.find((x) => x.id === id)!;
    const start = Math.max(0, ...m.needs.map((n) => ends.get(n) ?? 0)) + 40;
    const row = o.quote.rows.find((r) => r.module === id);
    const ran = o.results.get(id)?.status === "done";
    let t = start;
    let secSpent = 0;
    let secCalls = 0;
    if (ran && row) {
      lines: for (const line of row.lines) {
        const [p1, p2] = PROVIDERS[line.job] ?? ["provider", "provider"];
        const unit = round6(line.expected / Math.max(1, line.calls));
        for (let k = 0; k < line.calls; k++) {
          // A real run stops a section at its own cap and the whole run at the run cap. So does this one.
          const ceiling = round6(unit * 1.6); // the dearest charge this placeholder makes
          if ((row.cap?.runs !== undefined && secCalls >= row.cap.runs) || (row.cap?.usd !== undefined && secSpent + ceiling > row.cap.usd) || runSpent + ceiling > o.cap) { capped.add(id); break lines; }
          const r = rnd();
          const miss = MISS_RATE[line.job] ?? 0.06;
          const ms = Math.round(300 + rnd() * 2400);
          // Calls of one line run 4 at a time.
          if (k % 4 === 0) t += ms;
          let rec: CallRecord;
          const ts = new Date(t0 + t).toISOString();
          if (r < 0.025) rec = { module: id, job: line.job, provider: p1, outcome: "fail", quoted: unit, charged: 0, ms, ts, note: "provider_timeout (provider)" };
          else if (r < 0.025 + miss / 2 && p1 !== p2) rec = { module: id, job: line.job, provider: p2, outcome: "fallback", fallbackFrom: p1, quoted: unit, charged: round6(unit * 1.6), ms: ms * 2, ts };
          else if (r < 0.025 + miss) rec = { module: id, job: line.job, provider: p1, outcome: "miss", quoted: unit, charged: rnd() < 0.3 ? unit : 0, ms, ts };
          else rec = { module: id, job: line.job, provider: p1, outcome: "hit", quoted: unit, charged: unit, ms, ts };
          calls.push(withSingleProvider(rec));
          secSpent = round6(secSpent + rec.charged);
          runSpent = round6(runSpent + rec.charged);
          secCalls++;
        }
      }
    }
    const end = t + (ran ? 120 : 0);
    ends.set(id, end);
    timings.set(id, { startedAtMs: start, endedAtMs: end });
  }
  const finishedAt = new Date(t0 + Math.max(...ends.values()) + 200);
  calls.sort((a, b) => a.ts.localeCompare(b.ts));
  return buildReceipt({
    domain: o.cfg.domain,
    mode: "demo",
    cap: o.cap,
    quote: o.quote,
    labels: Object.fromEntries(o.mods.map((m) => [m.id, m.label])),
    results: new Map([...o.results].map(([id, r]) => [id, capped.has(id) ? { ...r, status: "capped" as const, capScope: "section" as const } : r])),
    timings,
    calls,
    startedAt,
    finishedAt,
    capStopped: false,
    placeholder: PLACEHOLDER_RECEIPT_NOTE,
  });
}

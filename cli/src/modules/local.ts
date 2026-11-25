// Module 13, local presence (Astra fold). Runs only when it matters: the config lists local searches
// (a shop, office or service area). Otherwise it skips and says why. For each search it reads the
// Google local results and reports where you show up, your rating and who sits on top.
//
// Config (gtm/config.yaml): local.queries: ["crm consultant @ Amsterdam", "sales training @ London"]
// The part after @ is the location. Job: maps.local.search (8 providers, fallback on).

import type { CallRecord } from "../client.js";
import type { GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { answered, domainOf, emptyTally, fallbackText, fixture, frame, list, names, num, onDomain, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail } from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const LOCAL_JOB = "maps.local.search";

export function localSkip(cfg: GtmConfig): string | null {
  if (cfg.local.mode === "off") return "turned off in config";
  if (cfg.local.queries.length === 0) {
    return cfg.local.mode === "on"
      ? "turned on, but local.queries is empty in gtm/config.yaml"
      : "no physical locations in the config. Local presence matters for a shop, office or service area. Add local.queries to gtm/config.yaml to run it";
  }
  return null;
}

export function localQuote(cfg: GtmConfig): ModuleQuote {
  const skip = localSkip(cfg);
  if (skip) return { lines: [], skip };
  return { lines: [{ job: LOCAL_JOB, calls: cfg.local.queries.length, note: "Google local results per search" }] };
}

/** Signs in page text that a business serves people at a place. For intake to decide local.mode. */
export function looksLocal(text: string): boolean {
  return /opening hours|visit (us|our (store|shop|office|showroom))|our locations|find a (store|location)|get directions|walk-?ins? welcome/i.test(text);
}

/** "crm consultant @ Amsterdam" becomes { query: "crm consultant", location: "Amsterdam" }. */
export function splitQuery(q: string): { query: string; location?: string } {
  const [query, location] = q.split("@").map((s) => s.trim());
  return location ? { query, location } : { query };
}

export interface Place { position: number; name: string; rating: number | null; reviews: number | null; address: string; host: string | null }

export function parsePlaces(raw: unknown): Place[] {
  return list(raw, ["places", "local_results", "results", "items"]).flatMap((p, i) => {
    const name = str(p.title, p.name);
    if (!name) return [];
    return [{ position: num(p.position, p.rank) ?? i + 1, name, rating: num(p.rating) ?? null, reviews: num(p.ratingCount, p.reviews, p.reviews_count, p.user_ratings_total) ?? null, address: str(p.address, p.formatted_address) ?? "", host: domainOf(str(p.website, p.link)) }];
  });
}

export type LocalRow = { search: string; you: string; rating: string; reviews: string; top: string; status: string; provider: string; fallback: string };

export interface LocalOut {
  placeholder?: string;
  skipped?: boolean;
  summary: string;
  provider?: string;
  date?: string;
  rows: LocalRow[];
  calls?: string;
}

async function run(ctx: ModuleContext) {
  const cfg = ctx.cfg;
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const rows: LocalRow[] = [];
  const build = (): LocalOut => {
    const found = rows.filter((r) => r.you.startsWith("#")).length;
    const ordered = cfg.local.queries.map((q) => rows.find((r) => r.search === q)).filter((r): r is LocalRow => Boolean(r));
    return { summary: `listed on ${found} of ${rows.length} local searches`, provider: providersOf(calls), date: today(), rows: ordered, calls: tallyLine(t) };
  };
  try {
    await pool(cfg.local.queries, 4, async (q) => {
      const r = await tracked(ctx, t, calls, LOCAL_JOB, splitQuery(q), `local:${q}`);
      const places = answered(r) ? parsePlaces(r.data) : [];
      const mine = places.find((p) => onDomain(p.host, cfg.domain) || names(p.name, cfg.brand));
      rows.push({
        search: q,
        you: mine ? `#${mine.position}` : answered(r) ? "not listed" : "-",
        rating: mine?.rating !== null && mine?.rating !== undefined ? String(mine.rating) : "-",
        reviews: mine?.reviews !== null && mine?.reviews !== undefined ? String(mine.reviews) : "-",
        top: places[0] ? `${places[0].name}${places[0].rating ? ` (${places[0].rating})` : ""}` : "-",
        status: answered(r) ? "answered" : outcomeText(r.record),
        provider: trail(r.record),
        fallback: fallbackText(LOCAL_JOB),
      });
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`local: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: LocalOut): Block[] {
  // The placeholder fixture only has name and rating per place.
  if (o.rows.length && !("search" in o.rows[0])) return [{ kind: "table", columns: [{ key: "name", label: "Place" }, { key: "rating", label: "Rating" }], rows: o.rows as unknown as Record<string, unknown>[] }];
  return [{ kind: "table", columns: [{ key: "search", label: "Search" }, { key: "you", label: "You" }, { key: "rating", label: "Your rating" }, { key: "reviews", label: "Your reviews", num: true }, { key: "top", label: "Top result" }, { key: "status", label: "Answer" }, { key: "provider", label: "Provider" }], rows: o.rows as unknown as Record<string, unknown>[] }];
}

export const local: GtmModule = {
  id: "local",
  label: "Local",
  needs: ["intake"],
  quote: localQuote,
  async run(ctx) {
    const skip = localSkip(ctx.cfg);
    if (skip) return { status: "skipped", summary: skip, out: { skipped: true, summary: skip, rows: [] } };
    if (ctx.mode === "demo") {
      const f = fixture("local");
      return { status: f.skipped ? "skipped" : "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "10", id: "local", title: "Local presence", activate: "Ask happy customers for a review on the listings where you rank below the top 3" }, out, status, (o) => blocks(o as LocalOut)),
};

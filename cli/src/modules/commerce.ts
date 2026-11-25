// Module 14, commerce (Astra fold). Runs only when the domain sells products and the config lists
// Amazon ASINs. Covers Amazon listings only: amazon.product.get is the one verified e-commerce job.
// There is no Shopify store job (search lists shopify.store.products as unsupplied), so a store that
// sells only on its own site gets no commerce section.
//
// Config (gtm/config.yaml): commerce.asins: ["B0ABC12345"] for yours,
// commerce.competitors: { rival-a.com: ["B0XYZ98765"] } for theirs. The older inline form
// "rival-a.com:B0XYZ98765" in commerce.asins still works. Job: amazon.product.get (2 providers).

import type { CallRecord } from "../client.js";
import { asinEntries, type GtmConfig } from "../config.js";
import type { Block } from "../dossier/blocks.js";
import { answered, emptyTally, fallbackText, fixture, frame, nameOfDomain, num, obj, outcomeText, pool, providersOf, str, tallyLine, today, tracked, trail } from "./modc-helpers.js";
import type { GtmModule, ModuleContext, ModuleQuote } from "./types.js";

export const COMMERCE_JOB = "amazon.product.get";
export const AMAZON_ONLY = "Commerce covers Amazon listings only. looot has no Shopify or own-store job today.";

export function commerceSkip(cfg: GtmConfig): string | null {
  if (cfg.commerce.mode === "off") return "turned off in config";
  if (asinEntries(cfg).length === 0) return `the domain is not a store, or no Amazon ASINs are listed in gtm/config.yaml. ${AMAZON_ONLY}`;
  return null;
}

export function commerceQuote(cfg: GtmConfig): ModuleQuote {
  const skip = commerceSkip(cfg);
  if (skip) return { lines: [], skip };
  return { lines: [{ job: COMMERCE_JOB, calls: asinEntries(cfg).length, note: "Amazon only, one call per ASIN" }] };
}

/** Signs in page text that the site sells products. For intake to decide commerce.mode. */
export function looksLikeStore(text: string): boolean {
  // Strong signs only a shop has. "checkout" and "shop now" also show up on software sites (a top-up
  // checkout, an ad quoted in an example), so they count only next to a strong sign.
  const strong = [/add to (cart|bag|basket)/i, /free shipping/i, /\/products\//i, /\bin stock\b/i, /cdn\.shopify\.com|myshopify\.com/i].filter((re) => re.test(text)).length;
  const weak = [/\bcheckout\b/i, /\bshop now\b/i].filter((re) => re.test(text)).length;
  return strong >= 2 || (strong >= 1 && weak >= 1);
}

/** ASINs linked from page text (amazon.com/dp/B0... links). For intake to fill commerce.asins. */
export function asinsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/amazon\.[a-z.]+\/(?:[^\s)"']*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/gi)].map((m) => m[1].toUpperCase()))];
}

export function parseAsin(entry: string, domain: string): { owner: string; asin: string } {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+):([A-Z0-9]{10})$/i.exec(entry.trim());
  return m ? { owner: m[1].toLowerCase(), asin: m[2].toUpperCase() } : { owner: domain, asin: entry.trim().toUpperCase() };
}

export interface Product { name: string; price: string; rating: number | null; reviews: number | null; brand: string }

export function parseProduct(raw: unknown): Product | null {
  const r = obj(raw);
  const p = obj(r.product ?? obj(r.data).product ?? (Array.isArray(r.data) ? r.data[0] : r.data) ?? r);
  const name = str(p.title, p.name);
  if (!name) return null;
  const priceObj = obj(p.price);
  const buy = obj(obj(p.buybox_winner).price);
  const amount = num(priceObj.value, buy.value, p.final_price, p.price, p.extracted_price);
  const currency = str(priceObj.currency, buy.currency, p.currency) ?? "";
  const price = str(priceObj.raw, buy.raw, typeof p.price === "string" ? p.price : null) ?? (amount !== undefined ? `${currency ? `${currency} ` : ""}${amount}` : "-");
  return { name, price, rating: num(p.rating, p.stars) ?? null, reviews: num(p.reviews_count, p.ratings_total, p.reviews, p.ratings_count) ?? null, brand: str(p.brand, p.seller_name, obj(p.seller).name) ?? "-" };
}

export type CommerceRow = { whose: string; asin: string; name: string; price: string; rating: string; reviews: string; status: string; provider: string; fallback: string };

export interface CommerceOut {
  placeholder?: string;
  skipped?: boolean;
  summary: string;
  provider?: string;
  date?: string;
  rows: CommerceRow[];
  calls?: string;
}

async function run(ctx: ModuleContext) {
  const cfg = ctx.cfg;
  const t = emptyTally();
  const calls: CallRecord[] = [];
  const rows: CommerceRow[] = [];
  const items = asinEntries(cfg).map((a) => parseAsin(a, cfg.domain));
  const build = (): CommerceOut => {
    const read = rows.filter((r) => r.status === "answered").length;
    const ordered = items.map((i) => rows.find((r) => r.asin === i.asin)).filter((r): r is CommerceRow => Boolean(r));
    return { summary: `${read} of ${rows.length} Amazon listings read`, provider: providersOf(calls), date: today(), rows: ordered, calls: tallyLine(t) };
  };
  try {
    await pool(items, 4, async (it) => {
      const r = await tracked(ctx, t, calls, COMMERCE_JOB, { asin: it.asin }, `amazon:${it.asin}`);
      const p = answered(r) ? parseProduct(r.data) : null;
      rows.push({
        whose: it.owner === cfg.domain ? "you" : nameOfDomain(it.owner),
        asin: it.asin,
        name: p?.name ?? "-",
        price: p?.price ?? "-",
        rating: p?.rating !== null && p?.rating !== undefined ? String(p.rating) : "-",
        reviews: p?.reviews !== null && p?.reviews !== undefined ? String(p.reviews) : "-",
        status: p ? "answered" : answered(r) ? "answered, no product" : outcomeText(r.record),
        provider: trail(r.record),
        fallback: fallbackText(COMMERCE_JOB),
      });
      ctx.partial(build());
    });
  } catch (e) {
    ctx.partial(build());
    throw e;
  }
  const out = build();
  ctx.log(`commerce: ${out.summary} (${out.calls})`);
  return { status: "done" as const, summary: out.summary, out };
}

function blocks(o: CommerceOut): Block[] {
  return [
    { kind: "table", columns: [{ key: "whose", label: "Whose" }, { key: "name", label: "Product" }, { key: "asin", label: "ASIN" }, { key: "price", label: "Price" }, { key: "rating", label: "Rating" }, { key: "reviews", label: "Reviews", num: true }, { key: "status", label: "Answer" }, { key: "provider", label: "Provider" }], rows: o.rows as unknown as Record<string, unknown>[] },
    { kind: "note", text: AMAZON_ONLY },
  ];
}

export const commerce: GtmModule = {
  id: "commerce",
  label: "Commerce",
  needs: ["intake"],
  quote: commerceQuote,
  async run(ctx) {
    const skip = commerceSkip(ctx.cfg);
    if (skip) return { status: "skipped", summary: skip, out: { skipped: true, summary: skip, rows: [] } };
    if (ctx.mode === "demo") {
      const f = fixture("commerce");
      return { status: f.skipped ? "skipped" : "done", summary: f.summary, out: f };
    }
    return run(ctx);
  },
  render: (out, status) => frame({ num: "10", id: "commerce", title: "Commerce, Amazon listings", activate: "Compare your price and rating with the rival listings" }, out, status, (o) => blocks(o as CommerceOut)),
};

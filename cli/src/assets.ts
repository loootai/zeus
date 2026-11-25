// Real assets for the dossier: a logo for you, every rival and every account, and the ad creatives.
// Downloaded at the end of a run (plain web requests, no looot call, no charge) into gtm/assets/,
// with gtm/assets/index.json as the list. Logos are embedded in dossier.html as data: URIs so the page
// works offline. Ad creatives stay files under gtm/assets/ads/ and load when their card scrolls in.
// The logo source is the one company.enrich gave (profiles in the brief), else Google's favicon
// service. A logo that cannot be fetched becomes a lettered tile. The public copy shows no logo and
// no creative, so nothing in an image can name a rival or an account.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GtmConfig } from "./config.js";
import { defaultResolver, guardedFetch, type Resolver } from "./netGuard.js";

export interface AssetIndex {
  logos: Record<string, { file: string; mime: string; from: string }>;
  ads: Record<string, { file: string; mime: string }>;
}

const INDEX = "assets/index.json";
const MAX_BYTES = 400_000;
/** Ad creatives are full size photos: Meta's signed fbcdn images run 450 to 800 KB, so they get a larger limit. */
export const AD_MAX_BYTES = 2_500_000;

/** One image, tried twice: a signed CDN link or a slow host often answers on the second try. */
export async function fetchImageRetry(url: string, f: typeof fetch = fetch, maxBytes = MAX_BYTES, resolve?: Resolver): Promise<{ bytes: Buffer; mime: string } | null> {
  return (await fetchImage(url, f, maxBytes, resolve)) ?? (await fetchImage(url, f, maxBytes, resolve));
}
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };

export const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

/** One image, or null when it is not an image, too big, or the request failed. */
export async function fetchImage(url: string, f: typeof fetch = fetch, maxBytes = MAX_BYTES, resolve?: Resolver): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const res = await guardedFetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; looot-zeus assets)" }, signal: AbortSignal.timeout(10_000) }, { fetch: f, resolve: resolve ?? defaultResolver(f) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 60 || bytes.length > maxBytes) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

export function readAssetIndex(outDir: string): AssetIndex {
  const p = join(outDir, INDEX);
  if (!existsSync(p)) return { logos: {}, ads: {} };
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Partial<AssetIndex>;
    return { logos: j.logos ?? {}, ads: j.ads ?? {} };
  } catch {
    return { logos: {}, ads: {} };
  }
}

async function poolRun<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Every domain the dossier draws a logo for: you, the rivals, the accounts and the committee companies. */
export function logoDomains(cfg: GtmConfig, outputs: Record<string, any>): string[] {
  const out = new Set<string>([cfg.domain, ...cfg.competitors]);
  for (const r of outputs.accounts?.rows ?? []) if (r?.domain) out.add(String(r.domain));
  for (const a of outputs.committee?.accounts ?? []) if (a?.domain) out.add(String(a.domain));
  for (const b of outputs.social?.brands ?? []) if (b?.domain) out.add(String(b.domain));
  return [...out].filter((d) => d.includes("."));
}

/**
 * Downloads the logos and the ad creatives the dossier shows. Ads get imageFile set (relative to gtm/).
 * Returns what was saved. Never throws: a failed image only means a lettered tile or no creative.
 */
export async function collectAssets(outDir: string, cfg: GtmConfig, outputs: Record<string, any>, f: typeof fetch = fetch): Promise<{ logos: number; ads: number; missed: number }> {
  const idx = readAssetIndex(outDir);
  mkdirSync(join(outDir, "assets", "logos"), { recursive: true });
  mkdirSync(join(outDir, "assets", "ads"), { recursive: true });
  let missed = 0;
  const domains = logoDomains(cfg, outputs).filter((d) => !idx.logos[d]);
  await poolRun(domains, 6, async (d) => {
    const sources = [cfg.profiles?.[d]?.logo, faviconUrl(d)].filter((x): x is string => !!x && /^https?:\/\//.test(x));
    for (const src of sources) {
      const img = await fetchImageRetry(src, f);
      if (!img) continue;
      const file = `assets/logos/${d.replace(/[^a-z0-9.-]/gi, "_")}.${EXT[img.mime] ?? "img"}`;
      writeFileSync(join(outDir, file), img.bytes);
      idx.logos[d] = { file, mime: img.mime, from: src };
      return;
    }
    missed++;
  });
  const ads: any[] = [];
  for (const a of outputs.ads?.advertisers ?? []) for (const ad of [...(a.ads ?? [])].sort((x: any, y: any) => String(y.firstSeen ?? "").localeCompare(String(x.firstSeen ?? ""))).slice(0, 9)) if (ad?.image) ads.push(ad);
  let adCount = 0;
  await poolRun(ads, 6, async (ad) => {
    const key = createHash("sha1").update(String(ad.image)).digest("hex").slice(0, 16);
    const have = idx.ads[key];
    if (have && existsSync(join(outDir, have.file))) {
      ad.imageFile = have.file;
      adCount++;
      return;
    }
    const img = await fetchImageRetry(String(ad.image), f, AD_MAX_BYTES);
    if (!img) {
      missed++;
      return;
    }
    const file = `assets/ads/${key}.${EXT[img.mime] ?? "img"}`;
    writeFileSync(join(outDir, file), img.bytes);
    idx.ads[key] = { file, mime: img.mime };
    ad.imageFile = file;
    adCount++;
  });
  writeFileSync(join(outDir, INDEX), JSON.stringify(idx, null, 2) + "\n");
  return { logos: Object.keys(idx.logos).length, ads: adCount, missed };
}

// ---- the logo registry the HTML writer reads ---------------------------------------------------

let LOGOS = new Map<string, string>();

/** Loads the saved logos as data: URIs, for the HTML writer. */
export function loadLogos(outDir: string): void {
  const idx = readAssetIndex(outDir);
  const m = new Map<string, string>();
  for (const [d, l] of Object.entries(idx.logos)) {
    const p = join(outDir, l.file);
    if (!existsSync(p)) continue;
    m.set(d, `data:${l.mime};base64,${readFileSync(p).toString("base64")}`);
  }
  LOGOS = m;
}

export function setLogos(m: Map<string, string>): void {
  LOGOS = m;
}

export const logoData = (domain: string): string | undefined => LOGOS.get(domain.toLowerCase().replace(/^www\./, ""));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A logo tile for a domain: the saved logo, else the first letter of the name. In the public copy
 * every tile is blank, so no logo or letter names a rival or an account.
 */
export function logoHtml(domain: string, name: string, pub: boolean, size = 28): string {
  if (pub) return `<span class="lg" style="--s:${size}px" aria-hidden="true"></span>`;
  const src = logoData(domain);
  if (src) return `<span class="lg" style="--s:${size}px"><img class="lg-i" src="${src}" alt="" width="${size}" height="${size}"></span>`;
  const letter = (name.trim()[0] ?? domain[0] ?? "?").toUpperCase();
  return `<span class="lg tile" style="--s:${size}px" aria-hidden="true">${esc(letter)}</span>`;
}

/** The public copy keeps no logo, no letter tile and no creative. */
export function stripAssets(html: string): string {
  return html
    .replace(/<span class="lg[^"]*" style="--s:(\d+)px"[^>]*>[\s\S]*?<\/span>/g, '<span class="lg" style="--s:$1px" aria-hidden="true"></span>')
    .replace(/<img [^>]*data-src="assets\/[^"]*"[^>]*>/g, "")
    .replace(/(<span class="mark" aria-hidden="true">)<img [^>]*>(<\/span>)/g, "$1Y$2");
}

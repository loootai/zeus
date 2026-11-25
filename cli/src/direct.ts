// `init --direct`: reads the four intake pages straight from the site with fetch, no looot key and
// no charge. Useful to try init before adding a token. Only web.scrape.markdown is supported.
// The receipt marks these rows with provider "direct fetch" and $0.

import type { CallOptions, CallResult, JobRunner } from "./client.js";
import { defaultResolver, guardedFetch, type Resolver } from "./netGuard.js";

/** Rough HTML to markdown: headings, links and paragraphs kept, scripts and styles dropped. */
export function htmlToMarkdown(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  let s = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Images keep their alt text, so customer logos ("Acme logo") survive as words.
    .replace(/<img\s[^>]*>/gi, (tag) => {
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "";
      return alt ? ` ![${alt.replace(/[[\]]/g, "")}](${src}) ` : " ";
    })
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n${"#".repeat(Number(n))} ${t}\n`)
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `[${t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}](${href})`)
    .replace(/<(br|\/p|\/div|\/li|\/section|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return `${title ? `Title: ${title}\n\n` : ""}${s}`;
}

export class DirectRunner implements JobRunner {
  constructor(
    private readonly f: typeof fetch = fetch,
    /** DNS for the address check. Default real DNS with the global fetch, none with a test fake. */
    private readonly resolve: Resolver | undefined = defaultResolver(f),
  ) {}

  async call(job: string, input: Record<string, unknown>, opts: CallOptions): Promise<CallResult> {
    if (job !== "web.scrape.markdown") throw new Error(`--direct can only read pages. ${job} needs a looot key.`);
    const started = Date.now();
    const url = String(input.url);
    let markdown = "";
    let outcome: "hit" | "miss" | "fail" = "fail";
    let note: string | undefined;
    try {
      const res = await guardedFetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; looot-zeus init)", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) }, { fetch: this.f, resolve: this.resolve });
      if (res.ok) {
        markdown = htmlToMarkdown(await res.text());
        outcome = markdown.length > 200 ? "hit" : "miss";
      } else {
        outcome = res.status === 404 || res.status === 410 ? "miss" : "fail";
        note = `HTTP ${res.status}`;
      }
    } catch (e) {
      note = (e as Error).message;
    }
    const ms = Date.now() - started;
    return {
      record: { module: opts.module, job, provider: "direct fetch", outcome, quoted: 0, charged: 0, ms, ts: new Date(started).toISOString(), ...(note ? { note } : {}) },
      run: { runId: "", status: "completed" },
      data: { markdown },
    };
  }
}

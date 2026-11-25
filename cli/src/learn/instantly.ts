// Optional. Reads replies straight from Instantly when INSTANTLY_API_KEY is set. Read only: one kind
// of request, GET /api/v2/emails with email_type=received, the endpoint in Instantly's API v2 docs
// (developer.instantly.ai/api-reference/email/list-email). Each item names the lead's email in
// `lead`; ue_type 2 is a received email and is_auto_reply 1 marks an auto reply, which is skipped.
// No POST, PATCH or DELETE exists in this file. Without the key, learn uses the CSV only.
// The key is sent as a Bearer header and is never printed or written anywhere.

import type { Outcome } from "./results.js";
import { keyOf } from "./schema.js";

export const INSTANTLY_BASE = "https://api.instantly.ai";
export const INSTANTLY_PATH = "/api/v2/emails";
/** 100 items per page, at most 10 pages per learn. The endpoint allows 20 requests a minute. */
export const PAGE = 100;
export const MAX_PAGES = 10;

export interface InstantlyPull {
  outcomes: Outcome[];
  pages: number;
  note: string;
}

export interface InstantlyDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/** The read-only request URL for one page. Exported for the tests. */
export function pageUrl(campaignId: string | undefined, after: string | undefined): string {
  const u = new URL(INSTANTLY_PATH, INSTANTLY_BASE);
  u.searchParams.set("email_type", "received");
  u.searchParams.set("limit", String(PAGE));
  if (campaignId) u.searchParams.set("campaign_id", campaignId);
  if (after) u.searchParams.set("starting_after", after);
  return u.toString();
}

/**
 * Pulls replies. Returns null when INSTANTLY_API_KEY is not set, so the caller skips it cleanly.
 * INSTANTLY_CAMPAIGN_ID (or the campaignId argument) narrows it to one campaign.
 */
export async function pullInstantly(o: { campaignId?: string } = {}, deps: InstantlyDeps = {}): Promise<InstantlyPull | null> {
  const env = deps.env ?? process.env;
  const key = env.INSTANTLY_API_KEY;
  if (!key) return null;
  const f = deps.fetch ?? fetch;
  const campaignId = o.campaignId ?? env.INSTANTLY_CAMPAIGN_ID;
  const replied = new Set<string>();
  let after: string | undefined;
  let pages = 0;
  let note = "";
  while (pages < MAX_PAGES) {
    let res: Response;
    try {
      res = await f(pageUrl(campaignId, after), { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    } catch (e) {
      note = `Instantly did not answer (${(e as Error).message.slice(0, 80)}), so only the CSV was used.`;
      break;
    }
    pages++;
    if (!res.ok) {
      note = res.status === 401 ? "Instantly said the key is not valid (401). Only the CSV was used." : res.status === 429 ? "Instantly asked to slow down (429). The replies read so far were kept." : `Instantly answered ${res.status}. Only the CSV was used.`;
      break;
    }
    const body = (await res.json().catch(() => ({}))) as { items?: any[]; next_starting_after?: string };
    for (const it of body.items ?? []) {
      if (it?.ue_type !== undefined && it?.ue_type !== null && Number(it.ue_type) !== 2) continue;
      if (Number(it?.is_auto_reply) === 1) continue;
      const email = keyOf(it?.lead);
      if (email.includes("@")) replied.add(email);
    }
    after = body.next_starting_after;
    if (!after || (body.items ?? []).length === 0) break;
  }
  if (!note && pages >= MAX_PAGES && after) note = `Read the first ${MAX_PAGES * PAGE} replies from Instantly.`;
  return {
    outcomes: [...replied].map((email) => ({ email, replied: true, bounced: false, meeting: false, interested: false })),
    pages,
    note: note || `Read ${replied.size} replies from Instantly in ${pages} ${pages === 1 ? "page" : "pages"}.`,
  };
}

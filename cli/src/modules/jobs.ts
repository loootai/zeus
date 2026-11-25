// Every looot job /gtm calls, checked on 30 Oct 2026 with free calls only (MCP search with
// filters.capability and prefer cheapest, plus GET /v1/catalog/overview?topic=<job id>).
// No paid run was made to build this table.
//
// typicalUsd   the price of the cheapest runnable endpoint seen with real runs, per call
//              (basis "call") or per result row (basis "result"). Used for the expected column.
// capUsd       the per-call ceiling sent as fallback.maxCostUsd. Used for the worst-case column.
// providers    runnable providers for the job on the platform key that day.
// sample       one endpoint id that does the job, as seen in search. Runs go to job:<id> anyway.

export interface JobInfo {
  id: string;
  verified: boolean;
  verifiedAt: string;
  providers: number;
  basis: "call" | "result";
  typicalUsd: number;
  /** For result-priced jobs, how many rows one call usually asks for. */
  rowsPerCall?: number;
  capUsd: number;
  sample: string;
  /** One provider only, so a miss has no fallback. The dossier says so on every row. */
  singleProvider: boolean;
  /** How long to keep reading a slow async run before the row says "still running". Default 120 s. */
  pollTimeoutMs?: number;
  note?: string;
  /** Runs this one endpoint instead of letting looot route the job. For a filter only one provider reads. */
  endpoint?: string;
}

const V = "2026-10-30";

const list: JobInfo[] = [
  { id: "web.scrape.markdown", verified: true, verifiedAt: V, providers: 10, basis: "call", typicalUsd: 0.0002, capUsd: 0.01, sample: "jina-reader", singleProvider: false },
  { id: "company.enrich", verified: true, verifiedAt: V, providers: 22, basis: "call", typicalUsd: 0.0019, capUsd: 0.02, sample: "thecompaniesapi-companies", singleProvider: false },
  { id: "company.similar", verified: true, verifiedAt: V, providers: 4, basis: "result", typicalUsd: 0.0019, rowsPerCall: 10, capUsd: 0.05, sample: "thecompaniesapi-companies-similar", singleProvider: false },
  { id: "company.technographics", verified: true, verifiedAt: V, providers: 5, basis: "call", typicalUsd: 0.0089, capUsd: 0.02, sample: "tomba-technology", singleProvider: false, note: "BuiltWith free counts cost $0, full stacks from $0.0089" },
  { id: "company.search", verified: true, verifiedAt: V, providers: 25, basis: "result", typicalUsd: 0.00036, rowsPerCall: 25, capUsd: 0.05, sample: "anysite-api-linkedin-search-companies", singleProvider: false },
  { id: "company.search.filtered", verified: true, verifiedAt: "2026-11-03", providers: 1, basis: "result", typicalUsd: 0.0012, rowsPerCall: 25, capUsd: 0.05, sample: "ai-ark-companies", endpoint: "ai-ark-companies", singleProvider: true, note: "company.search pinned to AI Ark, the provider that reads a size, industry and country filter. Routed company.search went to Tomba on 3 Nov and came back empty" },
  { id: "people.search", verified: true, verifiedAt: V, providers: 21, basis: "result", typicalUsd: 0.00038, rowsPerCall: 5, capUsd: 0.02, sample: "icypeas-find-people", singleProvider: false },
  { id: "people.email.find", verified: true, verifiedAt: V, providers: 17, basis: "call", typicalUsd: 0.0036, capUsd: 0.03, sample: "kittai-find-email", singleProvider: false },
  { id: "people.email.verify", verified: true, verifiedAt: V, providers: 13, basis: "call", typicalUsd: 0.00145, capUsd: 0.01, sample: "dropleads-email-verifier", singleProvider: false },
  { id: "people.phone.find", verified: true, verifiedAt: V, providers: 12, basis: "call", typicalUsd: 0.00483, capUsd: 0.06, sample: "quickenrich-api-employees-phone-search", singleProvider: false, note: "cheapest provider hit rate was 2.7% over 4,001 runs" },
  { id: "people.phone.find.mobile", verified: true, verifiedAt: "2026-11-05", providers: 1, basis: "call", typicalUsd: 0.099, capUsd: 0.11, sample: "leadmagic-people-mobile-finder", endpoint: "leadmagic-people-mobile-finder", singleProvider: true, note: "second step of the phone waterfall, LeadMagic's mobile finder pinned. A not found was not billed in the 5 Nov runs" },
  { id: "people.phone.find.deep", verified: true, verifiedAt: "2026-11-05", providers: 1, basis: "call", typicalUsd: 0.2, capUsd: 0.21, sample: "limadata-api-find-phone", endpoint: "limadata-api-find-phone", singleProvider: true, note: "last step of the phone waterfall, Limadata pinned. Bills $0.20 only when a phone is found, a not found is free" },
  { id: "jobs.search", verified: true, verifiedAt: V, providers: 8, basis: "call", typicalUsd: 0.0005, capUsd: 0.03, sample: "anyapi-run-linkedin-jobs-thin", singleProvider: false },
  { id: "company.funding", verified: true, verifiedAt: V, providers: 3, basis: "call", typicalUsd: 0.05, capUsd: 0.07, sample: "aviato-company-funding-rounds", singleProvider: false, note: "Aviato $0.05 is the provider that answers most often. PredictLeads is $0.01 but answered about a third of the time. Datagma $0.06532" },
  { id: "news.search", verified: true, verifiedAt: V, providers: 8, basis: "call", typicalUsd: 0.001, capUsd: 0.01, sample: "serper-news", singleProvider: false },
  { id: "linkedin.company.posts", verified: true, verifiedAt: V, providers: 3, basis: "call", typicalUsd: 0.00188, capUsd: 0.01, sample: "scrapecreators-linkedin-company-posts", singleProvider: false },
  { id: "ads.meta.search", verified: true, verifiedAt: V, providers: 3, basis: "call", typicalUsd: 0.00188, capUsd: 0.01, sample: "scrapecreators-facebook-adlibrary-search-ads-get", singleProvider: false },
  { id: "ads.linkedin.search", verified: true, verifiedAt: V, providers: 4, basis: "call", typicalUsd: 0.00188, capUsd: 0.01, sample: "scrapecreators-linkedin-ads-search", singleProvider: false },
  { id: "ads.google.search", verified: true, verifiedAt: V, providers: 1, basis: "call", typicalUsd: 0.002, capUsd: 0.01, sample: "dataforseo-google-ads-search-advanced", singleProvider: true, note: "2 providers listed, 1 runnable on the platform key" },
  { id: "google.company.ads", verified: true, verifiedAt: "2026-11-03", providers: 1, basis: "call", typicalUsd: 0.00188, capUsd: 0.01, sample: "scrapecreators-google-company-ads", singleProvider: true, note: "Google Ads Transparency by the advertiser's domain. Checked with a paid run on 3 Nov 2026" },
  { id: "keywords.domain.overview", verified: true, verifiedAt: V, providers: 1, basis: "call", typicalUsd: 0.012, capUsd: 0.02, sample: "dataforseo-dataforseo-labs-google-domain-rank-overview-live-ai", singleProvider: true },
  { id: "dataforseolabs.google.domain-intersection.live-ai", verified: true, verifiedAt: V, providers: 1, basis: "call", typicalUsd: 0.012, capUsd: 0.02, sample: "dataforseo-dataforseo-labs-google-domain-intersection-live-ai", singleProvider: true, note: "the spec called it domain-intersection, this is the live job id" },
  { id: "google.serp.organic", verified: true, verifiedAt: V, providers: 8, basis: "call", typicalUsd: 0.001, capUsd: 0.01, sample: "serper-search", singleProvider: false },
  { id: "google.serp.ai-mode", verified: true, verifiedAt: V, providers: 4, basis: "call", typicalUsd: 0.004, capUsd: 0.02, sample: "dataforseo-google-ai-mode-advanced", singleProvider: false },
  { id: "chatgpt.search.answer", verified: true, verifiedAt: V, providers: 1, basis: "result", typicalUsd: 0.0015, rowsPerCall: 1, capUsd: 0.01, sample: "brightdata-chatgpt-answer", singleProvider: true, pollTimeoutMs: 240_000, note: "async, p50 about 80 seconds, so the client waits up to 240 seconds" },
  { id: "reviews.appstore.reviews", verified: true, verifiedAt: V, providers: 1, basis: "call", typicalUsd: 0.004, capUsd: 0.01, sample: "searchapi-io-apple-product-reviews", singleProvider: true },
  { id: "maps.place.reviews", verified: true, verifiedAt: V, providers: 4, basis: "call", typicalUsd: 0.001, capUsd: 0.01, sample: "serper-reviews", singleProvider: false },
  { id: "reddit.post.search", verified: true, verifiedAt: V, providers: 2, basis: "call", typicalUsd: 0.00188, capUsd: 0.01, sample: "scrapecreators-reddit-search", singleProvider: false },
  { id: "x.post.search", verified: true, verifiedAt: V, providers: 3, basis: "call", typicalUsd: 0.00075, capUsd: 0.01, sample: "anyapi-run-twitter-search", singleProvider: false },
  { id: "company.traffic", verified: true, verifiedAt: V, providers: 1, basis: "call", typicalUsd: 0.06532, capUsd: 0.07, sample: "datagma-website-traffic", singleProvider: true },
  { id: "maps.local.search", verified: true, verifiedAt: V, providers: 8, basis: "call", typicalUsd: 0.001, capUsd: 0.01, sample: "serper-places", singleProvider: false },
  { id: "amazon.product.get", verified: true, verifiedAt: V, providers: 2, basis: "call", typicalUsd: 0.004, capUsd: 0.02, sample: "searchapi-io-amazon-product", singleProvider: false, note: "commerce covers Amazon listings only, no Shopify store job exists (search names shopify.store.products as unsupplied)" },
  { id: "web.agent.readiness", verified: true, verifiedAt: "2026-11-25", providers: 1, basis: "call", typicalUsd: 0.005, capUsd: 0.01, sample: "web-agent-readiness", singleProvider: true, note: "looot's own check, $0.005 a call from the catalog seed; a site that does not answer is a $0 miss" },
  { id: "domain.rdap.lookup", verified: true, verifiedAt: "2026-11-25", providers: 5, basis: "call", typicalUsd: 0, capUsd: 0.001, sample: "looot-rdap-domain", singleProvider: false, note: "free RDAP lookup ($0 in the seed); the 0.001 ceiling only bounds a price change" },
];

export const JOBS: Record<string, JobInfo> = Object.fromEntries(list.map((j) => [j.id, j]));

/** Asks the spec made that no live job answers today. Listed in the dossier as limits. */
export const UNVERIFIED: { ask: string; why: string }[] = [
  { ask: "shopify.store.products (commerce on a Shopify store)", why: "search returns it under unsuppliedJobs, no provider" },
  { ask: "Perplexity, Gemini and Copilot answers for GEO", why: "job ids were not confirmed, only ChatGPT and Google AI Mode are used" },
  { ask: "G2, Capterra and Trustpilot reviews", why: "no B2B review site job surfaced in search" },
  { ask: "market size inputs", why: "no job returns a market size, the market module uses traffic, funding, hiring and news" },
];

export function job(id: string): JobInfo {
  const j = JOBS[id];
  if (!j) throw new Error(`Unknown job ${id}. Every job must be listed in src/modules/jobs.ts with a verified id.`);
  return j;
}

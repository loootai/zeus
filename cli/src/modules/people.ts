// Module 3, people. Scored accounts in, the best two buyers per account out.
// One people.search per account (A grades first) on the account domain and a title keyword taken
// from the ICP titles. The answer is ranked here on the full title list and seniority, so a loose
// provider match still yields the right two people. Some people.search providers mask names; a
// masked name is kept and flagged. Enrich does not spend an email lookup on it.
// The dossier shows people inside the enrich section (03). When enrich ends with no rows (capped
// before it started, or every lookup came back empty), people render their own section instead.

import type { GtmConfig } from "../config.js";
import { loadFixture } from "./fixture.js";
import type { GtmModule, ModuleContext } from "./types.js";
import type { AccountRow, AccountsOut } from "./accounts.js";
import { matchTerm, type WithLearnings } from "./accounts.js";
import { keyOf } from "../learn/schema.js";
import { answered, type CallTrail, costNote, first, isObj, type Obj, payloads, pool, rowsOf, shell, tally, today, trailLine } from "./icp.js";

export interface PersonRow {
  account: string;
  domain: string;
  grade: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  linkedin: string;
  /** An email the people provider returned itself, if any. Enrich verifies it instead of finding one. */
  email: string;
  /** The provider masked the name, so no email lookup is made for it. */
  masked: boolean;
  provider: string;
  date: string;
}

export interface PeopleOut {
  placeholder?: string;
  summary: string;
  provider?: string;
  date?: string;
  rows: PersonRow[];
  searched?: number;
  calls?: CallTrail[];
}

const GENERIC = new Set(["head", "of", "vp", "vice", "president", "chief", "officer", "director", "manager", "senior", "lead", "the", "and", "global", "c", "level"]);

/** The word most ICP titles share, sent as the provider title filter. "Head of Sales", "VP Sales" give "sales". */
export function titleKeyword(titles: string[]): string {
  const count = new Map<string, number>();
  for (const t of titles) for (const w of new Set(t.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2 && !GENERIC.has(x)))) count.set(w, (count.get(w) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : titles[0] ?? "";
}

const SENIOR = /\b(founder|co-founder|owner|ceo|chief|cro|cmo|coo|president|vp|vice president|head|director|partner)\b/i;

/**
 * Higher is better. Exact ICP title 3, keyword in title 2, senior word 1. With learned title
 * weights (run --apply-learnings), an exact ICP title also gets 2 x (weight - 1), so a title that
 * got more replies ranks first and one that got fewer drops behind.
 */
export function titleRank(title: string, titles: string[], keyword: string, weights?: Record<string, number>): number {
  if (!title) return 0;
  let n = 0;
  const hit = matchTerm(title, titles);
  if (hit) n += 3 + (weights ? 2 * ((weights[keyOf(hit)] ?? weights[keyOf(title)] ?? 1) - 1) : 0);
  else if (keyword && title.toLowerCase().includes(keyword)) n += 2;
  if (SENIOR.test(title)) n += 1;
  return n;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** One person from a provider row, whatever the provider called the fields. null when there is no name and no LinkedIn. */
export function normalizePerson(r: Obj): Omit<PersonRow, "account" | "domain" | "grade" | "provider" | "date"> | null {
  const firstName = str(first(r, ["first_name", "firstName", "firstname", "given_name"]));
  const lastName = str(first(r, ["last_name", "lastName", "lastname", "family_name"]));
  const full = str(first(r, ["full_name", "fullName", "name", "display_name"])) || [firstName, lastName].filter(Boolean).join(" ");
  const title = str(first(r, ["title", "job_title", "jobTitle", "position", "headline", "role"])) || (isObj(r.experience) ? str((r.experience as Obj).title) : "");
  let linkedin = str(first(r, ["linkedin_url", "linkedinUrl", "linkedin", "profile_url", "profileUrl", "url"]));
  if (linkedin && !/linkedin\.com/i.test(linkedin)) linkedin = "";
  const emailRaw = str(first(r, ["email", "work_email", "workEmail", "email_address"]));
  const email = /^[^\s@*]+@[^\s@*]+\.[a-z]{2,}$/i.test(emailRaw) ? emailRaw : "";
  if (!full && !linkedin) return null;
  const parts = full.split(/\s+/).filter(Boolean);
  const masked = /[*•]|\.\.\./.test(full) || (parts.length > 0 && parts.every((p) => p.length <= 2 && p.endsWith(".")));
  return {
    name: full,
    firstName: firstName || parts[0] || "",
    lastName: lastName || parts.slice(1).join(" "),
    title,
    linkedin,
    email,
    masked,
  };
}

const order: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/** The accounts searched, best grade first, at most limits.accounts. */
export function accountsToSearch(cfg: GtmConfig, acc: AccountsOut | null | undefined): AccountRow[] {
  return [...(acc?.rows ?? [])].sort((a, b) => (order[a.grade] ?? 9) - (order[b.grade] ?? 9) || b.score - a.score).slice(0, cfg.limits.accounts);
}

/** Why the people steps skip on a company-level run (the default, and the free run). */
export const PEOPLE_OFF = "company-level run: people data (names, work emails, committees) only on a paid run with --people";

export const people: GtmModule = {
  id: "people",
  label: "People",
  needs: ["accounts"],
  quote: (cfg) => (cfg.people ? { lines: [{ job: "people.search", calls: cfg.limits.accounts, rows: cfg.limits.peoplePerAccount * 2, note: "titles from the ICP" }] } : { lines: [], skip: PEOPLE_OFF }),
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") {
      const f = loadFixture<PeopleOut>("people");
      return { status: "done", summary: f.summary, out: f };
    }
    const cfg = ctx.cfg;
    const date = today();
    const titleWeights = (cfg as WithLearnings).learned?.title;
    const icpTitles = cfg.icp.titles.length > 0 ? cfg.icp.titles : ["Founder"];
    // The title order learned from replies, highest weight first. Ties keep the order in config.yaml.
    const titles = titleWeights ? icpTitles.map((t, i) => ({ t, i, w: titleWeights[keyOf(t)] ?? 1 })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.t) : icpTitles;
    const keyword = titleKeyword(titles);
    const per = cfg.limits.peoplePerAccount;
    const targets = accountsToSearch(cfg, ctx.outputs.accounts as AccountsOut | null | undefined);
    const calls: CallTrail[] = [];
    const found = new Map<string, PersonRow[]>();

    const build = (): PeopleOut => {
      const rows = targets.flatMap((a) => found.get(a.domain) ?? []);
      const withPeople = targets.filter((a) => (found.get(a.domain)?.length ?? 0) > 0).length;
      const masked = rows.filter((r) => r.masked).length;
      const t = tally(calls);
      const summary = `${rows.length} people found at ${withPeople} of ${calls.length} accounts searched${masked > 0 ? `, ${masked} with names masked by the provider` : ""}${t.misses > 0 ? `, ${t.misses} accounts came back empty` : ""}`;
      const used = [...new Set(rows.map((r) => r.provider))].slice(0, 3);
      return { summary, provider: used.join(", ") || undefined, date, rows, searched: calls.length, calls };
    };

    if (targets.length === 0) {
      const out = { ...build(), summary: "no scored accounts to search" };
      return { status: "skipped", summary: out.summary, out: { ...out, skipped: true } };
    }
    try {
      await pool(targets, 4, async (a) => {
        const input: Record<string, unknown> = { domain: a.domain, company: a.name, job_title: keyword, limit: per * 2 };
        const res = await ctx.call("people.search", input, `search:${a.domain}`);
        calls.push(trailLine(`people at ${a.domain}`, res));
        if (answered(res)) {
          const raw = payloads(res).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
          const seen = new Set<string>();
          const ranked = raw
            .map(normalizePerson)
            .filter((p): p is NonNullable<typeof p> => !!p)
            .filter((p) => {
              const k = (p.linkedin || p.name).toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .map((p, i) => ({ p, i, r: titleRank(p.title, titles, keyword, titleWeights) + (p.masked ? 0 : 0.5) }))
            .sort((x, y) => y.r - x.r || x.i - y.i)
            .slice(0, per)
            .map(({ p }): PersonRow => ({ account: a.name, domain: a.domain, grade: a.grade, ...p, provider: res.record.provider, date }));
          found.set(a.domain, ranked);
        }
        ctx.partial(build());
      });
    } catch (e) {
      ctx.partial(build());
      throw e;
    }
    const out = build();
    return { status: "done", summary: out.summary, out };
  },
  // People render inside the enrich section (03 People and verified emails).
  render: () => null,
  standIn: {
    host: "enrich",
    render: (out, status) =>
      shell({ num: "03", id: "people", title: "People", deeper: "github.com/loootai/looot-csv-enrich", activate: "gtm/people.csv lists them. Run enrich to add verified emails." }, out, status, (f: PeopleOut) => {
        const blocks = [
          { kind: "note" as const, text: "No email was found or checked in this run, so the people are listed here without emails." },
          { kind: "table" as const, columns: [{ key: "account", label: "Account" }, { key: "grade", label: "Grade" }, { key: "name", label: "Name", pii: "name" as const }, { key: "title", label: "Title" }, { key: "provider", label: "Provider" }, { key: "date", label: "Date" }], rows: f.rows.map((r) => ({ ...r, name: r.masked ? `${r.name} (masked by the provider)` : r.name })) },
        ];
        const cn = costNote(f.calls ?? []);
        return cn ? [...blocks, cn] : blocks;
      }),
  },
};

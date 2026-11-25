// Buying committee. For the top A and B accounts (limits.committeeAccounts, default 10), up to
// limits.committeeSize people (default 4), one per role: economic buyer, champion, technical or ops
// lead, user lead. Roles come from title rules, no model. One people.search per account with no
// title filter, so the answer spans the committee. People the run already found (people and
// enrich) are reused with their emails, so only new people get a people.email.find. Every person
// without a known phone goes through the phone waterfall in phone.ts (after the email step), and every
// account gets its company line. --no-phones skips both. Found and not found are both shown.

import type { Block, CommitteeCard, Member } from "../dossier/blocks.js";
import type { GtmConfig } from "../config.js";
import { csv } from "../util.js";
import { loadFixture } from "./fixture.js";
import type { AccountRow, AccountsOut } from "./accounts.js";
import type { EnrichOut } from "./enrich.js";
import { readEmail } from "./enrich.js";
import { findCompanyLine, findPersonPhone, LATER_STEP_PEOPLE, normalizePhone, PERSON_STEPS } from "./phone.js";
import type { PeopleOut } from "./people.js";
import { normalizePerson, PEOPLE_OFF } from "./people.js";
import { answered, type CallTrail, costNote, payloads, pool, rowsOf, shell, today, trailLine } from "./icp.js";
import type { GtmModule, ModuleContext } from "./types.js";

export type Role = "Economic buyer" | "Champion" | "Technical or ops lead" | "User lead" | "Influencer";
export const ROLES: Role[] = ["Economic buyer", "Champion", "Technical or ops lead", "User lead"];

const RULES: Record<Exclude<Role, "Influencer">, RegExp> = {
  "Economic buyer": /\b(ceo|founder|co-founder|cofounder|owner|president|managing director|general manager|chief|cro|cfo|coo|cmo|vp|vice president|partner)\b/i,
  "Technical or ops lead": /\b(ops|operations|revops|cto|cio|it|engineer\w*|systems|data|technology|technical|admin\w*|enablement)\b/i,
  Champion: /\b(head|director)\b/i,
  "User lead": /\b(manager|lead|team lead|supervisor|senior|principal)\b/i,
};

/** The roles a title fits, best first. A title can fit more than one. */
export function rolesOf(title: string): Role[] {
  const t = title || "";
  return (Object.keys(RULES) as (keyof typeof RULES)[]).filter((r) => RULES[r].test(t));
}

export interface Candidate {
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  linkedin: string;
  email: string;
  emailStatus: string;
  phone: string;
  masked: boolean;
}

/** Titles that lead the company or the account: they can sign or say yes. */
const LEADER = /\b(founder|co-?founder|cofounder|ceo|chief executive|owner|managing director|president|managing partner|partner|general manager|coo|cmo|chief marketing|chief growth|chief revenue|chief content|cro)\b/i;
/** Titles that never buy: trainees, assistants, students. */
const NEVER = /\b(intern|internship|assistant|student|trainee|apprentice|volunteer|retired|former|ex-)\b/i;
/** Words in an ICP title that say the level, not the function. What is left ("marketing", "content", "growth") is the function. */
const LEVEL = new Set(["head", "of", "lead", "leader", "manager", "director", "vp", "vice", "president", "chief", "officer", "senior", "sr", "junior", "jr", "the", "and", "&", "owner", "agency", "company", "team", "global", "principal", "founder", "ceo", "co-founder", "cofounder"]);
/** Functions used when the brief names no titles: the people who buy marketing and content tools. */
const DEFAULT_FUNCTIONS = ["marketing", "content", "growth", "partnerships", "brand", "social", "demand", "communications"];

/** The function words in the ICP titles: "Head of Marketing" and "Content Lead" give marketing and content. */
export function titleFunctions(icpTitles: string[]): string[] {
  const words = icpTitles.flatMap((t) => t.toLowerCase().replace(/[^a-z&-]+/g, " ").split(" ")).filter((w) => w.length > 2 && !LEVEL.has(w));
  const out = [...new Set(words.map((w) => (w.endsWith("ing") || w.endsWith("ss") || w.length <= 4 || !w.endsWith("s") ? w : w.slice(0, -1))))];
  return out.length > 0 ? out : DEFAULT_FUNCTIONS;
}

/**
 * Is this a buying title for the ICP. Leaders (founder, CEO, owner, managing director, partner, CMO) always
 * are. Anyone else needs a function word from the ICP titles (marketing, content, growth, partnerships).
 * "Marine Engineer" and "Office Assistant" are not.
 */
export function buyingTitle(title0: string, icpTitles: string[] = []): boolean {
  // "Customer Success Manager at 100 Pound Social": the company name after "at" says nothing about the role.
  const title = title0.replace(/\s+(at|@)\s+.*$/i, "");
  const t = ` ${title.toLowerCase().replace(/[^a-z&-]+/g, " ")} `;
  if (!title.trim() || NEVER.test(title)) return false;
  // A vice president leads a function, so the function has to fit like any other title.
  if (LEADER.test(title.replace(/\bvice president\b/gi, "vp"))) return true;
  // The people who run the go-to-market systems check the fit for any commercial tool.
  if (/\b(revops|rev ops|revenue operations|gtm operations|marketing operations|sales operations|growth operations)\b/i.test(title)) return true;
  if (icpTitles.some((x) => x.trim() && t.includes(` ${x.toLowerCase().trim()} `))) return true;
  return titleFunctions(icpTitles).some((f) => new RegExp(`\\b${f.replace(/[^a-z-]/g, "")}\\w*\\b`).test(t));
}

const ROLE_INBOX = new Set(["info", "hello", "hi", "contact", "team", "sales", "admin", "office", "support", "marketing", "enquiries", "inquiries", "mail", "careers", "jobs", "hr", "accounts", "billing", "press", "media", "studio", "agency", "help", "noreply", "no-reply"]);
const nameParts = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "").split(/\s+/).filter((w) => w.length >= 2 && !["dr", "mr", "mrs", "ms", "jr", "sr", "phd", "mba"].includes(w));

/**
 * Does a found email belong to this person at this account. The domain must be the account's domain (or a
 * subdomain). The part before the @ must carry the person's first or last name, or their initials with a
 * name (jdoe, johnd, j.doe). A role inbox (info@, hello@) or another person's name (ben@ on Mira Sanders)
 * is not this person's email. Returns why not, or null when it fits.
 */
export function emailMismatch(email: string, person: { name: string; firstName?: string; lastName?: string }, accountDomain: string): string | null {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!m) return "not an email";
  const [, local, dom] = m;
  const acct = accountDomain.toLowerCase().replace(/^www\./, "");
  // The same brand on another ending (willowmedia.agency and willowmedia.co.uk) is the account's domain too.
  const stemOf = (d: string) => d.replace(/\.(co|com|org|net|ac|gov)\.[a-z]{2}$/, "").replace(/\.[a-z]{2,}$/, "").split(".").pop() ?? d;
  if (dom !== acct && !dom.endsWith(`.${acct}`) && stemOf(dom) !== stemOf(acct)) return `${dom} is not ${acct}`;
  const flat = local.replace(/[^a-z]/g, "");
  const parts = nameParts([person.firstName, person.lastName].filter(Boolean).join(" ") || person.name);
  if (parts.length === 0) return null;
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  if (parts.some((p) => p.length >= 3 && flat.includes(p))) return null;
  const tokens = local.split(/[._-]+/).filter(Boolean);
  if (last && (flat === `${first[0]}${last}` || flat === `${first}${last[0]}` || flat === `${first[0]}${last[0]}` || (tokens.length === 2 && tokens[0] === first[0] && last.startsWith(tokens[1])))) return null;
  if (parts.some((p) => p.length === 2 && tokens.includes(p))) return null;
  if (ROLE_INBOX.has(local)) return "a shared inbox";
  return `${local}@ is someone else's name`;
}

/**
 * Cleans the emails on the buying committees. An email stays only with the person it fits (emailMismatch), and
 * one email never shows on two people: when two share it, the one it fits keeps it, else the first one.
 * Returns the count of emails taken off.
 */
export function cleanCommitteeEmails(accounts: CommitteeAccount[], people: Record<string, { firstName?: string; lastName?: string }> = {}): number {
  let dropped = 0;
  const owner = new Map<string, Member>();
  for (const a of accounts) {
    // The same person twice on one committee (two providers) shows once, the copy with an email first.
    const byName = new Map<string, Member>();
    for (const m of a.members) {
      const k = m.name.trim().toLowerCase();
      const cur = byName.get(k);
      if (!cur || (!cur.email && m.email)) byName.set(k, m);
    }
    a.members = a.members.filter((m) => byName.get(m.name.trim().toLowerCase()) === m);
    for (const m of a.members) {
      if (!m.email) continue;
      const why = emailMismatch(m.email, { name: m.name, ...(people[m.name] ?? {}) }, a.domain);
      const e = m.email.toLowerCase();
      if (why || owner.has(e)) {
        m.email = "";
        m.emailStatus = "not found";
        dropped++;
        continue;
      }
      owner.set(e, m);
    }
  }
  return dropped;
}

/** Picks one person per role in ROLES order, then fills up to size with the rest. Only buying titles for the ICP count. */
export function pickCommittee(cands: Candidate[], size: number, icpTitles: string[] = []): { role: Role; c: Candidate }[] {
  const out: { role: Role; c: Candidate }[] = [];
  const used = new Set<Candidate>();
  const icp = icpTitles.map((t) => t.toLowerCase());
  const usable = cands.filter((c) => !c.masked && c.name && buyingTitle(c.title, icpTitles));
  for (const role of ROLES) {
    if (out.length >= size) break;
    const fit = usable.filter((c) => !used.has(c) && (rolesOf(c.title).includes(role) || (role === "Champion" && icp.includes(c.title.toLowerCase()))));
    // A person with an email already wins a tie.
    const best = fit.sort((a, b) => Number(!!b.email) - Number(!!a.email))[0];
    if (best) {
      used.add(best);
      out.push({ role, c: best });
    }
  }
  for (const c of usable) {
    if (out.length >= size) break;
    if (!used.has(c)) {
      used.add(c);
      out.push({ role: "Influencer", c });
    }
  }
  return out;
}

export interface CommitteeAccount extends CommitteeCard {
  provider: string;
}

export interface CommitteeOut {
  placeholder?: string;
  summary: string;
  provider?: string;
  date?: string;
  accounts: CommitteeAccount[];
  calls?: CallTrail[];
  skipped?: boolean;
  /** Emails taken off because they belong to someone else or sit on another domain. */
  emailsDropped?: number;
}

const order: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/** Extra fields `looot-zeus more` sets on the config. */
export interface MoreHints {
  more?: { skipDomains?: string[]; page?: number; pageOffset?: number };
}

/** The A and B accounts that get a committee (the top C ones when there is no A or B), best first, minus the ones that already have one. */
export function committeeTargets(cfg: GtmConfig, acc: AccountsOut | null | undefined): AccountRow[] {
  const skip = new Set((cfg as GtmConfig & MoreHints).more?.skipDomains ?? []);
  const rows = (acc?.rows ?? []).filter((a) => !skip.has(a.domain));
  // With no A or B account, the best C accounts still get a committee: they passed the ICP filter.
  const ab = rows.filter((a) => a.grade === "A" || a.grade === "B");
  return [...(ab.length > 0 ? ab : rows.filter((a) => a.grade === "C"))]
    .sort((a, b) => (order[a.grade] ?? 9) - (order[b.grade] ?? 9) || b.score - a.score)
    .slice(0, cfg.limits.committeeAccounts);
}

/** Email lookups quoted per account: the committee minus the people the run already found. */
export const newPerAccount = (cfg: GtmConfig) => Math.max(1, cfg.limits.committeeSize - cfg.limits.peoplePerAccount);

export function summarize(accounts: CommitteeAccount[]): string {
  const m = accounts.flatMap((a) => a.members);
  const emails = m.filter((x) => x.email).length;
  const phones = m.filter((x) => x.phone).length;
  const lines = accounts.filter((a) => a.companyPhone).length;
  return `${m.length} people across ${accounts.length} buying committees, ${emails} emails and ${phones} phone numbers found${lines ? `, ${lines} company ${lines === 1 ? "line" : "lines"}` : ""}`;
}

/** What the phone lookups cost and found, for the cost section. Null when no phone call ran. */
export function phoneCostNote(calls: CallTrail[], accounts: CommitteeAccount[]): Block | null {
  const ph = calls.filter((c) => c.step.startsWith("phone ") || c.step.startsWith("company line "));
  if (ph.length === 0) return null;
  const charged = ph.reduce((n, c) => n + (c.charged || 0), 0);
  const m = accounts.flatMap((a) => a.members);
  const by = (t: string) => m.filter((x) => x.phone && x.phoneType === t).length;
  const lines = accounts.filter((a) => a.companyPhone).length;
  return { kind: "note", text: `Phones: ${ph.length} lookups, ${charged < 0.01 ? `$${charged.toFixed(4)}` : `$${charged.toFixed(2)}`} charged. ${by("Mobile")} mobile, ${by("Direct")} direct, ${lines} company ${lines === 1 ? "line" : "lines"}. Mobile means personal: call it only where that is allowed. Run with --no-phones to skip phones.` };
}

export function committeeBlocks(f: CommitteeOut): Block[] {
  const m = f.accounts.flatMap((a) => a.members);
  const emails = m.filter((x) => x.email).length;
  const phones = m.filter((x) => x.phone).length;
  const li = m.filter((x) => x.linkedin).length;
  const blocks: Block[] = [
    { kind: "stat", items: [
      { label: "Accounts with a committee", value: String(f.accounts.length) },
      { label: "People", value: String(m.length) },
      { label: "Emails found", value: `${emails} of ${m.length}`, meter: m.length ? emails / m.length : 0, tone: "go" },
      { label: "Phones found", value: `${phones} of ${m.length}`, meter: m.length ? phones / m.length : 0, tone: "warm" },
      ...(f.accounts.some((a) => a.companyPhone) ? [{ label: "Company lines", value: `${f.accounts.filter((a) => a.companyPhone).length} of ${f.accounts.length}`, meter: f.accounts.filter((a) => a.companyPhone).length / f.accounts.length, tone: "warm" as const }] : []),
      { label: "LinkedIn profiles", value: `${li} of ${m.length}`, meter: m.length ? li / m.length : 0, tone: "go" },
    ] },
    { kind: "committee", items: f.accounts },
    ...(f.emailsDropped ? [{ kind: "note" as const, text: `${f.emailsDropped} ${f.emailsDropped === 1 ? "email was" : "emails were"} taken off: the address sat on another domain, named someone else or was already on another person. Each person shows only an email that fits their own name at the account's domain.` }] : []),
    { kind: "note", text: "Roles come from title rules. Economic buyer signs, champion pushes it inside, the technical or ops lead checks the fit and the user lead runs it day to day. Verified means the email check passed in this run. Found means a provider returned it without a check. Phones carry a type: Mobile (personal, or the provider gave no line type), Direct (a work line) or Company line (the account's main number)." },
  ];
  return blocks;
}

export const committee: GtmModule = {
  id: "committee",
  label: "Buying committee",
  needs: ["accounts", "people", "enrich"],
  quote: (cfg) => {
    if (!cfg.people) return { lines: [], skip: PEOPLE_OFF };
    const n = cfg.limits.committeeAccounts;
    if (n === 0 || cfg.limits.committeeSize === 0) return { lines: [], skip: "limits.committeeAccounts is 0" };
    return {
      lines: [
        { job: "people.search", calls: n, rows: 10, note: "A and B accounts, every role" },
        { job: "people.email.find", calls: n * newPerAccount(cfg), note: "people not found before" },
        ...(cfg.committeePhones
          ? [
              { job: PERSON_STEPS[0], calls: n * cfg.limits.committeeSize, note: "phone waterfall, step 1" },
              { job: PERSON_STEPS[1], calls: n * Math.min(LATER_STEP_PEOPLE, cfg.limits.committeeSize), billedShare: 0.1, note: "step 2 for the first two people, runs on a miss, bills a hit only" },
              ...(cfg.phones ? [{ job: PERSON_STEPS[2], calls: n * Math.min(LATER_STEP_PEOPLE, cfg.limits.committeeSize), billedShare: 0.1, note: "step 3 (--phones), bills $0.20 a hit only" }] : []),
              { job: "web.scrape.markdown", calls: n * 2, note: "company line from the home and contact page" },
            ]
          : []),
      ],
    };
  },
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") {
      const f = loadFixture<CommitteeOut>("committee");
      return { status: "done", summary: f.summary, out: f };
    }
    const cfg = ctx.cfg;
    const date = today();
    const targets = committeeTargets(cfg, ctx.outputs.accounts as AccountsOut | null | undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const known: any[] = [...((ctx.outputs.enrich as EnrichOut | null | undefined)?.rows ?? []), ...((ctx.outputs.people as PeopleOut | null | undefined)?.rows ?? [])];
    const calls: CallTrail[] = [];
    const done: CommitteeAccount[] = [];
    let emailBudget = targets.length * newPerAccount(cfg);
    const build = (): CommitteeOut => {
      const used = [...new Set(done.map((a) => a.provider).filter(Boolean))].slice(0, 3);
      return { summary: summarize(done), provider: used.join(", ") || undefined, date, accounts: [...done], calls };
    };
    if (targets.length === 0) {
      const out = { ...build(), summary: "no A, B or C accounts to build a committee for" };
      return { status: "skipped", summary: out.summary, out: { ...out, skipped: true } };
    }
    try {
      await pool(targets, 3, async (a) => {
        const country = a.country ?? "";
        const res = await ctx.call("people.search", { domain: a.domain, company: a.name, limit: 10 }, `committee:${a.domain}`);
        calls.push(trailLine(`committee at ${a.domain}`, res));
        const cands: Candidate[] = [];
        const seen = new Set<string>();
        const add = (c: Candidate) => {
          const k = (c.linkedin || c.name).toLowerCase();
          if (!k || seen.has(k)) return;
          seen.add(k);
          cands.push(c);
        };
        for (const p of known.filter((k) => k.domain === a.domain) as (Candidate & { status?: string })[]) add({ ...p, emailStatus: p.email ? (p.status === "valid" ? "verified" : "found") : "", phone: p.phone ?? "", masked: !!p.masked });
        if (answered(res)) {
          const raw = payloads(res).map((p) => rowsOf(p)).find((r) => r.length > 0) ?? [];
          for (const r of raw) {
            const p = normalizePerson(r);
            if (p) add({ ...p, emailStatus: p.email ? "found" : "", phone: "" });
          }
        }
        const picked = pickCommittee(cands, cfg.limits.committeeSize, cfg.icp.titles);
        const members: Member[] = [];
        for (const { role, c } of picked) {
          const m: Member = { role, name: c.name, title: c.title, email: c.email, emailStatus: c.email ? c.emailStatus || "found" : "not looked up", linkedin: c.linkedin, phone: c.phone, phoneStatus: c.phone ? "found" : "not looked up" };
          if (!m.email && emailBudget > 0 && (c.linkedin || (c.firstName && c.lastName))) {
            emailBudget--;
            const input: Record<string, unknown> = { domain: a.domain, first_name: c.firstName, last_name: c.lastName, name: c.name };
            if (c.linkedin) input.linkedin_url = c.linkedin;
            const r = await ctx.call("people.email.find", input, `committee-email:${a.domain}:${c.linkedin || c.name}`);
            calls.push(trailLine(`committee email ${a.domain}`, r));
            m.email = answered(r) ? readEmail(r) : "";
            m.emailStatus = m.email ? "found" : "not found";
          }
          if (!cfg.committeePhones) {
            if (!m.phone) m.phoneStatus = "skipped";
          } else if (m.phone) {
            m.phone = normalizePhone(m.phone, country) || m.phone;
            m.phoneType ||= "Mobile";
          } else if (c.linkedin || (c.firstName && c.lastName)) {
            // After the email step, so the work email can feed the providers that read one.
            const { info, calls: pc } = await findPersonPhone(ctx, { ...c, email: m.email }, a.domain, country, `committee-phone:${a.domain}:${c.linkedin || c.name}`, { later: members.length < LATER_STEP_PEOPLE, deep: cfg.phones });
            calls.push(...pc);
            m.phone = info.phone;
            m.phoneStatus = info.phone ? "found" : "not found";
            if (info.phone) {
              m.phoneType = info.type || "Mobile";
              m.phoneSource = info.source;
            }
          }
          members.push(m);
        }
        let line: { phone: string; source: string } | undefined;
        if (cfg.committeePhones) {
          const { info, calls: lc } = await findCompanyLine(ctx, a.domain, country, `committee-line:${a.domain}`);
          calls.push(...lc);
          if (info.phone) {
            line = { phone: info.phone, source: info.source };
            // A provider that handed back the main line for a person found the switchboard, not the person.
            for (const m of members) if (m.phone === info.phone) Object.assign(m, { phoneType: "Company line" });
          }
        }
        done.push({ account: a.name, domain: a.domain, grade: a.grade, score: a.score, members, provider: res.record.provider, ...(line ? { companyPhone: line.phone, companyPhoneSource: line.source } : {}) });
        ctx.partial(build());
      });
    } catch (e) {
      ctx.partial(build());
      throw e;
    }
    const rank = new Map(targets.map((t, i) => [t.domain, i]));
    done.sort((x, y) => (rank.get(x.domain) ?? 0) - (rank.get(y.domain) ?? 0));
    const emailsDropped = cleanCommitteeEmails(done);
    const out = { ...build(), ...(emailsDropped > 0 ? { emailsDropped } : {}) };
    return { status: "done", summary: out.summary, out };
  },
  render: (out, status) =>
    shell({ num: "03B", id: "committee", title: "Buying committees", activate: "gtm/committee.csv has every person with role, email, LinkedIn, phone, phone type and the company line" }, out, status, (f: CommitteeOut) => {
      const blocks = committeeBlocks(f);
      const cn = costNote(f.calls ?? []);
      const pn = phoneCostNote(f.calls ?? [], f.accounts);
      return [...blocks, ...(cn ? [cn] : []), ...(pn ? [pn] : [])];
    }),
  files: (o): Record<string, string> => {
    const f = o as CommitteeOut;
    if (!f || !Array.isArray(f.accounts)) return {};
    const rows = f.accounts.flatMap((a) => a.members.map((m) => ({ account: a.account, domain: a.domain, grade: a.grade, ...m, phone_type: m.phoneType ?? "", phone_source: m.phoneSource ?? "", company_line: a.companyPhone ?? "" })));
    return { "committee.csv": csv(rows, ["account", "domain", "grade", "role", "name", "title", "email", "emailStatus", "linkedin", "phone", "phone_type", "phone_source", "phoneStatus", "company_line"]) };
  },
};

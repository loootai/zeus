// Module 4, enrich. People in, work emails out, each verified, with the provider trail per person.
// Lifted from loootai/looot-csv-enrich (MIT): the email and status readers, find before verify,
// verify the email the find step returned. people.phone.find runs only with --phones.
// A person whose name the people provider masked gets no lookup, the row says why.
// A miss is a row, never an error. What a miss or a failure cost comes from the ledger, never assumed.

import type { Block } from "../dossier/blocks.js";
import { usd } from "../util.js";
import { loadFixture } from "./fixture.js";
import type { GtmModule, ModuleContext, RenderOptions } from "./types.js";
import { PEOPLE_OFF, type PeopleOut, type PersonRow } from "./people.js";
import { answered, type CallTrail, costNote, isCap, payloads, pool, shell, type ShellSpec, today, trailLine, trailOf, trailTable } from "./icp.js";
import type { CallResult } from "../client.js";
import { phoneInput, readPhoneInfo } from "./phone.js";

export type EmailStatus = "valid" | "invalid" | "catch_all" | "risky" | "unknown" | "unverified" | "miss" | "fail" | "not looked up" | "not checked";

export interface EnrichRow {
  account: string;
  domain: string;
  name: string;
  title: string;
  linkedin: string;
  email: string;
  status: EmailStatus;
  /** "kittai miss → findymail hit · verified by dropleads" */
  trail: string;
  provider: string;
  verifiedBy: string;
  phone: string;
  /** Mobile, Direct or Company line. Empty when no phone. */
  phoneType?: string;
  /** What looot charged for this person, misses included. */
  charged: number;
  date: string;
}

export interface EnrichOut {
  placeholder?: string;
  summary: string;
  provider?: string;
  date?: string;
  rows: EnrichRow[];
  calls?: CallTrail[];
}

function squash(k: string): string {
  return k.toLowerCase().replace(/[\s_\-.]/g, "");
}

function scalar(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return "";
}

/** Breadth-first search for the first non-empty scalar under any of the keys, at most 5 levels deep. */
export function findValue(source: unknown, keys: string[]): string {
  const wanted = keys.map(squash);
  let level: unknown[] = [source];
  for (let depth = 0; depth < 5 && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        next.push(...node.slice(0, 5));
        continue;
      }
      const entries = Object.entries(node as Record<string, unknown>);
      for (const key of wanted) {
        for (const [k, v] of entries) {
          if (squash(k) !== key) continue;
          const s = scalar(v);
          if (s) return s;
        }
      }
      for (const [, v] of entries) if (v !== null && typeof v === "object") next.push(v);
    }
    level = next;
  }
  return "";
}

const pick = (res: CallResult, keys: string[]) => payloads(res).map((p) => findValue(p, keys)).find(Boolean) ?? "";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The found email, else the first address anywhere in the answer. */
export function readEmail(res: CallResult): string {
  const direct = pick(res, ["email", "work_email", "emailAddress", "email_address"]);
  if (direct && EMAIL_RE.test(direct)) return direct.match(EMAIL_RE)?.[0] ?? "";
  for (const p of payloads(res)) {
    const m = JSON.stringify(p ?? "").match(EMAIL_RE);
    if (m) return m[0];
  }
  return "";
}

const STATUS_WORDS: Record<string, EmailStatus> = {
  valid: "valid", deliverable: "valid", ok: "valid", safe: "valid", verified: "valid", true: "valid",
  invalid: "invalid", undeliverable: "invalid", bounce: "invalid", bad: "invalid", false: "invalid",
  catchall: "catch_all", acceptall: "catch_all", catch_all: "catch_all",
  risky: "risky", unknown: "unknown",
};

/** One status word: valid, invalid, catch_all, risky or unknown. */
export function readStatus(res: CallResult): EmailStatus {
  const raw = pick(res, ["email_status", "verdict", "result", "status", "check", "state", "deliverable", "is_valid"]);
  return STATUS_WORDS[squash(raw)] ?? STATUS_WORDS[raw.toLowerCase()] ?? "unknown";
}

/** The phone in an answer, E.164. Reads employee_phone (QuickEnrich), mobile_number (Dropleads) and the rest. */
export function readPhone(res: CallResult, country = ""): string {
  return readPhoneInfo(res, country).phone;
}

const SPEC: ShellSpec = {
  num: "03",
  id: "enrich",
  title: "People and verified emails",
  deeper: "github.com/loootai/looot-csv-enrich",
  activate: "gtm/exports has CSV presets for Instantly, HubSpot and Attio",
};

const LABEL: Record<string, string> = { valid: "verified", catch_all: "catch-all", invalid: "invalid", risky: "risky", unknown: "unknown", unverified: "found, not verified", miss: "miss", fail: "failed", "not looked up": "not looked up", "not checked": "not checked, cap reached" };

function baseRow(p: PersonRow, date: string): EnrichRow {
  return { account: p.account, domain: p.domain, name: p.name, title: p.title, linkedin: p.linkedin, email: "", status: "not checked", trail: "", provider: "", verifiedBy: "", phone: "", charged: 0, date };
}

export const enrich: GtmModule = {
  id: "enrich",
  label: "Enrich",
  needs: ["people"],
  quote: (cfg) => {
    if (!cfg.people) return { lines: [], skip: PEOPLE_OFF };
    const k = cfg.limits.accounts * cfg.limits.peoplePerAccount;
    return {
      lines: [
        { job: "people.email.find", calls: k },
        { job: "people.email.verify", calls: k },
        ...(cfg.phones ? [{ job: "people.phone.find", calls: k }] : []),
      ],
    };
  },
  async run(ctx: ModuleContext) {
    if (ctx.mode === "demo") {
      const f = loadFixture<EnrichOut>("enrich");
      return { status: "done", summary: f.summary, out: f };
    }
    const date = today();
    const ppl = ((ctx.outputs.people as PeopleOut | null | undefined)?.rows ?? []);
    const rows = ppl.map((p) => baseRow(p, date));
    const calls: CallTrail[] = [];

    const build = (): EnrichOut => {
      const n = (s: EmailStatus[]) => rows.filter((r) => s.includes(r.status)).length;
      const parts = [`${n(["valid"])} emails verified`, `${n(["catch_all", "risky", "unknown", "unverified"])} catch-all, risky or unconfirmed`, `${n(["miss"])} miss`];
      if (n(["invalid"]) > 0) parts.push(`${n(["invalid"])} invalid`);
      if (n(["fail"]) > 0) parts.push(`${n(["fail"])} failed`);
      if (n(["not looked up"]) > 0) parts.push(`${n(["not looked up"])} not looked up`);
      if (n(["not checked"]) > 0) parts.push(`${n(["not checked"])} not checked`);
      const used = [...new Set(rows.map((r) => r.provider).filter(Boolean))].slice(0, 3);
      return { summary: parts.join(" · "), provider: used.join(", ") || undefined, date, rows, calls };
    };

    if (rows.length === 0) {
      const out = { ...build(), summary: "no people to enrich" };
      return { status: "skipped", summary: out.summary, out: { ...out, skipped: true } };
    }

    try {
      await pool(ppl, 4, async (p, i) => {
        const row = rows[i];
        const trail: string[] = [];
        const charge = (res: CallResult) => {
          row.charged += res.record.charged;
        };
        try {
          let email = p.email;
          if (email) {
            trail.push("email from people search");
            row.provider = p.provider;
          } else if (p.masked && !p.linkedin) {
            row.status = "not looked up";
            row.trail = "name masked by the people provider, no lookup made";
            return;
          } else {
            const input: Record<string, unknown> = { domain: p.domain };
            if (p.firstName && !p.masked) input.first_name = p.firstName;
            if (p.lastName && !p.masked) input.last_name = p.lastName;
            if (p.name && !p.masked) input.name = p.name;
            if (p.linkedin) input.linkedin_url = p.linkedin;
            const res = await ctx.call("people.email.find", input, `find:${p.domain}:${p.linkedin || p.name}`);
            calls.push(trailLine(`email ${p.domain}`, res));
            charge(res);
            trail.push(trailOf(res));
            row.provider = res.record.provider;
            email = answered(res) ? readEmail(res) : "";
            if (!email) {
              row.status = res.record.outcome === "fail" ? "fail" : "miss";
              if (answered(res)) trail.push("answer had no email");
            }
          }
          if (email) {
            row.email = email;
            const v = await ctx.call("people.email.verify", { email }, `verify:${email.toLowerCase()}`);
            calls.push(trailLine(`verify ${p.domain}`, v));
            charge(v);
            if (answered(v)) {
              row.status = readStatus(v);
              row.verifiedBy = v.record.provider;
              trail.push(`verified by ${v.record.provider}`);
            } else {
              row.status = "unverified";
              trail.push(`verify ${trailOf(v)}`);
            }
          }
          if (ctx.cfg.phones && (p.linkedin || (!p.masked && p.firstName && p.lastName))) {
            const input = phoneInput({ ...p, email: row.email }, p.domain);
            const ph = await ctx.call("people.phone.find", input, `phone:${p.domain}:${p.linkedin || p.name}`);
            calls.push(trailLine(`phone ${p.domain}`, ph));
            charge(ph);
            const info = answered(ph) ? readPhoneInfo(ph) : { phone: "", type: "" };
            row.phone = info.phone;
            if (info.phone) row.phoneType = info.type || "Mobile";
            trail.push(`phone ${row.phone ? trailOf(ph) : `${trailOf(ph)}, none found`}`);
          }
        } catch (e) {
          if (isCap(e) && row.status === "not checked" && row.email) row.status = "unverified";
          throw e;
        } finally {
          if (trail.length > 0) row.trail = trail.join(" · ");
          ctx.partial(build());
        }
      });
    } catch (e) {
      ctx.partial(build());
      throw e;
    }
    const out = build();
    return { status: "done", summary: out.summary, out };
  },
  render(out, status, _opts: RenderOptions) {
    return shell(SPEC, out, status, (f: EnrichOut) => {
      const has = (s: string[]) => f.rows.filter((r) => s.includes(r.status)).length;
      const withCost = f.rows.some((r) => typeof r.charged === "number");
      const withPhone = f.rows.some((r) => r.phone);
      const columns = [
        { key: "account", label: "Account" },
        { key: "name", label: "Name", pii: "name" as const },
        { key: "title", label: "Title" },
        { key: "email", label: "Email", pii: "email" as const },
        ...(withPhone ? [{ key: "phone", label: "Phone", pii: "phone" as const }] : []),
        { key: "chip", label: "Status" },
        { key: "trail", label: "Provider trail" },
        ...(withCost ? [{ key: "cost", label: "Charged", num: true }] : []),
        { key: "date", label: "Date" },
      ];
      const blocks: Block[] = [
        { kind: "stat", items: [
          { label: "Verified", value: String(has(["valid"])) },
          { label: "Catch-all or risky", value: String(has(["catch_all", "risky", "unknown", "unverified"])) },
          { label: "Miss", value: String(has(["miss"])) },
          ...(has(["fail", "invalid", "not looked up", "not checked"]) > 0 ? [{ label: "Invalid, failed or skipped", value: String(has(["fail", "invalid", "not looked up", "not checked"])) }] : []),
        ] },
        { kind: "table", columns, rows: f.rows.map((r) => ({ ...r, chip: LABEL[r.status] ?? r.status, cost: typeof r.charged === "number" ? usd(r.charged) : "" })) },
      ];
      const tt = trailTable(f.calls ?? []);
      if (tt) blocks.push(tt);
      const cn = costNote(f.calls ?? []);
      if (cn) blocks.push(cn);
      return blocks;
    });
  },
};

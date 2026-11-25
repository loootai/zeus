// Files under gtm/ that are not the dossier: accounts.csv, people.csv, signals.json and the
// activation presets in gtm/exports. CSV presets only, field maps per tool. Nothing syncs.

import { join } from "node:path";
import { csv, maskEmail, maskName, maskPhone, writeFile } from "./util.js";

interface Person {
  account: string;
  domain: string;
  name: string;
  title: string;
  email: string;
  status: string;
  linkedin?: string;
  phone?: string;
  phoneType?: string;
}

/** Only deliverable addresses go to an outreach tool. Addresses that bounced before (gtm/learnings.json) are left out. */
function sendable(p: Person[], suppress: Set<string> = new Set()): Person[] {
  return p.filter((x) => x.email && x.status === "valid" && !suppress.has(x.email.trim().toLowerCase()));
}

function split(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

export const PRESETS: Record<string, { file: string; map: (p: Person, grade: string) => Record<string, string> }> = {
  instantly: {
    file: "instantly.csv",
    map: (p, grade) => {
      const [first, last] = split(p.name);
      return { email: p.email, first_name: first, last_name: last, company_name: p.account, website: p.domain, title: p.title, grade };
    },
  },
  hubspot: {
    file: "hubspot.csv",
    map: (p) => {
      const [first, last] = split(p.name);
      return { Email: p.email, "First Name": first, "Last Name": last, "Company Name": p.account, "Job Title": p.title, "Website URL": p.domain, "Lifecycle Stage": "lead" };
    },
  },
  attio: {
    file: "attio.csv",
    map: (p) => ({ email_addresses: p.email, name: p.name, job_title: p.title, company: p.domain, linkedin: p.linkedin ?? "" }),
  },
};

/** A person the committee step found a phone for gets it in people.csv too, matched on LinkedIn, else name and domain. */
export function withCommitteePhones(people: Person[], committees: { domain: string; members: { name: string; linkedin: string; phone: string; phoneType?: string }[] }[]): Person[] {
  const key = (domain: string, name: string, li?: string) => (li ? li.toLowerCase().replace(/\/+$/, "") : `${domain}|${name.trim().toLowerCase()}`);
  const found = new Map<string, { phone: string; phoneType?: string }>();
  for (const c of committees) for (const m of c.members ?? []) if (m.phone) {
    found.set(key(c.domain, m.name, m.linkedin), m);
    found.set(key(c.domain, m.name), m);
  }
  return people.map((p) => {
    if (p.phone) return p;
    const hit = found.get(key(p.domain, p.name, p.linkedin)) ?? found.get(key(p.domain, p.name));
    return hit ? { ...p, phone: hit.phone, phoneType: hit.phoneType ?? "Mobile" } : p;
  });
}

export function writeArtifacts(outDir: string, outputs: Record<string, any>, opts: { public: boolean; suppress?: string[] }): string[] {
  const suppress = new Set((opts.suppress ?? []).map((e) => e.trim().toLowerCase()));
  const written: string[] = [];
  const put = (rel: string, text: string) => {
    writeFile(join(outDir, rel), text);
    written.push(rel);
  };
  const accounts: any[] = outputs.accounts?.rows ?? [];
  if (accounts.length > 0) put("accounts.csv", csv(accounts, ["grade", "score", "name", "domain", "industry", "employees", "country", "reasons", "provider", "date"]));
  const people: Person[] = withCommitteePhones(outputs.enrich?.rows ?? outputs.people?.rows ?? [], outputs.committee?.accounts ?? []);
  if (people.length > 0) {
    const shown = opts.public ? people.map((p) => ({ ...p, name: maskName(p.name), email: p.email ? maskEmail(p.email) : "", linkedin: "", phone: p.phone ? maskPhone(p.phone) : "" })) : people;
    put("people.csv", csv(shown.map((p) => ({ ...p, phone: p.phone ?? "", phone_type: p.phone ? (p.phoneType ?? "") : "" })) as any[], ["account", "domain", "name", "title", "email", "status", "trail", "provider", "date", "linkedin", "phone", "phone_type"]));
    if (!opts.public) {
      const grade = new Map(accounts.map((a) => [a.domain, a.grade]));
      for (const preset of Object.values(PRESETS)) {
        const rows = sendable(people, suppress).map((p) => preset.map(p, grade.get(p.domain) ?? ""));
        put(join("exports", preset.file), csv(rows));
      }
    }
  }
  if (outputs.signals?.rows) put("signals.json", JSON.stringify(outputs.signals.rows, null, 2) + "\n");
  return written;
}

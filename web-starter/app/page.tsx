import { redirect } from "next/navigation";
import { missingEnv } from "@/lib/env";
import { currentOwner } from "@/lib/supabase";
import { loadZeus } from "@/lib/data";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

/** The owner's read-only Zeus GTM OS, read from their own Supabase tables. */
export default async function Home() {
  const missing = missingEnv();
  if (missing.length) {
    return (
      <div className="card">
        <h1>Almost there</h1>
        <p>Set these env vars on your Vercel project, then redeploy: <b>{missing.join(", ")}</b>.</p>
        <p className="mute">The Supabase integration sets the SUPABASE_* ones. ZEUS_OWNER_EMAIL is your email; only that address can sign in.</p>
      </div>
    );
  }
  const owner = await currentOwner();
  if (!owner) redirect("/login");
  const d = await loadZeus();
  const byAccount = new Map<string, any[]>();
  for (const p of d.people) byAccount.set(p.account_domain, [...(byAccount.get(p.account_domain) ?? []), p]);

  return (
    <>
      <div className="row">
        <div>
          <h1>{d.run ? `${d.run.domain}: your Zeus GTM OS` : "Your Zeus GTM OS"}</h1>
          <div className="mute">
            {d.run ? `${d.run.mode === "demo" ? "Demo data (placeholder). " : ""}Run finished ${dash(d.run.finished_at?.slice(0, 10))}, imported ${dash(d.run.imported_at?.slice(0, 10))}, ${dash(d.run.calls)} calls, $${dash(d.run.charged_usd)} on looot.` : "No run imported yet."} Read only. Signed in as {owner}.
          </div>
        </div>
        <form action="/api/session?logout=1" method="post"><button type="submit">Sign out</button></form>
      </div>
      {d.error && <p className="card">{d.error}</p>}
      {!d.error && !d.run && <p className="card">Your tables are empty. From the folder you ran Zeus in: <code>npx looot-zeus import-supabase --dry-run</code>, then without <code>--dry-run</code>.</p>}

      <h2>Overview</h2>
      <div className="grid">
        {[["Target accounts", d.accounts.length], ["Committees", d.committees.length], ["People", d.people.length], ["Plays", d.plays.length], ["Rivals", d.rivals.length]].map(([k, v]) => (
          <div className="card kpi" key={k as string}><b>{v as number}</b><span className="mute">{k}</span></div>
        ))}
      </div>

      <h2>Target accounts</h2>
      <div className="card wrap"><table><thead><tr><th>Company</th><th>Grade</th><th>Score</th><th>Industry</th><th>Size</th><th>Country</th><th>Why</th></tr></thead><tbody>
        {d.accounts.map((a) => <tr key={a.domain}><td><b>{dash(a.name)}</b><br /><span className="mute">{a.domain}</span></td><td>{dash(a.grade)}</td><td>{dash(a.score)}</td><td>{dash(a.industry)}</td><td>{dash(a.employees)}</td><td>{dash(a.country)}</td><td>{dash(a.reasons)}</td></tr>)}
      </tbody></table></div>

      <h2>Buying committees</h2>
      {d.committees.map((c) => (
        <div className="card wrap" key={c.account_domain} style={{ marginBottom: 12 }}>
          <b>{dash(c.account_name)}</b> <span className="mute">{c.account_domain}, grade {dash(c.grade)}, {c.members} people</span>
          <table><tbody>{(byAccount.get(c.account_domain) ?? []).map((p, i) => (
            <tr key={i}><td>{p.name}</td><td>{dash(p.role)}</td><td>{dash(p.title)}</td><td>{p.linkedin ? <a href={p.linkedin} rel="noreferrer noopener" target="_blank">LinkedIn</a> : "-"}</td><td>{dash(p.email)}</td><td>{dash(p.phone)}</td></tr>
          ))}</tbody></table>
        </div>
      ))}

      <h2>Plays</h2>
      {d.plays.map((p) => (
        <div className="card" key={p.title} style={{ marginBottom: 12 }}>
          <b>{p.title}</b> <span className="mute">{dash(p.basis)}{p.cost ? `, ${p.cost}` : ""}</span>
          {p.evidence && <p>{p.evidence}</p>}
          {p.command && <code>{p.command}</code>}
        </div>
      ))}

      <h2>Rivals</h2>
      <div className="card wrap"><table><tbody>
        {d.rivals.map((r) => <tr key={r.domain}><td><b>{dash(r.name)}</b><br /><span className="mute">{r.domain}</span></td><td>{dash(r.positioning)}</td></tr>)}
      </tbody></table></div>
    </>
  );
}

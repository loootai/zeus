import { serviceClient } from "./supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ZeusData {
  run: any | null;
  accounts: any[];
  committees: any[];
  people: any[];
  plays: any[];
  rivals: any[];
  error: string | null;
}

const LIMIT = 500;

/** Reads the Zeus tables (read only). A missing table shows as an error naming the migration, never a value. */
export async function loadZeus(): Promise<ZeusData> {
  const db = serviceClient();
  const [run, accounts, committees, people, plays, rivals] = await Promise.all([
    db.from("runs").select("domain,mode,finished_at,charged_usd,calls,imported_at").order("imported_at", { ascending: false }).limit(1),
    db.from("accounts").select("domain,name,industry,employees,country,grade,score,reasons").order("score", { ascending: false, nullsFirst: false }).limit(LIMIT),
    db.from("committees").select("account_domain,account_name,grade,score,members").order("score", { ascending: false, nullsFirst: false }).limit(LIMIT),
    db.from("people").select("account_domain,name,role,title,linkedin,email,email_status,phone").order("account_domain").limit(LIMIT * 4),
    db.from("plays").select("title,evidence,list,command,cost,basis").order("title").limit(LIMIT),
    db.from("rivals").select("domain,name,positioning").order("domain").limit(LIMIT),
  ]);
  const failed = [run, accounts, committees, people, plays, rivals].find((r) => r.error);
  return {
    run: run.data?.[0] ?? null,
    accounts: accounts.data ?? [],
    committees: committees.data ?? [],
    people: people.data ?? [],
    plays: plays.data ?? [],
    rivals: rivals.data ?? [],
    error: failed ? "Could not read the Zeus tables. Apply supabase/migrations/20261125120000_zeus.sql in your Supabase project, then import your run." : null,
  };
}

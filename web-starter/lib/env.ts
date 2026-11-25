// Env names this app reads. Values come from Vercel (the Supabase integration sets the SUPABASE_* ones)
// and are never printed, logged or sent to the browser.

/** The first non-empty value among the given env names. */
function firstEnv(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

/** Supabase settings, accepting the names the Vercel Supabase integration has used over time. */
export function supabaseEnv() {
  return {
    url: firstEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    anonKey: firstEnv(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    serviceKey: firstEnv(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]),
  };
}

/** The lower-cased owner emails from ZEUS_OWNER_EMAIL (comma separated). Empty means nobody may sign in. */
export function ownerEmails(): string[] {
  return firstEnv(["ZEUS_OWNER_EMAIL"]).split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

/** True when the email is one of the owners. Fails closed when ZEUS_OWNER_EMAIL is unset. */
export function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.trim().toLowerCase());
}

/** Env names that are missing, for the setup screen. Names only. */
export function missingEnv(): string[] {
  const s = supabaseEnv();
  const out: string[] = [];
  if (!s.url) out.push("SUPABASE_URL");
  if (!s.anonKey) out.push("SUPABASE_ANON_KEY");
  if (!s.serviceKey) out.push("SUPABASE_SERVICE_ROLE_KEY");
  if (ownerEmails().length === 0) out.push("ZEUS_OWNER_EMAIL");
  return out;
}

export const SESSION_COOKIE = "zeus_session";

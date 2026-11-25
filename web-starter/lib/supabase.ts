import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isOwner, SESSION_COOKIE, supabaseEnv } from "./env";

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** A Supabase client with the public key, used only for Supabase Auth (send link, check a token). */
export function authClient(): SupabaseClient {
  const e = supabaseEnv();
  return createClient(e.url, e.anonKey, opts);
}

/** A server-only client with the service role key. The tables have RLS on and no policy, so only this can read them. */
export function serviceClient(): SupabaseClient {
  const e = supabaseEnv();
  return createClient(e.url, e.serviceKey, opts);
}

/** Checks an access token with Supabase Auth and returns the email when it belongs to an owner. */
export async function ownerOfToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) return null;
  return isOwner(data.user.email) ? data.user.email! : null;
}

/** The signed-in owner's email from the session cookie, or null. */
export async function currentOwner(): Promise<string | null> {
  const jar = await cookies();
  return ownerOfToken(jar.get(SESSION_COOKIE)?.value);
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isOwner, missingEnv } from "@/lib/env";
import { authClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Sends a Supabase Auth sign-in link, only to the owner's email. Any other address gets the same answer and no email. */
async function sendLink(form: FormData) {
  "use server";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (isOwner(email)) {
    const h = await headers();
    // Prefer the fixed production URL Vercel sets; fall back to the request host (local dev, previews).
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const origin = prod ? `https://${prod}` : `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    await authClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback` } });
  }
  redirect("/login?sent=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; denied?: string }> }) {
  const q = await searchParams;
  if (missingEnv().length) redirect("/");
  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h1>Sign in</h1>
      <p className="mute">Your Zeus GTM OS is private. Only the owner email set on this project can sign in.</p>
      {q.sent && <p>If that is the owner email, a sign-in link is on its way. Open it in this browser.</p>}
      {q.denied && <p>That sign-in did not work. Ask for a new link.</p>}
      <form action={sendLink}>
        <input type="email" name="email" required placeholder="you@example.com" autoComplete="email" />
        <p><button type="submit">Email me a sign-in link</button></p>
      </form>
    </div>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/env";
import { ownerOfToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Sets the session cookie for an owner's Supabase access token, or clears it with ?logout=1. */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("logout")) {
    const res = NextResponse.redirect(new URL("/login", req.url), 303);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : undefined;
  if (!(await ownerOfToken(token))) return NextResponse.json({ ok: false }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token!, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 });
  return res;
}

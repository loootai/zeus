"use client";
import { useEffect, useState } from "react";

/** Supabase Auth sends the user back here with the token in the URL hash. It goes to the server once, then the hash is cleared. */
export default function Callback() {
  const [msg, setMsg] = useState("Signing you in...");
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const token = p.get("access_token");
    history.replaceState(null, "", "/auth/callback");
    if (!token) { window.location.replace("/login?denied=1"); return; }
    fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => { window.location.replace(r.ok ? "/" : "/login?denied=1"); })
      .catch(() => setMsg("Could not sign in. Try a new link."));
  }, []);
  return <p>{msg}</p>;
}

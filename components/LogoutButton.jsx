"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-tiny" onClick={logout} disabled={busy}>
      {busy ? "…" : "Log out"}
    </button>
  );
}

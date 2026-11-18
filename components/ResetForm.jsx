"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Reset form: reads the token from the query string, posts the new password.
 * Success routes to /login?reset=ok so the user signs in fresh (every old
 * session was invalidated with the reset).
 */
export default function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        setTimeout(() => {
          window.location.href = "/login?reset=ok";
        }, 1500);
      } else {
        setError(data.error || "Something went sus on our side. Try again.");
      }
    } catch {
      setError("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <p className="placeholder-title" role="status">Password updated.</p>
        <p className="placeholder-note">
          Every old session was signed out. Taking you to{" "}
          <a href="/login">log in</a>…
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div>
        <p className="placeholder-title">That link is missing its token.</p>
        <p className="placeholder-note">
          Open the reset link from your email, or{" "}
          <a href="/forgot-password">request a fresh one</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="resend-form">
      <div className="field">
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="field-hint">At least 8 characters, with a letter and a number.</p>
      </div>
      {error && (
        <p className="error-text" role="alert">{error}</p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}

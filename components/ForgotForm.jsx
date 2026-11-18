"use client";

import { useState } from "react";

/**
 * Forgot-password form: asks for the email, posts to the generic endpoint.
 * The response never reveals whether the account exists - success text is
 * the same either way. Dev mode (no mail key) surfaces the reset link.
 */
export default function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState(null);
  const [devLink, setDevLink] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      setDone(true);
      setMessage(data.message || "If that email has an account, a reset link is on its way.");
      if (data.devLink) setDevLink(data.devLink);
    } catch {
      setMessage("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <p className="placeholder-title" role="status">{message}</p>
        {devLink && (
          <p className="field-hint">
            Dev mode (no mail key configured) — reset directly:{" "}
            <a href={devLink}>open reset link</a>
          </p>
        )}
        <p className="field-hint">
          <a href="/login">Back to log in</a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="resend-form">
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          spellCheck={false}
          required
        />
        <p className="field-hint">
          We&rsquo;ll email a reset link that expires in 1 hour and works once.
        </p>
      </div>
      {message && (
        <p className="error-text" role="alert">{message}</p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="field-hint">
        Remembered it after all? <a href="/login">Back to log in</a>
      </p>
    </form>
  );
}

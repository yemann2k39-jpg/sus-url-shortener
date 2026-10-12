"use client";

import { useState } from "react";

export default function ResendForm({ initialEmail = "" }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [devLink, setDevLink] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(data.message || "Check your inbox for the verification link.");
        if (data.devVerifyLink) setDevLink(data.devVerifyLink);
      } else {
        setMessage(data.error || "Something went sus on our side. Try again.");
      }
    } catch {
      setMessage("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="resend-form">
      <div className="field">
        <label htmlFor="resend-email">Email</label>
        <input
          id="resend-email"
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          spellCheck={false}
        />
      </div>
      {message && (
        <p className={devLink ? "field-hint" : "error-text"} role="status">
          {message}
        </p>
      )}
      {devLink && (
        <p className="field-hint">
          Dev mode (no mail key configured) — verify directly:{" "}
          <a href={devLink}>open verification link</a>
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Resend verification link"}
      </button>
    </form>
  );
}

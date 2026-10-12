"use client";

import { useState } from "react";

export default function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(data.message || "Password changed.");
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setError(data.error || "Something went sus on our side. Try again.");
      }
    } catch {
      setError("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-tiny pw-toggle"
        onClick={() => setOpen(true)}
      >
        Change password
      </button>
    );
  }

  return (
    <form className="card pw-card" onSubmit={submit} noValidate>
      <p className="placeholder-title">Change your password.</p>

      <div className="field">
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="pw-new">New password</label>
        <input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="field-hint">At least 8 characters, with a letter and a number.</p>
      </div>

      <div className="field">
        <label htmlFor="pw-confirm">Repeat new password</label>
        <input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="field-hint" role="status">
          {done}
        </p>
      )}

      <div className="pw-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Working…" : "Save new password"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { setOpen(false); setError(null); setDone(null); }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

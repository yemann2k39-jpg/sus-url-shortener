"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ initialTab = "login" }) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab === "register" ? "register" : "login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload =
        tab === "login"
          ? { identifier: username.trim(), password }
          : { username: username.trim(), email: email.trim(), password };
      const res = await fetch(`/api/auth/${tab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(data.error || "Something went sus on our side. Try again.");
    } catch {
      setError("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <div className="segmented" role="tablist" aria-label="Login or register">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "login"}
          className={tab === "login" ? "seg active" : "seg"}
          onClick={() => { setTab("login"); setError(null); }}
        >
          Log in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          className={tab === "register" ? "seg active" : "seg"}
          onClick={() => { setTab("register"); setError(null); }}
        >
          Register
        </button>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="auth-username">
            {tab === "login" ? "Username or email" : "Username"}
          </label>
          <input
            id="auth-username"
            type="text"
            autoComplete={tab === "login" ? "username" : "off"}
            placeholder={tab === "login" ? "you or you@test.local" : "pick a name"}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
          />
          {tab === "register" && (
            <p className="field-hint">3-24 characters: letters, numbers, dash, underscore.</p>
          )}
        </div>

        {tab === "register" && (
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="off"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              spellCheck={false}
            />
            <p className="field-hint">One account per email. Stored, never verified — this thing runs on your machine.</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tab === "register" && (
            <p className="field-hint">At least 8 characters, with a letter and a number.</p>
          )}
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Working…" : tab === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import QRCode from "qrcode";

const MODES = [
  {
    value: "redirect",
    label: "Instant redirect",
    hint: "They click, they land on the real site. No warning, no mercy.",
  },
  {
    value: "sus",
    label: "Sus page first",
    hint: "A deadpan warning screen stares at them before the handoff.",
  },
];

function hostOf(target) {
  try {
    return new URL(target).host;
  } catch {
    return target;
  }
}

export default function CreateForm() {
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [mode, setMode] = useState("redirect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (url.trim() === "") {
      setError("Give me something to work with — paste the real URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          slug: slug.trim() === "" ? undefined : slug.trim(),
          mode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setResult(data);
        QRCode.toDataURL(data.susUrl, {
          margin: 1,
          width: 240,
          color: { dark: "#1c1917", light: "#ffffff" },
        })
          .then(setQr)
          .catch(() => setQr(null));
      } else {
        setError(data.error || "Something went sus on our side. Try again.");
      }
    } catch {
      setError("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setQr(null);
    setCopied(false);
    setUrl("");
    setSlug("");
    setMode("redirect");
    setError(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.susUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't reach the clipboard. Copy it the old-fashioned way.");
    }
  }

  if (result) {
    return (
      <div className="card result-card" aria-live="polite">
        <p className="result-kicker">Your sus link is ready.</p>
        <div className="result-link-row">
          <a
            className="result-link"
            href={result.susUrl}
            target="_blank"
            rel="noreferrer"
          >
            {result.susUrl}
          </a>
          <button type="button" className="btn btn-secondary" onClick={copyLink}>
            {copied ? "Copied." : "Copy"}
          </button>
        </div>
        <p className="result-note">
          Actually goes to <strong>{hostOf(result.target)}</strong>
          {" · "}
          {result.mode === "sus" ? "sus page first" : "instant redirect"}
        </p>
        {qr ? (
          <img
            className="qr"
            src={qr}
            alt={`QR code for ${result.susUrl}`}
            width={200}
            height={200}
          />
        ) : (
          <p className="result-note">QR code is camera-shy right now.</p>
        )}
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Sus another one
        </button>
        <a className="btn btn-ghost" href="/dashboard">
          See all your sus links →
        </a>
      </div>
    );
  }

  return (
    <form className="card create-card" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="target-url">The legitimate URL</label>
        <input
          id="target-url"
          type="text"
          inputMode="url"
          placeholder="https://youtube.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label htmlFor="sus-name">
          Sus name <span className="optional">(optional)</span>
        </label>
        <input
          id="sus-name"
          type="text"
          placeholder="FakeYouTube"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="field-hint">
          Leave it empty and we&apos;ll assign a randomly sus code.
        </p>
      </div>

      <fieldset className="field mode-field">
        <legend>Sus delivery</legend>
        <div className="segmented" role="group" aria-label="Sus delivery mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={mode === m.value ? "seg active" : "seg"}
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="field-hint">{MODES.find((m) => m.value === mode).hint}</p>
      </fieldset>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Sussing…" : "Make it sus"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import QrModal from "@/components/QrModal";

/** www.youtube.com/watch?v=abc… — host + path, protocol stripped. */
function displayTarget(target) {
  try {
    const url = new URL(target);
    return (url.host + url.pathname + url.search).replace(/\/$/, "");
  } catch {
    return target;
  }
}

export default function LinksTable({ links: initialLinks }) {
  const [links, setLinks] = useState(initialLinks);
  const [copiedSlug, setCopiedSlug] = useState(null);
  const [confirmSlug, setConfirmSlug] = useState(null);
  const [busySlug, setBusySlug] = useState(null);
  const [qrLink, setQrLink] = useState(null);
  const [error, setError] = useState(null);

  async function copyRow(link) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/${link.slug}`
      );
      setCopiedSlug(link.slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch {
      setError("Couldn't reach the clipboard.");
    }
  }

  async function deleteRow(link) {
    setBusySlug(link.slug);
    setError(null);
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(link.slug)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setLinks((rows) => rows.filter((row) => row.slug !== link.slug));
        setConfirmSlug(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't delete that one. It's persistent.");
      }
    } catch {
      setError("Couldn't reach the sus factory. Is the server running?");
    } finally {
      setBusySlug(null);
    }
  }

  if (links.length === 0) {
    return (
      <div className="card dash-empty">
        <p className="dash-empty-title">That was the last one.</p>
        <p className="dash-empty-note">
          Factory floor is spotless again. <a href="/">Start over</a> if you
          must.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <ul className="dash-list">
        {links.map((link) => (
          <li className="dash-row" key={link.slug}>
            <div className="dash-top">
              <a className="dash-slug" href={`/${link.slug}`}>
                /{link.slug}
              </a>
              <span
                className={
                  link.mode === "sus" ? "pill pill-sus" : "pill pill-redirect"
                }
              >
                {link.mode === "sus" ? "sus page" : "redirect"}
              </span>
            </div>
            <span className="dash-target" title={link.target}>
              {displayTarget(link.target)}
            </span>
            <div className="dash-foot">
              <div className="dash-meta">
                <span className="dash-date">
                  {new Date(link.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span
                  className="dash-clicks"
                  title="Recorded clicks (flushed every few seconds)"
                >
                  {link.clicks} hit{link.clicks === 1 ? "" : "s"}
                </span>
              </div>
              <div className="dash-actions">
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => copyRow(link)}
                >
                  {copiedSlug === link.slug ? "Copied." : "Copy"}
                </button>
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => setQrLink(link)}
                >
                  QR
                </button>
                {confirmSlug === link.slug ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-tiny btn-danger"
                      disabled={busySlug === link.slug}
                      onClick={() => deleteRow(link)}
                    >
                      {busySlug === link.slug ? "Deleting…" : "Sure?"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      onClick={() => setConfirmSlug(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    onClick={() => setConfirmSlug(link.slug)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {qrLink && <QrModal link={qrLink} onClose={() => setQrLink(null)} />}
    </div>
  );
}

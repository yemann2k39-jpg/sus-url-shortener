"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Modal QR preview for a short link: shows a big QR code, the link itself,
 * and a Download PNG button. Renders nothing when `link` is null.
 */
export default function QrModal({ link, onClose }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!link) return undefined;
    setDataUrl(null);
    setFailed(false);
    QRCode.toDataURL(`${window.location.origin}/${link.slug}`, {
      margin: 2,
      width: 480,
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch(() => setFailed(true));
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [link, onClose]);

  if (!link) return null;

  return (
    <div
      className="qr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`QR code for /${link.slug}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card qr-modal">
        <p className="placeholder-title">QR code for /{link.slug}</p>
        {dataUrl ? (
          <img
            className="qr qr-big"
            src={dataUrl}
            alt={`QR code for /${link.slug}`}
            width={280}
            height={280}
          />
        ) : failed ? (
          <p className="error-text">QR code is camera-shy right now. Try again.</p>
        ) : (
          <p className="field-hint">Drawing the codes…</p>
        )}
        <p className="field-hint qr-url">
          {typeof window !== "undefined" ? `${window.location.origin}/` : ""}
          {link.slug}
        </p>
        <div className="qr-actions">
          {dataUrl && (
            <a
              className="btn btn-primary"
              download={`sus-qr-${link.slug}.png`}
              href={dataUrl}
            >
              Download PNG
            </a>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

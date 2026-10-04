import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCache } from "./cache.js";

/**
 * Single storage module for Sus URL Shortener.
 *
 * Backed by SQLite (node:sqlite, built into Node 24 - zero dependencies).
 * Everything that touches storage or owns slug rules lives here, so the
 * engine can later be swapped (e.g. Postgres) by reimplementing this file.
 *
 * Design notes:
 * - slug_key (case-folded slug) carries a UNIQUE index: the duplicate-name
 *   check is an index probe, never a scan.
 * - Auto-generated slugs are base36 encodings of the rowid - unique by
 *   construction, so creation needs no pre-check pass. The unique index
 *   still arbitrates the rare overlap (reserved word / custom slug) and
 *   we retry with a suffix.
 * - clicks column exists from day one; the async counter (TCK-13) fills it.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "links.db");
const LEGACY_JSON = path.join(DATA_DIR, "links.json");

const RESERVED_SLUGS = new Set([
  "api",
  "sus",
  "_next",
  "favicon.ico",
  "dashboard",
]);
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const SUFFIX_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const MAX_SLUG_LEN = 64;
const MAX_URL_LEN = 2048;

export const LINK_MODES = ["redirect", "sus"];

export class StoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.details = details;
  }
}

/* ---------------- database bootstrap + migration ---------------- */

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    slug_key TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('redirect', 'sus')),
    created_at TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_links_created ON links (created_at DESC, id DESC);
`);

// One-time import from the legacy JSON store. Only runs when the table is
// empty and the legacy file exists; the JSON file is renamed after a fully
// successful import so it doubles as the pre-migration backup.
try {
  const count = db.prepare("SELECT COUNT(*) AS n FROM links").get().n;
  if (count === 0 && fs.existsSync(LEGACY_JSON)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
    if (Array.isArray(legacy)) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const ins = db.prepare(
          "INSERT OR IGNORE INTO links (slug, slug_key, target, mode, created_at) VALUES (?, ?, ?, ?, ?)"
        );
        for (const row of legacy) {
          if (
            !row ||
            typeof row.slug !== "string" ||
            typeof row.target !== "string"
          ) {
            continue;
          }
          ins.run(
            row.slug,
            row.slug.toLowerCase(),
            row.target,
            row.mode === "sus" ? "sus" : "redirect",
            row.createdAt ?? new Date().toISOString()
          );
        }
        db.exec("COMMIT");
        fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
      } catch (txErr) {
        db.exec("ROLLBACK");
        throw txErr;
      }
    }
  }
} catch (err) {
  console.error(
    "Legacy links.json import failed (will retry next boot):",
    err?.message ?? err
  );
}

/* ---------------- prepared statements ---------------- */

const COLS = "id, slug, target, mode, created_at, clicks";
const stmtGet = db.prepare(`SELECT ${COLS} FROM links WHERE slug_key = ?`);
const stmtAll = db.prepare(`SELECT ${COLS} FROM links ORDER BY id ASC`);
const stmtPage = db.prepare(
  `SELECT ${COLS} FROM links ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
);
const stmtCount = db.prepare("SELECT COUNT(*) AS n FROM links");
const stmtDeleteById = db.prepare("DELETE FROM links WHERE id = ?");
const stmtInsertBlank = db.prepare(
  "INSERT INTO links (slug, slug_key, target, mode, created_at) VALUES ('', '', ?, ?, ?)"
);
const stmtSetSlug = db.prepare(
  "UPDATE links SET slug = ?, slug_key = ? WHERE id = ?"
);
const stmtInsertCustom = db.prepare(
  "INSERT INTO links (slug, slug_key, target, mode, created_at) VALUES (?, ?, ?, ?, ?)"
);
const stmtAddClicks = db.prepare(
  "UPDATE links SET clicks = clicks + ? WHERE slug_key = ?"
);

/**
 * Hot-link cache in front of lookups. Every redirect/sus hit reads through
 * this, so popular links stop touching SQLite entirely. Entries are keyed
 * by case-folded slug and invalidated on create/delete, so a removed link
 * is never served stale.
 */
export const linkCache = createCache({
  max: Number(process.env.CACHE_MAX) || 2000,
  ttlMs: Number(process.env.CACHE_TTL_MS) || 60000,
});

/* ---------------- helpers ---------------- */

function rowToRecord(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    target: row.target,
    mode: row.mode,
    createdAt: row.created_at,
    clicks: Number(row.clicks),
  };
}

function encodeBase36(n) {
  let s = "";
  do {
    s = BASE36[n % 36] + s;
    n = Math.floor(n / 36);
  } while (n > 0);
  return s;
}

function randomSuffixChar() {
  return SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
}

function isUniqueViolation(err) {
  return (
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint failed/i.test(err?.message ?? "")
  );
}

/* ---------------- validation ---------------- */

export function normalizeTargetUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new StoreError("invalid_url", "A target URL is required.");
  }
  if (input.trim().length > MAX_URL_LEN) {
    throw new StoreError(
      "invalid_url",
      "That URL is suspiciously long. Keep it under 2048 characters."
    );
  }
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new StoreError(
      "invalid_url",
      "That does not parse as a URL. Something like https://youtube.com will do nicely."
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new StoreError(
      "invalid_url",
      "Only http:// and https:// URLs are allowed."
    );
  }
  return parsed.href;
}

export function normalizeSlug(input) {
  const raw = String(input ?? "").trim();

  // Reserved check runs on the raw input: "_next" must not first get
  // sanitized into "next" and slip past.
  if (RESERVED_SLUGS.has(raw.toLowerCase())) {
    throw new StoreError(
      "reserved_slug",
      `"${raw}" is load-bearing infrastructure and cannot be sus.`,
      { slug: raw }
    );
  }

  const cleaned = raw
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (cleaned === "") {
    throw new StoreError(
      "invalid_slug",
      "That sus name has no usable characters left. Letters, numbers and dashes only."
    );
  }
  if (cleaned.length > MAX_SLUG_LEN) {
    throw new StoreError(
      "invalid_slug",
      `Sus names max out at ${MAX_SLUG_LEN} characters.`
    );
  }
  return cleaned;
}

/* ---------------- slug logic ---------------- */

export function slugTaken(slug) {
  return stmtGet.get(String(slug).toLowerCase()) !== undefined;
}

/** First free variation of a taken slug: name-2, name-3, ... then random. */
export function suggestSlug(base) {
  const lower = String(base).toLowerCase();
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base}-${n}`;
    if (!slugTaken(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `${base}-${randomSuffixChar()}${randomSuffixChar()}`;
    if (!slugTaken(candidate)) return candidate;
  }
  return randomSuffixChar() + randomSuffixChar();
}

/* ---------------- operations ---------------- */

export function createLink({ url, slug, mode = "redirect" }) {
  if (!LINK_MODES.includes(mode)) {
    throw new StoreError(
      "invalid_mode",
      'mode must be either "redirect" or "sus".'
    );
  }
  const target = normalizeTargetUrl(url);
  const createdAt = new Date().toISOString();

  // No slug requested: mint a base36 counter code from the rowid.
  if (slug === undefined || slug === null || String(slug).trim() === "") {
    db.exec("BEGIN IMMEDIATE");
    try {
      const res = stmtInsertBlank.run(target, mode, createdAt);
      const id = Number(res.lastInsertRowid);
      let code = encodeBase36(id);
      while (RESERVED_SLUGS.has(code)) {
        code += randomSuffixChar();
      }
      // The unique index arbitrates overlap with custom slugs; append a
      // suffix and retry in the rare conflict case.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          stmtSetSlug.run(code, code.toLowerCase(), id);
          db.exec("COMMIT");
          return getLink(code);
        } catch (err) {
          if (attempt === 4) {
            db.exec("ROLLBACK");
            throw err;
          }
          if (!isUniqueViolation(err)) {
            db.exec("ROLLBACK");
            throw err;
          }
          code += randomSuffixChar();
        }
      }
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  const finalSlug = normalizeSlug(slug);
  if (slugTaken(finalSlug)) {
    throw new StoreError("slug_taken", `"${finalSlug}" is already sus.`, {
      suggestion: suggestSlug(finalSlug),
      slug: finalSlug,
    });
  }
  try {
    stmtInsertCustom.run(
      finalSlug,
      finalSlug.toLowerCase(),
      target,
      mode,
      createdAt
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race against a concurrent create - report as taken.
      throw new StoreError("slug_taken", `"${finalSlug}" is already sus.`, {
        suggestion: suggestSlug(finalSlug),
        slug: finalSlug,
      });
    }
    throw err;
  }
  return getLink(finalSlug);
}

export function getLink(slug) {
  if (typeof slug !== "string" || slug === "") return null;
  let needle = slug;
  try {
    needle = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const key = needle.toLowerCase();
  const cached = linkCache.get(key);
  if (cached !== undefined) return cached;
  const row = stmtGet.get(key);
  const record = row ? rowToRecord(row) : null;
  // Only positive results are cached; a later create of this slug would
  // otherwise be shadowed by a stale miss.
  if (record) linkCache.set(key, record);
  return record;
}

export function deleteLink(slug) {
  if (typeof slug !== "string" || slug === "") return null;
  let needle = slug;
  try {
    needle = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const key = needle.toLowerCase();
  const row = stmtGet.get(key);
  if (!row) return null;
  stmtDeleteById.run(row.id);
  linkCache.del(key);
  return rowToRecord(row);
}

export function loadLinks() {
  return stmtAll.all().map(rowToRecord);
}

/** Newest-first, bounded page of links (created_at DESC, id DESC tiebreak). */
export function listLinks({ limit = 25, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return stmtPage.all(safeLimit, safeOffset).map(rowToRecord);
}

export function countLinks() {
  return Number(stmtCount.get().n);
}

/* ---------------- async click counting ---------------- */

/**
 * Clicks are buffered in memory and flushed to SQLite in one transaction
 * every few seconds - the redirect hot path never writes to disk. A crash
 * loses at most one flush window of counts; that tradeoff is deliberate.
 */
const clickBuffer = new Map(); // slug_key -> pending delta
let flushTimer = null;

export function recordClick(slug) {
  if (typeof slug !== "string" || slug === "") return;
  const key = slug.toLowerCase();
  clickBuffer.set(key, (clickBuffer.get(key) ?? 0) + 1);
  startFlushTimer();
}

export function pendingClicks() {
  return new Map(clickBuffer);
}

export function flushClicks() {
  if (clickBuffer.size === 0) return 0;
  const entries = [...clickBuffer.entries()];
  clickBuffer.clear();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, delta] of entries) stmtAddClicks.run(delta, key);
    db.exec("COMMIT");
  } catch (err) {
    // Never lose counts: push them back into the buffer for the next flush.
    for (const [key, delta] of entries) {
      clickBuffer.set(key, (clickBuffer.get(key) ?? 0) + delta);
    }
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
  return entries.length;
}

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    try {
      flushClicks();
    } catch (err) {
      console.error("click flush failed:", err?.message ?? err);
    }
  }, 5000);
  flushTimer.unref(); // counting must never keep the process alive
}

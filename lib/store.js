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
 * ID generation (user spec): every create allocates a fresh atomic counter
 * ID (the 64-bit AUTOINCREMENT rowid) and encodes it Base62. There are NO
 * existence checks anywhere - the counter suffix guarantees uniqueness, and
 * the UNIQUE(slug_key) index remains as a silent safety net. Custom names
 * are decorative: the final slug is `<name>-<code>`, or just `<code>` when
 * no name is given.
 *
 * The database opens LAZILY on first use. `next build` imports this module
 * in several workers that would otherwise race each other for the SQLite
 * write lock at import time; lazy init keeps builds DB-free.
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
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_NAME_LEN = 48; // name portion; the counter suffix adds a few chars
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

/* ---------------- database bootstrap (lazy) + migration ---------------- */

let db = null;
let stmts = null;

/** Exported for debugging/tooling scripts. */
export function getDb() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new DatabaseSync(DB_FILE);

  // busy_timeout FIRST: concurrent openers (build workers, restarts) must
  // wait for the lock instead of throwing SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000;");
  // WAL is an optimization, not a requirement - never fail boot over it.
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    try {
      db.exec("PRAGMA journal_mode = DELETE;");
    } catch {}
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      slug_key TEXT NOT NULL UNIQUE,
      target TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('redirect', 'sus')),
      created_at TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      owner_key TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_links_created ON links (created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      email_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      owner_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  // Pre-accounts links table: add the owner column if upgrading an old file.
  try {
    db.exec("ALTER TABLE links ADD COLUMN owner_key TEXT NOT NULL DEFAULT ''");
  } catch {}

  migrateLegacyJson(db);

  stmts = {
    get: db.prepare(`SELECT ${COLS} FROM links WHERE slug_key = ?`),
    all: db.prepare(`SELECT ${COLS} FROM links ORDER BY id ASC`),
    page: db.prepare(
      `SELECT ${COLS} FROM links ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ),
    count: db.prepare("SELECT COUNT(*) AS n FROM links"),
    delById: db.prepare("DELETE FROM links WHERE id = ?"),
    insBlank: db.prepare(
      "INSERT INTO links (slug, slug_key, target, mode, created_at, owner_key) VALUES ('', '', ?, ?, ?, ?)"
    ),
    setSlug: db.prepare("UPDATE links SET slug = ?, slug_key = ? WHERE id = ?"),
    addClicks: db.prepare(
      "UPDATE links SET clicks = clicks + ? WHERE slug_key = ?"
    ),
    userIns: db.prepare(
      "INSERT INTO users (username, username_key, email, email_key, password_hash, owner_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ),
    userByUsernameKey: db.prepare(
      "SELECT id, username, email, password_hash, owner_key, created_at FROM users WHERE username_key = ?"
    ),
    userByEmailKey: db.prepare(
      "SELECT id, username, email, password_hash, owner_key, created_at FROM users WHERE email_key = ?"
    ),
    userById: db.prepare(
      "SELECT id, username, email, owner_key, created_at FROM users WHERE id = ?"
    ),
    sessionIns: db.prepare(
      "INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ),
    sessionGet: db.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?"
    ),
    sessionDel: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    linksWipe: db.prepare("DELETE FROM links"),
    pageByOwner: db.prepare(
      `SELECT ${COLS} FROM links WHERE owner_key = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ),
    countByOwner: db.prepare(
      "SELECT COUNT(*) AS n FROM links WHERE owner_key = ?"
    ),
  };

  return db;
}

const COLS = "id, slug, target, mode, created_at, clicks, owner_key";

/** One-time import from the legacy JSON store (see module docstring). */
function migrateLegacyJson(database) {
  try {
    const count = database
      .prepare("SELECT COUNT(*) AS n FROM links")
      .get().n;
    if (count === 0 && fs.existsSync(LEGACY_JSON)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
      if (Array.isArray(legacy)) {
        database.exec("BEGIN IMMEDIATE");
        try {
          const ins = database.prepare(
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
          database.exec("COMMIT");
          fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
        } catch (txErr) {
          database.exec("ROLLBACK");
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
}

function st() {
  getDb();
  return stmts;
}

/* ---------------- code cipher (offset + Feistel scramble) ---------------- */

/**
 * Auto codes are scrambled counter values placed inside the "6-character
 * band" of Base62: every value in [62^5, 62^6) encodes to exactly six
 * characters, so codes are born long and look non-sequential right away.
 *
 * The band holds 2^34 (~17.2 billion) codes. A counter id is mapped to a
 * band index, pushed through a 4-round Feistel network (a reversible
 * bitwise cipher: bijective by construction, so two different ids can
 * never produce the same code - no hashing, no collision checks), and the
 * result is added to the band base before encoding.
 *
 * This is obfuscation, not encryption: it defeats casual guessing and
 * enumeration, not a determined cryptanalyst. The mixing constants below
 * are the "secret" - rotating them changes future codes only (existing
 * links are stored, never recomputed).
 */
const B62_BAND_BASE = 62n ** 5n; // 916,132,832 - first 6-char Base62 value
const CIPHER_BAND_SIZE = 2n ** 34n; // ~17.2 billion codes, all 6 chars
const CIPHER_HALF_BITS = 17n;
const CIPHER_HALF_MASK = (1n << CIPHER_HALF_BITS) - 1n;

function feistelMix(right, round) {
  let v = right * 2654435761n + BigInt(round) * 40503n;
  v ^= v >> 7n;
  return v * 1597334677n;
}

/** Bijective map of a band index [0, 2^34) to a scrambled band index. */
function scrambleBandIndex(bandIndex) {
  let left = (bandIndex >> CIPHER_HALF_BITS) & CIPHER_HALF_MASK;
  let right = bandIndex & CIPHER_HALF_MASK;
  for (let round = 0; round < 4; round += 1) {
    const f = feistelMix(right, round) & CIPHER_HALF_MASK;
    const nextLeft = right;
    const nextRight = left ^ f;
    left = nextLeft;
    right = nextRight;
  }
  return (left << CIPHER_HALF_BITS) | right;
}

/** Turn a link rowid into its public Base62 code. Exported for tooling. */
export function codeForId(id) {
  const bandIndex = BigInt(id) - 1n; // first link -> index 0
  if (bandIndex < CIPHER_BAND_SIZE) {
    return encodeBase62(B62_BAND_BASE + scrambleBandIndex(bandIndex)); // 6 chars
  }
  // Band exhausted (~17.2 billion links): fall back to a longer code
  // rather than ever reusing or colliding.
  return encodeBase62(B62_BAND_BASE + bandIndex);
}

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
    ownerKey: row.owner_key ?? "",
  };
}

/* ---------------- accounts (users + sessions) ---------------- */

function userRowToRecord(row) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    ownerKey: row.owner_key,
    createdAt: row.created_at,
  };
}

export function createUser({ username, email, passwordHash, ownerKey }) {
  const database = getDb();
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "INSERT INTO users (username, username_key, email, email_key, password_hash, owner_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(username, username.toLowerCase(), email, email.toLowerCase(), passwordHash, ownerKey, now);
    database.exec("COMMIT");
  } catch (err) {
    try { database.exec("ROLLBACK"); } catch {}
    if (isUniqueViolation(err)) {
      const msg = String(err?.message ?? "");
      if (/username_key/i.test(msg)) {
        throw new StoreError("duplicate_username", "That username is already taken.", { field: "username" });
      }
      throw new StoreError("duplicate_email", "That email already has an account.", { field: "email" });
    }
    throw err;
  }
  return userById(database.prepare("SELECT id FROM users WHERE owner_key = ?").get(ownerKey).id);
}

export function userByUsername(username) {
  const row = getDb()
    .prepare("SELECT id, username, email, password_hash, owner_key, created_at FROM users WHERE username_key = ?")
    .get(String(username ?? "").toLowerCase());
  return row ? { ...userRowToRecord(row), passwordHash: row.password_hash } : null;
}

export function userByEmail(email) {
  const row = getDb()
    .prepare("SELECT id, username, email, password_hash, owner_key, created_at FROM users WHERE email_key = ?")
    .get(String(email ?? "").toLowerCase());
  return row ? { ...userRowToRecord(row), passwordHash: row.password_hash } : null;
}

export function userById(id) {
  const row = getDb()
    .prepare("SELECT id, username, email, owner_key, created_at FROM users WHERE id = ?")
    .get(Number(id));
  return row ? userRowToRecord(row) : null;
}

export function sessionInsert(tokenHash, userId, expiresAt) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(String(tokenHash), Number(userId), new Date().toISOString(), String(expiresAt));
}

/** Returns { userId, expiresAt } or null (missing or expired). */
export function sessionGet(tokenHash) {
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(String(tokenHash));
  if (!row) return null;
  if (String(row.expires_at) <= new Date().toISOString()) {
    sessionDelete(String(row.token_hash));
    return null;
  }
  return { userId: Number(row.user_id), expiresAt: String(row.expires_at) };
}

export function sessionDelete(tokenHash) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(String(tokenHash));
}

/** Resolve the account behind a raw session cookie token (or null). */
export function userBySessionToken(token) {
  const session = sessionGet(String(token ?? ""));
  if (!session) return null;
  return userById(session.userId);
}

/** One-time wipe (user-approved when accounts shipped). */
export function linksWipeAll() {
  getDb().prepare("DELETE FROM links").run();
}

function encodeBase62(value) {
  let n = BigInt(value); // accepts Number or BigInt (cipher outputs BigInt)
  let s = "";
  do {
    s = BASE62[Number(n % 62n)] + s;
    n = n / 62n;
  } while (n > 0n);
  return s;
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

/**
 * Sanitize the human-chosen name portion. Never throws and never checks
 * availability: the counter suffix appended by createLink guarantees the
 * final slug is unique no matter what the user types.
 */
export function normalizeName(input) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LEN);
}

/* ---------------- operations ---------------- */

export function createLink({ url, slug, mode = "redirect", ownerKey = "" }) {
  if (!LINK_MODES.includes(mode)) {
    throw new StoreError(
      "invalid_mode",
      'mode must be either "redirect" or "sus".'
    );
  }
  const target = normalizeTargetUrl(url);
  const createdAt = new Date().toISOString();
  const s = st();
  const database = getDb();

  // Allocate the atomic counter ID: insert the row, take its 64-bit rowid.
  // No existence checks anywhere - the cipher + counter guarantee uniqueness.
  database.exec("BEGIN IMMEDIATE");
  try {
    const res = s.insBlank.run(target, mode, createdAt, String(ownerKey ?? ""));
    const id = Number(res.lastInsertRowid);
    const name = normalizeName(slug);
    let code = codeForId(id);
    let finalSlug = name === "" ? code : `${name}-${code}`;
    // Reserved route names are checked on the FINAL slug with an in-memory
    // set - a set lookup, never a database read.
    while (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      finalSlug = name === "" ? `${code}0` : `${name}-${code}0`;
    }
    // The unique index is a silent safety net; the cipher makes collisions
    // impossible by construction, but retry defensively anyway.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        s.setSlug.run(finalSlug, finalSlug.toLowerCase(), id);
        database.exec("COMMIT");
        return getLink(finalSlug);
      } catch (err) {
        if (attempt === 4 || !isUniqueViolation(err)) {
          database.exec("ROLLBACK");
          throw err;
        }
        finalSlug += "0";
      }
    }
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw err;
  }
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
  const row = st().get.get(key);
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
  const row = st().get.get(key);
  if (!row) return null;
  st().delById.run(row.id);
  linkCache.del(key);
  return rowToRecord(row);
}

export function loadLinks() {
  return st().all.all().map(rowToRecord);
}

/** Newest-first, bounded page of links (created_at DESC, id DESC tiebreak).
 *  Pass ownerKey to scope the page to one member's collection. */
export function listLinks({ limit = 25, offset = 0, ownerKey = null } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  if (ownerKey) {
    return st().pageByOwner
      .all(String(ownerKey), safeLimit, safeOffset)
      .map(rowToRecord);
  }
  return st().page.all(safeLimit, safeOffset).map(rowToRecord);
}

export function countLinks(ownerKey = null) {
  if (ownerKey) {
    return Number(st().countByOwner.get(String(ownerKey)).n);
  }
  return Number(st().count.get().n);
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
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const addClicks = st().addClicks;
    for (const [key, delta] of entries) addClicks.run(delta, key);
    database.exec("COMMIT");
  } catch (err) {
    // Never lose counts: push them back into the buffer for the next flush.
    for (const [key, delta] of entries) {
      clickBuffer.set(key, (clickBuffer.get(key) ?? 0) + delta);
    }
    try {
      database.exec("ROLLBACK");
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

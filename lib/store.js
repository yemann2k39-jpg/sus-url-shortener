import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createCache } from "./cache.js";

/**
 * Single storage module for Sus URL Shortener.
 *
 * Backed by LibSQL (Turso-compatible SQLite). Dual-mode:
 *   - TURSO_DATABASE_URL set  -> remote Turso/LibSQL server (production,
 *     works on Vercel's serverless runtime)
 *   - otherwise               -> local file data/links.db (development,
 *     same workflow as the original node:sqlite build)
 *
 * Everything that touches storage or owns slug rules lives here, so the
 * engine can be swapped again by reimplementing this file.
 *
 * ID generation (user spec): every create allocates a fresh atomic counter
 * ID (the AUTOINCREMENT rowid) and encodes it Base62 through the Feistel
 * band cipher. No existence checks, no collisions by construction.
 *
 * The client opens LAZILY on first use, and the schema is created
 * idempotently once per process (safe on cold starts).
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
  "verify",
  "resend",
]);
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_NAME_LEN = 40; // name portion; the counter suffix adds a few chars
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

/* ---------------- client bootstrap (lazy) + schema ---------------- */

let client = null;
let schemaReady = null; // promise, shared by concurrent first callers

/** Exported for debugging/tooling scripts. */
export function getDb() {
  if (client) return client;

  if (process.env.TURSO_DATABASE_URL) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    client = createClient({ url: `file:${DB_FILE}` });
  }
  return client;
}

const SCHEMA_SQL = `
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
    created_at TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS verification_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`;

async function ensureSchema() {
  const db = getDb();
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = SCHEMA_SQL.split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sql of statements) {
        await db.execute(sql);
      }
      if (!process.env.TURSO_DATABASE_URL) {
        // Local-file conveniences: WAL for concurrent readers (best effort),
        // and the one-time legacy JSON import from the original build.
        try {
          await db.execute("PRAGMA busy_timeout = 5000;");
          await db.execute("PRAGMA journal_mode = WAL;");
        } catch {}
        await migrateLegacyJson(db);
      }
    })().catch((err) => {
      schemaReady = null; // allow retry on next call
      throw err;
    });
  }
  return schemaReady;
}

/** One-time import from the legacy JSON store (local file mode only). */
async function migrateLegacyJson(db) {
  try {
    const rs = await db.execute("SELECT COUNT(*) AS n FROM links");
    const count = Number(Array.from(rs.rows)[0].n);
    if (count === 0 && fs.existsSync(LEGACY_JSON)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
      if (Array.isArray(legacy)) {
        const stmts = legacy
          .filter(
            (row) =>
              row &&
              typeof row.slug === "string" &&
              typeof row.target === "string"
          )
          .map((row) => ({
            sql: "INSERT OR IGNORE INTO links (slug, slug_key, target, mode, created_at) VALUES (?, ?, ?, ?, ?)",
            args: [
              row.slug,
              row.slug.toLowerCase(),
              row.target,
              row.mode === "sus" ? "sus" : "redirect",
              row.createdAt ?? new Date().toISOString(),
            ],
          }));
        if (stmts.length > 0) {
          await db.batch(stmts, "write");
        }
        fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
      }
    }
  } catch (err) {
    console.error(
      "Legacy links.json import failed (will retry next boot):",
      err?.message ?? err
    );
  }
}

/* ---------------- code cipher (offset + Feistel scramble) ---------------- */

/**
 * Auto codes are scrambled counter values placed inside the "6-character
 * band" of Base62. Obfuscation, not encryption: bijective by construction,
 * so two different ids can never produce the same code.
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
 * Hot-link cache in front of lookups. Entries are keyed by case-folded slug
 * and invalidated on create/delete, so a removed link is never served stale.
 * (Per-instance; reset on serverless cold starts - acceptable.)
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

const LINK_COLS =
  "id, slug, target, mode, created_at, clicks, owner_key";

/* ---------------- accounts (users + sessions) ---------------- */

function userRowToRecord(row) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    ownerKey: row.owner_key,
    createdAt: row.created_at,
    emailVerified: Boolean(Number(row.email_verified)),
  };
}

const USER_COLS =
  "id, username, email, password_hash, owner_key, created_at, email_verified";
const USER_COLS_PUBLIC =
  "id, username, email, owner_key, created_at, email_verified";

export async function createUser({ username, email, passwordHash, ownerKey }) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  try {
    await db.execute({
      sql: "INSERT INTO users (username, username_key, email, email_key, password_hash, owner_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        username,
        username.toLowerCase(),
        email,
        email.toLowerCase(),
        passwordHash,
        ownerKey,
        now,
      ],
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const msg = String(err?.message ?? "");
      if (/username_key/i.test(msg)) {
        throw new StoreError("duplicate_username", "That username is already taken.", { field: "username" });
      }
      throw new StoreError("duplicate_email", "That email already has an account.", { field: "email" });
    }
    throw err;
  }
  const rs = await db.execute({
    sql: "SELECT id FROM users WHERE owner_key = ?",
    args: [ownerKey],
  });
  return userById(Number(Array.from(rs.rows)[0].id));
}

export async function userByUsername(username) {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `SELECT ${USER_COLS} FROM users WHERE username_key = ?`,
    args: [String(username ?? "").toLowerCase()],
  });
  const row = Array.from(rs.rows)[0];
  return row ? { ...userRowToRecord(row), passwordHash: row.password_hash } : null;
}

export async function userByEmail(email) {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `SELECT ${USER_COLS} FROM users WHERE email_key = ?`,
    args: [String(email ?? "").toLowerCase()],
  });
  const row = Array.from(rs.rows)[0];
  return row ? { ...userRowToRecord(row), passwordHash: row.password_hash } : null;
}

export async function userById(id) {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `SELECT ${USER_COLS_PUBLIC} FROM users WHERE id = ?`,
    args: [Number(id)],
  });
  const row = Array.from(rs.rows)[0];
  return row ? userRowToRecord(row) : null;
}

export async function sessionInsert(tokenHash, userId, expiresAt) {
  await ensureSchema();
  await getDb().execute({
    sql: "INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [String(tokenHash), Number(userId), new Date().toISOString(), String(expiresAt)],
  });
}

/** Returns { userId, expiresAt } or null (missing or expired). */
export async function sessionGet(tokenHash) {
  await ensureSchema();
  const rs = await getDb().execute({
    sql: "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    args: [String(tokenHash)],
  });
  const row = Array.from(rs.rows)[0];
  if (!row) return null;
  if (String(row.expires_at) <= new Date().toISOString()) {
    await sessionDelete(String(row.token_hash));
    return null;
  }
  return { userId: Number(row.user_id), expiresAt: String(row.expires_at) };
}

export async function sessionDelete(tokenHash) {
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM sessions WHERE token_hash = ?",
    args: [String(tokenHash)],
  });
}

/** Resolve the account behind a raw session cookie token (or null). */
export async function userBySessionToken(token) {
  const session = await sessionGet(String(token ?? ""));
  if (!session) return null;
  return userById(session.userId);
}

/* ---------------- email verification tokens ---------------- */

/** Store a hashed verification token, replacing any earlier ones. */
export async function verificationTokenInsert(tokenHash, userId, expiresAt) {
  await ensureSchema();
  const db = getDb();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: "DELETE FROM verification_tokens WHERE user_id = ?",
      args: [Number(userId)],
    });
    await tx.execute({
      sql: "INSERT INTO verification_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      args: [String(tokenHash), Number(userId), new Date().toISOString(), String(expiresAt)],
    });
    await tx.commit();
  } catch (err) {
    tx.close();
    throw err;
  }
}

/** Consume a hashed token: returns { userId } once, null if unknown/expired. */
export async function verificationTokenConsume(tokenHash) {
  await ensureSchema();
  const db = getDb();
  const tx = await db.transaction("write");
  try {
    const rs = await tx.execute({
      sql: "SELECT user_id, expires_at FROM verification_tokens WHERE token_hash = ?",
      args: [String(tokenHash)],
    });
    const row = Array.from(rs.rows)[0];
    if (!row) {
      tx.close();
      return null;
    }
    await tx.execute({
      sql: "DELETE FROM verification_tokens WHERE token_hash = ?",
      args: [String(tokenHash)],
    });
    await tx.commit();
    if (String(row.expires_at) <= new Date().toISOString()) return null;
    return { userId: Number(row.user_id) };
  } catch (err) {
    tx.close();
    throw err;
  }
}

/** Flag an account verified; single source of truth for the login gate. */
export async function setUserEmailVerified(userId) {
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE users SET email_verified = 1 WHERE id = ?",
    args: [Number(userId)],
  });
}

/** Replace a user's password hash (change-password flow). */
export async function updateUserPasswordHash(userId, passwordHash) {
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [String(passwordHash), Number(userId)],
  });
}

/** One-time wipe (user-approved when accounts shipped). */
export async function linksWipeAll() {
  await ensureSchema();
  await getDb().execute("DELETE FROM links");
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
 * Sanitize the human-chosen name portion. Never throws on content and never
 * checks availability: the counter suffix appended by createLink guarantees
 * the final slug is unique no matter what the user types.
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

export async function createLink({ url, slug, mode = "redirect", ownerKey = "" }) {
  if (!LINK_MODES.includes(mode)) {
    throw new StoreError(
      "invalid_mode",
      'mode must be either "redirect" or "sus".'
    );
  }
  const target = normalizeTargetUrl(url);
  // Optional custom name: when provided it may be at most MAX_NAME_LEN chars
  // (checked on the raw trimmed input, before sanitization).
  const rawName = String(slug ?? "").trim();
  if (rawName !== "" && rawName.length > MAX_NAME_LEN) {
    throw new StoreError(
      "invalid_slug",
      "The sus name must be 40 characters or fewer (or leave it empty)."
    );
  }
  const createdAt = new Date().toISOString();
  await ensureSchema();
  const db = getDb();

  // Allocate the atomic counter ID: insert the row, take its rowid.
  // No existence checks anywhere - the cipher + counter guarantee uniqueness.
  const tx = await db.transaction("write");
  try {
    const res = await tx.execute({
      sql: "INSERT INTO links (slug, slug_key, target, mode, created_at, owner_key) VALUES ('', '', ?, ?, ?, ?)",
      args: [target, mode, createdAt, String(ownerKey ?? "")],
    });
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
        await tx.execute({
          sql: "UPDATE links SET slug = ?, slug_key = ? WHERE id = ?",
          args: [finalSlug, finalSlug.toLowerCase(), id],
        });
        await tx.commit();
        return await getLink(finalSlug);
      } catch (err) {
        if (attempt === 4 || !isUniqueViolation(err)) {
          tx.close();
          throw err;
        }
        finalSlug += "0";
      }
    }
  } catch (err) {
    tx.close();
    throw err;
  }
}

export async function getLink(slug) {
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
  await ensureSchema();
  const rs = await getDb().execute({
    sql: `SELECT ${LINK_COLS} FROM links WHERE slug_key = ?`,
    args: [key],
  });
  const row = Array.from(rs.rows)[0];
  const record = row ? rowToRecord(row) : null;
  // Only positive results are cached; a later create of this slug would
  // otherwise be shadowed by a stale miss.
  if (record) linkCache.set(key, record);
  return record;
}

export async function deleteLink(slug) {
  if (typeof slug !== "string" || slug === "") return null;
  let needle = slug;
  try {
    needle = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const key = needle.toLowerCase();
  await ensureSchema();
  const db = getDb();
  const tx = await db.transaction("write");
  try {
    const rs = await tx.execute({
      sql: `SELECT ${LINK_COLS} FROM links WHERE slug_key = ?`,
      args: [key],
    });
    const row = Array.from(rs.rows)[0];
    if (!row) {
      tx.close();
      return null;
    }
    await tx.execute({
      sql: "DELETE FROM links WHERE id = ?",
      args: [Number(row.id)],
    });
    await tx.commit();
    linkCache.del(key);
    return rowToRecord(row);
  } catch (err) {
    tx.close();
    throw err;
  }
}

/** Newest-first, bounded page of links. Pass ownerKey to scope to one member. */
export async function listLinks({ limit = 25, offset = 0, ownerKey = null } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeOffset = Math.max(0, Number(offset) || 0);
  await ensureSchema();
  const rs = ownerKey
    ? await getDb().execute({
        sql: `SELECT ${LINK_COLS} FROM links WHERE owner_key = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        args: [String(ownerKey), safeLimit, safeOffset],
      })
    : await getDb().execute({
        sql: `SELECT ${LINK_COLS} FROM links ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        args: [safeLimit, safeOffset],
      });
  return Array.from(rs.rows).map(rowToRecord);
}

export async function countLinks(ownerKey = null) {
  await ensureSchema();
  const rs = ownerKey
    ? await getDb().execute({
        sql: "SELECT COUNT(*) AS n FROM links WHERE owner_key = ?",
        args: [String(ownerKey)],
      })
    : await getDb().execute("SELECT COUNT(*) AS n FROM links");
  return Number(Array.from(rs.rows)[0].n);
}

/* ---------------- async click counting ---------------- */

/**
 * Clicks are buffered in memory and flushed in one transaction every few
 * seconds - the redirect hot path never waits on a write. A crash loses at
 * most one flush window of counts; that tradeoff is deliberate.
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

export async function flushClicks() {
  if (clickBuffer.size === 0) return 0;
  const entries = [...clickBuffer.entries()];
  clickBuffer.clear();
  await ensureSchema();
  const db = getDb();
  const tx = await db.transaction("write");
  try {
    for (const [key, delta] of entries) {
      await tx.execute({
        sql: "UPDATE links SET clicks = clicks + ? WHERE slug_key = ?",
        args: [delta, key],
      });
    }
    await tx.commit();
  } catch (err) {
    tx.close();
    // Never lose counts: push them back into the buffer for the next flush.
    for (const [key, delta] of entries) {
      clickBuffer.set(key, (clickBuffer.get(key) ?? 0) + delta);
    }
    throw err;
  }
  return entries.length;
}

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushClicks().catch((err) =>
      console.error("click flush failed:", err?.message ?? err)
    );
  }, 5000);
  flushTimer.unref?.(); // counting must never keep the process alive
}

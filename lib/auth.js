// Accounts: hashing, validation, tokens. Pure crypto - all storage lives in lib/store.js.
import crypto from "node:crypto";

export const SESSION_COOKIE = "sus_session";

export class AuthError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.details = details;
  }
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Throws AuthError unless username, email and password all pass the basic rules. */
export function validateRegistration({ username, email, password }) {
  const u = String(username ?? "").trim();
  const e = String(email ?? "").trim().toLowerCase();
  const p = String(password ?? "");
  const errors = [];

  if (!USERNAME_RE.test(u)) {
    errors.push("Username must be 3-24 characters: letters, numbers, dash or underscore.");
  }
  if (!EMAIL_RE.test(e)) {
    errors.push("That email does not look right.");
  }
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) {
    errors.push("Password must be at least 8 characters and include a letter and a number.");
  }
  if (errors.length > 0) {
    throw new AuthError("invalid_registration", errors.join(" "));
  }
  return { username: u, email: e, password: p };
}

/** scrypt hash, format "s1:<salthex>:<hashhex>" - passwords are never stored plain. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `s1:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const hash = crypto.scryptSync(String(password), parts[1], 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

/** Per-account filing tag: unique, random, 16 hex chars. */
export function newOwnerKey() {
  return crypto.randomBytes(8).toString("hex");
}

/** Raw session token for the cookie. Only its SHA-256 is stored server-side. */
export function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function sessionExpiry(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Single storage module for Sus URL Shortener.
 * Everything that touches disk or owns slug rules lives here, so the
 * JSON-file backend can later be swapped for a real database by
 * reimplementing this one file.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "links.json");

const RESERVED_SLUGS = new Set(["api", "sus", "_next", "favicon.ico", "dashboard"]);
// Unambiguous alphabet: no 0/O or 1/l/I lookalikes.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
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

/* ---------------- disk layer ---------------- */

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
}

export function loadLinks() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted store: fail loud rather than silently wiping links.
    throw new StoreError("store_corrupt", "data/links.json is not valid JSON.");
  }
}

export function saveLinks(links) {
  ensureDataFile();
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------------- validation ---------------- */

export function normalizeTargetUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new StoreError("invalid_url", "A target URL is required.");
  }
  if (input.trim().length > MAX_URL_LEN) {
    throw new StoreError("invalid_url", "That URL is suspiciously long. Keep it under 2048 characters.");
  }
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new StoreError("invalid_url", "That does not parse as a URL. Something like https://youtube.com will do nicely.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new StoreError("invalid_url", "Only http:// and https:// URLs are allowed.");
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
    throw new StoreError("invalid_slug", `Sus names max out at ${MAX_SLUG_LEN} characters.`);
  }
  return cleaned;
}

/* ---------------- slug logic ---------------- */

export function slugTaken(slug, links) {
  const needle = slug.toLowerCase();
  return links.some((link) => link.slug.toLowerCase() === needle);
}

export function randomCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** First free variation of a taken slug: name-2, name-3, ... then random. */
export function suggestSlug(base, links) {
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base}-${n}`;
    if (!slugTaken(candidate, links)) return candidate;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `${base}-${randomCode(4)}`;
    if (!slugTaken(candidate, links)) return candidate;
  }
  return randomCode();
}

/* ---------------- operations ---------------- */

export function createLink({ url, slug, mode = "redirect" }) {
  if (!LINK_MODES.includes(mode)) {
    throw new StoreError("invalid_mode", 'mode must be either "redirect" or "sus".');
  }
  const target = normalizeTargetUrl(url);
  const links = loadLinks();

  let finalSlug;
  if (slug === undefined || slug === null || String(slug).trim() === "") {
    do {
      finalSlug = randomCode();
    } while (slugTaken(finalSlug, links));
  } else {
    finalSlug = normalizeSlug(slug);
    if (slugTaken(finalSlug, links)) {
      throw new StoreError("slug_taken", `"${finalSlug}" is already sus.`, {
        suggestion: suggestSlug(finalSlug, links),
        slug: finalSlug,
      });
    }
  }

  const record = {
    slug: finalSlug,
    target,
    mode,
    createdAt: new Date().toISOString(),
  };
  links.push(record);
  saveLinks(links);
  return record;
}

export function getLink(slug) {
  if (typeof slug !== "string" || slug === "") return null;
  let needle = slug;
  try {
    needle = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const lowered = needle.toLowerCase();
  return loadLinks().find((link) => link.slug.toLowerCase() === lowered) ?? null;
}

export function deleteLink(slug) {
  if (typeof slug !== "string" || slug === "") return null;
  let needle = slug;
  try {
    needle = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const lowered = needle.toLowerCase();
  const links = loadLinks();
  const index = links.findIndex((link) => link.slug.toLowerCase() === lowered);
  if (index === -1) return null;
  const [removed] = links.splice(index, 1);
  saveLinks(links);
  return removed;
}

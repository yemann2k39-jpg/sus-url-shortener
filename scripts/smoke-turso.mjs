// One-shot remote smoke test against Turso (TURSO_* env vars required).
import { createUser, createLink, getLink, deleteLink, getDb } from "../lib/store.js";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? " - " + extra : ""}`);
  if (!ok) failures += 1;
}

const stamp = Date.now().toString(36);
const username = `smoke${stamp}`;
const email = `smoke${stamp}@example.com`;
const ownerKey = `smokekey${stamp}`;

const user = await createUser({ username, email, passwordHash: "s1:smoke:smoke", ownerKey });
check("createUser remote", Boolean(user?.id && user.ownerKey === ownerKey), `id=${user?.id}`);

const link = await createLink({ url: "https://example.com/turso-smoke", slug: "TursoSmoke", ownerKey });
check("createLink remote", Boolean(link?.slug?.startsWith("tursoSmoke-") || link?.slug?.startsWith("TursoSmoke-")), `slug=${link?.slug}`);

const fetched = await getLink(link.slug);
check("getLink remote", fetched?.target === "https://example.com/turso-smoke");
check("getLink cache hit", (await getLink(link.slug))?.id === fetched.id);

const removed = await deleteLink(link.slug);
check("deleteLink remote", removed?.slug === link.slug);
check("getLink after delete", (await getLink(link.slug)) === null);

// cleanup user + any sessions
const db = getDb();
await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [user.id] });
await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [user.id] });
const left = await db.execute({ sql: "SELECT COUNT(*) AS n FROM links WHERE owner_key = ?", args: [ownerKey] });
check("cleanup", Number(Array.from(left.rows)[0].n) === 0 && !(await getLink(link.slug)));

console.log(failures === 0 ? "RESULT: ALL PASS" : `RESULT: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

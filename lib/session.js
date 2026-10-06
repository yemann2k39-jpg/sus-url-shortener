// Server-side session resolution for pages/layouts/route handlers.
import { cookies } from "next/headers";
import { hashToken, SESSION_COOKIE } from "./auth.js";
import { sessionGet, userById } from "./store.js";

/** The logged-in account for this request, or null. */
export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = sessionGet(hashToken(token));
  if (!session) return null;
  return userById(session.userId);
}

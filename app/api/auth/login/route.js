import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import {
  AuthError,
  verifyPassword,
  newSessionToken,
  hashToken,
  sessionExpiry,
  SESSION_COOKIE,
} from "@/lib/auth";
import { userByUsername, userByEmail, sessionInsert } from "@/lib/store";

export async function POST(req) {
  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`auth:${ip}`, Number(process.env.RATE_LIMIT_AUTH) || 30, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Take a breath and try again later.", code: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) },
      }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON.", code: "invalid_json" }, { status: 400 });
  }

  const identifier = String(body?.identifier ?? body?.username ?? body?.email ?? "").trim();
  const password = String(body?.password ?? "");
  try {
    // Username or email both work as the login key.
    const user =
      (identifier && userByUsername(identifier.toLowerCase())) ||
      (identifier && userByEmail(identifier.toLowerCase()));
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Wrong username or password.", code: "invalid_credentials" },
        { status: 401 }
      );
    }

    const token = newSessionToken();
    sessionInsert(hashToken(token), user.id, sessionExpiry(7));
    const resp = NextResponse.json(
      { user: { username: user.username, email: user.email, ownerKey: user.ownerKey, createdAt: user.createdAt } },
      { status: 200 }
    );
    resp.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return resp;
  } catch (err) {
    console.error("login failed unexpectedly:", err);
    return NextResponse.json(
      { error: "Something went sus on our side. Try again.", code: "internal" },
      { status: 500 }
    );
  }
}

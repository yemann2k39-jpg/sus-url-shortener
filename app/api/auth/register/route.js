import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import {
  AuthError,
  validateRegistration,
  hashPassword,
  newOwnerKey,
  newSessionToken,
  hashToken,
  sessionExpiry,
  SESSION_COOKIE,
} from "@/lib/auth";
import { createUser, userByUsername, userByEmail, sessionInsert } from "@/lib/store";

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

  try {
    const { username, email, password } = validateRegistration(body);
    if (userByUsername(username)) {
      return NextResponse.json(
        { error: "That username is already taken.", code: "duplicate_username" },
        { status: 409 }
      );
    }
    if (userByEmail(email)) {
      return NextResponse.json(
        { error: "That email already has an account.", code: "duplicate_email" },
        { status: 409 }
      );
    }
    const ownerKey = newOwnerKey();
    const passwordHash = hashPassword(password);
    const user = createUser({ username, email, passwordHash, ownerKey });

    // Auto-login on registration.
    const token = newSessionToken();
    sessionInsert(hashToken(token), user.id, sessionExpiry(7));
    const resp = NextResponse.json(
      { user: { username: user.username, email: user.email, ownerKey: user.ownerKey, createdAt: user.createdAt } },
      { status: 201 }
    );
    resp.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return resp;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("register failed unexpectedly:", err);
    return NextResponse.json(
      { error: "Something went sus on our side. Try again.", code: "internal" },
      { status: 500 }
    );
  }
}

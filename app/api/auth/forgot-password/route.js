import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import { hashToken } from "@/lib/auth";
import { userByEmail, passwordResetTokenInsert } from "@/lib/store";
import { sendPasswordResetEmail } from "@/lib/mailer";

/**
 * POST /api/auth/forgot-password  { email }
 *
 * Always answers the same generic 200 - the response never reveals whether
 * the email has an account. For known accounts: 32 random bytes of token,
 * stored only as a SHA-256 hash with a 1-hour expiry and single-use
 * consumption; the raw token is emailed as a /reset-password link.
 * Dev mode (no Brevo key) returns the link in the response so local
 * tooling can complete the flow, exactly like the verify flow.
 */
export async function POST(req) {
  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`pwreset:${ip}`, Number(process.env.RATE_LIMIT_PWRESET) || 5, 10 * 60 * 1000);
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

  const email = String(body?.email ?? "").trim().toLowerCase();
  const GENERIC = {
    ok: true,
    message: "If that email has an account, a reset link is on its way. Check your inbox (and spam).",
  };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Same generic answer for malformed input - nothing to learn from this endpoint.
    return NextResponse.json(GENERIC, { status: 200 });
  }

  try {
    const user = await userByEmail(email);
    if (user) {
      const raw = randomBytes(32).toString("hex");
      await passwordResetTokenInsert(hashToken(raw), user.id, new Date(Date.now() + 60 * 60 * 1000).toISOString());
      const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
      const link = `${origin}/reset-password?token=${raw}`;
      const result = await sendPasswordResetEmail({ email: user.email, username: user.username, link });
      // Dev-only convenience (no mailer configured): surface the link locally.
      if (result.dev) return NextResponse.json({ ...GENERIC, devLink: link }, { status: 200 });
    }
    return NextResponse.json(GENERIC, { status: 200 });
  } catch (err) {
    console.error("forgot-password failed unexpectedly:", err);
    // Still generic: never confirm account existence from errors either.
    return NextResponse.json(GENERIC, { status: 200 });
  }
}

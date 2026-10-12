import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import { newVerificationToken, hashToken, verificationExpiry } from "@/lib/auth";
import { userByEmail, verificationTokenInsert } from "@/lib/store";
import { sendVerificationEmail } from "@/lib/mailer";

/**
 * POST /api/auth/resend { email }
 * Always answers 200 with a generic message so the endpoint never leaks
 * which emails have accounts. Sends only when an unverified account exists.
 */
export async function POST(req) {
  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`auth:${ip}`, Number(process.env.RATE_LIMIT_AUTH) || 30, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Take a breath and try again later.", code: "rate_limited" },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON.", code: "invalid_json" }, { status: 400 });
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const generic = {
    ok: true,
    message: "If that email has an unverified account, a fresh verification link is on its way.",
  };

  const user = email ? userByEmail(email) : null;
  if (!user || user.emailVerified) {
    return NextResponse.json(generic, { status: 200 });
  }

  const rawToken = newVerificationToken();
  verificationTokenInsert(hashToken(rawToken), user.id, verificationExpiry(24));
  const origin = req.nextUrl?.origin ?? new URL(req.url).origin;
  const verifyLink = `${origin}/api/auth/verify?token=${rawToken}`;
  try {
    const mailResult = await sendVerificationEmail({ email: user.email, username: user.username, link: verifyLink });
    if (mailResult.dev) {
      return NextResponse.json({ ...generic, devVerifyLink: mailResult.link }, { status: 200 });
    }
  } catch (err) {
    console.error("resend verification failed:", err?.message ?? err);
    return NextResponse.json(
      { error: "The email could not be sent right now. Try again in a moment.", code: "mail_failed" },
      { status: 502 }
    );
  }
  return NextResponse.json(generic, { status: 200 });
}

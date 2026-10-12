import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import {
  AuthError,
  validateRegistration,
  hashPassword,
  newOwnerKey,
  newVerificationToken,
  hashToken,
  verificationExpiry,
} from "@/lib/auth";
import { createUser, userByUsername, userByEmail, verificationTokenInsert } from "@/lib/store";
import { sendVerificationEmail } from "@/lib/mailer";

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

    // Verification is mandatory: no session until the emailed link is clicked.
    const rawToken = newVerificationToken();
    verificationTokenInsert(hashToken(rawToken), user.id, verificationExpiry(24));
    const origin = req.nextUrl?.origin ?? new URL(req.url).origin;
    const verifyLink = `${origin}/api/auth/verify?token=${rawToken}`;
    let mailResult;
    try {
      mailResult = await sendVerificationEmail({ email, username, link: verifyLink });
    } catch (mailErr) {
      console.error("verification email failed:", mailErr?.message ?? mailErr);
      return NextResponse.json(
        {
          error: "Account created, but the verification email could not be sent. Try logging in later to resend it.",
          code: "mail_failed",
        },
        { status: 201 }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        username: user.username,
        email: user.email,
        // Only present in dev mode (no BREVO_API_KEY): lets local testing
        // complete the flow without a real inbox.
        devVerifyLink: mailResult.dev ? mailResult.link : undefined,
      },
      { status: 201 }
    );
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

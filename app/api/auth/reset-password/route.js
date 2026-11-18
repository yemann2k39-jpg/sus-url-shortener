import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import { hashPassword, hashToken } from "@/lib/auth";
import {
  passwordResetTokenConsume,
  updateUserPasswordHash,
  deleteSessionsForUser,
} from "@/lib/store";

const NEW_PASSWORD_ERROR =
  "New password must be at least 8 characters and include a letter and a number.";

function validateNewPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

/**
 * POST /api/auth/reset-password  { token, password }
 *
 * Consumes the reset token (single-use, transactional), replaces the
 * scrypt password hash, and deletes every live session for the account -
 * a stolen session dies with the reset. Errors are generic: invalid,
 * expired and reused tokens all read the same way.
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

  const rawToken = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  if (!validateNewPassword(password)) {
    return NextResponse.json({ error: NEW_PASSWORD_ERROR, code: "weak_password" }, { status: 400 });
  }
  if (!rawToken) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one.", code: "invalid_token" },
      { status: 400 }
    );
  }

  try {
    const consumed = await passwordResetTokenConsume(hashToken(rawToken));
    if (!consumed) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one.", code: "invalid_token" },
        { status: 400 }
      );
    }
    await updateUserPasswordHash(consumed.userId, hashPassword(password));
    await deleteSessionsForUser(consumed.userId);
    return NextResponse.json(
      { ok: true, message: "Password updated. You can now log in with your new password." },
      { status: 200 }
    );
  } catch (err) {
    console.error("reset-password failed unexpectedly:", err);
    return NextResponse.json(
      { error: "Something went sus on our side. Try again.", code: "internal" },
      { status: 500 }
    );
  }
}

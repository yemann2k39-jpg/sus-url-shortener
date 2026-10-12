import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromHeaders } from "@/lib/ratelimit";
import { hashPassword, verifyPassword, hashToken, SESSION_COOKIE } from "@/lib/auth";
import { sessionGet, userById, userByUsername, updateUserPasswordHash } from "@/lib/store";

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

export async function POST(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await sessionGet(hashToken(token)) : null;
  const account = session ? await userById(session.userId) : null;
  // userById omits the hash; fetch the full row by username for the check.
  const user = account ? await userByUsername(account.username) : null;
  if (!user) {
    return NextResponse.json(
      { error: "Log in first.", code: "unauthorized" },
      { status: 401 }
    );
  }

  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`auth:${ip}`, 10, 10 * 60 * 1000);
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

  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");

  if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "That current password doesn't match.", code: "wrong_current" },
      { status: 400 }
    );
  }
  if (!validateNewPassword(newPassword)) {
    return NextResponse.json(
      { error: NEW_PASSWORD_ERROR, code: "weak_password" },
      { status: 400 }
    );
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "That's already your current password.", code: "same_password" },
      { status: 400 }
    );
  }

  await updateUserPasswordHash(user.id, hashPassword(newPassword));
  return NextResponse.json({ ok: true, message: "Password changed." }, { status: 200 });
}

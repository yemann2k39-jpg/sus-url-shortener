import { NextResponse } from "next/server";
import { hashToken } from "@/lib/auth";
import { verificationTokenConsume, setUserEmailVerified } from "@/lib/store";

/**
 * Email verification landing: GET /api/auth/verify?token=<raw>
 * Consumes the token and flags the account verified. No login here on
 * purpose: the tab that registered is polling and will auto-log the user
 * in on its own (POST /api/auth/login never happened - no shared session).
 * Invalid/expired tokens land on the /verify page with a resend form.
 */
export async function GET(req) {
  const raw = req.nextUrl.searchParams.get("token") ?? "";
  let target = "/verify?status=invalid";

  if (raw) {
    const consumed = await verificationTokenConsume(hashToken(raw));
    if (consumed) {
      await setUserEmailVerified(consumed.userId);
      target = "/verify?status=ok";
    }
  }
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), { status: 303 });
}

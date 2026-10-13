import { NextResponse } from "next/server";
import { newSessionToken, hashToken, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { verificationTokenConsume, setUserEmailVerified, userById, sessionInsert } from "@/lib/store";

/**
 * Email verification landing: GET /api/auth/verify?token=<raw>
 * Consumes the token, flags the account verified, logs the user in, and
 * sends them straight to the dashboard. Invalid/expired tokens land on
 * the /verify page with a resend form.
 */
export async function GET(req) {
  const raw = req.nextUrl.searchParams.get("token") ?? "";
  let target = "/verify?status=invalid";

  if (raw) {
    const consumed = await verificationTokenConsume(hashToken(raw));
    if (consumed) {
      await setUserEmailVerified(consumed.userId);
      const user = await userById(consumed.userId);
      if (user) {
        const token = newSessionToken();
        await sessionInsert(hashToken(token), user.id, sessionExpiry(7));
        // Logged in on the spot: verification click = straight to the dashboard.
        const resp = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin), { status: 303 });
        resp.cookies.set(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 24 * 60 * 60,
        });
        return resp;
      }
    }
  }
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), { status: 303 });
}

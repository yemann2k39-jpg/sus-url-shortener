import { NextResponse } from "next/server";
import { newSessionToken, hashToken, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { verificationTokenConsume, setUserEmailVerified, userById, sessionInsert } from "@/lib/store";

/**
 * Email verification landing: GET /api/auth/verify?token=<raw>
 * Consumes the token, flags the account verified, and logs the user in.
 * Always redirects to the human /verify page for the outcome.
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
        const resp = NextResponse.redirect(new URL("/verify?status=ok", req.nextUrl.origin), { status: 303 });
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

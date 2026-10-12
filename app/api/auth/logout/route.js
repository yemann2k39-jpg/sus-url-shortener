import { NextResponse } from "next/server";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";
import { sessionDelete } from "@/lib/store";

export async function POST(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    // Server-side kill: even a copied cookie is dead after this.
    await sessionDelete(hashToken(token));
  }
  const resp = NextResponse.json({ ok: true }, { status: 200 });
  resp.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return resp;
}

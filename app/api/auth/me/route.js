import { NextResponse } from "next/server";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";
import { sessionGet, userById } from "@/lib/store";

export async function GET(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not logged in.", code: "unauthorized" }, { status: 401 });
  }
  const session = await sessionGet(hashToken(token));
  if (!session) {
    return NextResponse.json({ error: "Not logged in.", code: "unauthorized" }, { status: 401 });
  }
  const user = await userById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "Not logged in.", code: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { user: { username: user.username, email: user.email, ownerKey: user.ownerKey, createdAt: user.createdAt } },
    { status: 200 }
  );
}

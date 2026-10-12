import { NextResponse } from "next/server";
import { StoreError, deleteLink, getLink } from "@/lib/store";
import { rateLimit, LIMITS, clientKeyFromHeaders } from "@/lib/ratelimit";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";
import { sessionGet, userById } from "@/lib/store";

async function currentUser(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await sessionGet(hashToken(token));
  if (!session) return null;
  return userById(session.userId);
}

export async function DELETE(req, { params }) {
  // Only the link's owner may delete it.
  const user = await currentUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Log in to manage links.", code: "unauthorized" },
      { status: 401 }
    );
  }

  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`remove:${ip}`, LIMITS.remove.limit, LIMITS.remove.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Too many deletions, too fast. Take a breath and retry shortly.",
        code: "rate_limited",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
          ),
        },
      }
    );
  }

  const { slug } = await params;
  try {
    const existing = await getLink(slug);
    // Ownership check WITHOUT leaking existence: a foreign or unknown slug
    // gets the same 404 either way.
    if (!existing || existing.ownerKey !== user.ownerKey) {
      return NextResponse.json(
        {
          error: `No sus link answers to "${slug}".`,
          code: "not_found",
        },
        { status: 404 }
      );
    }
    const removed = await deleteLink(slug);
    if (!removed) {
      return NextResponse.json(
        {
          error: `No sus link answers to "${slug}".`,
          code: "not_found",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: removed.slug, target: removed.target });
  } catch (err) {
    if (err instanceof StoreError) {
      const status = err.code === "store_corrupt" ? 500 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, {
        status,
      });
    }
    console.error("deleteLink failed unexpectedly:", err);
    return NextResponse.json(
      { error: "Something went sus on our side. Try again.", code: "internal" },
      { status: 500 }
    );
  }
}

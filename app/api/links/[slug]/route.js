import { NextResponse } from "next/server";
import { StoreError, deleteLink } from "@/lib/store";
import { rateLimit, LIMITS, clientKeyFromHeaders } from "@/lib/ratelimit";

export async function DELETE(req, { params }) {
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
    const removed = deleteLink(slug);
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

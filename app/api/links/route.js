import { NextResponse } from "next/server";
import { StoreError, createLink } from "@/lib/store";
import { rateLimit, LIMITS, clientKeyFromHeaders } from "@/lib/ratelimit";

const ERROR_STATUS = {
  invalid_json: 400,
  invalid_url: 400,
  invalid_mode: 400,
  store_corrupt: 500,
  internal: 500,
};

function originFromRequest(req) {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto =
    forwardedProto ??
    (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function errorResponse(code, message, extra = {}) {
  return NextResponse.json({ error: message, code, ...extra }, {
    status: ERROR_STATUS[code] ?? 500,
  });
}

export async function POST(req) {
  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`create:${ip}`, LIMITS.create.limit, LIMITS.create.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error:
          "Easy, tiger. Too many links, too fast. Give it a minute and try again.",
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

  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.");
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("invalid_json", "Request body must be a JSON object.");
  }

  try {
    const record = createLink({
      url: body.url,
      slug: body.slug,
      mode: body.mode ?? "redirect",
    });
    const susUrl = `${originFromRequest(req).replace(/\/+$/, "")}/${record.slug}`;
    return NextResponse.json(
      {
        slug: record.slug,
        target: record.target,
        mode: record.mode,
        susUrl,
        createdAt: record.createdAt,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof StoreError) {
      return errorResponse(err.code, err.message, err.details);
    }
    console.error("createLink failed unexpectedly:", err);
    return errorResponse("internal", "Something went sus on our side. Try again.");
  }
}

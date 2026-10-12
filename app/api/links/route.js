import { NextResponse } from "next/server";
import { StoreError, createLink, userBySessionToken } from "@/lib/store";
import { rateLimit, LIMITS, clientKeyFromHeaders } from "@/lib/ratelimit";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";

const ERROR_STATUS = {
  invalid_json: 400,
  invalid_url: 400,
  invalid_mode: 400,
  invalid_slug: 400,
  unauthorized: 401,
  store_corrupt: 500,
  internal: 500,
};

export async function currentUser(req) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await userBySessionToken(hashToken(token));
  // Verification gate: no verified email, no link creation.
  return user && user.emailVerified ? user : null;
}

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
  // Only members create links - anonymous requests get bounced here.
  const user = await currentUser(req);
  if (!user) {
    return errorResponse("unauthorized", "Log in to create links.");
  }

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
    const record = await createLink({
      url: body.url,
      slug: body.slug,
      mode: body.mode ?? "redirect",
      ownerKey: user.ownerKey,
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

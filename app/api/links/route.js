import { NextResponse } from "next/server";
import { StoreError, createLink } from "@/lib/store";

const ERROR_STATUS = {
  invalid_json: 400,
  invalid_url: 400,
  invalid_slug: 400,
  reserved_slug: 400,
  invalid_mode: 400,
  slug_taken: 409,
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

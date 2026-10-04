import { NextResponse } from "next/server";
import { rateLimit, LIMITS, clientKeyFromHeaders } from "@/lib/ratelimit";

/**
 * Rate limits link hits (redirect + sus interstitial) at the edge.
 * API routes and the dashboard handle their own limiting.
 */
export function middleware(req) {
  const ip = clientKeyFromHeaders(req.headers);
  const rl = rateLimit(`hit:${ip}`, LIMITS.hit.limit, LIMITS.hit.windowMs);

  if (!rl.ok) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Whoa there · Sus URL Shortener</title>
<style>
  body{margin:0;background:#faf6ee;color:#191817;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
  .card{background:#fff;border:2px solid #191817;border-radius:14px;box-shadow:5px 5px 0 #191817;max-width:460px;width:100%;text-align:center;padding:2.25rem 1.75rem}
  .badge{display:inline-block;background:#c8f135;color:#191817;font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-family:ui-monospace,Consolas,monospace;border:2px solid #191817;border-radius:999px;box-shadow:3px 3px 0 #191817;padding:.32rem .85rem;margin:0 0 1.1rem;transform:rotate(-2deg)}
  h1{font-family:Georgia,serif;font-style:italic;font-size:1.8rem;margin:0 0 .8rem}
  p{color:#6b6560;margin:0 0 1.5rem}
  a{display:block;background:#6d28d9;color:#fff;font-weight:700;border:2px solid #191817;border-radius:10px;box-shadow:3px 3px 0 #191817;padding:.65rem 1.2rem;text-decoration:none}
  code{font-family:ui-monospace,Consolas,monospace;background:#faf6ee;border:1px solid #e0d9cc;border-radius:6px;padding:.1rem .35rem}
</style></head>
<body><div class="card">
  <p class="badge">Slow down</p>
  <h1>Even sus links need breathing room.</h1>
  <p>That is <code>${LIMITS.hit.limit}</code>+ hits from your address in under a minute. Try again in about <code>${retryAfter}</code> seconds.</p>
  <a href="/">Take me back</a>
</div></body></html>`;
    return new NextResponse(html, {
      status: 429,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": String(retryAfter),
      },
    });
  }

  const res = NextResponse.next();
  res.headers.set("x-ratelimit-limit", String(LIMITS.hit.limit));
  res.headers.set("x-ratelimit-remaining", String(Math.max(0, rl.remaining)));
  return res;
}

export const config = {
  matcher: ["/((?!api|dashboard|_next|favicon.ico).*)"],
};

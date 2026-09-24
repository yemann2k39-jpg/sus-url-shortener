import { notFound, redirect } from "next/navigation";
import { getLink } from "@/lib/store";

function hostOf(target) {
  try {
    return new URL(target).host;
  } catch {
    return target;
  }
}

/**
 * GET /<slug>
 *  - unknown slug  -> notFound(): custom in-brand 404 with a real 404 status
 *  - instant mode  -> server redirect straight to the target URL
 *                    (Next issues a temporary 307; identical browser
 *                    behavior to a 302 for link clicks)
 *  - sus mode      -> interstitial rendered at the same URL
 */
export default async function SlugPage({ params }) {
  const { slug } = await params;
  const link = getLink(slug);

  if (!link) {
    notFound();
  }

  if (link.mode === "redirect") {
    redirect(link.target);
  }

  const host = hostOf(link.target);

  return (
    <section className="sus-page">
      <div className="card sus-card">
        <p className="sus-badge">Sus link detected</p>
        <h1 className="sus-title">This link is extremely sus.</h1>
        <p className="sus-copy">
          You have arrived via the Sus URL Shortener. This link claims to take
          you to <strong>{host}</strong>. It probably will. We can neither
          confirm nor deny anything beyond that.
        </p>
        <a className="btn btn-primary sus-continue" href={link.target}>
          Continue to {host}
        </a>
        <p className="sus-fineprint">
          Or don&apos;t. The choice was always yours, allegedly.
        </p>
      </div>
    </section>
  );
}

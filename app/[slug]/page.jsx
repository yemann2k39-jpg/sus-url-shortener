import { notFound, redirect } from "next/navigation";
import { getLink, recordClick } from "@/lib/store";

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

  // Buffered in memory, flushed to SQLite on a timer - no disk write here.
  recordClick(link.slug);

  if (link.mode === "redirect") {
    redirect(link.target);
  }

  const host = hostOf(link.target);

  return (
    <section className="sus-page">
      <div className="card sus-card">
        <p className="sus-badge">Sus link detected</p>
        <h1 className="sus-title">This link is extremely suspicious.</h1>
        <p className="sus-copy">
          You&rsquo;ve arrived via Sus URL Shortener. This link claims to lead
          to <strong>{host}</strong>. It almost certainly does. Beyond that, we
          make no guarantees.
        </p>
        <a className="btn btn-primary sus-continue" href={link.target}>
          Continue to {host}
        </a>
        <p className="sus-fineprint">Or stay here. Nobody&rsquo;s forcing you.</p>
      </div>
    </section>
  );
}

import LinksTable from "@/components/LinksTable";
import { listLinks, countLinks } from "@/lib/store";

// The dashboard must always reflect the store, never a cached render.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard · Sus URL Shortener",
};

const PER_PAGE = 25;

export default async function DashboardPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const total = countLinks();
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  let page = parseInt(params.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pageCount) page = pageCount;

  const links = listLinks({ limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  return (
    <section className="dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Your sus links</h1>
          <p className="dash-count">
            {total === 0
              ? "zero and holding"
              : `${total} link${total === 1 ? "" : "s"} under management`}
          </p>
        </div>
        <a className="btn btn-secondary" href="/">
          + New sus link
        </a>
      </div>

      {links.length === 0 ? (
        <div className="card dash-empty">
          <p className="dash-empty-title">No sus links yet.</p>
          <p className="dash-empty-note">
            The factory floor is spotless. <a href="/">Make the first one</a>{" "}
            and mess it up.
          </p>
        </div>
      ) : (
        <>
          <LinksTable links={links} />
          {pageCount > 1 && (
            <nav className="dash-pager" aria-label="Dashboard pages">
              {page > 1 ? (
                <a className="btn btn-tiny" href={`/dashboard?page=${page - 1}`}>
                  ← Newer
                </a>
              ) : (
                <span />
              )}
              <span className="dash-page-indicator">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <a className="btn btn-tiny" href={`/dashboard?page=${page + 1}`}>
                  Older →
                </a>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}

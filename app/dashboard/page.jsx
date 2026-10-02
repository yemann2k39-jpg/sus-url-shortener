import LinksTable from "@/components/LinksTable";
import { loadLinks } from "@/lib/store";

// The dashboard must always reflect the store, never a cached render.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard · Sus URL Shortener",
};

export default function DashboardPage() {
  const links = [...loadLinks()].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );

  return (
    <section className="dash">
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Your sus links</h1>
          <p className="dash-count">
            {links.length === 0
              ? "zero and holding"
              : `${links.length} link${links.length === 1 ? "" : "s"} under management`}
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
        <LinksTable links={links} />
      )}
    </section>
  );
}

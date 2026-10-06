import "./globals.css";
import LogoutButton from "@/components/LogoutButton";
import { getCurrentUser } from "@/lib/session";

export const metadata = {
  title: "Sus URL Shortener",
  description:
    "Turn any perfectly legitimate URL into something deeply suspicious.",
};

export default async function RootLayout({ children }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="site-header">
            <a className="wordmark" href="/">
              <span className="logo-dot" aria-hidden="true" />
              sus://url-shortener
            </a>
            <span className="header-right">
              {user ? (
                <>
                  <span className="user-chip" title={user.email}>
                    {user.username}
                  </span>
                  <a className="btn btn-tiny header-dash-link" href="/dashboard">
                    Dashboard
                  </a>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <span className="tagline">100% legit. 0% trusted.</span>
                  <a className="btn btn-tiny" href="/login">
                    Log in
                  </a>
                  <a className="btn btn-tiny" href="/login?mode=register">
                    Register
                  </a>
                </>
              )}
            </span>
          </header>
          <main>{children}</main>
          <footer className="site-footer">
            No URLs were harmed in the making of this shortener.
          </footer>
        </div>
      </body>
    </html>
  );
}

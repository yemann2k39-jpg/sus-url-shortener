import "./globals.css";
import LogoutButton from "@/components/LogoutButton";
import { getCurrentUser } from "@/lib/session";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Sus URL Shortener",
    template: "%s · Sus URL Shortener",
  },
  description:
    "Turn any perfectly legitimate URL into something deeply suspicious.",
  applicationName: "Sus URL Shortener",
  openGraph: {
    type: "website",
    siteName: "Sus URL Shortener",
    title: "Sus URL Shortener",
    description:
      "Turn any perfectly legitimate URL into something deeply suspicious.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: "Sus URL Shortener",
    description:
      "Turn any perfectly legitimate URL into something deeply suspicious.",
  },
  icons: { icon: "/favicon.svg" },
};

export const viewport = {
  themeColor: "#fbf4e0",
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

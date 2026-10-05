import "./globals.css";

export const metadata = {
  title: "Sus URL Shortener",
  description:
    "Turn any perfectly legitimate URL into something deeply suspicious.",
};

export default function RootLayout({ children }) {
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
              <span className="tagline">100% legit. 0% trusted.</span>
              <a className="btn btn-tiny header-dash-link" href="/dashboard">
                Dashboard
              </a>
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

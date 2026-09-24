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
            <span className="wordmark">
              <span className="logo-dot" aria-hidden="true" />
              sus://shortener
            </span>
            <span className="tagline">100% legit. 0% trusted.</span>
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

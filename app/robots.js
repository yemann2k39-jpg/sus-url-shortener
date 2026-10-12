// robots.txt for crawlers: public pages only.
export default function robots() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/", "/verify"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

// Sitemap: the two public entry pages.
export default function sitemap() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210";
  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}

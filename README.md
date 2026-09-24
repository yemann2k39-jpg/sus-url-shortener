# Sus URL Shortener

Turn any perfectly legitimate URL into something deeply suspicious.

Paste `https://youtube.com`, choose a sus name like `FakeYouTube`, and get back
a link on this app's own domain — `http://localhost:3210/FakeYouTube` — that
still goes to the real site. The vibe is the only thing that changes.

## How it works

- **Create**: submit a real URL, an optional sus name (letters, numbers,
  dashes — case doesn't count for uniqueness), and a delivery mode.
  - *Instant redirect* — they click, they land on the real site.
  - *Sus page first* — a deadpan "this link is extremely sus" warning screen
    appears at the sus URL before they continue.
- **Taken name?** The app suggests a free variation (`FakeYouTube-2`) instead
  of just saying no.
- **QR code**: every created link comes with one, ready to plaster somewhere
  irresponsible.
- No sus name? You get a randomly assigned six-character code that avoids
  lookalike characters (`0/O`, `1/l/I`).

## Run locally

Requires Node.js 18.18+ (built and tested on Node 24).

```bash
npm install
npm run dev
```

Open <http://localhost:3210>. Links are stored in `data/links.json`, which is
created on first run — delete the file to reset the factory.

## Configuration

| Setting | How | Default |
| --- | --- | --- |
| Port (production) | `PORT` env var, read by `next start` | `3000` |
| Port (dev) | fixed in the `dev` npm script | `3210` |

## Deploying

This is a standard Next.js app (`npm run build` + `npm start`), so any host
that runs Node works — Render, Railway, Fly.io, a VPS, your ancient laptop.

**One honest caveat:** links live in a JSON file on disk
(`data/links.json`). That needs a **persistent disk**. Platforms with
ephemeral filesystems (Vercel's serverless functions, Heroku's default
dyno filesystem) will silently forget every link on each restart or
instance shuffle. On those, mount a volume, or swap the storage layer.

**Swapping storage** is a one-file job: everything that touches disk —
loading, saving, slug rules, validation — lives in
[`lib/store.js`](lib/store.js). Reimplement `loadLinks`, `saveLinks`,
`createLink` and `getLink` against a real database and nothing else in the
app needs to change.

## API

`POST /api/links`

```json
{ "url": "https://youtube.com", "slug": "FakeYouTube", "mode": "redirect" }
```

- `201` → `{ "slug", "target", "mode", "susUrl", "createdAt" }`
- `409` → slug taken; body includes a `suggestion`
- `400` → bad URL, bad slug, reserved slug (`api`, `sus`, `_next`,
  `favicon.ico`), or bad mode (only `redirect` | `sus`)

## Legal-ish footnote

The sus link always shows this app's real domain — nothing here can change
what a browser's address bar displays. Use it for pranks, not for pretending
to be other people's websites.

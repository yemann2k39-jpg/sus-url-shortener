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
  of just saying no. Uniqueness is enforced by a UNIQUE index — an index
  probe, not a scan.
- **No sus name?** You get a base36 counter code derived from the database
  rowid (`5`, `6`, … `zz9`) — unique by construction, no collision check
  needed. Tradeoff: counter codes are sequential and guessable. Random
  unguessable codes would be the choice if links were meant to be secret.
- **Dashboard** (`/dashboard`, button in the header): every link, newest
  first, with destination, mode pill, click count, creation date, per-row
  Copy and Delete, paginated 25 per page.
- **QR code**: every created link comes with one.
- **Click counting**: buffered in memory, flushed to the database every 5
  seconds — the redirect hot path never writes to disk. A crash loses at
  most one flush window of counts.

## Storage

SQLite via Node's built-in `node:sqlite` — zero native dependencies, no
compile step. The database lives at `data/links.db` (WAL mode) and is created
automatically. If a legacy `data/links.json` exists on first run it is
imported, then renamed `links.json.imported` as a backup.

All storage access is isolated in [`lib/store.js`](lib/store.js). Swapping to
another engine (Postgres, a KV store) means reimplementing that one file:
`createLink`, `getLink`, `deleteLink`, `loadLinks`, `listLinks`, `countLinks`.

## Caching & rate limiting

- **Hot-link cache** (`lib/cache.js`): LRU with TTL in front of lookups, so
  popular links stop touching the database. Entries are invalidated on
  create/delete — a removed link is never served stale. Tunable via
  `CACHE_MAX` (default 2000) and `CACHE_TTL_MS` (default 60000).
- **Rate limits** (`lib/ratelimit.js`): per-IP fixed windows, in-memory.
  Over the limit you get a 429 (JSON on the API, an in-brand page on link
  hits) with a `Retry-After` header.

| Env var | Default | Applies to |
| --- | --- | --- |
| `PORT` | `3000` (`next start`); dev script pins `3210` | server port |
| `RATE_LIMIT_CREATE` | `20` per `RATE_LIMIT_CREATE_WINDOW_MS` (`600000`) | `POST /api/links` |
| `RATE_LIMIT_DELETE` | `30` per `RATE_LIMIT_DELETE_WINDOW_MS` (`600000`) | `DELETE /api/links/[slug]` |
| `RATE_LIMIT_HIT` | `120` per `RATE_LIMIT_HIT_WINDOW_MS` (`60000`) | link hits (middleware) |
| `CACHE_MAX` / `CACHE_TTL_MS` | `2000` / `60000` | hot-link cache |

**Caveat:** the limiter and cache are per server instance. Running multiple
instances gives each its own buckets — swap `lib/ratelimit.js` for a
Redis-backed implementation when you scale out.

## Run locally

Requires Node.js 23.4+ for `node:sqlite` (built and tested on Node 24).

```bash
npm install
npm run dev
```

Open <http://localhost:3210>. Delete `data/links.db*` to reset the factory
(close the server first — WAL keeps files busy).

## Deploying

Standard Next.js (`npm run build` + `npm start`) on any Node host: Render,
Railway, Fly.io, a VPS. `data/` needs a **persistent disk**; ephemeral
filesystems (Vercel serverless, Heroku dynos) forget every link on restart —
mount a volume or swap the storage layer.

## Path to scale

Where this design goes as traffic grows, in order:

1. **More instances** — put a load balancer in front; move rate limiting and
   the hot-link cache to Redis (swap two small modules, nothing else
   changes).
2. **Bigger database** — Postgres with read replicas; the read path is
   already a single indexed lookup.
3. **Edge redirects** — the redirect decision is a pure key-value lookup, so
   it can move to a CDN worker with a replicated KV store; most clicks never
   reach the origin.
4. **Sharding** — the slug is a natural shard key (every request already
   knows it); consistent hashing over slug → shard. Cross-shard queries
   (the global dashboard) are the cost — scope lists per owner at that
   scale.
5. **Analytics** — the click buffer already decouples counting from the hot
   path; route it through a queue into a column store for real analytics.

## Legal-ish footnote

The sus link always shows this app's real domain — nothing here can change
what a browser's address bar displays. Use it for pranks, not for pretending
to be other people's websites.

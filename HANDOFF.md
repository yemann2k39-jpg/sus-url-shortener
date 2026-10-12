# HANDOFF — Sus URL Shortener (read this first in a new session)

Everything below is the complete state as of the last session. A new agent
should be able to continue without asking the user anything covered here.

## What this app is

**Sus URL Shortener** — a playful ("freaky but professional") link shortener:

- Anyone can **register / log in** (username + email + password). Each account
  has a unique **owner key**; every link is stamped with it.
- Logged-in members create links at `/`; the **dashboard** (`/dashboard`)
  shows ONLY their own links, 20 per page, numbered pagination.
- Short codes are **6-char scrambled Base62**: counter id → 4-round Feistel
  band cipher → Base62. Zero existence checks, zero collisions by
  construction. Codes are sequential-unguessable-resistant and never reused.
- Two link modes: **instant redirect (307)** or **"sus page" interstitial**.
- **Rate limiting** (create/delete/hit, env-tunable), **hot-link LRU cache**,
  **async click counting** (5s flush), **QR code** per link.
- Full **auth enforcement**: anonymous create/delete → 401; foreign delete →
  404 (no existence leak).

## Stack & location

- **Next.js 15 App Router** (JavaScript, no TS), **SQLite via `node:sqlite`**
  (Node 24 built-in, zero native deps). No external runtime deps beyond
  next/react.
- Lives at `C:\KuromiLab\sus-url-shortener` (git repo, branch `master`).
- Run: `npm run dev` → **http://localhost:3210**. Build: `npm run build`.
- All storage access is isolated in `lib/store.js` (swap for Postgres there).
- `middleware.js` = rate limiting on link hits. `lib/auth.js` = hashing,
  validation, session tokens. `lib/session.js` = server-side getCurrentUser().

## ⚠️ Environment gotchas (learned the hard way — respect these)

1. **Dev server must be started from an elevated/full-access shell.**
   `next dev` forks a child process; the workspace sandbox denies it with
   EPERM. Use the escalation (danger-full-access) when starting it. Same for
   `next build`, and for `tickets commit` / `git commit` via the tickets CLI
   (they spawn git).
2. **Background dev servers get reaped between turns/session handoffs.**
   For verification, use ONE-SHOT scripts that start the server, run checks,
   and kill it inside a single tool call (see `bg-previews/verify-*.ps1`
   patterns outside the repo). A long-lived background dev server works while
   the session lives but dies on session handoff.
3. **Orphaned servers hold port 3210.** If `npm run dev` dies EADDRINUSE,
   find the listener: `netstat -ano | findstr :3210` → `taskkill /PID x /T /F`
   (may need elevation; the servers run elevated).
4. **PowerShell is 5.1**: NO ternary operator, NO `0f` float literals, and
   inline JSON in curl args gets quote-mangled → write request bodies to temp
   files and use `curl --data-binary "@file"`. React SSR inserts `<!--$-->`
   markers in HTML — strip with `-replace '<!--.*?-->',''` before matching.
5. **`tickets commit` / any commit validates the WHOLE working tree** against
   linked tickets. If multiple tickets' changes coexist in the tree, split
   with plain `git add` + `git commit` per ticket, then
   `tickets link TCK-x --commit <hash>`.
6. `.tickets/` is gitignored (tool state). `data/links-backup-2026-10-06.json`
   holds the pre-accounts links (wiped when accounts shipped, user's call).

## Current state (all verified)

- **21/21 tickets done** (TCK-1…TCK-21). Board: run `tickets list`.
- HEAD = `daec37b` (chore: gitignore). Feature commits:
  - `367366d` TCK-21 delete authorization
  - `29c5279` TCK-20 owner-scoped dashboard + pagination + login UI
  - `093c985` TCK-19 accounts/owner keys
  - `d7ffbb5` + `07f69d4` TCK-18 design rounds
  - earlier: TCK-2..17 (store, API, redirects, QR, dashboard, rate limit,
    cache, click counts, docs, Feistel code engine)
- **Design**: ink/lime "friendly freaky" neo-brutalist theme. Body =
  brighter paint-wash mesh gradient (7 CSS radial blobs). Content = creamy
  poster sheet (#fbf4e0, 900px, 2px ink border, hard 12px shadow) with lime
  washi-tape corners. User approved this look.
- **Accounts**: `alex` / `sus12345` (test account, owns nothing — probe
  links were wiped). `bob` / `bob12345` (test). Links table is EMPTY (wiped
  when accounts shipped, user's decision; backup file exists).
- **Revert point for the green-button design**: branch `design/green-theme`.

## Known gaps / future work (user-aware, not built)

- Email is stored unique but **unverified** (needs a mail server).
- Sessions are server-side with 7-day expiry; no "remember me", no
  change-password UI.
- Rate limit defaults are per-instance in-memory (swap for Redis at scale).
- The owner-key schema is the foundation for the future sharding story
  (owner = shard key) — see README "Path to scale".

## Working agreements with the user

- Show visual previews BEFORE applying design changes.
- Commit ONLY when the user says so (per-ticket commits, tickets CLI).
- Tickets must follow the lifecycle (backlog→todo→in-progress→in-review→done).
- Plain English always (a stray Chinese paragraph once slipped out — user
  noticed).

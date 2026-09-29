# PinkPill

A multi-user looksmaxxing forum for women: skincare, hair, makeup, fitness, style, ratings, advice
and more. Node.js + PostgreSQL backend, with the original PinkPill frontend served on top.

Everything that matters is enforced on the server: accounts, sessions, permissions, bans,
reputation, votes, private messages, uploads. The browser only stores harmless UI preferences
(theme, drafts). See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, schema and security model.

## Requirements

- Node.js **22+**
- PostgreSQL **14+** (16 recommended), with the `citext` extension (bundled with PostgreSQL)
- For image processing, `sharp` installs prebuilt binaries automatically on Linux, macOS and Windows

## Installation

```bash
cd pinkpill
npm install
cp .env.example .env          # then edit .env
```

### Database setup

```bash
# as a PostgreSQL superuser
createuser --pwprompt pinkpill
createdb -O pinkpill pinkpill_dev
createdb -O pinkpill pinkpill_test     # for `npm test`
createdb -O pinkpill pinkpill_e2e      # for `npm run test:e2e`
```

Point `DATABASE_URL` (and `DATABASE_URL_TEST`) in `.env` at them.

### Migrations and seeding

```bash
npm run migrate        # create/upgrade the schema (also runs automatically on server start)
npm run seed           # nothing extra: roles, permissions, settings and the forum structure are in the migrations
npm run seed:demo      # DEVELOPMENT ONLY: sample members + threads (refuses to run in production)
npm run create-admin   # create the first super administrator (prompts for username, email, password)
```

There are no built-in admin accounts or passwords. The first administrator is created with
`npm run create-admin` (or `npm run create-admin -- --promote <existing username>`).

## Development

```bash
npm run dev            # http://localhost:3000, restarts on file changes
```

In development, emails (verification, password reset) are printed to the server log
(`MAIL_TRANSPORT=console`). Set `REQUIRE_EMAIL_VERIFICATION=true` to test the verification flow.

## Tests

```bash
npm test               # 60+ API tests (node:test + supertest) against the pinkpill_test database
npm run test:e2e       # Playwright end-to-end tests (starts its own server on :3200 using pinkpill_e2e)
npm run test:all
npm run build          # syntax-checks every file and verifies assets/migrations
```

The API tests cover signup/login/logout, Argon2id hashing, sessions (expiry, rotation, revocation),
CSRF, email verification, password reset, the full authorization matrix, privilege escalation, IDOR,
bans and suspensions, forum CRUD, locking/pinning/moving, pagination, reactions, reputation abuse,
poll vote manipulation, private-message privacy, uploads (disguised scripts, SVG, polyglots, oversize),
SQL-injection and XSS payloads, rate limiting, the safety filter and the prototype importer.

The E2E tests use two independent browser contexts to register (via emailed links), post, reply,
react, give rep, vote, message privately, attempt to become admin through devtools, moderate and ban,
upload an avatar, search, and verify that data survives a server restart.

If Playwright can't find Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` to a Chromium executable, or run
`npx playwright install chromium`.

## Environment variables

All configuration comes from environment variables (see `.env.example`). No secrets live in code.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` enables secure cookies, HSTS, email verification by default |
| `PORT` | HTTP port (default 3000) |
| `APP_URL` | Public URL (your domain). Used in emails and the CSRF origin check |
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL connection; set `DATABASE_SSL=true` for hosted Postgres that requires TLS |
| `DATABASE_URL_TEST` | Database used by `npm test` (its schema is dropped on every run) |
| `SESSION_DAYS` | Sliding session lifetime (default 30) |
| `COOKIE_SECURE` | Force the `Secure` cookie flag (default: on in production) |
| `TRUST_PROXY` | Number of reverse proxies in front of the app, for correct client IPs/rate limits |
| `REQUIRE_EMAIL_VERIFICATION` | Block posting until email is verified (default: on in production) |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_URL` | `smtp` for real email (any SMTP provider), `console` for development |
| `STORAGE_DRIVER` | `local` (disk, outside the web root) or `s3` (any S3-compatible bucket) |
| `STORAGE_DIR` | Directory for local uploads |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage |
| `UPLOAD_MAX_BYTES` | Maximum upload size (default 5 MB) |
| `RATE_LIMITS` | Set `false` only for local load testing |

## Production build and deployment

There is no bundling step: `npm run build` validates the project, and `npm start` runs it.
One Node process serves both the frontend (`public/`) and the API (`/api`), so cookies stay
first-party and no CORS is needed.

**Checklist**

1. HTTPS in front of the app (Caddy, nginx, or your host's TLS). Set `APP_URL=https://your-domain`.
2. `NODE_ENV=production`, `TRUST_PROXY=1` behind one proxy.
3. PostgreSQL with backups. The app runs migrations on start.
4. Real email: `MAIL_TRANSPORT=smtp`, `SMTP_URL=smtps://user:pass@host:465`, `MAIL_FROM`.
5. Persistent uploads: a mounted volume for `STORAGE_DIR`, or `STORAGE_DRIVER=s3`.
6. `npm run create-admin` once.

### Option A: one free VM with Docker (fully self-contained)

On any always-free Linux VM (several cloud providers offer one):

```bash
git clone <this repo> && cd pinkpill
cp .env.example .env    # set APP_URL, POSTGRES_PASSWORD, MAIL_*, SMTP_URL, COOKIE_SECURE=true
docker compose up -d
docker compose exec app node server/scripts/create-admin.js
```

Then put Caddy in front for automatic HTTPS: `your-domain { reverse_proxy 127.0.0.1:3000 }`.

### Option B: free Node host + free managed PostgreSQL

Deploy the `Dockerfile` (or `npm ci --omit=dev && npm start`) to any Node/Docker host with a free
tier, and use any free hosted PostgreSQL (set `DATABASE_SSL=true` if it requires TLS). Free hosts
often have ephemeral disks, so use `STORAGE_DRIVER=s3` with a free S3-compatible bucket for uploads.
Free tiers typically sleep when idle, so the first request after a pause can be slow.

Nothing is tied to one provider: the domain, database, mail and storage are all configuration.

> **GitHub Pages note:** GitHub Pages only serves static files, so `pinkpill/public/` opened from
> Pages would have no backend. Deploy the Node app instead and point your domain (e.g. `kuroka.me`)
> at it.

## Migrating data from the localStorage prototype

The old version kept everything in the visitor's browser. To bring that data over:

- **From the browser that has it:** open the new site on the same domain, log in as an admin, go to
  *Admin panel → Data*, and click *Import the prototype data stored in this browser*.
- **From an export file:** *Admin panel → Data → Import a prototype JSON file*, or
  `npm run import:localstorage -- backup.json`.

Imported members have no password. They claim their account with *Forgot your password?*, which
also verifies their email. Existing usernames are never overwritten, embedded images are re-encoded
into the upload store, unsafe markup is removed, and imported roles are capped below the importer's
own rank.

## API overview

JSON over HTTPS under `/api`. Errors look like `{"error": {"code": "forbidden", "message": "…"}}`.
Unsafe requests need the session's `X-CSRF-Token` header (from `GET /api/auth/session`) and
`X-Requested-With`.

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/session`, `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/password-reset/request`, `/auth/password-reset/confirm` |
| Account | `GET /account`, `PATCH /account/email`, `/account/profile`, `/account/preferences`, `POST /account/password`, `GET /account/sessions`, `POST /account/sessions/revoke-others`, `GET /account/export`, `DELETE /account`, `GET /account/{bookmarks,watched,following,ignoring,warnings}` |
| Forums | `GET /forums`, `GET /forums/:id`, `POST /forums/:id/threads`, `POST /forums/:id/read`, `POST /forums/read-all` |
| Threads | `GET /threads/:id`, `PATCH /threads/:id` (title, prefix, tags, sticky, locked, forumId, pollClosed), `DELETE /threads/:id`, `POST /threads/:id/restore`, `PUT/DELETE /threads/:id/watch`, `POST /threads/:id/posts` |
| Posts | `PATCH/DELETE /posts/:id`, `POST /posts/:id/restore`, `GET /posts/:id/history`, `PUT/DELETE /posts/:id/reaction`, `GET /posts/:id/reactions`, `POST/GET /posts/:id/reputation`, `DELETE /reputation/:id`, `PUT/DELETE /posts/:id/bookmark` |
| Polls | `POST/DELETE /polls/:id/votes` |
| Members | `GET /members`, `/members/lookup`, `/members/by-name/:name`, `/members/:id` and `/members/:id/{profile-posts,activity,postings,reputation,followers,following,warnings}`, `PUT/DELETE /members/:id/{follow,ignore}`, `POST /members/:id/profile-posts`, `POST /profile-posts/:id/comments`, `DELETE /profile-posts/:id`, `PUT/DELETE /profile-posts/:id/reaction`, `GET /online`, `GET /trophies` |
| Messages | `GET/POST /conversations`, `GET /conversations/:id`, `POST /conversations/:id/{messages,invite,leave}`, `PUT /conversations/:id/star` |
| Notifications | `GET /notifications`, `POST /notifications/read-all`, `GET /me/counts` |
| Discovery | `GET /search`, `GET /tags/:tag`, `GET /whats-new/{posts,profile-posts,activity,feed}`, `GET /widgets/sidebar` |
| Uploads | `POST /uploads` (multipart `file` + `purpose`), `GET /media/:uuid` |
| Reports | `POST /reports` |
| Moderation | `GET /mod/reports`, `POST /mod/reports/:id/resolve`, `GET /mod/users`, `POST/DELETE /mod/users/:id/ban`, `POST /mod/users/:id/warn`, `GET /mod/warnings`, `GET /mod/log` |
| Admin | `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/:id/role`, `GET /admin/roles`, `PUT /admin/roles/:id/permissions`, `POST/PATCH/DELETE /admin/categories[/:id]`, `POST/PATCH/DELETE /admin/forums[/:id]`, `GET/PATCH /admin/settings`, `POST /admin/import` |

## Known limitations

These are documented rather than faked:

- **Rate limits are per process** (in memory). With several app instances, use a shared store
  (e.g. Redis) for `express-rate-limit`.
- **No CAPTCHA.** Mass signups are slowed by IP rate limits, a honeypot field and email
  verification. A free CAPTCHA (e.g. hCaptcha or Turnstile) can be added to `/auth/register`.
- **No real-time push.** Alert and inbox counts refresh every 60 seconds and on navigation.
- **Member statistics are computed per request.** Fine for a community of thousands; for much
  larger forums, denormalise post/reaction/rep counts onto `users`.
- **S3 storage driver** is implemented but was not exercised against a live bucket in this repo's tests
  (the local driver is fully tested).
- **Uploaded images are served by unguessable URL** (`/media/<random UUID>`), without a per-request
  permission check. An image posted in a members-only forum is private only as long as its link isn't shared.
- **The `Dockerfile` and `docker-compose.yml` were not built in this repo's CI/sandbox** (no Docker
  daemon was available). The same commands they run (`npm ci --omit=dev`, `node server/index.js`
  in production mode against PostgreSQL) were tested directly.
- **Uploads written during a failed import** may leave orphaned files in storage (the database side
  rolls back cleanly).

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

In development, emails (verification, password reset) are written to `storage/mail/*.txt`
(`MAIL_TRANSPORT=file`). Set `REQUIRE_EMAIL_VERIFICATION=true` to test the verification flow.

## Tests

```bash
npm test               # 90 API/security/storage/email/deployment tests against the pinkpill_test database
npm run test:e2e       # Playwright end-to-end tests (starts its own server on :3200 using pinkpill_e2e)
npm run test:all
npm run build          # syntax-checks every file and verifies assets/migrations
```

The API tests cover signup/login/logout, Argon2id hashing, sessions (expiry, rotation, revocation),
CSRF, email verification, password reset, the full authorization matrix, privilege escalation, IDOR,
bans and suspensions, forum CRUD, locking/pinning/moving, pagination, reactions, reputation abuse,
poll vote manipulation, private-message privacy, uploads (disguised scripts, SVG, polyglots, oversize),
SQL-injection and XSS payloads, rate limiting, the absence of automatic flagging, and the prototype importer.

The E2E tests use two independent browser contexts to register (via emailed links), post, reply,
react, give rep, vote, message privately, attempt to become admin through devtools, moderate and ban,
upload an avatar, search, and verify that data survives a server restart.

If Playwright can't find Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` to a Chromium executable, or run
`npx playwright install chromium`.

## Environment variables and deployment

Production deployment (Render free web service + Neon + Cloudflare R2 + Resend + Turnstile + your
domain) is documented step by step in **[DEPLOYMENT.md](DEPLOYMENT.md)**, including every environment
variable, the custom-domain/DNS flow, backups, rollback, monitoring, free-tier limits, how to stay at $0
and a smoke-test checklist. The Render Blueprint is `render.yaml` at the repository root. This is a
hobby-grade free-tier setup (the service sleeps when idle), not enterprise infrastructure. `.env.example` lists the local
development variables. The server refuses to start in production with unsafe or incomplete settings.

Useful commands:

```bash
npm run db:migrate     # apply pending migrations (safe to repeat; locked against concurrent runs)
npm run db:status      # list applied / pending migrations
npm run db:backup      # pg_dump to backups/ (see DEPLOYMENT.md §12)
npm run db:restore -- <file.dump> --target <empty database URL>
npm run create-admin   # create the first super administrator from your terminal
npm start              # production server (binds 0.0.0.0:$PORT, which Render provides; /health and /ready)
```

`Dockerfile` (optional container image, listens on `$PORT`) and `docker-compose.yml` (alternative
self-hosted single-VM setup with bundled PostgreSQL) are not used by the Render deployment.

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
| VIP | `GET /vip/catalog`, `GET /vip/me`, `POST /vip/quote`, `POST /vip/checkout`, `GET /vip/orders/:id`, `POST /vip/orders/:id/{verify,cancel}`, `PATCH /vip/style`, `GET /vip/recipient`, `GET /account/purchases`, `POST /account/username`, `PUT /account/vanity`, `GET /members/by-vanity/:slug` |
| Payment webhooks | `POST /payments/webhooks/{stripe,paypal,coinbase}` (signature-verified, no cookies) |
| VIP admin | `/admin/vip/{memberships,orders,products,colors,frames,effects,wallets,settings}` (needs `admin.vip`) |
| Admin | `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/:id/role`, `GET /admin/roles`, `PUT /admin/roles/:id/permissions`, `POST/PATCH/DELETE /admin/categories[/:id]`, `POST/PATCH/DELETE /admin/forums[/:id]`, `GET/PATCH /admin/settings`, `POST /admin/import` |

## Known limitations

See DEPLOYMENT.md §15 (free-tier limitations) and §17 (the 18+ requirement is self-attested, not verified).

# Deploying PinkPill on $0 infrastructure

Target stack: **Koyeb** (app) · **Neon** (PostgreSQL) · **Cloudflare R2** (uploads) · **Resend** (email) ·
**Cloudflare DNS + Turnstile** · **GitHub** (source + CI) · your own domain.

Provider dashboards change often. Wherever this guide says "copy X", take the exact value from the
provider's dashboard; nothing here invents provider-specific values. Check each provider's current
free-tier limits before launch.

---

## 1. Architecture

```
Browser ──HTTPS──► Cloudflare DNS ──► Koyeb (1 × free instance, Docker, Node 22)
                                        │  serves public/ (frontend) + /api + /media
                                        ├──► Neon PostgreSQL (pooled connection, TLS)
                                        ├──► Cloudflare R2 (private bucket, S3 API)
                                        ├──► Resend HTTP API (verification/reset emails)
                                        └──► Cloudflare Turnstile siteverify (signup/reset)
Browser ◄── short-lived presigned R2 URL for images (issued only after authorization)
```

- One Node process, one origin. Cookies are first-party; no CORS.
- **No local disk is relied on in production**: uploads go to R2 (the app refuses `STORAGE_DRIVER=local`
  in production unless explicitly overridden).
- Nothing runs on a timer: housekeeping piggybacks on real requests, and `/health` doesn't touch the
  database, so Koyeb and Neon can both scale to zero.

### Audit: production-ready vs development-only

| Area | Production | Development/test only |
|---|---|---|
| Server | `server/index.js`: binds `0.0.0.0:$PORT`, graceful SIGTERM/SIGINT, `/health`, `/ready` | — |
| Database | pooled `pg` client, TLS, connect retries, 503 on outage, `db:migrate` / `db:status` with transaction-scoped advisory locks (works through Neon's pooler) | `DATABASE_URL_TEST` schema reset in tests |
| Storage | `r2` driver: private bucket, presigned URLs | `local` driver (`storage/`), HMAC-signed local URLs |
| Email | `resend` transport (HTTP API) | `file` (writes `storage/mail/*.txt`), `memory` (tests), `console` (prints subject only) |
| Bot protection | Turnstile (server-verified), honeypot, rate limits | Turnstile off when keys unset |
| Admin bootstrap | `ADMIN_CLAIM_TOKEN` + `/#/claim-admin`, or `npm run create-admin` against Neon | `npm run seed:demo` (refuses in production) |
| Backups | `npm run db:backup` / `db:restore`, optional weekly GitHub Actions → R2 | — |
| Logs | JSON lines with request ids, secrets redacted | readable lines |
| Old files | `docker-compose.yml` is an *alternative* single-VM setup (local disk + bundled Postgres) | — |

---

## 2. Environment variables

Set these in **Koyeb → your service → Settings → Environment variables** (use Koyeb *Secrets* for
anything marked secret). Never put real values in Git, README, `.env.example` or DNS.

| Variable | Required | Secret | Value / where it comes from |
|---|:-:|:-:|---|
| `NODE_ENV` | ✓ | | `production` (the Dockerfile sets it) |
| `PORT` | | | `8000` (the Dockerfile default; must match the Koyeb exposed port) |
| `APP_URL` | ✓ | | `https://YOURDOMAIN` (or `https://www.YOURDOMAIN`); the canonical URL. Before the domain works, the `https://…koyeb.app` URL |
| `DATABASE_URL` | ✓ | ✓ | Neon **pooled** connection string (host contains `-pooler`, ends with `sslmode=require`) |
| `MAIL_FROM` | ✓ | | e.g. `PinkPill <no-reply@YOURDOMAIN>` (address on your Resend-verified domain) |
| `RESEND_API_KEY` | ✓ | ✓ | Resend → API Keys |
| `R2_ACCOUNT_ID` | ✓ | | Cloudflare → R2 overview (Account ID) |
| `R2_BUCKET` | ✓ | | the bucket name you create |
| `R2_ACCESS_KEY_ID` | ✓ | ✓ | R2 API token (Access Key ID) |
| `R2_SECRET_ACCESS_KEY` | ✓ | ✓ | R2 API token (Secret Access Key) |
| `TURNSTILE_SITE_KEY` | recommended | | Cloudflare → Turnstile widget (public) |
| `TURNSTILE_SECRET_KEY` | recommended | ✓ | same widget (secret) |
| `ADMIN_CLAIM_TOKEN` | first deploy only | ✓ | generate locally (below); delete after claiming admin |
| `TRUST_PROXY` | | | `1` (default in production) |
| `MIGRATE_ON_START` | | | `true` (default) |
| `DB_POOL_MAX` | | | `5` default; keep ≤ 10 on free tiers |
| `DB_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | | | `10000` / `10000` / `15000` |
| `MEDIA_URL_TTL_SECONDS` | | | `300` (lifetime of signed image URLs) |
| `TURNSTILE_ON_LOGIN` | | | `false`; set `true` if login brute-forcing becomes a problem |
| `LOG_LEVEL` | | | `info` |

Not needed and intentionally absent: `SESSION_SECRET` and `CSRF_SECRET`. Sessions and CSRF tokens are
random values generated per session and stored (hashed) in PostgreSQL, so there is no signing key to
leak or rotate.

Generate random secrets **locally** (never in a shared terminal or chat):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Advanced overrides (rarely needed): `CANONICAL_REDIRECT`, `COOKIE_SECURE`, `REQUIRE_EMAIL_VERIFICATION`,
`DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `HOST`, `S3_ENDPOINT`/`S3_REGION`/`S3_FORCE_PATH_STYLE`
(non-R2 S3), `UPLOAD_MAX_BYTES`, `IMAGE_CONCURRENCY`, `SHUTDOWN_TIMEOUT_MS`, `CORS_ORIGINS`,
`MEDIA_SIGNING_SECRET` (local driver only), `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` (only with a persistent disk).

The app **refuses to start in production** if `APP_URL` isn't https, secure cookies are disabled, email is
not Resend, R2 settings are incomplete, or only one Turnstile key is set.

---

## 3. Local development

```bash
cd pinkpill
npm install
cp .env.example .env                  # local values only
createdb pinkpill_dev && createdb pinkpill_test && createdb pinkpill_e2e   # PostgreSQL 16+
npm run db:migrate
npm run seed:demo                     # optional sample content (refuses in production)
npm run dev                           # http://localhost:3000
```

Emails land in `pinkpill/storage/mail/*.txt` (`MAIL_TRANSPORT=file`). Uploads go to `storage/uploads/`.
Tests: `npm test` (API/security/storage/email/deploy), `npm run test:e2e` (Playwright), `npm run build`.

---

## 4. Production deployment: the exact flow

### Step 1: Push the repository to GitHub
The app lives in `pinkpill/` in this repository. Merge the `claude/pinkpill` branch into the branch you
will deploy (e.g. `main`), or deploy that branch directly. CI (`.github/workflows/pinkpill-ci.yml`) runs
on every push and pull request.

> This repository is **public**. That's fine for the code, but it means secrets must only ever live in
> Koyeb / GitHub Actions secrets, never in files.

### Steps 2–3: Neon database
1. Create an account at neon.tech and **create a project**. Choose PostgreSQL **16 or 17** and the region
   closest to your Koyeb region.
2. On the project dashboard, open **Connect** (connection details). Copy two strings:
   - the **pooled** connection string (hostname contains `-pooler`) → Koyeb `DATABASE_URL`;
   - the **direct** connection string (no `-pooler`) → keep it for backups and local admin commands.
3. Both already include `sslmode=require`; PinkPill enables verified TLS automatically.

### Steps 4–5: Cloudflare R2
1. Cloudflare dashboard → **R2 Object Storage** → create a bucket (e.g. `pinkpill-uploads`).
   **Do not enable public access** (no r2.dev subdomain, no custom domain on the bucket). The app
   hands out short-lived signed URLs instead.
2. Copy your **Account ID** (shown on the R2 overview) → `R2_ACCOUNT_ID`.
3. **Manage R2 API tokens** → create a token with **Object Read & Write**, scoped to *this bucket only*.
   Copy the **Access Key ID** → `R2_ACCESS_KEY_ID` and **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   (shown once). Bucket name → `R2_BUCKET`.
4. No CORS rules are needed (images load via `<img>` redirects).

### Steps 6–7: Resend
1. Create an account at resend.com → **Domains** → add your domain (a subdomain like `mail.YOURDOMAIN`
   is fine).
2. Resend shows DNS records (SPF/DKIM TXT records and possibly MX for bounces). Add **exactly those
   records** in Cloudflare DNS (Section 10), with the Cloudflare proxy **off** (DNS only), and wait until
   Resend marks the domain verified.
3. **API Keys** → create a key with *sending access* → `RESEND_API_KEY`.
4. Set `MAIL_FROM` to an address on the verified domain, e.g. `PinkPill <no-reply@YOURDOMAIN>`.

### Step 8: Turnstile
1. Cloudflare dashboard → **Turnstile** → add a widget. Hostnames: `YOURDOMAIN` and `www.YOURDOMAIN`
   (add your `…koyeb.app` hostname too if you'll test there). Mode: Managed.
2. Copy the **Site Key** → `TURNSTILE_SITE_KEY` and **Secret Key** → `TURNSTILE_SECRET_KEY`.
3. Protected actions: registration and password-reset requests (and login with `TURNSTILE_ON_LOGIN=true`).
   The server verifies every token with Cloudflare and rejects the request if Cloudflare can't be reached.

### Steps 9–13: Koyeb
1. Create an account at koyeb.com, connect GitHub, **Create Web Service → GitHub**, pick this repository
   and branch.
2. Builder: **Dockerfile**. This is a monorepo, so point Koyeb at the app folder: Dockerfile
   `pinkpill/Dockerfile` with **work directory / build context `pinkpill`**. Koyeb's exact field names
   vary; the image must be built *from inside `pinkpill/`*.
3. Instance: the **free** instance type. Scaling: 1 instance (rate limits are per instance).
4. Port: **8000**, HTTP, route `/`.
5. **Health check**: HTTP, path **`/health`**, port 8000. Use `/health`, not `/ready`: `/ready` queries the
   database, and probing it continuously would keep Neon from scaling to zero.
6. Environment variables: add everything from Section 2 (secrets as Koyeb Secrets).
   First deploy: `APP_URL=https://<your-service>.koyeb.app` (copy it from Koyeb) until the domain works.
7. Deploy. Watch the logs for `"event":"server.listening"`. A configuration mistake shows up as
   `Invalid configuration: …` and the instance stops. Fix the variable and redeploy.

### Step 14: Migrations
With `MIGRATE_ON_START=true` (default), pending migrations run at startup, serialized with a PostgreSQL
advisory lock. To run them manually instead (e.g. before a risky deploy):

```bash
cd pinkpill
DATABASE_URL='<Neon direct URL>' npm run db:status
DATABASE_URL='<Neon direct URL>' npm run db:backup     # always back up first
DATABASE_URL='<Neon direct URL>' npm run db:migrate
```
(Type the URL into your own terminal; don't save it in shell history on shared machines.)

### Step 15: First administrator
Pick one:
- **No shell (recommended):** set `ADMIN_CLAIM_TOKEN` (random, generated locally), deploy, register a
  normal account on the site, open `https://YOURDOMAIN/#/claim-admin`, paste the token. It works only while
  no super administrator exists. Then **delete `ADMIN_CLAIM_TOKEN`** from Koyeb and redeploy.
- **From your computer:** `DATABASE_URL='<Neon direct URL>' npm run create-admin`.

### Steps 16–18: Custom domain, DNS, HTTPS
See Section 10. Then set `APP_URL=https://YOURDOMAIN` and redeploy. Every other hostname (the
`koyeb.app` URL, `www` or apex) is 301-redirected to `APP_URL`, and plain HTTP is redirected to HTTPS.
Check: `https://YOURDOMAIN/health` returns `{"status":"ok"}`, and a response header shows
`Strict-Transport-Security`.

### Steps 19–27: Verify
Work through the **smoke-test checklist** in Section 16 (email, signup, login, posting, uploads, private
messages, moderation, admin, backups).

---

## 5. Database setup (Neon)

- The app uses **one pool** per process (`DB_POOL_MAX`, default 5) through Neon's **pooled** endpoint.
  Idle connections are released after `DB_IDLE_TIMEOUT_MS` so Neon can suspend.
- **Cold start:** after Neon suspends, the first connection takes a moment; the app retries connection
  attempts (never queries) and answers `503` with `Retry-After` if the database is still unreachable.
- Tested through **PgBouncer in transaction mode** (the pooling mode Neon's pooler uses): all API tests
  pass, including migration locking.
- Use the **direct** (non-pooler) URL for `pg_dump`/`pg_restore` and for long admin sessions.

## 6. R2 setup
Covered in Steps 4–5. How it works: uploads are decoded and re-encoded to WebP with Sharp (magic bytes,
format, dimensions, 24-megapixel cap, 5 MB request cap, EXIF stripped), then stored as `<random-uuid>.webp`.
Users never choose keys or filenames. `GET /media/<uuid>` checks permission, then redirects to a presigned R2
URL valid for `MEDIA_URL_TTL_SECONDS`, with `Content-Type: image/webp` pinned in the signature.

## 7. Resend setup
Covered in Steps 6–7. Emails sent: verification (48 h, single-use), password reset (1 h, single-use),
"password changed" notice. At most 3 emails of each kind per recipient per hour, plus per-IP and
per-account rate limits. Tokens are stored hashed and never logged. Logs show `mail.sent`/`mail.failed` with a
masked address only. If Resend is down, signup still succeeds and the user can press *Resend email* later.

## 8. Turnstile setup
Covered in Step 8. The widget script is only loaded on pages that show it. CSP allows
`https://challenges.cloudflare.com` for scripts and frames for this reason.

## 9. Koyeb setup
Covered in Steps 9–13. Restart safety: on SIGTERM the app stops accepting connections, waits up to
`SHUTDOWN_TIMEOUT_MS` (10 s) for in-flight requests, closes the pool and exits 0. Migrations are
idempotent and locked, so a restart mid-deploy is safe.

## 10. DNS setup (Cloudflare DNS)

Decide the canonical hostname: **apex** (`YOURDOMAIN`) or **www** (`www.YOURDOMAIN`). Set `APP_URL` to it.

1. In Koyeb, open the service's **Domains** settings and add **both** `YOURDOMAIN` and `www.YOURDOMAIN`.
   Koyeb shows the DNS record target for each (typically a CNAME target).
2. In Cloudflare → your domain → **DNS → Records**, create exactly what Koyeb shows. For the apex,
   Cloudflare supports CNAME at the root ("CNAME flattening"). Start with **Proxy status: DNS only**
   (grey cloud) so Koyeb can issue its TLS certificate.
3. Wait until Koyeb shows both domains as active with a certificate. `https://` must work on both.
4. The app redirects the non-canonical hostname to `APP_URL` with a 301. No Cloudflare redirect rule is
   needed.
5. Resend's records (Step 6) go in the same DNS zone. They are TXT/MX records and never contain secrets.
6. Optional: after everything works, you may switch the web records to **Proxied** (orange cloud) with SSL mode
   **Full (strict)**. Test afterwards. If certificate renewal or redirects misbehave, switch back to
   DNS only. Keep `TRUST_PROXY=1` either way.

Never publish API keys, tokens or passwords in DNS records.

## 11. Migrations
- Files: `server/db/migrations/NNN_name.sql`, forward-only, applied in order, each in its own transaction.
- State: `schema_migrations` table (name, applied time, checksum). Editing an applied migration logs a
  warning. Never do it; add a new migration.
- `npm run db:migrate` is safe to run repeatedly and concurrently; it fails loudly and rolls back on error.
- Nothing ever drops or resets the production database. The only destructive code (`DROP SCHEMA`) lives in
  the test helpers and runs against `DATABASE_URL_TEST` / the E2E database.

## 12. Backups
**Neon's free tier is not a backup.** Its history/restore window is short and bound to the same account.
Keep your own copies.

- **Manual (tested):** `DATABASE_URL='<Neon direct URL>' npm run db:backup` writes
  `backups/pinkpill-<timestamp>.dump` (pg_dump custom format, file mode 600). Store it off-machine; it
  contains personal data. Requires `pg_dump` ≥ the Neon major version (install PostgreSQL client 17 to be
  safe).
- **Restore test (do this monthly):** create an empty database (a new Neon branch/database, or local
  `createdb pinkpill_restore_test`), then
  `npm run db:restore -- backups/<file>.dump --target '<empty database URL>'`. The command never defaults to
  `DATABASE_URL` and refuses to overwrite it without `--overwrite-production`. The automated test
  `test/backup.test.js` performs this round trip.
- **Automatic (optional, free):** `.github/workflows/pinkpill-backup.yml` runs weekly (and on demand),
  dumps with pg_dump 17, encrypts with AES-256 (`BACKUP_PASSPHRASE`), and uploads to a **separate private R2
  bucket**. Add repository secrets `BACKUP_DATABASE_URL` (direct URL), `R2_ACCOUNT_ID`,
  `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` (token scoped to the backup bucket),
  `R2_BACKUP_BUCKET`, `BACKUP_PASSPHRASE`. Without them the workflow skips. Decrypt with
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in X.dump.enc -out X.dump`.
- R2 images are not included in database dumps. Keep R2 bucket deletion protected (don't share the token).

## 13. Rollback
- **Code:** Koyeb keeps previous deployments. Redeploy the last good one (or revert the commit and push).
- **Schema:** migrations are forward-only and additive. Take a backup before deploying a migration. To roll
  back data, restore that backup into a new Neon database/branch, verify it, then point `DATABASE_URL` at it.
- **Config:** a bad variable stops the instance at startup with a clear message. Fix it and redeploy.

## 14. Monitoring
- **Logs (Koyeb):** one JSON object per line: `ts`, `level`, `event`, and for requests `reqId`, `method`,
  `route`, `status`, `ms`, `user` (numeric id). Every response carries `X-Request-Id`, and 5xx bodies
  include `requestId` so user reports can be matched to logs. Passwords, cookies, tokens, API keys,
  message contents and email addresses are never logged (keys are redacted, addresses masked).
- Useful events: `server.listening`, `server.shutdown_*`, `db.connect_retry`, `db.unavailable`,
  `mail.failed`, `turnstile.unreachable`, `http.unhandled_error`, `maintenance.cleanup`.
- **Health:** Koyeb checks `/health`. You can open `/ready` manually to confirm the database is reachable.
- An external uptime pinger hitting `/health` every few minutes keeps Koyeb awake (no cold starts) but
  uses more free-tier hours. It's your trade-off.

## 15. Known free-tier limitations
- **Cold starts:** Koyeb free scales to zero; the first visit after idle waits for the container and, if
  suspended, Neon (several seconds). The app retries database connects and returns 503 + `Retry-After` if
  still unavailable.
- **512 MB RAM / 0.1 vCPU:** image processing is serialized (one image at a time, 24-megapixel cap), JSON
  bodies are capped at 100 KB (25 MB only for the authenticated admin import), uploads at 5 MB.
- **Single instance:** rate limits, the brief forum-list cache and view-count de-duplication are
  in-memory, per instance, and reset on restart. For several instances, plug a shared store into
  `server/lib/limits.js` (`setStoreFactory`).
- **Neon free:** limited storage and compute hours per month. Watch usage in the Neon dashboard.
- **Resend free:** limited emails per day/month. Registration spikes can hit it; failures are logged and
  users can resend.
- **R2 free:** generous storage/operations, but deleted posts don't delete their images (there's no
  orphan-cleanup job yet).
- **Presigned-URL expiry** is enforced by R2 itself. The automated tests verify the signature parameters
  against an S3 emulator (which doesn't enforce expiry) and verify expiry for the local signed URLs. Check R2
  expiry once after deploying (smoke test S9).
- **Turnstile** needs the browser to reach `challenges.cloudflare.com`; strict blockers may prevent
  signup. The error message says so.
- **Search** uses PostgreSQL full-text search on the same small database. Fine for a young community.
- **Forum index statistics** are aggregated per request. OK at this scale; denormalise if posts reach
  the hundreds of thousands.

## 16. Deployment smoke-test checklist (run against the live site)

**Guest**
- [ ] G1 Homepage loads over `https://YOURDOMAIN` (and `www`/apex redirects there).
- [ ] G2 Forum list, a forum, a thread, search, and the member directory load.
- [ ] G3 Private Ratings is not visible, and its thread URLs show "not found".
- [ ] G4 Registration page shows the Turnstile widget.

**Member** (use a real inbox)
- [ ] M1 Register → verification email arrives (check spam) → link verifies.
- [ ] M2 Log out, log in, "Forgot password" email arrives and works; old sessions are logged out.
- [ ] M3 Edit profile; upload an avatar; it still shows after a Koyeb **redeploy** (proves R2 persistence).
- [ ] M4 Create a thread, reply, react, give rep, vote in a poll, bookmark, watch.
- [ ] M5 Send a private message to a second account (second browser); the notification appears.
- [ ] M6 Post an image in Private Ratings. A logged-out browser gets 404 for the `/media/…` URL.

**Moderator** (promote a test account)
- [ ] D1 Report a post → it appears in the report queue → resolve it.
- [ ] D2 Lock/pin/move a thread; warn and suspend a test member; the member can read but not post.
- [ ] D3 Moderation log shows every action.

**Admin**
- [ ] A1 Dashboard, members, roles & permissions, forums, settings all load; edit a forum.
- [ ] A2 `ADMIN_CLAIM_TOKEN` has been deleted from Koyeb.

**Security**
- [ ] S1 `curl -si https://YOURDOMAIN/api/admin/stats` → 401. Logged in as a member → 403.
- [ ] S2 Opening another user's conversation URL → not found.
- [ ] S3 Response headers include CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`.
- [ ] S4 The session cookie is `__Host-pp_session` with `HttpOnly; Secure; SameSite=Lax` (browser devtools).
- [ ] S5 A POST without the `X-CSRF-Token` header (e.g. via curl with your cookie) → 403.
- [ ] S6 More than 5 password-reset requests in an hour from one IP → 429.
- [ ] S7 `https://YOURDOMAIN/health` → `{"status":"ok"}`; `/ready` → `{"status":"ready"}`.
- [ ] S8 A backup was taken (`npm run db:backup` or the workflow) and restored into a test database.
- [ ] S9 Copy an image's signed R2 URL (from the redirect), wait > `MEDIA_URL_TTL_SECONDS`, and open it again → access denied.

---

## 17. Account and age policy (as implemented)
- **Requirement:** members must be 18 or older (Rule 1, Terms).
- **How it's collected:** a date of birth field at registration. The server rejects dates under 18 years
  and stores the date in `profiles.birthday`. Other members only ever see the month and day.
- **What it is not:** this is **self-attestation**. Nothing verifies the date or the person's identity.
  A minor can lie about their birthdate, so it does not meet any legal "age verification" standard. If
  you need real age assurance, that requires a third-party verification provider (not included).
- Accounts also need a verified email address before posting (in production), one account per person
  per the rules (not technically enforced), and can be deleted by the member (anonymised; posts remain as
  "Deleted member").

## 18. Content moderation policy status
The automatic safety flagger (`server/lib/safety.js`) currently auto-reports posts containing a fixed list
of terms, including eating-disorder terms such as "pro-ana" and "thinspo", to the moderator queue, and
shows support resources for crisis language. It never blocks or removes posts. The rules page describes this
behaviour accurately. A requested change to stop auto-flagging eating-disorder terminology **has not been
applied** in this repository; see the project notes for its status.

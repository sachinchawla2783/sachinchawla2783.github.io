# Deploying PinkPill on $0 infrastructure

Target stack: **Render** (free web service) · **Neon** (PostgreSQL) · **Cloudflare R2** (uploads) ·
**Resend** (email) · **Cloudflare DNS + Turnstile** · **GitHub** (source + CI) · your own domain.

This is a **hobby-grade, free-tier deployment**. It is suitable for a small community and for testing.
It is not enterprise-grade or highly available infrastructure: the free Render instance sleeps when idle,
has very little CPU and memory, and comes with no uptime guarantee (Section 15).

Provider dashboards and free-tier terms change often. Wherever this guide says "copy X", take the
exact value from that provider's dashboard. Nothing here invents provider-specific values such as DNS
targets. Check each provider's current pricing page before launch.

---

## 1. Architecture

```
Browser ──HTTPS──► Cloudflare DNS (DNS only) ──► Render free web service (Node 22, native runtime)
                                                   │  serves public/ (frontend) + /api + /media
                                                   ├──► Neon PostgreSQL (pooled connection, TLS)
                                                   ├──► Cloudflare R2 (private bucket, S3 API)
                                                   ├──► Resend HTTP API (verification/reset emails)
                                                   └──► Cloudflare Turnstile siteverify (signup/reset)
Browser ◄── short-lived presigned R2 URL for images (issued only after authorization)
```

- One Node process, one origin. Cookies are first-party; no CORS.
- Render terminates TLS and forwards to the app on `$PORT`. The app binds `0.0.0.0`, trusts exactly one
  proxy hop (`TRUST_PROXY=1`) so client IPs and `https` detection are correct.
- **No local disk is relied on in production.** Render's filesystem is ephemeral (wiped on every deploy,
  restart and spin-down). Uploads go to R2, and the app refuses to start with `STORAGE_DRIVER=local` in
  production. Sessions, rate-limit-relevant data and everything else live in Neon.
- Nothing runs on a timer and nothing polls the database: housekeeping piggybacks on real requests, and
  `/health` doesn't touch the database, so Neon can scale to zero while the site is idle.

### Files that configure the deployment

| File | Purpose |
|---|---|
| `render.yaml` (repository root) | Render Blueprint: one **free** web service, root directory `pinkpill`, build/start commands, health check `/health`, variable names (values are entered in the dashboard, never stored in Git). Creates no database and no disk. |
| `pinkpill/.node-version`, `package.json` `engines` | Node 22 for Render's native Node runtime. |
| `pinkpill/Dockerfile` | Optional container image (not used by the Blueprint). Listens on `$PORT`. Useful for other container hosts or to test a production build locally. |
| `pinkpill/docker-compose.yml` | Alternative self-hosted single-VM setup (bundled PostgreSQL + local disk). Not used on Render. |
| `.github/workflows/pinkpill-ci.yml` | CI: build check, API/security tests, E2E tests. Uses a throwaway PostgreSQL service, no production credentials. |
| `.github/workflows/pinkpill-backup.yml` | Optional weekly encrypted database backup to a private R2 bucket. |

### Audit: production vs development-only

| Area | Production | Development/test only |
|---|---|---|
| Server | `server/index.js`: binds `0.0.0.0:$PORT`, graceful SIGTERM/SIGINT, `/health`, `/ready`, serves `public/` | — |
| Database | pooled `pg` client, TLS, connect retries, 503 on outage, `db:migrate` / `db:status` with transaction-scoped advisory locks (works through Neon's pooler) | `DATABASE_URL_TEST` schema reset in tests |
| Storage | `r2` driver: private bucket, presigned URLs | `local` driver (`storage/`), HMAC-signed local URLs |
| Email | `resend` transport (HTTP API) | `file` (writes `storage/mail/*.txt`), `memory` (tests), `console` (prints subject only) |
| Bot protection | Turnstile (server-verified) on registration and password reset, honeypot, rate limits | Turnstile off when keys unset |
| Admin bootstrap | `ADMIN_CLAIM_TOKEN` + `/#/claim-admin`, or `npm run create-admin` against Neon | `npm run seed:demo` (refuses in production) |
| Backups | `npm run db:backup` / `db:restore`, optional weekly GitHub Actions → R2 | — |
| Logs | JSON lines with request ids, secrets redacted | readable lines |

---

## 2. Environment variables

Set these in **Render → your service → Environment**. Anything marked secret must only ever be typed
into the Render dashboard (or GitHub Actions secrets for backups). Never put real values in Git, README,
`.env.example`, DNS records, issues or chat.

### Final variable table

| VARIABLE | PURPOSE | SECRET? | WHERE IT COMES FROM | REQUIRED? |
|---|---|:-:|---|---|
| `NODE_ENV` | Turns on production mode: secure cookies, HSTS, JSON logs, strict config checks | No | Set to `production` by `render.yaml` | Yes |
| `PORT` | Port the app listens on | No | **Provided by Render automatically.** Do not set it yourself. | Automatic |
| `APP_URL` | Canonical public URL; used for every email link and redirect (never the request's Host header) | No | You: `https://YOURDOMAIN` after the custom domain works (Section 10). Leave unset before that. | Yes, once the domain is live |
| `RENDER_EXTERNAL_URL` | Fallback canonical URL (`https://<service>.onrender.com`) while `APP_URL` is unset | No | **Provided by Render automatically** | Automatic |
| `DATABASE_URL` | PostgreSQL connection | **Yes** | Neon → Connect → **pooled** connection string (host contains `-pooler`, includes `sslmode=require`) | Yes |
| `RESEND_API_KEY` | Sends verification / password-reset / password-changed emails | **Yes** | Resend → API Keys (sending access only) | Yes |
| `MAIL_FROM` | Sender, e.g. `PinkPill <no-reply@YOURDOMAIN>` | No | You: an address on your Resend-verified domain | Yes |
| `MAIL_TRANSPORT` | Email transport | No | Set to `resend` by `render.yaml` (also the production default) | Yes (preset) |
| `STORAGE_DRIVER` | Upload storage | No | Set to `r2` by `render.yaml` (also the production default) | Yes (preset) |
| `R2_ACCOUNT_ID` | Builds the R2 endpoint `https://<id>.r2.cloudflarestorage.com` | No | Cloudflare → R2 overview → Account ID | Yes |
| `R2_BUCKET` | Private bucket for uploads | No | The bucket name you create | Yes |
| `R2_ACCESS_KEY_ID` | R2 API token (access key) | **Yes** | Cloudflare → R2 → Manage API tokens | Yes |
| `R2_SECRET_ACCESS_KEY` | R2 API token (secret) | **Yes** | Same token; shown once | Yes |
| `TURNSTILE_SITE_KEY` | Public widget key shown in the browser | No (public) | Cloudflare → Turnstile → your widget | Strongly recommended (both or neither) |
| `TURNSTILE_SECRET_KEY` | Server-side token verification | **Yes** | Same widget | Strongly recommended (both or neither) |
| `ADMIN_CLAIM_TOKEN` | One-time token to claim the first super administrator (≥ 24 characters) | **Yes** | Generate locally (below) | First deploy only; **delete afterwards** |
| `TRUST_PROXY` | Number of proxies in front of the app | No | Set to `1` by `render.yaml` (Render's proxy) | Preset |
| `STRIPE_SECRET_KEY` | VIP card payments (Stripe Checkout) | **Yes** | Stripe → Developers → API keys (secret key) | Optional (card shows "not available" without it) |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures | **Yes** | Stripe → Developers → Webhooks → your endpoint → signing secret | With `STRIPE_SECRET_KEY` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | VIP PayPal payments | Secret: **Yes** | PayPal Developer → Apps & Credentials | Optional (all three together) |
| `PAYPAL_WEBHOOK_ID` | Verifies PayPal webhooks | No | PayPal Developer → your app → Webhooks | With the PayPal keys |
| `PAYPAL_ENV` | `live` or `sandbox` (default) | No | You | With the PayPal keys |
| `COINBASE_COMMERCE_API_KEY` | VIP crypto payments | **Yes** | Coinbase Commerce → Settings → API keys | Optional |
| `COINBASE_COMMERCE_WEBHOOK_SECRET` | Verifies Coinbase webhooks | **Yes** | Coinbase Commerce → Settings → Webhook subscriptions → shared secret | With the Coinbase key |

Reviewed and **not used** by this app (do not create them): `SESSION_SECRET` and `CSRF_SECRET`
(sessions and CSRF tokens are random per-session values stored hashed in PostgreSQL, so there is no
signing key to leak or rotate), and `R2_PUBLIC_BASE_URL` (the bucket is private; images are served
through short-lived presigned URLs after an authorization check, never from a public bucket URL).

Optional tuning (defaults are right for Render free; set only if needed): `DB_POOL_MAX` (5),
`DB_IDLE_TIMEOUT_MS` (10000), `DB_CONNECTION_TIMEOUT_MS` (10000), `DB_STATEMENT_TIMEOUT_MS` (15000),
`MIGRATE_ON_START` (true), `MEDIA_URL_TTL_SECONDS` (300), `TURNSTILE_ON_LOGIN` (false), `LOG_LEVEL` (info),
`SHUTDOWN_TIMEOUT_MS` (10000), `UPLOAD_MAX_BYTES` (5 MB), `IMAGE_CONCURRENCY` (1).
Advanced overrides you should normally leave unset: `CANONICAL_REDIRECT`, `COOKIE_SECURE`,
`REQUIRE_EMAIL_VERIFICATION`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `HOST`, `CORS_ORIGINS`,
`S3_*` (non-R2 S3 only), `MEDIA_SIGNING_SECRET` and `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` (local driver
only; never on Render).

Payment variables are not in `render.yaml`; add the ones you use in Render → Environment. A provider
with only some of its variables set also stops startup (it could take money without being able to
confirm it). See Section 8a.

The app **refuses to start in production** if the canonical URL isn't `https://`, secure cookies are
disabled, email isn't Resend, `RESEND_API_KEY` is missing, `MAIL_FROM` is still a localhost address, R2
settings are incomplete, local storage is selected, or only one Turnstile key is set. Render then shows
`Invalid configuration: …` in the logs and the deploy fails instead of running half-configured.

Generate random tokens **locally** (never in a shared terminal or chat):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

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

Accounts you need (all have free plans): **GitHub** (you have it), **Render**, **Neon**, **Cloudflare**
(DNS for your domain, R2, Turnstile), **Resend**.

### Step 1: GitHub
The app lives in `pinkpill/`; `render.yaml` is at the repository root. Merge the `claude/pinkpill`
branch into the branch you will deploy (e.g. `main`), or deploy that branch directly. CI runs on every
push and pull request.

> This repository is **public**. That's fine for the code, but secrets must only ever live in the
> Render dashboard and GitHub Actions secrets, never in files.

### Step 2: Neon database
1. Create an account at neon.tech and **create a project** (PostgreSQL 16 or 17). Pick the region closest
   to the Render region you will choose.
2. Open **Connect** on the project dashboard. Copy two strings:
   - the **pooled** connection string (hostname contains `-pooler`) → Render `DATABASE_URL`;
   - the **direct** connection string (no `-pooler`) → keep it privately for `db:backup`, `db:restore`,
     manual migrations and `create-admin`. Never put it in Render.
3. Both include `sslmode=require`; PinkPill enables verified TLS automatically.
4. Do **not** use Render's PostgreSQL. Neon is the only production database.

### Step 3: Cloudflare R2
1. Cloudflare dashboard → **R2 Object Storage**. Cloudflare asks for a payment method before enabling R2
   even on the free allowance; see Section 15a to avoid charges.
2. Create a bucket (e.g. `pinkpill-uploads`) with the **Standard** storage class (not Infrequent Access).
   **Do not enable public access**: no r2.dev subdomain, no custom domain on the bucket.
3. Copy your **Account ID** → `R2_ACCOUNT_ID`. Bucket name → `R2_BUCKET`.
4. **Manage R2 API tokens** → create a token with **Object Read & Write** scoped to *this bucket only*.
   Copy the **Access Key ID** → `R2_ACCESS_KEY_ID` and **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   (shown once; paste it directly into Render).
5. No CORS rules are needed (images load through `<img>` redirects).

### Step 4: Resend
1. Create an account at resend.com → **Domains** → add your domain (a subdomain like `mail.YOURDOMAIN`
   is fine).
2. Resend shows DNS records (SPF/DKIM TXT records and possibly an MX record for bounces). Add **exactly
   those records** in Cloudflare DNS with **Proxy status: DNS only**, then wait until Resend marks the
   domain verified.
3. **API Keys** → create a key with *sending access* → `RESEND_API_KEY`.
4. `MAIL_FROM` = an address on the verified domain, e.g. `PinkPill <no-reply@YOURDOMAIN>`.

### Step 5: Turnstile
1. Cloudflare dashboard → **Turnstile** → add a widget, mode **Managed**. Hostnames: `YOURDOMAIN`,
   `www.YOURDOMAIN`, and your `<service>.onrender.com` hostname (so you can test before the domain works;
   you may remove it later).
2. Copy the **Site Key** → `TURNSTILE_SITE_KEY` and **Secret Key** → `TURNSTILE_SECRET_KEY`.
3. Protected actions: registration and password-reset requests (and login with `TURNSTILE_ON_LOGIN=true`).
   The server verifies every token with Cloudflare and rejects the request if Cloudflare can't be
   reached. The honeypot field and rate limits stay active in addition.

### Step 6: Render web service
Recommended: **Blueprint** (uses `render.yaml`).
1. Create an account at render.com and connect GitHub (grant access to this repository only if you like).
2. **New → Blueprint** → pick this repository and the branch to deploy. Render reads `render.yaml` and
   proposes exactly one resource: the web service `pinkpill` on the **Free** instance type. It must not
   list any database or disk. If anything shows a paid plan, stop and fix it before applying.
3. Render prompts for every `sync: false` variable. Enter the values from Steps 2–5 and a freshly
   generated `ADMIN_CLAIM_TOKEN`. **Leave `APP_URL` empty for now** (the app uses Render's
   `onrender.com` URL until the custom domain works).
4. Apply. Render builds with `npm ci --omit=dev && npm run build` in `pinkpill/` and starts `npm start`.

Manual alternative (same result): **New → Web Service** → this repository → **Language: Node**, **Root
Directory:** `pinkpill`, **Build Command:** `npm ci --omit=dev && npm run build`, **Start Command:**
`npm start`, **Instance Type: Free**, **Health Check Path:** `/health` (under Advanced), then add the
variables from Section 2 including `NODE_ENV=production`, `TRUST_PROXY=1`, `MAIL_TRANSPORT=resend`,
`STORAGE_DRIVER=r2`. Do not attach a disk.

Use `/health` for the health check, not `/ready`: `/ready` queries the database, and probing it
continuously would keep Neon awake.

### Step 7: First deploy check
Watch **Logs**. Success looks like `"event":"server.listening"` with
`"appUrl":"https://<service>.onrender.com"`. A configuration mistake shows `Invalid configuration: …` and
the deploy fails; fix the variable and redeploy. Then open `https://<service>.onrender.com/health`
(`{"status":"ok"}`) and `/ready` (`{"status":"ready"}`).

### Step 8: Migrations
With `MIGRATE_ON_START=true` (default), pending migrations run at startup, serialized with a PostgreSQL
advisory lock. To run them manually instead (e.g. before a risky deploy), from your own computer:

```bash
cd pinkpill
DATABASE_URL='<Neon direct URL>' npm run db:status
DATABASE_URL='<Neon direct URL>' npm run db:backup     # always back up first
DATABASE_URL='<Neon direct URL>' npm run db:migrate
```
(Type the URL into your own terminal; don't leave it in shell history on shared machines.)

### Step 9: First administrator
See Section 9. Do it on the `onrender.com` URL or after the domain works; either is fine.

### Step 10: Custom domain, DNS, HTTPS
See Section 10.

### Step 11: Verify
Work through the smoke-test checklist in Section 16.

---

## 5. Database (Neon)

- **One pool** per process (`DB_POOL_MAX`, default 5) through Neon's **pooled** endpoint. Idle
  connections are released after `DB_IDLE_TIMEOUT_MS`, so Neon can suspend (scale to zero).
- Nothing polls the database: no timers, no background jobs, `/health` is database-free.
- **Cold start:** after Neon suspends, the first connection takes a moment. The app retries connection
  attempts (never queries) and answers `503` with `Retry-After` if the database is still unreachable.
- Tested through **PgBouncer in transaction mode** (the pooling mode Neon's pooler uses): all API tests
  pass, including migration locking.
- Use the **direct** (non-pooler) URL for `pg_dump`/`pg_restore` and long admin sessions.

## 6. Uploads (R2)
Uploads are decoded and re-encoded to WebP with Sharp (magic bytes, format, dimensions, 24-megapixel cap,
5 MB request cap, EXIF stripped), then stored as `<random-uuid>.webp` in the private bucket. Users never
choose keys or filenames. `GET /media/<uuid>` checks permission (e.g. Private Ratings images only for
members with access), then redirects to a presigned R2 URL valid for `MEDIA_URL_TTL_SECONDS`, with
`Content-Type: image/webp` pinned in the signature. Because nothing is stored on Render's disk, images
survive deploys and spin-downs.

## 7. Email (Resend)
Emails sent: verification (48 h, single-use), password reset (1 h, single-use), "password changed" notice.
All links are built from `APP_URL`. At most 3 emails of each kind per recipient per hour, plus per-IP and
per-account rate limits. Tokens are stored hashed and never logged; logs show `mail.sent`/`mail.failed`
with a masked address only. If Resend is down, signup still succeeds and the user can press *Resend
email* later.

## 8. Turnstile
The widget script is loaded only on pages that show it. The CSP allows `https://challenges.cloudflare.com`
for scripts and frames for this reason. Tokens are verified server-side on registration and password-reset
requests; the honeypot and rate limits remain in place.

## 8a. VIP memberships and payments

VIP is a paid membership. Packages, prices, benefits, colors and frames live in the database and are
edited in **Admin & moderator panel → 👑 VIP**; nothing is priced in frontend code. The initial prices
are VIP $8/month, VIP+ $17/month, Lifetime VIP $82, Lifetime VIP+ $108 and Lifetime VIP+ Custom Color
$208. Annual prices start unset (not offered) until you enter them.

**How payment works.** The browser only chooses a package, billing period, payment method and style
options. The server calculates the price, creates a pending order and sends the member to the
provider's hosted payment page. The membership is activated only after the payment is confirmed
server-side, either by a signed webhook or by the server asking the provider for the order status.
Activation happens in one database transaction, and webhook deliveries are de-duplicated. Monthly
packages are one-time payments for one month (or 12 months); they don't renew automatically. There is
no pro-rated credit for upgrades.

| Method | Provider | Needs | Webhook URL to register at the provider |
|---|---|---|---|
| Credit Card | Stripe Checkout | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `https://YOURDOMAIN/api/payments/webhooks/stripe` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`) |
| PayPal | PayPal Orders v2 | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` | `https://YOURDOMAIN/api/payments/webhooks/paypal` (events: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`) |
| Cryptocurrency | Coinbase Commerce | `COINBASE_COMMERCE_API_KEY`, `COINBASE_COMMERCE_WEBHOOK_SECRET` | `https://YOURDOMAIN/api/payments/webhooks/coinbase` (events: `charge:confirmed`, `charge:resolved`, `charge:failed`) |
| Wallet Balance | Internal | Nothing | — (charged inside the same transaction that activates the membership) |

A method without its variables shows as "not available yet" and can't be used. Admins can also switch
methods off in VIP → Settings. Start with test/sandbox keys, make a test purchase, then switch to live
keys. Check each provider's current fees and terms; payment providers are not free services.
Coinbase Commerce payments can't be refunded automatically: refund in Coinbase, then use "mark as
refunded" in the admin panel. Wallet balances are credited by admins (VIP → Wallets); there is no
self-service top-up.

**Rule changes for members without VIP** (all adjustable in VIP → Settings; 0 = unlimited where noted):
- posts can be edited for 60 minutes after posting (VIP+ gets 12 hours; moderators are exempt);
- conversations can include at most 10 people in total (VIP 15, VIP+ 25);
- your own threads in rating forums can only be deleted while they have no replies (VIP: any time).

VIP-only forums (VIP Supporters, `f-vip`) are hidden from everyone without an active VIP membership,
except staff. Expired, revoked and refunded memberships lose every benefit immediately. Purchase and
membership history is kept. There is no advertising system; `showAds` in the session tells a future ad
slot whether to render. Every purchase, gift, refund, activation, expiry, admin grant, revoke,
extension, price change and payment failure is written to the audit log.

## 9. First administrator (no hard-coded admin)
1. Deploy with `ADMIN_CLAIM_TOKEN` set (Step 6).
2. On the live site, **register** a normal account with your real email.
3. **Verify the email** using the link Resend delivers.
4. Log in and open `https://<your site>/#/claim-admin`. Paste the token (type/paste it into the page, not
   into any chat). It works only while no super administrator exists, and the action is audit-logged.
5. **Confirm** the page reports success and the **Admin panel** link appears.
6. **Remove the token:** Render → Environment → delete `ADMIN_CLAIM_TOKEN`.
7. **Redeploy** (choose *Save and deploy*, or trigger *Manual Deploy* afterwards) so the running process no
   longer has it.
8. **Confirm admin access comes from the database role:** after the redeploy you can still open the Admin
   panel. Optionally check in Neon's SQL editor:
   `SELECT username, role_id FROM users WHERE role_id = 'super_admin';` → exactly your account.

Alternative without the token: from your own computer run
`DATABASE_URL='<Neon direct URL>' npm run create-admin`.

## 10. Custom domain and DNS (Cloudflare DNS)

Decide the canonical hostname: **apex** (`YOURDOMAIN`) or **www** (`www.YOURDOMAIN`). The steps below
assume apex; swap them if you prefer www. The app 301-redirects every other hostname (the other of
apex/www, and the `onrender.com` URL) and plain HTTP to `APP_URL`, so no Cloudflare redirect rule is needed.
`/health` and `/ready` are never redirected.

> Your domain currently points at GitHub Pages (the repository's `CNAME` file). Moving it to Render means
> replacing the existing web records (A/AAAA/CNAME for the apex and `www`) with Render's. Leave email
> records (Resend's TXT/MX) alone. If you want GitHub Pages to stop claiming the domain, remove the custom
> domain in the repository's Pages settings.

1. **Deploy on `onrender.com` first** and confirm it works (Step 7).
2. **Verify** `https://<service>.onrender.com/health` and `/ready`, and register/log in once there.
3. **Add the domain in Render:** service → **Settings → Custom Domains** → add `YOURDOMAIN` and
   `www.YOURDOMAIN` (Render may add the second one for you; make sure both are listed).
4. **Add the exact DNS records Render displays** in Cloudflare → your domain → **DNS → Records**. Copy the
   record type, name and target exactly as Render shows them; do not guess them. Set **Proxy status: DNS
   only** (grey cloud) for these records. Delete any older A/AAAA/CNAME records for the same names that
   conflict (e.g. the GitHub Pages ones). Read the Cloudflare notes in Render's custom-domain
   documentation and follow them.
5. **Wait for TLS:** click *Verify* in Render and wait until both domains show as verified with a
   certificate issued.
6. **Verify HTTPS** manually: `https://YOURDOMAIN/health` and `https://www.YOURDOMAIN/health` both return
   `{"status":"ok"}`.
7. **Set `APP_URL=https://YOURDOMAIN`** in Render → Environment.
8. **Redeploy** (*Save and deploy*). The log line `server.listening` now shows your domain as `appUrl`.
9. **Test:** register → verification email link points at `https://YOURDOMAIN/…`; log in/out; the session
   cookie is `__Host-pp_session` (Secure, HttpOnly, SameSite=Lax); password-reset link works;
   `https://www.YOURDOMAIN/x` and `https://<service>.onrender.com/x` redirect (301) to
   `https://YOURDOMAIN/x`; `http://` redirects to `https://`.

**DNS-only vs proxied:**
- **Web records (apex, www): keep DNS only.** Render already provides TLS and its own edge, so the
  Cloudflare proxy adds nothing here. It can also interfere with Render's certificate issuance, and with the
  proxy on, the app's rate limits would see Cloudflare's IP addresses instead of visitors'.
- **Email records (Resend SPF/DKIM TXT, MX) and any domain-verification TXT records: always DNS only.**
  TXT/MX records cannot be proxied, and they must stay exactly as the provider gave them.
- **Turnstile** does not need any DNS record; it only needs the hostnames listed in the widget (Step 5).

Never put API keys, tokens or passwords into DNS records.

## 11. Migrations
- Files: `server/db/migrations/NNN_name.sql`, forward-only, applied in order, each in its own transaction.
- State: `schema_migrations` table (name, applied time, checksum). Editing an applied migration logs a
  warning. Never do it; add a new migration.
- `npm run db:migrate` is safe to run repeatedly and concurrently; it fails loudly and rolls back on error.
- Nothing ever drops or resets the production database. The only destructive code (`DROP SCHEMA`) lives in
  the test helpers and runs against `DATABASE_URL_TEST` / the E2E database.

## 12. Backups
**Neon's free tier is not a backup.** Its restore window is short and bound to the same account. Keep your
own copies, **never in Git** (`backups/`, `*.dump`, `*.dump.enc` are git-ignored).

- **Manual (tested):** `DATABASE_URL='<Neon direct URL>' npm run db:backup` writes
  `backups/pinkpill-<timestamp>.dump` (pg_dump custom format, file mode 600). Store it off-machine; it
  contains personal data. Requires `pg_dump` ≥ the Neon major version (install the PostgreSQL 17 client to
  be safe).
- **Restore test (do this monthly):** create an empty database (a new Neon branch/database, or local
  `createdb pinkpill_restore_test`), then
  `npm run db:restore -- backups/<file>.dump --target '<empty database URL>'`. The command never defaults to
  `DATABASE_URL` and refuses to overwrite it without `--overwrite-production`. `test/backup.test.js`
  performs this round trip automatically.
- **Automatic (optional, free):** `.github/workflows/pinkpill-backup.yml` runs weekly (and on demand),
  dumps with pg_dump 17, encrypts with AES-256 (`BACKUP_PASSPHRASE`), and uploads to a **separate private
  R2 bucket**. Add GitHub repository secrets `BACKUP_DATABASE_URL` (Neon direct URL), `R2_ACCOUNT_ID`,
  `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` (token scoped to the backup bucket),
  `R2_BACKUP_BUCKET`, `BACKUP_PASSPHRASE`. Without them the workflow skips. Decrypt with
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in X.dump.enc -out X.dump`. Weekly dumps of a small
  database stay far inside R2's free storage; delete old ones occasionally.
- R2 images are not included in database dumps. Keep the upload token private so nobody can delete them.

## 13. Rollback
- **Code:** Render keeps previous deploys. Service → **Events** (deploy history) → pick the last good
  deploy → **Rollback**. Or revert the commit and push (auto-deploy picks it up).
- **Schema:** migrations are forward-only and additive. Take a backup before deploying a migration. To roll
  back data, restore that backup into a new Neon database/branch, verify it, then point `DATABASE_URL` at it.
- **Config:** a bad variable fails the deploy at startup with a clear message; Render keeps serving the
  previous healthy deploy. Fix the variable and redeploy.

## 14. Monitoring and health checks
- **`/health`** → `200 {"status":"ok"}` whenever the process is up (no database access). Render's health
  check uses it.
- **`/ready`** → `200 {"status":"ready"}` only if the database answers; `503` otherwise (also `503` while
  shutting down). Use it manually.
- **Logs (Render → Logs):** one JSON object per line: `ts`, `level`, `event`, and for requests `reqId`,
  `method`, `route`, `status`, `ms`, `user` (numeric id). Every response carries `X-Request-Id`, and 5xx
  bodies include `requestId` so user reports can be matched to logs. Passwords, cookies, tokens, API keys,
  message contents and email addresses are never logged (keys redacted, addresses masked). Log retention on
  the free plan is short; copy anything you need to keep.
- Useful events: `server.listening`, `server.shutdown_*`, `db.connect_retry`, `db.unavailable`,
  `mail.failed`, `turnstile.unreachable`, `http.unhandled_error`, `maintenance.cleanup`.
- **Graceful shutdown:** on SIGTERM (deploy, restart, spin-down) the app stops accepting connections, waits
  up to `SHUTDOWN_TIMEOUT_MS` (10 s) for in-flight requests, closes the pool and exits 0. Migrations are
  idempotent and locked, so a restart mid-deploy is safe.
- Don't point an external uptime pinger at `/ready`; it would keep Neon awake. A pinger on `/health` would
  keep Render awake but spends your monthly free instance hours and goes against the spirit of a free hobby
  tier. The recommended setup is to accept cold starts.

## 15. Render free-tier limitations (read before launch)
- **Spins down when idle.** A free web service stops after a period without inbound traffic (currently
  about 15 minutes). The next visitor waits while it starts again (often tens of seconds up to about a
  minute), and if Neon also suspended, a few more seconds. The app retries database connects and returns
  `503` + `Retry-After` if it's still unavailable.
- **Limited compute** (a fraction of a CPU, about 512 MB RAM). Image processing is serialized (one image
  at a time, 24-megapixel cap), JSON bodies are capped at 100 KB (25 MB only for the authenticated admin
  import), uploads at 5 MB.
- **Monthly free instance hours are capped** per workspace. If they run out, the service is suspended
  until the next month.
- **Ephemeral filesystem.** Anything written to disk vanishes on deploy/restart/spin-down. The app writes
  nothing important to disk in production (uploads → R2, data → Neon).
- **Single instance.** Rate limits, the brief forum-list cache and view-count de-duplication are
  in-memory and reset on restart/spin-down. That's acceptable for hobby use.
- **Hobby use, no guarantee.** Render describes free instances as for testing and hobby projects. There is
  no uptime SLA, deploys may be slower, and the free tier can change. This is not production-grade hosting
  for a large or business-critical community.
- **Neon free:** limited storage and compute hours per month; watch usage in the Neon dashboard.
- **Resend free:** limited emails per day and month and one domain. Registration spikes can hit the limit;
  failures are logged and users can resend.
- **R2:** deleted posts don't delete their images (no orphan-cleanup job yet).
- **Presigned-URL expiry** is enforced by R2 itself. Automated tests verify the signature parameters
  against an S3 emulator and verify expiry for local signed URLs. Check R2 expiry once after deploying
  (smoke test S9).
- **Turnstile** needs the browser to reach `challenges.cloudflare.com`; strict blockers may prevent signup.
  The error message says so.
- **Search** uses PostgreSQL full-text search; fine for a young community.

## 15a. Staying at $0 (avoiding accidental charges)
- **Render:** use only the **Free** instance type for the one web service. Do not create Render
  PostgreSQL, Key Value/Redis, disks, cron jobs, background workers or additional services. Don't upgrade
  the workspace plan. `render.yaml` pins `plan: free` and defines nothing else. If Render asks for a payment
  method, the free instance still costs $0, but review every "Create"/"Upgrade" screen for a price before
  confirming. Check the Billing page after setup.
- **Neon:** stay on the Free plan; don't add a payment method unless you mean to. Keep the default
  scale-to-zero. The free plan stops at its limits instead of billing you.
- **Cloudflare R2:** R2 requires a payment method, and usage *above* the monthly free allowance
  (storage, Class A/B operations) is billed. Use the **Standard** storage class only (Infrequent Access
  has retrieval fees and is not covered the same way), keep the bucket private, and enable **billing
  notifications** in the Cloudflare dashboard. Image sizes are capped (5 MB upload, re-encoded WebP) and
  presigned URLs are short-lived, so normal forum use stays far below the allowance. Check the R2 usage
  graph monthly.
- **Resend:** stay on the Free plan. Sending stops at the limit rather than billing you.
- **Turnstile, Cloudflare DNS, GitHub Actions (public repository):** free.

## 16. Deployment smoke-test checklist (run against the live site)

**Guest**
- [ ] G1 Homepage loads over `https://YOURDOMAIN`.
- [ ] G2 Forum list, a forum, a thread, search, and the member directory load.
- [ ] G3 Private Ratings is not visible, and its thread URLs show "not found".
- [ ] G4 Registration page shows the Turnstile widget.
- [ ] G5 After 20+ minutes idle, the first request wakes the site (slow once), then pages are fast again.

**Member** (use a real inbox)
- [ ] M1 Register → verification email arrives (check spam) → link points at `https://YOURDOMAIN` and verifies.
- [ ] M2 Log out, log in, "Forgot password" email arrives and works; old sessions are logged out.
- [ ] M3 Edit profile; upload an avatar; it still shows after a Render **Manual Deploy** (proves R2
      persistence on an ephemeral filesystem).
- [ ] M4 Create a thread, reply, react, give rep, vote in a poll, bookmark, watch.
- [ ] M5 Send a private message to a second account (second browser); the notification appears.
- [ ] M6 Post an image in Private Ratings. A logged-out browser gets 404 for the `/media/…` URL.

**Moderator** (promote a test account)
- [ ] D1 Report a post → it appears in the report queue → resolve it.
- [ ] D2 Lock/pin/move a thread; warn and suspend a test member; the member can read but not post.
- [ ] D3 Moderation log shows every action.

**Admin**
- [ ] A1 Dashboard, members, roles & permissions, forums, settings all load; edit a forum.
- [ ] A2 `ADMIN_CLAIM_TOKEN` has been deleted from Render and the service redeployed; submitting any token at
      `/#/claim-admin` is now refused.
- [ ] A3 Admin access survives a redeploy (the role is stored in the database).

**Security**
- [ ] S1 `curl -si https://YOURDOMAIN/api/admin/stats` → 401. Logged in as a member → 403.
- [ ] S2 Opening another user's conversation URL → not found.
- [ ] S3 Response headers include CSP, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`.
- [ ] S4 The session cookie is `__Host-pp_session` with `HttpOnly; Secure; SameSite=Lax` (browser devtools).
- [ ] S5 A POST without the `X-CSRF-Token` header (e.g. via curl with your cookie) → 403.
- [ ] S6 More than 5 password-reset requests in an hour from one IP → 429.
- [ ] S7 `https://YOURDOMAIN/health` → `{"status":"ok"}`; `/ready` → `{"status":"ready"}`.
- [ ] S8 A backup was taken (`npm run db:backup` or the workflow) and restored into a test database.
- [ ] S9 Copy an image's signed R2 URL (from the redirect), wait > `MEDIA_URL_TTL_SECONDS`, open it again → access denied.
- [ ] S10 The R2 bucket has no public access (Cloudflare → R2 → bucket → Settings).

**VIP** (with test/sandbox payment keys)
- [ ] V1 Logged out, click 👑 VIP → the login page (no prices shown); after login you land on the VIP page.
- [ ] V2 Buy VIP with a test card → after returning, the membership is active, VIP Supporters appears, the username color shows.
- [ ] V3 Stripe → Webhooks shows successful (200) deliveries; a test refund removes the membership.
- [ ] V4 Gift a package to a second account → it activates for them only after payment and they get an alert.
- [ ] V5 A member without VIP gets 404 for `/#/forums/f-vip`.

**Domain**
- [ ] N1 `https://YOURDOMAIN` and `https://www.YOURDOMAIN` both have valid certificates.
- [ ] N2 The non-canonical hostname and `https://<service>.onrender.com/x` 301-redirect to `https://YOURDOMAIN/x`.
- [ ] N3 `http://YOURDOMAIN` redirects to `https://`.
- [ ] N4 Resend still shows the domain as verified (email DNS records untouched and DNS only).
- [ ] N5 Turnstile works on `YOURDOMAIN` and `www` (no "invalid domain" error).

---

## 17. Account and age policy (as implemented)
- **Requirement:** members must be 18 or older (Rule 1, Terms).
- **How it's collected:** a date of birth field at registration. The server rejects dates under 18 years
  and stores the date in `profiles.birthday`. Other members only ever see the month and day.
- **What it is not:** this is **self-attestation**. Nothing verifies the date or the person's identity. A
  minor can lie about their birthdate, so it does not meet any legal "age verification" standard. Real age
  assurance requires a third-party verification provider (not included).
- Accounts also need a verified email address before posting (in production), one account per person per
  the rules (not technically enforced), and can be deleted by the member (anonymised; posts remain as
  "Deleted member").

## 18. Content moderation policy status
The automatic safety flagger (`server/lib/safety.js`) currently auto-reports posts containing a fixed list
of terms, including eating-disorder terms such as "pro-ana" and "thinspo", to the moderator queue, and
shows support resources for crisis language. It never blocks or removes posts. The rules page describes
this behaviour accurately. A requested change to stop auto-flagging eating-disorder terminology **has not
been applied** in this repository.

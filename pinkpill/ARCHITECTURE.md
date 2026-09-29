# PinkPill — Architecture

This document covers (1) an audit of the original browser-only prototype and
(2) the architecture of the real multi-user application that replaces it.

---

## 1. Audit of the prototype (as of commit `567b416`)

### 1.1 Structure

| File | Role |
|---|---|
| `index.html` | Shell: header, nav, `#app` mount, footer, toasts. Loads 5 scripts in order. |
| `css/style.css` | All styling. CSS variables, light/dark themes, responsive breakpoints at 1000px/760px. |
| `js/util.js` | `esc`, time formatting, BBCode → HTML (escape-first whitelist parser), `readImage` (canvas → JPEG data URL). |
| `js/store.js` | **The entire "backend"**: seed data, schema-less JSON DB in `localStorage['pinkpill.db.v1']`, session in `localStorage['pinkpill.session']`, all business rules, v1→v3 migrations. |
| `js/ui.js` | Avatars, usernames, BBCode editor (toolbar, emoji, upload, preview, drafts), modals, toasts, crisis modal, member hover cards. |
| `js/views.js` | Every page, synchronous, reading `store.db` directly. |
| `js/app.js` | Hash router, header/user bar/menus, delegated click (`data-act`) and submit (`data-form`) handlers. |

### 1.2 Entities stored in localStorage

`users` (with embedded followers/following/ignoring/bookmarks/watched/trophies/readMarks/warnings/settings),
`categories`, `forums` (with `parentId`, `staffOnly`, `membersOnly`, `rating`, `notice`),
`threads` (with embedded `tags`, `watchers`, `poll{question,multiple,closes,options[{text,votes[]}]}`),
`posts` (with embedded `reactions{userId:type}`, `history[]`, `rating`, soft-delete fields),
`reps`, `profilePosts` (embedded `reactions`, `comments[]`), `conversations` (embedded `participants`,
`messages[]`, `readBy`, `starred`, `left`), `alerts`, `reports`, `settings`.

Other keys: `pinkpill.session` (user id — trivially forgeable), `pinkpill.theme`, `pinkpill.draft.*`,
`sessionStorage['pinkpill.notified']`.

### 1.3 Roles / permissions
`member`, `mod`, `admin` as a string on the user object; `isStaff = admin || mod`. All checks client-side.
Staff-only posting forums; members-only forums hidden from guests; only admins change roles/forums/data.

### 1.4 Forum structure
Information (News†, Announcements†) · Looksmaxxing (Looksmaxxing → Skincare, Hair/Brows/Lashes, Makeup,
Fitness, Body, Nutrition & Health, Facial Aesthetics, Style & Fashion, Cosmetic Procedures; Looksmaxxing
Questions) · Rating (Rating → Private Ratings‡) · Community (Introductions, Situations & Dating Advice,
Glow-Ups & Success Stories, Mental Health & Confidence, Site Feedback) · Off-Topic.
† staff-only posting ‡ members only, rating enabled.

### 1.5 Profile fields
username, email, avatar (data URL), letter-avatar colour, banner (data URL), custom title, bio, location,
website, birthday, signature, join date, last seen, current activity; privacy (show online, who may DM,
who may post on profile); preferences (theme, show signatures, auto-watch, desktop notifications).

### 1.6 Feature inventory
- **Forum:** categories, nested sub-forums, thread list with prefixes/sort/filter/unread, sticky/locked,
  pagination (20/page), tags, view counts, similar threads, read tracking, mark read.
- **Posts:** BBCode editor, image upload (data URL), quote & multi-quote, edit with reason + history,
  soft delete/undelete, share link, bookmarks, signatures, ignored-user collapsing.
- **Reactions:** 7 types, reaction score. **Reputation:** ±rep per post, rep power, 10/day, negative needs 10
  posts + comment, levels, trophies. **Ratings:** opt-in 1–10 per thread, one per member, distribution.
- **Polls:** single/multi choice, optional close date, change vote, results.
- **Profiles:** profile posts + comments + reactions, activity, postings, about, reputation, trophies,
  followers/following, staff-only warnings tab; follow, ignore, DM.
- **Messaging:** conversations with multiple participants, invites, star, leave, unread state, quote.
- **Notifications:** reply (watchers), mention, quote, reaction, rep, follow, followed-user new thread,
  profile post/comment, conversation, trophy, report (to staff), report resolved, warning, welcome.
- **Search:** keyword/member/forum/type/titles-only/relevance; tags; what's new, activity, news feed.
- **Moderation:** reports (user + automatic safety filter), resolve, delete post, warn (points), ban,
  lock/stick/move/delete threads, user groups. **Admin:** forum/category CRUD, stats, export/import/reset.
- **Safety:** danger-term auto-report, crisis-term support modal.

### 1.7 Problems
Everything above is enforced only in the visitor's browser: data is not shared, any visitor can become an
admin by editing `localStorage`, passwords are hashed with unsalted-per-server SHA-256 in the browser,
images consume the ~5 MB quota, there are no sessions, email, resets, or server-side moderation.

---

## 2. Target architecture

### 2.1 Stack (all open source, $0)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 22** | Requested; native `fetch`, `node:test`, `process.loadEnvFile`. |
| HTTP | **Express 5** | Mature, async error propagation in v5. |
| Database | **PostgreSQL 16** (`pg` driver) | Requested; FKs, constraints, full-text search, `citext`. |
| Migrations | Plain SQL files + small runner (`server/db/migrate.js`), tracked in `schema_migrations` | Transparent, no ORM lock-in. |
| Validation | **zod** | Declarative server-side schemas for every body/query. |
| Passwords | **argon2** (Argon2id) | OWASP-recommended. |
| Sessions | Opaque random tokens (`crypto.randomBytes`) in an HttpOnly cookie; SHA-256 of the token stored in `sessions` | Revocable, no JWT pitfalls. |
| Security headers | **helmet** (strict CSP) | |
| Rate limiting | **express-rate-limit** + per-account login lockout + per-user post flood control | |
| Uploads | **multer** (memory, size-capped) → **sharp** (decode, strip metadata, resize, re-encode to WebP) | Re-encoding defeats polyglots/executables. |
| Object storage | Driver interface: `local` (disk outside web root) or `s3` (any S3-compatible, e.g. Cloudflare R2 free tier) | Portable. |
| Email | **nodemailer** (SMTP) or `console` transport in development | Any free SMTP (Brevo, Mailjet free tiers, self-hosted). |
| Tests | `node:test` + **supertest** (API), **Playwright** (E2E) | |
| Frontend | The existing vanilla-JS SPA, served by the same Express app | Same origin → simple, safe cookies. |

### 2.2 Layout

```
pinkpill/
  public/              existing frontend (index.html, css/, js/)
  server/
    index.js           boot (loads env, runs server)
    app.js             express app factory (used by tests)
    config.js          env → config (validated)
    db/                pool, migrate runner, migrations/*.sql, seed.js
    lib/               auth, permissions, csrf, mailer, storage, bbcode-safety, trophies, notify, audit
    routes/            auth, account, forums, threads, posts, members, conversations, notifications,
                       search, uploads, reports, mod, admin, widgets
    scripts/           create-admin, import-localstorage
  test/                API tests (node:test + supertest)
  e2e/                 Playwright specs
```

### 2.3 Database schema (summary — authoritative source: `server/db/migrations/*.sql`)

- `roles(id, title, rank)`; `role_permissions(role_id, permission)`; `users.role_id → roles`.
  One role per user (the prototype's model), permissions editable per role by admins.
- `users(id, username citext unique, email citext unique, password_hash, role_id, status
  [unverified|active|deleted], email_verified_at, failed_logins, locked_until, read_all_at,
  last_seen_at, activity, created_at, updated_at)`
- `profiles(user_id PK/FK, custom_title, bio, location, website, birthday, signature,
  avatar_id → attachments, banner_id → attachments, avatar_color)`
- `user_preferences(user_id PK/FK, theme, show_online, allow_dms, allow_profile_posts,
  show_signatures, auto_watch)`
- `sessions(id = sha256(token), user_id, csrf_token, created_at, expires_at, last_used_at, ip, user_agent)`
- `email_verifications`, `password_resets` (hashed single-use tokens with expiry)
- `categories(id slug, title, position)`; `forums(id slug, category_id, parent_id self-FK, title,
  description, icon, position, staff_only, members_only, rating_enabled, notice)`
- `threads(id, forum_id, author_id, title, prefix, sticky, locked, rating_enabled, view_count,
  reply_count, first_post_id, last_post_id, last_post_at, deleted_at, deleted_by, created_at)`
  + `thread_tags(thread_id, tag)`
- `posts(id, thread_id, author_id, content, rating 1–10, edited_*, deleted_*, created_at,
  search tsvector GENERATED + GIN)` + `post_revisions`
  unique partial index: one rating per (thread, author).
- `reactions(post_id, user_id, reaction)` PK(post_id,user_id); `profile_post_reactions` likewise.
- `reputation(id, post_id, giver_id, receiver_id, value, comment)` UNIQUE(post_id, giver_id),
  CHECK(giver ≠ receiver). Value computed on the server from the giver's rep power.
- `polls(id, thread_id unique, question, allow_multiple, closes_at)`, `poll_options`,
  `poll_votes(option_id, user_id)` PK + `poll_id` column for per-poll uniqueness logic.
- `thread_watches`, `thread_reads`, `bookmarks`, `follows`, `ignores` (composite PKs, CHECK self ≠ other).
- `profile_posts`, `profile_post_comments`.
- `conversations`, `conversation_participants(conversation_id, user_id, last_read_at, starred,
  left_at)`, `conversation_messages`.
- `notifications(id, user_id, actor_id, type, text, link, created_at, read_at)`.
- `reports(id, reporter_id NULL=system, content_type, content_id, reason, status, resolved_*)`.
- `bans(id, user_id, banned_by, reason, expires_at NULL=permanent, lifted_at, lifted_by)` —
  a suspension is a ban with `expires_at`.
- `warnings(id, user_id, issued_by, reason, points)`.
- `audit_log(id, actor_id, action, target_type, target_id, details jsonb, ip, created_at)` —
  every moderation/admin action.
- `attachments(id uuid, owner_id, purpose, storage_key, mime, bytes, width, height, sha256)`.
- `user_trophies(user_id, trophy_id, awarded_at)`.
- `site_settings(key, value jsonb)`.

All tables have FKs with explicit `ON DELETE` behaviour, timestamps, and indexes on every FK and
listing sort key (e.g. `threads(forum_id, sticky, last_post_at)`).

### 2.4 API
REST under `/api`, JSON only. Consistent errors: `{ "error": { "code": "forbidden", "message": "…",
"fields"?: {...} } }` with 400/401/403/404/409/413/415/422/429/500. Full route list: README.md.

Middleware order: helmet → rate limit → json (100 kB cap) → cookie parse → `loadSession`
(resolves user + role + permissions + active ban from the DB on every request) → `csrf`
(unsafe methods) → routes → error handler.

### 2.5 Authentication
- Register: zod validation, 18+ check, honeypot field, IP rate limit, Argon2id hash, account `unverified`,
  verification email with a random 32-byte token (only its SHA-256 is stored, 48h expiry).
- Login: generic error message, per-IP rate limit, per-account lockout (10 failures → 15 min),
  session rotation (new token every login), `pp_session` cookie: HttpOnly, SameSite=Lax,
  Secure in production, 30-day sliding expiry (or browser-session when "stay logged in" is off).
- Logout deletes the session row. Password change/reset revokes all other sessions.
- Password reset: always responds 200 (no account enumeration), 1h single-use token.
- Unverified accounts can log in and browse but have no posting permissions until verified
  (`REQUIRE_EMAIL_VERIFICATION=true`).

### 2.6 CSRF
SameSite=Lax cookie + synchronizer token: `GET /api/auth/session` returns the session's CSRF token;
every unsafe request must send it as `X-CSRF-Token`. Anonymous unsafe requests (login/register/reset)
require a JSON content type (which cross-site forms cannot send without a CORS preflight) and a matching
`Origin`/`Referer` when present.

### 2.7 Authorization
Permission strings checked by `requirePermission('thread.create')` middleware and by service-level
checks for ownership/visibility (IDOR). Role ranks prevent a moderator acting on an admin, and prevent
anyone granting a role at or above their own rank (only `super_admin` can make admins). Banned or
suspended users keep read access but lose every write permission. Visibility rules (members-only forums,
deleted content, private conversations) are applied inside SQL queries, never after the fact in the browser.

| Permission | member | moderator | admin | super_admin |
|---|:-:|:-:|:-:|:-:|
| thread.create, post.reply, post.edit_own, post.delete_own, post.react, rep.give, poll.create, poll.vote, conversation.start, upload.image, report.create, profile_post.create | ✓ | ✓ | ✓ | ✓ |
| rep.give_negative (plus ≥10 posts for members) | ✓ | ✓ | ✓ | ✓ |
| mod.view_reports, mod.edit_any, mod.delete_any, mod.view_deleted, mod.lock, mod.sticky, mod.move, mod.warn, mod.ban, mod.view_log, forum.post_staff_only | | ✓ | ✓ | ✓ |
| admin.users, admin.forums, admin.settings, admin.stats, admin.import | | | ✓ | ✓ |
| admin.permissions | | | | ✓ |

### 2.8 Files
`POST /api/uploads` (auth, CSRF, `upload.image`, 5 MB, one file). Accepts JPEG/PNG/GIF/WebP by
**decoding with sharp** (not by extension or MIME header), auto-rotates, strips metadata, resizes by purpose
(avatar 256², banner 1500×500, post ≤1600px), re-encodes to WebP, stores under a random UUID key
(no user-supplied filenames touch the filesystem). Served by `GET /media/:uuid` which looks the key up
in the DB and sends `Content-Type: image/webp`, `nosniff`, `Content-Security-Policy: default-src 'none'`.
Post content may only embed `https://` or `/media/<uuid>` images; `data:` URIs are rejected.

### 2.9 Migration from localStorage
`npm run import:localstorage -- backup.json` (and `POST /api/admin/import`, admin only) maps the
prototype's JSON export (Admin → Data → Export) onto the schema: users (imported without passwords —
they must use password reset), forums, threads, posts (+revisions), reactions, reputation, polls/votes,
profile posts, conversations, follows/bookmarks/watches, reports, warnings. Data-URL images are
decoded and re-stored through the upload pipeline. The browser no longer stores forum data; only the
theme, drafts and UI state stay in localStorage.

### 2.10 Deployment ($0, portable)
One Node process serves `public/` and `/api`; it needs `DATABASE_URL`, `SESSION_SECRET`-free
(sessions are DB-backed), `APP_URL`, SMTP and storage settings (see `.env.example`).
Options: any free Node host + a free managed Postgres (e.g. Neon), or one always-free VM running
`docker compose up` (app + Postgres + volume). `Dockerfile` and `docker-compose.yml` are provided.
Nothing is provider-specific; the domain comes from `APP_URL`.

### 2.11 Security strategy
Parameterised SQL only; JSON-only API (no server-rendered HTML); the frontend escapes before BBCode
parsing and only allows whitelisted tags and `https:`/`/media/`/`#/` URLs; strict CSP (`script-src 'self'`);
zod `.strict()` schemas reject unknown keys (parameter tampering / prototype pollution); body size caps;
IDs validated as integers/UUIDs; no user input in file paths; rate limits on auth, registration, posting,
DMs, reports, uploads; audit log for privileged actions; secrets only in environment variables.

### 2.12 Testing strategy
- API tests against a real PostgreSQL test database (`DATABASE_URL_TEST`), schema reset per run:
  auth, sessions, CSRF, authorization matrix, IDOR, forum CRUD, reputation, polls, messaging,
  moderation/audit, uploads, malformed input, SQL-injection and XSS payloads, rate limits.
- Playwright E2E: two independent browser contexts register, post, reply and message each other;
  privilege-escalation attempt via devtools-style `fetch` fails.

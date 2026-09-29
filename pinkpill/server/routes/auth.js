'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { z, parse, username, password } = require('../lib/validate');
const { hashPassword, verifyPassword, dummyVerify, randomToken, sha256, safeEqual } = require('../lib/crypto');
const { createSession, destroySession, revokeOtherSessions } = require('../lib/session');
const { requireUser } = require('../lib/permissions');
const { badRequest, unauthorized, forbidden, conflict, tooMany } = require('../lib/errors');
const turnstile = require('../lib/turnstile');
const mailer = require('../lib/mailer');
const settings = require('../lib/settings');
const limits = require('../lib/limits');
const { notify } = require('../lib/notify');
const { mePayload } = require('../lib/me');

const router = express.Router();
const MAX_FAILED = 10, LOCK_MINUTES = 15;
const COLORS = ['#ec4899', '#a855f7', '#f43f5e', '#db2777', '#c026d3'];

router.get('/session', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: await mePayload(req.user), csrfToken: req.csrfToken, requireEmailVerification: config.requireEmailVerification, turnstile: { siteKey: config.turnstile.siteKey || null, onLogin: !!config.turnstile.siteKey && config.turnstile.onLogin } });
});

const registerSchema = z.object({
  username,
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(254),
  password,
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter your date of birth.'),
  agree: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms and rules.' }) }),
  website: z.string().max(0).optional(),   // honeypot: real users never fill this hidden field
  turnstileToken: z.string().max(2048).optional(),
}).strict();

function isAdult(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const adultAt = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
  return adultAt <= now && d.getUTCFullYear() > 1900;
}

async function issueVerification(q, user) {
  const token = randomToken(32);
  await q.query(`INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES ($1, $2, $3, now() + interval '48 hours')`,
    [sha256(token), user.id, user.email]);
  return token;
}

router.post('/register', limits.register, async (req, res) => {
  await turnstile.require(req);
  if (!(await settings.get('registration_open', true))) throw forbidden('Registration is currently closed.');
  const d = parse(registerSchema, req.body);
  if (!isAdult(d.birthday)) throw forbidden('You must be 18 or older to join PinkPill.');
  const hash = await hashPassword(d.password);
  let user, token;
  try {
    ({ user, token } = await db.tx(async (q) => {
      const u = await q.one(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email`,
        [d.username, d.email, hash]);
      await q.query('INSERT INTO profiles (user_id, birthday, avatar_color) VALUES ($1, $2, $3)', [u.id, d.birthday, COLORS[Math.floor(Math.random() * COLORS.length)]]);
      await q.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [u.id]);
      await notify(q, { userId: u.id, type: 'welcome', text: 'Welcome to PinkPill! Start by introducing yourself.', link: '#/forums/f-intro' });
      return { user: u, token: await issueVerification(q, u) };
    }));
  } catch (err) {
    if (err.code === '23505') throw conflict(/email/.test(err.constraint || '') ? 'An account with that email already exists.' : 'That username is taken.');
    throw err;
  }
  const emailSent = await mailer.sendVerification(user.email, user.username, token);
  const csrfToken = await createSession(req, res, user.id, true);
  res.status(201).json({ csrfToken, emailVerificationRequired: config.requireEmailVerification, emailSent });
});

const loginSchema = z.object({
  login: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
  stay: z.boolean().optional(),
  turnstileToken: z.string().max(2048).optional(),
}).strict();

router.post('/login', limits.login, async (req, res) => {
  if (config.turnstile.onLogin) await turnstile.require(req);
  const d = parse(loginSchema, req.body);
  const u = await db.one(`SELECT id, password_hash, status, failed_logins, locked_until FROM users
    WHERE (username = $1 OR email = $1) AND status <> 'deleted'`, [d.login]);
  if (!u) { await dummyVerify(d.password); throw unauthorized('Incorrect username/email or password.'); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw unauthorized(`Too many failed attempts. This account is locked for ${LOCK_MINUTES} minutes.`);
  }
  if (!(await verifyPassword(u.password_hash, d.password))) {
    await db.query(`UPDATE users SET
      locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END,
      failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END WHERE id = $1`, [u.id, MAX_FAILED, String(LOCK_MINUTES)]);
    throw unauthorized('Incorrect username/email or password.');
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = now() WHERE id = $1', [u.id]);
  const csrfToken = await createSession(req, res, u.id, d.stay !== false);
  res.json({ csrfToken });
});

/* Bootstrap the first super administrator on hosts without a shell. Requires the ADMIN_CLAIM_TOKEN
   secret, a logged-in account, and that no super administrator exists yet. */
router.post('/claim-admin', requireUser, limits.login, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(1).max(200) }).strict(), req.body);
  if (!config.adminClaimToken || !safeEqual(token, config.adminClaimToken)) throw forbidden('Invalid claim token.');
  const done = await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['claim-admin']);
    if (await q.one(`SELECT 1 FROM users WHERE role_id = 'super_admin' AND status <> 'deleted'`)) return false;
    await q.query(`UPDATE users SET role_id = 'super_admin', status = 'active', email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`, [req.user.id]);
    await q.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id, ip) VALUES ($1, 'admin.claimed', 'user', $2, $3)`, [req.user.id, String(req.user.id), req.ip || null]);
    return true;
  });
  if (!done) throw forbidden('A super administrator already exists.');
  require('../lib/permissions').invalidateRoles();
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

router.post('/verify-email', limits.verifyEmail, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(100) }).strict(), req.body);
  const ok = await db.tx(async (q) => {
    const row = await q.one(`UPDATE email_verifications SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, email`, [sha256(token)]);
    if (!row) return false;
    const r = await q.query(`UPDATE users SET status = 'active', email_verified_at = now(), updated_at = now()
      WHERE id = $1 AND email = $2 AND status <> 'deleted'`, [row.user_id, row.email]);
    return r.rowCount === 1;
  });
  if (!ok) throw badRequest('This verification link is invalid or has expired.');
  res.json({ ok: true });
});

router.post('/resend-verification', requireUser, limits.verification, async (req, res) => {
  const u = await db.one('SELECT id, username, email, status FROM users WHERE id = $1', [req.user.id]);
  if (u.status === 'active') throw badRequest('Your email is already verified.');
  const token = await issueVerification(db, u);
  if (!(await mailer.sendVerification(u.email, u.username, token))) throw tooMany('We couldn\'t send another email right now. Please try again later.');
  res.json({ ok: true });
});

router.post('/password-reset/request', limits.passwordReset, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), turnstileToken: z.string().max(2048).optional() }).strict(), req.body);
  await turnstile.require(req);
  const u = await db.one(`SELECT id, username, email FROM users WHERE email = $1 AND status <> 'deleted'`, [email]);
  if (u) {
    const token = randomToken(32);
    await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha256(token), u.id]);
    await mailer.sendPasswordReset(u.email, u.username, token);
  }
  // Same response either way, so this endpoint can't be used to discover accounts.
  res.json({ ok: true, message: 'If an account uses that email, a reset link has been sent.' });
});

router.post('/password-reset/confirm', limits.passwordReset, async (req, res) => {
  const d = parse(z.object({ token: z.string().min(10).max(100), password }).strict(), req.body);
  const hash = await hashPassword(d.password);
  const userId = await db.tx(async (q) => {
    const row = await q.one(`UPDATE password_resets SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(d.token)]);
    if (!row) return null;
    // Completing a reset proves control of the email address, so it also verifies it.
    await q.query(`UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now(),
      status = CASE WHEN status = 'unverified' THEN 'active' ELSE status END, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`, [row.user_id, hash]);
    await q.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
    return row.user_id;
  });
  if (!userId) throw badRequest('This reset link is invalid or has expired.');
  await revokeOtherSessions(userId, null);
  const who = await db.one('SELECT username, email FROM users WHERE id = $1', [userId]);
  if (who && who.email) await mailer.sendPasswordChanged(who.email, who.username);
  res.json({ ok: true });
});

module.exports = router;

'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, password } = require('../lib/validate');
const { hashPassword, verifyPassword } = require('../lib/crypto');
const { requireUser } = require('../lib/permissions');
const { revokeOtherSessions, destroySession } = require('../lib/session');
const { badRequest, conflict, forbidden } = require('../lib/errors');
const { mePayload } = require('../lib/me');
const { assertSafeContent } = require('../lib/content');

const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => { res.json({ user: await mePayload(req.user) }); });

router.patch('/email', async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) }).strict(), req.body);
  const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(u.password_hash, d.password))) throw forbidden('Your current password is incorrect.');
  try {
    // Changing email requires re-verification.
    await db.query(`UPDATE users SET email = $2, status = CASE WHEN email = $2 THEN status ELSE 'unverified' END,
      email_verified_at = CASE WHEN email = $2 THEN email_verified_at ELSE NULL END, updated_at = now() WHERE id = $1`, [req.user.id, d.email]);
  } catch (e) { if (e.code === '23505') throw conflict('That email is already in use.'); throw e; }
  res.json({ user: await mePayload(req.user) });
});

router.post('/password', async (req, res) => {
  const d = parse(z.object({ current: z.string().min(1).max(200), new: password }).strict(), req.body);
  const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(u.password_hash, d.current))) throw forbidden('Your current password is incorrect.');
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await hashPassword(d.new)]);
  await revokeOtherSessions(req.user.id, req.sessionId);
  const who = await db.one('SELECT username, email FROM users WHERE id = $1', [req.user.id]);
  if (who && who.email) await require('../lib/mailer').sendPasswordChanged(who.email, who.username);
  res.json({ ok: true });
});

const uuid = z.string().uuid();
const profileSchema = z.object({
  customTitle: z.string().trim().max(50),
  location: z.string().trim().max(50),
  website: z.union([z.literal(''), z.string().trim().url().max(200).refine((u) => /^https?:\/\//i.test(u), 'Website must start with http(s)://')]),
  birthday: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  bio: z.string().max(5000),
  signature: z.string().max(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatarId: uuid.nullable(),
  bannerId: uuid.nullable(),
}).partial().strict();

router.patch('/profile', async (req, res) => {
  const d = parse(profileSchema, req.body);
  if (d.bio) assertSafeContent(d.bio);
  if (d.signature) assertSafeContent(d.signature);
  // Staff-set custom titles are fine; members can't impersonate staff titles.
  if (d.customTitle && !req.user.isStaff && /\b(admin|administrator|moderator|mod|staff|founder)\b/i.test(d.customTitle)) {
    throw badRequest('That custom title is reserved for staff.');
  }
  for (const [key, purpose] of [['avatarId', 'avatar'], ['bannerId', 'banner']]) {
    if (d[key]) {
      const a = await db.one('SELECT owner_id, purpose FROM attachments WHERE id = $1', [d[key]]);
      if (!a || String(a.owner_id) !== String(req.user.id) || a.purpose !== purpose) throw forbidden('You can only use your own uploaded ' + purpose + '.');
    }
  }
  const map = { customTitle: 'custom_title', location: 'location', website: 'website', bio: 'bio', signature: 'signature', color: 'avatar_color', avatarId: 'avatar_id', bannerId: 'banner_id', birthday: 'birthday' };
  const sets = [], vals = [req.user.id];
  for (const [k, col] of Object.entries(map)) {
    if (!(k in d)) continue;
    vals.push(k === 'birthday' && d[k] === '' ? null : d[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length) await db.query(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = $1`, vals);
  if ('bio' in d || 'signature' in d) {
    const pr = await db.one('SELECT bio, signature FROM profiles WHERE user_id = $1', [req.user.id]);
    await require('../lib/attachments').syncRefs(db, 'profile', req.user.id, pr.bio + ' ' + pr.signature, req.user.id);
  }
  res.json({ user: await mePayload(req.user) });
});

const prefsSchema = z.object({
  theme: z.enum(['auto', 'light', 'dark']),
  showOnline: z.boolean(),
  allowDms: z.enum(['everyone', 'followed', 'none']),
  allowProfilePosts: z.enum(['everyone', 'followed', 'none']),
  showSignatures: z.boolean(),
  autoWatch: z.boolean(),
}).partial().strict();

router.patch('/preferences', async (req, res) => {
  const d = parse(prefsSchema, req.body);
  const map = { theme: 'theme', showOnline: 'show_online', allowDms: 'allow_dms', allowProfilePosts: 'allow_profile_posts', showSignatures: 'show_signatures', autoWatch: 'auto_watch' };
  const sets = [], vals = [req.user.id];
  for (const [k, col] of Object.entries(map)) if (k in d) { vals.push(d[k]); sets.push(`${col} = $${vals.length}`); }
  if (sets.length) await db.query(`UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = $1`, vals);
  res.json({ user: await mePayload(req.user) });
});

router.get('/sessions', async (req, res) => {
  const rows = await db.many('SELECT id, created_at, last_used_at, ip::text AS ip, user_agent FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_used_at DESC', [req.user.id]);
  res.json({ sessions: rows.map((r) => ({ current: r.id === req.sessionId, createdAt: r.created_at, lastUsedAt: r.last_used_at, ip: r.ip, userAgent: r.user_agent })) });
});

router.post('/sessions/revoke-others', async (req, res) => {
  await revokeOtherSessions(req.user.id, req.sessionId);
  res.json({ ok: true });
});

/* GDPR-style export of the user's own data (no password hash / tokens). */
router.get('/export', async (req, res) => {
  const id = req.user.id;
  const data = {
    account: await mePayload(req.user),
    threads: await db.many('SELECT id, forum_id, title, created_at FROM threads WHERE author_id = $1', [id]),
    posts: await db.many('SELECT id, thread_id, content, created_at, edited_at FROM posts WHERE author_id = $1 AND deleted_at IS NULL', [id]),
    profilePosts: await db.many('SELECT id, profile_user_id, content, created_at FROM profile_posts WHERE author_id = $1', [id]),
    messages: await db.many('SELECT m.id, m.conversation_id, m.content, m.created_at FROM conversation_messages m WHERE m.author_id = $1', [id]),
    reputationGiven: await db.many('SELECT post_id, value, comment, created_at FROM reputation WHERE giver_id = $1', [id]),
  };
  res.set('Content-Disposition', 'attachment; filename="pinkpill-my-data.json"');
  res.json(data);
});

/* Account deletion: anonymises the user; their public posts remain as "Deleted member". */
router.delete('/', async (req, res) => {
  const d = parse(z.object({ password: z.string().min(1).max(200) }).strict(), req.body);
  const u = await db.one('SELECT password_hash, role_id FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(u.password_hash, d.password))) throw forbidden('Your password is incorrect.');
  if (u.role_id === 'super_admin') {
    const n = await db.one(`SELECT count(*)::int AS n FROM users WHERE role_id = 'super_admin' AND status <> 'deleted'`);
    if (n.n <= 1) throw forbidden('You are the only super administrator. Promote someone else first.');
  }
  await db.tx(async (q) => {
    await q.query(`UPDATE users SET username = 'deleted-' || id, email = NULL, password_hash = NULL, status = 'deleted', role_id = 'member', updated_at = now() WHERE id = $1`, [req.user.id]);
    await q.query(`UPDATE profiles SET custom_title = '', bio = '', location = '', website = '', birthday = NULL, signature = '', avatar_id = NULL, banner_id = NULL WHERE user_id = $1`, [req.user.id]);
    for (const t of ['follows WHERE follower_id = $1 OR followee_id = $1', 'ignores WHERE user_id = $1 OR ignored_id = $1', 'bookmarks WHERE user_id = $1', 'thread_watches WHERE user_id = $1', 'notifications WHERE user_id = $1', 'sessions WHERE user_id = $1']) {
      await q.query('DELETE FROM ' + t, [req.user.id]);
    }
  });
  await destroySession(req, res);
  res.json({ ok: true });
});

module.exports = router;

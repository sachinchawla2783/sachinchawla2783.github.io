'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam } = require('../lib/validate');
const { assertCan, can } = require('../lib/permissions');
const { summaries } = require('../lib/users');
const { forbidden, notFound, conflict } = require('../lib/errors');
const { notify } = require('../lib/notify');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(require('../lib/limits').admin);

/* Moderators may only act on members of strictly lower rank (a mod can't ban an admin). */
async function loadTarget(id, actor) {
  const t = await db.one(`SELECT u.id, u.username, u.status, u.role_id, r.rank FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [idParam(id)]);
  if (!t || t.status === 'deleted') throw notFound('Member not found.');
  if (String(t.id) === String(actor.id)) throw forbidden('You can\'t do that to yourself.');
  if (t.rank >= actor.rank) throw forbidden('You can\'t moderate a member of equal or higher rank.');
  return t;
}

/* ---------- reports ---------- */

router.get('/reports', async (req, res) => {
  assertCan(req.user, 'mod.view_reports');
  const { status } = parse(z.object({ status: z.enum(['open', 'resolved', 'rejected']).default('open') }).strip(), req.query);
  const rows = await db.many('SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 200', [status]);
  const out = [];
  const uids = [];
  for (const r of rows) {
    const item = { id: String(r.id), type: r.content_type, contentId: String(r.content_id), reason: r.reason, status: r.status, reporterId: r.reporter_id, at: r.created_at,
      resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, note: r.resolution_note, target: null };
    if (r.content_type === 'post') {
      const p = await db.one('SELECT p.id, p.author_id, p.content, p.deleted_at, t.id AS thread_id, t.title FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = $1', [r.content_id]);
      if (p) { item.target = { authorId: p.author_id, content: p.content.slice(0, 600), threadId: String(p.thread_id), threadTitle: p.title, deleted: !!p.deleted_at }; uids.push(p.author_id); }
    } else if (r.content_type === 'profile_post') {
      const p = await db.one('SELECT author_id, profile_user_id, content, deleted_at FROM profile_posts WHERE id = $1', [r.content_id]);
      if (p) { item.target = { authorId: p.author_id, profileUserId: p.profile_user_id, content: p.content.slice(0, 600), deleted: !!p.deleted_at }; uids.push(p.author_id); }
    } else if (r.content_type === 'message') {
      // Moderators see only the single reported message (the reporter chose to share it), not the conversation.
      const m = await db.one('SELECT author_id, content FROM conversation_messages WHERE id = $1', [r.content_id]);
      if (m) { item.target = { authorId: m.author_id, content: m.content.slice(0, 600) }; uids.push(m.author_id); }
    } else if (r.content_type === 'user') {
      item.target = { userId: String(r.content_id) }; uids.push(r.content_id);
    }
    uids.push(r.reporter_id, r.resolved_by);
    out.push(item);
  }
  res.json({ reports: out, users: await summaries(uids) });
});

router.post('/reports/:id/resolve', async (req, res) => {
  assertCan(req.user, 'mod.view_reports');
  const d = parse(z.object({ status: z.enum(['resolved', 'rejected']).default('resolved'), note: z.string().trim().max(500).optional() }).strict(), req.body);
  const r = await db.one('SELECT * FROM reports WHERE id = $1', [idParam(req.params.id)]);
  if (!r) throw notFound();
  if (r.status !== 'open') throw conflict('This report has already been handled.');
  await db.tx(async (q) => {
    await q.query('UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1', [r.id, d.status, req.user.id, d.note || '']);
    await audit(q, req, 'report.' + d.status, 'report', r.id, { note: d.note || '' });
    if (r.reporter_id) await notify(q, { userId: r.reporter_id, actorId: req.user.id, type: 'report-resolved', text: 'Your report has been reviewed. Thank you!', link: '#/alerts' });
  });
  res.json({ ok: true });
});

/* ---------- members ---------- */

router.get('/users', async (req, res) => {
  assertCan(req.user, 'mod.ban');
  const q = parse(z.object({ q: z.string().trim().max(24).default(''), filter: z.enum(['all', 'banned', 'warned', 'staff']).default('all'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strip(), req.query);
  const params = ['%' + q.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'];
  const filter = {
    all: 'true',
    banned: 'EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now()))',
    warned: 'EXISTS (SELECT 1 FROM warnings w WHERE w.user_id = u.id)',
    staff: 'r.is_staff',
  }[q.filter];
  const showEmail = can(req.user, 'admin.users');
  const rows = await db.many(`SELECT u.id, u.email, u.status, u.role_id, r.rank, u.created_at,
      (SELECT coalesce(sum(points), 0)::int FROM warnings WHERE user_id = u.id) AS warning_points,
      (SELECT json_build_object('reason', b.reason, 'expiresAt', b.expires_at) FROM bans b WHERE b.user_id = u.id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now()) ORDER BY b.created_at DESC LIMIT 1) AS ban
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.status <> 'deleted' AND u.username ILIKE $1 ESCAPE '\\' AND ${filter}
    ORDER BY u.created_at DESC LIMIT 50 OFFSET ${(q.page - 1) * 50}`, params);
  res.json({
    members: rows.map((r) => ({ userId: String(r.id), email: showEmail ? r.email : undefined, status: r.status, role: r.role_id, warningPoints: r.warning_points, ban: r.ban, joinedAt: r.created_at,
      canModerate: r.rank < req.user.rank && String(r.id) !== String(req.user.id) })),
    users: await summaries(rows.map((r) => r.id)),
  });
});

const banSchema = z.object({ reason: z.string().trim().min(1).max(300), days: z.number().int().min(1).max(3650).nullable().optional() }).strict();

router.post('/users/:id/ban', async (req, res) => {
  assertCan(req.user, 'mod.ban');
  const t = await loadTarget(req.params.id, req.user);
  const d = parse(banSchema, req.body);
  await db.tx(async (q) => {
    await q.query('UPDATE bans SET lifted_at = now(), lifted_by = $2 WHERE user_id = $1 AND lifted_at IS NULL', [t.id, req.user.id]);
    await q.query(`INSERT INTO bans (user_id, banned_by, reason, expires_at) VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)`,
      [t.id, req.user.id, d.reason, d.days || null]);
    await audit(q, req, d.days ? 'user.suspend' : 'user.ban', 'user', t.id, { username: t.username, reason: d.reason, days: d.days || null });
    await notify(q, { userId: t.id, actorId: null, type: 'moderation', text: (d.days ? `Your account has been suspended for ${d.days} day(s)` : 'Your account has been banned') + ': ' + d.reason, link: '#/alerts' });
  });
  res.json({ ok: true });
});

router.delete('/users/:id/ban', async (req, res) => {
  assertCan(req.user, 'mod.ban');
  const t = await loadTarget(req.params.id, req.user);
  await db.tx(async (q) => {
    const r = await q.query('UPDATE bans SET lifted_at = now(), lifted_by = $2 WHERE user_id = $1 AND lifted_at IS NULL', [t.id, req.user.id]);
    if (!r.rowCount) throw notFound('This member is not banned.');
    await audit(q, req, 'user.unban', 'user', t.id, { username: t.username });
    await notify(q, { userId: t.id, type: 'moderation', text: 'Your ban has been lifted. Welcome back!', link: '#/' });
  });
  res.json({ ok: true });
});

router.post('/users/:id/warn', async (req, res) => {
  assertCan(req.user, 'mod.warn');
  const t = await loadTarget(req.params.id, req.user);
  const d = parse(z.object({ reason: z.string().trim().min(1).max(300), points: z.number().int().min(1).max(10) }).strict(), req.body);
  await db.tx(async (q) => {
    await q.query('INSERT INTO warnings (user_id, issued_by, reason, points) VALUES ($1, $2, $3, $4)', [t.id, req.user.id, d.reason, d.points]);
    await audit(q, req, 'user.warn', 'user', t.id, { username: t.username, reason: d.reason, points: d.points });
    await notify(q, { userId: t.id, type: 'warning', text: 'You received a warning: ' + d.reason, link: '#/account/warnings' });
  });
  res.status(201).json({ ok: true });
});

router.get('/warnings', async (req, res) => {
  assertCan(req.user, 'mod.warn');
  const rows = await db.many('SELECT id, user_id, issued_by, reason, points, created_at FROM warnings ORDER BY created_at DESC LIMIT 200');
  res.json({ warnings: rows.map((w) => ({ id: String(w.id), userId: w.user_id, issuedBy: w.issued_by, reason: w.reason, points: w.points, at: w.created_at })), users: await summaries(rows.flatMap((w) => [w.user_id, w.issued_by])) });
});

/* ---------- moderation log ---------- */

router.get('/log', async (req, res) => {
  assertCan(req.user, 'mod.view_log');
  const q = parse(z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), action: z.string().regex(/^[a-z_.]{0,40}$/).default('') }).strip(), req.query);
  const params = [q.action ? q.action + '%' : '%'];
  const rows = await db.many(`SELECT id, actor_id, action, target_type, target_id, details, ip::text AS ip, created_at FROM audit_log
    WHERE action LIKE $1 ORDER BY created_at DESC, id DESC LIMIT 100 OFFSET ${(q.page - 1) * 100}`, params);
  const showIp = can(req.user, 'admin.users');
  res.json({
    entries: rows.map((r) => ({ id: String(r.id), actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, details: r.details, ip: showIp ? r.ip : undefined, at: r.created_at })),
    users: await summaries(rows.map((r) => r.actor_id)),
  });
});

module.exports = router;

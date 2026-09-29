'use strict';
const express = require('express');
const db = require('../db');
const { z, parse } = require('../lib/validate');
const { requireUser, can } = require('../lib/permissions');
const { summaries } = require('../lib/users');

const router = express.Router();

router.get('/notifications', requireUser, async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strip(), req.query);
  const rows = await db.many('SELECT id, actor_id, type, text, link, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [req.user.id, limit]);
  res.json({
    notifications: rows.map((n) => ({ id: String(n.id), actorId: n.actor_id, type: n.type, text: n.text, link: n.link, at: n.created_at, read: !!n.read_at })),
    users: await summaries(rows.map((n) => n.actor_id)),
  });
});

router.post('/notifications/read-all', requireUser, async (req, res) => {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
});

/* Badge counts for the header. */
router.get('/me/counts', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = await db.one(`SELECT
      (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS alerts,
      (SELECT count(*)::int FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
        WHERE cp.user_id = $1 AND cp.left_at IS NULL AND c.last_message_at > coalesce(cp.last_read_at, 'epoch')) AS conversations`, [req.user.id]);
  if (can(req.user, 'mod.view_reports')) r.reports = (await db.one(`SELECT count(*)::int AS n FROM reports WHERE status = 'open'`)).n;
  res.json(r);
});

module.exports = router;

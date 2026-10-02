'use strict';
const express = require('express');
const db = require('../db');
const { z, parse } = require('../lib/validate');
const { assertCan } = require('../lib/permissions');
const { notFound } = require('../lib/errors');
const { notify } = require('../lib/notify');
const limits = require('../lib/limits');
const T = require('../lib/threads');

const router = express.Router();

/* Users can only report things they can actually see. */
async function assertReportable(type, id, user) {
  if (type === 'post') { await T.loadPost(id, user); return; }
  if (type === 'profile_post') { if (!(await db.one('SELECT 1 FROM profile_posts WHERE id = $1 AND deleted_at IS NULL', [id]))) throw notFound(); return; }
  if (type === 'user') { if (!(await db.one("SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [id]))) throw notFound(); return; }
  if (type === 'message') {
    const ok = await db.one(`SELECT 1 FROM conversation_messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = $1 AND cp.user_id = $2 AND cp.left_at IS NULL`, [id, user.id]);
    if (!ok) throw notFound();
  }
}

router.post('/reports', limits.report, async (req, res) => {
  assertCan(req.user, 'report.create');
  const d = parse(z.object({
    type: z.enum(['post', 'profile_post', 'message', 'user']),
    id: z.string().regex(/^[1-9]\d{0,17}$/),
    reason: z.string().trim().min(3, 'Please give a reason.').max(500),
  }).strict(), req.body);
  await assertReportable(d.type, d.id, req.user);
  await db.tx(async (q) => {
    // One open report per reporter per item.
    const dup = await q.one("SELECT id FROM reports WHERE reporter_id = $1 AND content_type = $2 AND content_id = $3 AND status = 'open'", [req.user.id, d.type, d.id]);
    if (dup) return;
    await q.query('INSERT INTO reports (reporter_id, content_type, content_id, reason) VALUES ($1, $2, $3, $4)', [req.user.id, d.type, d.id, d.reason]);
    const staff = await q.many(`SELECT u.id FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id AND rp.permission = 'mod.view_reports' WHERE u.status = 'active'`);
    for (const s of staff) await notify(q, { userId: s.id, actorId: req.user.id, type: 'report', text: `${req.user.username} reported content: ${d.reason.slice(0, 60)}`, link: '#/mod/reports' });
  });
  res.status(201).json({ ok: true });
});

module.exports = router;

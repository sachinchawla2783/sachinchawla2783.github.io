'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam, content } = require('../lib/validate');
const { assertCan, requireUser } = require('../lib/permissions');
const { summaries } = require('../lib/users');
const { forbidden, notFound, invalid } = require('../lib/errors');
const { assertSafeContent } = require('../lib/content');
const { notify } = require('../lib/notify');
const limits = require('../lib/limits');
const T = require('../lib/threads');

const router = express.Router();
router.use('/conversations', requireUser);
const PER_PAGE = 50;
const MAX_PARTICIPANTS = 20;

/* Only current participants may see a conversation; everyone else gets 404 (no existence leak). */
async function loadConversation(id, user, q = db) {
  const c = await q.one(`SELECT c.*, cp.last_read_at, cp.starred FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $2 AND cp.left_at IS NULL
    WHERE c.id = $1`, [idParam(id), user.id]);
  if (!c) throw notFound('Conversation not found.');
  return c;
}

/* Can `from` start a conversation with `to`, given to's privacy settings and ignore list? */
async function canMessage(from, toId, q = db) {
  if (String(from.id) === String(toId)) return false;
  const t = await q.one(`SELECT u.status, pr.allow_dms,
      EXISTS (SELECT 1 FROM ignores WHERE user_id = u.id AND ignored_id = $2) AS ignoring,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND followee_id = $2) AS follows
    FROM users u JOIN user_preferences pr ON pr.user_id = u.id WHERE u.id = $1`, [toId, from.id]);
  if (!t || t.status === 'deleted') return false;
  if (from.isStaff) return true;
  if (t.ignoring || t.allow_dms === 'none') return false;
  if (t.allow_dms === 'followed') return t.follows;
  return true;
}

async function resolveRecipients(names, from) {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!list.length) throw invalid('Please enter at least one recipient.');
  if (list.length > MAX_PARTICIPANTS - 1) throw invalid(`A conversation can have at most ${MAX_PARTICIPANTS} participants.`);
  const rows = await db.many(`SELECT id, username FROM users WHERE username = ANY($1::citext[]) AND status <> 'deleted'`, [list]);
  for (const n of list) {
    const r = rows.find((x) => x.username.toLowerCase() === n.toLowerCase());
    if (!r) throw invalid('Member not found: ' + n);
    if (!(await canMessage(from, r.id))) throw forbidden(r.username + ' can\'t receive messages from you.');
  }
  return rows;
}

const namesSchema = z.union([z.array(z.string().max(24)).max(MAX_PARTICIPANTS), z.string().max(600).transform((s) => s.split(','))]);

router.get('/conversations', async (req, res) => {
  const { filter } = parse(z.object({ filter: z.enum(['', 'unread', 'starred', 'started']).default('') }).strip(), req.query);
  const extra = { '': '', unread: "AND c.last_message_at > coalesce(cp.last_read_at, 'epoch')", starred: 'AND cp.starred', started: 'AND c.starter_id = $1' }[filter];
  const rows = await db.many(`SELECT c.id, c.title, c.starter_id, c.created_at, c.last_message_at, cp.starred,
      (c.last_message_at > coalesce(cp.last_read_at, 'epoch')) AS unread,
      (SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT json_build_object('authorId', m.author_id::text, 'content', left(m.content, 200), 'at', m.created_at) FROM conversation_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last,
      (SELECT array_agg(p.user_id::text) FROM conversation_participants p WHERE p.conversation_id = c.id) AS participants
    FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1 AND cp.left_at IS NULL
    WHERE true ${extra} ORDER BY c.last_message_at DESC LIMIT 200`, [req.user.id]);
  const list = rows.map((c) => ({ id: String(c.id), title: c.title, starterId: c.starter_id, createdAt: c.created_at, lastMessageAt: c.last_message_at, starred: c.starred, unread: c.unread, replies: c.message_count - 1, participants: c.participants, last: c.last }));
  res.json({ conversations: list, users: await summaries(list.flatMap((c) => [c.starterId, c.last && c.last.authorId, ...c.participants])) });
});

router.post('/conversations', limits.write, async (req, res) => {
  assertCan(req.user, 'conversation.start');
  const d = parse(z.object({ to: namesSchema, title: z.string().trim().min(1).max(100), content: content(20000), allowInvite: z.boolean().optional() }).strict(), req.body);
  assertSafeContent(d.content);
  await T.assertNotFlooding(req.user);
  const recips = await resolveRecipients(d.to, req.user);
  const c = await db.tx(async (q) => {
    const conv = await q.one('INSERT INTO conversations (title, starter_id, allow_invite) VALUES ($1, $2, $3) RETURNING id, title', [d.title, req.user.id, !!d.allowInvite]);
    await q.query('INSERT INTO conversation_participants (conversation_id, user_id, last_read_at) VALUES ($1, $2, now())', [conv.id, req.user.id]);
    for (const r of recips) await q.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [conv.id, r.id]);
    await q.query('INSERT INTO conversation_messages (conversation_id, author_id, content) VALUES ($1, $2, $3)', [conv.id, req.user.id, d.content]);
    for (const r of recips) await notify(q, { userId: r.id, actorId: req.user.id, type: 'conversation', text: `${req.user.username} started a conversation with you: ${conv.title}`, link: `#/conversations/${conv.id}` });
    return conv;
  });
  res.status(201).json({ id: String(c.id) });
});

router.get('/conversations/:id', async (req, res) => {
  const c = await loadConversation(req.params.id, req.user);
  const { page: reqPage } = parse(z.object({ page: z.coerce.number().int().min(1).max(100000).optional() }).strip(), req.query);
  const total = (await db.one('SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id = $1', [c.id])).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(reqPage || pages, pages); // default to the newest page
  const msgs = await db.many('SELECT id, author_id, content, created_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at, id LIMIT $2 OFFSET $3',
    [c.id, PER_PAGE, (page - 1) * PER_PAGE]);
  const parts = await db.many('SELECT user_id, left_at FROM conversation_participants WHERE conversation_id = $1 ORDER BY joined_at', [c.id]);
  await db.query('UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id]);
  res.json({
    conversation: { id: String(c.id), title: c.title, starterId: c.starter_id, allowInvite: c.allow_invite, createdAt: c.created_at, starred: c.starred,
      canInvite: String(c.starter_id) === String(req.user.id) || c.allow_invite },
    participants: parts.map((p) => ({ userId: p.user_id, left: !!p.left_at })),
    messages: msgs.map((m, i) => ({ id: String(m.id), authorId: m.author_id, content: m.content, at: m.created_at, position: (page - 1) * PER_PAGE + i + 1 })),
    page, pages,
    users: await summaries([...parts.map((p) => p.user_id), ...msgs.map((m) => m.author_id)]),
  });
});

router.post('/conversations/:id/messages', limits.write, async (req, res) => {
  assertCan(req.user, 'conversation.start');
  const c = await loadConversation(req.params.id, req.user);
  const d = parse(z.object({ content: content(20000) }).strict(), req.body);
  assertSafeContent(d.content);
  await T.assertNotFlooding(req.user);
  const m = await db.tx(async (q) => {
    const msg = await q.one('INSERT INTO conversation_messages (conversation_id, author_id, content) VALUES ($1, $2, $3) RETURNING id, created_at', [c.id, req.user.id, d.content]);
    await q.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [c.id, msg.created_at]);
    // People who left rejoin when the conversation continues (as in the prototype).
    await q.query('UPDATE conversation_participants SET left_at = NULL WHERE conversation_id = $1', [c.id]);
    await q.query('UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id]);
    return msg;
  });
  res.status(201).json({ id: String(m.id) });
});

router.post('/conversations/:id/invite', limits.write, async (req, res) => {
  const c = await loadConversation(req.params.id, req.user);
  if (String(c.starter_id) !== String(req.user.id) && !c.allow_invite) throw forbidden('You can\'t invite members to this conversation.');
  const d = parse(z.object({ names: namesSchema }).strict(), req.body);
  const recips = await resolveRecipients(d.names, req.user);
  const count = (await db.one('SELECT count(*)::int AS n FROM conversation_participants WHERE conversation_id = $1', [c.id])).n;
  if (count + recips.length > MAX_PARTICIPANTS) throw invalid(`A conversation can have at most ${MAX_PARTICIPANTS} participants.`);
  await db.tx(async (q) => {
    for (const r of recips) {
      const ins = await q.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, r.id]);
      if (ins.rowCount) await notify(q, { userId: r.id, actorId: req.user.id, type: 'conversation', text: `${req.user.username} invited you to a conversation: ${c.title}`, link: `#/conversations/${c.id}` });
    }
  });
  res.json({ ok: true });
});

router.post('/conversations/:id/leave', async (req, res) => {
  const c = await loadConversation(req.params.id, req.user);
  await db.query('UPDATE conversation_participants SET left_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id]);
  res.json({ ok: true });
});

router.put('/conversations/:id/star', async (req, res) => {
  const c = await loadConversation(req.params.id, req.user);
  const { starred } = parse(z.object({ starred: z.boolean() }).strict(), req.body);
  await db.query('UPDATE conversation_participants SET starred = $3 WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id, starred]);
  res.json({ starred });
});

module.exports = router;
module.exports.loadConversation = loadConversation;

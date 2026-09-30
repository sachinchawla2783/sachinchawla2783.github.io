'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam, content } = require('../lib/validate');
const { can, assertCan, requireUser } = require('../lib/permissions');
const { summaries } = require('../lib/users');
const { forbidden, notFound, invalid, tooMany, HttpError } = require('../lib/errors');
const { assertSafeContent } = require('../lib/content');
const { notify } = require('../lib/notify');
const safety = require('../lib/safety');
const { checkTrophies } = require('../lib/trophies');
const { audit } = require('../lib/audit');
const settings = require('../lib/settings');
const limits = require('../lib/limits');
const T = require('../lib/threads');
const { syncRefs } = require('../lib/attachments');

const router = express.Router();
const isOwn = (row, user) => !!user && String(row.author_id) === String(user.id);

/* ---------- edit / delete ---------- */

router.patch('/posts/:id', limits.write, async (req, res) => {
  const me = req.user;
  if (!me) throw forbidden();
  const { post, thread } = await T.loadPost(idParam(req.params.id), me);
  const own = isOwn(post, me);
  if (!((own && can(me, 'post.edit_own')) || can(me, 'mod.edit_any'))) throw forbidden('You cannot edit this post.');
  if (post.deleted_at) throw invalid('Restore the post before editing it.');
  if (own && thread.locked && !can(me, 'mod.lock')) throw forbidden('This thread is locked.');
  if (!can(me, 'mod.edit_any')) await T.assertWithinEditWindow(me, post);
  const d = parse(z.object({ content: content(20000), reason: z.string().trim().max(100).optional() }).strict(), req.body);
  assertSafeContent(d.content);
  const check = safety.check(d.content);
  await db.tx(async (q) => {
    await q.query('INSERT INTO post_revisions (post_id, content, editor_id, created_at) VALUES ($1, $2, $3, coalesce($4::timestamptz, $5::timestamptz))',
      [post.id, post.content, post.edited_by || post.author_id, post.edited_at, post.created_at]);
    await q.query('UPDATE posts SET content = $2, edited_at = now(), edited_by = $3, edit_reason = $4 WHERE id = $1', [post.id, d.content, me.id, d.reason || '']);
    await syncRefs(q, 'post', post.id, d.content, post.author_id);
    if (!own) await audit(q, req, 'post.edit', 'post', post.id, { reason: d.reason || '' });
    await safety.autoReport(q, 'post', post.id, check.danger);
  });
  res.json({ ok: true, safety: check });
});

router.delete('/posts/:id', async (req, res) => {
  const me = req.user;
  if (!me) throw forbidden();
  const { post, thread } = await T.loadPost(idParam(req.params.id), me);
  const own = isOwn(post, me);
  if (!((own && can(me, 'post.delete_own')) || can(me, 'mod.delete_any'))) throw forbidden('You cannot delete this post.');
  const d = parse(z.object({ reason: z.string().trim().max(100).optional() }).strict(), req.body);
  if (String(thread.first_post_id) === String(post.id) && !can(me, 'mod.delete_any')) await T.assertCanDeleteOwnThread(me, thread);
  const result = await db.tx(async (q) => {
    if (String(thread.first_post_id) === String(post.id)) {
      // Deleting the first post removes the whole thread (soft delete).
      await q.query('UPDATE threads SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [thread.id, me.id]);
      if (!own) await audit(q, req, 'thread.delete', 'thread', thread.id, { title: thread.title, reason: d.reason || '' });
      return 'thread';
    }
    await q.query('UPDATE posts SET deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE id = $1', [post.id, me.id, d.reason || '']);
    await T.refreshThreadStats(q, thread.id);
    if (!own) {
      await audit(q, req, 'post.delete', 'post', post.id, { threadId: thread.id, reason: d.reason || '' });
      await notify(q, { userId: post.author_id, actorId: me.id, type: 'moderation', text: `Your post in "${thread.title}" was removed by a moderator${d.reason ? ': ' + d.reason : ''}`, link: `#/threads/${thread.id}` });
    }
    return 'post';
  });
  res.json({ ok: true, deleted: result, threadId: String(thread.id), forumId: thread.forum_id });
});

router.post('/posts/:id/restore', async (req, res) => {
  assertCan(req.user, 'mod.delete_any');
  const { post, thread } = await T.loadPost(idParam(req.params.id), req.user);
  await db.tx(async (q) => {
    await q.query("UPDATE posts SET deleted_at = NULL, deleted_by = NULL, delete_reason = '' WHERE id = $1", [post.id]);
    await T.refreshThreadStats(q, thread.id);
    await audit(q, req, 'post.restore', 'post', post.id, {});
  });
  res.json({ ok: true });
});

router.get('/posts/:id/history', async (req, res) => {
  const me = req.user;
  const { post } = await T.loadPost(idParam(req.params.id), me);
  if (!(isOwn(post, me) || can(me, 'mod.edit_any'))) throw forbidden();
  const rows = await db.many('SELECT content, editor_id, created_at FROM post_revisions WHERE post_id = $1 ORDER BY created_at DESC, id DESC', [post.id]);
  res.json({ revisions: rows.map((r) => ({ content: r.content, editorId: r.editor_id, at: r.created_at })), users: await summaries(rows.map((r) => r.editor_id)) });
});

/* ---------- reactions ---------- */

router.put('/posts/:id/reaction', limits.write, async (req, res) => {
  assertCan(req.user, 'post.react');
  const me = req.user;
  const { post, thread } = await T.loadPost(idParam(req.params.id), me);
  if (post.deleted_at) throw notFound('Post not found.');
  if (isOwn(post, me)) throw forbidden('You can\'t react to your own content.');
  const { reaction } = parse(z.object({ reaction: z.enum([...T.REACTIONS, ...T.VIP_REACTIONS]) }).strict(), req.body);
  if (T.VIP_REACTIONS.includes(reaction) && !(me.vip && me.vip.customReactions)) {
    throw new HttpError(403, 'vip_required', 'Custom reactions are a VIP+ benefit.');
  }
  await db.tx(async (q) => {
    const prev = await q.one('SELECT reaction FROM reactions WHERE post_id = $1 AND user_id = $2', [post.id, me.id]);
    await q.query(`INSERT INTO reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)
      ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`, [post.id, me.id, reaction]);
    if (!prev) await notify(q, { userId: post.author_id, actorId: me.id, type: 'reaction', text: `${me.username} reacted to your post in ${thread.title}`, link: `#/threads/${thread.id}/post-${post.id}` });
    if (post.author_id) await checkTrophies(q, post.author_id);
  });
  res.json({ reaction });
});

router.delete('/posts/:id/reaction', requireUser, async (req, res) => {
  const { post } = await T.loadPost(idParam(req.params.id), req.user);
  await db.query('DELETE FROM reactions WHERE post_id = $1 AND user_id = $2', [post.id, req.user.id]);
  res.json({ reaction: null });
});

router.get('/posts/:id/reactions', async (req, res) => {
  const { post } = await T.loadPost(idParam(req.params.id), req.user);
  const rows = await db.many('SELECT user_id, reaction FROM reactions WHERE post_id = $1 ORDER BY created_at', [post.id]);
  res.json({ reactions: rows.map((r) => ({ userId: r.user_id, reaction: r.reaction })), users: await summaries(rows.map((r) => r.user_id)) });
});

/* ---------- reputation ---------- */

router.post('/posts/:id/reputation', limits.write, async (req, res) => {
  assertCan(req.user, 'rep.give');
  const me = req.user;
  const { post, thread } = await T.loadPost(idParam(req.params.id), me);
  if (post.deleted_at || !post.author_id) throw notFound('Post not found.');
  if (isOwn(post, me)) throw forbidden('You can\'t give reputation to yourself.');
  const d = parse(z.object({ positive: z.boolean(), comment: z.string().trim().max(200).optional() }).strict(), req.body);
  const comment = d.comment || '';
  if (!d.positive) {
    assertCan(me, 'rep.give_negative');
    const minPosts = Number(await settings.get('neg_rep_min_posts', 10));
    const mine = (await db.one('SELECT count(*)::int AS n FROM posts WHERE author_id = $1 AND deleted_at IS NULL', [me.id])).n;
    if (!me.isStaff && mine < minPosts) throw forbidden(`You need at least ${minPosts} messages to give negative reputation.`);
    if (!comment) throw invalid('Please explain why you\'re giving negative reputation.');
  }
  const daily = Number(await settings.get('rep_daily_limit', 10));
  const value = (d.positive ? 1 : -1) * await T.repPower(me.id, me.role);
  const row = await db.tx(async (q) => {
    // Serialise per giver so the daily limit can't be raced.
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rep:' + me.id]);
    const given = (await q.one(`SELECT count(*)::int AS n FROM reputation WHERE giver_id = $1 AND created_at > now() - interval '24 hours'`, [me.id])).n;
    if (given >= daily) throw tooMany(`You've given ${daily} reputation in the last 24 hours. Try again later.`);
    const r = await q.one(`INSERT INTO reputation (post_id, giver_id, receiver_id, value, comment) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (post_id, giver_id) DO NOTHING RETURNING id, value`, [post.id, me.id, post.author_id, value, comment]);
    if (!r) throw forbidden('You have already given reputation for this post.');
    await notify(q, { userId: post.author_id, actorId: me.id, type: 'rep', text: `${me.username} gave you ${value > 0 ? '+' : ''}${value} reputation for your post in ${thread.title}${comment ? ': "' + comment + '"' : ''}`, link: `#/threads/${thread.id}/post-${post.id}` });
    await checkTrophies(q, post.author_id);
    return r;
  });
  res.status(201).json({ id: String(row.id), value: row.value });
});

router.get('/posts/:id/reputation', async (req, res) => {
  const { post } = await T.loadPost(idParam(req.params.id), req.user);
  const rows = await db.many('SELECT id, giver_id, value, comment, created_at FROM reputation WHERE post_id = $1 ORDER BY created_at DESC', [post.id]);
  res.json({
    reputation: rows.map((r) => ({ id: String(r.id), giverId: r.giver_id, value: r.value, comment: r.comment, at: r.created_at, canRemove: !!req.user && (String(r.giver_id) === String(req.user.id) || can(req.user, 'mod.edit_any')) })),
    users: await summaries(rows.map((r) => r.giver_id)),
  });
});

router.delete('/reputation/:id', requireUser, async (req, res) => {
  const r = await db.one('SELECT * FROM reputation WHERE id = $1', [idParam(req.params.id)]);
  if (!r) throw notFound();
  const mine = String(r.giver_id) === String(req.user.id);
  if (!mine && !can(req.user, 'mod.edit_any')) throw forbidden();
  await db.tx(async (q) => {
    await q.query('DELETE FROM reputation WHERE id = $1', [r.id]);
    if (!mine) await audit(q, req, 'reputation.remove', 'reputation', r.id, { giverId: r.giver_id, receiverId: r.receiver_id, value: r.value });
  });
  res.json({ ok: true });
});

/* ---------- bookmarks ---------- */

router.put('/posts/:id/bookmark', requireUser, async (req, res) => {
  const { post } = await T.loadPost(idParam(req.params.id), req.user);
  await db.query('INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, post.id]);
  res.json({ bookmarked: true });
});
router.delete('/posts/:id/bookmark', requireUser, async (req, res) => {
  await db.query('DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2', [req.user.id, idParam(req.params.id)]);
  res.json({ bookmarked: false });
});

/* ---------- polls ---------- */

async function loadPoll(id, user) {
  const p = await db.one('SELECT * FROM polls WHERE id = $1', [id]);
  if (!p) throw notFound('Poll not found.');
  const t = await T.loadThread(p.thread_id, user);
  if (t.deleted_at) throw notFound('Poll not found.');
  if (p.closes_at && new Date(p.closes_at) < new Date()) throw forbidden('This poll has closed.');
  return p;
}

router.post('/polls/:id/votes', limits.write, async (req, res) => {
  assertCan(req.user, 'poll.vote');
  const p = await loadPoll(idParam(req.params.id), req.user);
  const { optionIds } = parse(z.object({ optionIds: z.array(z.string().regex(/^\d{1,18}$/)).min(1).max(20) }).strict(), req.body);
  const unique = [...new Set(optionIds)];
  if (!p.allow_multiple && unique.length > 1) throw invalid('This poll only allows one choice.');
  const valid = await db.many('SELECT id FROM poll_options WHERE poll_id = $1 AND id = ANY($2)', [p.id, unique]);
  if (valid.length !== unique.length) throw invalid('Invalid poll option.');
  await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['poll:' + p.id + ':' + req.user.id]);
    if (await q.one('SELECT 1 FROM poll_votes WHERE poll_id = $1 AND user_id = $2 LIMIT 1', [p.id, req.user.id])) {
      throw forbidden('You have already voted. Remove your vote first to change it.');
    }
    for (const o of unique) await q.query('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)', [p.id, o, req.user.id]);
  });
  res.status(201).json({ ok: true });
});

router.delete('/polls/:id/votes', async (req, res) => {
  assertCan(req.user, 'poll.vote');
  const p = await loadPoll(idParam(req.params.id), req.user);
  await db.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [p.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;

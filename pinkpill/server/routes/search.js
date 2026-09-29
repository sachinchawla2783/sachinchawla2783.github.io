'use strict';
const express = require('express');
const db = require('../db');
const { z, parse } = require('../lib/validate');
const { requireUser } = require('../lib/permissions');
const { visibleForumIds, allForums, descendants } = require('../lib/forums');
const { summaries } = require('../lib/users');
const { notFound } = require('../lib/errors');
const { threadRows } = require('./forums');
const { activity, onlineList, profilePostsJson } = require('./members');

const router = express.Router();

/* Full-text search in PostgreSQL, restricted to forums the viewer can see. */
router.get('/search', async (req, res) => {
  const q = parse(z.object({
    q: z.string().trim().max(200).default(''),
    t: z.enum(['', 'thread', 'post', 'profile_post', 'member']).default(''),
    m: z.string().trim().max(24).default(''),
    f: z.string().regex(/^[a-z0-9-]{0,40}$/).default(''),
    titles: z.string().optional(),
    o: z.enum(['date', 'relevance']).default('date'),
  }).strip(), req.query);
  if (!q.q && !q.m) return res.json({ results: [], users: {} });
  const all = await allForums();
  let visible = await visibleForumIds(req.user);
  if (q.f) visible = descendants(all, q.f).filter((id) => visible.includes(id));
  const params = [visible];
  let author = '', authorId = null;
  if (q.m) {
    const u = await db.one(`SELECT id FROM users WHERE username = $1 AND status <> 'deleted'`, [q.m]);
    if (!u) return res.json({ results: [], users: {} });
    authorId = u.id; params.push(u.id); author = `$${params.length}`;
  }
  let tsq = null;
  if (q.q) { params.push(q.q); tsq = `websearch_to_tsquery('english', $${params.length})`; }
  const results = [];

  if (q.t === 'member') {
    const rows = await db.many(`SELECT id FROM users WHERE status <> 'deleted' AND username ILIKE $1 ESCAPE '\\' ORDER BY username LIMIT 50`,
      ['%' + q.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%']);
    return res.json({ results: rows.map((r) => ({ kind: 'member', userId: r.id })), users: await summaries(rows.map((r) => r.id)) });
  }

  if (q.t !== 'profile_post') {
    const titleOnly = q.titles || q.t === 'thread';
    const conds = ['p.deleted_at IS NULL', 't.deleted_at IS NULL', 't.forum_id = ANY($1)'];
    if (author) conds.push(`p.author_id = ${author}`);
    if (titleOnly) conds.push('p.id = t.first_post_id');
    if (tsq) conds.push(titleOnly ? `t.title_search @@ ${tsq}` : `(p.search @@ ${tsq} OR (p.id = t.first_post_id AND t.title_search @@ ${tsq}))`);
    const rank = tsq ? `ts_rank(p.search, ${tsq}) + 2 * ts_rank(t.title_search, ${tsq})` : '0';
    const rows = await db.many(`SELECT p.id, p.thread_id, p.author_id, p.content, p.created_at, t.title, t.prefix, t.forum_id, f.title AS forum_title,
        (p.id = t.first_post_id) AS is_first, ${rank} AS rank
      FROM posts p JOIN threads t ON t.id = p.thread_id JOIN forums f ON f.id = t.forum_id
      WHERE ${conds.join(' AND ')} ORDER BY ${q.o === 'relevance' && tsq ? 'rank DESC,' : ''} p.created_at DESC LIMIT 100`, params);
    rows.forEach((r) => results.push({ kind: r.is_first ? 'thread' : 'post', postId: String(r.id), threadId: String(r.thread_id), threadTitle: r.title, prefix: r.prefix, forumId: r.forum_id, forumTitle: r.forum_title, authorId: r.author_id, content: r.content.slice(0, 600), at: r.created_at, rank: Number(r.rank) }));
  }
  if (!q.t || q.t === 'profile_post') {
    const conds = ['deleted_at IS NULL'];
    const pp = [];
    if (authorId) { pp.push(authorId); conds.push(`author_id = $${pp.length}`); }
    if (q.q) { pp.push(q.q); conds.push(`search @@ websearch_to_tsquery('english', $${pp.length})`); }
    const rows = await db.many(`SELECT id, profile_user_id, author_id, content, created_at FROM profile_posts WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 50`, pp);
    rows.forEach((r) => results.push({ kind: 'profile_post', id: String(r.id), profileUserId: r.profile_user_id, authorId: r.author_id, content: r.content.slice(0, 600), at: r.created_at, rank: 0 }));
  }
  if (q.o === 'relevance') results.sort((a, b) => b.rank - a.rank || new Date(b.at) - new Date(a.at));
  else results.sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ results: results.slice(0, 100), users: await summaries(results.flatMap((r) => [r.authorId, r.profileUserId])) });
});

router.get('/tags/:tag', async (req, res) => {
  const tag = String(req.params.tag);
  if (!/^[a-z0-9-]{1,30}$/.test(tag)) throw notFound();
  const visible = await visibleForumIds(req.user);
  const threads = await threadRows('t.deleted_at IS NULL AND t.forum_id = ANY($1) AND EXISTS (SELECT 1 FROM thread_tags x WHERE x.thread_id = t.id AND x.tag = $2)', [visible, tag], req.user, 't.created_at DESC', 100, 0);
  const popular = await db.many(`SELECT tag, count(*)::int AS n FROM thread_tags x JOIN threads t ON t.id = x.thread_id
    WHERE t.deleted_at IS NULL AND t.forum_id = ANY($1) GROUP BY tag ORDER BY n DESC, tag LIMIT 30`, [visible]);
  res.json({ tag, threads, popular, users: await summaries(threads.flatMap((t) => [t.authorId, t.lastPost && t.lastPost.userId])) });
});

/* ---------- what's new ---------- */

router.get('/whats-new/posts', async (req, res) => {
  const q = parse(z.object({ unread: z.string().optional(), watched: z.string().optional() }).strip(), req.query);
  const visible = await visibleForumIds(req.user);
  const params = [visible];
  let where = `t.deleted_at IS NULL AND t.forum_id = ANY($1) AND t.last_post_at > now() - interval '60 days'`;
  if (req.user) {
    params.push(req.user.id);
    const me = '$' + params.length;
    where += ` AND NOT EXISTS (SELECT 1 FROM ignores i WHERE i.user_id = ${me} AND i.ignored_id = t.author_id)`;
    if (q.watched) where += ` AND EXISTS (SELECT 1 FROM thread_watches w WHERE w.thread_id = t.id AND w.user_id = ${me})`;
    if (q.unread) where += ` AND lp.author_id IS DISTINCT FROM ${me} AND t.last_post_at > GREATEST((SELECT read_at FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${me}), (SELECT read_all_at FROM users WHERE id = ${me}), now() - interval '30 days')`;
  }
  const threads = await threadRows(where, params, req.user, 't.last_post_at DESC', 50, 0);
  const forums = Object.fromEntries((await allForums()).map((f) => [f.id, f.title]));
  threads.forEach((t) => { t.forumTitle = forums[t.forumId]; });
  res.json({ threads, users: await summaries(threads.flatMap((t) => [t.authorId, t.lastPost && t.lastPost.userId])) });
});

router.get('/whats-new/profile-posts', async (req, res) => { res.json(await profilePostsJson('true', [], req.user)); });
router.get('/whats-new/activity', async (req, res) => { res.json(await activity(req.user, { limit: 40 })); });
router.get('/whats-new/feed', requireUser, async (req, res) => {
  const ids = (await db.many('SELECT followee_id AS id FROM follows WHERE follower_id = $1', [req.user.id])).map((r) => r.id);
  res.json(ids.length ? await activity(req.user, { authorIds: ids, limit: 40 }) : { items: [], users: {} });
});

/* Sidebar widgets: online members, latest posts, new profile posts, statistics. */
router.get('/widgets/sidebar', async (req, res) => {
  const visible = await visibleForumIds(req.user);
  const online = await onlineList(req.user, 15);
  const latest = await threadRows('t.deleted_at IS NULL AND t.forum_id = ANY($1)', [visible], null, 't.last_post_at DESC', 6, 0);
  const forums = Object.fromEntries((await allForums()).map((f) => [f.id, f.title]));
  latest.forEach((t) => { t.forumTitle = forums[t.forumId]; });
  const pp = await db.many('SELECT id, profile_user_id, author_id, content, created_at FROM profile_posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 4');
  const stats = await db.one(`SELECT
      (SELECT count(*)::int FROM threads WHERE deleted_at IS NULL AND forum_id = ANY($1)) AS threads,
      (SELECT count(*)::int FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.forum_id = ANY($1)) AS messages,
      (SELECT count(*)::int FROM users WHERE status <> 'deleted') AS members,
      (SELECT id FROM users WHERE status <> 'deleted' ORDER BY created_at DESC LIMIT 1) AS newest`, [visible]);
  res.json({
    online: online.online.slice(0, 50), latest,
    profilePosts: pp.map((p) => ({ id: String(p.id), profileUserId: p.profile_user_id, authorId: p.author_id, content: p.content.slice(0, 200), at: p.created_at })),
    stats,
    users: await summaries([...online.online.map((o) => o.userId), ...latest.map((t) => t.lastPost && t.lastPost.userId), ...pp.flatMap((p) => [p.author_id, p.profile_user_id]), stats.newest]),
  });
});

module.exports = router;

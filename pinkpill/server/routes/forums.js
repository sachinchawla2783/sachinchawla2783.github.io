'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam, slugParam, content } = require('../lib/validate');
const { can, assertCan, requireUser } = require('../lib/permissions');
const { visibleForumIds, allForums, descendants } = require('../lib/forums');
const { summaries } = require('../lib/users');
const { notFound, forbidden, invalid } = require('../lib/errors');
const { assertSafeContent, normalizeTags } = require('../lib/content');
const { notify, notifyMentions } = require('../lib/notify');
const safety = require('../lib/safety');
const { checkTrophies } = require('../lib/trophies');
const { audit } = require('../lib/audit');
const limits = require('../lib/limits');
const settings = require('../lib/settings');
const T = require('../lib/threads');

const router = express.Router();

/* ---------- helpers ---------- */

async function forumStats(user, forums) {
  const visible = new Set(forums.map((f) => f.id));
  const direct = await db.many(`SELECT t.forum_id, count(DISTINCT t.id)::int AS threads, count(p.id)::int AS messages
    FROM threads t JOIN posts p ON p.thread_id = t.id AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL GROUP BY t.forum_id`);
  const lasts = await db.many(`SELECT DISTINCT ON (t.forum_id) t.forum_id, t.id, t.title, t.prefix, t.last_post_id, t.last_post_at, p.author_id
    FROM threads t LEFT JOIN posts p ON p.id = t.last_post_id WHERE t.deleted_at IS NULL ORDER BY t.forum_id, t.last_post_at DESC`);
  let unread = new Set();
  if (user) {
    const me = await db.one('SELECT read_all_at FROM users WHERE id = $1', [user.id]);
    unread = new Set((await db.many(`SELECT DISTINCT t.forum_id FROM threads t JOIN posts lp ON lp.id = t.last_post_id
      LEFT JOIN thread_reads r ON r.thread_id = t.id AND r.user_id = $1
      WHERE t.deleted_at IS NULL AND lp.author_id IS DISTINCT FROM $1
        AND t.last_post_at > GREATEST(r.read_at, $2::timestamptz, now() - interval '30 days')`, [user.id, me.read_all_at])).map((r) => r.forum_id));
  }
  const d = Object.fromEntries(direct.map((r) => [r.forum_id, r]));
  const l = Object.fromEntries(lasts.map((r) => [r.forum_id, r]));
  const out = {};
  for (const f of forums) {
    const tree = descendants(forums, f.id).filter((id) => visible.has(id));
    let threads = 0, messages = 0, last = null, isUnread = false;
    for (const id of tree) {
      if (d[id]) { threads += d[id].threads; messages += d[id].messages; }
      if (l[id] && (!last || l[id].last_post_at > last.last_post_at)) last = l[id];
      if (unread.has(id)) isUnread = true;
    }
    out[f.id] = {
      threads, messages, unread: isUnread,
      lastPost: last && last.last_post_id ? { threadId: String(last.id), threadTitle: last.title, prefix: last.prefix, postId: String(last.last_post_id), at: last.last_post_at, userId: last.author_id } : null,
    };
  }
  return out;
}

const forumJson = (f, stats) => ({
  id: f.id, categoryId: f.category_id, parentId: f.parent_id, title: f.title, description: f.description, icon: f.icon,
  position: f.position, staffOnly: f.staff_only, membersOnly: f.members_only, ratingEnabled: f.rating_enabled, notice: f.notice,
  ...(stats ? { stats } : {}),
});

async function visibleForums(user) {
  const ids = new Set(await visibleForumIds(user));
  return (await allForums()).filter((f) => ids.has(f.id));
}

function forumPath(forums, f) {
  const byId = Object.fromEntries(forums.map((x) => [x.id, x]));
  const out = [];
  for (let cur = f, i = 0; cur && i < 20; cur = cur.parent_id ? byId[cur.parent_id] : null, i++) out.unshift({ id: cur.id, title: cur.title });
  return out;
}

async function readAllAt(user) {
  return user ? (await db.one('SELECT read_all_at FROM users WHERE id = $1', [user.id])).read_all_at : null;
}

/* Thread-list rows with last-post info and per-user unread/watched flags. */
async function threadRows(where, params, user, orderSql, limit, offset) {
  const uid = user ? user.id : null;
  const rows = await db.many(`SELECT t.*, lp.author_id AS last_author_id,
      EXISTS (SELECT 1 FROM polls WHERE thread_id = t.id) AS has_poll,
      ${uid ? `EXISTS (SELECT 1 FROM thread_watches w WHERE w.thread_id = t.id AND w.user_id = ${Number(uid)}) AS watched,
      (lp.author_id IS DISTINCT FROM ${Number(uid)} AND t.last_post_at > GREATEST(
        (SELECT read_at FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${Number(uid)}),
        (SELECT read_all_at FROM users WHERE id = ${Number(uid)}), now() - interval '30 days')) AS unread`
    : 'false AS watched, false AS unread'},
      (SELECT coalesce(array_agg(tag ORDER BY tag), '{}') FROM thread_tags WHERE thread_id = t.id) AS tags
    FROM threads t LEFT JOIN posts lp ON lp.id = t.last_post_id
    WHERE ${where} ORDER BY ${orderSql} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params);
  return rows.map(threadJson);
}

const threadJson = (t) => ({
  id: String(t.id), forumId: t.forum_id, title: t.title, prefix: t.prefix, authorId: t.author_id, createdAt: t.created_at,
  sticky: t.sticky, locked: t.locked, ratingEnabled: t.rating_enabled, hasPoll: !!t.has_poll, deleted: !!t.deleted_at,
  replyCount: t.reply_count, viewCount: t.view_count, pages: Math.max(1, Math.ceil((t.reply_count + 1) / T.POSTS_PER_PAGE)),
  lastPost: t.last_post_id ? { id: String(t.last_post_id), at: t.last_post_at, userId: t.last_author_id || null } : null,
  unread: !!t.unread, watched: !!t.watched, tags: t.tags || [],
});

const userIdsOf = (rows) => rows.flatMap((r) => [r.authorId, r.lastPost && r.lastPost.userId]);

/* ---------- forum index & forum view ---------- */

router.get('/forums', async (req, res) => {
  const forums = await visibleForums(req.user);
  const stats = await forumStats(req.user, forums);
  const cats = await db.many('SELECT * FROM categories ORDER BY position, title');
  const users = await summaries(Object.values(stats).map((s) => s.lastPost && s.lastPost.userId));
  res.json({
    categories: cats.map((c) => ({ id: c.id, title: c.title, position: c.position })),
    forums: forums.map((f) => forumJson(f, stats[f.id])),
    users,
  });
});

const forumQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  prefix: z.enum(T.PREFIXES).optional().or(z.literal('')),
  order: z.enum(['last', 'created', 'title', 'replies', 'views']).default('last'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  starter: z.string().max(24).optional(),
  unread: z.string().optional(),
}).strip();

router.get('/forums/:id', async (req, res) => {
  const id = slugParam(req.params.id);
  const all = await visibleForums(req.user);
  const f = all.find((x) => x.id === id);
  if (!f) throw notFound('Forum not found.');
  const q = parse(forumQuery, req.query);
  const subs = all.filter((x) => x.parent_id === f.id).sort((a, b) => a.position - b.position);
  const stats = await forumStats(req.user, all);
  const params = [f.id];
  let where = 't.forum_id = $1 AND t.deleted_at IS NULL';
  if (q.prefix) { params.push(q.prefix); where += ` AND t.prefix = $${params.length}`; }
  if (q.starter) { params.push(q.starter); where += ` AND t.author_id = (SELECT id FROM users WHERE username = $${params.length})`; }
  if (q.unread && req.user) {
    params.push(req.user.id);
    const p = '$' + params.length;
    where += ` AND lp.author_id IS DISTINCT FROM ${p} AND t.last_post_at > GREATEST((SELECT read_at FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${p}), (SELECT read_all_at FROM users WHERE id = ${p}), now() - interval '30 days')`;
  }
  const col = { last: 't.last_post_at', created: 't.created_at', title: 'lower(t.title)', replies: 't.reply_count', views: 't.view_count' }[q.order];
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const sticky = q.page === 1 ? await threadRows(where + ' AND t.sticky', params, req.user, 't.last_post_at DESC', 50, 0) : [];
  const total = (await db.one(`SELECT count(*)::int AS n FROM threads t LEFT JOIN posts lp ON lp.id = t.last_post_id WHERE ${where} AND NOT t.sticky`, params)).n;
  const threads = await threadRows(where + ' AND NOT t.sticky', params, req.user, `${col} ${dir}, t.id ${dir}`, T.THREADS_PER_PAGE, (q.page - 1) * T.THREADS_PER_PAGE);
  const users = await summaries([...userIdsOf(sticky), ...userIdsOf(threads), ...Object.values(stats).map((s) => s.lastPost && s.lastPost.userId)]);
  const cat = await db.one('SELECT id, title FROM categories WHERE id = $1', [f.category_id]);
  res.json({
    forum: forumJson(f, stats[f.id]), category: cat, path: forumPath(all, f),
    subforums: subs.map((s) => Object.assign(forumJson(s, stats[s.id]), { children: all.filter((x) => x.parent_id === s.id).map((c) => forumJson(c, stats[c.id])) })),
    sticky, threads, total, page: q.page, perPage: T.THREADS_PER_PAGE,
    canPost: can(req.user, 'thread.create') && (!f.staff_only || can(req.user, 'forum.post_staff_only')),
    users,
  });
});

router.post('/forums/read-all', requireUser, async (req, res) => {
  await db.query('UPDATE users SET read_all_at = now() WHERE id = $1', [req.user.id]);
  await db.query('DELETE FROM thread_reads WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
});

router.post('/forums/:id/read', requireUser, async (req, res) => {
  const id = slugParam(req.params.id);
  const all = await visibleForums(req.user);
  if (!all.find((f) => f.id === id)) throw notFound('Forum not found.');
  await db.query(`INSERT INTO thread_reads (user_id, thread_id, read_at)
    SELECT $1, id, now() FROM threads WHERE forum_id = ANY($2) ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`, [req.user.id, descendants(all, id)]);
  res.json({ ok: true });
});

/* ---------- create thread ---------- */

const pollSchema = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(20),
  multiple: z.boolean().default(false),
  closeDays: z.number().int().min(1).max(365).nullable().optional(),
}).strict();

const threadSchema = z.object({
  title: z.string().trim().min(3, 'Please enter a title of at least 3 characters.').max(150),
  content: content(20000),
  prefix: z.enum(T.PREFIXES).nullable().optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  poll: pollSchema.nullable().optional(),
  ratingEnabled: z.boolean().optional(),
  watch: z.boolean().optional(),
}).strict();

router.post('/forums/:id/threads', limits.write, async (req, res) => {
  assertCan(req.user, 'thread.create');
  const id = slugParam(req.params.id);
  const d = parse(threadSchema, req.body);
  const f = (await visibleForums(req.user)).find((x) => x.id === id);
  if (!f) throw notFound('Forum not found.');
  if (f.staff_only && !can(req.user, 'forum.post_staff_only')) throw forbidden('Only staff can post in this forum.');
  if (d.poll) {
    assertCan(req.user, 'poll.create');
    const max = Number(await settings.get('max_poll_options', 20));
    if (d.poll.options.length > max) throw invalid(`A poll can have at most ${max} options.`);
    if (new Set(d.poll.options.map((o) => o.toLowerCase())).size !== d.poll.options.length) throw invalid('Poll options must be different.');
  }
  assertSafeContent(d.content);
  await T.assertNotFlooding(req.user);
  const tags = normalizeTags(d.tags);
  const check = safety.check(d.title + ' ' + d.content);
  const result = await db.tx(async (q) => {
    const t = await q.one(`INSERT INTO threads (forum_id, author_id, title, prefix, rating_enabled) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [f.id, req.user.id, d.title, d.prefix || null, f.rating_enabled || !!d.ratingEnabled]);
    const p = await q.one('INSERT INTO posts (thread_id, author_id, content) VALUES ($1, $2, $3) RETURNING id', [t.id, req.user.id, d.content]);
    await q.query('UPDATE threads SET first_post_id = $2, last_post_id = $2 WHERE id = $1', [t.id, p.id]);
    for (const tag of tags) await q.query('INSERT INTO thread_tags (thread_id, tag) VALUES ($1, $2)', [t.id, tag]);
    if (d.poll) {
      const poll = await q.one(`INSERT INTO polls (thread_id, question, allow_multiple, closes_at)
        VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END) RETURNING id`,
      [t.id, d.poll.question, d.poll.multiple, d.poll.closeDays || null]);
      for (let i = 0; i < d.poll.options.length; i++) await q.query('INSERT INTO poll_options (poll_id, text, position) VALUES ($1, $2, $3)', [poll.id, d.poll.options[i], i]);
    }
    const prefs = await q.one('SELECT auto_watch FROM user_preferences WHERE user_id = $1', [req.user.id]);
    if (d.watch !== false && (d.watch || !prefs || prefs.auto_watch)) await q.query('INSERT INTO thread_watches (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, t.id]);
    const link = `#/threads/${t.id}`;
    const followers = await q.many('SELECT follower_id FROM follows WHERE followee_id = $1', [req.user.id]);
    const visibleToGuests = !f.members_only;
    for (const fl of followers) await notify(q, { userId: fl.follower_id, actorId: req.user.id, type: 'follow-thread', text: `${req.user.username} started a new thread: ${t.title}`, link });
    await notifyMentions(q, { content: d.content, actor: req.user, link: `#/threads/${t.id}/post-${p.id}`, where: t.title });
    await safety.autoReport(q, 'post', p.id, check.danger);
    await checkTrophies(q, req.user.id);
    return { thread: t, postId: p.id, visibleToGuests };
  });
  res.status(201).json({ thread: { id: String(result.thread.id), title: result.thread.title }, postId: String(result.postId), safety: check });
});

/* ---------- thread view ---------- */

const viewSeen = new Map(); // viewer+thread -> timestamp; dedupes view counting for 30 minutes
function countView(key) {
  const now = Date.now();
  if (viewSeen.size > 50000) viewSeen.clear();
  if (viewSeen.has(key) && now - viewSeen.get(key) < 30 * 60 * 1000) return false;
  viewSeen.set(key, now); return true;
}

async function pollJson(threadId, user) {
  const p = await db.one('SELECT * FROM polls WHERE thread_id = $1', [threadId]);
  if (!p) return null;
  const opts = await db.many(`SELECT o.id, o.text, o.position, count(v.user_id)::int AS votes,
      ${user ? `bool_or(v.user_id = ${Number(user.id)})` : 'false'} AS mine
    FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.id WHERE o.poll_id = $1 GROUP BY o.id ORDER BY o.position`, [p.id]);
  const voters = (await db.one('SELECT count(DISTINCT user_id)::int AS n FROM poll_votes WHERE poll_id = $1', [p.id])).n;
  return {
    id: String(p.id), question: p.question, multiple: p.allow_multiple, closesAt: p.closes_at,
    closed: !!p.closes_at && new Date(p.closes_at) < new Date(), voters,
    options: opts.map((o) => ({ id: String(o.id), text: o.text, votes: o.votes, mine: !!o.mine })),
    voted: opts.some((o) => o.mine),
  };
}

async function decoratePosts(posts, user) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const uid = user ? Number(user.id) : 0;
  const reacts = await db.many('SELECT post_id, user_id, reaction FROM reactions WHERE post_id = ANY($1) ORDER BY created_at', [ids]);
  const reps = await db.many(`SELECT post_id, sum(value)::int AS total, count(*)::int AS n, bool_or(giver_id = $2) AS mine
    FROM reputation WHERE post_id = ANY($1) GROUP BY post_id`, [ids, uid]);
  const marks = user ? new Set((await db.many('SELECT post_id FROM bookmarks WHERE user_id = $1 AND post_id = ANY($2)', [uid, ids])).map((r) => r.post_id)) : new Set();
  const revs = new Set((await db.many('SELECT DISTINCT post_id FROM post_revisions WHERE post_id = ANY($1)', [ids])).map((r) => r.post_id));
  const repBy = Object.fromEntries(reps.map((r) => [r.post_id, r]));
  return posts.map((p) => {
    const rs = reacts.filter((r) => r.post_id === p.id);
    const deleted = !!p.deleted_at;
    return {
      id: String(p.id), threadId: String(p.thread_id), authorId: p.author_id, createdAt: p.created_at,
      content: deleted ? null : p.content,
      rating: p.rating, editedAt: p.edited_at, editedBy: p.edited_by, editReason: p.edit_reason, hasHistory: revs.has(p.id),
      deleted, deletedBy: deleted ? p.deleted_by : null, deleteReason: deleted ? p.delete_reason : '',
      reactions: rs.map((r) => ({ userId: r.user_id, reaction: r.reaction })),
      myReaction: user ? (rs.find((r) => r.user_id === String(uid)) || {}).reaction || null : null,
      rep: repBy[p.id] ? { total: repBy[p.id].total, count: repBy[p.id].n, mine: !!repBy[p.id].mine } : { total: 0, count: 0, mine: false },
      bookmarked: marks.has(p.id),
    };
  });
}

router.get('/threads/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const t = await T.loadThread(id, req.user);
  const q = parse(z.object({ page: z.coerce.number().int().min(1).max(100000).optional(), post: z.string().regex(/^\d{1,18}$/).optional(), unread: z.string().optional() }).strip(), req.query);
  const seeDeleted = can(req.user, 'mod.view_deleted');
  const delFilter = seeDeleted ? '' : 'AND deleted_at IS NULL';
  const total = (await db.one(`SELECT count(*)::int AS n FROM posts WHERE thread_id = $1 ${delFilter}`, [t.id])).n;
  const pages = Math.max(1, Math.ceil(total / T.POSTS_PER_PAGE));
  let page = q.page || 1, target = q.post || null;
  if (q.unread && req.user) {
    const cut = await db.one(`SELECT GREATEST((SELECT read_at FROM thread_reads WHERE user_id = $1 AND thread_id = $2), read_all_at, now() - interval '30 days') AS c FROM users WHERE id = $1`, [req.user.id, t.id]);
    const first = await db.one(`SELECT id FROM posts WHERE thread_id = $1 ${delFilter} AND created_at > $2 ORDER BY created_at, id LIMIT 1`, [t.id, cut.c]);
    if (first) target = first.id;
  }
  if (target) {
    const pos = await db.one(`SELECT (SELECT count(*)::int FROM posts WHERE thread_id = $1 ${delFilter} AND (created_at, id) < (p.created_at, p.id)) AS n
      FROM posts p WHERE p.id = $2 AND p.thread_id = $1 ${seeDeleted ? '' : 'AND p.deleted_at IS NULL'}`, [t.id, target]);
    if (pos) page = Math.floor(pos.n / T.POSTS_PER_PAGE) + 1; else target = null;
  }
  page = Math.min(page, pages);
  const rows = await db.many(`SELECT * FROM posts WHERE thread_id = $1 ${delFilter} ORDER BY created_at, id LIMIT $2 OFFSET $3`,
    [t.id, T.POSTS_PER_PAGE, (page - 1) * T.POSTS_PER_PAGE]);
  const posts = await decoratePosts(rows, req.user);
  const firstIndex = (page - 1) * T.POSTS_PER_PAGE;
  posts.forEach((p, i) => { p.position = firstIndex + i + 1; });

  if (countView((req.user ? 'u' + req.user.id : 'ip' + req.ip) + ':' + t.id)) await db.query('UPDATE threads SET view_count = view_count + 1 WHERE id = $1', [t.id]);
  if (req.user) {
    await db.query(`INSERT INTO thread_reads (user_id, thread_id, read_at) VALUES ($1, $2, now()) ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`, [req.user.id, t.id]);
    db.query(`UPDATE users SET activity_type = 'thread', activity_ref = $2 WHERE id = $1`, [req.user.id, String(t.id)]).catch(() => {});
  }

  const all = await visibleForums(req.user);
  const forum = all.find((f) => f.id === t.forum_id);
  const ratings = t.rating_enabled ? await db.many('SELECT rating, count(*)::int AS n FROM posts WHERE thread_id = $1 AND rating IS NOT NULL AND deleted_at IS NULL GROUP BY rating', [t.id]) : [];
  const participants = (await db.one('SELECT count(DISTINCT author_id)::int AS n FROM posts WHERE thread_id = $1 AND deleted_at IS NULL', [t.id])).n;
  const watchers = (await db.one('SELECT count(*)::int AS n FROM thread_watches WHERE thread_id = $1', [t.id])).n;
  const tags = (await db.many('SELECT tag FROM thread_tags WHERE thread_id = $1 ORDER BY tag', [t.id])).map((r) => r.tag);
  const similar = await threadRows(`t.deleted_at IS NULL AND t.id <> $1 AND t.forum_id = ANY($2) AND (t.forum_id = $3 OR EXISTS (SELECT 1 FROM thread_tags x WHERE x.thread_id = t.id AND x.tag = ANY($4)))`,
    [t.id, all.map((f) => f.id), t.forum_id, tags], null, 't.last_post_at DESC', 5, 0);
  const me = req.user;
  const own = me && String(t.author_id) === String(me.id);
  const myRated = me ? !!(await db.one('SELECT 1 FROM posts WHERE thread_id = $1 AND author_id = $2 AND rating IS NOT NULL AND deleted_at IS NULL', [t.id, me.id])) : false;
  const watching = me ? !!(await db.one('SELECT 1 FROM thread_watches WHERE user_id = $1 AND thread_id = $2', [me.id, t.id])) : false;
  const users = await summaries([t.author_id, ...posts.flatMap((p) => [p.authorId, p.deletedBy, p.editedBy, ...p.reactions.map((r) => r.userId)])]);
  const viewCount = (await db.one('SELECT view_count FROM threads WHERE id = $1', [t.id])).view_count;

  res.json({
    thread: Object.assign(threadJson(Object.assign({}, t, { view_count: viewCount })), { tags, watchers, participants, watching, total }),
    forum: forumJson(forum), path: forumPath(all, forum), category: await db.one('SELECT id, title FROM categories WHERE id = $1', [forum.category_id]),
    poll: await pollJson(t.id, me),
    ratings: t.rating_enabled ? Array.from({ length: 10 }, (_, i) => ((ratings.find((r) => r.rating === i + 1) || {}).n || 0)) : null,
    posts, page, pages, perPage: T.POSTS_PER_PAGE, targetPostId: target ? String(target) : null,
    similar,
    permissions: {
      reply: can(me, 'post.reply') && (!t.locked || can(me, 'mod.lock')),
      rate: t.rating_enabled && !own && !myRated && can(me, 'post.reply'),
      react: can(me, 'post.react'), rep: can(me, 'rep.give'), vote: can(me, 'poll.vote'), report: can(me, 'report.create'),
      editThread: (own && can(me, 'post.edit_own')) || can(me, 'mod.edit_any'),
      deleteThread: (own && can(me, 'post.delete_own')) || can(me, 'mod.delete_any'),
      sticky: can(me, 'mod.sticky'), lock: can(me, 'mod.lock'), move: can(me, 'mod.move'),
      editAny: can(me, 'mod.edit_any'), deleteAny: can(me, 'mod.delete_any'), warn: can(me, 'mod.warn'),
      editOwn: can(me, 'post.edit_own'), deleteOwn: can(me, 'post.delete_own'),
    },
    users,
  });
});

/* ---------- thread management ---------- */

const threadPatch = z.object({
  title: z.string().trim().min(3).max(150),
  prefix: z.enum(T.PREFIXES).nullable(),
  tags: z.array(z.string().max(40)).max(10),
  sticky: z.boolean(),
  locked: z.boolean(),
  forumId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  notify: z.boolean(),
  pollClosed: z.boolean(),
}).partial().strict();

router.patch('/threads/:id', async (req, res) => {
  const me = req.user;
  if (!me) throw forbidden();
  const t = await T.loadThread(idParam(req.params.id), me);
  const d = parse(threadPatch, req.body);
  const own = String(t.author_id) === String(me.id);
  const basic = ['title', 'prefix', 'tags', 'pollClosed'].some((k) => k in d);
  if (basic && !((own && can(me, 'post.edit_own')) || can(me, 'mod.edit_any'))) throw forbidden();
  if ('sticky' in d) assertCan(me, 'mod.sticky');
  if ('locked' in d) assertCan(me, 'mod.lock');
  if ('forumId' in d) {
    assertCan(me, 'mod.move');
    if (!(await visibleForumIds(me)).includes(d.forumId)) throw invalid('Destination forum not found.');
  }
  await db.tx(async (q) => {
    const sets = [], vals = [t.id];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('title' in d) add('title', d.title);
    if ('prefix' in d) add('prefix', d.prefix);
    if ('sticky' in d) add('sticky', d.sticky);
    if ('locked' in d) add('locked', d.locked);
    if ('forumId' in d) add('forum_id', d.forumId);
    if (sets.length) await q.query(`UPDATE threads SET ${sets.join(', ')} WHERE id = $1`, vals);
    if ('tags' in d) {
      await q.query('DELETE FROM thread_tags WHERE thread_id = $1', [t.id]);
      for (const tag of normalizeTags(d.tags)) await q.query('INSERT INTO thread_tags (thread_id, tag) VALUES ($1, $2)', [t.id, tag]);
    }
    if ('pollClosed' in d) await q.query(`UPDATE polls SET closes_at = CASE WHEN $2 THEN LEAST(coalesce(closes_at, now()), now()) ELSE NULL END WHERE thread_id = $1`, [t.id, d.pollClosed]);
    const modFields = ['sticky', 'locked', 'forumId'].filter((k) => k in d);
    const modEdit = basic && !own;
    if (modFields.length || modEdit) {
      await audit(q, req, 'thread.update', 'thread', t.id, Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'notify')));
    }
    if ('forumId' in d && d.notify !== false && d.forumId !== t.forum_id) {
      const f = await q.one('SELECT title FROM forums WHERE id = $1', [d.forumId]);
      await notify(q, { userId: t.author_id, actorId: me.id, type: 'moderation', text: `Your thread "${t.title}" was moved to ${f.title}`, link: `#/threads/${t.id}` });
    }
    if ('locked' in d && d.locked !== t.locked) {
      await notify(q, { userId: t.author_id, actorId: me.id, type: 'moderation', text: `Your thread "${t.title}" was ${d.locked ? 'locked' : 'unlocked'} by a moderator`, link: `#/threads/${t.id}` });
    }
  });
  res.json({ ok: true });
});

router.delete('/threads/:id', async (req, res) => {
  const me = req.user;
  if (!me) throw forbidden();
  const t = await T.loadThread(idParam(req.params.id), me);
  const d = parse(z.object({ reason: z.string().max(100).optional() }).strict(), req.body);
  const own = String(t.author_id) === String(me.id);
  if (!((own && can(me, 'post.delete_own')) || can(me, 'mod.delete_any'))) throw forbidden();
  await db.tx(async (q) => {
    await q.query('UPDATE threads SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [t.id, me.id]);
    if (!own) {
      await audit(q, req, 'thread.delete', 'thread', t.id, { title: t.title, reason: d.reason || '' });
      await notify(q, { userId: t.author_id, actorId: me.id, type: 'moderation', text: `Your thread "${t.title}" was removed by a moderator${d.reason ? ': ' + d.reason : ''}`, link: '#/alerts' });
    }
  });
  res.json({ ok: true, forumId: t.forum_id });
});

router.post('/threads/:id/restore', async (req, res) => {
  assertCan(req.user, 'mod.delete_any');
  const t = await T.loadThread(idParam(req.params.id), req.user);
  await db.tx(async (q) => {
    await q.query('UPDATE threads SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [t.id]);
    await audit(q, req, 'thread.restore', 'thread', t.id, {});
  });
  res.json({ ok: true });
});

router.put('/threads/:id/watch', requireUser, async (req, res) => {
  const t = await T.loadThread(idParam(req.params.id), req.user);
  await db.query('INSERT INTO thread_watches (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, t.id]);
  res.json({ watching: true });
});
router.delete('/threads/:id/watch', requireUser, async (req, res) => {
  const t = await T.loadThread(idParam(req.params.id), req.user);
  await db.query('DELETE FROM thread_watches WHERE user_id = $1 AND thread_id = $2', [req.user.id, t.id]);
  res.json({ watching: false });
});

/* ---------- reply ---------- */

const replySchema = z.object({
  content: content(20000),
  rating: z.number().int().min(1).max(10).nullable().optional(),
}).strict();

router.post('/threads/:id/posts', limits.write, async (req, res) => {
  assertCan(req.user, 'post.reply');
  const me = req.user;
  const t = await T.loadThread(idParam(req.params.id), me);
  if (t.deleted_at) throw notFound('Thread not found.');
  if (t.locked && !can(me, 'mod.lock')) throw forbidden('This thread is locked.');
  const d = parse(replySchema, req.body);
  assertSafeContent(d.content);
  if (d.rating != null) {
    if (!t.rating_enabled) throw invalid('Ratings are not enabled on this thread.');
    if (String(t.author_id) === String(me.id)) throw forbidden('You can\'t rate your own thread.');
  }
  await T.assertNotFlooding(me);
  const check = safety.check(d.content);
  const post = await db.tx(async (q) => {
    if (d.rating != null && await q.one('SELECT 1 FROM posts WHERE thread_id = $1 AND author_id = $2 AND rating IS NOT NULL AND deleted_at IS NULL', [t.id, me.id])) {
      throw forbidden('You have already rated this thread.');
    }
    const p = await q.one('INSERT INTO posts (thread_id, author_id, content, rating) VALUES ($1, $2, $3, $4) RETURNING id, created_at', [t.id, me.id, d.content, d.rating ?? null]);
    await q.query('UPDATE threads SET reply_count = reply_count + 1, last_post_id = $2, last_post_at = $3 WHERE id = $1', [t.id, p.id, p.created_at]);
    const link = `#/threads/${t.id}/post-${p.id}`;
    const watchers = await q.many('SELECT user_id FROM thread_watches WHERE thread_id = $1 AND user_id <> $2', [t.id, me.id]);
    // Watchers only get notified if they can still see the thread (e.g. not after it moved to a private forum and they were logged out — members always can).
    for (const w of watchers) await notify(q, { userId: w.user_id, actorId: me.id, type: 'reply', text: `${me.username} replied to the thread ${t.title}`, link });
    await notifyMentions(q, { content: d.content, actor: me, link, where: t.title, excludeIds: watchers.map((w) => String(w.user_id)) });
    const prefs = await q.one('SELECT auto_watch FROM user_preferences WHERE user_id = $1', [me.id]);
    if (!prefs || prefs.auto_watch) await q.query('INSERT INTO thread_watches (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, t.id]);
    await q.query(`INSERT INTO thread_reads (user_id, thread_id, read_at) VALUES ($1, $2, now()) ON CONFLICT (user_id, thread_id) DO UPDATE SET read_at = now()`, [me.id, t.id]);
    await safety.autoReport(q, 'post', p.id, check.danger);
    await checkTrophies(q, me.id);
    return p;
  });
  res.status(201).json({ post: { id: String(post.id) }, safety: check });
});

module.exports = router;
module.exports.decoratePosts = decoratePosts;
module.exports.threadRows = threadRows;
module.exports.visibleForums = visibleForums;
module.exports.readAllAt = readAllAt;

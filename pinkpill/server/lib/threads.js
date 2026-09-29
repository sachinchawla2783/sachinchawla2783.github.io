'use strict';
const db = require('../db');
const { can } = require('./permissions');
const { visibleForumIds } = require('./forums');
const { notFound, tooMany } = require('./errors');
const settings = require('./settings');

const POSTS_PER_PAGE = 20;
const THREADS_PER_PAGE = 20;
const REACTIONS = ['like', 'love', 'glow', 'haha', 'wow', 'hug', 'sad'];
const PREFIXES = ['question', 'discussion', 'guide', 'routine', 'rateme', 'glowup', 'research', 'serious', 'vent'];

/* Load a thread the viewer is allowed to see, or 404 (never 403, so hidden threads don't leak). */
async function loadThread(id, user, q = db) {
  const t = await q.one('SELECT * FROM threads WHERE id = $1', [id]);
  if (!t) throw notFound('Thread not found.');
  if (t.deleted_at && !can(user, 'mod.view_deleted')) throw notFound('Thread not found.');
  if (!(await visibleForumIds(user, q)).includes(t.forum_id)) throw notFound('Thread not found.');
  return t;
}

async function loadPost(id, user, q = db) {
  const p = await q.one('SELECT * FROM posts WHERE id = $1', [id]);
  if (!p) throw notFound('Post not found.');
  const t = await loadThread(p.thread_id, user, q);
  if (p.deleted_at && !can(user, 'mod.view_deleted')) throw notFound('Post not found.');
  return { post: p, thread: t };
}

/* Recompute a thread's denormalised counters from its visible posts. */
async function refreshThreadStats(q, threadId) {
  await q.query(`UPDATE threads t SET
      reply_count = GREATEST(s.n - 1, 0),
      first_post_id = s.first_id,
      last_post_id = s.last_id,
      last_post_at = coalesce(s.last_at, t.created_at)
    FROM (SELECT count(*)::int AS n,
            (SELECT id FROM posts WHERE thread_id = $1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1) AS first_id,
            (SELECT id FROM posts WHERE thread_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1) AS last_id,
            max(created_at) AS last_at
          FROM posts WHERE thread_id = $1 AND deleted_at IS NULL) s
    WHERE t.id = $1`, [threadId]);
}

/* Server-side flood control (staff exempt). */
async function assertNotFlooding(user, q = db) {
  if (user.isStaff) return;
  const secs = Number(await settings.get('flood_seconds', 10)) || 0;
  if (!secs) return;
  const r = await q.one(`SELECT 1 FROM posts WHERE author_id = $1 AND created_at > now() - ($2 || ' seconds')::interval
    UNION ALL SELECT 1 FROM conversation_messages WHERE author_id = $1 AND created_at > now() - ($2 || ' seconds')::interval LIMIT 1`, [user.id, String(secs)]);
  if (r) throw tooMany(`Please wait ${secs} seconds between messages.`);
}

/* The value of one rep from this user: 1 + 1 per 100 posts (max 5), staff bonus. Never client-supplied. */
async function repPower(userId, role, q = db) {
  const r = await q.one('SELECT count(*)::int AS n FROM posts WHERE author_id = $1 AND deleted_at IS NULL', [userId]);
  const base = Math.min(5, 1 + Math.floor(r.n / 100));
  return base + (role === 'admin' || role === 'super_admin' ? 2 : role === 'moderator' ? 1 : 0);
}

module.exports = { POSTS_PER_PAGE, THREADS_PER_PAGE, REACTIONS, PREFIXES, loadThread, loadPost, refreshThreadStats, assertNotFlooding, repPower };

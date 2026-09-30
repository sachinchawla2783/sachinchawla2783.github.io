'use strict';
const db = require('../db');
const { can } = require('./permissions');
const { visibleForumIds } = require('./forums');
const { notFound, tooMany, HttpError } = require('./errors');
const settings = require('./settings');

const POSTS_PER_PAGE = 20;
const THREADS_PER_PAGE = 20;
const REACTIONS = ['like', 'love', 'glow', 'haha', 'wow', 'hug', 'sad'];
// Custom reactions: only members whose active VIP membership includes custom reactions may use these.
const VIP_REACTIONS = ['fire', 'crown', 'gem', 'butterfly'];
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

/* How long (minutes) this member may edit their own posts. 0 = no limit. VIP+ raises it. */
async function editWindowMinutes(user, q = db) {
  const base = Number(await settings.get('post_edit_window_minutes', 60)) || 0;
  if (!base) return 0;
  const v = user && user.vip && user.vip.editWindowMinutes;
  return v ? Math.max(base, v) : base;
}

function formatMinutes(m) {
  if (m % 1440 === 0) return (m / 1440) + ' day' + (m === 1440 ? '' : 's');
  if (m % 60 === 0) return (m / 60) + ' hour' + (m === 60 ? '' : 's');
  return m + ' minute' + (m === 1 ? '' : 's');
}

/* Own-post edits must happen within the member's edit window (moderators are exempt; callers check). */
async function assertWithinEditWindow(user, post, q = db) {
  const w = await editWindowMinutes(user, q);
  if (w && Date.now() - new Date(post.created_at).getTime() > w * 60000) {
    throw new HttpError(403, 'edit_window_passed', `You can only edit your posts within ${formatMinutes(w)} of posting.` + (user.vip && user.vip.editWindowMinutes ? '' : ' VIP+ members get a 12-hour editing window.'));
  }
}

/* Deleting your own thread in a rating forum once it has replies is a VIP benefit. The caller has
   already checked that the member owns the thread (VIP never allows deleting other people's threads). */
async function assertCanDeleteOwnThread(user, thread, q = db) {
  const f = await q.one('SELECT rating_enabled FROM forums WHERE id = $1', [thread.forum_id]);
  if (!f || !f.rating_enabled) return;
  if (user.vip && user.vip.ratingsDelete) return;
  const max = Number(await settings.get('ratings_delete_max_replies', 0)) || 0;
  if (thread.reply_count > max) {
    throw new HttpError(403, 'vip_required', 'Rating threads that already have replies can only be deleted by VIP members. Ask a moderator if you need it removed.');
  }
}

/* Largest conversation (total participants) this member may create or grow. */
async function participantLimit(user) {
  const base = Number(await settings.get('conversation_max_participants', 10)) || 10;
  const v = user && user.vip && user.vip.conversationLimit;
  return Math.max(base, v || 0);
}

module.exports = { POSTS_PER_PAGE, THREADS_PER_PAGE, REACTIONS, VIP_REACTIONS, PREFIXES, loadThread, loadPost, refreshThreadStats, assertNotFlooding, repPower,
  editWindowMinutes, assertWithinEditWindow, assertCanDeleteOwnThread, participantLimit };

'use strict';
const db = require('../db');
const { rankFor, byId } = require('./trophies');
const vip = require('./vip');
const { nameTier } = require('./nameColors');

const ONLINE_MS = 15 * 60 * 1000;
const avatarUrl = (id) => (id ? '/media/' + id : null);

/* Public summaries (with stats) for a batch of user ids. Never includes email, hashes or tokens. */
async function summaries(ids, q = db) {
  ids = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!ids.length) return {};
  const rows = await q.many(`SELECT u.id, u.username, u.role_id, r.is_staff, u.status, u.created_at, u.last_seen_at, u.special_color, u.special_effect, u.special_access,
      p.custom_title, p.location, p.avatar_id, p.avatar_color, p.signature, coalesce(pr.show_online, true) AS show_online,
      (SELECT count(*)::int FROM posts WHERE author_id = u.id AND deleted_at IS NULL) AS post_count,
      (SELECT count(*)::int FROM reactions rx JOIN posts px ON px.id = rx.post_id WHERE px.author_id = u.id AND px.deleted_at IS NULL AND rx.reaction IN ('like','love','glow','hug')) AS reaction_score,
      (SELECT coalesce(sum(value), 0)::int FROM reputation WHERE receiver_id = u.id) AS rep,
      (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS followers,
      (SELECT coalesce(array_agg(trophy_id), '{}') FROM user_trophies WHERE user_id = u.id) AS trophies,
      EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned
    FROM users u JOIN roles r ON r.id = u.role_id
    LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN user_preferences pr ON pr.user_id = u.id
    WHERE u.id = ANY($1::bigint[])`, [ids]);
  const styles = await vip.publicStyles(rows.filter((r) => r.status !== 'deleted').map((r) => r.id), q);
  const out = {};
  rows.forEach((r) => { out[r.id] = toSummary(r, styles[String(r.id)] || null); });
  return out;
}

function toSummary(r, vipStyle) {
  const deleted = r.status === 'deleted';
  const visibleOnline = r.show_online;
  const points = (r.trophies || []).reduce((a, t) => a + (byId[t] ? byId[t].points : 0), 0);
  return {
    id: String(r.id),
    username: deleted ? 'Deleted member' : r.username,
    deleted,
    role: r.role_id,
    isStaff: r.is_staff,
    customTitle: r.custom_title || '',
    rank: rankFor(r.post_count),
    nameTier: deleted ? 0 : nameTier(r.post_count, r.created_at),
    avatarUrl: deleted ? null : avatarUrl(r.avatar_id),
    color: r.avatar_color || '#ec4899',
    location: deleted ? '' : (r.location || ''),
    signature: deleted ? '' : (r.signature || ''),
    joinedAt: r.created_at,
    lastSeenAt: visibleOnline ? r.last_seen_at : null,
    online: !deleted && visibleOnline && Date.now() - new Date(r.last_seen_at).getTime() < ONLINE_MS,
    banned: r.banned,
    // VIP decoration, computed from active entitlements only (null for non-VIP and expired members).
    vip: deleted ? null : vipStyle,
    // Special colour/effect: the owner's, or a member the owner granted access to; ignored for anyone else.
    special: !deleted && (r.role_id === 'super_admin' || r.special_access) && r.special_color ? { color: r.special_color, effect: r.special_effect || null } : null,
    specialAccess: !deleted && (r.role_id === 'super_admin' || !!r.special_access),
    stats: { posts: r.post_count, reactionScore: r.reaction_score, rep: r.rep, points, followers: r.followers },
  };
}

/* Collect user ids from rows and attach a `users` map to a response. */
async function withUsers(payload, ids) { payload.users = await summaries(ids); return payload; }

module.exports = { summaries, withUsers, avatarUrl, ONLINE_MS };

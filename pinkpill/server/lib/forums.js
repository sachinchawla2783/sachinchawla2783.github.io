'use strict';
const db = require('../db');

/* The forum list is small and read on almost every request, so it's cached briefly in memory
   (single instance). Admin changes call invalidate(); reads inside a transaction bypass the cache. */
let cache = null, cachedAt = 0;
async function allForums(q = db) {
  if (q !== db) return q.many('SELECT * FROM forums ORDER BY position, title');
  if (!cache || Date.now() - cachedAt > 10000) { cache = await db.many('SELECT * FROM forums ORDER BY position, title'); cachedAt = Date.now(); }
  return cache;
}
function invalidate() { cache = null; }

/* May this viewer enter VIP-only forums? Staff always; members only with an active VIP forum entitlement
   (resolved server-side in the session, never from the request). */
const hasVipForumAccess = (user) => !!user && (user.isStaff || !!(user.vip && user.vip.vipForum));

/* Ids of forums this viewer may see. Members-only forums (and their descendants) are hidden from guests;
   VIP-only forums (and their descendants) are hidden from everyone without VIP forum access. */
async function visibleForumIds(user, q = db) {
  const forums = await allForums(q);
  const byId = Object.fromEntries(forums.map((f) => [f.id, f]));
  const vipOk = hasVipForumAccess(user);
  const ok = (f, depth = 0) => !!f && depth < 20 && !(f.members_only && !user) && !(f.vip_only && !vipOk) && (!f.parent_id || ok(byId[f.parent_id], depth + 1));
  return forums.filter((f) => ok(f)).map((f) => f.id);
}

/* Is this forum (or any ancestor) VIP-only? Used to keep notifications about it away from non-VIPs. */
function isVipForum(forums, id) {
  const byId = Object.fromEntries(forums.map((f) => [f.id, f]));
  for (let f = byId[id], i = 0; f && i < 20; f = byId[f.parent_id], i++) if (f.vip_only) return true;
  return false;
}

async function assertForumVisible(forumId, user, q = db) {
  return (await visibleForumIds(user, q)).includes(forumId);
}

function descendants(forums, id) {
  const out = [id];
  forums.filter((f) => f.parent_id === id).forEach((c) => out.push(...descendants(forums, c.id)));
  return out;
}

module.exports = { invalidate, allForums, visibleForumIds, assertForumVisible, descendants, hasVipForumAccess, isVipForum };

'use strict';
const db = require('../db');

async function allForums(q = db) {
  return q.many('SELECT * FROM forums ORDER BY position, title');
}

/* Ids of forums this viewer may see. Members-only forums (and their descendants) are hidden from guests. */
async function visibleForumIds(user, q = db) {
  const forums = await allForums(q);
  const byId = Object.fromEntries(forums.map((f) => [f.id, f]));
  const ok = (f, depth = 0) => !!f && depth < 20 && !(f.members_only && !user) && (!f.parent_id || ok(byId[f.parent_id], depth + 1));
  return forums.filter((f) => ok(f)).map((f) => f.id);
}

async function assertForumVisible(forumId, user, q = db) {
  return (await visibleForumIds(user, q)).includes(forumId);
}

function descendants(forums, id) {
  const out = [id];
  forums.filter((f) => f.parent_id === id).forEach((c) => out.push(...descendants(forums, c.id)));
  return out;
}

module.exports = { allForums, visibleForumIds, assertForumVisible, descendants };

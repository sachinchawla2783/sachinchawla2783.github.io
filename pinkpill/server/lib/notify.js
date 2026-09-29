'use strict';
/* Server-side notifications. Skips self-notifications and users who ignore the actor. */
async function notify(q, { userId, actorId = null, type, text, link = '#/alerts' }) {
  if (!userId || String(userId) === String(actorId)) return;
  await q.query(`INSERT INTO notifications (user_id, actor_id, type, text, link)
    SELECT $1, $2, $3, $4, $5
    WHERE NOT EXISTS (SELECT 1 FROM ignores WHERE user_id = $1 AND ignored_id = $2)
      AND EXISTS (SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted')`,
  [userId, actorId, type, String(text).slice(0, 400), link]);
}

/* @mentions and [quote=Name] in new content. */
async function notifyMentions(q, { content, actor, link, where, excludeIds = [] }) {
  const names = new Set();
  (content.match(/(^|[\s>(])@([A-Za-z0-9_.-]{3,24})/g) || []).forEach((m) => names.add(m.trim().replace(/^[>(]/, '').slice(1).toLowerCase()));
  const quoted = new Set();
  (content.match(/\[quote=([A-Za-z0-9_.-]{3,24})/gi) || []).forEach((m) => quoted.add(m.slice(7).toLowerCase()));
  const all = [...new Set([...names, ...quoted])].slice(0, 20);
  if (!all.length) return;
  const users = await q.many('SELECT id, lower(username::text) AS name FROM users WHERE lower(username::text) = ANY($1) AND status <> $2', [all, 'deleted']);
  for (const u of users) {
    if (excludeIds.includes(String(u.id))) continue;
    if (quoted.has(u.name)) await notify(q, { userId: u.id, actorId: actor.id, type: 'quote', text: `${actor.username} quoted your post in ${where}`, link });
    else await notify(q, { userId: u.id, actorId: actor.id, type: 'mention', text: `${actor.username} mentioned you in ${where}`, link });
  }
}

module.exports = { notify, notifyMentions };

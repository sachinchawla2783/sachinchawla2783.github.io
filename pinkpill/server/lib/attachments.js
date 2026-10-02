'use strict';
/* Image authorization. Avatars and banners are public. Post images are visible to:
 *   - the uploader;
 *   - anyone who can see at least one post / private message / profile post / profile embedding them,
 *     using the same visibility rules as the content itself (members-only forums, deleted content,
 *     conversation participants).
 * Everyone else gets 404, as if the image didn't exist. */
const db = require('../db');
const T = require('./threads');

const MEDIA_RE = /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

/* Replace the references for one piece of content. Only the author's own uploads are linked. */
async function syncRefs(q, refType, refId, content, authorId) {
  await q.query('DELETE FROM attachment_refs WHERE ref_type = $1 AND ref_id = $2', [refType, refId]);
  const ids = [...new Set([...String(content || '').matchAll(MEDIA_RE)].map((m) => m[1]))].slice(0, 50);
  if (!ids.length || !authorId) return;
  await q.query(`INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
    SELECT id, $2, $3 FROM attachments WHERE id = ANY($1::uuid[]) AND owner_id = $4 AND purpose = 'post'
    ON CONFLICT DO NOTHING`, [ids, refType, refId, authorId]);
}

/* Add references without removing existing ones (e.g. a comment under a profile post). */
async function addRefs(q, refType, refId, content, authorId) {
  const ids = [...new Set([...String(content || '').matchAll(MEDIA_RE)].map((m) => m[1]))].slice(0, 50);
  if (!ids.length || !authorId) return;
  await q.query(`INSERT INTO attachment_refs (attachment_id, ref_type, ref_id)
    SELECT id, $2, $3 FROM attachments WHERE id = ANY($1::uuid[]) AND owner_id = $4 AND purpose = 'post'
    ON CONFLICT DO NOTHING`, [ids, refType, refId, authorId]);
}

async function canView(attachment, user) {
  if (attachment.purpose === 'avatar' || attachment.purpose === 'banner') return true;
  if (user && String(attachment.owner_id) === String(user.id)) return true;
  const refs = await db.many('SELECT ref_type, ref_id FROM attachment_refs WHERE attachment_id = $1 LIMIT 50', [attachment.id]);
  for (const r of refs) {
    if (r.ref_type === 'post') {
      try { await T.loadPost(r.ref_id, user); return true; } catch { /* not visible; try the next reference */ }
    } else if (r.ref_type === 'message') {
      if (user && await db.one(`SELECT 1 FROM conversation_messages m JOIN conversation_participants cp
          ON cp.conversation_id = m.conversation_id AND cp.user_id = $2 AND cp.left_at IS NULL WHERE m.id = $1`, [r.ref_id, user.id])) return true;
    } else if (r.ref_type === 'profile_post') {
      if (await db.one('SELECT 1 FROM profile_posts WHERE id = $1 AND deleted_at IS NULL', [r.ref_id])) return true;
    } else if (r.ref_type === 'profile') {
      if (await db.one("SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'", [r.ref_id])) return true;
    }
  }
  return false;
}

module.exports = { syncRefs, addRefs, canView, MEDIA_RE };

'use strict';
/* Imports the browser-only prototype's JSON export (localStorage `pinkpill.db.v1`) into PostgreSQL.
 * The input is treated as untrusted: every field is type-checked and length-limited, ids are remapped,
 * images embedded as data: URLs are decoded and re-encoded through the normal upload pipeline, and
 * imported members never get a staff role (only the owner assigns roles). Imported members have no password; they
 * claim their account with "Forgot your password?". Existing usernames are never overwritten. */
const crypto = require('node:crypto');
const { processImage } = require('./images');
const storage = require('./storage');
const { normalizeTags } = require('./content');
const { syncRefs } = require('./attachments');

const REACTIONS = new Set(['like', 'love', 'glow', 'haha', 'wow', 'hug', 'sad']);
const PREFIXES = new Set(require('./threads').PREFIXES);
// Prefixes from the prototype that were renamed.
const OLD_PREFIX = { routine: 'guide', glowup: 'success', research: 'theory', vent: 'venting' };
const FORUM_ALIASES = { 'f-general': 'f-looks' };

const str = (v, max, dflt = '') => (typeof v === 'string' ? v.slice(0, max) : dflt);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const date = (v) => { const d = new Date(typeof v === 'number' || typeof v === 'string' ? v : NaN); return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d > new Date(Date.now() + 86400000) ? new Date() : d; };

async function storeDataUrl(q, dataUrl, purpose, ownerId) {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return null;
  let img;
  try { img = await processImage(buf, purpose); } catch { return null; }
  const id = crypto.randomUUID();
  await storage.put(id + '.webp', img.buffer, 'image/webp');
  await q.query(`INSERT INTO attachments (id, owner_id, purpose, storage_key, mime, bytes, width, height, sha256) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, $8)`,
    [id, ownerId, purpose, id + '.webp', img.bytes, img.width, img.height, img.sha256]);
  return id;
}

/* Replace embedded data-URL images with uploaded /media images; drop anything else unsafe. */
async function cleanContent(q, text, ownerId, max) {
  let s = str(text, 5 * 1024 * 1024);
  const imgs = [...s.matchAll(/\[img\]\s*(data:[^\[]+?)\s*\[\/img\]/gi)];
  for (const m of imgs) {
    const id = await storeDataUrl(q, m[1], 'post', ownerId);
    s = s.replace(m[0], id ? `[img]/media/${id}[/img]` : '[image removed]');
  }
  s = s.replace(/\[img\]\s*(?!https:\/\/|\/media\/[0-9a-f-]{36}\s*\[)[\s\S]*?\[\/img\]/gi, '[image removed]');
  s = s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*/gi, '');
  s = s.replace(/\[url=\s*(?!https?:\/\/|mailto:|#\/)[^\]]*\]/gi, '[url=#/]');
  s = s.slice(0, max).trim();
  return s || '(empty)';
}

async function importLegacy(q, data, { actorId }) {
  data = obj(data);
  if (!Array.isArray(data.users) || !Array.isArray(data.threads) || !Array.isArray(data.posts)) {
    const e = new Error('This does not look like a PinkPill prototype export (users/threads/posts missing).'); e.status = 422; throw e;
  }
  const counts = { members: 0, threads: 0, posts: 0, reactions: 0, reputation: 0, polls: 0, votes: 0, profilePosts: 0, conversations: 0, messages: 0, follows: 0, bookmarks: 0, warnings: 0, bans: 0 };
  const skipped = [];
  // Prototype-free maps: legacy ids like "__proto__" can't reach Object.prototype.
  const uid = Object.create(null);      // legacy user id -> db id
  const tid = Object.create(null);      // legacy thread id -> db id
  const pid = Object.create(null);      // legacy post id -> db id

  /* ---------- members ---------- */
  for (const u of arr(data.users).slice(0, 50000)) {
    const legacyId = str(u.id, 64);
    const username = str(u.username, 24);
    if (!legacyId || !/^[A-Za-z0-9_.-]{3,24}$/.test(username)) { skipped.push('member with invalid username'); continue; }
    let email = str(u.email, 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) email = null;
    const existing = await q.one('SELECT id, email FROM users WHERE username = $1', [username]);
    if (existing) {
      if (email && existing.email && existing.email.toLowerCase() === email) { uid[legacyId] = existing.id; continue; }
      skipped.push(`member ${username} (username taken)`); continue;
    }
    if (email && await q.one('SELECT 1 FROM users WHERE email = $1', [email])) email = null;
    const role = 'member';
    const row = await q.one(`INSERT INTO users (username, email, password_hash, role_id, status, created_at, last_seen_at)
      VALUES ($1, $2, NULL, $3, 'unverified', $4, $5) RETURNING id`, [username, email, role, date(u.joined), date(u.lastSeen || u.joined)]);
    uid[legacyId] = row.id;
    const avatarId = u.avatar ? await storeDataUrl(q, u.avatar, 'avatar', row.id) : null;
    const bannerId = u.banner ? await storeDataUrl(q, u.banner, 'banner', row.id) : null;
    const bday = /^\d{4}-\d{2}-\d{2}$/.test(str(u.birthday, 10)) ? u.birthday : null;
    const website = /^https?:\/\/\S+$/i.test(str(u.website, 200)) ? str(u.website, 200) : '';
    const color = /^#[0-9a-fA-F]{6}$/.test(str(u.color, 7)) ? u.color : '#ec4899';
    await q.query(`INSERT INTO profiles (user_id, custom_title, bio, location, website, birthday, signature, avatar_id, banner_id, avatar_color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [row.id, str(u.customTitle, 50), await cleanContent(q, u.bio || '', row.id, 5000).then((s) => (s === '(empty)' ? '' : s)), str(u.location, 50), website, bday,
      await cleanContent(q, u.signature || '', row.id, 1000).then((s) => (s === '(empty)' ? '' : s)), avatarId, bannerId, color]);
    const st = obj(u.settings);
    const opt = (v) => (['everyone', 'followed', 'none'].includes(v) ? v : 'everyone');
    await q.query(`INSERT INTO user_preferences (user_id, theme, show_online, allow_dms, allow_profile_posts) VALUES ($1, $2, $3, $4, $5)`,
      [row.id, ['auto', 'light', 'dark'].includes(st.theme) ? st.theme : 'auto', st.showOnline !== false, opt(st.allowDMs), opt(st.allowProfilePosts)]);
    if (u.banned) { await q.query('INSERT INTO bans (user_id, banned_by, reason) VALUES ($1, $2, $3)', [row.id, actorId, str(u.banReason, 300) || 'Imported ban']); counts.bans++; }
    counts.members++;
  }
  const U = (legacy) => uid[str(legacy, 64)] || null;

  /* ---------- social graph ---------- */
  for (const u of arr(data.users)) {
    const me = U(u.id); if (!me) continue;
    for (const f of arr(u.following)) { const o = U(f); if (o && o !== me) { const r = await q.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, o]); counts.follows += r.rowCount; } }
    for (const f of arr(u.ignoring)) { const o = U(f); if (o && o !== me) await q.query('INSERT INTO ignores (user_id, ignored_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, o]); }
    for (const w of arr(u.warnings).slice(0, 100)) {
      await q.query('INSERT INTO warnings (user_id, issued_by, reason, points, created_at) VALUES ($1, $2, $3, $4, $5)', [me, U(w.by), str(w.reason, 300) || 'Imported warning', Math.min(10, Math.max(1, parseInt(w.points, 10) || 1)), date(w.created)]);
      counts.warnings++;
    }
  }

  /* ---------- threads & posts ---------- */
  const forums = new Set((await q.many('SELECT id FROM forums')).map((r) => r.id));
  const postsByThread = Object.create(null);
  arr(data.posts).forEach((p) => { const k = str(p.threadId, 64); (postsByThread[k] = postsByThread[k] || []).push(p); });
  for (const t of arr(data.threads).slice(0, 100000)) {
    const legacyId = str(t.id, 64);
    let forumId = Object.hasOwn(FORUM_ALIASES, str(t.forumId, 40)) ? FORUM_ALIASES[t.forumId] : str(t.forumId, 40);
    if (!forums.has(forumId)) { skipped.push(`thread "${str(t.title, 40)}" (unknown forum ${forumId}, moved to Off-Topic)`); forumId = 'f-offtopic'; }
    let title = str(t.title, 150).trim();
    if (title.length < 3) title = (title + ' (imported)').slice(0, 150);
    const posts = (postsByThread[legacyId] || []).slice().sort((a, b) => date(a.created) - date(b.created));
    if (!posts.length) { skipped.push(`thread "${title.slice(0, 40)}" (no posts)`); continue; }
    const row = await q.one(`INSERT INTO threads (forum_id, author_id, title, prefix, sticky, locked, rating_enabled, view_count, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [forumId, U(t.authorId), title, PREFIXES.has(OLD_PREFIX[t.prefix] || t.prefix) ? (OLD_PREFIX[t.prefix] || t.prefix) : null, !!t.sticky, !!t.locked, !!t.ratingEnabled, Math.max(0, Math.min(1e9, parseInt(t.views, 10) || 0)), date(t.created)]);
    tid[legacyId] = row.id;
    for (const tag of normalizeTags(arr(t.tags).map((x) => str(x, 40)))) await q.query('INSERT INTO thread_tags (thread_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.id, tag]);
    const raters = new Set();
    for (const p of posts) {
      const author = U(p.authorId);
      let rating = Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 10 && t.ratingEnabled && author && !raters.has(author) && author !== U(t.authorId) ? p.rating : null;
      if (rating) raters.add(author);
      const postContent = await cleanContent(q, p.content, author, 20000);
      const pr = await q.one(`INSERT INTO posts (thread_id, author_id, content, rating, created_at, edited_at, edit_reason, deleted_at, delete_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [row.id, author, postContent, rating, date(p.created), p.edited ? date(p.edited) : null, str(p.editReason, 100), p.deleted ? date(p.created) : null, str(p.deleteReason, 100)]);
      pid[str(p.id, 64)] = pr.id;
      await syncRefs(q, 'post', pr.id, postContent, author);
      counts.posts++;
      for (const h of arr(p.history).slice(0, 50)) await q.query('INSERT INTO post_revisions (post_id, content, created_at) VALUES ($1, $2, $3)', [pr.id, await cleanContent(q, h.content, author, 20000), date(h.at)]);
      for (const [who, r] of Object.entries(obj(p.reactions))) {
        const w = U(who);
        if (w && w !== author && REACTIONS.has(r)) { await q.query('INSERT INTO reactions (post_id, user_id, reaction) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [pr.id, w, r]); counts.reactions++; }
      }
    }
    await q.query(`UPDATE threads t SET first_post_id = s.f, last_post_id = s.l, last_post_at = s.at, reply_count = GREATEST(s.n - 1, 0)
      FROM (SELECT min(id) FILTER (WHERE deleted_at IS NULL) AS f, max(id) FILTER (WHERE deleted_at IS NULL) AS l,
                   max(created_at) FILTER (WHERE deleted_at IS NULL) AS at, count(*) FILTER (WHERE deleted_at IS NULL)::int AS n
            FROM posts WHERE thread_id = $1) s WHERE t.id = $1`, [row.id]);
    await q.query('UPDATE threads SET last_post_at = coalesce(last_post_at, created_at) WHERE id = $1', [row.id]);
    const poll = obj(t.poll);
    if (typeof poll.question === 'string' && arr(poll.options).length >= 2) {
      const pl = await q.one('INSERT INTO polls (thread_id, question, allow_multiple, closes_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [row.id, str(poll.question, 200) || 'Poll', !!poll.multiple, poll.closes ? date(poll.closes) : null]);
      const voted = new Set();
      for (const [i, o] of arr(poll.options).slice(0, 50).entries()) {
        const opt = await q.one('INSERT INTO poll_options (poll_id, text, position) VALUES ($1, $2, $3) RETURNING id', [pl.id, str(o.text, 100) || 'Option ' + (i + 1), i]);
        for (const v of arr(o.votes)) {
          const w = U(v);
          if (!w || (!poll.multiple && voted.has(w))) continue;
          voted.add(w);
          await q.query('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [pl.id, opt.id, w]);
          counts.votes++;
        }
      }
      counts.polls++;
    }
    counts.threads++;
  }

  /* ---------- per-user thread state ---------- */
  for (const u of arr(data.users)) {
    const me = U(u.id); if (!me) continue;
    for (const b of arr(u.bookmarks)) { const p = pid[str(b, 64)]; if (p) { await q.query('INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, p]); counts.bookmarks++; } }
    for (const w of arr(u.watched)) { const t = tid[str(w, 64)]; if (t) await q.query('INSERT INTO thread_watches (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, t]); }
  }

  /* ---------- reputation (values re-validated) ---------- */
  for (const r of arr(data.reps)) {
    const p = pid[str(r.postId, 64)], g = U(r.fromId), to = U(r.toId);
    const v = Math.max(-10, Math.min(10, parseInt(r.value, 10) || 0));
    if (!p || !g || !to || g === to || !v) continue;
    const owner = await q.one('SELECT author_id FROM posts WHERE id = $1', [p]);
    if (!owner || String(owner.author_id) !== String(to)) continue;
    const ins = await q.query('INSERT INTO reputation (post_id, giver_id, receiver_id, value, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', [p, g, to, v, str(r.comment, 200), date(r.created)]);
    counts.reputation += ins.rowCount;
  }

  /* ---------- profile posts ---------- */
  for (const pp of arr(data.profilePosts)) {
    const owner = U(pp.profileUserId); if (!owner) continue;
    const author = U(pp.authorId);
    const ppContent = await cleanContent(q, pp.content, author, 2000);
    const row = await q.one('INSERT INTO profile_posts (profile_user_id, author_id, content, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [owner, author, ppContent, date(pp.created)]);
    await syncRefs(q, 'profile_post', row.id, ppContent, author);
    for (const c of arr(pp.comments)) await q.query('INSERT INTO profile_post_comments (profile_post_id, author_id, content, created_at) VALUES ($1, $2, $3, $4)', [row.id, U(c.authorId), await cleanContent(q, c.content, U(c.authorId), 1000), date(c.created)]);
    for (const [who, r] of Object.entries(obj(pp.reactions))) { const w = U(who); if (w && w !== author && REACTIONS.has(r)) await q.query('INSERT INTO profile_post_reactions (profile_post_id, user_id, reaction) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [row.id, w, r]); }
    counts.profilePosts++;
  }

  /* ---------- conversations ---------- */
  for (const c of arr(data.conversations)) {
    const parts = [...new Set(arr(c.participants).map(U).filter(Boolean))];
    const msgs = arr(c.messages);
    if (parts.length < 2 || !msgs.length) continue;
    const last = msgs.reduce((a, m) => Math.max(a, date(m.created).getTime()), 0);
    const row = await q.one('INSERT INTO conversations (title, starter_id, allow_invite, created_at, last_message_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [str(c.title, 100) || 'Conversation', U(c.starterId), !!c.allowInvite, date(msgs[0].created), new Date(last)]);
    const left = new Set(arr(c.left).map(U)), starred = new Set(arr(c.starred).map(U));
    for (const p of parts) await q.query('INSERT INTO conversation_participants (conversation_id, user_id, starred, left_at, last_read_at) VALUES ($1, $2, $3, $4, $5)', [row.id, p, starred.has(p), left.has(p) ? new Date() : null, new Date(last)]);
    for (const m of msgs.slice(0, 10000)) {
      const mc = await cleanContent(q, m.content, U(m.authorId), 20000);
      const mr = await q.one('INSERT INTO conversation_messages (conversation_id, author_id, content, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [row.id, U(m.authorId), mc, date(m.created)]);
      await syncRefs(q, 'message', mr.id, mc, U(m.authorId));
      counts.messages++;
    }
    counts.conversations++;
  }

  return { imported: counts, skipped };
}

module.exports = { importLegacy };

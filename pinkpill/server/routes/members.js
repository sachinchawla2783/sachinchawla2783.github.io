'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam, content } = require('../lib/validate');
const { can, assertCan, requireUser } = require('../lib/permissions');
const { summaries } = require('../lib/users');
const { visibleForumIds } = require('../lib/forums');
const { forbidden, notFound } = require('../lib/errors');
const { assertSafeContent } = require('../lib/content');
const { notify, notifyMentions } = require('../lib/notify');
const { checkTrophies, TROPHIES, byId: trophyById } = require('../lib/trophies');
const limits = require('../lib/limits');
const T = require('../lib/threads');
const { syncRefs, addRefs } = require('../lib/attachments');

const router = express.Router();

async function loadMember(id) {
  const u = await db.one(`SELECT u.id, u.status, u.role_id, r.rank FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [idParam(id)]);
  if (!u) throw notFound('Member not found.');
  return u;
}

async function relation(viewer, targetId) {
  if (!viewer) return { following: false, ignoring: false, followsYou: false };
  const r = await db.one(`SELECT
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following,
      EXISTS (SELECT 1 FROM ignores WHERE user_id = $1 AND ignored_id = $2) AS ignoring,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS follows_you,
      EXISTS (SELECT 1 FROM ignores WHERE user_id = $2 AND ignored_id = $1) AS ignored_by`, [viewer.id, targetId]);
  return { following: r.following, ignoring: r.ignoring, followsYou: r.follows_you, ignoredBy: r.ignored_by };
}

/* May `viewer` message / post on the profile of target, given target's privacy settings? */
async function allowedBy(setting, viewer, targetId) {
  if (!viewer || String(viewer.id) === String(targetId)) return !!viewer;
  if (viewer.isStaff) return true;
  const rel = await relation(viewer, targetId);
  if (rel.ignoredBy) return false;
  if (setting === 'none') return false;
  if (setting === 'followed') return rel.followsYou;
  return true;
}

/* ---------- member lists ---------- */

router.get('/members', async (req, res) => {
  const q = parse(z.object({ tab: z.enum(['notable', 'list', 'staff', 'online']).default('notable'), sort: z.enum(['joined', 'messages', 'reactions', 'rep', 'name']).default('joined'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strip(), req.query);
  const active = "u.status <> 'deleted'";
  const notBanned = req.user && req.user.isStaff ? 'true' : `NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now()))`;
  const base = `${active} AND ${notBanned}`;
  const ids = async (sql, params = []) => (await db.many(sql, params)).map((r) => r.id);
  let payload = {};
  if (q.tab === 'notable') {
    payload = {
      mostMessages: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) DESC, u.id LIMIT 8`),
      mostReactions: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY (SELECT count(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = u.id AND r.reaction IN ('like','love','glow','hug')) DESC, u.id LIMIT 8`),
      mostRep: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY (SELECT coalesce(sum(value), 0) FROM reputation WHERE receiver_id = u.id) DESC, u.id LIMIT 8`),
      mostPoints: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY (SELECT count(*) FROM user_trophies WHERE user_id = u.id) DESC, u.id LIMIT 8`),
      newest: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY u.created_at DESC LIMIT 8`),
      birthdays: await ids(`SELECT u.id FROM users u JOIN profiles p ON p.user_id = u.id WHERE ${base}
        AND extract(month FROM p.birthday) = extract(month FROM now()) AND extract(day FROM p.birthday) = extract(day FROM now()) LIMIT 20`),
    };
  } else if (q.tab === 'list') {
    const order = {
      joined: 'u.created_at DESC', name: 'lower(u.username::text) ASC',
      messages: '(SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) DESC',
      reactions: "(SELECT count(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = u.id AND r.reaction IN ('like','love','glow','hug')) DESC",
      rep: '(SELECT coalesce(sum(value), 0) FROM reputation WHERE receiver_id = u.id) DESC',
    }[q.sort];
    payload = {
      list: await ids(`SELECT u.id FROM users u WHERE ${base} ORDER BY ${order}, u.id LIMIT 50 OFFSET $1`, [(q.page - 1) * 50]),
      total: (await db.one(`SELECT count(*)::int AS n FROM users u WHERE ${base}`)).n, page: q.page, perPage: 50,
    };
  } else if (q.tab === 'staff') {
    payload = {
      admins: await ids(`SELECT u.id FROM users u WHERE ${active} AND u.role_id IN ('admin', 'super_admin') ORDER BY u.created_at`),
      moderators: await ids(`SELECT u.id FROM users u WHERE ${active} AND u.role_id = 'moderator' ORDER BY u.created_at`),
    };
  } else {
    payload = await onlineList(req.user, 60);
  }
  const all = Object.values(payload).filter(Array.isArray).flat().concat((payload.online || []).map((o) => o.userId));
  payload.users = await summaries(all);
  res.json(payload);
});

async function onlineList(viewer, minutes) {
  const rows = await db.many(`SELECT u.id, u.last_seen_at, u.activity_type, u.activity_ref FROM users u JOIN user_preferences p ON p.user_id = u.id
    WHERE u.status <> 'deleted' AND p.show_online AND u.last_seen_at > now() - ($1 || ' minutes')::interval ORDER BY u.last_seen_at DESC LIMIT 200`, [String(minutes)]);
  const visible = await visibleForumIds(viewer);
  const threadIds = rows.filter((r) => r.activity_type === 'thread' && /^\d+$/.test(r.activity_ref || '')).map((r) => r.activity_ref);
  const threads = threadIds.length ? await db.many('SELECT id, title, forum_id, deleted_at FROM threads WHERE id = ANY($1)', [threadIds]) : [];
  const tById = Object.fromEntries(threads.map((t) => [String(t.id), t]));
  return {
    online: rows.map((r) => {
      let activity = 'Browsing the forum';
      const t = tById[r.activity_ref];
      if (r.activity_type === 'thread' && t) activity = visible.includes(t.forum_id) && !t.deleted_at ? { text: 'Viewing thread', threadId: String(t.id), title: t.title } : 'Viewing a private thread';
      return { userId: r.id, at: r.last_seen_at, activity };
    }),
  };
}
router.get('/online', async (req, res) => {
  const payload = await onlineList(req.user, 60);
  payload.users = await summaries(payload.online.map((o) => o.userId));
  res.json(payload);
});

router.get('/members/lookup', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(24).default('') }).strip(), req.query);
  if (!q) return res.json({ members: [] });
  const rows = await db.many(`SELECT id, username FROM users WHERE status <> 'deleted' AND username ILIKE $1 ESCAPE '\\' ORDER BY length(username::text), username LIMIT 10`,
    [q.replace(/[\\%_]/g, (c) => '\\' + c) + '%']);
  res.json({ members: rows.map((r) => ({ id: String(r.id), username: r.username })) });
});

router.get('/members/by-name/:name', async (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) throw notFound('Member not found.');
  const u = await db.one(`SELECT id FROM users WHERE username = $1 AND status <> 'deleted'`, [name]);
  if (!u) throw notFound('Member not found.');
  res.json({ id: String(u.id) });
});

/* ---------- profile ---------- */

router.get('/members/:id', async (req, res) => {
  const m = await loadMember(req.params.id);
  const [user] = Object.values(await summaries([m.id]));
  const p = await db.one(`SELECT p.bio, p.website, p.birthday, p.banner_id, pr.allow_dms, pr.allow_profile_posts
    FROM profiles p JOIN user_preferences pr ON pr.user_id = p.user_id WHERE p.user_id = $1`, [m.id]);
  const deleted = m.status === 'deleted';
  const me = req.user;
  const rel = await relation(me, m.id);
  const isMe = me && String(me.id) === String(m.id);
  const trophies = await db.many('SELECT trophy_id, awarded_at FROM user_trophies WHERE user_id = $1 ORDER BY awarded_at', [m.id]);
  const ban = can(me, 'mod.ban') ? await db.one(`SELECT reason, expires_at FROM bans WHERE user_id = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`, [m.id]) : null;
  res.json({
    user,
    profile: deleted || !p ? { bio: '', website: '', birthday: null, bannerUrl: null } : {
      bio: p.bio, website: p.website,
      // Only month/day are public; the year stays private.
      birthday: p.birthday ? { month: p.birthday.getUTCMonth() + 1, day: p.birthday.getUTCDate() } : null,
      bannerUrl: p.banner_id ? '/media/' + p.banner_id : null,
    },
    counts: {
      threads: (await db.one('SELECT count(*)::int AS n FROM threads WHERE author_id = $1 AND deleted_at IS NULL', [m.id])).n,
      following: (await db.one('SELECT count(*)::int AS n FROM follows WHERE follower_id = $1', [m.id])).n,
      warningPoints: can(me, 'mod.warn') ? (await db.one('SELECT coalesce(sum(points), 0)::int AS n FROM warnings WHERE user_id = $1', [m.id])).n : undefined,
    },
    trophies: trophies.filter((t) => trophyById[t.trophy_id]).map((t) => Object.assign({ awardedAt: t.awarded_at }, pick(trophyById[t.trophy_id]))),
    relation: rel,
    ban: ban ? { reason: ban.reason, expiresAt: ban.expires_at } : null,
    permissions: {
      isMe: !!isMe,
      follow: !!me && !isMe && !deleted,
      ignore: !!me && !isMe && !user.isStaff && !deleted,
      message: !deleted && !isMe && can(me, 'conversation.start') && p && await allowedBy(p.allow_dms, me, m.id),
      profilePost: !deleted && can(me, 'profile_post.create') && p && await allowedBy(p.allow_profile_posts, me, m.id),
      report: !!me && !isMe && can(me, 'report.create'),
      warn: !isMe && can(me, 'mod.warn') && me.rank > m.rank,
      ban: !isMe && can(me, 'mod.ban') && me.rank > m.rank,
      setRole: !isMe && can(me, 'admin.users') && me.rank > m.rank,
      viewWarnings: can(me, 'mod.warn'),
    },
  });
});
const pick = (t) => ({ id: t.id, title: t.title, desc: t.desc, points: t.points });

router.get('/trophies', (req, res) => res.json({ trophies: TROPHIES.map(pick), ranks: require('../lib/trophies').RANKS }));

router.get('/members/:id/followers', async (req, res) => {
  const m = await loadMember(req.params.id);
  const ids = (await db.many('SELECT follower_id AS id FROM follows WHERE followee_id = $1 ORDER BY created_at DESC LIMIT 500', [m.id])).map((r) => r.id);
  res.json({ ids, users: await summaries(ids) });
});
router.get('/members/:id/following', async (req, res) => {
  const m = await loadMember(req.params.id);
  const ids = (await db.many('SELECT followee_id AS id FROM follows WHERE follower_id = $1 ORDER BY created_at DESC LIMIT 500', [m.id])).map((r) => r.id);
  res.json({ ids, users: await summaries(ids) });
});

router.get('/members/:id/reputation', async (req, res) => {
  const m = await loadMember(req.params.id);
  const visible = await visibleForumIds(req.user);
  const rows = await db.many(`SELECT r.id, r.giver_id, r.value, r.comment, r.created_at, r.post_id,
      CASE WHEN t.forum_id = ANY($2) AND t.deleted_at IS NULL AND p.deleted_at IS NULL THEN t.id END AS thread_id,
      CASE WHEN t.forum_id = ANY($2) AND t.deleted_at IS NULL AND p.deleted_at IS NULL THEN t.title END AS thread_title
    FROM reputation r JOIN posts p ON p.id = r.post_id JOIN threads t ON t.id = p.thread_id
    WHERE r.receiver_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [m.id, visible]);
  const totals = await db.one(`SELECT coalesce(sum(value), 0)::int AS total, count(*) FILTER (WHERE value > 0)::int AS pos, count(*) FILTER (WHERE value < 0)::int AS neg FROM reputation WHERE receiver_id = $1`, [m.id]);
  const u = await db.one('SELECT role_id FROM users WHERE id = $1', [m.id]);
  res.json({
    totals: Object.assign(totals, { power: await T.repPower(m.id, u.role_id) }),
    reputation: rows.map((r) => ({
      id: String(r.id), giverId: r.giver_id, value: r.value, comment: r.comment, at: r.created_at,
      postId: r.thread_id ? String(r.post_id) : null, threadId: r.thread_id ? String(r.thread_id) : null, threadTitle: r.thread_title || null,
      canRemove: !!req.user && (String(r.giver_id) === String(req.user.id) || can(req.user, 'mod.edit_any')),
    })),
    users: await summaries(rows.map((r) => r.giver_id)),
  });
});

router.get('/members/:id/warnings', async (req, res) => {
  assertCan(req.user, 'mod.warn');
  const m = await loadMember(req.params.id);
  const rows = await db.many('SELECT id, issued_by, reason, points, created_at FROM warnings WHERE user_id = $1 ORDER BY created_at DESC', [m.id]);
  res.json({ warnings: rows.map((w) => ({ id: String(w.id), issuedBy: w.issued_by, reason: w.reason, points: w.points, at: w.created_at })), users: await summaries(rows.map((w) => w.issued_by)) });
});

/* Activity feed: posts, threads and profile posts the viewer may see. */
async function activity(viewer, { authorIds = null, postsOnly = false, limit = 30, before = null } = {}) {
  const visible = await visibleForumIds(viewer);
  const params = [visible, limit];
  let authorSql = '';
  if (authorIds) { params.push(authorIds); authorSql = `AND p.author_id = ANY($${params.length}::bigint[])`; }
  const posts = await db.many(`SELECT p.id, p.thread_id, p.author_id, p.content, p.created_at, t.title, t.prefix, t.forum_id, f.title AS forum_title,
      (t.first_post_id = p.id) AS is_first
    FROM posts p JOIN threads t ON t.id = p.thread_id JOIN forums f ON f.id = t.forum_id
    WHERE p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.forum_id = ANY($1) ${authorSql}
    ORDER BY p.created_at DESC LIMIT $2`, params);
  let items = posts.map((p) => ({
    kind: p.is_first ? 'thread' : 'post', id: String(p.id), threadId: String(p.thread_id), threadTitle: p.title, prefix: p.prefix,
    forumId: p.forum_id, forumTitle: p.forum_title, authorId: p.author_id, content: p.content.slice(0, 600), at: p.created_at,
  }));
  if (!postsOnly) {
    const pp = await db.many(`SELECT id, profile_user_id, author_id, content, created_at FROM profile_posts
      WHERE deleted_at IS NULL ${authorIds ? 'AND author_id = ANY($2::bigint[])' : ''} ORDER BY created_at DESC LIMIT $1`, authorIds ? [limit, authorIds] : [limit]);
    items = items.concat(pp.map((p) => ({ kind: 'profile_post', id: String(p.id), profileUserId: p.profile_user_id, authorId: p.author_id, content: p.content.slice(0, 600), at: p.created_at })));
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  items = items.slice(0, limit);
  return { items, users: await summaries(items.flatMap((i) => [i.authorId, i.profileUserId])) };
}
router.get('/members/:id/activity', async (req, res) => {
  const m = await loadMember(req.params.id);
  res.json(await activity(req.user, { authorIds: [m.id] }));
});
router.get('/members/:id/postings', async (req, res) => {
  const m = await loadMember(req.params.id);
  res.json(await activity(req.user, { authorIds: [m.id], postsOnly: true, limit: 50 }));
});

/* ---------- follow / ignore ---------- */

router.put('/members/:id/follow', requireUser, limits.write, async (req, res) => {
  const m = await loadMember(req.params.id);
  if (String(m.id) === String(req.user.id) || m.status === 'deleted') throw forbidden('You can\'t follow this member.');
  await db.tx(async (q) => {
    const r = await q.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, m.id]);
    if (r.rowCount) {
      await notify(q, { userId: m.id, actorId: req.user.id, type: 'follow', text: `${req.user.username} started following you.`, link: `#/members/${req.user.id}` });
      await checkTrophies(q, m.id);
    }
  });
  res.json({ following: true });
});
router.delete('/members/:id/follow', requireUser, async (req, res) => {
  const m = await loadMember(req.params.id);
  await db.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.user.id, m.id]);
  res.json({ following: false });
});
router.put('/members/:id/ignore', requireUser, async (req, res) => {
  const m = await loadMember(req.params.id);
  if (String(m.id) === String(req.user.id)) throw forbidden('You can\'t ignore yourself.');
  const role = await db.one('SELECT r.is_staff FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [m.id]);
  if (role.is_staff) throw forbidden('Staff members cannot be ignored.');
  await db.query('INSERT INTO ignores (user_id, ignored_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, m.id]);
  res.json({ ignoring: true });
});
router.delete('/members/:id/ignore', requireUser, async (req, res) => {
  const m = await loadMember(req.params.id);
  await db.query('DELETE FROM ignores WHERE user_id = $1 AND ignored_id = $2', [req.user.id, m.id]);
  res.json({ ignoring: false });
});

/* ---------- profile posts ---------- */

async function profilePostsJson(where, params, viewer) {
  const rows = await db.many(`SELECT * FROM profile_posts WHERE deleted_at IS NULL AND ${where} ORDER BY created_at DESC LIMIT 50`, params);
  const ids = rows.map((r) => r.id);
  const comments = ids.length ? await db.many('SELECT * FROM profile_post_comments WHERE profile_post_id = ANY($1) ORDER BY created_at', [ids]) : [];
  const reacts = ids.length ? await db.many('SELECT profile_post_id, user_id, reaction FROM profile_post_reactions WHERE profile_post_id = ANY($1)', [ids]) : [];
  const out = rows.map((r) => ({
    id: String(r.id), profileUserId: r.profile_user_id, authorId: r.author_id, content: r.content, at: r.created_at,
    comments: comments.filter((c) => c.profile_post_id === r.id).map((c) => ({ id: String(c.id), authorId: c.author_id, content: c.content, at: c.created_at })),
    reactions: reacts.filter((x) => x.profile_post_id === r.id).map((x) => ({ userId: x.user_id, reaction: x.reaction })),
    canDelete: !!viewer && (String(viewer.id) === String(r.author_id) || String(viewer.id) === String(r.profile_user_id) || can(viewer, 'mod.delete_any')),
  }));
  return { profilePosts: out, users: await summaries(out.flatMap((p) => [p.authorId, p.profileUserId, ...p.comments.map((c) => c.authorId), ...p.reactions.map((x) => x.userId)])) };
}
router.get('/members/:id/profile-posts', async (req, res) => {
  const m = await loadMember(req.params.id);
  res.json(await profilePostsJson('profile_user_id = $1', [m.id], req.user));
});
router.get('/profile-posts', async (req, res) => { res.json(await profilePostsJson('true', [], req.user)); });

router.post('/members/:id/profile-posts', limits.write, async (req, res) => {
  assertCan(req.user, 'profile_post.create');
  const m = await loadMember(req.params.id);
  const d = parse(z.object({ content: content(2000) }).strict(), req.body);
  assertSafeContent(d.content);
  const p = await db.one('SELECT allow_profile_posts FROM user_preferences WHERE user_id = $1', [m.id]);
  if (m.status === 'deleted' || !p || !(await allowedBy(p.allow_profile_posts, req.user, m.id))) throw forbidden('You can\'t post on this profile.');
  const row = await db.tx(async (q) => {
    const r = await q.one('INSERT INTO profile_posts (profile_user_id, author_id, content) VALUES ($1, $2, $3) RETURNING id', [m.id, req.user.id, d.content]);
    await syncRefs(q, 'profile_post', r.id, d.content, req.user.id);
    await notify(q, { userId: m.id, actorId: req.user.id, type: 'profile-post', text: `${req.user.username} wrote on your profile.`, link: `#/members/${m.id}` });
    await notifyMentions(q, { content: d.content, actor: req.user, link: `#/members/${m.id}`, where: 'a profile post', excludeIds: [String(m.id)] });
    return r;
  });
  res.status(201).json({ id: String(row.id) });
});

async function loadProfilePost(id) {
  const pp = await db.one('SELECT * FROM profile_posts WHERE id = $1 AND deleted_at IS NULL', [idParam(id)]);
  if (!pp) throw notFound();
  return pp;
}

router.post('/profile-posts/:id/comments', limits.write, async (req, res) => {
  assertCan(req.user, 'profile_post.create');
  const pp = await loadProfilePost(req.params.id);
  const d = parse(z.object({ content: content(1000) }).strict(), req.body);
  assertSafeContent(d.content);
  const ign = await db.one('SELECT 1 FROM ignores WHERE user_id = $1 AND ignored_id = $2', [pp.profile_user_id, req.user.id]);
  if (ign) throw forbidden('You can\'t comment here.');
  await db.tx(async (q) => {
    await q.query('INSERT INTO profile_post_comments (profile_post_id, author_id, content) VALUES ($1, $2, $3)', [pp.id, req.user.id, d.content]);
    await addRefs(q, 'profile_post', pp.id, d.content, req.user.id);
    const link = `#/members/${pp.profile_user_id}`;
    await notify(q, { userId: pp.author_id, actorId: req.user.id, type: 'profile-comment', text: `${req.user.username} commented on your profile post.`, link });
    if (String(pp.profile_user_id) !== String(pp.author_id)) await notify(q, { userId: pp.profile_user_id, actorId: req.user.id, type: 'profile-comment', text: `${req.user.username} commented on a post on your profile.`, link });
  });
  res.status(201).json({ ok: true });
});

router.delete('/profile-posts/:id', requireUser, async (req, res) => {
  const pp = await loadProfilePost(req.params.id);
  const me = req.user;
  const mine = String(pp.author_id) === String(me.id) || String(pp.profile_user_id) === String(me.id);
  if (!mine && !can(me, 'mod.delete_any')) throw forbidden();
  await db.tx(async (q) => {
    await q.query('UPDATE profile_posts SET deleted_at = now() WHERE id = $1', [pp.id]);
    if (!mine) await require('../lib/audit').audit(q, req, 'profile_post.delete', 'profile_post', pp.id, {});
  });
  res.json({ ok: true });
});

router.put('/profile-posts/:id/reaction', limits.write, async (req, res) => {
  assertCan(req.user, 'post.react');
  const pp = await loadProfilePost(req.params.id);
  if (String(pp.author_id) === String(req.user.id)) throw forbidden('You can\'t react to your own content.');
  const { reaction } = parse(z.object({ reaction: z.enum(T.REACTIONS) }).strict(), req.body);
  await db.query(`INSERT INTO profile_post_reactions (profile_post_id, user_id, reaction) VALUES ($1, $2, $3)
    ON CONFLICT (profile_post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction`, [pp.id, req.user.id, reaction]);
  res.json({ reaction });
});
router.delete('/profile-posts/:id/reaction', requireUser, async (req, res) => {
  await db.query('DELETE FROM profile_post_reactions WHERE profile_post_id = $1 AND user_id = $2', [idParam(req.params.id), req.user.id]);
  res.json({ reaction: null });
});

/* ---------- the viewer's own lists ---------- */

router.get('/account/bookmarks', requireUser, async (req, res) => {
  const visible = await visibleForumIds(req.user);
  const rows = await db.many(`SELECT p.id, p.thread_id, p.author_id, p.content, p.created_at, t.title FROM bookmarks b
    JOIN posts p ON p.id = b.post_id JOIN threads t ON t.id = p.thread_id
    WHERE b.user_id = $1 AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.forum_id = ANY($2) ORDER BY b.created_at DESC`, [req.user.id, visible]);
  res.json({ bookmarks: rows.map((r) => ({ postId: String(r.id), threadId: String(r.thread_id), threadTitle: r.title, authorId: r.author_id, content: r.content.slice(0, 400), at: r.created_at })), users: await summaries(rows.map((r) => r.author_id)) });
});

router.get('/account/watched', requireUser, async (req, res) => {
  const visible = await visibleForumIds(req.user);
  const { threadRows } = require('./forums');
  const threads = await threadRows('t.deleted_at IS NULL AND t.forum_id = ANY($1) AND EXISTS (SELECT 1 FROM thread_watches w WHERE w.thread_id = t.id AND w.user_id = $2)', [visible, req.user.id], req.user, 't.last_post_at DESC', 200, 0);
  res.json({ threads, users: await summaries(threads.flatMap((t) => [t.authorId, t.lastPost && t.lastPost.userId])) });
});

router.get('/account/following', requireUser, async (req, res) => {
  const ids = (await db.many('SELECT followee_id AS id FROM follows WHERE follower_id = $1 ORDER BY created_at DESC', [req.user.id])).map((r) => r.id);
  res.json({ ids, users: await summaries(ids) });
});
router.get('/account/ignoring', requireUser, async (req, res) => {
  const ids = (await db.many('SELECT ignored_id AS id FROM ignores WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id])).map((r) => r.id);
  res.json({ ids, users: await summaries(ids) });
});
router.get('/account/warnings', requireUser, async (req, res) => {
  const rows = await db.many('SELECT id, reason, points, created_at FROM warnings WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ warnings: rows.map((w) => ({ id: String(w.id), reason: w.reason, points: w.points, at: w.created_at })) });
});

module.exports = router;
module.exports.activity = activity;
module.exports.onlineList = onlineList;
module.exports.profilePostsJson = profilePostsJson;

'use strict';
const express = require('express');
const db = require('../db');
const { z, parse, idParam, slugParam } = require('../lib/validate');
const { assertCan, roles, invalidateRoles } = require('../lib/permissions');
const { forbidden, notFound, conflict, invalid } = require('../lib/errors');
const { notify } = require('../lib/notify');
const { audit } = require('../lib/audit');
const settings = require('../lib/settings');
const { allForums, descendants } = require('../lib/forums');

const router = express.Router();

/* Every permission the application knows about; roles can only be granted these. */
const KNOWN_PERMISSIONS = [
  'thread.create', 'post.reply', 'post.edit_own', 'post.delete_own', 'post.react', 'rep.give', 'rep.give_negative',
  'poll.create', 'poll.vote', 'conversation.start', 'upload.image', 'report.create', 'profile_post.create',
  'mod.view_reports', 'mod.edit_any', 'mod.delete_any', 'mod.view_deleted', 'mod.lock', 'mod.sticky', 'mod.move',
  'mod.warn', 'mod.ban', 'mod.view_log', 'forum.post_staff_only',
  'admin.users', 'admin.forums', 'admin.settings', 'admin.stats', 'admin.import', 'admin.permissions',
];

/* ---------- dashboard ---------- */

router.get('/stats', async (req, res) => {
  assertCan(req.user, 'admin.stats');
  const s = await db.one(`SELECT
      (SELECT count(*)::int FROM users WHERE status <> 'deleted') AS members,
      (SELECT count(*)::int FROM users WHERE status = 'unverified') AS unverified,
      (SELECT count(*)::int FROM threads WHERE deleted_at IS NULL) AS threads,
      (SELECT count(*)::int FROM posts WHERE deleted_at IS NULL) AS posts,
      (SELECT count(*)::int FROM profile_posts WHERE deleted_at IS NULL) AS profile_posts,
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
      (SELECT count(*)::int FROM bans WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active_bans,
      (SELECT coalesce(sum(bytes), 0)::bigint FROM attachments) AS upload_bytes,
      (SELECT count(*)::int FROM users WHERE last_seen_at > now() - interval '15 minutes') AS online`);
  const days = await db.many(`SELECT d::date AS day, (SELECT count(*)::int FROM posts WHERE created_at >= d AND created_at < d + interval '1 day') AS posts,
      (SELECT count(*)::int FROM users WHERE created_at >= d AND created_at < d + interval '1 day') AS signups
    FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`);
  res.json({ stats: s, days });
});

/* ---------- users & roles ---------- */

router.get('/users', async (req, res) => {
  assertCan(req.user, 'admin.users');
  const { q } = parse(z.object({ q: z.string().trim().max(254).default('') }).strip(), req.query);
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const rows = await db.many(`SELECT u.id, u.username, u.email, u.status, u.role_id, u.created_at, u.last_seen_at FROM users u
    WHERE u.status <> 'deleted' AND (u.username ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\') ORDER BY u.created_at DESC LIMIT 100`, [like]);
  res.json({ users: rows.map((r) => ({ id: String(r.id), username: r.username, email: r.email, status: r.status, role: r.role_id, joinedAt: r.created_at, lastSeenAt: r.last_seen_at })) });
});

router.patch('/users/:id/role', async (req, res) => {
  assertCan(req.user, 'admin.users');
  const { role } = parse(z.object({ role: z.string().regex(/^[a-z_]{2,32}$/) }).strict(), req.body);
  const all = await roles();
  const target = await db.one('SELECT u.id, u.username, u.role_id, u.status FROM users u WHERE u.id = $1', [idParam(req.params.id)]);
  if (!target || target.status === 'deleted') throw notFound('Member not found.');
  if (!all[role]) throw invalid('Unknown role.');
  if (String(target.id) === String(req.user.id)) throw forbidden('You can\'t change your own role.');
  // Nobody can touch someone of equal/higher rank, or grant a role at/above their own rank.
  if (all[target.role_id].rank >= req.user.rank) throw forbidden('You can\'t change the role of a member of equal or higher rank.');
  if (all[role].rank >= req.user.rank) throw forbidden('You can\'t grant a role equal to or above your own.');
  await db.tx(async (q) => {
    await q.query('UPDATE users SET role_id = $2, updated_at = now() WHERE id = $1', [target.id, role]);
    await audit(q, req, 'user.role', 'user', target.id, { username: target.username, from: target.role_id, to: role });
    await notify(q, { userId: target.id, type: 'moderation', text: `Your user group is now: ${all[role].title}`, link: '#/' });
  });
  res.json({ ok: true });
});

router.get('/roles', async (req, res) => {
  assertCan(req.user, 'admin.users');
  const all = await roles();
  res.json({
    roles: Object.values(all).sort((a, b) => a.rank - b.rank).map((r) => ({ id: r.id, title: r.title, rank: r.rank, isStaff: r.isStaff, permissions: [...r.permissions].sort() })),
    knownPermissions: KNOWN_PERMISSIONS,
    canEditPermissions: require('../lib/permissions').can(req.user, 'admin.permissions'),
  });
});

router.put('/roles/:id/permissions', async (req, res) => {
  assertCan(req.user, 'admin.permissions');
  const all = await roles();
  const role = all[String(req.params.id)];
  if (!role) throw notFound('Role not found.');
  if (role.rank >= req.user.rank) throw forbidden('You can\'t edit a role at or above your own rank.');
  const { permissions } = parse(z.object({ permissions: z.array(z.enum(KNOWN_PERMISSIONS)).max(KNOWN_PERMISSIONS.length) }).strict(), req.body);
  // Only super admins hold admin.permissions; it can't be delegated through this endpoint.
  if (permissions.includes('admin.permissions')) throw forbidden('admin.permissions can only belong to super administrators.');
  await db.tx(async (q) => {
    await q.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
    for (const p of new Set(permissions)) await q.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [role.id, p]);
    await audit(q, req, 'role.permissions', 'role', role.id, { before: [...role.permissions].sort(), after: [...new Set(permissions)].sort() });
  });
  invalidateRoles();
  res.json({ ok: true });
});

/* ---------- categories & forums ---------- */

const catSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(), title: z.string().trim().min(1).max(80), position: z.number().int().min(-1000).max(1000).default(0) }).strict();

router.post('/categories', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const d = parse(catSchema, req.body);
  const id = d.id || 'c-' + d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'c-' + Date.now();
  try {
    await db.tx(async (q) => {
      await q.query('INSERT INTO categories (id, title, position) VALUES ($1, $2, $3)', [id, d.title, d.position]);
      await audit(q, req, 'category.create', 'category', id, d);
    });
  } catch (e) { if (e.code === '23505') throw conflict('A category with that id already exists.'); throw e; }
  res.status(201).json({ id });
});

router.patch('/categories/:id', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const id = slugParam(req.params.id);
  const d = parse(catSchema.partial().strict(), req.body);
  if (d.id) throw invalid('Category ids can\'t be changed.');
  await db.tx(async (q) => {
    const r = await q.query('UPDATE categories SET title = coalesce($2, title), position = coalesce($3, position) WHERE id = $1', [id, d.title ?? null, d.position ?? null]);
    if (!r.rowCount) throw notFound();
    await audit(q, req, 'category.update', 'category', id, d);
  });
  res.json({ ok: true });
});

router.delete('/categories/:id', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const id = slugParam(req.params.id);
  if (await db.one('SELECT 1 FROM forums WHERE category_id = $1 LIMIT 1', [id])) throw conflict('Move or delete this category\'s forums first.');
  await db.tx(async (q) => {
    const r = await q.query('DELETE FROM categories WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound();
    await audit(q, req, 'category.delete', 'category', id, {});
  });
  res.json({ ok: true });
});

const forumSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  categoryId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  parentId: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable(),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  icon: z.string().trim().min(1).max(8).default('💬'),
  position: z.number().int().min(-1000).max(1000).default(0),
  staffOnly: z.boolean().default(false),
  membersOnly: z.boolean().default(false),
  ratingEnabled: z.boolean().default(false),
  notice: z.string().trim().max(500).default(''),
}).strict();

async function validateForumPlacement(d, selfId) {
  if (d.categoryId && !(await db.one('SELECT 1 FROM categories WHERE id = $1', [d.categoryId]))) throw invalid('Category not found.');
  if (d.parentId) {
    const forums = await allForums();
    const parent = forums.find((f) => f.id === d.parentId);
    if (!parent) throw invalid('Parent forum not found.');
    if (selfId && descendants(forums, selfId).includes(d.parentId)) throw invalid('A forum can\'t be placed inside itself or its sub-forums.');
    d.categoryId = parent.category_id; // sub-forums live in their parent's category
  }
}

router.post('/forums', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const d = parse(forumSchema, req.body);
  await validateForumPlacement(d, null);
  const id = d.id || 'f-' + d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  try {
    await db.tx(async (q) => {
      await q.query(`INSERT INTO forums (id, category_id, parent_id, title, description, icon, position, staff_only, members_only, rating_enabled, notice)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, d.categoryId, d.parentId, d.title, d.description, d.icon, d.position, d.staffOnly, d.membersOnly, d.ratingEnabled, d.notice]);
      await audit(q, req, 'forum.create', 'forum', id, d);
    });
  } catch (e) { if (e.code === '23505') throw conflict('A forum with that id already exists.'); throw e; }
  res.status(201).json({ id });
});

router.patch('/forums/:id', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const id = slugParam(req.params.id);
  const cur = await db.one('SELECT * FROM forums WHERE id = $1', [id]);
  if (!cur) throw notFound('Forum not found.');
  const d = parse(forumSchema.partial().strict(), req.body);
  if (d.id) throw invalid('Forum ids can\'t be changed.');
  await validateForumPlacement(d, id);
  const map = { categoryId: 'category_id', parentId: 'parent_id', title: 'title', description: 'description', icon: 'icon', position: 'position', staffOnly: 'staff_only', membersOnly: 'members_only', ratingEnabled: 'rating_enabled', notice: 'notice' };
  const sets = [], vals = [id];
  for (const [k, col] of Object.entries(map)) if (k in d) { vals.push(d[k]); sets.push(`${col} = $${vals.length}`); }
  await db.tx(async (q) => {
    if (sets.length) await q.query(`UPDATE forums SET ${sets.join(', ')} WHERE id = $1`, vals);
    // Keep sub-forums in the same category as their parent.
    if ('categoryId' in d) await q.query('UPDATE forums SET category_id = $2 WHERE id = ANY($3)', [id, d.categoryId, descendants(await allForums(q), id)]);
    await audit(q, req, 'forum.update', 'forum', id, d);
  });
  res.json({ ok: true });
});

router.delete('/forums/:id', async (req, res) => {
  assertCan(req.user, 'admin.forums');
  const id = slugParam(req.params.id);
  if (await db.one('SELECT 1 FROM forums WHERE parent_id = $1 LIMIT 1', [id])) throw conflict('Move or delete this forum\'s sub-forums first.');
  if (await db.one('SELECT 1 FROM threads WHERE forum_id = $1 LIMIT 1', [id])) throw conflict('Move or delete this forum\'s threads first.');
  await db.tx(async (q) => {
    const r = await q.query('DELETE FROM forums WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound();
    await audit(q, req, 'forum.delete', 'forum', id, {});
  });
  res.json({ ok: true });
});

/* ---------- site settings ---------- */

const settingsSchema = z.object({
  site_name: z.string().trim().min(1).max(60),
  site_description: z.string().trim().max(300),
  registration_open: z.boolean(),
  flood_seconds: z.number().int().min(0).max(600),
  rep_daily_limit: z.number().int().min(1).max(1000),
  neg_rep_min_posts: z.number().int().min(0).max(10000),
  max_poll_options: z.number().int().min(2).max(50),
}).partial().strict();

router.get('/settings', async (req, res) => {
  assertCan(req.user, 'admin.settings');
  res.json({ settings: await settings.all() });
});

router.patch('/settings', async (req, res) => {
  assertCan(req.user, 'admin.settings');
  const d = parse(settingsSchema, req.body);
  await db.tx(async (q) => {
    for (const [k, v] of Object.entries(d)) {
      await q.query(`INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
    }
    await audit(q, req, 'settings.update', 'settings', null, d);
  });
  settings.invalidate();
  res.json({ settings: await settings.all() });
});

/* ---------- import from the localStorage prototype ---------- */

router.post('/import', async (req, res) => {
  assertCan(req.user, 'admin.import');
  const { importLegacy } = require('../lib/importer');
  let result;
  try {
    result = await db.tx(async (q) => {
      const r = await importLegacy(q, req.body, { maxRoleRank: req.user.rank, actorId: req.user.id });
      await audit(q, req, 'data.import', 'import', null, { imported: r.imported, skipped: r.skipped.length });
      return r;
    });
  } catch (e) { if (e.status === 422) throw invalid(e.message); throw e; }
  res.json(result);
});

/* Public, non-sensitive settings for the frontend. */
router.get('/public-settings', async (req, res) => {
  const s = await settings.all();
  res.json({ siteName: s.site_name, siteDescription: s.site_description, registrationOpen: s.registration_open });
});

module.exports = router;
module.exports.KNOWN_PERMISSIONS = KNOWN_PERMISSIONS;

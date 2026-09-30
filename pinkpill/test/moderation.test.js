'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db } = require('./helpers');

let alice, bob, mod, mod2, admin, superAdmin, guest;

before(async () => {
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  alice = await member({ username: 'alice' });
  bob = await member({ username: 'bob' });
  mod = await member({ username: 'mod', role: 'moderator' });
  mod2 = await member({ username: 'mod2', role: 'moderator' });
  admin = await member({ username: 'admin', role: 'admin' });
  superAdmin = await member({ username: 'root', role: 'super_admin' });
  guest = client();
});
after(teardown);

test('members and guests cannot reach any moderator or admin endpoint', async () => {
  const endpoints = [
    ['get', '/api/mod/reports'], ['get', '/api/mod/users'], ['get', '/api/mod/log'], ['get', '/api/mod/warnings'],
    ['post', `/api/mod/users/1/ban`, { reason: 'x' }], ['post', `/api/mod/users/1/warn`, { reason: 'x', points: 1 }],
    ['get', '/api/admin/stats'], ['get', '/api/admin/users'], ['get', '/api/admin/roles'], ['get', '/api/admin/settings'],
    ['patch', '/api/admin/settings', { site_name: 'pwned' }], ['post', '/api/admin/forums', { categoryId: 'c-info', parentId: null, title: 'x' }],
    ['patch', `/api/admin/users/${alice.user.id}/role`, { role: 'admin' }], ['put', '/api/admin/roles/member/permissions', { permissions: [] }],
  ];
  for (const [m, url, body] of endpoints) {
    const r = await alice[m](url, body);
    assert.equal(r.status, 403, `${m} ${url} → ${r.status}`);
    const g = await guest[m](url, body);
    assert.ok([401, 403].includes(g.status), `guest ${m} ${url} → ${g.status}`);
  }
  // Moderators can't use admin endpoints either.
  assert.equal((await mod.get('/api/admin/users')).status, 403);
  assert.equal((await mod.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'moderator' })).status, 403);
});

test('privilege escalation: role/admin flags in bodies, cookies and headers are ignored', async () => {
  assert.equal((await alice.patch('/api/account/profile', { role: 'super_admin' })).status, 422);
  assert.equal((await alice.patch('/api/account/preferences', { isStaff: true })).status, 422);
  const forged = await alice.get('/api/mod/reports').set('X-User-Id', admin.user.id).set('X-Role', 'admin').set('Cookie', 'role=admin; isAdmin=true');
  assert.ok([401, 403].includes(forged.status));
  // Even with a stolen CSRF token, another user's session is required.
  const r = await alice.agent.get('/api/admin/stats').set('X-CSRF-Token', admin.csrf);
  assert.equal(r.status, 403);
  const me = await alice.get('/api/auth/session');
  assert.equal(me.body.user.role, 'member');
  assert.ok(!me.body.user.permissions.includes('mod.ban'));
});

test('reports: create, visible to staff only, resolve with audit + notification', async () => {
  const t = await alice.post('/api/forums/f-offtopic/threads', { title: 'Reported thread', content: 'something rude' });
  assert.equal((await bob.post('/api/reports', { type: 'post', id: t.body.postId, reason: 'rude' })).status, 201);
  assert.equal((await bob.post('/api/reports', { type: 'post', id: '999999', reason: 'ghost' })).status, 404);
  assert.equal((await guest.post('/api/reports', { type: 'post', id: t.body.postId, reason: 'rude' })).status, 401);
  const list = await mod.get('/api/mod/reports');
  const rep = list.body.reports.find((r) => r.contentId === t.body.postId);
  assert.ok(rep);
  assert.equal(rep.target.content, 'something rude');
  assert.ok((await mod.get('/api/me/counts')).body.reports >= 1);
  assert.equal((await mod.post(`/api/mod/reports/${rep.id}/resolve`, { status: 'resolved', note: 'warned' })).status, 200);
  assert.equal((await mod.post(`/api/mod/reports/${rep.id}/resolve`, {})).status, 409);
  const log = await db.one("SELECT actor_id FROM audit_log WHERE action = 'report.resolved' AND target_id = $1", [rep.id]);
  assert.equal(log.actor_id, mod.user.id);
  assert.ok((await bob.get('/api/notifications')).body.notifications.some((n) => n.type === 'report-resolved'));
});

test('safety filter auto-reports dangerous content and returns crisis flags', async () => {
  const r = await alice.post('/api/forums/f-body/threads', { title: 'Question about bonesmashing', content: 'has anyone tried it' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.safety.danger, ['bonesmash']);
  const auto = await db.one("SELECT reporter_id FROM reports WHERE content_id = $1 AND content_type = 'post'", [r.body.postId]);
  assert.equal(auto.reporter_id, null);
  const c = await alice.post(`/api/threads/${r.body.thread.id}/posts`, { content: 'honestly I want to die' });
  assert.ok(c.body.safety.crisis.length > 0);
  // Ordinary skincare vocabulary is not flagged.
  const ok = await alice.post('/api/forums/f-skin/threads', { title: 'Retinol purging timeline', content: 'How long did your purging phase last?' });
  assert.deepEqual(ok.body.safety.danger, []);
  // Eating/diet topics are not auto-flagged or auto-reported (site policy); members can still report them.
  for (const text of ['I make myself throw up after meals', 'pro-ana thinspo meanspo', 'dry fast and laxative experiences', 'purging after eating']) {
    const ed = await alice.post(`/api/threads/${ok.body.thread.id}/posts`, { content: text });
    assert.equal(ed.status, 201);
    assert.deepEqual(ed.body.safety.danger, [], text);
    assert.equal(await db.one("SELECT 1 FROM reports WHERE content_type = 'post' AND content_id = $1", [ed.body.post.id]), null, 'no automatic report: ' + text);
  }
  const manual = await bob.post('/api/reports', { type: 'post', id: ok.body.postId, reason: 'Member report still works' });
  assert.equal(manual.status, 201);
});

test('ban: banned user keeps read access but cannot write; lifted bans restore access', async () => {
  const t = await alice.post('/api/forums/f-offtopic/threads', { title: 'Before ban', content: 'ok' });
  assert.equal((await mod.post(`/api/mod/users/${bob.user.id}/ban`, { reason: 'spam' })).status, 200);
  assert.equal((await bob.get(`/api/threads/${t.body.thread.id}`)).status, 200, 'can still read');
  const w = await bob.post('/api/forums/f-offtopic/threads', { title: 'While banned', content: 'x' });
  assert.equal(w.status, 403); assert.match(w.body.error.message, /banned/);
  assert.equal((await bob.post(`/api/threads/${t.body.thread.id}/posts`, { content: 'x' })).status, 403);
  assert.equal((await bob.put(`/api/posts/${t.body.postId}/reaction`, { reaction: 'like' })).status, 403);
  assert.equal((await bob.post(`/api/posts/${t.body.postId}/reputation`, { positive: true })).status, 403);
  assert.equal((await bob.post('/api/conversations', { to: ['alice'], title: 'x', content: 'y' })).status, 403);
  assert.equal((await bob.post('/api/reports', { type: 'post', id: t.body.postId, reason: 'xxx' })).status, 403);
  const s = await bob.get('/api/auth/session');
  assert.equal(s.body.user.ban.reason, 'spam');
  assert.equal((await mod.del(`/api/mod/users/${bob.user.id}/ban`)).status, 200);
  assert.equal((await bob.post(`/api/threads/${t.body.thread.id}/posts`, { content: 'back' })).status, 201);
  const actions = (await db.many("SELECT action FROM audit_log WHERE target_type = 'user' AND target_id = $1 ORDER BY id", [bob.user.id])).map((a) => a.action);
  assert.deepEqual(actions.slice(-2), ['user.ban', 'user.unban']);
});

test('suspension expires automatically', async () => {
  assert.equal((await mod.post(`/api/mod/users/${bob.user.id}/ban`, { reason: 'cool off', days: 1 })).status, 200);
  assert.equal((await bob.post('/api/forums/f-offtopic/threads', { title: 'Suspended', content: 'x' })).status, 403);
  await db.query("UPDATE bans SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND lifted_at IS NULL", [bob.user.id]);
  assert.equal((await bob.post('/api/forums/f-offtopic/threads', { title: 'After suspension', content: 'x' })).status, 201);
});

test('rank rules: moderators cannot act on peers or admins; no self-moderation', async () => {
  assert.equal((await mod.post(`/api/mod/users/${mod2.user.id}/ban`, { reason: 'x' })).status, 403);
  assert.equal((await mod.post(`/api/mod/users/${admin.user.id}/ban`, { reason: 'x' })).status, 403);
  assert.equal((await mod.post(`/api/mod/users/${mod.user.id}/warn`, { reason: 'x', points: 1 })).status, 403);
  assert.equal((await admin.post(`/api/mod/users/${mod.user.id}/warn`, { reason: 'late', points: 2 })).status, 201);
  assert.equal((await admin.post(`/api/mod/users/${superAdmin.user.id}/ban`, { reason: 'x' })).status, 403);
});

test('roles: admins manage members but cannot create admins or edit higher ranks', async () => {
  assert.equal((await admin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'moderator' })).status, 200);
  assert.equal((await alice.get('/api/mod/reports')).status, 200, 'promotion is effective immediately');
  assert.equal((await admin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'admin' })).status, 403);
  assert.equal((await admin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'super_admin' })).status, 403);
  assert.equal((await admin.patch(`/api/admin/users/${superAdmin.user.id}/role`, { role: 'member' })).status, 403);
  assert.equal((await admin.patch(`/api/admin/users/${admin.user.id}/role`, { role: 'super_admin' })).status, 403);
  assert.equal((await admin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'ghost' })).status, 422);
  assert.equal((await superAdmin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'admin' })).status, 200);
  assert.equal((await superAdmin.patch(`/api/admin/users/${alice.user.id}/role`, { role: 'member' })).status, 200);
  assert.equal((await alice.get('/api/mod/reports')).status, 403, 'demotion is effective immediately');
});

test('permissions: only super admins edit role permissions; changes take effect', async () => {
  assert.equal((await admin.put('/api/admin/roles/member/permissions', { permissions: [] })).status, 403);
  const roles = await superAdmin.get('/api/admin/roles');
  const member = roles.body.roles.find((r) => r.id === 'member');
  const without = member.permissions.filter((p) => p !== 'thread.create');
  assert.equal((await superAdmin.put('/api/admin/roles/member/permissions', { permissions: [...without, 'bogus.perm'] })).status, 422);
  assert.equal((await superAdmin.put('/api/admin/roles/member/permissions', { permissions: [...without, 'admin.permissions'] })).status, 403);
  assert.equal((await superAdmin.put('/api/admin/roles/super_admin/permissions', { permissions: [] })).status, 403);
  assert.equal((await superAdmin.put('/api/admin/roles/member/permissions', { permissions: without })).status, 200);
  assert.equal((await bob.post('/api/forums/f-offtopic/threads', { title: 'No perm', content: 'x' })).status, 403);
  assert.equal((await superAdmin.put('/api/admin/roles/member/permissions', { permissions: member.permissions })).status, 200);
  assert.equal((await bob.post('/api/forums/f-offtopic/threads', { title: 'Perm back', content: 'x' })).status, 201);
});

test('forum management: create, nest, members-only, delete rules, audit', async () => {
  const c = await admin.post('/api/admin/categories', { title: 'Events', position: 9 });
  assert.equal(c.status, 201);
  const f = await admin.post('/api/admin/forums', { categoryId: c.body.id, parentId: null, title: 'Meetups', description: 'IRL' });
  assert.equal(f.status, 201);
  const sub = await admin.post('/api/admin/forums', { categoryId: 'c-info', parentId: f.body.id, title: 'VIP meetups', membersOnly: true });
  assert.equal(sub.status, 201);
  const subRow = await db.one('SELECT category_id FROM forums WHERE id = $1', [sub.body.id]);
  assert.equal(subRow.category_id, c.body.id, 'sub-forum inherits parent category');
  assert.equal((await admin.patch(`/api/admin/forums/${f.body.id}`, { parentId: sub.body.id })).status, 422, 'no cycles');
  assert.ok(!(await guest.get('/api/forums')).body.forums.some((x) => x.id === sub.body.id));
  assert.equal((await admin.del(`/api/admin/forums/${f.body.id}`)).status, 409, 'has sub-forums');
  assert.equal((await admin.del(`/api/admin/categories/${c.body.id}`)).status, 409, 'has forums');
  assert.equal((await admin.del('/api/admin/forums/f-offtopic')).status, 409, 'forum with threads');
  assert.equal((await admin.del(`/api/admin/forums/${sub.body.id}`)).status, 200);
  assert.equal((await admin.patch(`/api/admin/forums/${f.body.id}`, { title: 'Meetups & Events', notice: '<b>hi</b>' })).status, 200);
  const logged = await db.many("SELECT action FROM audit_log WHERE action LIKE 'forum.%' OR action LIKE 'category.%'");
  assert.ok(logged.length >= 4);
});

test('site settings: validated, audited, applied', async () => {
  assert.equal((await admin.patch('/api/admin/settings', { flood_seconds: -5 })).status, 422);
  assert.equal((await admin.patch('/api/admin/settings', { evil_key: 1 })).status, 422);
  assert.equal((await admin.patch('/api/admin/settings', { registration_open: false })).status, 200);
  const r = await client().post('/api/auth/register', { username: 'late', email: 'late@example.com', password: 'hunter2hunter2', birthday: '1990-01-01', agree: true });
  assert.equal(r.status, 403);
  assert.equal((await admin.patch('/api/admin/settings', { registration_open: true })).status, 200);
  const st = await admin.get('/api/admin/stats');
  assert.ok(st.body.stats.members >= 6);
  assert.equal(st.body.days.length, 14);
});

test('moderation log is visible to staff, with IPs only for admins', async () => {
  const m = await mod.get('/api/mod/log');
  assert.equal(m.status, 200);
  assert.ok(m.body.entries.length > 0);
  assert.equal(m.body.entries[0].ip, undefined);
  const a = await admin.get('/api/mod/log');
  assert.ok('ip' in a.body.entries[0]);
  const users = await mod.get('/api/mod/users');
  assert.equal(users.body.members[0].email, undefined, 'moderators do not see emails');
  const au = await admin.get('/api/mod/users');
  assert.ok(au.body.members.some((x) => x.email));
});

test('IDOR: editing, deleting and reading other people\'s things by id', async () => {
  const t = await alice.post('/api/forums/f-offtopic/threads', { title: 'Alice thread', content: 'mine' });
  assert.equal((await bob.patch(`/api/posts/${t.body.postId}`, { content: 'bob was here' })).status, 403);
  assert.equal((await bob.del(`/api/posts/${t.body.postId}`, {})).status, 403);
  assert.equal((await bob.del(`/api/threads/${t.body.thread.id}`, {})).status, 403);
  assert.equal((await bob.get(`/api/posts/${t.body.postId}/history`)).status, 403);
  assert.equal((await bob.get('/api/members/' + alice.user.id + '/warnings')).status, 403);
  const pp = await alice.post(`/api/members/${alice.user.id}/profile-posts`, { content: 'status' });
  assert.equal((await bob.del(`/api/profile-posts/${pp.body.id}`)).status, 403);
  assert.equal((await bob.patch('/api/account/profile', { avatarId: null })).status, 200, 'own profile only');
  const post = await db.one('SELECT content FROM posts WHERE id = $1', [t.body.postId]);
  assert.equal(post.content, 'mine');
});

test('rate limiting on login and registration', async () => {
  const config = require('../server/config');
  config.rateLimits.enabled = true;
  try {
    const c = client();
    let last;
    for (let i = 0; i < 22; i++) last = await c.post('/api/auth/login', { login: 'nobody', password: 'wrong-password' });
    assert.equal(last.status, 429);
    let reg;
    for (let i = 0; i < 6; i++) reg = await client().post('/api/auth/register', { username: 'spam' + i, email: `spam${i}@example.com`, password: 'hunter2hunter2', birthday: '1990-01-01', agree: true });
    assert.equal(reg.status, 429);
  } finally { config.rateLimits.enabled = false; }
});

'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, teardown, client, member, db, lastMail } = require('./helpers');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prototype-export.json'), 'utf8'));
let admin, superAdmin, alice, guest;

before(async () => {
  await setup();
  // There can only be one owner; imports are owner-only.
  superAdmin = await member({ username: 'root', role: 'super_admin' });
  admin = superAdmin;
  alice = await member({ username: 'alice' });
  guest = client();
});
after(teardown);

test('only admins can import; guests are rejected before the body is parsed', async () => {
  assert.equal((await guest.post('/api/admin/import', fixture)).status, 401);
  assert.equal((await alice.post('/api/admin/import', fixture)).status, 403);
  assert.equal((await admin.post('/api/admin/import', { hello: 'world' })).status, 422);
});

test('imports the prototype export into the relational schema', async () => {
  const r = await admin.post('/api/admin/import', fixture);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = r.body.imported;
  assert.equal(c.members, 8);
  assert.equal(c.threads, 25);
  assert.ok(c.posts >= 60);
  assert.ok(c.reactions > 0 && c.polls >= 1 && c.profilePosts >= 1 && c.follows > 0);
  assert.ok(r.body.skipped.some((s) => /invalid username/.test(s)), 'malicious username skipped');
  // threads are visible through the normal API
  const f = await guest.get('/api/forums/f-skin');
  assert.ok(f.body.sticky.concat(f.body.threads).some((t) => /Beginner Skincare Routine/.test(t.title)));
  // audit
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'data.import'"));
});

test('imported data is sanitised: no staff roles, images re-encoded, unsafe markup removed, reps validated', async () => {
  // Imported staff (the prototype's admin "Aurora" and moderator "Celeste") arrive as members; the owner assigns roles.
  const aurora = await db.one("SELECT role_id, password_hash, status FROM users WHERE username = 'Aurora'");
  assert.equal(aurora.role_id, 'member');
  assert.equal(aurora.password_hash, null);
  assert.equal(aurora.status, 'unverified');
  const mod = await db.one("SELECT role_id FROM users WHERE username = 'Celeste'");
  assert.equal(mod.role_id, 'member');
  // data: URL images became /media uploads
  assert.equal((await db.one("SELECT count(*)::int AS n FROM posts WHERE content LIKE '%data:image%'")).n, 0);
  assert.ok((await db.one("SELECT count(*)::int AS n FROM posts WHERE content ~ '\\[img\\]/media/[0-9a-f-]{36}\\[/img\\]'")).n >= 1);
  assert.equal((await db.one("SELECT count(*)::int AS n FROM posts WHERE content ILIKE '%javascript:%'")).n, 0);
  const av = await db.one("SELECT p.avatar_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'Vivienne'");
  assert.ok(av.avatar_id);
  const media = await guest.agent.get('/media/' + av.avatar_id).redirects(1);
  assert.equal(media.headers['content-type'], 'image/webp');
  // self-rep and out-of-range values were dropped
  assert.equal((await db.one('SELECT count(*)::int AS n FROM reputation WHERE giver_id = receiver_id OR abs(value) > 10')).n, 0);
});

test('re-importing does not duplicate or hijack existing members', async () => {
  const before = (await db.one('SELECT count(*)::int AS n FROM users')).n;
  const r = await admin.post('/api/admin/import', fixture);
  assert.equal(r.status, 200);
  assert.equal(r.body.imported.members, 0, 'existing usernames with matching email are reused, not recreated');
  assert.equal((await db.one('SELECT count(*)::int AS n FROM users')).n, before);
});

test('even the owner\'s import never grants staff roles', async () => {
  await db.query("UPDATE users SET username = 'aurora-old' WHERE username = 'Aurora'");
  const data = JSON.parse(JSON.stringify(fixture));
  data.users = data.users.filter((u) => u.username === 'Aurora');
  data.threads = []; data.posts = [];
  const r = await superAdmin.post('/api/admin/import', Object.assign(data, { threads: [], posts: [] }));
  assert.equal(r.status, 200);
  assert.equal((await db.one("SELECT role_id FROM users WHERE username = 'Aurora'")).role_id, 'member');
});

test('imported members claim their account with a password reset (which also verifies the email)', async () => {
  const anon = client();
  assert.equal((await anon.post('/api/auth/password-reset/request', { email: 'celeste@example.com' })).status, 200);
  const token = lastMail('celeste@example.com').text.match(/token=([\w-]+)/)[1];
  assert.equal((await anon.post('/api/auth/password-reset/confirm', { token, password: 'celeste new password' })).status, 200);
  const login = await anon.post('/api/auth/login', { login: 'Celeste', password: 'celeste new password' });
  assert.equal(login.status, 200);
  anon.csrf = login.body.csrfToken;
  const s = await anon.get('/api/auth/session');
  assert.equal(s.body.user.status, 'active');
  assert.ok(s.body.user.stats.posts > 0, 'imported posts are attributed to the claimed account');
});

test('hostile export shapes are handled without crashing (prototype pollution, wrong types)', async () => {
  const evil = JSON.parse('{"users":[{"id":"__proto__","username":"protoUser","email":"p@example.com"},{"id":"constructor","username":"ctorUser"}],' +
    '"threads":[{"id":"__proto__","forumId":"__proto__","authorId":"__proto__","title":{"x":1},"tags":"notalist"}],' +
    '"posts":[{"id":"p1","threadId":"__proto__","authorId":"constructor","content":["not","a","string"],"reactions":{"__proto__":"like"}}],' +
    '"reps":[{"postId":"p1","fromId":"__proto__","toId":"constructor","value":"9999"}]}');
  const r = await admin.post('/api/admin/import', evil);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.username, undefined);
  assert.equal(r.body.imported.members, 2);
});

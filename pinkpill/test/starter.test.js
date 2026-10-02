'use strict';
/* Starter accounts & threads: owner-only, can't log in, never online, removable in one click. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db } = require('./helpers');

let owner, gadmin, plain, guest;
before(async () => {
  await setup();
  owner = await member({ username: 'theowner', role: 'super_admin' });
  gadmin = await member({ username: 'gadmin', role: 'global_admin' });
  plain = await member({ username: 'plainone' });
  guest = client();
});
after(teardown);

test('only the owner can add or remove starter content', async () => {
  for (const c of [gadmin, plain]) {
    assert.equal((await c.post('/api/admin/starter-content')).status, 403);
    assert.equal((await c.del('/api/admin/starter-content')).status, 403);
  }
  assert.equal((await guest.post('/api/admin/starter-content')).status, 401);
});

test('starter accounts post threads, look like members, but cannot log in or be online', async () => {
  const r = await owner.post('/api/admin/starter-content');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, true);
  assert.equal(r.body.members, 182);
  assert.ok(r.body.threads >= 40, 'threads: ' + r.body.threads);
  assert.ok(r.body.posts >= r.body.threads * 6, 'every thread has replies');
  assert.equal((await owner.post('/api/admin/starter-content')).body.created, false, 'not added twice');
  const names = await db.many("SELECT id, username, password_hash FROM users WHERE starter");
  assert.equal(new Set(names.map((n) => n.username.toLowerCase())).size, 182, 'unique usernames');
  assert.ok(names.every((n) => n.password_hash === null));
  for (const n of names) assert.match(n.username, /^[A-Za-z0-9_.-]{3,24}$/);
  const someone = names[0];
  const login = await client().post('/api/auth/login', { login: someone.username, password: 'anything at all' });
  assert.notEqual(login.status, 200);
  const prof = (await guest.get('/api/members/' + someone.id)).body.user;
  assert.equal(prof.online, false);
  const skin = (await guest.get('/api/forums/f-skin')).body.threads;
  assert.ok(skin.some((t) => t.title.includes('3 step routine')));
  assert.ok((await plain.post('/api/conversations', { to: [someone.username], title: 'hi', content: 'hello' })).status >= 400, 'can\'t be messaged');
});

test('removing starter content hides their threads and closes the accounts', async () => {
  const r = await owner.del('/api/admin/starter-content');
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, 182);
  assert.ok(!(await guest.get('/api/forums/f-skin')).body.threads.some((t) => t.title.includes('3 step routine')));
  assert.equal((await db.one("SELECT count(*)::int AS n FROM users WHERE starter AND status <> 'deleted'")).n, 0);
});

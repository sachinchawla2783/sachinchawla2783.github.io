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
  assert.equal(r.body.members, 12);
  assert.ok(r.body.threads >= 10);
  assert.equal((await owner.post('/api/admin/starter-content')).body.created, false, 'not added twice');
  const isla = await db.one("SELECT id, password_hash FROM users WHERE username = 'Isla'");
  assert.equal(isla.password_hash, null);
  const login = await client().post('/api/auth/login', { login: 'Isla', password: 'anything at all' });
  assert.notEqual(login.status, 200);
  const prof = (await guest.get('/api/members/' + isla.id)).body.user;
  assert.equal(prof.online, false);
  assert.equal(prof.customTitle, '', 'no "demo" label');
  const skin = (await guest.get('/api/forums/f-skin')).body.threads;
  assert.ok(skin.some((t) => t.title.includes('3-step routine')));
  assert.equal((await plain.post('/api/conversations', { to: ['Isla'], title: 'hi', content: 'hello' })).status >= 400, true, 'can\'t be messaged');
});

test('removing starter content hides their threads and closes the accounts', async () => {
  const r = await owner.del('/api/admin/starter-content');
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, 12);
  assert.ok(!(await guest.get('/api/forums/f-skin')).body.threads.some((t) => t.title.includes('3-step routine')));
  assert.equal((await db.one("SELECT count(*)::int AS n FROM users WHERE starter AND status <> 'deleted'")).n, 0);
});

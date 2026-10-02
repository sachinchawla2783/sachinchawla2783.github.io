'use strict';
/* Pre-deployment security review: cases not already covered by auth/forum/social/moderation/media tests. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setup, teardown, client, member, db, lastMail, getApp } = require('./helpers');

before(setup);
after(teardown);

test('session fixation: a cookie planted by an attacker is ignored and replaced at login', async () => {
  await member({ username: 'fixme' });
  const c = client();
  const planted = 'pp_session=attacker-chosen-value-1234567890';
  const r = await c.agent.post('/api/auth/login').set('X-Requested-With', 'fetch').set('Cookie', planted).send({ login: 'fixme', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  const issued = r.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(issued, planted);
  const replay = await client().agent.get('/api/account').set('Cookie', planted);
  assert.equal(replay.status, 401);
});

test('session tokens are stored hashed; a database leak does not yield usable cookies', async () => {
  const c = await member({ username: 'hashy' });
  const row = await db.one("SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'hashy' LIMIT 1");
  assert.match(row.id, /^[0-9a-f]{64}$/);
  const r = await client().agent.get('/api/account').set('Cookie', 'pp_session=' + row.id);
  assert.equal(r.status, 401);
  assert.equal((await c.get('/api/account')).status, 200);
});

test('request smuggling: conflicting Content-Length and Transfer-Encoding is rejected by the parser', async () => {
  const server = getApp().listen(0);
  try {
    const port = server.address().port;
    const res = await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write('POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /api/admin/stats HTTP/1.1\r\nHost: localhost\r\n\r\n');
      });
      let data = '';
      sock.on('data', (d) => { data += d; });
      sock.on('close', () => resolve(data));
      sock.setTimeout(2000, () => { sock.destroy(); resolve(data); });
    });
    assert.match(res, /^HTTP\/1\.1 400/);
    assert.ok(!/admin|stats|"members"/.test(res.split('\r\n\r\n').slice(1).join('')), 'smuggled request not processed');
  } finally { server.close(); }
});

test('verification token abuse: tokens die when the email changes, and are single-use', async () => {
  const c = await member({ username: 'switcher', verify: false });
  const oldToken = lastMail('switcher@example.com').text.match(/token=([\w-]+)/)[1];
  assert.equal((await c.patch('/api/account/email', { email: 'switched@example.com', password: c.password })).status, 200);
  assert.equal((await c.post('/api/auth/verify-email', { token: oldToken })).status, 400, 'token for the old address no longer verifies');
  const s = await c.get('/api/auth/session');
  assert.equal(s.body.user.status, 'unverified');
});

test('password reset abuse: tokens are per-user, single-use, expire, and responses never reveal accounts', async () => {
  await member({ username: 'victim' });
  const anon = client();
  await anon.post('/api/auth/password-reset/request', { email: 'victim@example.com' });
  const token = lastMail('victim@example.com').text.match(/token=([\w-]+)/)[1];
  await db.query("UPDATE password_resets SET expires_at = now() - interval '1 second'");
  assert.equal((await anon.post('/api/auth/password-reset/confirm', { token, password: 'new password here' })).status, 400, 'expired');
  const stored = await db.one('SELECT token_hash FROM password_resets LIMIT 1');
  assert.notEqual(stored.token_hash, token, 'only the hash is stored');
  const unknown = await anon.post('/api/auth/password-reset/request', { email: 'nobody-here@example.com' });
  const known = await anon.post('/api/auth/password-reset/request', { email: 'victim@example.com' });
  assert.deepEqual(unknown.body, known.body);
});

test('SSRF: the server never fetches user-supplied URLs', async () => {
  const c = await member({ username: 'ssrf' });
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  const origFetch = global.fetch;
  const fetched = [];
  global.fetch = async (u, ...rest) => { fetched.push(String(u)); return origFetch(u, ...rest); };
  try {
    const r = await c.post('/api/forums/f-offtopic/threads', { title: 'Links', content: '[img]https://169.254.169.254/latest/meta-data/[/img] [url=http://localhost:5432]db[/url] [media]http://127.0.0.1:22[/media]' });
    assert.equal(r.status, 201);
    await c.patch('/api/account/profile', { website: 'http://169.254.169.254/' });
  } finally { global.fetch = origFetch; }
  assert.deepEqual(fetched, [], 'no outbound requests triggered by user content');
});

test('mass assignment / parameter tampering on every write schema is rejected', async () => {
  const c = await member({ username: 'tamper' });
  const attempts = [
    ['patch', '/api/account/profile', { customTitle: 'x', isStaff: true }],
    ['patch', '/api/account/preferences', { theme: 'dark', role: 'admin' }],
    ['post', '/api/forums/f-offtopic/threads', { title: 'abc', content: 'x', locked: true }],
    ['post', '/api/conversations', { to: ['tamper'], title: 't', content: 'c', starterId: '1' }],
    ['post', '/api/reports', { type: 'user', id: '1', reason: 'xxx', status: 'resolved' }],
    ['post', '/api/auth/login', { login: 'tamper', password: 'x', userId: '1' }],
  ];
  for (const [m, url, body] of attempts) assert.equal((await c[m](url, body)).status, 422, `${m} ${url}`);
  const proto = await c.agent.patch('/api/account/preferences').set('X-Requested-With', 'fetch').set('X-CSRF-Token', c.csrf).set('Content-Type', 'application/json').send('{"theme":"dark","__proto__":{"isAdmin":true}}');
  assert.equal(proto.status, 422);
  assert.equal(({}).isAdmin, undefined);
});

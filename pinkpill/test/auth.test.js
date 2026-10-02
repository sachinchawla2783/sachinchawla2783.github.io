'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db, lastMail } = require('./helpers');

before(setup);
after(teardown);

const reg = (c, o = {}) => c.post('/api/auth/register', Object.assign({ username: 'alice', email: 'alice@example.com', password: 'hunter2hunter2', birthday: '1990-01-01', agree: true }, o));

test('signup creates an unverified account with an Argon2id hash and a session', async () => {
  const c = client();
  const r = await reg(c);
  assert.equal(r.status, 201);
  assert.ok(r.body.csrfToken);
  const cookie = r.headers['set-cookie'].join(';');
  assert.match(cookie, /pp_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const row = await db.one("SELECT password_hash, status, role_id FROM users WHERE username = 'alice'");
  assert.match(row.password_hash, /^\$argon2id\$/);
  assert.ok(!row.password_hash.includes('hunter2'));
  assert.equal(row.status, 'unverified');
  assert.equal(row.role_id, 'member');
  c.csrf = r.body.csrfToken;
  const s = await c.get('/api/auth/session');
  assert.equal(s.body.user.username, 'alice');
  assert.equal(s.body.user.mustVerifyEmail, true);
  assert.equal(s.body.user.passwordHash, undefined);
  assert.ok(!JSON.stringify(s.body).includes('argon2'));
});

test('signup validation: duplicates, weak passwords, minors, honeypot, unknown fields', async () => {
  const c = client();
  assert.equal((await reg(c)).status, 409);
  assert.equal((await reg(c, { username: 'ALICE', email: 'x@example.com' })).status, 409, 'usernames are case-insensitive');
  assert.equal((await reg(c, { username: 'bob', email: 'Alice@Example.com' })).status, 409);
  assert.equal((await reg(c, { username: 'bob', email: 'bob@example.com', password: 'short' })).status, 422);
  assert.equal((await reg(c, { username: 'bob', email: 'bob@example.com', birthday: '2015-01-01' })).status, 403);
  assert.equal((await reg(c, { username: 'bob', email: 'bob@example.com', website: 'spam' })).status, 422);
  assert.equal((await reg(c, { username: 'b<script>', email: 'bob@example.com' })).status, 422);
  assert.equal((await reg(c, { username: 'bob', email: 'bob@example.com', role: 'admin' })).status, 422, 'unknown keys rejected');
  assert.equal((await reg(c, { username: 'bob', email: 'bob@example.com', agree: false })).status, 422);
});

test('email verification activates the account; tokens are single use', async () => {
  const c = client();
  const r = await reg(c, { username: 'carol', email: 'carol@example.com' });
  c.csrf = r.body.csrfToken;
  const token = lastMail('carol@example.com').text.match(/token=([\w-]+)/)[1];
  assert.equal((await c.post('/api/auth/verify-email', { token: 'x'.repeat(40) })).status, 400);
  assert.equal((await c.post('/api/auth/verify-email', { token })).status, 200);
  assert.equal((await c.post('/api/auth/verify-email', { token })).status, 400, 'reuse fails');
  const s = await c.get('/api/auth/session');
  assert.equal(s.body.user.status, 'active');
  // tokens are stored hashed
  const stored = await db.one('SELECT token_hash FROM email_verifications LIMIT 1');
  assert.notEqual(stored.token_hash, token);
});

test('login, wrong password, logout, session invalidation', async () => {
  const c = client();
  const bad = await c.post('/api/auth/login', { login: 'alice', password: 'wrongwrong' });
  assert.equal(bad.status, 401);
  const unknown = await c.post('/api/auth/login', { login: 'nobody', password: 'wrongwrong' });
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error.message, unknown.body.error.message, 'no account enumeration');
  const ok = await c.post('/api/auth/login', { login: 'ALICE@example.com', password: 'hunter2hunter2' });
  assert.equal(ok.status, 200);
  c.csrf = ok.body.csrfToken;
  assert.equal((await c.get('/api/account')).status, 200);
  const cookie = ok.headers['set-cookie'][0].split(';')[0];
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/account')).status, 401);
  // the old cookie no longer works (session row deleted server-side)
  const replay = client();
  const rr = await replay.agent.get('/api/account').set('Cookie', cookie);
  assert.equal(rr.status, 401);
});

test('login rotates the session token', async () => {
  const c = client();
  const a = await c.post('/api/auth/login', { login: 'alice', password: 'hunter2hunter2' });
  c.csrf = a.body.csrfToken;
  const b = await c.post('/api/auth/login', { login: 'alice', password: 'hunter2hunter2' });
  assert.notEqual(a.headers['set-cookie'][0], b.headers['set-cookie'][0]);
  const old = a.headers['set-cookie'][0].split(';')[0];
  const r = await client().agent.get('/api/account').set('Cookie', old);
  assert.equal(r.status, 401, 'previous session destroyed on re-login');
});

test('account lockout after repeated failures', async () => {
  await reg(client(), { username: 'dave', email: 'dave@example.com' });
  const c = client();
  for (let i = 0; i < 10; i++) await c.post('/api/auth/login', { login: 'dave', password: 'nope-nope' });
  const r = await c.post('/api/auth/login', { login: 'dave', password: 'hunter2hunter2' });
  assert.equal(r.status, 401);
  assert.match(r.body.error.message, /locked/);
});

test('expired sessions are rejected', async () => {
  const c = await member();
  assert.equal((await c.get('/api/account')).status, 200);
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE username = $1)", [c.user.username]);
  assert.equal((await c.get('/api/account')).status, 401);
});

test('password reset: no enumeration, single-use token, revokes sessions', async () => {
  const c = await member({ username: 'erin' });
  const anon = client();
  const a = await anon.post('/api/auth/password-reset/request', { email: 'erin@example.com' });
  const b = await anon.post('/api/auth/password-reset/request', { email: 'ghost@example.com' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.message, b.body.message);
  const token = lastMail('erin@example.com').text.match(/token=([\w-]+)/)[1];
  assert.equal((await anon.post('/api/auth/password-reset/confirm', { token, password: 'short' })).status, 422);
  assert.equal((await anon.post('/api/auth/password-reset/confirm', { token, password: 'brand new password' })).status, 200);
  assert.equal((await anon.post('/api/auth/password-reset/confirm', { token, password: 'another password' })).status, 400);
  assert.equal((await c.get('/api/account')).status, 401, 'existing sessions revoked');
  assert.equal((await anon.post('/api/auth/login', { login: 'erin', password: 'brand new password' })).status, 200);
});

test('change password requires the current password and keeps only this session', async () => {
  const c = await member({ username: 'fran' });
  const other = client();
  const o = await other.post('/api/auth/login', { login: 'fran', password: c.password }); other.csrf = o.body.csrfToken;
  assert.equal((await c.post('/api/account/password', { current: 'wrong', new: 'new password 1' })).status, 403);
  assert.equal((await c.post('/api/account/password', { current: c.password, new: 'new password 1' })).status, 200);
  assert.equal((await c.get('/api/account')).status, 200);
  assert.equal((await other.get('/api/account')).status, 401);
});

test('CSRF: logged-in unsafe requests need the session token; foreign origins are blocked', async () => {
  const c = await member();
  const noToken = await c.agent.patch('/api/account/preferences').set('X-Requested-With', 'fetch').send({ theme: 'dark' });
  assert.equal(noToken.status, 403);
  const wrong = await c.agent.patch('/api/account/preferences').set('X-Requested-With', 'fetch').set('X-CSRF-Token', 'nope').send({ theme: 'dark' });
  assert.equal(wrong.status, 403);
  const foreign = await c.patch('/api/account/preferences', { theme: 'dark' }).set('Origin', 'https://evil.example');
  assert.equal(foreign.status, 403);
  const ok = await c.patch('/api/account/preferences', { theme: 'dark' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.prefs.theme, 'dark');
  // anonymous unsafe request without the custom header (a cross-site form) is rejected
  const form = await client().agent.post('/api/auth/login').type('form').send({ login: 'alice', password: 'hunter2hunter2' });
  assert.equal(form.status, 403);
});

test('profile updates are validated server-side', async () => {
  const c = await member();
  assert.equal((await c.patch('/api/account/profile', { website: 'javascript:alert(1)' })).status, 422);
  assert.equal((await c.patch('/api/account/profile', { color: 'red;background:url(x)' })).status, 422);
  assert.equal((await c.patch('/api/account/profile', { customTitle: 'Administrator' })).status, 400);
  assert.equal((await c.patch('/api/account/profile', { role: 'admin' })).status, 422);
  assert.equal((await c.patch('/api/account/profile', { avatarId: '4f1c2a8e-1b2c-4d3e-8f9a-0b1c2d3e4f5a' })).status, 403);
  const ok = await c.patch('/api/account/profile', { customTitle: 'Skincare nerd', location: 'Paris', bio: '[b]hi[/b]' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.customTitle, 'Skincare nerd');
});

test('malformed JSON and oversized bodies get clean errors', async () => {
  const c = await member();
  const bad = await c.agent.patch('/api/account/preferences').set('X-Requested-With', 'fetch').set('X-CSRF-Token', c.csrf).set('Content-Type', 'application/json').send('{"theme":');
  assert.equal(bad.status, 400);
  const big = await c.patch('/api/account/profile', { bio: 'x'.repeat(200000) });
  assert.equal(big.status, 413);
});

test('account deletion anonymises the user', async () => {
  const c = await member({ username: 'gina' });
  assert.equal((await c.del('/api/account', { password: 'wrong' })).status, 403);
  assert.equal((await c.del('/api/account', { password: c.password })).status, 200);
  const row = await db.one("SELECT username, email, password_hash, status FROM users WHERE username LIKE 'deleted-%'");
  assert.equal(row.status, 'deleted'); assert.equal(row.email, null); assert.equal(row.password_hash, null);
  assert.equal((await client().post('/api/auth/login', { login: 'gina', password: c.password })).status, 401);
});

test('claim-admin bootstrap: needs the secret, a login, and no existing super admin', async () => {
  const config = require('../server/config');
  config.adminClaimToken = 'x'.repeat(32);
  try {
    const c = await member({ username: 'owner' });
    assert.equal((await client().post('/api/auth/claim-admin', { token: 'x'.repeat(32) })).status, 401);
    assert.equal((await c.post('/api/auth/claim-admin', { token: 'wrong' })).status, 403);
    assert.equal((await c.post('/api/auth/claim-admin', { token: 'x'.repeat(32) })).status, 200);
    assert.equal((await c.get('/api/admin/stats')).status, 200);
    const other = await member({ username: 'latecomer' });
    assert.equal((await other.post('/api/auth/claim-admin', { token: 'x'.repeat(32) })).status, 403, 'only once');
    config.adminClaimToken = '';
    assert.equal((await other.post('/api/auth/claim-admin', { token: '' })).status, 422);
  } finally { config.adminClaimToken = ''; }
});

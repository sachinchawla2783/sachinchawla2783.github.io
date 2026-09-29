'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const request = require('supertest');
const { setup, teardown, client, db, getApp } = require('./helpers');
const config = require('../server/config');

before(setup);
after(teardown);

/* A tiny local HTTP server standing in for Resend / Turnstile. */
function stub(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { const call = { method: req.method, url: req.url, headers: req.headers, body }; calls.push(call); handler(call, res); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, calls, close: () => new Promise((r) => srv.close(r)) }));
  });
}

test('GET /health is a tiny, dependency-free liveness response', async () => {
  const r = await request(getApp()).get('/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ok' });
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('GET /ready checks the database without exposing details', async () => {
  const r = await request(getApp()).get('/ready');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ready' });
  const { createApp } = require('../server/app');
  const down = await request(createApp({ isShuttingDown: () => true })).get('/ready');
  assert.equal(down.status, 503);
  assert.deepEqual(down.body, { status: 'shutting_down' });
});

test('security headers and request ids are present', async () => {
  const r = await request(getApp()).get('/');
  const h = r.headers;
  assert.match(h['content-security-policy'], /default-src 'self'/);
  assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(h['content-security-policy'], /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(h['permissions-policy'], /camera=\(\)/);
  assert.equal(h['x-powered-by'], undefined);
  assert.match(h['x-request-id'], /^[0-9a-f-]{36}$/);
  const api = await request(getApp()).get('/api/forums');
  assert.equal(api.headers['cache-control'], 'no-store', 'API responses are never cached');
});

test('500 and 503 responses carry a request id but no stack trace or internals', async () => {
  const orig = db.many;
  try {
    db.many = async () => { throw new Error('secret internal detail at /srv/app/server/db'); };
    const r = await request(getApp()).get('/api/forums');
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'server_error');
    assert.match(r.body.error.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(r.body.error.requestId, r.headers['x-request-id']);
    assert.ok(!JSON.stringify(r.body).includes('secret internal'));
    assert.ok(!JSON.stringify(r.body).includes('/srv/app'));
    db.many = async () => { const e = new Error('Connection terminated unexpectedly'); throw e; };
    const w = await request(getApp()).get('/api/forums');
    assert.equal(w.status, 503, 'database outages map to 503, not 500');
    assert.equal(w.headers['retry-after'], '5');
  } finally { db.many = orig; }
});

test('canonical host + HTTPS redirect uses APP_URL, never the Host header', async () => {
  const prev = config.canonicalRedirect;
  config.canonicalRedirect = true;
  try {
    const { createApp } = require('../server/app');
    const app = createApp();
    const wrongHost = await request(app).get('/forums?x=1').set('Host', 'evil.example').set('X-Forwarded-Proto', 'https');
    assert.equal(wrongHost.status, 301);
    assert.equal(wrongHost.headers.location, config.appUrl + '/forums?x=1');
    const http1 = await request(app).get('/').set('Host', new URL(config.appUrl).host);
    assert.equal(http1.status, 301, 'plain HTTP is redirected');
    const ok = await request(app).get('/').set('Host', new URL(config.appUrl).host).set('X-Forwarded-Proto', 'https');
    assert.equal(ok.status, 200);
    const post = await request(app).post('/api/auth/login').set('Host', 'evil.example').set('X-Forwarded-Proto', 'https').send({});
    assert.equal(post.status, 421);
    const health = await request(app).get('/health').set('Host', '10.0.0.5:8000');
    assert.equal(health.status, 200, 'health checks work on the internal hostname');
  } finally { config.canonicalRedirect = prev; }
});

test('emailed links use APP_URL even when the Host header is spoofed', async () => {
  const mailer = require('../server/lib/mailer');
  const c = client();
  const r = await c.agent.post('/api/auth/register').set('X-Requested-With', 'fetch').set('Host', 'attacker.example')
    .send({ username: 'hosty', email: 'hosty@example.com', password: 'hunter2hunter2', birthday: '1990-01-01', agree: true });
  assert.equal(r.status, 201);
  const mail = mailer.outbox.filter((m) => m.to === 'hosty@example.com').pop();
  assert.ok(mail.text.includes(config.appUrl + '/#/verify-email?token='));
  assert.ok(!mail.text.includes('attacker.example'));
});

test('log redaction never prints secrets', () => {
  const log = require('../server/lib/log');
  const red = log.redact({ password: 'p', token: 't', cookie: 'c', apiKey: 'k', sessionId: 's', content: 'dm text', route: '/api/x', status: 200 });
  assert.deepEqual(red, { password: '[redacted]', token: '[redacted]', cookie: '[redacted]', apiKey: '[redacted]', sessionId: '[redacted]', content: '[redacted]', route: '/api/x', status: 200 });
});

test('migrations: idempotent, safe to run concurrently, status reports none pending', async () => {
  const { migrate, status } = require('../server/db/migrate');
  const results = await Promise.all([migrate(db.pool, { log: () => {} }), migrate(db.pool, { log: () => {} })]);
  assert.deepEqual(results, [[], []]);
  const st = await status(db.pool);
  assert.ok(st.length >= 1);
  assert.ok(st.every((m) => m.appliedAt));
  const n = await db.one('SELECT count(*)::int AS n FROM schema_migrations');
  assert.equal(n.n, st.length);
});

test('Resend transport: HTTP API call with bearer key; tokens never logged', async () => {
  const mailerPath = require.resolve('../server/lib/mailer');
  const api = await stub((call, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"email_123"}'); });
  const saved = { ...config.mail };
  const out = [];
  const origOut = process.stdout.write, origErr = process.stderr.write;
  process.env.LOG_LEVEL = 'info';
  delete require.cache[require.resolve('../server/lib/log')]; delete require.cache[mailerPath];
  Object.assign(config.mail, { transport: 'resend', resendApiKey: 're_test_key_123', resendApiUrl: api.url + '/emails', from: 'PinkPill <no-reply@pinkpill.test>' });
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { out.push(String(s)); return true; };
  try {
    const mailer = require(mailerPath);
    const ok = await mailer.sendPasswordReset('reset-me@example.com', 'resetme', 'SUPERSECRETTOKEN123');
    assert.equal(ok, true);
    const call = api.calls[0];
    assert.equal(call.headers.authorization, 'Bearer re_test_key_123');
    const body = JSON.parse(call.body);
    assert.deepEqual(body.to, ['reset-me@example.com']);
    assert.equal(body.from, 'PinkPill <no-reply@pinkpill.test>');
    assert.ok(body.text.includes('SUPERSECRETTOKEN123'));
    // per-recipient cap: 3 per hour per kind
    assert.equal(await mailer.sendPasswordReset('reset-me@example.com', 'x', 't2'), true);
    assert.equal(await mailer.sendPasswordReset('reset-me@example.com', 'x', 't3'), true);
    assert.equal(await mailer.sendPasswordReset('reset-me@example.com', 'x', 't4'), false);
    // failure is reported, not thrown
    Object.assign(config.mail, { resendApiUrl: 'http://127.0.0.1:1/emails' });
    assert.equal(await mailer.sendVerification('other@example.com', 'o', 'TOKEN2'), false);
  } finally {
    process.stdout.write = origOut; process.stderr.write = origErr;
    Object.assign(config.mail, saved);
    process.env.LOG_LEVEL = '';
    delete require.cache[mailerPath]; delete require.cache[require.resolve('../server/lib/log')];
    await api.close();
  }
  const logs = out.join('');
  assert.match(logs, /mail\.sent/);
  assert.ok(!logs.includes('SUPERSECRETTOKEN123'), 'token not in logs');
  assert.ok(!logs.includes('re_test_key_123'), 'API key not in logs');
  assert.ok(!logs.includes('reset-me@example.com'), 'recipient masked in logs');
});

test('Turnstile: verified server-side on registration and password reset; fails closed', async () => {
  const cf = await stub((call, res) => {
    const p = new URLSearchParams(call.body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(p.get('secret') === 'turnstile-secret' && p.get('response') === 'good-token' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }));
  });
  const saved = { ...config.turnstile };
  Object.assign(config.turnstile, { siteKey: 'site-key', secretKey: 'turnstile-secret', verifyUrl: cf.url });
  try {
    const body = (extra) => Object.assign({ username: 'bot' + Math.random().toString(36).slice(2, 7), email: Math.random().toString(36).slice(2) + '@example.com', password: 'hunter2hunter2', birthday: '1990-01-01', agree: true }, extra);
    assert.equal((await client().post('/api/auth/register', body())).status, 403, 'no token');
    assert.equal((await client().post('/api/auth/register', body({ turnstileToken: 'forged' }))).status, 403, 'bad token');
    assert.equal((await client().post('/api/auth/register', body({ turnstileToken: 'good-token' }))).status, 201);
    assert.equal((await client().post('/api/auth/password-reset/request', { email: 'x@example.com' })).status, 403);
    assert.equal((await client().post('/api/auth/password-reset/request', { email: 'x@example.com', turnstileToken: 'good-token' })).status, 200);
    const s = await client().get('/api/auth/session');
    assert.equal(s.body.turnstile.siteKey, 'site-key');
    assert.ok(!JSON.stringify(s.body).includes('turnstile-secret'), 'secret never sent to the browser');
    // honeypot still works with Turnstile on
    assert.equal((await client().post('/api/auth/register', body({ turnstileToken: 'good-token', website: 'spam' }))).status, 422);
    // Cloudflare unreachable → reject (fail closed)
    config.turnstile.verifyUrl = 'http://127.0.0.1:1/siteverify';
    assert.equal((await client().post('/api/auth/register', body({ turnstileToken: 'good-token' }))).status, 403);
    assert.equal(cf.calls.every((c) => new URLSearchParams(c.body).get('secret') === 'turnstile-secret'), true);
  } finally { Object.assign(config.turnstile, saved); await cf.close(); }
});

test('rate limits return 429 with Retry-After on account endpoints', async () => {
  config.rateLimits.enabled = true;
  try {
    let r;
    for (let i = 0; i < 6; i++) r = await client().post('/api/auth/password-reset/request', { email: `rl${i}@example.com` });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) > 0);
    // browsing is not throttled by the account limiters
    assert.equal((await client().get('/api/forums')).status, 200);
  } finally { config.rateLimits.enabled = false; }
});

test('graceful shutdown: SIGTERM finishes cleanly with exit code 0', async () => {
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, { NODE_ENV: 'development', PORT: String(port), DATABASE_URL: process.env.DATABASE_URL_TEST, LOG_LEVEL: 'info', MIGRATE_ON_START: 'false', MAIL_TRANSPORT: 'memory' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + output)), 15000);
    child.stdout.on('data', () => { if (/server\.listening/.test(output)) { clearTimeout(t); resolve(); } });
  });
  assert.match(output, /host=0\.0\.0\.0/);
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  child.kill('SIGTERM');
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0);
  assert.match(output, /server\.shutdown_complete/);
});

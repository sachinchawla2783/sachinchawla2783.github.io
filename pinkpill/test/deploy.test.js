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

/* http.request (unlike fetch) lets us set the Host header, as a reverse proxy would. */
function raw(port, method, pathname, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* Starts the real server in production mode and returns { port, child, output() }. */
async function startProd(extraEnv) {
  const port = 4000 + Math.floor(Math.random() * 900);
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'production', PORT: String(port), APP_URL: 'https://pinkpill.test', DATABASE_URL: process.env.DATABASE_URL_TEST,
    MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_dummy', RESEND_API_URL: 'http://127.0.0.1:1/emails', MAIL_FROM: 'PinkPill <no-reply@pinkpill.test>',
    STORAGE_DRIVER: 'local', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true', MIGRATE_ON_START: 'false', TRUST_PROXY: 'loopback', LOG_LEVEL: 'info', RATE_LIMITS: 'false',
  }, extraEnv || {});
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const started = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 15000);
    const check = () => { if (/server\.listening/.test(out)) { clearTimeout(t); resolve(true); } };
    child.stdout.on('data', check);
    child.on('exit', () => { clearTimeout(t); resolve(false); });
  });
  return { port, child, started, output: () => out };
}

test('production mode: __Host- session cookie is Secure, HttpOnly, SameSite=Lax, host-only; JSON logs', async () => {
  const s = await startProd();
  try {
    assert.ok(s.started, s.output());
    const hdr = { Host: 'pinkpill.test', 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
    const r = await raw(s.port, 'POST', '/api/auth/register', hdr, JSON.stringify({ username: 'produser', email: 'prod@example.com', password: 'a long password', birthday: '1990-01-01', agree: true }));
    assert.equal(r.status, 201, r.body);
    const cookie = r.headers['set-cookie'].find((c) => c.startsWith('__Host-pp_session='));
    // The alt-detection device cookie gets the same protections.
    const device = r.headers['set-cookie'].find((c) => c.startsWith('__Host-pp_device='));
    assert.ok(device && /; HttpOnly/i.test(device) && /; Secure/i.test(device) && /SameSite=Lax/i.test(device), device);
    assert.match(cookie, /^__Host-pp_session=/);
    assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /; Secure/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//);
    assert.ok(!/Domain=/i.test(cookie), 'host-only cookie');
    assert.match(JSON.parse(r.body).csrfToken, /^[\w-]{20,}$/);
    // Resend is unreachable in this test: signup still succeeds, and the failure is logged without the token.
    const rs = await raw(s.port, 'GET', '/', { Host: 'pinkpill.test', 'X-Forwarded-Proto': 'https' });
    assert.match(rs.headers['strict-transport-security'], /max-age=31536000/);
    const redirect = await raw(s.port, 'GET', '/whatever', { Host: 'www.pinkpill.test', 'X-Forwarded-Proto': 'https' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, 'https://pinkpill.test/whatever');
    const health = await raw(s.port, 'GET', '/health', { Host: '10.1.2.3:8000' });
    assert.equal(health.status, 200);
    await new Promise((r2) => setTimeout(r2, 300));
    const logs = s.output();
    assert.match(logs, /^\{"ts":/m, 'JSON log lines');
    assert.match(logs, /"event":"mail.failed"/);
    assert.ok(!/token=/.test(logs), 'no tokens in logs');
    assert.ok(!logs.includes('prod@example.com'), 'emails masked');
    assert.ok(!logs.includes('a long password'));
  } finally { s.child.kill('SIGTERM'); }
});

test('production mode refuses unsafe or incomplete configuration', async () => {
  const cases = [
    { APP_URL: 'http://pinkpill.test' },
    { RESEND_API_KEY: '' },
    { MAIL_TRANSPORT: 'file' },
    { COOKIE_SECURE: 'false' },
    { STORAGE_DRIVER: 'r2', R2_BUCKET: '' },
    { ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'false' },
    { TURNSTILE_SITE_KEY: 'only-the-site-key' },
    { MAIL_FROM: '' },
  ];
  for (const env of cases) {
    const s = await startProd(env);
    assert.equal(s.started, false, 'should refuse: ' + JSON.stringify(env));
    assert.match(s.output(), /Invalid configuration/);
    s.child.kill();
  }
});

test('production: JS and CSS are revalidated on every load so a deploy shows up immediately', async () => {
  const s = await startProd({});
  try {
    assert.ok(s.started, s.output());
    const h = { Host: 'pinkpill.test', 'X-Forwarded-Proto': 'https' };
    for (const file of ['/js/vip.js', '/css/style.css', '/']) {
      const r = await raw(s.port, 'GET', file, h);
      assert.equal(r.status, 200, file);
      assert.equal(r.headers['cache-control'], 'no-cache', file);
      assert.ok(r.headers.etag, file + ' has an ETag');
      const again = await raw(s.port, 'GET', file, Object.assign({ 'If-None-Match': r.headers.etag }, h));
      assert.equal(again.status, 304, file + ' unchanged files are not re-downloaded');
    }
  } finally { s.child.kill('SIGTERM'); }
});
test('Render: TRUST_PROXY=1 trusts one proxy hop, so HTTPS requests on the canonical host are not redirected', async () => {
  const s = await startProd({ APP_URL: '', RENDER_EXTERNAL_URL: 'https://pinkpill-demo.onrender.com', TRUST_PROXY: '1' });
  try {
    assert.ok(s.started, s.output());
    const ok = await raw(s.port, 'GET', '/forums', { Host: 'pinkpill-demo.onrender.com', 'X-Forwarded-Proto': 'https' });
    assert.notEqual(ok.status, 301, 'no redirect loop behind Render\'s proxy');
    const http = await raw(s.port, 'GET', '/forums', { Host: 'pinkpill-demo.onrender.com', 'X-Forwarded-Proto': 'http' });
    assert.equal(http.status, 301);
    assert.equal(http.headers.location, 'https://pinkpill-demo.onrender.com/forums');
  } finally { s.child.kill('SIGTERM'); }
});
test('Render: listens on $PORT and uses RENDER_EXTERNAL_URL as the canonical URL until APP_URL is set', async () => {
  const s = await startProd({ APP_URL: '', RENDER_EXTERNAL_URL: 'https://pinkpill-demo.onrender.com' });
  try {
    assert.ok(s.started, s.output());
    assert.match(s.output(), /"appUrl":"https:\/\/pinkpill-demo\.onrender\.com"/);
    const health = await raw(s.port, 'GET', '/health', { Host: '10.0.0.5' });
    assert.equal(health.status, 200);
    const r = await raw(s.port, 'GET', '/forums', { Host: 'other.example', 'X-Forwarded-Proto': 'https' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, 'https://pinkpill-demo.onrender.com/forums');
  } finally { s.child.kill('SIGTERM'); }
});

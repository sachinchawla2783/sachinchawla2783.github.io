'use strict';
/* Test harness: real PostgreSQL test database, fresh schema per test file. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST || 'postgres://pinkpill:pinkpill@localhost:5432/pinkpill_test';
process.env.RATE_LIMITS = process.env.RATE_LIMITS || 'false';
process.env.REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION || 'true';

const request = require('supertest');
const db = require('../server/db');
const { migrate } = require('../server/db/migrate');
const { createApp } = require('../server/app');
const mailer = require('../server/lib/mailer');
const { invalidateRoles } = require('../server/lib/permissions');
const settings = require('../server/lib/settings');

let app;
async function setup() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db.pool, { log: () => {} });
  invalidateRoles(); settings.invalidate();
  app = createApp();
  return app;
}
async function teardown() { await db.pool.end(); }

/* A browser-like client: keeps cookies, sends X-Requested-With and the CSRF token. */
function client() {
  const agent = request.agent(app);
  const c = { agent, csrf: null, user: null };
  const send = (method, url, body) => {
    let r = agent[method](url).set('X-Requested-With', 'fetch');
    if (c.csrf) r = r.set('X-CSRF-Token', c.csrf);
    return body !== undefined ? r.send(body) : r;
  };
  c.get = (url) => send('get', url);
  c.post = (url, body) => send('post', url, body === undefined ? {} : body);
  c.patch = (url, body) => send('patch', url, body);
  c.put = (url, body) => send('put', url, body === undefined ? {} : body);
  c.del = (url, body) => send('delete', url, body);
  c.refresh = async () => { const r = await c.get('/api/auth/session'); c.csrf = r.body.csrfToken; c.user = r.body.user; return r; };
  return c;
}

let n = 0;
/* Register (and by default verify) a user; returns a logged-in client. */
async function member(opts = {}) {
  const username = opts.username || 'user' + (++n) + Math.random().toString(36).slice(2, 6);
  const c = client();
  const res = await c.post('/api/auth/register', { username, email: username.toLowerCase() + '@example.com', password: 'correct horse battery', birthday: '1995-05-05', agree: true });
  if (res.status !== 201) throw new Error('register failed: ' + JSON.stringify(res.body));
  c.csrf = res.body.csrfToken;
  if (opts.verify !== false) {
    const mail = mailer.outbox.filter((m) => m.to === username.toLowerCase() + '@example.com').pop();
    const token = mail.text.match(/token=([\w-]+)/)[1];
    const v = await c.post('/api/auth/verify-email', { token });
    if (v.status !== 200) throw new Error('verify failed');
  }
  if (opts.role) { await db.query('UPDATE users SET role_id = $2 WHERE username = $1', [username, opts.role]); invalidateRoles(); }
  await c.refresh();
  c.password = 'correct horse battery';
  return c;
}

const lastMail = (to) => mailer.outbox.filter((m) => m.to === to).pop();

module.exports = { setup, teardown, client, member, db, lastMail, getApp: () => app };

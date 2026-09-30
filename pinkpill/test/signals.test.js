'use strict';
/* Alt-account detection: sign-up/login signals, admin alerts, admin-only access. */
process.env.GEO_COUNTRY_HEADER = 'cf-ipcountry';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db, lastMail } = require('./helpers');
const { describeDevice } = require('../server/lib/signals');

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let admin, mod, plain;

/* Register through a given client (same client = same browser = same device cookie). */
async function registerOn(c, username, headers = {}) {
  let r = c.agent.post('/api/auth/register').set('X-Requested-With', 'fetch');
  if (c.csrf) r = r.set('X-CSRF-Token', c.csrf);   // the browser may still be logged in to another account
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const res = await r.send({ username, email: username + '@example.com', password: 'correct horse battery', birthday: '1999-01-01', agree: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  c.csrf = res.body.csrfToken;
  const token = lastMail(username + '@example.com').text.match(/token=([\w-]+)/)[1];
  await c.post('/api/auth/verify-email', { token });
  await c.refresh();
  return c;
}
const adminAlerts = async () => (await db.many("SELECT text, link FROM notifications WHERE user_id = $1 AND type = 'account' ORDER BY id", [admin.user.id]));

before(async () => {
  await setup();
  admin = await member({ username: 'siteadmin', role: 'admin' });
  mod = await member({ username: 'justmod', role: 'moderator' });
  plain = await member({ username: 'plainuser' });
});
after(teardown);

test('device names are parsed from the User-Agent', () => {
  assert.equal(describeDevice(UA_WIN), 'Chrome on Windows');
  assert.equal(describeDevice(UA_IPHONE), 'Safari on iPhone');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'Chrome on Android (SM-S918B)');
  assert.equal(describeDevice(''), 'Unknown device');
});

test('every new account alerts admins with IP, device and country; alts on the same browser are flagged', async () => {
  const browser = client();
  await registerOn(browser, 'firstacct', { 'User-Agent': UA_WIN, 'CF-IPCountry': 'GB' });
  let alerts = await adminAlerts();
  const first = alerts.find((a) => a.text.includes('New account: firstacct'));
  assert.ok(first, JSON.stringify(alerts));
  assert.match(first.text, /IP /);
  assert.match(first.text, /Chrome on Windows/);
  assert.match(first.text, /country GB/);
  // A second account made in the same browser (same device cookie) is flagged as a possible alt.
  const same = client();
  same.agent = browser.agent; same.csrf = browser.csrf;
  await registerOn(same, 'secondacct', { 'User-Agent': UA_WIN, 'CF-IPCountry': 'GB' });
  alerts = await adminAlerts();
  const second = alerts.find((a) => a.text.includes('New account: secondacct'));
  assert.match(second.text, /Possible alt of: .*firstacct \(same device\)/);
  // An invalid country header is ignored rather than stored.
  const other = client();
  await registerOn(other, 'thirdacct', { 'User-Agent': UA_IPHONE, 'CF-IPCountry': 'ZZZ' });
  const row = await db.one("SELECT country, device_name FROM account_signals s JOIN users u ON u.id = s.user_id WHERE u.username = 'thirdacct'");
  assert.equal(row.country, null);
  assert.equal(row.device_name, 'Safari on iPhone');
  // Everyone in these tests shares 127.0.0.1, so a different browser still matches by IP (weaker signal).
  assert.match(alerts.length ? (await adminAlerts()).find((a) => a.text.includes('thirdacct')).text : '', /same IP/);
});

test('only administrators can see sign-up signals; public profiles never expose them', async () => {
  const id = (await db.one("SELECT id FROM users WHERE username = 'secondacct'")).id;
  for (const c of [plain, mod]) {
    assert.equal((await c.get('/api/admin/accounts')).status, 403);
    assert.equal((await c.get('/api/admin/users/' + id + '/signals')).status, 403);
  }
  assert.equal((await client().get('/api/admin/accounts')).status, 401);
  const list = await admin.get('/api/admin/accounts');
  assert.equal(list.status, 200);
  const entry = list.body.accounts.find((a) => a.userId === String(id));
  assert.ok(entry.ip && entry.deviceId && entry.deviceName);
  assert.ok(entry.matches.some((m) => m.sameDevice));
  const one = await admin.get('/api/admin/users/' + id + '/signals');
  assert.equal(one.status, 200);
  assert.ok(one.body.signals.length >= 1);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'user.view_signals' AND target_id = $1", [String(id)]), 'viewing is audited');
  const pub = JSON.stringify((await plain.get('/api/members/' + id)).body);
  assert.ok(!/127\.0\.0\.1|deviceId|device_id|userAgent/.test(pub));
});

test('logging in from a banned member\'s device alerts admins (ban evasion)', async () => {
  const shared = client();
  await registerOn(shared, 'evader', { 'User-Agent': UA_WIN });
  const banned = (await db.one("SELECT id FROM users WHERE username = 'evader'")).id;
  assert.equal((await mod.post('/api/mod/users/' + banned + '/ban', { reason: 'spam' })).status, 200);
  // A different account logs in from the same browser.
  await db.query("UPDATE users SET status = 'active', email_verified_at = now() WHERE username = 'plainuser'");
  const r = await shared.agent.post('/api/auth/login').set('X-Requested-With', 'fetch').set('X-CSRF-Token', shared.csrf).set('User-Agent', UA_WIN).send({ login: 'plainuser', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  const alert = (await adminAlerts()).find((a) => a.text.startsWith('Possible ban evasion: plainuser'));
  assert.ok(alert, 'admins alerted');
  assert.match(alert.text, /device of banned evader/);
  // The member's own data export includes their sign-in records.
  shared.csrf = r.body.csrfToken;
  const exp = await shared.get('/api/account/export');
  assert.ok(exp.body.signInRecords.length >= 1);
});

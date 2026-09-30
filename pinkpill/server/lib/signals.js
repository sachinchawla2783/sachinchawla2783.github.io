'use strict';
/* Alt-account detection. On sign-up and login we record the IP address, a per-browser device ID (a random
 * value in a long-lived first-party cookie; browsers don't expose hardware IDs), a readable device name
 * parsed from the User-Agent, and the country if a trusted proxy supplies it. Administrators are alerted
 * when a new account shares an IP or device with existing accounts, and when a banned member's device or
 * IP is used to log in to another account. Only administrators (admin.users) can see this data. */
const db = require('../db');
const config = require('../config');
const { randomToken } = require('./crypto');
const { notify } = require('./notify');

const COOKIE = config.cookieSecure ? '__Host-pp_device' : 'pp_device';
const DEVICE_RE = /^[A-Za-z0-9_-]{20,64}$/;
const TWO_YEARS = 2 * 365 * 86400000;

/* Read this browser's device ID, creating it (and its cookie) on first use. */
function deviceId(req, res) {
  const cur = req.cookies && req.cookies[COOKIE];
  if (typeof cur === 'string' && DEVICE_RE.test(cur)) return cur;
  const id = randomToken(24);
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: TWO_YEARS });
  return id;
}

/* "Chrome on Windows", "Safari on iPhone", … from the User-Agent (best effort; UAs can be faked). */
function describeDevice(ua) {
  ua = String(ua || '');
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  let os = 'unknown OS';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) { const m = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua); os = 'Android' + (m && !/^(K|wv|Linux)$/.test(m[1].trim()) ? ' (' + m[1].trim().slice(0, 40) + ')' : ''); }
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return browser + ' on ' + os;
}

/* Country code, only from a header set by a proxy the operator trusts (GEO_COUNTRY_HEADER, e.g.
   cf-ipcountry behind Cloudflare). Without that, a visitor could fake it, so we record nothing. */
function country(req) {
  if (!config.geoCountryHeader) return null;
  const c = String(req.get(config.geoCountryHeader) || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

async function record(q, req, res, userId, event) {
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const row = { ip: req.ip || null, deviceId: deviceId(req, res), deviceName: describeDevice(ua), country: country(req) };
  await q.query(`INSERT INTO account_signals (user_id, event, ip, device_id, device_name, user_agent, country) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, event, row.ip, row.deviceId, row.deviceName, ua, row.country]);
  return row;
}

/* Other accounts that have used the same IP address or device as this account. */
async function matches(userId, q = db) {
  const rows = await q.many(`SELECT o.user_id, bool_or(o.device_id IS NOT NULL AND o.device_id = s.device_id) AS same_device,
      bool_or(o.ip IS NOT NULL AND o.ip = s.ip) AS same_ip, max(o.created_at) AS last_seen,
      EXISTS (SELECT 1 FROM bans b WHERE b.user_id = o.user_id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned
    FROM account_signals s JOIN account_signals o ON o.user_id <> s.user_id AND (o.ip = s.ip OR o.device_id = s.device_id)
    WHERE s.user_id = $1 GROUP BY o.user_id ORDER BY bool_or(o.device_id = s.device_id) DESC, max(o.created_at) DESC LIMIT 50`, [userId]);
  return rows.map((r) => ({ userId: String(r.user_id), sameDevice: r.same_device, sameIp: r.same_ip, banned: r.banned, lastSeen: r.last_seen }));
}

async function notifyAdmins(q, text, link) {
  const admins = await q.many(`SELECT u.id FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id AND rp.permission = 'admin.users' WHERE u.status <> 'deleted'`);
  for (const a of admins) await notify(q, { userId: a.id, type: 'account', text, link });
}

const place = (s) => [s.ip ? 'IP ' + s.ip : null, s.deviceName, s.country ? 'country ' + s.country : null].filter(Boolean).join(', ');

/* New account: always tell administrators, with any accounts it shares an IP or device with. */
async function onRegister(q, req, res, user) {
  const s = await record(q, req, res, user.id, 'register');
  const m = await matches(user.id, q);
  let alts = '';
  if (m.length) {
    const names = await q.many('SELECT id, username::text AS username FROM users WHERE id = ANY($1::bigint[])', [m.map((x) => x.userId)]);
    const byId = Object.fromEntries(names.map((n) => [String(n.id), n.username]));
    alts = ' ⚠ Possible alt of: ' + m.slice(0, 5).map((x) => byId[x.userId] + (x.sameDevice ? ' (same device)' : ' (same IP)') + (x.banned ? ' [BANNED]' : '')).join(', ') + (m.length > 5 ? ' +' + (m.length - 5) + ' more' : '');
  }
  await notifyAdmins(q, `New account: ${user.username} — ${place(s)}.${alts}`, '#/mod/accounts?user=' + user.id);
}

/* Login: record it, and alert administrators only when the device or IP belongs to a banned member. */
async function onLogin(q, req, res, userId, username) {
  const s = await record(q, req, res, userId, 'login');
  const banned = (await matches(userId, q)).filter((x) => x.banned);
  if (!banned.length) return;
  const recent = await q.one(`SELECT 1 FROM notifications WHERE type = 'account' AND link = $1 AND created_at > now() - interval '1 day' AND text LIKE 'Possible ban evasion%' LIMIT 1`, ['#/mod/accounts?user=' + userId]);
  if (recent) return;
  const names = await q.many('SELECT username::text AS username FROM users WHERE id = ANY($1::bigint[])', [banned.map((x) => x.userId)]);
  await notifyAdmins(q, `Possible ban evasion: ${username} logged in from the ${banned.some((x) => x.sameDevice) ? 'device' : 'IP'} of banned ${names.map((n) => n.username).join(', ')} — ${place(s)}.`, '#/mod/accounts?user=' + userId);
}

module.exports = { COOKIE, deviceId, describeDevice, country, record, matches, onRegister, onLogin };

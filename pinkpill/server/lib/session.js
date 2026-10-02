'use strict';
const db = require('../db');
const config = require('../config');
const { randomToken, sha256, safeEqual } = require('./crypto');
const { roles } = require('./permissions');
const vip = require('./vip');
const { forbidden } = require('./errors');

// __Host- prefix (production): browsers only accept it when Secure, Path=/ and no Domain, so a
// subdomain can't plant or overwrite the session cookie.
const COOKIE = config.cookieSecure ? '__Host-pp_session' : 'pp_session';
const DAY = 86400000;

function cookieOptions(persistent) {
  return {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/',
    ...(persistent ? { maxAge: config.sessionDays * DAY } : {}),
  };
}

async function createSession(req, res, userId, persistent = true) {
  // Rotate: never reuse an existing session id on login.
  if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
  const token = randomToken(32);
  const csrf = randomToken(24);
  await db.query(`INSERT INTO sessions (id, user_id, csrf_token, persistent, expires_at, ip, user_agent)
    VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6, $7)`,
  [sha256(token), userId, csrf, persistent, String(persistent ? config.sessionDays : 1), req.ip || null, String(req.get('user-agent') || '').slice(0, 300)]);
  res.cookie(COOKIE, token, cookieOptions(persistent));
  return csrf;
}

async function destroySession(req, res) {
  if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
  res.clearCookie(COOKIE, { ...cookieOptions(false) });
}

async function revokeOtherSessions(userId, keepSessionId) {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, keepSessionId || null]);
}

/* Resolve the session cookie into req.user from the database on every request. */
async function loadSession(req, res, next) {
  req.user = null; req.sessionId = null; req.csrfToken = null;
  const token = req.cookies && req.cookies[COOKIE];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  try {
    const row = await db.one(`SELECT s.id, s.csrf_token, s.persistent, s.last_used_at, u.id AS user_id, u.username, u.role_id, u.status,
        (SELECT json_build_object('reason', b.reason, 'expiresAt', b.expires_at) FROM bans b
          WHERE b.user_id = u.id AND b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())
          ORDER BY b.created_at DESC LIMIT 1) AS ban,
        (SELECT coalesce(json_agg(json_build_object('product_id', m.product_id, 'lifetime', m.lifetime, 'expiration_date', m.expiration_date)), '[]'::json)
          FROM vip_memberships m WHERE m.user_id = u.id AND ${vip.ACTIVE}) AS vip_rows
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.status <> 'deleted'`, [sha256(token)]);
    if (!row) { res.clearCookie(COOKIE, cookieOptions(false)); return next(); }
    const role = (await roles())[row.role_id];
    req.sessionId = row.id;
    req.csrfToken = row.csrf_token;
    req.user = {
      id: row.user_id, username: row.username, status: row.status, role: row.role_id,
      rank: role.rank, isStaff: role.isStaff, permissions: role.permissions, ban: row.ban,
      // Entitlements from active VIP memberships, recomputed from the database on every request.
      vip: row.vip_rows.length ? vip.combine(row.vip_rows, await vip.catalog()) : vip.NONE,
    };
    // Sliding expiry + presence, at most once a minute.
    if (Date.now() - new Date(row.last_used_at).getTime() > 60000) {
      db.query(`UPDATE sessions SET last_used_at = now(), expires_at = CASE WHEN persistent THEN now() + ($2 || ' days')::interval ELSE expires_at END WHERE id = $1`,
        [row.id, String(config.sessionDays)]).catch(() => {});
      db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.user_id]).catch(() => {});
    }
    next();
  } catch (err) { next(err); }
}

/* CSRF: unsafe requests from a logged-in user need the session's token in X-CSRF-Token.
   All unsafe requests are rejected when a foreign Origin header is present. */
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.appUrl && !config.corsOrigins.includes(origin) && !isSameHost(origin, req)) {
    return next(forbidden('Cross-origin request blocked.'));
  }
  if (req.user) {
    const sent = req.get('x-csrf-token') || '';
    if (!safeEqual(sent, req.csrfToken)) return next(forbidden('Invalid or missing CSRF token. Please reload the page.'));
    return next();
  }
  // Anonymous requests (login, register, reset): a custom header forces a CORS preflight,
  // which this server never approves for foreign origins, so cross-site forms can't forge them.
  if (!req.get('x-requested-with')) return next(forbidden('Missing request header.'));
  next();
}
function isSameHost(origin, req) {
  try { return new URL(origin).host === req.get('host'); } catch { return false; }
}

module.exports = { COOKIE, createSession, destroySession, revokeOtherSessions, loadSession, csrf };

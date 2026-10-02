'use strict';
const db = require('../db');
const config = require('../config');
const { unauthorized, forbidden } = require('./errors');

/* role id -> { rank, isStaff, title, permissions:Set }. Small table, cached briefly. */
let roleCache = null, roleCacheAt = 0;
async function roles() {
  if (roleCache && Date.now() - roleCacheAt < 30000) return roleCache;
  const rows = await db.many(`SELECT r.id, r.title, r.rank, r.is_staff, coalesce(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS perms
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id`);
  roleCache = {};
  rows.forEach((r) => { roleCache[r.id] = { id: r.id, title: r.title, rank: r.rank, isStaff: r.is_staff, permissions: new Set(r.perms) }; });
  roleCacheAt = Date.now();
  return roleCache;
}
function invalidateRoles() { roleCache = null; }

const WRITE_EXEMPT = new Set(); // permissions a banned user keeps (none: bans remove all write access)

/* Can this (server-resolved) user perform `perm`? Banned and unverified users can't write. */
function can(user, perm) {
  if (!user) return false;
  if (!user.permissions.has(perm)) return false;
  if (user.ban && !WRITE_EXEMPT.has(perm)) return false;
  if (config.requireEmailVerification && user.status !== 'active') return false;
  return true;
}

function denyReason(user, perm) {
  if (!user) return unauthorized();
  if (user.ban) return forbidden(user.ban.expiresAt
    ? 'Your account is suspended until ' + new Date(user.ban.expiresAt).toUTCString() + '. Reason: ' + user.ban.reason
    : 'Your account has been banned. Reason: ' + user.ban.reason);
  if (config.requireEmailVerification && user.status !== 'active' && user.permissions.has(perm)) return forbidden('Please verify your email address first.');
  return forbidden();
}

function assertCan(user, perm) { if (!can(user, perm)) throw denyReason(user, perm); }

const requireUser = (req, res, next) => (req.user ? next() : next(unauthorized()));
const requirePermission = (perm) => (req, res, next) => { try { assertCan(req.user, perm); next(); } catch (e) { next(e); } };

/* Staff can't change or remove content by a member of equal or higher rank, so nobody can
   override the owner (the highest rank). Own content is always allowed. */
async function assertOutranksAuthor(actor, authorId) {
  if (!authorId || String(authorId) === String(actor.id)) return;
  const r = await db.one('SELECT r.rank FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [authorId]);
  if (r && r.rank >= actor.rank) throw forbidden('You can\'t edit or remove content by a member of equal or higher rank.');
}

/* Staff may only act on members of strictly lower rank. */
function outranks(actor, targetRoleRank) { return !!actor && actor.rank > targetRoleRank; }

module.exports = { roles, invalidateRoles, can, assertCan, requireUser, requirePermission, outranks, assertOutranksAuthor };

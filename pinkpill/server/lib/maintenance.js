'use strict';
/* Housekeeping (expired sessions and tokens) piggybacks on real traffic, at most once an hour,
 * instead of running on a timer. A timer would wake a scaled-to-zero database for no visitor. */
const db = require('../db');
const config = require('../config');
const log = require('./log');

const INTERVAL_MS = 60 * 60 * 1000;
let lastRun = Date.now();   // don't run on the very first request after a cold start
let running = false;

async function run() {
  running = true;
  try {
    const r = await db.query(`WITH s AS (DELETE FROM sessions WHERE expires_at < now() RETURNING 1),
        p AS (DELETE FROM password_resets WHERE expires_at < now() - interval '1 day' RETURNING 1),
        e AS (DELETE FROM email_verifications WHERE expires_at < now() - interval '1 day' RETURNING 1)
      SELECT (SELECT count(*) FROM s)::int AS sessions, (SELECT count(*) FROM p)::int AS resets, (SELECT count(*) FROM e)::int AS verifications`);
    // Mark lapsed time-limited VIP memberships 'expired' (lifetime memberships are never touched).
    // Entitlement checks already ignore them the moment they lapse; this keeps statuses and the audit log tidy.
    const expired = await require('./vip').expireMemberships();
    log.info('maintenance.cleanup', Object.assign({ vipExpired: expired }, r.rows[0]));
  } catch (err) {
    log.warn('maintenance.failed', { code: err.code, message: err.message });
  } finally { running = false; }
}

function middleware(req, res, next) {
  if (!config.isTest && !running && Date.now() - lastRun > INTERVAL_MS) {
    lastRun = Date.now();
    res.on('finish', () => { run(); });
  }
  next();
}

module.exports = { middleware, run };

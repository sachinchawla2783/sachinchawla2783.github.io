'use strict';
/* Rate limits. The default store is in-process memory, which is correct for a single instance
   (the Render free plan runs one). To run several instances, pass a shared store (e.g. rate-limit-redis) via
   setStoreFactory() before the app is created; every limiter below will use it. */
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { tooMany } = require('./errors');

let storeFactory = () => undefined;   // undefined → express-rate-limit's MemoryStore
function setStoreFactory(fn) { storeFactory = fn; }

const handler = (req, res, next, options) => { res.set('Retry-After', String(Math.ceil(options.windowMs / 1000))); next(tooMany(options.message)); };
const byUser = (req) => (req.user ? 'u' + req.user.id : 'ip' + rateLimit.ipKeyGenerator(req.ip));

function mk(name, windowMs, limit, message, { perUser = false, onlyWrites = false } = {}) {
  return rateLimit({
    windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler, message,
    store: storeFactory(name),
    skip: (req) => !config.rateLimits.enabled || (onlyWrites && ['GET', 'HEAD', 'OPTIONS'].includes(req.method)),
    ...(perUser ? { keyGenerator: byUser } : {}),
  });
}

const MIN = 60 * 1000, HOUR = 60 * MIN;
module.exports = {
  setStoreFactory,
  // Browsing: generous, per IP.
  api: mk('api', MIN, 300, 'Too many requests. Slow down a little.'),
  search: mk('search', MIN, 30, 'Too many searches. Please wait a moment.'),
  // Accounts, per IP.
  login: mk('login', 15 * MIN, 20, 'Too many login attempts. Try again in 15 minutes.'),
  register: mk('register', HOUR, 5, 'Too many accounts created from this network. Try again later.'),
  passwordReset: mk('passwordReset', HOUR, 5, 'Too many password reset requests. Try again later.'),
  verifyEmail: mk('verifyEmail', HOUR, 20, 'Too many verification attempts. Try again later.'),
  // Per account.
  verification: mk('verification', HOUR, 3, 'Too many verification emails requested. Try again later.', { perUser: true }),
  thread: mk('thread', 10 * MIN, 10, 'You\'re starting threads too fast. Please wait a few minutes.', { perUser: true }),
  reply: mk('reply', MIN, 20, 'You\'re posting too fast. Please wait a moment.', { perUser: true }),
  write: mk('write', MIN, 60, 'You\'re doing that too fast. Please wait a moment.', { perUser: true }),
  message: mk('message', MIN, 15, 'You\'re sending messages too fast. Please wait a moment.', { perUser: true }),
  upload: mk('upload', HOUR, 60, 'Upload limit reached. Try again later.', { perUser: true }),
  report: mk('report', HOUR, 20, 'Report limit reached. Try again later.', { perUser: true }),
  admin: mk('admin', MIN, 60, 'Too many moderation/admin actions. Please wait a moment.', { perUser: true, onlyWrites: true }),
};

'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { tooMany } = require('./errors');

const handler = (req, res, next, options) => next(tooMany(options.message));
const mk = (windowMs, limit, message, keyByUser) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler, message,
  skip: () => !config.rateLimits.enabled,
  ...(keyByUser ? { keyGenerator: (req) => (req.user ? 'u' + req.user.id : rateLimit.ipKeyGenerator(req.ip)) } : {}),
});

module.exports = {
  api: mk(60 * 1000, 300, 'Too many requests. Slow down a little.'),
  login: mk(15 * 60 * 1000, 20, 'Too many login attempts. Try again in 15 minutes.'),
  register: mk(60 * 60 * 1000, 5, 'Too many accounts created from this network. Try again later.'),
  email: mk(60 * 60 * 1000, 5, 'Too many email requests. Try again later.'),
  write: mk(60 * 1000, 30, 'You\'re posting too fast. Please wait a moment.', true),
  upload: mk(60 * 60 * 1000, 60, 'Upload limit reached. Try again later.', true),
  report: mk(60 * 60 * 1000, 20, 'Report limit reached. Try again later.', true),
};

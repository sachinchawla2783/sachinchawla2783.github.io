'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const log = require('./lib/log');
const { loadSession, csrf } = require('./lib/session');
const { HttpError, notFound } = require('./lib/errors');
const limits = require('./lib/limits');
const { can } = require('./lib/permissions');
const maintenance = require('./lib/maintenance');

const APP_HOST = new URL(config.appUrl).host;

/* Only the request path is logged (never the query string, body, cookies or headers). */
function accessLog(req, res, next) {
  const start = process.hrtime.bigint();
  const id = /^[\w-]{8,64}$/.test(req.get('x-request-id') || '') ? req.get('x-request-id') : crypto.randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/ready') return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route ? (req.baseUrl || '') + req.route.path : req.path.replace(/\/[0-9a-f-]{36}$/, '/:uuid');
    const rec = { reqId: id, method: req.method, route, status: res.statusCode, ms: Math.round(ms), user: req.user ? req.user.id : undefined, err: res.locals.errorCode };
    if (res.statusCode >= 500) log.error('http.request', rec); else if (!req.path.startsWith('/api') && res.statusCode < 400) log.debug('http.request', rec); else log.info('http.request', rec);
  });
  next();
}

function createApp(opts = {}) {
  const isShuttingDown = opts.isShuttingDown || (() => false);
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');   // no nested objects from query strings (prototype pollution)

  app.use(accessLog);

  /* Liveness: the process is up. Never touches the database (so it doesn't keep Neon awake). */
  app.get('/health', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
  /* Readiness: dependencies reachable. */
  app.get('/ready', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (isShuttingDown()) return res.status(503).json({ status: 'shutting_down' });
    try { await db.ping(3000); res.json({ status: 'ready' }); } catch { res.status(503).json({ status: 'unavailable' }); }
  });

  /* Production: one canonical origin over HTTPS. Links are built from APP_URL, never the Host header. */
  if (config.canonicalRedirect) {
    app.use((req, res, next) => {
      if (req.get('host') === APP_HOST && req.secure) return next();
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, config.appUrl + req.originalUrl);
      return next(new HttpError(421, 'wrong_host', 'Please use ' + config.appUrl));
    });
  }

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Turnstile loads its widget script from Cloudflare.
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],            // style="" attributes in templates
        // data: only for the inline SVG favicon; https: for [img] links and short-lived R2 image URLs.
        imgSrc: ["'self'", 'data:', 'https:'],
        // YouTube-nocookie for [media] embeds; Cloudflare for the Turnstile challenge iframe.
        frameSrc: ['https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'); next(); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.use('/api', limits.api);
  // Payment webhooks: raw body, authenticated by the provider's signature (not by cookies or CSRF).
  app.use('/api/payments/webhooks', require('./routes/webhooks'));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(maintenance.middleware);
  // Small JSON bodies everywhere; the admin import alone accepts large files, and only after the
  // session has been resolved and the admin.import permission checked (so anonymous users can't
  // make the server buffer big bodies).
  const smallJson = express.json({ limit: '100kb', strict: true });
  const largeJson = express.json({ limit: '25mb', strict: true });
  app.use((req, res, next) => {
    if (req.path === '/api/admin/import' && req.method === 'POST') {
      if (!can(req.user, 'admin.import')) return next(new HttpError(req.user ? 403 : 401, req.user ? 'forbidden' : 'unauthorized', req.user ? 'You do not have permission to do that.' : 'You must be logged in to do that.'));
      return largeJson(req, res, next);
    }
    return smallJson(req, res, next);
  });
  app.use('/api', csrf);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/account', require('./routes/account'));
  app.use('/api', require('./routes/forums'));
  app.use('/api', require('./routes/posts'));
  app.use('/api', require('./routes/members'));
  app.use('/api', require('./routes/conversations'));
  app.use('/api', require('./routes/notifications'));
  app.use('/api', require('./routes/search'));
  app.use('/api', require('./routes/uploads'));
  app.use('/api', require('./routes/reports'));
  app.use('/api', require('./routes/vip'));
  app.use('/api/mod', require('./routes/mod'));
  app.use('/api/admin/vip', require('./routes/admin-vip'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/media', require('./routes/media'));
  app.use('/api', (req, res, next) => next(notFound('Unknown API endpoint.')));

  /* Friendly page URLs (the app itself uses #/ routes). VIP pages are for members only: logged-out
     visitors are sent to the login page and brought back afterwards. Only whitelisted query keys pass. */
  const pageRedirect = (membersOnly) => (req, res) => {
    const q = new URLSearchParams();
    for (const k of ['order', 'cancelled']) if (typeof req.query[k] === 'string' && /^[\w-]{1,64}$/.test(req.query[k])) q.set(k, req.query[k]);
    const hash = '#' + req.path.replace(/\/+$/, '') + (q.toString() ? '?' + q : '');
    res.set('Cache-Control', 'no-store');
    if (membersOnly && !req.user) return res.redirect(302, '/#/login?return=' + encodeURIComponent(hash));
    res.redirect(302, '/' + hash);
  };
  app.get(['/vip', '/vip/checkout/:slug', '/vip/gift/:slug', '/vip/return', '/account/vip', '/account/purchases'], pageRedirect(true));
  app.get('/u/:slug', pageRedirect(false));

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    // Asset URLs aren't versioned, so browsers must revalidate (cheap 304 via ETag); otherwise a deploy
    // stays invisible until a cached copy expires.
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request body is too large.');
    else if (err.type === 'entity.parse.failed') err = new HttpError(400, 'bad_json', 'Malformed JSON body.');
    else if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'too_large', 'That file is too large.');
    else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT') err = new HttpError(400, 'bad_upload', 'Unexpected upload fields.');
    else if (err.code === '23505') err = new HttpError(409, 'conflict', 'That already exists.');
    else if (err.code === '23503') err = new HttpError(409, 'conflict', 'A related item no longer exists.');
    else if (err.code === '23514' || err.code === '22P02' || err.code === '22001') err = new HttpError(422, 'validation_failed', 'Invalid input.');
    else if (db.isTransient(err) || err.code === '57014') {
      log.warn('db.unavailable', { reqId: req.id, code: err.code, message: err.message });
      res.set('Retry-After', '5');
      err = new HttpError(503, 'unavailable', 'The database is waking up or busy. Please try again in a few seconds.');
    }
    if (!(err instanceof HttpError)) {
      log.error('http.unhandled_error', { reqId: req.id, name: err.name, code: err.code, message: err.message, stack: err.stack });
      err = new HttpError(500, 'server_error', 'Something went wrong on our side.');
    }
    res.locals.errorCode = err.code;
    const body = { error: { code: err.code, message: err.message } };
    if (err.fields) body.error.fields = err.fields;
    if (err.status >= 500) body.error.requestId = req.id;
    res.status(err.status).json(body);
  });
  return app;
}

module.exports = { createApp };

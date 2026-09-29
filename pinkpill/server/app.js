'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { loadSession, csrf } = require('./lib/session');
const { HttpError, notFound } = require('./lib/errors');
const limits = require('./lib/limits');
const { can } = require('./lib/permissions');

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');   // no nested objects from query strings (prototype pollution)

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],          // style="" attributes in templates
        imgSrc: ["'self'", 'data:', 'https:'],             // data: only for the inline SVG favicon
        frameSrc: ['https://www.youtube-nocookie.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd,
  }));

  app.use('/api', limits.api);
  app.use(cookieParser());
  app.use(loadSession);
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
  app.use('/api/mod', require('./routes/mod'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/media', require('./routes/media'));
  app.use('/api', (req, res, next) => next(notFound('Unknown API endpoint.')));

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request body is too large.');
    else if (err.type === 'entity.parse.failed') err = new HttpError(400, 'bad_json', 'Malformed JSON body.');
    else if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'too_large', 'That file is too large.');
    else if (err.code === '23505') err = new HttpError(409, 'conflict', 'That already exists.');
    else if (err.code === '23503') err = new HttpError(409, 'conflict', 'A related item no longer exists.');
    else if (err.code === '23514' || err.code === '22P02' || err.code === '22001') err = new HttpError(422, 'validation_failed', 'Invalid input.');
    if (!(err instanceof HttpError)) {
      console.error(err);
      err = new HttpError(500, 'server_error', 'Something went wrong on our side.');
    }
    const body = { error: { code: err.code, message: err.message } };
    if (err.fields) body.error.fields = err.fields;
    res.status(err.status).json(body);
  });
  return app;
}

module.exports = { createApp };

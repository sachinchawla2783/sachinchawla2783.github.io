'use strict';
/* Configuration comes only from environment variables (optionally loaded from .env). */
const path = require('node:path');
const fs = require('node:fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && process.env.NODE_ENV !== 'test') process.loadEnvFile(envFile);

const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function bool(v, dflt) { return v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v); }
function int(v, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; }

const config = {
  env: NODE_ENV, isProd, isTest,
  port: int(env.PORT, 3000),
  // RENDER_EXTERNAL_URL (and similar host-provided vars) let the app work before a custom domain is set.
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: isTest ? (env.DATABASE_URL_TEST || env.DATABASE_URL) : env.DATABASE_URL,
  databaseSsl: bool(env.DATABASE_SSL, false),
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'loopback'),
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  sessionDays: int(env.SESSION_DAYS, 30),
  requireEmailVerification: bool(env.REQUIRE_EMAIL_VERIFICATION, isProd),
  // One-time secret that lets a logged-in member claim super admin while no super admin exists.
  // For hosts without shell access. Ignored if shorter than 24 characters.
  adminClaimToken: (env.ADMIN_CLAIM_TOKEN || '').length >= 24 ? env.ADMIN_CLAIM_TOKEN : '',
  mail: {
    transport: env.MAIL_TRANSPORT || (isTest ? 'memory' : 'console'),   // console | smtp | memory | file (dev)
    from: env.MAIL_FROM || 'PinkPill <no-reply@localhost>',
    smtpUrl: env.SMTP_URL || '',
    dir: path.resolve(env.MAIL_DIR || path.join(__dirname, '..', 'storage', 'mail')),
  },
  storage: {
    driver: env.STORAGE_DRIVER || 'local',                               // local | s3
    localDir: path.resolve(env.STORAGE_DIR || path.join(__dirname, '..', 'storage', isTest ? 'test' : 'uploads')),
    s3: {
      bucket: env.S3_BUCKET || '', region: env.S3_REGION || 'auto', endpoint: env.S3_ENDPOINT || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    },
  },
  uploadMaxBytes: int(env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
  rateLimits: { enabled: bool(env.RATE_LIMITS, true) },
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
}
if (isProd && !config.appUrl.startsWith('https://')) {
  console.warn('[config] WARNING: APP_URL should use https:// in production.');
}
if (isProd && !config.cookieSecure) {
  console.warn('[config] WARNING: COOKIE_SECURE is off in production; session cookies can leak over plain HTTP.');
}
if (isProd && !config.requireEmailVerification) {
  console.warn('[config] WARNING: REQUIRE_EMAIL_VERIFICATION is off in production.');
}
if (isProd && ['console', 'memory', 'file'].includes(config.mail.transport)) {
  console.warn('[config] WARNING: MAIL_TRANSPORT is "' + config.mail.transport + '" in production; verification and reset emails will not be delivered.');
}

module.exports = config;

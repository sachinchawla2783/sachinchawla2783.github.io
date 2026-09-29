'use strict';
/* Configuration comes only from environment variables (optionally loaded from .env in development).
 * In production, unsafe or incomplete settings stop the server at startup instead of failing later. */
const path = require('node:path');
const fs = require('node:fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && !['test', 'production'].includes(process.env.NODE_ENV)) process.loadEnvFile(envFile);

const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function bool(v, dflt) { return v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v); }
function int(v, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; }

const r2AccountId = env.R2_ACCOUNT_ID || '';

const config = {
  env: NODE_ENV, isProd, isTest,
  port: int(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  // Canonical public URL. Every generated link (emails, redirects) uses this, never the Host header.
  appUrl: (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  // Redirect other hostnames (e.g. the apex domain, the *.koyeb.app URL) and plain HTTP to APP_URL.
  canonicalRedirect: bool(env.CANONICAL_REDIRECT, isProd),
  databaseUrl: isTest ? (env.DATABASE_URL_TEST || env.DATABASE_URL) : env.DATABASE_URL,
  db: {
    ssl: bool(env.DATABASE_SSL, false),
    sslRejectUnauthorized: bool(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    poolMax: int(env.DB_POOL_MAX, 5),
    idleTimeoutMs: int(env.DB_IDLE_TIMEOUT_MS, 10000),
    connectionTimeoutMs: int(env.DB_CONNECTION_TIMEOUT_MS, 10000),
    statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 15000),
  },
  migrateOnStart: bool(env.MIGRATE_ON_START, true),
  shutdownTimeoutMs: int(env.SHUTDOWN_TIMEOUT_MS, 10000),
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'loopback'),
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  sessionDays: int(env.SESSION_DAYS, 30),
  requireEmailVerification: bool(env.REQUIRE_EMAIL_VERIFICATION, isProd),
  // One-time secret that lets a logged-in member claim super admin while no super admin exists.
  // For hosts without shell access. Ignored if shorter than 24 characters.
  adminClaimToken: (env.ADMIN_CLAIM_TOKEN || '').length >= 24 ? env.ADMIN_CLAIM_TOKEN : '',
  mail: {
    // resend (production) | file (development: one .txt per email) | memory (tests) | console (development only)
    transport: env.MAIL_TRANSPORT || (isTest ? 'memory' : isProd ? 'resend' : 'file'),
    from: env.MAIL_FROM || 'PinkPill <no-reply@localhost>',
    resendApiKey: env.RESEND_API_KEY || '',
    resendApiUrl: env.RESEND_API_URL || 'https://api.resend.com/emails',
    dir: path.resolve(env.MAIL_DIR || path.join(__dirname, '..', 'storage', 'mail')),
  },
  storage: {
    driver: env.STORAGE_DRIVER || (isProd ? 'r2' : 'local'),   // local | r2 | s3
    localDir: path.resolve(env.STORAGE_DIR || path.join(__dirname, '..', 'storage', isTest ? 'test' : 'uploads')),
    s3: {
      bucket: env.R2_BUCKET || env.S3_BUCKET || '',
      region: env.S3_REGION || 'auto',
      endpoint: env.S3_ENDPOINT || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : ''),
      accessKeyId: env.R2_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
    },
    signedUrlSeconds: int(env.MEDIA_URL_TTL_SECONDS, 300),
  },
  uploadMaxBytes: int(env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
  imageConcurrency: int(env.IMAGE_CONCURRENCY, 1),
  turnstile: {
    siteKey: env.TURNSTILE_SITE_KEY || '',
    secretKey: env.TURNSTILE_SECRET_KEY || '',
    verifyUrl: env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    onLogin: bool(env.TURNSTILE_ON_LOGIN, false),
  },
  rateLimits: { enabled: bool(env.RATE_LIMITS, true) },
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

/* ---------- validation ---------- */

const problems = [];
if (!config.databaseUrl) problems.push('DATABASE_URL is not set.');
try { new URL(config.appUrl); } catch { problems.push('APP_URL is not a valid URL.'); }
if (isProd) {
  if (!config.appUrl.startsWith('https://')) problems.push('APP_URL must start with https:// in production.');
  if (!config.cookieSecure) problems.push('COOKIE_SECURE must not be disabled in production.');
  if (['console', 'file', 'memory'].includes(config.mail.transport)) problems.push(`MAIL_TRANSPORT "${config.mail.transport}" is for development only; use "resend".`);
  if (config.mail.transport === 'resend' && !config.mail.resendApiKey) problems.push('RESEND_API_KEY is required when MAIL_TRANSPORT=resend.');
  if (config.mail.transport === 'resend' && /localhost/.test(config.mail.from)) problems.push('MAIL_FROM must be an address on your verified sending domain.');
  if (config.storage.driver === 'local' && !bool(env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION, false)) problems.push('STORAGE_DRIVER=local is not durable on Koyeb; use "r2" (or set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true if you really have a persistent disk).');
  if (['r2', 's3'].includes(config.storage.driver)) {
    const s = config.storage.s3;
    if (!s.bucket || !s.endpoint || !s.accessKeyId || !s.secretAccessKey) problems.push('R2 storage needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
  }
  if (!!config.turnstile.siteKey !== !!config.turnstile.secretKey) problems.push('Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither.');
}
if (!['local', 'r2', 's3'].includes(config.storage.driver)) problems.push('STORAGE_DRIVER must be local, r2 or s3.');
if (!['resend', 'file', 'memory', 'console'].includes(config.mail.transport)) problems.push('MAIL_TRANSPORT must be resend, file, memory or console.');

if (problems.length) {
  const msg = 'Invalid configuration:\n  - ' + problems.join('\n  - ');
  if (isProd || !config.databaseUrl) throw new Error(msg);
  process.stderr.write('[config] ' + msg + '\n');
}
if (isProd && !config.requireEmailVerification) process.stderr.write('[config] WARNING: REQUIRE_EMAIL_VERIFICATION is off in production.\n');
if (isProd && !config.turnstile.secretKey) process.stderr.write('[config] WARNING: Turnstile is not configured; registration relies on rate limits and the honeypot only.\n');

module.exports = config;

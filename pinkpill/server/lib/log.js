'use strict';
/* Structured logging. One JSON object per line in production (easy to search in Render's log view),
 * readable lines in development, silent in tests unless LOG_LEVEL is set.
 * Never pass secrets, cookies, tokens, passwords, message contents or email bodies to these functions;
 * as a safety net, keys that look sensitive are redacted. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const threshold = LEVELS[env.LOG_LEVEL] || (env.NODE_ENV === 'test' ? LEVELS.silent : LEVELS.info);
const SENSITIVE = /pass(word)?|secret|token|cookie|authorization|api[_-]?key|session|csrf|content|body|text/i;

function redact(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = SENSITIVE.test(k) ? '[redacted]' : v;
  return out;
}

function write(level, event, fields) {
  if (LEVELS[level] < threshold) return;
  const rec = Object.assign({ ts: new Date().toISOString(), level, event }, redact(fields));
  const line = isProd ? JSON.stringify(rec)
    : `${rec.ts} ${level.toUpperCase().padEnd(5)} ${event} ${Object.entries(rec).filter(([k]) => !['ts', 'level', 'event'].includes(k)).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ')}`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (e, f) => write('debug', e, f),
  info: (e, f) => write('info', e, f),
  warn: (e, f) => write('warn', e, f),
  error: (e, f) => write('error', e, f),
  redact,
};

'use strict';
/* Cloudflare Turnstile, verified server-side on every protected request. The browser's token is only
   evidence to check with Cloudflare, never trusted by itself. Disabled when TURNSTILE_SECRET_KEY is unset
   (development/tests); fails closed (rejects) if Cloudflare can't be reached. */
const config = require('../config');
const log = require('./log');
const { forbidden } = require('./errors');

const enabled = () => !!config.turnstile.secretKey;

async function verify(token, ip) {
  if (!enabled()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(config.turnstile.verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstile.secretKey, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!data.success) log.info('turnstile.rejected', { codes: (data['error-codes'] || []).join(',') });
    return data.success === true;
  } catch (err) {
    log.warn('turnstile.unreachable', { message: err.message });
    return false;
  } finally { clearTimeout(timer); }
}

/* Express helper: reads `turnstileToken` from the JSON body. */
async function require_(req) {
  if (!(await verify(req.body && req.body.turnstileToken, req.ip))) throw forbidden('Please complete the anti-spam check and try again.');
}

module.exports = { enabled, verify, require: require_ };

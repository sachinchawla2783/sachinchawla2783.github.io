'use strict';
/* Shared helpers for payment providers. Provider errors never carry provider response bodies to the
   browser: routes turn them into a generic message and the details go to the server log only. */
const crypto = require('node:crypto');
const log = require('../log');

class ProviderError extends Error {
  constructor(provider, status, detail) {
    super(`${provider} request failed (${status})`);
    this.provider = provider; this.providerStatus = status; this.detail = detail;
  }
}

class WebhookError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/* JSON/form request with a timeout. Returns parsed JSON or throws ProviderError. */
async function call(provider, url, { method = 'GET', headers = {}, json, form, timeoutMs = 15000 } = {}) {
  let body;
  const h = Object.assign({ Accept: 'application/json' }, headers);
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  let res;
  try {
    res = await fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    log.warn('payments.unreachable', { provider, message: err.message });
    throw new ProviderError(provider, 0, 'unreachable');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data && (data.error && (data.error.code || data.error.type)) || data.name || data.message || '') + '';
    log.warn('payments.error', { provider, status: res.status, detail: detail.slice(0, 120) });
    throw new ProviderError(provider, res.status, detail);
  }
  return data;
}

/* "12.34" -> 1234. Rejects anything that isn't a plain non-negative decimal amount. */
function toCents(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
const fromCents = (cents) => (cents / 100).toFixed(2);

function hmacHex(secret, payload) { return crypto.createHmac('sha256', secret).update(payload).digest('hex'); }
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { ProviderError, WebhookError, call, toCents, fromCents, hmacHex, safeEqualHex };

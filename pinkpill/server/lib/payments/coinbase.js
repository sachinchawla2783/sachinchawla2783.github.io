'use strict';
/* Cryptocurrency through Coinbase Commerce hosted charges. A charge counts as paid only when Coinbase
 * reports it COMPLETED/RESOLVED (via a signed webhook or an authenticated status lookup) and the
 * local-currency price matches the order. Crypto payments can't be refunded automatically. */
const config = require('../../config');
const { call, WebhookError, toCents, fromCents, hmacHex, safeEqualHex } = require('./common');

const cfg = () => config.payments.coinbase;
const coinbase = (method, path, json) => call('coinbase', cfg().apiUrl + path, { method, json, headers: { 'X-CC-Api-Key': cfg().apiKey, 'X-CC-Version': '2018-03-22' } });

function chargeResult(c) {
  const timeline = c.timeline || [];
  const last = timeline.length ? timeline[timeline.length - 1].status : '';
  const local = (c.pricing && c.pricing.local) || {};
  if (last === 'COMPLETED' || last === 'RESOLVED') {
    const pay = (c.payments || [])[0];
    return { status: 'paid', txnId: (pay && pay.transaction_id) || c.code, amountCents: toCents(local.amount), currency: String(local.currency || '').toUpperCase() };
  }
  if (last === 'EXPIRED' || last === 'CANCELED') return { status: 'failed', reason: 'charge_' + last.toLowerCase() };
  return { status: 'pending' };
}

module.exports = {
  id: 'coinbase',
  method: 'crypto',
  label: 'Cryptocurrency',
  configured: () => !!(cfg().apiKey && cfg().webhookSecret),
  supportsRefund: false,

  async createCheckout(order, product, urls) {
    const r = await coinbase('POST', '/charges', {
      name: 'PinkPill ' + product.name, description: product.description.slice(0, 200) || 'PinkPill VIP',
      pricing_type: 'fixed_price', local_price: { amount: fromCents(order.amount_cents), currency: order.currency },
      metadata: { order_id: order.public_id }, redirect_url: urls.success, cancel_url: urls.cancel,
    });
    const c = r.data || {};
    if (!c.code || !/^https:\/\//.test(c.hosted_url || '')) throw new Error('Coinbase returned no checkout URL');
    return { providerRef: c.code, redirectUrl: c.hosted_url };
  },

  async verify(order) {
    const r = await coinbase('GET', '/charges/' + encodeURIComponent(order.provider_ref));
    return chargeResult(r.data || {});
  },

  parseWebhook(raw, headers) {
    const sig = String(headers['x-cc-webhook-signature'] || '');
    if (!sig) throw new WebhookError('Missing signature.');
    if (!safeEqualHex(sig, hmacHex(cfg().webhookSecret, raw))) throw new WebhookError('Invalid signature.');
    const body = JSON.parse(raw.toString('utf8'));
    const event = body.event || {};
    const c = event.data || {};
    const base = { eventId: String(event.id), type: String(event.type) };
    const publicId = c.metadata && c.metadata.order_id;
    if (event.type === 'charge:confirmed' || event.type === 'charge:resolved') {
      const local = (c.pricing && c.pricing.local) || {};
      const pay = (c.payments || [])[0];
      return { ...base, action: 'paid', providerRef: c.code, publicId, txnId: (pay && pay.transaction_id) || c.code, amountCents: toCents(local.amount), currency: String(local.currency || '').toUpperCase() };
    }
    if (event.type === 'charge:failed') return { ...base, action: 'failed', providerRef: c.code, publicId, reason: 'charge_failed' };
    return { ...base, action: 'ignore' };
  },
};

'use strict';
/* PayPal Checkout (Orders v2). The buyer approves on PayPal; the server then captures the order with
 * its own credentials and only a COMPLETED capture for the exact amount counts as payment.
 * Webhooks are verified with PayPal's verify-webhook-signature API. */
const config = require('../../config');
const { call, WebhookError, toCents, fromCents } = require('./common');

const cfg = () => config.payments.paypal;
let token = null, tokenExp = 0;

async function accessToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const basic = Buffer.from(cfg().clientId + ':' + cfg().clientSecret).toString('base64');
  const r = await call('paypal', cfg().apiUrl + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + basic }, form: { grant_type: 'client_credentials' } });
  token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 300) * 1000;
  return token;
}

async function paypal(method, path, json, requestId) {
  const headers = { Authorization: 'Bearer ' + await accessToken() };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  return call('paypal', cfg().apiUrl + path, { method, headers, json });
}

function captureResult(capture) {
  if (!capture) return { status: 'pending' };
  if (capture.status === 'COMPLETED') {
    return { status: 'paid', txnId: capture.id, amountCents: toCents(capture.amount && capture.amount.value), currency: String((capture.amount && capture.amount.currency_code) || '').toUpperCase() };
  }
  if (['DECLINED', 'FAILED'].includes(capture.status)) return { status: 'failed', reason: 'capture_' + capture.status.toLowerCase() };
  return { status: 'pending' };
}
const firstCapture = (o) => (((o.purchase_units || [])[0] || {}).payments || {}).captures ? o.purchase_units[0].payments.captures[0] : null;

module.exports = {
  id: 'paypal',
  method: 'paypal',
  label: 'PayPal',
  configured: () => !!(cfg().clientId && cfg().clientSecret && cfg().webhookId),
  supportsRefund: true,

  async createCheckout(order, product, urls) {
    const o = await paypal('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.public_id, custom_id: order.public_id, description: 'PinkPill ' + product.name,
        amount: { currency_code: order.currency, value: fromCents(order.amount_cents) },
      }],
      application_context: { brand_name: 'PinkPill', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: urls.success, cancel_url: urls.cancel },
    }, 'order-' + order.public_id);
    const link = (o.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!o.id || !link || !/^https:\/\//.test(link.href)) throw new Error('PayPal returned no approval URL');
    return { providerRef: o.id, redirectUrl: link.href };
  },

  /* Capture an approved order (idempotent via PayPal-Request-Id) or read an existing capture. */
  async verify(order) {
    const o = await paypal('GET', '/v2/checkout/orders/' + encodeURIComponent(order.provider_ref));
    if (o.status === 'COMPLETED') return captureResult(firstCapture(o));
    if (o.status === 'APPROVED') {
      const c = await paypal('POST', '/v2/checkout/orders/' + encodeURIComponent(order.provider_ref) + '/capture', {}, 'capture-' + order.public_id);
      return captureResult(firstCapture(c));
    }
    if (o.status === 'VOIDED') return { status: 'failed', reason: 'order_voided' };
    return { status: 'pending' };
  },

  async refund(order) {
    await paypal('POST', '/v2/payments/captures/' + encodeURIComponent(order.provider_txn_id) + '/refund', {}, 'refund-' + order.public_id);
  },

  /* PayPal webhooks are verified by PayPal itself (async), so this returns a promise. */
  async parseWebhook(raw, headers) {
    const h = (k) => String(headers[k] || '');
    if (!h('paypal-transmission-id') || !h('paypal-transmission-sig')) throw new WebhookError('Missing signature.');
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new WebhookError('Malformed body.'); }
    const v = await paypal('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
      webhook_id: cfg().webhookId, webhook_event: event,
    });
    if (v.verification_status !== 'SUCCESS') throw new WebhookError('Invalid signature.');
    const r = event.resource || {};
    const base = { eventId: String(event.id), type: String(event.event_type) };
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return { ...base, action: 'paid', publicId: r.custom_id, providerRef: r.supplementary_data && r.supplementary_data.related_ids && r.supplementary_data.related_ids.order_id,
          txnId: r.id, amountCents: toCents(r.amount && r.amount.value), currency: String((r.amount && r.amount.currency_code) || '').toUpperCase() };
      case 'PAYMENT.CAPTURE.DENIED':
        return { ...base, action: 'failed', publicId: r.custom_id, reason: 'capture_denied' };
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        // The refund resource links back ("up") to the capture it refunds.
        const up = (r.links || []).find((l) => l.rel === 'up');
        const m = up && /\/captures\/([A-Za-z0-9-]+)/.exec(up.href);
        const txnId = event.event_type === 'PAYMENT.CAPTURE.REVERSED' ? r.id : m && m[1];
        return txnId ? { ...base, action: 'refunded', txnId } : { ...base, action: 'ignore' };
      }
      default:
        return { ...base, action: 'ignore' };
    }
  },
};

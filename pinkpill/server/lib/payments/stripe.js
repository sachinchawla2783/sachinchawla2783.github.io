'use strict';
/* Credit/debit cards through Stripe Checkout (hosted payment page; card data never touches PinkPill).
 * Payment is confirmed server-side either by the signed webhook or by retrieving the Checkout Session
 * with the secret key. One-time payments only (no automatic renewals). */
const config = require('../../config');
const { call, WebhookError, hmacHex, safeEqualHex } = require('./common');

const cfg = () => config.payments.stripe;
const TOLERANCE_S = 300;

function stripe(method, path, form, idempotencyKey) {
  const headers = { Authorization: 'Bearer ' + cfg().secretKey };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return call('stripe', cfg().apiUrl + path, { method, headers, form });
}

module.exports = {
  id: 'stripe',
  method: 'card',
  label: 'Credit Card',
  configured: () => !!(cfg().secretKey && cfg().webhookSecret),
  supportsRefund: true,

  async createCheckout(order, product, urls) {
    const s = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      success_url: urls.success,
      cancel_url: urls.cancel,
      client_reference_id: order.public_id,
      'metadata[order_id]': order.public_id,
      'payment_intent_data[metadata][order_id]': order.public_id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(order.amount_cents),
      'line_items[0][price_data][product_data][name]': 'PinkPill ' + product.name + (order.billing === 'year' ? ' (12 months)' : order.billing === 'month' ? ' (1 month)' : ''),
    }, 'checkout-' + order.public_id);
    if (!s.id || !/^https:\/\//.test(s.url || '')) throw new Error('Stripe returned no checkout URL');
    return { providerRef: s.id, redirectUrl: s.url };
  },

  /* Ask Stripe (authenticated) whether the checkout was paid. */
  async verify(order) {
    const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(order.provider_ref));
    if (s.payment_status === 'paid') return { status: 'paid', txnId: s.payment_intent || s.id, amountCents: s.amount_total, currency: String(s.currency || '').toUpperCase() };
    if (s.status === 'expired') return { status: 'failed', reason: 'checkout_expired' };
    return { status: 'pending' };
  },

  async refund(order) {
    await stripe('POST', '/v1/refunds', { payment_intent: order.provider_txn_id }, 'refund-' + order.public_id);
  },

  /* Verify the Stripe-Signature header (HMAC-SHA256 over "timestamp.body"), then map the event. */
  parseWebhook(raw, headers) {
    const header = String(headers['stripe-signature'] || '');
    const parts = header.split(',').map((x) => x.split('='));
    const t = (parts.find((p) => p[0] === 't') || [])[1];
    const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
    if (!t || !sigs.length) throw new WebhookError('Missing signature.');
    if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_S) throw new WebhookError('Signature timestamp out of tolerance.');
    const expected = hmacHex(cfg().webhookSecret, t + '.' + raw.toString('utf8'));
    if (!sigs.some((s) => safeEqualHex(s, expected))) throw new WebhookError('Invalid signature.');
    const event = JSON.parse(raw.toString('utf8'));
    const obj = (event.data && event.data.object) || {};
    const base = { eventId: String(event.id), type: String(event.type) };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (obj.payment_status !== 'paid') return { ...base, action: 'ignore' };
        return { ...base, action: 'paid', providerRef: obj.id, publicId: obj.client_reference_id, txnId: obj.payment_intent || obj.id, amountCents: obj.amount_total, currency: String(obj.currency || '').toUpperCase() };
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { ...base, action: 'failed', providerRef: obj.id, reason: event.type.split('.').pop() };
      case 'charge.refunded':
        // Only a full refund removes the membership; partial refunds are left for an administrator.
        return obj.refunded ? { ...base, action: 'refunded', txnId: obj.payment_intent } : { ...base, action: 'ignore' };
      default:
        return { ...base, action: 'ignore' };
    }
  },
};

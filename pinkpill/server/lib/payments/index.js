'use strict';
/* Payment method registry. The VIP system only talks to this interface:
 *   configured()                         -> credentials present?
 *   createCheckout(order, product, urls) -> { providerRef, redirectUrl }   (hosted payment page)
 *   verify(order)                        -> { status: 'paid'|'pending'|'failed', txnId, amountCents, currency }
 *   refund(order)                        -> refunds through the provider (if supportsRefund)
 *   parseWebhook(rawBody, headers)       -> verified event mapped to { action, eventId, ... }
 * Adding or removing a provider doesn't touch the membership code. The wallet is internal: it is
 * charged inside the same database transaction that activates the membership. */
const settings = require('../settings');
const stripe = require('./stripe');
const paypal = require('./paypal');
const coinbase = require('./coinbase');

const wallet = { id: 'wallet', method: 'wallet', label: 'Wallet Balance', configured: () => true, supportsRefund: true, internal: true };

const PROVIDERS = { stripe, paypal, coinbase, wallet };
const BY_METHOD = { card: stripe, paypal, crypto: coinbase, wallet };
const METHODS = ['card', 'paypal', 'wallet', 'crypto'];

/* Payment methods with availability: configured by the operator AND enabled by an administrator. */
async function methods() {
  const enabled = (await settings.get('vip_payment_methods', {})) || {};
  return METHODS.map((m) => {
    const p = BY_METHOD[m];
    const configured = p.configured();
    const on = enabled[m] !== false;
    return { id: m, label: p.label, provider: p.id, configured, enabled: on, available: configured && on };
  });
}

module.exports = { PROVIDERS, BY_METHOD, METHODS, methods, provider: (id) => PROVIDERS[id] || null, forMethod: (m) => BY_METHOD[m] || null };

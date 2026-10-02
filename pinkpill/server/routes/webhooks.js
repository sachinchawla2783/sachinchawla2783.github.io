'use strict';
/* Payment provider webhooks: POST /api/payments/webhooks/:provider
 * Mounted before the JSON parser and CSRF check: the signature over the raw body is the authentication.
 * Each event is processed at most once (payment_events has a unique key per provider event id), inside
 * one transaction with the order update, so a failure rolls back and the provider's retry reprocesses it. */
const express = require('express');
const db = require('../db');
const vip = require('../lib/vip');
const payments = require('../lib/payments');
const { WebhookError, ProviderError } = require('../lib/payments/common');
const { HttpError, notFound } = require('../lib/errors');
const log = require('../lib/log');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

router.post('/:provider', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const provider = payments.provider(req.params.provider);
  if (!provider || provider.internal || !provider.configured()) throw notFound();
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'bad_request', 'Empty body.');
  let ev;
  try {
    ev = await provider.parseWebhook(req.body, req.headers);
  } catch (err) {
    if (err instanceof WebhookError || err instanceof SyntaxError) {
      log.warn('payments.webhook_rejected', { provider: provider.id, message: err.message });
      throw new HttpError(400, 'invalid_webhook', 'Invalid webhook.');
    }
    if (err instanceof ProviderError) throw new HttpError(503, 'unavailable', 'Try again later.');
    throw err;
  }
  if (!ev.eventId || ev.eventId === 'undefined') throw new HttpError(400, 'invalid_webhook', 'Invalid webhook.');
  const ctx = { actorId: null, ip: req.ip };
  const result = await db.tx(async (q) => {
    const ins = await q.one(`INSERT INTO payment_events (provider, event_id, event_type) VALUES ($1, $2, $3)
      ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`, [provider.id, ev.eventId.slice(0, 200), ev.type.slice(0, 100)]);
    if (!ins) return 'duplicate';
    if (ev.action === 'ignore') return 'ignored';
    let o = null;
    if (ev.action === 'refunded') {
      if (ev.txnId) o = await q.one('SELECT * FROM vip_orders WHERE provider = $1 AND provider_txn_id = $2', [provider.id, String(ev.txnId)]);
    } else {
      if (ev.providerRef) o = await q.one('SELECT * FROM vip_orders WHERE provider = $1 AND provider_ref = $2', [provider.id, String(ev.providerRef)]);
      const pid = ev.publicId && String(ev.publicId).toLowerCase();
      if (!o && pid && UUID.test(pid)) o = await q.one('SELECT * FROM vip_orders WHERE provider = $1 AND public_id = $2', [provider.id, pid]);
      // When the provider reports both identifiers, they must point at the same order.
      if (o && pid && o.public_id !== pid) o = null;
    }
    if (!o) { log.warn('payments.webhook_unknown_order', { provider: provider.id, type: ev.type }); return 'unknown_order'; }
    await q.query('UPDATE payment_events SET order_id = $2 WHERE id = $1', [ins.id, o.id]);
    if (ev.action === 'paid') {
      const r = await vip.completeOrderTx(q, o.id, { txnId: ev.txnId, amountCents: ev.amountCents, currency: ev.currency }, ctx);
      return r.mismatch ? 'amount_mismatch' : 'paid';
    }
    if (ev.action === 'failed') { await vip.failOrderTx(q, o.id, ev.reason || 'payment_failed', ctx); return 'failed'; }
    if (ev.action === 'refunded') {
      if (o.status === 'paid') await vip.refundOrderTx(q, o.id, 'Refunded through ' + provider.label, ctx);
      return 'refunded';
    }
    return 'ignored';
  });
  res.json({ received: true, result });
});

module.exports = router;

'use strict';
/* VIP purchase, gift and membership API. Every route requires a logged-in member (enforced here, not
 * by the frontend). Prices, products and entitlements come only from the database; request bodies are
 * strict schemas, so a client can't send a price, amount, product id or membership id. */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { z, parse } = require('../lib/validate');
const { assertCan, requireUser } = require('../lib/permissions');
const { HttpError, notFound } = require('../lib/errors');
const { summaries } = require('../lib/users');
const limits = require('../lib/limits');
const vip = require('../lib/vip');
const payments = require('../lib/payments');
const { ProviderError } = require('../lib/payments/common');
const log = require('../lib/log');

const router = express.Router();
// Scoped to VIP paths only: this router is mounted at /api and must not affect other endpoints.
router.use(['/vip', '/account/purchases'], requireUser);

const slug = z.string().regex(/^[a-z0-9-]{2,40}$/, 'Invalid package');
const cosmeticId = z.string().regex(/^[a-z0-9-]{2,30}$/, 'Invalid choice');
const optionsSchema = z.object({
  avatarFrame: cosmeticId.nullable().optional(),
  usernameColor: cosmeticId.nullable().optional(),
  customColor: z.string().max(7).nullable().optional(),
  customEffect: cosmeticId.nullable().optional(),
}).strict();
const baseSchema = {
  product: slug,
  billing: z.enum(['month', 'year', 'lifetime']),
  options: optionsSchema.default({}),
  giftTo: z.string().trim().min(1).max(24).optional(),
};
const quoteSchema = z.object({ ...baseSchema, paymentMethod: z.enum(payments.METHODS).optional() }).strict();
const checkoutSchema = z.object({
  ...baseSchema,
  paymentMethod: z.enum(payments.METHODS),
  idempotencyKey: z.string().uuid(),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Please confirm your purchase.' }) }),
}).strict();

const FAILURE_TEXT = {
  insufficient_funds: 'Your wallet balance was too low.', checkout_error: 'The payment could not be started.',
  checkout_expired: 'The checkout expired before payment.', amount_mismatch: 'The payment amount did not match. Staff have been alerted.',
  abandoned: 'The checkout was not completed.', cancelled_by_user: 'You cancelled this checkout.',
};

function orderJson(o, product, users) {
  return {
    id: o.public_id, status: o.status, kind: o.kind, billing: o.billing,
    product: product ? { slug: product.slug, name: product.name } : null,
    amountCents: o.amount_cents, currency: o.currency, paymentMethod: o.payment_method,
    createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at,
    recipient: o.kind === 'gift' && users ? users[String(o.recipient_id)] || null : null,
    failure: o.status === 'failed' || o.status === 'cancelled' ? FAILURE_TEXT[o.failure_reason] || 'The payment did not go through.' : null,
  };
}

/* Resolve and validate everything about a purchase on the server. */
async function prepare(me, d) {
  const cat = await vip.catalog();
  const product = cat.productBySlug[d.product];
  if (!product || !product.active) throw new HttpError(404, 'product_unavailable', 'This VIP package is not available right now.');
  const amount = vip.priceFor(product, d.billing);
  let recipient = { id: String(me.id), username: me.username };
  let gift = false;
  if (d.giftTo !== undefined) {
    const r = await db.one(`SELECT id, username::text AS username FROM users WHERE username = $1 AND status <> 'deleted'`, [d.giftTo]);
    if (!r) throw new HttpError(422, 'invalid_recipient', 'We couldn\'t find a member with that username.', { giftTo: 'Member not found' });
    if (String(r.id) === String(me.id)) throw new HttpError(422, 'invalid_recipient', 'You can\'t gift VIP to yourself. Use Purchase instead.', { giftTo: 'That\'s you' });
    recipient = { id: String(r.id), username: r.username };
    gift = true;
  }
  const options = vip.validateOptions(product, d.options || {}, cat);
  const kind = await vip.purchaseKind(db, recipient.id, product, cat);   // throws on conflicts
  return { product, amount, recipient, gift, options, kind: gift ? 'gift' : kind };
}

/* ---------- catalog & status ---------- */

router.get('/vip/catalog', async (req, res) => {
  const cat = await vip.catalog();
  res.json({
    products: cat.products.filter((p) => p.active).map(vip.productJson),
    colors: cat.colors.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, hex1: c.hex1, hex2: c.hex2, lifetimeExclusive: c.lifetime_exclusive })),
    frames: cat.frames.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name, hex: f.hex })),
    effects: cat.effects.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name })),
    paymentMethods: await payments.methods(),
    status: await vip.selfView(req.user.id),
    walletCents: await vip.walletBalance(req.user.id),
  });
});

const effectiveStatus = (m) => (m.status === 'active' && !m.lifetime && new Date(m.expiration_date) <= new Date() ? 'expired' : m.status);

router.get('/vip/me', async (req, res) => {
  const cat = await vip.catalog();
  const rows = await db.many('SELECT * FROM vip_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  const u = await db.one('SELECT username_changed_at FROM users WHERE id = $1', [req.user.id]);
  const p = await db.one('SELECT vanity::text AS vanity, vanity_changed_at FROM profiles WHERE user_id = $1', [req.user.id]);
  const status = await vip.selfView(req.user.id);
  const next = (at, days) => (at && days ? new Date(new Date(at).getTime() + days * 86400000) : null);
  res.json({
    status,
    memberships: rows.map((m) => ({
      id: String(m.id), product: cat.productById[String(m.product_id)] ? { slug: cat.productById[String(m.product_id)].slug, name: cat.productById[String(m.product_id)].name } : null,
      status: effectiveStatus(m), purchaseDate: m.purchase_date, expiresAt: m.expiration_date, lifetime: m.lifetime,
      avatarFrame: m.avatar_frame, usernameColor: m.username_color, customColor: m.custom_username_color, customEffect: m.custom_username_effect,
      gifted: !!m.gifted_by, granted: !!m.granted_by,
    })),
    walletCents: await vip.walletBalance(req.user.id),
    username: { changedAt: u.username_changed_at, nextChangeAt: next(u.username_changed_at, status.usernameCooldownDays) },
    vanity: { value: p.vanity, changedAt: p.vanity_changed_at, nextChangeAt: next(p.vanity_changed_at, status.vanityCooldownDays) },
  });
});

/* Change VIP styling within what the current membership includes. */
router.patch('/vip/style', limits.write, async (req, res) => {
  const d = parse(z.object({
    usernameColor: cosmeticId.nullable(), avatarFrame: cosmeticId.nullable(), customColor: z.string().max(7).nullable(), customEffect: cosmeticId.nullable(),
    customFrame: z.string().max(7).nullable(),
  }).partial().strict(), req.body);
  const ent = await vip.entitlementsOf(req.user.id);
  const cols = vip.validateStyle(ent, d, await vip.catalog());
  await vip.savePrefs(db, req.user.id, cols);
  res.json({ status: await vip.selfView(req.user.id) });
});

/* Gift recipient lookup: must exist and must not be yourself. */
router.get('/vip/recipient', async (req, res) => {
  const { username } = parse(z.object({ username: z.string().trim().min(1).max(24) }).strip(), req.query);
  const r = await db.one(`SELECT id FROM users WHERE username = $1 AND status <> 'deleted'`, [username]);
  if (!r) throw new HttpError(404, 'invalid_recipient', 'We couldn\'t find a member with that username.');
  if (String(r.id) === String(req.user.id)) throw new HttpError(422, 'invalid_recipient', 'You can\'t gift VIP to yourself. Use Purchase instead.');
  const users = await summaries([r.id]);
  res.json({ recipient: users[String(r.id)] });
});

/* ---------- checkout ---------- */

router.post('/vip/quote', limits.write, async (req, res) => {
  assertCan(req.user, 'vip.purchase');
  const d = parse(quoteSchema, req.body);
  const p = await prepare(req.user, d);
  const methods = await payments.methods();
  const walletCents = await vip.walletBalance(req.user.id);
  res.json({
    product: vip.productJson(p.product), billing: d.billing, amountCents: p.amount, currency: p.product.currency, kind: p.kind,
    recipient: p.gift ? (await summaries([p.recipient.id]))[p.recipient.id] : null, options: p.options,
    paymentMethods: methods.map((m) => Object.assign({}, m, m.id === 'wallet' ? { sufficient: walletCents >= p.amount } : {})),
    walletCents,
  });
});

const returnUrls = (o) => ({
  success: config.appUrl + '/vip/return?order=' + o.public_id,
  cancel: config.appUrl + '/vip/return?order=' + o.public_id + '&cancelled=1',
});

async function insertOrder(q, me, p, d, status = 'pending', failure = '') {
  return q.one(`INSERT INTO vip_orders (purchaser_id, recipient_id, product_id, kind, billing, amount_cents, currency, payment_method, provider, options, idempotency_key, status, failure_reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
  [me.id, p.recipient.id, p.product.id, p.kind, d.billing, p.amount, p.product.currency, d.paymentMethod, payments.forMethod(d.paymentMethod).id,
    JSON.stringify(p.options), d.idempotencyKey, status, failure]);
}

router.post('/vip/checkout', limits.vipCheckout, async (req, res) => {
  assertCan(req.user, 'vip.purchase');
  const me = req.user;
  const d = parse(checkoutSchema, req.body);
  // Retrying the same checkout (double click, network retry) never creates a second order.
  const dup = await db.one('SELECT * FROM vip_orders WHERE purchaser_id = $1 AND idempotency_key = $2', [me.id, d.idempotencyKey]);
  if (dup) {
    const cat = await vip.catalog();
    return res.json({ order: orderJson(dup, cat.productById[String(dup.product_id)], await summaries([dup.recipient_id])), duplicate: true });
  }
  const p = await prepare(me, d);
  const method = (await payments.methods()).find((m) => m.id === d.paymentMethod);
  if (!method || !method.available) throw new HttpError(409, 'payment_unavailable', 'That payment method isn\'t available right now. Please choose another.');
  const provider = payments.forMethod(d.paymentMethod);
  const ctx = { actorId: me.id, ip: req.ip };

  if (provider.internal) {
    // Wallet: debit, mark paid and activate in one transaction. Nothing is granted if any step fails.
    let order;
    try {
      order = await db.tx(async (q) => {
        // Serialise purchases for the same recipient and re-check eligibility inside the transaction,
        // so two simultaneous checkouts can't both buy the same lifetime package.
        await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['vip:' + p.recipient.id]);
        await vip.purchaseKind(q, p.recipient.id, p.product, await vip.catalog());
        const o = await insertOrder(q, me, p, d);
        await vip.walletChange(q, me.id, -p.amount, 'debit', { orderId: o.id, actorId: me.id, reason: 'VIP: ' + p.product.name });
        await vip.completeOrderTx(q, o.id, { txnId: 'wallet-' + o.public_id, amountCents: p.amount, currency: p.product.currency }, ctx);
        return q.one('SELECT * FROM vip_orders WHERE id = $1', [o.id]);
      });
    } catch (err) {
      if (err.code === 'insufficient_funds') {
        await db.tx(async (q) => {
          const o = await insertOrder(q, me, p, d, 'failed', 'insufficient_funds');
          await vip.auditRow(q, me.id, 'vip.payment_failed', 'vip_order', o.public_id, { reason: 'insufficient_funds', provider: 'wallet', amountCents: p.amount }, req.ip);
        });
      }
      throw err;
    }
    return res.status(201).json({ order: orderJson(order, p.product, await summaries([p.recipient.id])) });
  }

  const order = await db.tx((q) => insertOrder(q, me, p, d));
  let session;
  try {
    session = await provider.createCheckout(order, p.product, returnUrls(order));
  } catch (err) {
    log.warn('vip.checkout_failed', { provider: provider.id, order: order.public_id, message: err.message });
    await db.tx((q) => vip.failOrderTx(q, order.id, 'checkout_error', ctx));
    throw new HttpError(502, 'payment_provider_error', 'We couldn\'t start the payment. You have not been charged. Please try again or choose another payment method.');
  }
  await db.query('UPDATE vip_orders SET provider_ref = $2, updated_at = now() WHERE id = $1', [order.id, session.providerRef]);
  res.status(201).json({ order: orderJson(order, p.product, await summaries([p.recipient.id])), redirectUrl: session.redirectUrl });
});

/* ---------- orders ---------- */

async function ownOrder(id, me) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id))) throw notFound('Order not found.');
  const o = await db.one('SELECT * FROM vip_orders WHERE public_id = $1 AND purchaser_id = $2', [id, me.id]);
  if (!o) throw notFound('Order not found.');
  return o;
}

router.get('/vip/orders/:id', async (req, res) => {
  const o = await ownOrder(req.params.id, req.user);
  const cat = await vip.catalog();
  res.json({ order: orderJson(o, cat.productById[String(o.product_id)], await summaries([o.recipient_id])) });
});

/* Ask the provider (server-to-server) whether this order has been paid. The browser's word is never
   enough: returning from the payment page only triggers this check. */
router.post('/vip/orders/:id/verify', limits.write, async (req, res) => {
  let o = await ownOrder(req.params.id, req.user);
  const provider = payments.provider(o.provider);
  const checkable = o.provider_ref && provider && !provider.internal && provider.configured()
    && (o.status === 'pending' || o.status === 'cancelled' || (o.status === 'failed' && o.failure_reason !== 'amount_mismatch'));
  if (checkable) {
    let r;
    try { r = await provider.verify(o); } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(502, 'payment_provider_error', 'We couldn\'t reach the payment provider. Your payment status will update automatically; please check again shortly.');
      throw err;
    }
    const ctx = { actorId: null, ip: req.ip };
    if (r.status === 'paid') await db.tx((q) => vip.completeOrderTx(q, o.id, r, ctx));
    else if (r.status === 'failed') await db.tx((q) => vip.failOrderTx(q, o.id, r.reason || 'payment_failed', ctx));
    o = await db.one('SELECT * FROM vip_orders WHERE id = $1', [o.id]);
  }
  const cat = await vip.catalog();
  res.json({ order: orderJson(o, cat.productById[String(o.product_id)], await summaries([o.recipient_id])) });
});

router.post('/vip/orders/:id/cancel', limits.write, async (req, res) => {
  const o = await ownOrder(req.params.id, req.user);
  await db.query(`UPDATE vip_orders SET status = 'cancelled', failure_reason = 'cancelled_by_user', updated_at = now() WHERE id = $1 AND status = 'pending'`, [o.id]);
  res.json({ ok: true });
});

/* Purchase history: orders you paid for, and gifts you received (without the gifter's payment details). */
router.get('/account/purchases', async (req, res) => {
  const cat = await vip.catalog();
  const rows = await db.many(`SELECT * FROM vip_orders WHERE (purchaser_id = $1 OR (recipient_id = $1 AND kind IN ('gift', 'admin_grant') AND status = 'paid'))
    ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
  const users = await summaries(rows.flatMap((o) => [o.recipient_id, o.purchaser_id]));
  res.json({
    purchases: rows.map((o) => {
      const mine = String(o.purchaser_id) === String(req.user.id);
      const j = orderJson(o, cat.productById[String(o.product_id)], users);
      if (!mine) return { ...j, received: true, amountCents: null, paymentMethod: null, from: o.kind === 'gift' ? users[String(o.purchaser_id)] || null : null };
      return j;
    }),
  });
});

module.exports = router;

'use strict';
/* VIP administration: memberships, orders/payments, refunds, products, cosmetics, wallets, settings.
 * Every route needs the admin.vip permission and every change is written to the audit log. */
const express = require('express');
const db = require('../db');
const { z, parse, idParam } = require('../lib/validate');
const { assertCan } = require('../lib/permissions');
const { HttpError, notFound, conflict, invalid } = require('../lib/errors');
const { summaries } = require('../lib/users');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const settings = require('../lib/settings');
const vip = require('../lib/vip');
const payments = require('../lib/payments');
const { ProviderError } = require('../lib/payments/common');

const router = express.Router();
router.use(require('../lib/limits').admin);
router.use((req, res, next) => { try { assertCan(req.user, 'admin.vip'); next(); } catch (e) { next(e); } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cosmeticId = z.string().regex(/^[a-z0-9-]{2,30}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((s) => s.toLowerCase());
const PER_PAGE = 50;

async function userByName(name) {
  const u = await db.one(`SELECT id, username::text AS username FROM users WHERE username = $1 AND status <> 'deleted'`, [name]);
  if (!u) throw invalid('Member not found: ' + name, { username: 'Member not found' });
  return u;
}

const effectiveStatus = (m) => (m.status === 'active' && !m.lifetime && new Date(m.expiration_date) <= new Date() ? 'expired' : m.status);

/* ---------- memberships ---------- */

router.get('/memberships', async (req, res) => {
  const d = parse(z.object({
    q: z.string().trim().max(24).optional(), status: z.enum(['', 'active', 'expired', 'cancelled', 'refunded']).default(''),
    lifetime: z.enum(['', '1']).default(''), page: z.coerce.number().int().min(1).max(10000).default(1),
  }).strip(), req.query);
  const where = ['true'], vals = [];
  if (d.q) { vals.push(d.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); where.push(`u.username ILIKE $${vals.length} ESCAPE '\\'`); }
  if (d.status === 'active') where.push(`m.status = 'active' AND (m.lifetime OR m.expiration_date > now())`);
  else if (d.status === 'expired') where.push(`(m.status = 'expired' OR (m.status = 'active' AND NOT m.lifetime AND m.expiration_date <= now()))`);
  else if (d.status) { vals.push(d.status); where.push(`m.status = $${vals.length}`); }
  if (d.lifetime) where.push('m.lifetime');
  const rows = await db.many(`SELECT m.*, o.public_id AS order_public_id FROM vip_memberships m JOIN users u ON u.id = m.user_id LEFT JOIN vip_orders o ON o.id = m.order_id
    WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT ${PER_PAGE} OFFSET ${(d.page - 1) * PER_PAGE}`, vals);
  const cat = await vip.catalog();
  res.json({
    memberships: rows.map((m) => ({
      id: String(m.id), userId: String(m.user_id), product: (cat.productById[String(m.product_id)] || {}).name || '?',
      status: effectiveStatus(m), lifetime: m.lifetime, purchaseDate: m.purchase_date, expiresAt: m.expiration_date,
      provider: m.payment_provider, order: m.order_public_id, grantedBy: m.granted_by, giftedBy: m.gifted_by, note: m.note,
      avatarFrame: m.avatar_frame, usernameColor: m.username_color, customColor: m.custom_username_color,
    })),
    page: d.page, perPage: PER_PAGE,
    users: await summaries(rows.flatMap((m) => [m.user_id, m.granted_by, m.gifted_by])),
  });
});

/* Manual grant: an audited, zero-amount 'admin_grant' order activated through the same code path as a purchase. */
router.post('/memberships', async (req, res) => {
  const d = parse(z.object({
    username: z.string().trim().min(1).max(24), product: z.string().regex(/^[a-z0-9-]{2,40}$/),
    days: z.number().int().min(1).max(3650).optional(), note: z.string().trim().max(300).default(''),
    avatarFrame: cosmeticId.optional(), usernameColor: cosmeticId.optional(), customColor: z.string().max(7).optional(), customEffect: cosmeticId.optional(),
  }).strict(), req.body);
  const cat = await vip.catalog();
  const product = cat.productBySlug[d.product];
  if (!product) throw notFound('Package not found.');
  const u = await userByName(d.username);
  const opts = vip.validateOptions(Object.assign({}, product, { requires_avatar_frame: false }),
    { avatarFrame: d.avatarFrame, usernameColor: d.usernameColor, customColor: d.customColor, customEffect: d.customEffect }, cat);
  const result = await db.tx(async (q) => {
    const o = await q.one(`INSERT INTO vip_orders (purchaser_id, recipient_id, product_id, kind, billing, amount_cents, currency, payment_method, provider, options)
      VALUES ($1, $2, $3, 'admin_grant', $4, 0, $5, 'manual', 'manual', $6) RETURNING id, public_id`,
    [req.user.id, u.id, product.id, product.lifetime ? 'lifetime' : 'custom', product.currency, JSON.stringify({ ...opts, days: product.lifetime ? null : (d.days || 30), note: d.note })]);
    return vip.completeOrderTx(q, o.id, { txnId: null, amountCents: 0, currency: product.currency }, { actorId: req.user.id, ip: req.ip });
  });
  res.status(201).json({ ok: true, membershipId: String(result.membershipId) });
});

async function lockMembership(q, id) {
  const m = await q.one('SELECT * FROM vip_memberships WHERE id = $1 FOR UPDATE', [idParam(id)]);
  if (!m) throw notFound('Membership not found.');
  return m;
}

router.post('/memberships/:id/revoke', async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(1).max(300) }).strict(), req.body);
  await db.tx(async (q) => {
    const m = await lockMembership(q, req.params.id);
    if (m.status !== 'active') throw conflict('Only active memberships can be revoked.');
    await q.query(`UPDATE vip_memberships SET status = 'cancelled', note = left(note || ' [revoked: ' || $2 || ']', 300), updated_at = now() WHERE id = $1`, [m.id, d.reason]);
    await audit(q, req, 'vip.admin_revoke', 'vip_membership', m.id, { user: m.user_id, productId: m.product_id, reason: d.reason });
    await notify(q, { userId: m.user_id, actorId: req.user.id, type: 'vip', text: 'Your VIP membership was revoked by an administrator. Reason: ' + d.reason, link: '#/account/vip' });
  });
  res.json({ ok: true });
});

router.post('/memberships/:id/extend', async (req, res) => {
  const d = parse(z.object({ days: z.number().int().min(1).max(3650), reason: z.string().trim().max(300).default('') }).strict(), req.body);
  const r = await db.tx(async (q) => {
    const m = await lockMembership(q, req.params.id);
    if (m.lifetime) throw conflict('Lifetime memberships never expire.');
    if (!['active', 'expired'].includes(m.status)) throw conflict('Only active or expired memberships can be extended.');
    const u = await q.one(`UPDATE vip_memberships SET status = 'active', expiration_date = GREATEST(expiration_date, now()) + ($2 || ' days')::interval, updated_at = now()
      WHERE id = $1 RETURNING expiration_date`, [m.id, String(d.days)]);
    await audit(q, req, 'vip.admin_extend', 'vip_membership', m.id, { user: m.user_id, days: d.days, from: m.expiration_date, to: u.expiration_date, reason: d.reason });
    return u;
  });
  res.json({ ok: true, expiresAt: r.expiration_date });
});

/* ---------- orders & payments ---------- */

router.get('/orders', async (req, res) => {
  const d = parse(z.object({
    status: z.enum(['', 'pending', 'paid', 'failed', 'refunded', 'cancelled']).default(''), gift: z.enum(['', '1']).default(''),
    q: z.string().trim().max(24).optional(), page: z.coerce.number().int().min(1).max(10000).default(1),
  }).strip(), req.query);
  const where = ['true'], vals = [];
  if (d.status) { vals.push(d.status); where.push(`o.status = $${vals.length}`); }
  if (d.gift) where.push(`o.kind = 'gift'`);
  if (d.q) { vals.push(d.q); where.push(`(o.purchaser_id = (SELECT id FROM users WHERE username = $${vals.length}) OR o.recipient_id = (SELECT id FROM users WHERE username = $${vals.length}))`); }
  const rows = await db.many(`SELECT o.* FROM vip_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ${PER_PAGE} OFFSET ${(d.page - 1) * PER_PAGE}`, vals);
  const counts = await db.many(`SELECT status, count(*)::int AS n, coalesce(sum(amount_cents), 0)::bigint AS cents FROM vip_orders GROUP BY status`);
  const cat = await vip.catalog();
  res.json({
    orders: rows.map((o) => ({
      id: o.public_id, status: o.status, kind: o.kind, billing: o.billing, product: (cat.productById[String(o.product_id)] || {}).name || '?',
      amountCents: o.amount_cents, currency: o.currency, paymentMethod: o.payment_method, provider: o.provider,
      providerRef: o.provider_ref, providerTxnId: o.provider_txn_id, purchaserId: o.purchaser_id, recipientId: o.recipient_id,
      failureReason: o.failure_reason, createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at,
      canRefund: o.status === 'paid', providerRefund: o.status === 'paid' && !!(payments.provider(o.provider) || {}).supportsRefund && o.provider !== 'manual',
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, { count: c.n, cents: Number(c.cents) }])),
    page: d.page, perPage: PER_PAGE,
    users: await summaries(rows.flatMap((o) => [o.purchaser_id, o.recipient_id])),
  });
});

async function orderByPublicId(id) {
  if (!UUID.test(String(id))) throw notFound('Order not found.');
  const o = await db.one('SELECT * FROM vip_orders WHERE public_id = $1', [id]);
  if (!o) throw notFound('Order not found.');
  return o;
}

/* Refund: through the provider when it supports refunds (Stripe, PayPal, wallet). For crypto or
   off-platform refunds the admin confirms with markOnly after refunding manually. */
router.post('/orders/:id/refund', async (req, res) => {
  const d = parse(z.object({ reason: z.string().trim().min(1).max(200), markOnly: z.boolean().default(false) }).strict(), req.body);
  const o = await orderByPublicId(req.params.id);
  if (o.status !== 'paid') throw conflict('Only paid orders can be refunded.');
  const provider = payments.provider(o.provider);
  const external = provider && !provider.internal && o.provider !== 'manual';
  if (external && !d.markOnly) {
    if (!provider.supportsRefund) throw conflict(provider.label + ' payments can\'t be refunded automatically. Refund it manually, then use "mark as refunded".');
    if (!provider.configured() || !o.provider_txn_id) throw conflict('This payment can\'t be refunded through the provider from here.');
    try { await provider.refund(o); } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(502, 'payment_provider_error', 'The provider rejected the refund. Nothing was changed.');
      throw err;
    }
  }
  await db.tx((q) => vip.refundOrderTx(q, o.id, d.reason + (d.markOnly ? ' (marked manually)' : ''), { actorId: req.user.id, ip: req.ip }));
  res.json({ ok: true });
});

/* Re-check a pending or failed payment with the provider. */
router.post('/orders/:id/verify', async (req, res) => {
  const o = await orderByPublicId(req.params.id);
  const provider = payments.provider(o.provider);
  if (!provider || provider.internal || !o.provider_ref || !provider.configured()) throw conflict('This order can\'t be checked with a provider.');
  if (o.status === 'paid' || o.status === 'refunded') return res.json({ status: o.status });
  let r;
  try { r = await provider.verify(o); } catch (err) {
    if (err instanceof ProviderError) throw new HttpError(502, 'payment_provider_error', 'Could not reach the payment provider.');
    throw err;
  }
  const ctx = { actorId: req.user.id, ip: req.ip };
  if (r.status === 'paid') await db.tx((q) => vip.completeOrderTx(q, o.id, r, ctx));
  else if (r.status === 'failed') await db.tx((q) => vip.failOrderTx(q, o.id, r.reason || 'payment_failed', ctx));
  res.json({ status: (await db.one('SELECT status FROM vip_orders WHERE id = $1', [o.id])).status });
});

/* ---------- products ---------- */

router.get('/products', async (req, res) => {
  vip.invalidate();
  const cat = await vip.catalog();
  res.json({
    products: cat.products.map(vip.productJson),
    colors: cat.colors.map((c) => ({ id: c.id, name: c.name, hex1: c.hex1, hex2: c.hex2, lifetimeExclusive: c.lifetime_exclusive, active: c.active, position: c.position })),
    frames: cat.frames.map((f) => ({ id: f.id, name: f.name, hex: f.hex, active: f.active, position: f.position })),
    effects: cat.effects.map((e) => ({ id: e.id, name: e.name, active: e.active, position: e.position })),
  });
});

const days = z.number().int().min(1).max(3650).nullable();
const productPatch = z.object({
  name: z.string().trim().min(1).max(60), description: z.string().trim().max(500),
  priceCents: z.number().int().min(50).max(10000000), annualPriceCents: z.number().int().min(50).max(10000000).nullable(),
  active: z.boolean(), position: z.number().int().min(-1000).max(1000),
  conversationLimit: z.number().int().min(2).max(100).nullable(), usernameChangeCooldownDays: days, vanityUrlCooldownDays: days,
  postEditWindowMinutes: z.number().int().min(1).max(525600).nullable(),
  allowedUsernameColors: z.array(cosmeticId).max(50), exclusiveColors: z.boolean(),
  availableAvatarFrames: z.array(cosmeticId).max(50), requiresAvatarFrame: z.boolean(),
  customUsernameColor: z.boolean(), customUsernameEffects: z.boolean(), customAvatarFrame: z.boolean(), customReactions: z.boolean(), verifiedBadge: z.boolean(),
  noAds: z.boolean(), vipForumAccess: z.boolean(), ratingsThreadDeletion: z.boolean(),
  supersedes: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(20),
  benefits: z.array(z.string().trim().min(1).max(200)).max(30), notes: z.array(z.string().trim().min(1).max(200)).max(10),
}).partial().strict();
const PRODUCT_COLS = {
  name: 'name', description: 'description', priceCents: 'price_cents', annualPriceCents: 'annual_price_cents', active: 'active', position: 'position',
  conversationLimit: 'conversation_limit', usernameChangeCooldownDays: 'username_change_cooldown_days', vanityUrlCooldownDays: 'vanity_url_cooldown_days',
  postEditWindowMinutes: 'post_edit_window_minutes', allowedUsernameColors: 'allowed_username_colors', exclusiveColors: 'exclusive_colors',
  availableAvatarFrames: 'available_avatar_frames', requiresAvatarFrame: 'requires_avatar_frame', customUsernameColor: 'custom_username_color',
  customUsernameEffects: 'custom_username_effects', customAvatarFrame: 'custom_avatar_frame', customReactions: 'custom_reactions', verifiedBadge: 'verified_badge', noAds: 'no_ads',
  vipForumAccess: 'vip_forum_access', ratingsThreadDeletion: 'ratings_thread_deletion', supersedes: 'supersedes', benefits: 'benefits', notes: 'notes',
};

router.patch('/products/:slug', async (req, res) => {
  const slug = String(req.params.slug);
  const cur = await db.one('SELECT * FROM vip_products WHERE slug = $1', [slug]);
  if (!cur) throw notFound('Package not found.');
  const d = parse(productPatch, req.body);
  const cat = await vip.catalog();
  if (d.allowedUsernameColors && d.allowedUsernameColors.some((c) => !cat.colorById[c])) throw invalid('Unknown username color.');
  if (d.availableAvatarFrames && d.availableAvatarFrames.some((f) => !cat.frameById[f])) throw invalid('Unknown avatar frame.');
  if (d.supersedes && d.supersedes.some((s) => s === slug || !cat.productBySlug[s])) throw invalid('Unknown package in "includes".');
  if (cur.lifetime && d.annualPriceCents != null) throw invalid('Lifetime packages have no annual price.');
  if (d.verifiedBadge && !cur.lifetime) throw invalid('The verified badge is reserved for lifetime packages.');
  const sets = [], vals = [cur.id];
  for (const [k, col] of Object.entries(PRODUCT_COLS)) {
    if (!(k in d)) continue;
    vals.push(k === 'benefits' || k === 'notes' ? JSON.stringify(d[k]) : d[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return res.json({ ok: true });
  await db.tx(async (q) => {
    await q.query(`UPDATE vip_products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    const before = Object.fromEntries(Object.keys(d).map((k) => [k, cur[PRODUCT_COLS[k]]]));
    await audit(q, req, 'vip.product_update', 'vip_product', slug, { before, after: d });
  });
  vip.invalidate();
  res.json({ ok: true });
});

/* ---------- cosmetics ---------- */

const colorSchema = z.object({ id: cosmeticId, name: z.string().trim().min(1).max(40), hex1: hex, hex2: hex.nullable().default(null), lifetimeExclusive: z.boolean().default(false), active: z.boolean().default(true), position: z.number().int().min(0).max(1000).default(0) }).strict();
const frameSchema = z.object({ id: cosmeticId, name: z.string().trim().min(1).max(40), hex, active: z.boolean().default(true), position: z.number().int().min(0).max(1000).default(0) }).strict();

function cosmeticRoutes(kind, table, schema, cols) {
  router.post('/' + kind, async (req, res) => {
    const d = parse(schema, req.body);
    try {
      await db.tx(async (q) => {
        await q.query(`INSERT INTO ${table} (${Object.values(cols).join(', ')}) VALUES (${Object.keys(cols).map((_, i) => '$' + (i + 1)).join(', ')})`, Object.keys(cols).map((k) => d[k]));
        await audit(q, req, 'vip.' + kind + '_create', table, d.id, d);
      });
    } catch (e) { if (e.code === '23505') throw conflict('That id already exists.'); throw e; }
    vip.invalidate();
    res.status(201).json({ ok: true });
  });
  router.patch('/' + kind + '/:id', async (req, res) => {
    const id = String(req.params.id);
    const d = parse(schema.omit({ id: true }).partial().strict(), req.body);
    const sets = [], vals = [id];
    for (const [k, col] of Object.entries(cols)) if (k !== 'id' && k in d) { vals.push(d[k]); sets.push(`${col} = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    await db.tx(async (q) => {
      const r = await q.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (!r.rowCount) throw notFound();
      await audit(q, req, 'vip.' + kind + '_update', table, id, d);
    });
    vip.invalidate();
    res.json({ ok: true });
  });
}
cosmeticRoutes('colors', 'vip_username_colors', colorSchema, { id: 'id', name: 'name', hex1: 'hex1', hex2: 'hex2', lifetimeExclusive: 'lifetime_exclusive', active: 'active', position: 'position' });
cosmeticRoutes('frames', 'vip_avatar_frames', frameSchema, { id: 'id', name: 'name', hex: 'hex', active: 'active', position: 'position' });

// Effects are predefined in code (each id has a built-in style); admins can rename or disable them.
router.patch('/effects/:id', async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(1).max(40), active: z.boolean(), position: z.number().int().min(0).max(1000) }).partial().strict(), req.body);
  const map = { name: 'name', active: 'active', position: 'position' };
  const sets = [], vals = [String(req.params.id)];
  for (const [k, col] of Object.entries(map)) if (k in d) { vals.push(d[k]); sets.push(`${col} = $${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  await db.tx(async (q) => {
    const r = await q.query(`UPDATE vip_username_effects SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!r.rowCount) throw notFound();
    await audit(q, req, 'vip.effect_update', 'vip_username_effects', req.params.id, d);
  });
  vip.invalidate();
  res.json({ ok: true });
});

/* ---------- wallets ---------- */

router.get('/wallets', async (req, res) => {
  const { username } = parse(z.object({ username: z.string().trim().min(1).max(24) }).strip(), req.query);
  const u = await userByName(username);
  const tx = await db.many('SELECT id, amount_cents, balance_after, kind, reason, actor_id, created_at FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]);
  res.json({
    userId: String(u.id), balanceCents: await vip.walletBalance(u.id),
    transactions: tx.map((t) => ({ id: String(t.id), amountCents: Number(t.amount_cents), balanceAfter: Number(t.balance_after), kind: t.kind, reason: t.reason, actorId: t.actor_id, at: t.created_at })),
    users: await summaries([u.id, ...tx.map((t) => t.actor_id)]),
  });
});

router.post('/wallets', async (req, res) => {
  const d = parse(z.object({ username: z.string().trim().min(1).max(24), amountCents: z.number().int().min(-1000000).max(1000000).refine((n) => n !== 0, 'Amount can\'t be zero'), reason: z.string().trim().min(1).max(200) }).strict(), req.body);
  const u = await userByName(d.username);
  const balance = await db.tx(async (q) => {
    const b = await vip.walletChange(q, u.id, d.amountCents, d.amountCents > 0 ? 'credit' : 'adjustment', { actorId: req.user.id, reason: d.reason });
    await audit(q, req, 'vip.wallet_adjust', 'user', u.id, { amountCents: d.amountCents, balanceAfter: b, reason: d.reason });
    return b;
  });
  res.json({ balanceCents: balance });
});

/* ---------- settings ---------- */

router.get('/settings', async (req, res) => {
  const s = await settings.all();
  res.json({
    paymentMethods: await payments.methods(),
    postEditWindowMinutes: Number(s.post_edit_window_minutes || 0), conversationMaxParticipants: Number(s.conversation_max_participants || 10),
    ratingsDeleteMaxReplies: Number(s.ratings_delete_max_replies || 0),
  });
});

router.patch('/settings', async (req, res) => {
  const d = parse(z.object({
    paymentMethods: z.object({ card: z.boolean(), paypal: z.boolean(), wallet: z.boolean(), crypto: z.boolean() }).partial().strict(),
    postEditWindowMinutes: z.number().int().min(0).max(525600), conversationMaxParticipants: z.number().int().min(2).max(100),
    ratingsDeleteMaxReplies: z.number().int().min(0).max(100000),
  }).partial().strict(), req.body);
  const cur = await settings.all();
  const put = { };
  if (d.paymentMethods) put.vip_payment_methods = Object.assign({}, cur.vip_payment_methods || {}, d.paymentMethods);
  if ('postEditWindowMinutes' in d) put.post_edit_window_minutes = d.postEditWindowMinutes;
  if ('conversationMaxParticipants' in d) put.conversation_max_participants = d.conversationMaxParticipants;
  if ('ratingsDeleteMaxReplies' in d) put.ratings_delete_max_replies = d.ratingsDeleteMaxReplies;
  await db.tx(async (q) => {
    for (const [k, v] of Object.entries(put)) {
      await q.query(`INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
    }
    await audit(q, req, 'vip.settings_update', 'settings', null, d);
  });
  settings.invalidate();
  res.json({ ok: true });
});

module.exports = router;

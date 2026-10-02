'use strict';
/* VIP memberships and entitlements.
 *
 * A member's entitlements are always computed on the server from their *active* memberships
 * (status 'active' and either lifetime or not yet expired), joined with the product definitions in
 * vip_products. Nothing the browser sends can grant an entitlement. Expiry is enforced at read time
 * (the expiration date is part of every query), so a membership stops working the moment it expires
 * even before the housekeeping job marks it 'expired'. Lifetime memberships have no expiration date
 * (enforced by a CHECK constraint) and are never touched by the expiry job. */
const db = require('../db');
const log = require('./log');
const { notify } = require('./notify');
const { HttpError, conflict, invalid, notFound } = require('./errors');

const ACTIVE = `m.status = 'active' AND (m.lifetime OR m.expiration_date > now())`;

/* ---------- catalog (products + cosmetics), cached briefly; admin changes call invalidate() ---------- */

let cache = null, cachedAt = 0;

const productJson = (p) => ({
  id: String(p.id), slug: p.slug, name: p.name, description: p.description,
  priceCents: p.price_cents, annualPriceCents: p.annual_price_cents, currency: p.currency,
  billingPeriod: p.billing_period, lifetime: p.lifetime, active: p.active, position: p.position, tierRank: p.tier_rank,
  conversationLimit: p.conversation_limit, usernameChangeCooldownDays: p.username_change_cooldown_days,
  vanityUrlCooldownDays: p.vanity_url_cooldown_days, postEditWindowMinutes: p.post_edit_window_minutes,
  allowedUsernameColors: p.allowed_username_colors, exclusiveColors: p.exclusive_colors,
  availableAvatarFrames: p.available_avatar_frames, requiresAvatarFrame: p.requires_avatar_frame,
  customUsernameColor: p.custom_username_color, customUsernameEffects: p.custom_username_effects, customAvatarFrame: p.custom_avatar_frame,
  customReactions: p.custom_reactions, verifiedBadge: p.verified_badge, noAds: p.no_ads,
  vipForumAccess: p.vip_forum_access, ratingsThreadDeletion: p.ratings_thread_deletion,
  supersedes: p.supersedes, benefits: p.benefits, notes: p.notes,
});

async function catalog(q = db) {
  if (q === db && cache && Date.now() - cachedAt < 30000) return cache;
  const products = await q.many('SELECT * FROM vip_products ORDER BY position, id');
  const colors = await q.many('SELECT * FROM vip_username_colors ORDER BY position, id');
  const frames = await q.many('SELECT * FROM vip_avatar_frames ORDER BY position, id');
  const effects = await q.many('SELECT * FROM vip_username_effects ORDER BY position, id');
  const c = {
    products, colors, frames, effects,
    productById: Object.fromEntries(products.map((p) => [String(p.id), p])),
    productBySlug: Object.fromEntries(products.map((p) => [p.slug, p])),
    colorById: Object.fromEntries(colors.map((x) => [x.id, x])),
    frameById: Object.fromEntries(frames.map((x) => [x.id, x])),
    effectById: Object.fromEntries(effects.map((x) => [x.id, x])),
  };
  if (q === db) { cache = c; cachedAt = Date.now(); }
  return c;
}
function invalidate() { cache = null; }

/* ---------- entitlements ---------- */

const NONE = Object.freeze({
  active: false, products: [], top: null, lifetime: false, expiresAt: null,
  noAds: false, vipForum: false, ratingsDelete: false, customReactions: false, verifiedBadge: false,
  customColor: false, customEffects: false, customFrame: false, exclusiveColors: false,
  conversationLimit: null, usernameCooldownDays: null, vanityCooldownDays: null, editWindowMinutes: null,
  colors: [], frames: [],
});

const maxOf = (vals) => { const v = vals.filter((x) => x != null); return v.length ? Math.max(...v) : null; };
const minOf = (vals) => { const v = vals.filter((x) => x != null); return v.length ? Math.min(...v) : null; };

/* Combine the products of a member's active memberships into one set of entitlements.
   `rows` are { product_id, lifetime, expiration_date }. */
function combine(rows, cat) {
  const list = rows.map((r) => ({ r, p: cat.productById[String(r.product_id)] })).filter((x) => x.p);
  if (!list.length) return NONE;
  const ps = list.map((x) => x.p);
  const any = (k) => ps.some((p) => p[k]);
  const exclusiveColors = any('exclusive_colors');
  const colorIds = new Set(ps.flatMap((p) => p.allowed_username_colors));
  if (exclusiveColors) cat.colors.filter((c) => c.lifetime_exclusive).forEach((c) => colorIds.add(c.id));
  const top = ps.slice().sort((a, b) => b.tier_rank - a.tier_rank)[0];
  const lifetime = list.some((x) => x.r.lifetime);
  const expiries = list.filter((x) => !x.r.lifetime).map((x) => new Date(x.r.expiration_date).getTime());
  return {
    active: true,
    products: [...new Set(ps.map((p) => p.slug))],
    top: { slug: top.slug, name: top.name },
    lifetime,
    expiresAt: lifetime || !expiries.length ? null : new Date(Math.max(...expiries)).toISOString(),
    noAds: any('no_ads'),
    vipForum: any('vip_forum_access'),
    ratingsDelete: any('ratings_thread_deletion'),
    customReactions: any('custom_reactions'),
    // The verified badge belongs to lifetime products only.
    verifiedBadge: list.some((x) => x.p.verified_badge && x.r.lifetime),
    customColor: any('custom_username_color'),
    customEffects: any('custom_username_effects'),
    customFrame: any('custom_avatar_frame'),
    exclusiveColors,
    conversationLimit: maxOf(ps.map((p) => p.conversation_limit)),
    usernameCooldownDays: minOf(ps.map((p) => p.username_change_cooldown_days)),
    vanityCooldownDays: minOf(ps.map((p) => p.vanity_url_cooldown_days)),
    editWindowMinutes: maxOf(ps.map((p) => p.post_edit_window_minutes)),
    colors: cat.colors.filter((c) => c.active && colorIds.has(c.id)).map((c) => c.id),
    frames: cat.frames.filter((f) => f.active && ps.some((p) => p.available_avatar_frames.includes(f.id))).map((f) => f.id),
  };
}

async function activeRows(userIds, q = db) {
  return q.many(`SELECT m.id, m.user_id, m.product_id, m.lifetime, m.expiration_date FROM vip_memberships m
    WHERE m.user_id = ANY($1::bigint[]) AND ${ACTIVE}`, [userIds]);
}

/* Entitlements for many users at once: { userId: entitlements }. */
async function entitlementsFor(userIds, q = db) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  const out = {};
  if (!ids.length) return out;
  const cat = await catalog(q);
  const rows = await activeRows(ids, q);
  ids.forEach((id) => { out[id] = combine(rows.filter((r) => String(r.user_id) === id), cat); });
  return out;
}
async function entitlementsOf(userId, q = db) { return (await entitlementsFor([userId], q))[String(userId)] || NONE; }

/* The public VIP decoration shown next to a member: resolved from their saved choices, and only
   what their current entitlements allow. Returns { userId: {...} | null }. */
async function publicStyles(userIds, q = db) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return {};
  const ents = await entitlementsFor(ids, q);
  const withVip = ids.filter((id) => ents[id].active);
  const out = Object.fromEntries(ids.map((id) => [id, null]));
  if (!withVip.length) return out;
  const cat = await catalog(q);
  const prefs = Object.fromEntries((await q.many('SELECT * FROM user_vip_prefs WHERE user_id = ANY($1::bigint[])', [withVip])).map((p) => [String(p.user_id), p]));
  for (const id of withVip) out[id] = styleFor(ents[id], prefs[id], cat);
  return out;
}

function styleFor(ent, pref, cat) {
  pref = pref || {};
  let color = null;
  if (ent.customColor && pref.custom_color) color = { id: 'custom', hex1: pref.custom_color, hex2: null };
  else if (pref.username_color && ent.colors.includes(pref.username_color)) {
    const c = cat.colorById[pref.username_color];
    color = { id: c.id, hex1: c.hex1, hex2: c.hex2 };
  }
  let frame = pref.avatar_frame && ent.frames.includes(pref.avatar_frame) ? cat.frameById[pref.avatar_frame].hex : null;
  if (ent.customFrame && pref.custom_frame) frame = pref.custom_frame;
  const fx = pref.custom_effect && ent.customEffects && cat.effectById[pref.custom_effect] && cat.effectById[pref.custom_effect].active ? pref.custom_effect : null;
  return { label: ent.top.name, lifetime: ent.lifetime, badge: ent.verifiedBadge, color, frame, effect: fx };
}

/* The logged-in member's own view: entitlements plus saved choices. */
async function selfView(userId, q = db) {
  const ent = await entitlementsOf(userId, q);
  const pref = (await q.one('SELECT * FROM user_vip_prefs WHERE user_id = $1', [userId])) || {};
  const cat = await catalog(q);
  return {
    ...ent,
    prefs: { usernameColor: pref.username_color || null, avatarFrame: pref.avatar_frame || null, customColor: pref.custom_color || null, customEffect: pref.custom_effect || null, customFrame: pref.custom_frame || null },
    style: ent.active ? styleFor(ent, pref, cat) : null,
  };
}

/* Users (among ids) allowed into VIP-only forums: staff, or members with an active VIP forum entitlement. */
async function vipForumAudience(userIds, q = db) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const rows = await q.many(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ANY($1::bigint[])
    AND (r.is_staff OR EXISTS (SELECT 1 FROM vip_memberships m JOIN vip_products p ON p.id = m.product_id
      WHERE m.user_id = u.id AND ${ACTIVE} AND p.vip_forum_access))`, [ids]);
  return new Set(rows.map((r) => String(r.id)));
}

/* ---------- cosmetic choices ---------- */

const HEX = /^#[0-9a-fA-F]{6}$/;
function normalizeHex(v) {
  if (typeof v !== 'string' || !HEX.test(v)) throw invalid('Please choose a valid color in #RRGGBB format.');
  return v.toLowerCase();
}

/* Validate purchase-time options against a product (not the buyer's current entitlements). */
function validateOptions(product, opts, cat) {
  const out = {};
  if (opts.avatarFrame != null) {
    const f = cat.frameById[opts.avatarFrame];
    if (!f || !f.active || !product.available_avatar_frames.includes(opts.avatarFrame)) throw invalid('That avatar frame is not available for this package.', { avatarFrame: 'Invalid avatar frame' });
    out.avatarFrame = opts.avatarFrame;
  } else if (product.requires_avatar_frame) {
    throw invalid('Please choose an avatar frame.', { avatarFrame: 'Required' });
  }
  if (opts.usernameColor != null) {
    const c = cat.colorById[opts.usernameColor];
    const ok = c && c.active && (product.allowed_username_colors.includes(c.id) || (product.exclusive_colors && c.lifetime_exclusive));
    if (!ok) throw invalid('That username color is not available for this package.', { usernameColor: 'Invalid username color' });
    out.usernameColor = opts.usernameColor;
  }
  if (opts.customColor != null) {
    if (!product.custom_username_color) throw invalid('This package does not include a custom username color.', { customColor: 'Not included' });
    out.customColor = normalizeHex(opts.customColor);
  }
  if (opts.customEffect != null) {
    const e = cat.effectById[opts.customEffect];
    if (!product.custom_username_effects) throw invalid('This package does not include username effects.', { customEffect: 'Not included' });
    if (!e || !e.active) throw invalid('That username effect is not available.', { customEffect: 'Invalid effect' });
    out.customEffect = opts.customEffect;
  }
  return out;
}

/* Validate a member's own style change against their *current* entitlements. null clears a choice. */
function validateStyle(ent, d, cat) {
  const out = {};
  if (!ent.active) throw new HttpError(403, 'vip_required', 'You need an active VIP membership to change VIP styling.');
  if ('usernameColor' in d) {
    if (d.usernameColor !== null && !ent.colors.includes(d.usernameColor)) throw invalid('Your membership does not include that username color.', { usernameColor: 'Not included' });
    out.username_color = d.usernameColor;
  }
  if ('avatarFrame' in d) {
    if (d.avatarFrame !== null && !ent.frames.includes(d.avatarFrame)) throw invalid('Your membership does not include that avatar frame.', { avatarFrame: 'Not included' });
    out.avatar_frame = d.avatarFrame;
  }
  if ('customColor' in d) {
    if (d.customColor !== null && !ent.customColor) throw invalid('Your membership does not include a custom username color.', { customColor: 'Not included' });
    out.custom_color = d.customColor === null ? null : normalizeHex(d.customColor);
  }
  if ('customFrame' in d) {
    if (d.customFrame !== null && !ent.customFrame) throw invalid('Your membership does not include a custom avatar frame color.', { customFrame: 'Not included' });
    out.custom_frame = d.customFrame === null ? null : normalizeHex(d.customFrame);
  }
  if ('customEffect' in d) {
    const e = d.customEffect && cat.effectById[d.customEffect];
    if (d.customEffect !== null && (!ent.customEffects || !e || !e.active)) throw invalid('Your membership does not include that username effect.', { customEffect: 'Not included' });
    out.custom_effect = d.customEffect;
  }
  return out;
}

async function savePrefs(q, userId, cols) {
  const keys = Object.keys(cols).filter((k) => ['username_color', 'avatar_frame', 'custom_color', 'custom_effect', 'custom_frame'].includes(k));
  if (!keys.length) return;
  await q.query('INSERT INTO user_vip_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await q.query(`UPDATE user_vip_prefs SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE user_id = $1`, [userId, ...keys.map((k) => cols[k])]);
}

/* ---------- purchase rules ---------- */

/* Can `recipientId` receive `product`? Rejects purchases that would add nothing (already owns the
   lifetime package, or owns a package that includes this one). Returns the order kind. */
async function purchaseKind(q, recipientId, product, cat) {
  const rows = await activeRows([recipientId], q);
  const owned = rows.map((r) => ({ r, p: cat.productById[String(r.product_id)] })).filter((x) => x.p);
  for (const { p } of owned) {
    if (p.id === product.id && product.lifetime) throw conflict('This account already has ' + product.name + '.');
    if (p.supersedes.includes(product.slug)) throw conflict('This account already has ' + p.name + ', which includes everything in ' + product.name + '.');
  }
  if (owned.some(({ p }) => product.supersedes.includes(p.slug))) return 'upgrade';
  if (owned.some(({ p }) => p.id === product.id)) return 'renewal';
  return 'purchase';
}

/* Server-side price for a product and billing choice. */
function priceFor(product, billing) {
  if (product.lifetime) {
    if (billing !== 'lifetime') throw invalid('This package is a one-time lifetime purchase.', { billing: 'Must be lifetime' });
    return product.price_cents;
  }
  if (billing === 'month') return product.price_cents;
  if (billing === 'year') {
    if (product.annual_price_cents == null) throw invalid('Annual billing is not available for this package.', { billing: 'Not available' });
    return product.annual_price_cents;
  }
  throw invalid('Please choose monthly billing for this package.', { billing: 'Invalid billing period' });
}

/* ---------- wallet ---------- */

async function walletBalance(userId, q = db) {
  const w = await q.one('SELECT balance_cents FROM user_wallets WHERE user_id = $1', [userId]);
  return w ? Number(w.balance_cents) : 0;
}

async function walletChange(q, userId, cents, kind, { orderId = null, actorId = null, reason = '' } = {}) {
  await q.query('INSERT INTO user_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  const w = await q.one('SELECT balance_cents FROM user_wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  const after = Number(w.balance_cents) + cents;
  if (after < 0) throw new HttpError(402, 'insufficient_funds', 'Your wallet balance is too low for this purchase.');
  await q.query('UPDATE user_wallets SET balance_cents = $2, updated_at = now() WHERE user_id = $1', [userId, after]);
  await q.query(`INSERT INTO wallet_transactions (user_id, amount_cents, balance_after, kind, order_id, actor_id, reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [userId, cents, after, kind, orderId, actorId, String(reason).slice(0, 200)]);
  return after;
}

/* ---------- order completion (the only place a paid order becomes a membership) ---------- */

async function auditRow(q, actorId, action, targetType, targetId, details, ip) {
  await q.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId || null, action, targetType, targetId == null ? null : String(targetId), JSON.stringify(details || {}), ip || null]);
}

const AUDIT_ACTION = { purchase: 'vip.purchase', renewal: 'vip.renewal', upgrade: 'vip.upgrade', gift: 'vip.gift', admin_grant: 'vip.admin_grant' };

/* Mark an order paid and activate the membership, atomically. Must run inside a transaction.
   `pay` = { txnId, amountCents, currency } as verified by the provider (never the browser).
   Idempotent: completing an already-paid order does nothing. */
async function completeOrderTx(q, orderId, pay, ctx = {}) {
  const o = await q.one('SELECT * FROM vip_orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order not found.');
  if (o.status === 'paid') return { order: o, already: true };
  if (o.status === 'refunded') return { order: o, ignored: true };
  if (Number(pay.amountCents) !== o.amount_cents || String(pay.currency).toUpperCase() !== o.currency) {
    await q.query(`UPDATE vip_orders SET status = 'failed', failure_reason = 'amount_mismatch', provider_txn_id = coalesce(provider_txn_id, $2), updated_at = now() WHERE id = $1`, [o.id, pay.txnId || null]);
    await auditRow(q, ctx.actorId, 'vip.payment_failed', 'vip_order', o.public_id, { reason: 'amount_mismatch', expected: o.amount_cents, received: Number(pay.amountCents), currency: pay.currency, provider: o.provider }, ctx.ip);
    log.error('vip.amount_mismatch', { order: o.public_id, provider: o.provider });
    return { order: o, mismatch: true };
  }
  const product = await q.one('SELECT * FROM vip_products WHERE id = $1', [o.product_id]);
  await q.query(`UPDATE vip_orders SET status = 'paid', paid_at = now(), provider_txn_id = coalesce($2, provider_txn_id), failure_reason = '', updated_at = now() WHERE id = $1`, [o.id, pay.txnId || null]);

  // Time-limited packages stack: a renewal starts when the current period of the same package ends.
  let expiration = null;
  if (!product.lifetime) {
    const interval = o.billing === 'year' ? '1 year' : o.billing === 'custom' ? `${Number(o.options.days) || 30} days` : '1 month';
    const r = await q.one(`SELECT GREATEST(now(), coalesce((SELECT max(m.expiration_date) FROM vip_memberships m
        WHERE m.user_id = $1 AND m.product_id = $2 AND ${ACTIVE}), now())) + $3::interval AS exp`, [o.recipient_id, product.id, interval]);
    expiration = r.exp;
  }
  const from = await q.one(`SELECT m.id FROM vip_memberships m JOIN vip_products p ON p.id = m.product_id
    WHERE m.user_id = $1 AND ${ACTIVE} AND p.slug = ANY($2) ORDER BY p.tier_rank DESC LIMIT 1`, [o.recipient_id, product.supersedes]);
  const opt = o.options || {};
  const m = await q.one(`INSERT INTO vip_memberships (user_id, product_id, order_id, status, starts_at, expiration_date, lifetime,
      payment_provider, payment_transaction_id, avatar_frame, username_color, custom_username_color, custom_username_effect,
      granted_by, gifted_by, upgraded_from_id, note)
    VALUES ($1, $2, $3, 'active', now(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
  [o.recipient_id, product.id, o.id, expiration, product.lifetime, o.provider, pay.txnId || null,
    opt.avatarFrame || null, opt.usernameColor || null, opt.customColor || null, opt.customEffect || null,
    o.kind === 'admin_grant' ? o.purchaser_id : null, o.kind === 'gift' ? o.purchaser_id : null, from ? from.id : null,
    String(opt.note || '').slice(0, 300)]);
  const prefs = {};
  if (opt.avatarFrame) prefs.avatar_frame = opt.avatarFrame;
  if (opt.usernameColor) prefs.username_color = opt.usernameColor;
  if (opt.customColor) prefs.custom_color = opt.customColor;
  if (opt.customEffect) prefs.custom_effect = opt.customEffect;
  await savePrefs(q, o.recipient_id, prefs);

  const details = { order: o.public_id, product: product.slug, amountCents: o.amount_cents, currency: o.currency, provider: o.provider,
    transactionId: pay.txnId || null, purchaserId: o.purchaser_id, recipientId: o.recipient_id, billing: o.billing };
  await auditRow(q, ctx.actorId, AUDIT_ACTION[o.kind] || 'vip.purchase', 'vip_order', o.public_id, details, ctx.ip);
  await auditRow(q, ctx.actorId, 'vip.activate', 'vip_membership', m.id, { user: o.recipient_id, product: product.slug, lifetime: product.lifetime, expiresAt: expiration }, ctx.ip);
  if (o.kind === 'gift') {
    const from2 = await q.one('SELECT username FROM users WHERE id = $1', [o.purchaser_id]);
    await notify(q, { userId: o.recipient_id, actorId: o.purchaser_id, type: 'vip', text: `${from2 ? from2.username : 'A member'} gifted you ${product.name}! 👑`, link: '#/account/vip' });
  } else if (o.kind === 'admin_grant') {
    await notify(q, { userId: o.recipient_id, type: 'vip', text: `You've been given ${product.name}. 👑`, link: '#/account/vip' });
  } else {
    await notify(q, { userId: o.recipient_id, type: 'vip', text: `Your ${product.name} membership is active. Thank you for supporting PinkPill! 👑`, link: '#/account/vip' });
  }
  return { order: Object.assign(o, { status: 'paid' }), membershipId: m.id };
}

async function failOrderTx(q, orderId, reason, ctx = {}) {
  const o = await q.one('SELECT * FROM vip_orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o || o.status !== 'pending') return false;
  await q.query(`UPDATE vip_orders SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [o.id, String(reason).slice(0, 200)]);
  await auditRow(q, ctx.actorId, 'vip.payment_failed', 'vip_order', o.public_id, { reason, provider: o.provider, purchaserId: o.purchaser_id }, ctx.ip);
  return true;
}

/* Refund: marks the order refunded, removes the entitlement, returns wallet funds. Idempotent. */
async function refundOrderTx(q, orderId, reason, ctx = {}) {
  const o = await q.one('SELECT * FROM vip_orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order not found.');
  if (o.status === 'refunded') return { order: o, already: true };
  if (o.status !== 'paid') throw conflict('Only paid orders can be refunded.');
  await q.query(`UPDATE vip_orders SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE id = $1`, [o.id]);
  await q.query(`UPDATE vip_memberships SET status = 'refunded', updated_at = now() WHERE order_id = $1`, [o.id]);
  if (o.provider === 'wallet' && o.purchaser_id && o.amount_cents > 0) {
    await walletChange(q, o.purchaser_id, o.amount_cents, 'refund', { orderId: o.id, actorId: ctx.actorId, reason: 'Refund of ' + o.public_id });
  }
  await auditRow(q, ctx.actorId, 'vip.refund', 'vip_order', o.public_id, { reason: String(reason || '').slice(0, 200), amountCents: o.amount_cents, provider: o.provider, recipientId: o.recipient_id }, ctx.ip);
  await notify(q, { userId: o.recipient_id, type: 'vip', text: 'A VIP purchase was refunded and its benefits have been removed.', link: '#/account/vip' });
  return { order: o };
}

/* ---------- housekeeping ---------- */

async function expireMemberships(q = db) {
  const rows = await q.many(`UPDATE vip_memberships SET status = 'expired', updated_at = now()
    WHERE status = 'active' AND NOT lifetime AND expiration_date <= now() RETURNING id, user_id, product_id`);
  for (const r of rows) await auditRow(q, null, 'vip.expire', 'vip_membership', r.id, { user: r.user_id, productId: r.product_id });
  // Checkouts nobody completed within two days are cancelled (a late payment still completes them).
  await q.query(`UPDATE vip_orders SET status = 'cancelled', failure_reason = 'abandoned', updated_at = now()
    WHERE status = 'pending' AND created_at < now() - interval '2 days'`);
  return rows.length;
}

module.exports = {
  ACTIVE, NONE, catalog, invalidate, productJson, combine, entitlementsFor, entitlementsOf, publicStyles, selfView, vipForumAudience,
  validateOptions, validateStyle, savePrefs, normalizeHex, purchaseKind, priceFor, walletBalance, walletChange,
  completeOrderTx, failOrderTx, refundOrderTx, expireMemberships, auditRow,
};

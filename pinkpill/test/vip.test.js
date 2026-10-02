'use strict';
/* VIP memberships: authentication, pricing integrity, payments (stubbed Stripe / PayPal / Coinbase APIs),
 * gifts, entitlements, expiry, admin tools, and the Private Ratings / VIP forum access rules. */
const http = require('node:http');
const crypto = require('node:crypto');

// Payment provider APIs are replaced by a local stub server; configure before the app loads.
const STUB_PORT = 5100 + Math.floor(Math.random() * 800);
const STUB = 'http://127.0.0.1:' + STUB_PORT;
Object.assign(process.env, {
  STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_WEBHOOK_SECRET: 'whsec_test_stub', STRIPE_API_URL: STUB + '/stripe',
  PAYPAL_CLIENT_ID: 'pp_id', PAYPAL_CLIENT_SECRET: 'pp_secret', PAYPAL_WEBHOOK_ID: 'WH-1', PAYPAL_API_URL: STUB + '/paypal',
  COINBASE_COMMERCE_API_KEY: 'cb_key', COINBASE_COMMERCE_WEBHOOK_SECRET: 'cb_whsec', COINBASE_COMMERCE_API_URL: STUB + '/coinbase',
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, teardown, client, member, db, getApp } = require('./helpers');
const vip = require('../server/lib/vip');

/* ---------- provider stub ---------- */
const stub = { stripe: {}, stripeCreated: [], paypal: {}, paypalVerify: 'SUCCESS', coinbase: {}, refunds: [], n: 0 };
const stubServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const u = req.url;
    if (u === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer sk_test_stub') return send(401, { error: { type: 'auth' } });
      const f = Object.fromEntries(new URLSearchParams(body));
      const id = 'cs_test_' + (++stub.n);
      stub.stripeCreated.push(f);
      stub.stripe[id] = { id, client_reference_id: f.client_reference_id, payment_status: 'unpaid', status: 'open', amount_total: Number(f['line_items[0][price_data][unit_amount]']), currency: f['line_items[0][price_data][currency]'], payment_intent: null };
      return send(200, { id, url: 'https://checkout.stripe.test/' + id });
    }
    let m = /^\/stripe\/v1\/checkout\/sessions\/([\w]+)$/.exec(u);
    if (m) return stub.stripe[m[1]] ? send(200, stub.stripe[m[1]]) : send(404, { error: { type: 'invalid_request_error' } });
    if (u === '/stripe/v1/refunds') { stub.refunds.push(Object.fromEntries(new URLSearchParams(body))); return send(200, { id: 're_1', status: 'succeeded' }); }
    if (u === '/paypal/v1/oauth2/token') return send(200, { access_token: 'pp_token', expires_in: 3600 });
    if (u === '/paypal/v2/checkout/orders' && req.method === 'POST') {
      const j = JSON.parse(body); const id = 'PPORDER' + (++stub.n);
      stub.paypal[id] = { status: 'CREATED', value: j.purchase_units[0].amount.value, custom: j.purchase_units[0].custom_id };
      return send(201, { id, status: 'CREATED', links: [{ rel: 'approve', href: 'https://www.paypal.test/checkoutnow?token=' + id }] });
    }
    m = /^\/paypal\/v2\/checkout\/orders\/(\w+)(\/capture)?$/.exec(u);
    if (m) {
      const o = stub.paypal[m[1]];
      if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      if (m[2]) { o.status = 'COMPLETED'; o.capture = { id: 'CAP' + m[1], status: 'COMPLETED', amount: { value: o.value, currency_code: 'USD' } }; }
      return send(200, { id: m[1], status: o.status, purchase_units: o.capture ? [{ payments: { captures: [o.capture] } }] : [{}] });
    }
    if (u === '/paypal/v1/notifications/verify-webhook-signature') return send(200, { verification_status: stub.paypalVerify });
    if (u === '/coinbase/charges' && req.method === 'POST') {
      const j = JSON.parse(body); const code = 'CB' + (++stub.n);
      stub.coinbase[code] = { code, metadata: j.metadata, pricing: { local: j.local_price }, timeline: [{ status: 'NEW' }], payments: [] };
      return send(201, { data: { code, hosted_url: 'https://commerce.coinbase.test/charges/' + code } });
    }
    m = /^\/coinbase\/charges\/(\w+)$/.exec(u);
    if (m) return stub.coinbase[m[1]] ? send(200, { data: stub.coinbase[m[1]] }) : send(404, {});
    send(404, { error: 'no stub for ' + u });
  });
});

let alice, bob, carol, dave, mod, admin, guest;
const idem = () => crypto.randomUUID();
const buy = (c, body) => c.post('/api/vip/checkout', Object.assign({ billing: 'month', options: {}, confirm: true, idempotencyKey: idem() }, body));
async function credit(c, cents) { await db.query('INSERT INTO user_wallets (user_id, balance_cents) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance_cents = user_wallets.balance_cents + $2', [c.user.id, cents]); }
async function ent(c) { return (await c.get('/api/auth/session')).body.user.vipStatus; }
async function orderRow(publicId) { return db.one('SELECT * FROM vip_orders WHERE public_id = $1', [publicId]); }
function stripeWebhook(event, secret = 'whsec_test_stub', t = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  return request(getApp()).post('/api/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${sig}`).send(raw);
}
async function clearVip(c) {
  await db.query("UPDATE vip_memberships SET status = 'cancelled' WHERE user_id = $1", [c.user.id]);
  await db.query('DELETE FROM user_vip_prefs WHERE user_id = $1', [c.user.id]);
}
async function grantWallet(c, product, options = {}, billing) {
  await credit(c, 50000);
  const r = await buy(c, { product, billing: billing || (product.startsWith('lifetime') ? 'lifetime' : 'month'), paymentMethod: 'wallet', options });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.order;
}

before(async () => {
  await new Promise((r) => stubServer.listen(STUB_PORT, '127.0.0.1', r));
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  alice = await member({ username: 'alice' });
  bob = await member({ username: 'bob' });
  carol = await member({ username: 'carol' });
  dave = await member({ username: 'dave' });
  mod = await member({ username: 'moddy', role: 'moderator' });
  admin = await member({ username: 'boss', role: 'admin' });
  guest = client();
});
after(async () => { await teardown(); stubServer.close(); });

/* ---------- 1. login requirement ---------- */

test('logged-out visitors are sent to login from every VIP page URL, members to the page', async () => {
  const app = getApp();
  for (const p of ['/vip', '/vip/checkout/vip', '/vip/gift/vip-plus', '/account/vip', '/account/purchases', '/vip/return?order=abc']) {
    const r = await request(app).get(p);
    assert.equal(r.status, 302, p);
    assert.match(r.headers.location, /^\/#\/login\?return=%23%2F/, p);
  }
  const r = await alice.agent.get('/vip');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/#/vip');
  const q = await request(app).get('/vip/return?order=<script>&x=1');
  assert.ok(!/script|x=1/.test(q.headers.location), 'only whitelisted, safe query values are carried over');
});

test('every VIP API endpoint rejects unauthenticated requests', async () => {
  const calls = [
    ['get', '/api/vip/catalog'], ['get', '/api/vip/me'], ['get', '/api/vip/recipient?username=bob'], ['get', '/api/account/purchases'],
    ['post', '/api/vip/quote', { product: 'vip', billing: 'month' }],
    ['post', '/api/vip/checkout', { product: 'vip', billing: 'month', paymentMethod: 'wallet', confirm: true, idempotencyKey: idem() }],
    ['patch', '/api/vip/style', { usernameColor: 'red' }], ['get', '/api/vip/orders/' + crypto.randomUUID()],
    ['post', '/api/vip/orders/' + crypto.randomUUID() + '/verify'], ['post', '/api/account/username', { username: 'x', password: 'y' }],
    ['put', '/api/account/vanity', { vanity: 'abc' }], ['get', '/api/admin/vip/orders'], ['post', '/api/admin/vip/memberships', {}],
  ];
  for (const [m, url, body] of calls) {
    const r = await guest[m](url, body);
    assert.equal(r.status, 401, `${m} ${url} → ${r.status}`);
  }
  // Admin VIP endpoints are forbidden for members.
  assert.equal((await alice.get('/api/admin/vip/orders')).status, 403);
  assert.equal((await alice.patch('/api/admin/vip/products/vip', { priceCents: 100 })).status, 403);
});

/* ---------- catalog & pricing integrity ---------- */

test('catalog comes from the database with the specified initial prices; unconfigured methods are unavailable', async () => {
  const r = await alice.get('/api/vip/catalog');
  assert.equal(r.status, 200);
  const price = Object.fromEntries(r.body.products.map((p) => [p.slug, p.priceCents]));
  assert.deepEqual(price, { vip: 800, 'vip-plus': 1700, 'lifetime-vip': 8200, 'lifetime-vip-plus': 10800, 'lifetime-vip-plus-custom': 20800 });
  const lv = r.body.products.find((p) => p.slug === 'lifetime-vip-plus');
  assert.ok(!r.body.products.some((p) => p.notes.includes('Lifetime means the lifetime of the forum.') || /lifetime of the forum/i.test(p.description)), 'disclaimer removed');
  assert.ok(!r.body.products.some((p) => p.benefits.some((b) => /^ncludes|^\s*$/.test(b))), 'spec typos and empty bullets are cleaned up');
  assert.equal(r.body.products.find((p) => p.slug === 'lifetime-vip').requiresAvatarFrame, false);
  assert.ok(r.body.paymentMethods.every((m) => m.available), 'all stubbed providers + wallet are configured in this test');
});

test('the client cannot choose the price, product id or membership: strict schemas and server pricing', async () => {
  const base = { product: 'vip', billing: 'month', paymentMethod: 'card', confirm: true };
  for (const extra of [{ priceCents: 1 }, { amountCents: 1 }, { price: 0.01 }, { productId: '1' }, { membershipId: '1' }, { recipientId: String(bob.user.id) }, { status: 'paid' }]) {
    const r = await alice.post('/api/vip/checkout', Object.assign({ idempotencyKey: idem() }, base, extra));
    assert.equal(r.status, 422, JSON.stringify(extra));
  }
  assert.equal((await buy(alice, { product: 'no-such-package', paymentMethod: 'card' })).status, 404);
  assert.equal((await buy(alice, { product: 'vip', billing: 'lifetime', paymentMethod: 'card' })).status, 422, 'billing must match the package');
  assert.equal((await buy(alice, { product: 'vip', billing: 'year', paymentMethod: 'card' })).status, 422, 'no annual price configured yet');
  assert.equal((await alice.post('/api/vip/checkout', Object.assign({}, base, { idempotencyKey: idem(), confirm: false }))).status, 422, 'confirmation is required');
  // Disabled package.
  await db.query("UPDATE vip_products SET active = false WHERE slug = 'vip'"); vip.invalidate();
  assert.equal((await buy(alice, { product: 'vip', paymentMethod: 'card' })).status, 404);
  await db.query("UPDATE vip_products SET active = true WHERE slug = 'vip'"); vip.invalidate();
  // Quote is computed by the server.
  const q = await alice.post('/api/vip/quote', { product: 'vip-plus', billing: 'month', options: { avatarFrame: 'red' } });
  assert.equal(q.status, 200);
  assert.equal(q.body.amountCents, 1700);
});

/* ---------- card (Stripe) purchase ---------- */

test('card purchase: pending until Stripe confirms; the browser returning is not enough', async () => {
  const r = await buy(bob, { product: 'vip', paymentMethod: 'card', options: { usernameColor: 'blue' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.redirectUrl, /^https:\/\/checkout\.stripe\.test\//);
  const sent = stub.stripeCreated[stub.stripeCreated.length - 1];
  assert.equal(sent['line_items[0][price_data][unit_amount]'], '800', 'Stripe is charged the server price');
  assert.equal(sent.client_reference_id, r.body.order.id);
  assert.equal(r.body.order.status, 'pending');
  assert.equal((await ent(bob)).active, false, 'no VIP before payment');
  // Returning from checkout triggers a server-side check; Stripe says unpaid → still pending.
  let v = await bob.post('/api/vip/orders/' + r.body.order.id + '/verify');
  assert.equal(v.body.order.status, 'pending');
  assert.equal((await ent(bob)).active, false);
  // Stripe reports it paid → membership activates.
  const o = await orderRow(r.body.order.id);
  Object.assign(stub.stripe[o.provider_ref], { payment_status: 'paid', status: 'complete', payment_intent: 'pi_bob_1' });
  v = await bob.post('/api/vip/orders/' + r.body.order.id + '/verify');
  assert.equal(v.body.order.status, 'paid');
  const e = await ent(bob);
  assert.equal(e.active, true);
  assert.deepEqual(e.products, ['vip']);
  assert.equal(e.conversationLimit, 15);
  assert.equal(e.lifetime, false);
  assert.ok(new Date(e.expiresAt) > new Date(Date.now() + 27 * 86400000));
  const m = await db.one('SELECT * FROM vip_memberships WHERE order_id = $1', [o.id]);
  assert.equal(m.payment_transaction_id, 'pi_bob_1');
  assert.equal(m.username_color, 'blue');
  // Verifying again is harmless (idempotent).
  await bob.post('/api/vip/orders/' + r.body.order.id + '/verify');
  assert.equal((await db.one('SELECT count(*)::int AS n FROM vip_memberships WHERE order_id = $1', [o.id])).n, 1);
  // Audit trail.
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.purchase' AND target_id = $1", [r.body.order.id]));
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.activate' AND details->>'user' = $1", [String(bob.user.id)]));
  // Other members can't see or verify this order.
  assert.equal((await carol.get('/api/vip/orders/' + r.body.order.id)).status, 404);
  assert.equal((await carol.post('/api/vip/orders/' + r.body.order.id + '/verify')).status, 404);
  await clearVip(bob);
});

test('Stripe webhooks: signature required, idempotent, amount must match', async () => {
  const r = await buy(carol, { product: 'vip', paymentMethod: 'card' });
  const o = await orderRow(r.body.order.id);
  const event = (id, amount) => ({ id, type: 'checkout.session.completed', data: { object: { id: o.provider_ref, client_reference_id: o.public_id, payment_status: 'paid', payment_intent: 'pi_' + id, amount_total: amount, currency: 'usd' } } });
  assert.equal((await stripeWebhook(event('evt_bad', 800), 'whsec_wrong')).status, 400, 'forged signature rejected');
  assert.equal((await stripeWebhook(event('evt_old', 800), undefined, Math.floor(Date.now() / 1000) - 3600)).status, 400, 'replayed old signature rejected');
  const noSig = await request(getApp()).post('/api/payments/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(event('evt_nosig', 800)));
  assert.equal(noSig.status, 400);
  assert.equal((await orderRow(o.public_id)).status, 'pending');
  assert.equal((await ent(carol)).active, false);
  // Underpayment is not accepted.
  const under = await stripeWebhook(event('evt_under', 1));
  assert.equal(under.body.result, 'amount_mismatch');
  assert.equal((await orderRow(o.public_id)).status, 'failed');
  assert.equal((await ent(carol)).active, false);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.payment_failed' AND target_id = $1", [o.public_id]));
  // A correct payment for a new order, delivered twice.
  const r2 = await buy(carol, { product: 'vip', paymentMethod: 'card' });
  const o2 = await orderRow(r2.body.order.id);
  const ev = { id: 'evt_ok', type: 'checkout.session.completed', data: { object: { id: o2.provider_ref, client_reference_id: o2.public_id, payment_status: 'paid', payment_intent: 'pi_carol', amount_total: 800, currency: 'usd' } } };
  assert.equal((await stripeWebhook(ev)).body.result, 'paid');
  assert.equal((await stripeWebhook(ev)).body.result, 'duplicate');
  assert.equal((await db.one('SELECT count(*)::int AS n FROM vip_memberships WHERE user_id = $1 AND status = $2', [carol.user.id, 'active'])).n, 1);
  assert.equal((await ent(carol)).active, true);
  // Mismatched identifiers (a valid session paired with another order's id) are ignored.
  const r3 = await buy(dave, { product: 'vip', paymentMethod: 'card' });
  const o3 = await orderRow(r3.body.order.id);
  const cross = await stripeWebhook({ id: 'evt_cross', type: 'checkout.session.completed', data: { object: { id: o3.provider_ref, client_reference_id: o2.public_id, payment_status: 'paid', payment_intent: 'pi_x', amount_total: 800, currency: 'usd' } } });
  assert.equal(cross.body.result, 'unknown_order');
  assert.equal((await orderRow(o3.public_id)).status, 'pending');
  // Full refund through Stripe removes the membership.
  const refund = await stripeWebhook({ id: 'evt_refund', type: 'charge.refunded', data: { object: { refunded: true, payment_intent: 'pi_carol' } } });
  assert.equal(refund.body.result, 'refunded');
  assert.equal((await orderRow(o2.public_id)).status, 'refunded');
  assert.equal((await ent(carol)).active, false);
});

test('a repeated checkout request with the same idempotency key creates only one order', async () => {
  const key = idem();
  const body = { product: 'vip', billing: 'month', paymentMethod: 'card', options: {}, confirm: true, idempotencyKey: key };
  const a = await dave.post('/api/vip/checkout', body);
  const b = await dave.post('/api/vip/checkout', body);
  assert.equal(a.status, 201);
  assert.equal(b.body.duplicate, true);
  assert.equal(a.body.order.id, b.body.order.id);
  assert.equal((await db.one('SELECT count(*)::int AS n FROM vip_orders WHERE idempotency_key = $1', [key])).n, 1);
});

/* ---------- PayPal & crypto ---------- */

test('PayPal: the server captures the approved order; webhooks need PayPal verification', async () => {
  const r = await buy(dave, { product: 'vip-plus', paymentMethod: 'paypal', options: { avatarFrame: 'green' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.redirectUrl, /^https:\/\/www\.paypal\.test\//);
  const o = await orderRow(r.body.order.id);
  assert.equal(stub.paypal[o.provider_ref].value, '17.00');
  // Not approved yet → pending.
  assert.equal((await dave.post('/api/vip/orders/' + o.public_id + '/verify')).body.order.status, 'pending');
  stub.paypal[o.provider_ref].status = 'APPROVED';
  assert.equal((await dave.post('/api/vip/orders/' + o.public_id + '/verify')).body.order.status, 'paid');
  const e = await ent(dave);
  assert.equal(e.conversationLimit, 25);
  assert.equal(e.style.frame, '#16a34a');
  // Webhook with failed verification is rejected.
  stub.paypalVerify = 'FAILURE';
  const bad = await request(getApp()).post('/api/payments/webhooks/paypal').set('Content-Type', 'application/json')
    .set('PayPal-Transmission-Id', 't1').set('PayPal-Transmission-Sig', 'sig').send(JSON.stringify({ id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { links: [{ rel: 'up', href: STUB + '/v2/payments/captures/CAP' + o.provider_ref }] } }));
  assert.equal(bad.status, 400);
  assert.equal((await orderRow(o.public_id)).status, 'paid');
  stub.paypalVerify = 'SUCCESS';
  await clearVip(dave);
});

test('crypto (Coinbase Commerce): signed webhook confirms the charge', async () => {
  const r = await buy(mod, { product: 'vip', paymentMethod: 'crypto' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = await orderRow(r.body.order.id);
  const payload = (id, type) => JSON.stringify({ event: { id, type, data: { code: o.provider_ref, metadata: { order_id: o.public_id }, pricing: { local: { amount: '8.00', currency: 'USD' } }, payments: [{ transaction_id: '0xabc' }] } } });
  const send = (raw, secret) => request(getApp()).post('/api/payments/webhooks/coinbase').set('Content-Type', 'application/json')
    .set('X-CC-Webhook-Signature', crypto.createHmac('sha256', secret).update(raw).digest('hex')).send(raw);
  assert.equal((await send(payload('cb1', 'charge:confirmed'), 'wrong')).status, 400);
  assert.equal((await orderRow(o.public_id)).status, 'pending');
  assert.equal((await send(payload('cb2', 'charge:confirmed'), 'cb_whsec')).body.result, 'paid');
  assert.equal((await orderRow(o.public_id)).provider_txn_id, '0xabc');
  await clearVip(mod);
});

test('a provider outage fails the checkout cleanly without granting anything', async () => {
  const saved = process.env.STRIPE_API_URL;
  require('../server/config').payments.stripe.apiUrl = 'http://127.0.0.1:1';
  const r = await buy(alice, { product: 'vip', paymentMethod: 'card' });
  require('../server/config').payments.stripe.apiUrl = saved;
  assert.equal(r.status, 502);
  assert.match(r.body.error.message, /not been charged/);
  assert.ok(!/127\.0\.0\.1|stripe/i.test(r.body.error.message), 'no provider details leak');
  assert.equal((await ent(alice)).active, false);
});

/* ---------- wallet ---------- */

test('wallet: insufficient balance is refused and recorded; payment is atomic with activation', async () => {
  const r = await buy(alice, { product: 'lifetime-vip', billing: 'lifetime', paymentMethod: 'wallet' });
  assert.equal(r.status, 402);
  assert.equal(r.body.error.code, 'insufficient_funds');
  assert.equal((await ent(alice)).active, false);
  assert.ok(await db.one("SELECT 1 FROM vip_orders WHERE purchaser_id = $1 AND status = 'failed' AND failure_reason = 'insufficient_funds'", [alice.user.id]));
  await credit(alice, 8200);
  const ok = await buy(alice, { product: 'lifetime-vip', billing: 'lifetime', paymentMethod: 'wallet', options: { usernameColor: 'rose-gold' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.order.status, 'paid');
  assert.equal((await db.one('SELECT balance_cents FROM user_wallets WHERE user_id = $1', [alice.user.id])).balance_cents, '0');
});

/* ---------- lifetime ---------- */

test('lifetime: no expiration date, verified badge, never expired by housekeeping', async () => {
  const e = await ent(alice);
  assert.equal(e.lifetime, true);
  assert.equal(e.expiresAt, null);
  assert.equal(e.verifiedBadge, true);
  assert.ok(e.colors.includes('rose-gold'), 'lifetime-exclusive colors');
  const m = await db.one("SELECT * FROM vip_memberships WHERE user_id = $1 AND status = 'active'", [alice.user.id]);
  assert.equal(m.expiration_date, null);
  // Public summary shows the badge and the exclusive color.
  const s = (await bob.get('/api/members/' + alice.user.id)).body.user.vip;
  assert.equal(s.badge, true);
  assert.equal(s.color.id, 'rose-gold');
  await vip.expireMemberships();
  assert.equal((await ent(alice)).active, true);
  // The database refuses a lifetime membership with an expiry date.
  await assert.rejects(db.query('UPDATE vip_memberships SET expiration_date = now() WHERE id = $1', [m.id]), /check/i);
  // Buying the same lifetime package again is refused.
  await credit(alice, 8200);
  assert.equal((await buy(alice, { product: 'lifetime-vip', billing: 'lifetime', paymentMethod: 'wallet' })).status, 409);
  // Monthly VIP adds nothing to Lifetime VIP → refused.
  assert.equal((await buy(alice, { product: 'vip', paymentMethod: 'wallet' })).status, 409);
  // Upgrading to Lifetime VIP+ is allowed and recorded as an upgrade.
  const up = await buy(alice, { product: 'lifetime-vip-plus', billing: 'lifetime', paymentMethod: 'wallet', options: { avatarFrame: 'yellow' } });
  assert.equal(up.status, 402, 'only 82.00 was credited');
  await credit(alice, 10800);
  const up2 = await buy(alice, { product: 'lifetime-vip-plus', billing: 'lifetime', paymentMethod: 'wallet', options: { avatarFrame: 'yellow' } });
  assert.equal(up2.status, 201, JSON.stringify(up2.body));
  assert.equal(up2.body.order.kind, 'upgrade');
  assert.ok(await db.one("SELECT 1 FROM vip_memberships WHERE order_id = (SELECT id FROM vip_orders WHERE public_id = $1) AND upgraded_from_id IS NOT NULL", [up2.body.order.id]));
  assert.equal((await ent(alice)).conversationLimit, 25);
});

/* ---------- VIP+ options, custom colors & effects ---------- */

test('VIP+ requires a valid avatar frame; colors are limited to the package', async () => {
  await credit(bob, 50000);
  assert.equal((await buy(bob, { product: 'vip-plus', paymentMethod: 'wallet' })).status, 422, 'frame required');
  assert.equal((await buy(bob, { product: 'vip-plus', paymentMethod: 'wallet', options: { avatarFrame: 'gold' } })).status, 422, 'unknown frame');
  assert.equal((await buy(bob, { product: 'vip-plus', paymentMethod: 'wallet', options: { avatarFrame: 'red', usernameColor: 'rose-gold' } })).status, 422, 'lifetime-exclusive color');
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'wallet', options: { usernameColor: 'purple' } })).status, 422, 'VIP has no purple');
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'wallet', options: { customColor: '#123456' } })).status, 422, 'custom color not included');
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'wallet', options: { avatarFrame: 'red' } })).status, 422, 'VIP has no frames');
});

test('custom username color and effects: validated hex and predefined effect ids only', async () => {
  await credit(carol, 50000);
  for (const bad of ['red', '#12345g', '#1234567', 'url(javascript:x)', '#fff;background:url(x)', '<script>']) {
    const r = await buy(carol, { product: 'lifetime-vip-plus-custom', billing: 'lifetime', paymentMethod: 'wallet', options: { avatarFrame: 'blue', customColor: bad } });
    assert.equal(r.status, 422, 'rejected ' + bad);
  }
  for (const bad of ['rainbow', 'glow;color:red', 'GLOW']) {
    const r = await buy(carol, { product: 'lifetime-vip-plus-custom', billing: 'lifetime', paymentMethod: 'wallet', options: { avatarFrame: 'blue', customEffect: bad } });
    assert.equal(r.status, 422, 'rejected effect ' + bad);
  }
  const ok = await buy(carol, { product: 'lifetime-vip-plus-custom', billing: 'lifetime', paymentMethod: 'wallet', options: { avatarFrame: 'blue', customColor: '#AABBCC', customEffect: 'glow' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  let s = (await bob.get('/api/members/' + carol.user.id)).body.user.vip;
  assert.deepEqual(s.color, { id: 'custom', hex1: '#aabbcc', hex2: null });
  assert.equal(s.effect, 'glow');
  assert.equal((await db.one('SELECT custom_username_color FROM vip_memberships WHERE order_id = (SELECT id FROM vip_orders WHERE public_id = $1)', [ok.body.order.id])).custom_username_color, '#aabbcc');
  // Change after purchase, within the entitlement.
  assert.equal((await carol.patch('/api/vip/style', { customColor: '#00ff00', customEffect: 'shimmer' })).status, 200);
  assert.equal((await carol.patch('/api/vip/style', { customColor: 'blue' })).status, 422);
  assert.equal((await carol.patch('/api/vip/style', { customEffect: 'blink' })).status, 422);
  assert.equal((await carol.patch('/api/vip/style', { css: 'color:red' })).status, 422, 'no arbitrary fields');
  s = (await bob.get('/api/members/' + carol.user.id)).body.user.vip;
  assert.equal(s.color.hex1, '#00ff00');
});

test('custom avatar frame color: top tier only, validated hex, overrides the preset frame', async () => {
  // carol owns Lifetime VIP+ Custom Color (previous test); dave has no VIP.
  assert.equal((await carol.patch('/api/vip/style', { customFrame: '#12AB34' })).status, 200);
  let s = (await bob.get('/api/members/' + carol.user.id)).body.user.vip;
  assert.equal(s.frame, '#12ab34');
  for (const bad of ['red', '#fff', '#12345g', 'url(x)', '#000000;x']) assert.equal((await carol.patch('/api/vip/style', { customFrame: bad })).status, 422, bad);
  assert.equal((await carol.patch('/api/vip/style', { customFrame: null, avatarFrame: 'green' })).status, 200);
  s = (await bob.get('/api/members/' + carol.user.id)).body.user.vip;
  assert.equal(s.frame, '#16a34a', 'back to the preset frame');
  // VIP+ (not the custom package) doesn't include it.
  await grantWallet(dave, 'vip-plus', { avatarFrame: 'red' });
  assert.equal((await dave.patch('/api/vip/style', { customFrame: '#123456' })).status, 422);
  await clearVip(dave);
  assert.equal((await dave.patch('/api/vip/style', { customFrame: '#123456' })).status, 403);
});

test('members without the entitlement cannot use VIP styling, even with forged preferences', async () => {
  assert.equal((await dave.patch('/api/vip/style', { usernameColor: 'red' })).status, 403);
  await db.query("INSERT INTO user_vip_prefs (user_id, username_color, avatar_frame, custom_color) VALUES ($1, 'cosmic', 'red', '#ff0000') ON CONFLICT (user_id) DO UPDATE SET username_color = 'cosmic', avatar_frame = 'red', custom_color = '#ff0000'", [dave.user.id]);
  assert.equal((await bob.get('/api/members/' + dave.user.id)).body.user.vip, null);
  // A plain VIP member can't use VIP+ colors or frames.
  await grantWallet(dave, 'vip');
  assert.equal((await dave.patch('/api/vip/style', { usernameColor: 'cosmic' })).status, 422);
  assert.equal((await dave.patch('/api/vip/style', { avatarFrame: 'red' })).status, 422);
  const s = (await bob.get('/api/members/' + dave.user.id)).body.user.vip;
  assert.equal(s.color, null, 'saved VIP+ color is not shown for a VIP member');
  assert.equal(s.frame, null);
  assert.equal((await dave.patch('/api/vip/style', { usernameColor: 'green', avatarFrame: null, customColor: null })).status, 200);
  assert.equal((await bob.get('/api/members/' + dave.user.id)).body.user.vip.color.id, 'green');
  await clearVip(dave);
});

/* ---------- gifts ---------- */

test('gifts: recipient must exist and not be yourself; granted only after confirmed payment', async () => {
  assert.equal((await bob.get('/api/vip/recipient?username=alice')).status, 200);
  assert.equal((await bob.get('/api/vip/recipient?username=nobody-here')).status, 404);
  assert.equal((await bob.get('/api/vip/recipient?username=BOB')).status, 422, 'self (case-insensitive)');
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'card', giftTo: 'bob' })).status, 422);
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'card', giftTo: 'Bob' })).status, 422);
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'card', giftTo: 'ghost-user' })).status, 422);
  // Recipient already has everything → conflict.
  assert.equal((await buy(bob, { product: 'vip', paymentMethod: 'card', giftTo: 'alice' })).status, 409);
  // Gift VIP+ to dave by card.
  const r = await buy(bob, { product: 'vip-plus', paymentMethod: 'card', giftTo: 'dave', options: { avatarFrame: 'yellow', usernameColor: 'purple' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.order.kind, 'gift');
  assert.equal((await ent(dave)).active, false, 'nothing before payment');
  const o = await orderRow(r.body.order.id);
  assert.equal(String(o.recipient_id), String(dave.user.id));
  const paid = await stripeWebhook({ id: 'evt_gift', type: 'checkout.session.completed', data: { object: { id: o.provider_ref, client_reference_id: o.public_id, payment_status: 'paid', payment_intent: 'pi_gift', amount_total: 1700, currency: 'usd' } } });
  assert.equal(paid.body.result, 'paid');
  const e = await ent(dave);
  assert.equal(e.active, true);
  assert.equal(e.style.color.id, 'purple');
  const bobEnt = await ent(bob);
  assert.ok(!bobEnt.products.includes('vip-plus'), 'the purchaser does not receive the gift');
  const m = await db.one('SELECT * FROM vip_memberships WHERE order_id = $1', [o.id]);
  assert.equal(String(m.gifted_by), String(bob.user.id));
  const a = await db.one("SELECT details FROM audit_log WHERE action = 'vip.gift' AND target_id = $1", [o.public_id]);
  assert.equal(String(a.details.purchaserId), String(bob.user.id));
  assert.equal(String(a.details.recipientId), String(dave.user.id));
  const n = await db.one("SELECT text FROM notifications WHERE user_id = $1 AND type = 'vip' ORDER BY id DESC LIMIT 1", [dave.user.id]);
  assert.match(n.text, /bob gifted you VIP\+/);
  // Purchase history: bob sees the gift with its amount; dave sees it as received without payment details.
  const bp = (await bob.get('/api/account/purchases')).body.purchases.find((p) => p.id === o.public_id);
  assert.equal(bp.amountCents, 1700);
  assert.equal(bp.recipient.username, 'dave');
  const dp = (await dave.get('/api/account/purchases')).body.purchases.find((p) => p.id === o.public_id);
  assert.equal(dp.received, true);
  assert.equal(dp.amountCents, null);
});

/* ---------- benefits enforced server-side ---------- */

test('conversation limits: 10 without VIP, 15 with VIP, 25 with VIP+', async () => {
  const others = [];
  for (let i = 0; i < 25; i++) others.push(await member({ username: 'crowd' + i }));
  const names = (n) => others.slice(0, n).map((c) => c.user.username);
  const start = (c, n) => c.post('/api/conversations', { to: names(n), title: 'Group', content: 'Hi all' });
  const plain = await member({ username: 'plainjane' });
  assert.equal((await start(plain, 9)).status, 201, '10 total');
  const over = await start(plain, 10);
  assert.equal(over.status, 403);
  assert.equal(over.body.error.code, 'participant_limit');
  await grantWallet(plain, 'vip');
  assert.equal((await start(plain, 14)).status, 201, '15 total with VIP');
  assert.equal((await start(plain, 15)).status, 403);
  // dave has VIP+ (gift above).
  assert.equal((await start(dave, 24)).status, 201, '25 total with VIP+');
  assert.equal((await start(dave, 25)).status, 403);
  // Invites can't push a conversation past the limit.
  const c = await start(plain, 5);
  assert.equal((await plain.post('/api/conversations/' + c.body.id + '/invite', { names: names(20).slice(5, 15) })).status, 403);
  assert.equal((await plain.post('/api/conversations/' + c.body.id + '/invite', { names: names(20).slice(5, 14) })).status, 200);
});

test('post editing window: 60 minutes normally, 12 hours for VIP+; moderators exempt', async () => {
  const t = await bob.post('/api/forums/f-skin/threads', { title: 'Editing test', content: 'first' });
  const pid = t.body.postId;
  const age = (h) => db.query(`UPDATE posts SET created_at = now() - ($2 || ' hours')::interval WHERE id = $1`, [pid, String(h)]);
  await age(2);
  const r = await bob.patch('/api/posts/' + pid, { content: 'edited' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'edit_window_passed');
  assert.equal((await mod.patch('/api/posts/' + pid, { content: 'mod edit' })).status, 200);
  const t2 = await dave.post('/api/forums/f-skin/threads', { title: 'VIP+ editing', content: 'first' });
  await db.query("UPDATE posts SET created_at = now() - interval '11 hours' WHERE id = $1", [t2.body.postId]);
  assert.equal((await dave.patch('/api/posts/' + t2.body.postId, { content: 'still editable' })).status, 200);
  await db.query("UPDATE posts SET created_at = now() - interval '13 hours' WHERE id = $1", [t2.body.postId]);
  assert.equal((await dave.patch('/api/posts/' + t2.body.postId, { content: 'too late' })).status, 403);
  const th = await dave.get('/api/threads/' + t2.body.thread.id);
  assert.equal(th.body.permissions.editWindowMinutes, 720);
});

test('custom reactions need VIP+; standard reactions work for everyone', async () => {
  const t = await bob.post('/api/forums/f-skin/threads', { title: 'React to me', content: 'hello' });
  const pid = t.body.postId;
  const nr = await carol.put('/api/posts/' + pid + '/reaction', { reaction: 'like' });
  assert.equal(nr.status, 200);
  const plain = await member({ username: 'noreact' });
  const bad = await plain.put('/api/posts/' + pid + '/reaction', { reaction: 'crown' });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error.code, 'vip_required');
  assert.equal((await dave.put('/api/posts/' + pid + '/reaction', { reaction: 'crown' })).status, 200);
  assert.equal((await dave.put('/api/posts/' + pid + '/reaction', { reaction: 'nonsense' })).status, 422);
  assert.equal((await dave.get('/api/threads/' + t.body.thread.id)).body.permissions.vipReactions, true);
});

test('Ratings threads with replies: only VIP members may delete their own; never someone else\'s', async () => {
  const plain = await member({ username: 'rater' });
  const mk = async (c) => { const r = await c.post('/api/forums/f-rating/threads', { title: 'Rate my look', content: 'be kind' }); await carol.post('/api/threads/' + r.body.thread.id + '/posts', { content: 'Looks great!', rating: 8 }); return r.body; };
  const t1 = await mk(plain);
  const d1 = await plain.del('/api/threads/' + t1.thread.id, {});
  assert.equal(d1.status, 403);
  assert.equal(d1.body.error.code, 'vip_required');
  assert.equal((await plain.del('/api/posts/' + t1.postId, {})).status, 403, 'deleting the first post is the same as deleting the thread');
  // Without replies it's allowed for everyone.
  const t0 = await plain.post('/api/forums/f-rating/threads', { title: 'No replies yet', content: 'x' });
  assert.equal((await plain.del('/api/threads/' + t0.body.thread.id, {})).status, 200);
  // VIP (dave) can delete his own rating thread with replies…
  const t2 = await mk(dave);
  assert.equal((await dave.del('/api/threads/' + t2.thread.id, {})).status, 200);
  // …but not someone else's.
  const t3 = await mk(plain);
  assert.equal((await dave.del('/api/threads/' + t3.thread.id, {})).status, 403);
  assert.equal((await dave.del('/api/posts/' + t3.postId, {})).status, 403);
  // Normal forums are unaffected.
  const t4 = await plain.post('/api/forums/f-skin/threads', { title: 'Normal thread', content: 'x' });
  await carol.post('/api/threads/' + t4.body.thread.id + '/posts', { content: 'reply' });
  assert.equal((await plain.del('/api/threads/' + t4.body.thread.id, {})).status, 200);
});

test('username changes and vanity URLs: VIP only, with server-side cooldowns', async () => {
  const plain = await member({ username: 'renamer' });
  assert.equal((await plain.post('/api/account/username', { username: 'renamed', password: plain.password })).status, 403);
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'renamer-page' })).status, 403);
  await grantWallet(plain, 'vip');
  assert.equal((await plain.post('/api/account/username', { username: 'renamed', password: 'wrong password' })).status, 403);
  assert.equal((await plain.post('/api/account/username', { username: 'alice', password: plain.password })).status, 409, 'taken');
  assert.equal((await plain.post('/api/account/username', { username: 'renamed', password: plain.password })).status, 200);
  const again = await plain.post('/api/account/username', { username: 'renamed2', password: plain.password });
  assert.equal(again.status, 429, 'cooldown');
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'account.username_change' AND details->>'to' = 'renamed'"));
  // Cooldown expires after 30 days.
  await db.query("UPDATE users SET username_changed_at = now() - interval '31 days' WHERE id = $1", [plain.user.id]);
  assert.equal((await plain.post('/api/account/username', { username: 'renamed2', password: plain.password })).status, 200);
  // Vanity URL.
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'admin' })).status, 422, 'reserved');
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'bob' })).status, 409, 'another member\'s username');
  assert.equal((await plain.put('/api/account/vanity', { vanity: '<b>x' })).status, 422);
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'jane-glow' })).status, 200);
  assert.equal((await guest.get('/api/members/by-vanity/jane-glow')).body.id, String(plain.user.id));
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'jane-glow2' })).status, 429);
  // Removing doesn't reset the cooldown.
  assert.equal((await plain.put('/api/account/vanity', { vanity: '' })).status, 200);
  assert.equal((await plain.put('/api/account/vanity', { vanity: 'jane-glow3' })).status, 429);
  await db.query("UPDATE profiles SET vanity = 'jane-glow' WHERE user_id = $1", [plain.user.id]);
  // When VIP ends, the vanity URL stops resolving.
  await clearVip(plain);
  assert.equal((await guest.get('/api/members/by-vanity/jane-glow')).status, 404);
});

/* ---------- VIP forum & Private Ratings ---------- */

test('VIP Supporters forum: only active VIPs and staff can view, search, post or reply', async () => {
  const plain = await member({ username: 'outsider' });
  const t = await dave.post('/api/forums/f-vip/threads', { title: 'Secret VIP lounge', content: 'hello supporters @outsider' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  for (const c of [plain, guest]) {
    assert.ok(!(await c.get('/api/forums')).body.forums.some((f) => f.id === 'f-vip'));
    assert.equal((await c.get('/api/forums/f-vip')).status, 404);
    assert.equal((await c.get('/api/threads/' + t.body.thread.id)).status, 404);
    assert.equal((await c.post('/api/threads/' + t.body.thread.id + '/posts', { content: 'let me in' })).status, c === guest ? 401 : 404);
    const s = await c.get('/api/search?q=lounge');
    assert.ok(!JSON.stringify(s.body).includes('Secret VIP lounge'));
    const wn = await c.get('/api/whats-new/posts');
    assert.ok(!JSON.stringify(wn.body).includes('Secret VIP lounge'));
  }
  assert.equal((await plain.post('/api/forums/f-vip/threads', { title: 'Sneaky thread', content: 'x' })).status, 404);
  // Mentions don't leak the thread to people who can't open it.
  assert.equal((await db.one("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type IN ('mention', 'quote', 'reply', 'follow-thread')", [plain.user.id])).n, 0);
  // Staff keep access without VIP.
  assert.equal((await mod.get('/api/threads/' + t.body.thread.id)).status, 200);
  assert.equal((await admin.get('/api/forums/f-vip')).status, 200);
  // VIP members can reply.
  assert.equal((await alice.post('/api/threads/' + t.body.thread.id + '/posts', { content: 'Hi!' })).status, 201);
});

test('expired memberships lose every entitlement immediately; history is kept', async () => {
  const t = await dave.post('/api/forums/f-vip/threads', { title: 'Before expiry', content: 'x' });
  await db.query("UPDATE vip_memberships SET expiration_date = now() - interval '1 minute' WHERE user_id = $1 AND NOT lifetime", [dave.user.id]);
  const e = await ent(dave);
  assert.equal(e.active, false);
  assert.equal((await dave.get('/api/threads/' + t.body.thread.id)).status, 404, 'VIP forum access removed');
  assert.equal((await bob.get('/api/members/' + dave.user.id)).body.user.vip, null, 'styling removed');
  assert.equal((await dave.put('/api/posts/' + t.body.postId + '/reaction', { reaction: 'fire' })).status, 404);
  const n = await vip.expireMemberships();
  assert.ok(n >= 1);
  assert.ok(await db.one("SELECT 1 FROM vip_memberships WHERE user_id = $1 AND status = 'expired'", [dave.user.id]), 'records kept');
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.expire'"));
  // Lifetime members are untouched.
  assert.equal((await ent(alice)).active, true);
  const hist = (await dave.get('/api/vip/me')).body.memberships;
  assert.ok(hist.some((m) => m.status === 'expired'));
});

test('Private Ratings: exists once under Ratings, hidden from guests everywhere, visible to members and staff', async () => {
  const rows = await db.many("SELECT id, parent_id, members_only FROM forums WHERE title = 'Private Ratings'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'f-private-rating');
  assert.equal(rows[0].parent_id, 'f-rating');
  assert.equal(rows[0].members_only, true);
  const t = await bob.post('/api/forums/f-private-rating/threads', { title: 'Private glowup pics', content: 'members only please' });
  assert.equal(t.status, 201);
  assert.ok(!(await guest.get('/api/forums')).body.forums.some((f) => f.id === 'f-private-rating'), 'not in the forum index');
  assert.ok(!(await guest.get('/api/forums/f-rating')).body.subforums.some((f) => f.id === 'f-private-rating'), 'not listed under Ratings');
  assert.equal((await guest.get('/api/forums/f-private-rating')).status, 404);
  assert.equal((await guest.get('/api/threads/' + t.body.thread.id)).status, 404);
  assert.ok(!JSON.stringify((await guest.get('/api/search?q=glowup')).body).includes('Private glowup pics'), 'not in search');
  assert.ok(!JSON.stringify((await guest.get('/api/whats-new/posts')).body).includes('Private glowup pics'));
  assert.ok(!JSON.stringify((await guest.get('/api/widgets/sidebar')).body).includes('Private glowup pics'));
  const plain = await member({ username: 'viewer' });
  assert.ok((await plain.get('/api/forums')).body.forums.some((f) => f.id === 'f-private-rating'));
  assert.equal((await plain.get('/api/threads/' + t.body.thread.id)).status, 200);
  assert.equal((await mod.get('/api/threads/' + t.body.thread.id)).status, 200);
  assert.equal((await admin.get('/api/forums/f-private-rating')).status, 200);
});

/* ---------- admin ---------- */

test('admin: grant, extend, revoke, price changes and refunds are enforced and audit-logged', async () => {
  const target = await member({ username: 'lucky' });
  assert.equal((await alice.post('/api/admin/vip/memberships', { username: 'lucky', product: 'vip' })).status, 403);
  const g = await admin.post('/api/admin/vip/memberships', { username: 'lucky', product: 'vip-plus', days: 10, note: 'contest winner', avatarFrame: 'red' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  let e = await ent(target);
  assert.equal(e.active, true);
  assert.ok(new Date(e.expiresAt) < new Date(Date.now() + 11 * 86400000));
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.admin_grant' AND actor_id = $1", [admin.user.id]));
  const ext = await admin.post('/api/admin/vip/memberships/' + g.body.membershipId + '/extend', { days: 30 });
  assert.equal(ext.status, 200);
  assert.ok(new Date(ext.body.expiresAt) > new Date(Date.now() + 39 * 86400000));
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.admin_extend'"));
  const list = await admin.get('/api/admin/vip/memberships?q=luck');
  assert.equal(list.body.memberships[0].userId, String(target.user.id));
  assert.equal((await admin.post('/api/admin/vip/memberships/' + g.body.membershipId + '/revoke', { reason: 'test' })).status, 200);
  e = await ent(target);
  assert.equal(e.active, false);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.admin_revoke'"));
  assert.ok(await db.one("SELECT 1 FROM vip_memberships WHERE id = $1 AND status = 'cancelled'", [g.body.membershipId]), 'history kept');
  // Lifetime memberships can't be "extended".
  const lifetime = await db.one("SELECT id FROM vip_memberships WHERE user_id = $1 AND lifetime AND status = 'active' LIMIT 1", [alice.user.id]);
  assert.equal((await admin.post('/api/admin/vip/memberships/' + lifetime.id + '/extend', { days: 5 })).status, 409);
  // Price change (and annual pricing) apply to new quotes; audit keeps before/after.
  assert.equal((await admin.patch('/api/admin/vip/products/lifetime-vip-plus', { priceCents: 19999 })).status, 200);
  assert.equal((await admin.patch('/api/admin/vip/products/vip', { annualPriceCents: 8000 })).status, 200);
  assert.equal((await admin.patch('/api/admin/vip/products/lifetime-vip', { annualPriceCents: 1000 })).status, 422);
  assert.equal((await admin.patch('/api/admin/vip/products/vip', { priceCents: -5 })).status, 422);
  const q1 = await target.post('/api/vip/quote', { product: 'lifetime-vip-plus', billing: 'lifetime', options: { avatarFrame: 'red' } });
  assert.equal(q1.body.amountCents, 19999);
  const q2 = await target.post('/api/vip/quote', { product: 'vip', billing: 'year' });
  assert.equal(q2.body.amountCents, 8000);
  const au = await db.one("SELECT details FROM audit_log WHERE action = 'vip.product_update' AND target_id = 'lifetime-vip-plus'");
  assert.equal(au.details.before.priceCents, 10800);
  assert.equal(au.details.after.priceCents, 19999);
  await admin.patch('/api/admin/vip/products/lifetime-vip-plus', { priceCents: 10800 });
  // Refund a wallet purchase: money back, entitlement removed.
  const o = await grantWallet(target, 'vip');
  const before = Number((await db.one('SELECT balance_cents FROM user_wallets WHERE user_id = $1', [target.user.id])).balance_cents);
  assert.equal((await admin.post('/api/admin/vip/orders/' + o.id + '/refund', { reason: 'requested' })).status, 200);
  assert.equal(Number((await db.one('SELECT balance_cents FROM user_wallets WHERE user_id = $1', [target.user.id])).balance_cents), before + 800);
  assert.equal((await ent(target)).active, false);
  assert.equal((await admin.post('/api/admin/vip/orders/' + o.id + '/refund', { reason: 'again' })).status, 409);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.refund' AND target_id = $1", [o.id]));
  // Card refunds go through Stripe.
  const paidCard = await db.one("SELECT public_id FROM vip_orders WHERE provider = 'stripe' AND status = 'paid' LIMIT 1");
  assert.equal((await admin.post('/api/admin/vip/orders/' + paidCard.public_id + '/refund', { reason: 'chargeback risk' })).status, 200);
  assert.ok(stub.refunds.length >= 1);
  // Payment listings by status.
  for (const s of ['paid', 'pending', 'failed', 'refunded']) assert.equal((await admin.get('/api/admin/vip/orders?status=' + s)).status, 200);
  const gifts = await admin.get('/api/admin/vip/orders?gift=1');
  assert.ok(gifts.body.orders.every((x) => x.kind === 'gift') && gifts.body.orders.length >= 1);
  // Payment methods can be switched off.
  assert.equal((await admin.patch('/api/admin/vip/settings', { paymentMethods: { crypto: false } })).status, 200);
  const cat = await target.get('/api/vip/catalog');
  assert.equal(cat.body.paymentMethods.find((m) => m.id === 'crypto').available, false);
  assert.equal((await buy(target, { product: 'vip', paymentMethod: 'crypto' })).status, 409);
  // Wallet adjustments are audited.
  assert.equal((await admin.post('/api/admin/vip/wallets', { username: 'lucky', amountCents: 500, reason: 'goodwill' })).status, 200);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'vip.wallet_adjust'"));
  // Cosmetics: new frame becomes selectable once added to a package.
  assert.equal((await admin.post('/api/admin/vip/frames', { id: 'pink', name: 'Pink', hex: '#EC4899' })).status, 201);
  assert.equal((await admin.post('/api/admin/vip/colors', { id: 'bad', name: 'Bad', hex1: 'red' })).status, 422);
});

test('checkout never trusts a request to make the purchaser VIP through other accounts\' orders', async () => {
  // Someone else's order can't be cancelled, viewed or verified.
  const r = await buy(bob, { product: 'vip', paymentMethod: 'card' });
  for (const [m, suffix] of [['get', ''], ['post', '/verify'], ['post', '/cancel']]) {
    assert.equal((await carol[m]('/api/vip/orders/' + r.body.order.id + suffix)).status, 404);
  }
  assert.equal((await carol.get('/api/vip/orders/not-a-uuid')).status, 404);
  // Webhook for an unknown provider id does nothing.
  const x = await stripeWebhook({ id: 'evt_unknown', type: 'checkout.session.completed', data: { object: { id: 'cs_nope', client_reference_id: crypto.randomUUID(), payment_status: 'paid', payment_intent: 'pi_z', amount_total: 800, currency: 'usd' } } });
  assert.equal(x.body.result, 'unknown_order');
  assert.equal((await request(getApp()).post('/api/payments/webhooks/wallet').send('{}')).status, 404, 'no webhook for the internal wallet');
});

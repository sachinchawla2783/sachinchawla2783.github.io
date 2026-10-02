/* VIP pages: pricing, checkout, gifting, payment return, account membership, purchases and admin.
 * Everything shown here comes from the server. Prices are displayed, never sent: the checkout request
 * names a package, billing period, payment method and cosmetic choices, and the server works out the
 * price, validates every choice and grants nothing until the payment is confirmed server-side. */
(function () {
  'use strict';
  const PP = window.PP;
  const { api, esc, ui, fullDate, time } = PP;
  const { toast, modal, closeModal, confirmBox } = ui;
  const me = () => PP.session.user;
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const money = (cents, cur) => {
    if (cents == null) return '';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD' }).format(cents / 100); } catch (e) { return '$' + (cents / 100).toFixed(2); }
  };
  const METHOD_ICON = { card: '💳', paypal: '🅿️', wallet: '👛', crypto: '🪙' };
  const STATUS_LABEL = { pending: 'Pending', paid: 'Paid', failed: 'Failed', refunded: 'Refunded', cancelled: 'Cancelled', active: 'Active', expired: 'Expired' };
  const statusBadge = (s) => '<span class="vip-status vip-status--' + esc(s) + '">' + esc(STATUS_LABEL[s] || s) + '</span>';
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

  /* A navigation can race the initial session load; wait for it before deciding who the viewer is. */
  async function sessionReady() { if (!PP.session.loaded) { try { await api.loadSession(); } catch (e) { /* treated as logged out */ } } return me(); }

  /* Logged-out visitors never see VIP pages: they go straight to the login page and come back afterwards. */
  function needLogin(ret) {
    location.replace('#/login?return=' + encodeURIComponent(ret));
    return { title: 'Log in', html: '' };
  }

  const swatch = (c) => {
    if (!c || !HEX.test(c.hex1 || c.hex || '')) return '';
    const bg = c.hex2 && HEX.test(c.hex2) ? 'linear-gradient(135deg,' + c.hex1 + ',' + c.hex2 + ')' : (c.hex1 || c.hex);
    return '<span class="vip-swatch" style="background:' + bg + '" title="' + esc(c.name || '') + '"></span>';
  };
  const colorText = (c, text) => {
    if (!c || !HEX.test(c.hex1 || '')) return esc(text);
    return c.hex2 && HEX.test(c.hex2) ? '<span class="username--gradient" style="--c1:' + c.hex1 + ';--c2:' + c.hex2 + '">' + esc(text) + '</span>' : '<span style="color:' + c.hex1 + '">' + esc(text) + '</span>';
  };

  function priceHtml(p) {
    if (p.lifetime) return '<div class="vip-price">' + money(p.priceCents, p.currency) + '<small> one-time</small></div><div class="small muted">Lifetime · pay once</div>';
    return '<div class="vip-price">' + money(p.priceCents, p.currency) + '<small>/month</small></div>' +
      '<div class="small muted">' + (p.annualPriceCents ? 'or ' + money(p.annualPriceCents, p.currency) + ' for 12 months · ' : '') + 'No automatic renewal</div>';
  }

  /* How a package relates to what the member already owns (mirrors the server's rules for display only). */
  function relation(p, status, products) {
    const owned = status.active ? status.products : [];
    if (owned.includes(p.slug) && p.lifetime) return 'owned';
    if (owned.some((s) => { const o = products.find((x) => x.slug === s); return o && o.supersedes.includes(p.slug); })) return 'included';
    if (owned.some((s) => p.supersedes.includes(s))) return 'upgrade';
    if (owned.includes(p.slug)) return 'renew';
    return 'new';
  }

  function methodsHtml(methods) {
    return '<div class="vip-methods">' + methods.map((m) => '<span class="vip-method' + (m.available ? '' : ' vip-method--off') + '" title="' + (m.available ? 'Available' : 'Not available yet') + '">' + (METHOD_ICON[m.id] || '') + ' ' + esc(m.label) + '</span>').join('') + '</div>';
  }

  function card(p, d, featured) {
    const rel = relation(p, d.status, d.products);
    const colors = d.colors.filter((c) => p.allowedUsernameColors.includes(c.id));
    const frames = d.frames.filter((f) => p.availableAvatarFrames.includes(f.id));
    const buy = rel === 'owned' ? '<span class="btn" aria-disabled="true">✓ You own this</span>'
      : rel === 'included' ? '<span class="btn" aria-disabled="true">✓ Included in your membership</span>'
        : '<a class="btn btn-primary" href="#/vip/checkout/' + esc(p.slug) + '">' + (rel === 'upgrade' ? '⬆ Upgrade' : rel === 'renew' ? '↻ Extend' : 'Purchase') + '</a>';
    return '<article class="block vip-card' + (p.lifetime ? ' vip-card--lifetime' : '') + (featured ? ' vip-card--featured' : '') + '" data-product="' + esc(p.slug) + '">' +
      (featured ? '<div class="vip-featured-tag">★ Ultimate package</div>' : '') +
      '<header class="vip-card-head"><h2>👑 ' + esc(p.name) + '</h2>' + (p.lifetime ? '<span class="vip-ribbon">Lifetime</span>' : '<span class="vip-ribbon vip-ribbon--month">Monthly</span>') + '</header>' +
      '<div class="block-body">' + priceHtml(p) +
      (p.description ? '<p class="small muted">' + esc(p.description) + '</p>' : '') +
      p.notes.map((n) => '<div class="vip-note">' + esc(n) + '</div>').join('') +
      '<ul class="vip-benefits">' + p.benefits.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' +
      (colors.length ? '<div class="vip-row"><span class="small muted">Username colors</span><span>' + colors.map(swatch).join('') + (p.exclusiveColors ? ' <span class="small muted">+ lifetime exclusives</span>' : '') + '</span></div>' : '') +
      (frames.length ? '<div class="vip-row"><span class="small muted">Avatar frames' + (p.requiresAvatarFrame ? ' (choose one)' : '') + '</span><span>' + frames.map((f) => swatch({ hex1: f.hex, name: f.name })).join('') + '</span></div>' : '') +
      '<div class="vip-actions">' + buy + ' <a class="btn" href="#/vip/gift/' + esc(p.slug) + '">🎁 Gift</a></div>' +
      '</div></article>';
  }

  function statusPanel(d) {
    const s = d.status;
    if (!s.active) return '';
    const st = s.style || {};
    const upgrades = d.products.filter((p) => relation(p, s, d.products) === 'upgrade');
    const u = me();
    return '<section class="block vip-status-panel"><h2 class="block-head">Your membership</h2><div class="block-body">' +
      '<dl class="pairs pairs--row">' +
      '<div><dt>Current plan</dt><dd>👑 ' + esc(s.top.name) + '</dd></div>' +
      '<div><dt>Status</dt><dd>' + (s.lifetime ? 'Lifetime' : 'Active') + '</dd></div>' +
      '<div><dt>Expires</dt><dd>' + (s.lifetime ? 'Never (Lifetime)' : esc(fullDate(s.expiresAt))) + '</dd></div>' +
      '<div><dt>Avatar frame</dt><dd>' + (st.frame ? swatch({ hex1: st.frame }) : '<span class="muted">None</span>') + '</dd></div>' +
      '<div><dt>Username</dt><dd>' + colorText(st.color, u.username) + ui.verifiedBadge({ vip: st }) + '</dd></div></dl>' +
      (upgrades.length ? '<p class="small">Upgrade options: ' + upgrades.map((p) => '<a href="#/vip/checkout/' + esc(p.slug) + '">' + esc(p.name) + '</a>').join(' · ') + '</p>' : '') +
      '<div class="form-actions"><a class="btn" href="#/account/vip">Manage membership</a> <a class="btn" href="#/account/purchases">Purchase history</a></div></div></section>';
  }

  /* Monthly and lifetime packages in their own rows; the highest tier is highlighted. */
  function vipSections(d) {
    const top = d.products.reduce((a, p) => (!a || p.tierRank > a.tierRank ? p : a), null);
    const group = (title, sub, list) => (list.length ? '<section class="vip-section"><div class="vip-section-head"><h2>' + title + '</h2><span class="small muted">' + sub + '</span></div>' +
      '<div class="vip-grid">' + list.map((p) => card(p, d, top && p.slug === top.slug)).join('') + '</div></section>' : '');
    return group('Monthly', 'One-time payment for a month. No auto-renewal.', d.products.filter((p) => !p.lifetime)) +
      group('Lifetime', 'Pay once, keep it forever.', d.products.filter((p) => p.lifetime));
  }

  /* ---------- /vip ---------- */

  async function page() {
    if (!(await sessionReady())) return needLogin('#/vip');
    const d = await api.get('/vip/catalog');
    const html = '<div class="page-head"><h1>👑 PinkPill VIP</h1><p class="muted">Support PinkPill and unlock extra features. Every package is enforced by the server the moment your payment is confirmed.</p></div>' +
      statusPanel(d) +
      (d.paymentMethods.some((m) => m.available) ? '' : '<div class="notice">Payments aren\'t set up on this site yet, so packages can\'t be purchased right now.</div>') +
      vipSections(d) +
      '<div class="vip-row vip-row--methods vip-methods-line"><span class="small muted">Payment methods</span>' + methodsHtml(d.paymentMethods) + '</div>' +
      '<p class="small muted">Monthly packages are one-time payments for one month (or 12 months where annual pricing is offered). They don\'t renew automatically. Wallet balance: <b>' + money(d.walletCents) + '</b>.</p>';
    return { title: 'VIP', html };
  }

  /* ---------- /vip/checkout/:slug and /vip/gift/:slug ---------- */

  async function checkout([mode, slug], q) {
    if (!(await sessionReady())) return needLogin('#/vip/' + mode + '/' + slug);
    const d = await api.get('/vip/catalog');
    const p = d.products.find((x) => x.slug === slug);
    if (!p) return PP.views.errorView('This VIP package is not available.');
    const gift = mode === 'gift';
    PP.vipCheckout = { catalog: d, product: p, gift };
    const colors = d.colors.filter((c) => p.allowedUsernameColors.includes(c.id) || (p.exclusiveColors && c.lifetimeExclusive));
    const frames = d.frames.filter((f) => p.availableAvatarFrames.includes(f.id));
    const radio = (name, value, label, checked, extra) => '<label class="vip-choice"><input type="radio" name="' + name + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + (extra || '') + '> ' + label + '</label>';
    let h = ui.breadcrumb([['#/vip', 'VIP'], ['', (gift ? 'Gift ' : 'Buy ') + p.name]]) +
      '<div class="page-head"><h1>' + (gift ? '🎁 Gift ' : '👑 ') + esc(p.name) + '</h1><p class="muted">' + esc(p.description) + '</p></div>' +
      p.notes.map((n) => '<div class="notice notice--vip">' + esc(n) + '</div>').join('') +
      '<form class="block form vip-checkout" data-vip-form="checkout" data-product="' + esc(p.slug) + '"' + (gift ? ' data-gift="1"' : '') + '><div class="block-body">';
    if (gift) {
      h += '<fieldset class="vip-fieldset"><legend>1. Who is it for?</legend><label class="field"><span>Member\'s username</span><input name="giftTo" required maxlength="24" autocomplete="off" list="vip-gift-names" data-lookup value="' + esc(q.get('to') || '') + '"><datalist id="vip-gift-names"></datalist></label>' +
        '<div data-recipient class="small muted">The membership goes to this member only after your payment is confirmed. You can\'t gift to yourself.</div></fieldset>';
    }
    h += '<fieldset class="vip-fieldset"><legend>' + (gift ? '2' : '1') + '. Billing</legend>' +
      (p.lifetime ? radio('billing', 'lifetime', 'Lifetime — ' + money(p.priceCents, p.currency) + ' once', true)
        : radio('billing', 'month', '1 month — ' + money(p.priceCents, p.currency), true) + (p.annualPriceCents ? radio('billing', 'year', '12 months — ' + money(p.annualPriceCents, p.currency), false) : '')) +
      '</fieldset>';
    if (frames.length || colors.length || p.customUsernameColor || p.customUsernameEffects) {
      h += '<fieldset class="vip-fieldset"><legend>' + (gift ? '3' : '2') + '. Style</legend>';
      if (frames.length) h += '<div class="field"><span>Avatar frame' + (p.requiresAvatarFrame ? ' <b>(required)</b>' : '') + '</span><div class="vip-choices">' + (p.requiresAvatarFrame ? '' : radio('avatarFrame', '', 'None', true)) + frames.map((f) => radio('avatarFrame', f.id, swatch({ hex1: f.hex, name: f.name }) + ' ' + esc(f.name), false, p.requiresAvatarFrame ? ' required' : '')).join('') + '</div></div>';
      if (colors.length) h += '<div class="field"><span>Username color</span><div class="vip-choices">' + radio('usernameColor', '', 'Default', true) + colors.map((c) => radio('usernameColor', c.id, swatch(c) + ' ' + colorText(c, c.name) + (c.lifetimeExclusive ? ' <span class="badge badge--vip">Lifetime exclusive</span>' : ''), false)).join('') + '</div></div>';
      if (p.customUsernameColor) h += '<div class="field"><span>Custom username color <span class="small muted">(optional now — you can pick it after purchase)</span></span><div class="row"><label class="check"><input type="checkbox" name="useCustom"> Use a custom color</label><input type="color" name="customColor" value="#ec4899"></div></div>';
      if (p.customUsernameEffects) h += '<label class="field"><span>Username text effect</span><select name="customEffect"><option value="">None</option>' + d.effects.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('') + '</select></label>';
      h += '<div class="vip-preview small">Preview: <span data-vip-preview>' + esc(me().username) + '</span></div></fieldset>';
    }
    h += '<fieldset class="vip-fieldset"><legend>Payment method</legend><div class="vip-choices vip-choices--methods">' +
      d.paymentMethods.map((m, i) => radio('paymentMethod', m.id, (METHOD_ICON[m.id] || '') + ' ' + esc(m.label) + (m.id === 'wallet' ? ' <span class="small muted">(balance ' + money(d.walletCents) + ')</span>' : '') + (m.available ? '' : ' <span class="small muted">— not available yet</span>'), m.available && !d.paymentMethods.slice(0, i).some((x) => x.available), m.available ? '' : ' disabled')).join('') +
      '</div></fieldset>' +
      '<div data-review></div>' +
      '<div class="form-actions"><button class="btn btn-primary" data-step="review">Review order</button> <a class="btn" href="#/vip">Back</a></div>' +
      '</div></form>';
    return { title: (gift ? 'Gift ' : 'Buy ') + p.name, html: h, after: () => updatePreview(document.querySelector('[data-vip-form="checkout"]')) };
  }

  function checkoutBody(f) {
    const fd = new FormData(f);
    const g = (k) => { const v = fd.get(k); return v == null || v === '' ? undefined : String(v); };
    const options = {};
    if (g('avatarFrame')) options.avatarFrame = g('avatarFrame');
    if (g('usernameColor')) options.usernameColor = g('usernameColor');
    if (fd.get('useCustom') && HEX.test(g('customColor') || '')) options.customColor = g('customColor');
    if (g('customEffect')) options.customEffect = g('customEffect');
    const body = { product: f.dataset.product, billing: g('billing'), options };
    if (f.dataset.gift) body.giftTo = (g('giftTo') || '').trim();
    if (g('paymentMethod')) body.paymentMethod = g('paymentMethod');
    return body;
  }

  function updatePreview(f) {
    if (!f) return;
    const el = f.querySelector('[data-vip-preview]');
    if (!el || !PP.vipCheckout) return;
    const fd = new FormData(f);
    const cat = PP.vipCheckout.catalog;
    let c = cat.colors.find((x) => x.id === fd.get('usernameColor')) || null;
    if (fd.get('useCustom') && HEX.test(String(fd.get('customColor') || ''))) c = { hex1: String(fd.get('customColor')) };
    const fx = String(fd.get('customEffect') || '');
    const name = f.dataset.gift ? (String(fd.get('giftTo') || '').trim() || 'Member') : me().username;
    el.className = 'username username--vip' + (c && c.hex2 ? ' username--gradient' : '') + (/^(glow|shimmer|sparkle|outline)$/.test(fx) ? ' vipfx vipfx--' + fx : '');
    el.setAttribute('style', c ? (c.hex2 ? '--c1:' + c.hex1 + ';--c2:' + c.hex2 : 'color:' + c.hex1) : '');
    el.textContent = name;
  }

  async function reviewOrder(f) {
    const body = checkoutBody(f);
    if (!body.paymentMethod) throw new Error('Please choose an available payment method.');
    const r = await api.post('/vip/quote', body);
    const m = r.paymentMethods.find((x) => x.id === body.paymentMethod) || {};
    const kindText = { upgrade: 'This is an upgrade. Your current package keeps running until it ends; there is no pro-rated credit.', renewal: 'This adds time after your current period ends.', gift: 'This is a gift.', purchase: '' }[r.kind] || '';
    f.querySelector('[data-review]').innerHTML = '<section class="vip-review"><h3>Order summary</h3><dl class="pairs">' +
      '<div><dt>Package</dt><dd>' + esc(r.product.name) + '</dd></div>' +
      '<div><dt>Billing</dt><dd>' + esc({ month: '1 month', year: '12 months', lifetime: 'Lifetime (one-time)' }[r.billing]) + '</dd></div>' +
      (r.recipient ? '<div><dt>Recipient</dt><dd>' + ui.username(r.recipient) + '</dd></div>' : '') +
      '<div><dt>Payment method</dt><dd>' + (METHOD_ICON[body.paymentMethod] || '') + ' ' + esc(m.label || body.paymentMethod) + '</dd></div>' +
      '<div class="vip-total"><dt>Total</dt><dd>' + money(r.amountCents, r.currency) + '</dd></div></dl>' +
      (kindText ? '<p class="small muted">' + esc(kindText) + '</p>' : '') +
      (body.paymentMethod === 'wallet' && m.sufficient === false ? '<div class="notice notice--error">Your wallet balance (' + money(r.walletCents) + ') is too low for this purchase.</div>' : '') +
      '<label class="check"><input type="checkbox" name="confirm" required> I confirm this purchase of ' + money(r.amountCents, r.currency) + (r.recipient ? ' for ' + esc(r.recipient.username) : '') + '.</label></section>';
    f.dataset.quoted = JSON.stringify(body);
    f.dataset.idem = f.dataset.idem || uuid();
    const btn = f.querySelector('[data-step]');
    btn.dataset.step = 'pay'; btn.textContent = 'Confirm and pay ' + money(r.amountCents, r.currency);
  }

  async function pay(f) {
    if (!f.querySelector('input[name=confirm]:checked')) throw new Error('Please tick the box to confirm your purchase.');
    const body = Object.assign(JSON.parse(f.dataset.quoted), { confirm: true, idempotencyKey: f.dataset.idem });
    const r = await api.post('/vip/checkout', body);
    if (r.redirectUrl) {
      if (!/^https:\/\//.test(r.redirectUrl)) throw new Error('Unexpected payment page address.');
      toast('Taking you to the secure payment page…');
      location.href = r.redirectUrl;
      return;
    }
    PP.app.go('#/vip/return?order=' + encodeURIComponent(r.order.id));
  }

  /* ---------- /vip/return ---------- */

  async function returned(_, q) {
    const id = q.get('order') || '';
    if (!(await sessionReady())) return needLogin('#/vip/return?order=' + id);
    if (!/^[0-9a-f-]{36}$/.test(id)) return PP.views.errorView('Order not found.');
    let o;
    if (q.get('cancelled')) {
      await api.post('/vip/orders/' + id + '/cancel');
      o = (await api.get('/vip/orders/' + id)).order;
    } else {
      o = (await api.post('/vip/orders/' + id + '/verify')).order;
    }
    let body;
    if (o.status === 'paid') {
      await api.loadSession();
      body = '<div class="vip-confirm">🎉</div><h2>Thank you!</h2><p>' + (o.recipient ? 'Your gift of <b>' + esc(o.product.name) + '</b> to ' + ui.username(o.recipient) + ' is confirmed. They\'ve been notified.' : 'Your <b>' + esc(o.product.name) + '</b> membership is active.') + '</p>' +
        '<dl class="pairs"><div><dt>Order</dt><dd class="small">' + esc(o.id) + '</dd></div><div><dt>Amount</dt><dd>' + money(o.amountCents, o.currency) + '</dd></div><div><dt>Paid</dt><dd>' + time(o.paidAt) + '</dd></div></dl>' +
        '<div class="form-actions">' + (o.recipient ? '' : '<a class="btn btn-primary" href="#/account/vip">Set up your VIP style</a> ') + '<a class="btn" href="#/forums/f-vip">Visit VIP Supporters</a> <a class="btn" href="#/account/purchases">Purchase history</a></div>';
    } else if (o.status === 'pending') {
      body = '<h2>Payment pending</h2><p>We haven\'t received confirmation from the payment provider yet. Your membership activates automatically as soon as the payment is confirmed (crypto payments can take a while).</p><div class="form-actions"><button class="btn btn-primary" data-act="retry">Check again</button> <a class="btn" href="#/account/purchases">Purchase history</a></div>';
    } else if (o.status === 'cancelled') {
      body = '<h2>Checkout cancelled</h2><p>You have not been charged.</p><div class="form-actions"><a class="btn btn-primary" href="#/vip">Back to VIP</a></div>';
    } else {
      body = '<h2>Payment failed</h2><p>' + esc(o.failure || 'The payment did not go through.') + ' You have not been given VIP for this order.</p><div class="form-actions"><a class="btn btn-primary" href="#/vip">Try again</a></div>';
    }
    return { title: 'VIP purchase', html: ui.breadcrumb([['#/vip', 'VIP'], ['', 'Purchase']]) + '<section class="block"><div class="block-body vip-result">' + body + '</div></section>' };
  }

  /* ---------- /u/:vanity ---------- */

  async function vanity([slug]) {
    const r = await api.get('/members/by-vanity/' + encodeURIComponent(slug.toLowerCase()));
    location.replace('#/members/' + r.id);
    return { title: 'Loading', html: '' };
  }

  /* ---------- account: VIP membership ---------- */

  async function accountVip() {
    const [d, cat] = await Promise.all([api.get('/vip/me'), api.get('/vip/catalog')]);
    const s = d.status, st = s.style || {};
    const colorById = Object.fromEntries(cat.colors.map((c) => [c.id, c]));
    const frameById = Object.fromEntries(cat.frames.map((f) => [f.id, f]));
    let h = '';
    if (!s.active) {
      h += '<section class="block"><div class="block-body"><p>You don\'t have an active VIP membership.</p><a class="btn btn-primary" href="#/vip">See VIP packages</a></div></section>';
    } else {
      const perks = [];
      if (s.noAds) perks.push('No ads');
      if (s.vipForum) perks.push('<a href="#/forums/f-vip">VIP Supporters forum</a>');
      if (s.conversationLimit) perks.push('Conversations with up to ' + s.conversationLimit + ' people');
      if (s.editWindowMinutes) perks.push(Math.round(s.editWindowMinutes / 60) + '-hour post-editing window');
      if (s.ratingsDelete) perks.push('Delete your own Ratings threads without restrictions');
      if (s.usernameCooldownDays) perks.push('Change your username every ' + s.usernameCooldownDays + ' days');
      if (s.vanityCooldownDays) perks.push('Vanity profile URL (changeable every ' + s.vanityCooldownDays + ' days)');
      if (s.customReactions) perks.push('Custom reactions ' + PP.VIP_REACTIONS.map((r) => r.emoji).join(''));
      if (s.verifiedBadge) perks.push('Lifetime verified badge ' + ui.verifiedBadge({ vip: { badge: true } }));
      if (s.customColor) perks.push('Custom username color');
      if (s.customEffects) perks.push('Custom username text effects');
      if (s.customFrame) perks.push('Custom avatar frame color');
      h += '<section class="block"><h3 class="block-head">Current membership</h3><div class="block-body"><dl class="pairs">' +
        '<div><dt>Package</dt><dd>👑 ' + esc(s.top.name) + (s.products.length > 1 ? ' <span class="small muted">(+ ' + (s.products.length - 1) + ' more)</span>' : '') + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + statusBadge('active') + '</dd></div>' +
        '<div><dt>Expires</dt><dd>' + (s.lifetime ? '<b>Lifetime</b>' : esc(fullDate(s.expiresAt))) + '</dd></div>' +
        '<div><dt>Username</dt><dd>' + ui.username(me()) + '</dd></div></dl>' +
        '<h4>Your benefits</h4><ul class="vip-benefits">' + perks.map((p) => '<li>' + p + '</li>').join('') + '</ul></div></section>';

      h += '<form class="block form" data-vip-form="style"><h3 class="block-head">VIP style</h3><div class="block-body">' +
        (s.colors.length ? '<label class="field"><span>Username color</span><select name="usernameColor"><option value="">Default</option>' + s.colors.map((id) => '<option value="' + esc(id) + '"' + (s.prefs.usernameColor === id ? ' selected' : '') + '>' + esc((colorById[id] || { name: id }).name) + (colorById[id] && colorById[id].lifetimeExclusive ? ' (lifetime exclusive)' : '') + '</option>').join('') + '</select></label>' : '') +
        (s.frames.length ? '<label class="field"><span>Avatar frame</span><select name="avatarFrame"><option value="">None</option>' + s.frames.map((id) => '<option value="' + esc(id) + '"' + (s.prefs.avatarFrame === id ? ' selected' : '') + '>' + esc((frameById[id] || { name: id }).name) + '</option>').join('') + '</select></label>' : '') +
        (s.customFrame ? '<div class="field"><span>Custom avatar frame color</span><div class="row"><label class="check"><input type="checkbox" name="useCustomFrame"' + (s.prefs.customFrame ? ' checked' : '') + '> Use a custom frame color (overrides the frame above)</label><input type="color" name="customFrame" value="' + esc(HEX.test(s.prefs.customFrame || '') ? s.prefs.customFrame : '#ec4899') + '"></div></div>' : '') +
        (s.customColor ? '<div class="field"><span>Custom username color</span><div class="row"><label class="check"><input type="checkbox" name="useCustom"' + (s.prefs.customColor ? ' checked' : '') + '> Use a custom color (overrides the color above)</label><input type="color" name="customColor" value="' + esc(HEX.test(s.prefs.customColor || '') ? s.prefs.customColor : '#ec4899') + '"></div></div>' : '') +
        (s.customEffects ? '<label class="field"><span>Username text effect</span><select name="customEffect"><option value="">None</option>' + cat.effects.map((e) => '<option value="' + esc(e.id) + '"' + (s.prefs.customEffect === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('') + '</select></label>' : '') +
        '<div class="form-actions"><button class="btn btn-primary">Save style</button> <span class="small muted">Current: ' + colorText(st.color, me().username) + (st.frame ? ' ' + swatch({ hex1: st.frame }) : '') + '</span></div></div></form>';

      if (s.usernameCooldownDays) {
        const next = d.username.nextChangeAt && new Date(d.username.nextChangeAt) > new Date() ? d.username.nextChangeAt : null;
        h += '<form class="block form" data-vip-form="username"><h3 class="block-head">Change username</h3><div class="block-body">' +
          (next ? '<p class="small muted">You can change your username again on <b>' + esc(fullDate(next)) + '</b>.</p>' : '<p class="small muted">You can change your username once every ' + s.usernameCooldownDays + ' days.</p>') +
          '<label class="field"><span>New username</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]+"' + (next ? ' disabled' : '') + '></label>' +
          '<label class="field"><span>Current password</span><input name="password" type="password" required autocomplete="current-password"' + (next ? ' disabled' : '') + '></label>' +
          '<div class="form-actions"><button class="btn btn-primary"' + (next ? ' disabled' : '') + '>Change username</button></div></div></form>';
      }
      if (s.vanityCooldownDays) {
        const next = d.vanity.nextChangeAt && new Date(d.vanity.nextChangeAt) > new Date() ? d.vanity.nextChangeAt : null;
        h += '<form class="block form" data-vip-form="vanity"><h3 class="block-head">Vanity profile URL</h3><div class="block-body">' +
          (d.vanity.value ? '<p>Your profile: <a href="#/u/' + esc(d.vanity.value) + '">' + esc(location.origin) + '/u/' + esc(d.vanity.value) + '</a></p>' : '') +
          '<p class="small muted">' + (next ? 'You can set a new URL on <b>' + esc(fullDate(next)) + '</b>.' : 'Changeable every ' + s.vanityCooldownDays + ' days.') + '</p>' +
          '<label class="field"><span>' + esc(location.origin) + '/u/</span><input name="vanity" value="' + esc(d.vanity.value || '') + '" maxlength="30" pattern="[a-z0-9][a-z0-9_\\-]{2,29}" placeholder="your-name"></label>' +
          '<div class="form-actions"><button class="btn btn-primary">Save URL</button>' + (d.vanity.value ? ' <button type="button" class="btn" data-vip-act="vanity-clear">Remove</button>' : '') + '</div></div></form>';
      }
    }
    h += '<section class="block"><h3 class="block-head">Wallet</h3><div class="block-body"><p>Balance: <b>' + money(d.walletCents) + '</b></p><p class="small muted">Wallet funds are added by PinkPill staff (for example refunds or credits) and can be used for VIP purchases.</p></div></section>';
    h += '<section class="block"><h3 class="block-head">Membership history <a class="small" href="#/account/purchases">Purchases</a></h3>' +
      (d.memberships.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Package</th><th>Status</th><th>Started</th><th>Expires</th><th>Style</th></tr></thead><tbody>' +
        d.memberships.map((m) => '<tr><td>' + esc(m.product ? m.product.name : '?') + (m.gifted ? ' <span class="badge">gift</span>' : '') + (m.granted ? ' <span class="badge">granted</span>' : '') + '</td><td>' + statusBadge(m.status) + '</td><td>' + esc(fullDate(m.purchaseDate)) + '</td><td>' + (m.lifetime ? 'Lifetime' : esc(fullDate(m.expiresAt))) + '</td><td>' +
          (m.avatarFrame && frameById[m.avatarFrame] ? swatch({ hex1: frameById[m.avatarFrame].hex, name: 'Frame' }) : '') + (m.usernameColor && colorById[m.usernameColor] ? swatch(colorById[m.usernameColor]) : '') + (m.customColor && HEX.test(m.customColor) ? swatch({ hex1: m.customColor, name: 'Custom' }) : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">No memberships yet.</div>') + '</section>';
    return h;
  }

  async function accountPurchases() {
    const d = await api.get('/account/purchases');
    return '<section class="block"><h3 class="block-head">Purchase history <a class="small" href="#/vip">VIP packages</a></h3>' +
      (d.purchases.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Date</th><th>Amount</th><th>Status</th><th>Gift</th></tr></thead><tbody>' +
        d.purchases.map((o) => '<tr><td>' + esc(o.product ? o.product.name : '?') + '</td><td class="nowrap">' + esc(fullDate(o.createdAt)) + '</td><td>' + (o.received ? '<span class="muted">—</span>' : money(o.amountCents, o.currency) + ' <span class="small muted">' + (METHOD_ICON[o.paymentMethod] || '') + '</span>') + '</td><td>' + statusBadge(o.status) +
          (o.status === 'pending' && !o.received ? ' <a class="small" href="#/vip/return?order=' + esc(o.id) + '">check</a>' : '') + '</td><td>' +
          (o.received ? 'Received' + (o.from ? ' from ' + ui.username(o.from) : '') : o.recipient ? 'To ' + ui.username(o.recipient) : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">You haven\'t bought anything yet.</div>') + '</section>';
  }

  /* ---------- admin ---------- */

  const dollars = (c) => (c == null ? '' : (c / 100).toFixed(2));
  const toCents = (s) => { s = String(s || '').trim(); if (!s) return null; if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw new Error('Enter prices like 8 or 8.00'); return Math.round(parseFloat(s) * 100); };
  const intOrNull = (s) => { s = String(s || '').trim(); return s === '' ? null : Number(s); };

  async function adminVip(q) {
    const section = q.get('section') || 'memberships';
    const sections = [['memberships', 'Memberships'], ['orders', 'Payments'], ['products', 'Packages & prices'], ['cosmetics', 'Colors & frames'], ['wallets', 'Wallets'], ['settings', 'Settings']];
    let h = '<nav class="tabs tabs--sub">' + sections.map(([k, l]) => '<a class="tab' + (k === section ? ' active' : '') + '" href="#/mod/vip?section=' + k + '">' + l + '</a>').join('') + '</nav>';
    const U = (id) => PP.store.user(id);
    if (section === 'memberships') {
      const params = { q: q.get('q'), status: q.get('status') || '', lifetime: q.get('lifetime') || '' };
      const [d, cat] = await Promise.all([api.get('/admin/vip/memberships', params), api.get('/admin/vip/products')]);
      h += '<form class="filter-bar" data-vip-form="admin-filter" data-section="memberships"><input name="q" placeholder="Username" value="' + esc(params.q || '') + '"><select name="status">' + [['', 'Any status'], ['active', 'Active'], ['expired', 'Expired'], ['cancelled', 'Revoked/cancelled'], ['refunded', 'Refunded']].map(([v, l]) => '<option value="' + v + '"' + (v === params.status ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><label class="check"><input type="checkbox" name="lifetime" value="1"' + (params.lifetime ? ' checked' : '') + '> Lifetime only</label><button class="btn btn-sm">Search</button></form>' +
        '<section class="block"><div class="table-wrap"><table class="table"><thead><tr><th>Member</th><th>Package</th><th>Status</th><th>Started</th><th>Expires</th><th>Source</th><th></th></tr></thead><tbody>' +
        (d.memberships.length ? d.memberships.map((m) => '<tr><td>' + ui.username(U(m.userId)) + '</td><td>' + esc(m.product) + '</td><td>' + statusBadge(m.status) + '</td><td class="nowrap small">' + esc(fullDate(m.purchaseDate)) + '</td><td class="nowrap small">' + (m.lifetime ? 'Lifetime' : esc(fullDate(m.expiresAt))) + '</td><td class="small">' + esc(m.provider) + (m.giftedBy ? ' · gift from ' + ui.username(U(m.giftedBy)) : '') + (m.grantedBy ? ' · by ' + ui.username(U(m.grantedBy)) : '') + '</td><td class="nowrap">' +
          (m.status === 'active' ? '<button class="btn btn-sm" data-vip-act="revoke" data-id="' + m.id + '">Revoke</button> ' : '') + (!m.lifetime && ['active', 'expired'].includes(m.status) ? '<button class="btn btn-sm" data-vip-act="extend" data-id="' + m.id + '">Extend</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">No memberships found.</td></tr>') +
        '</tbody></table></div></section>' +
        '<form class="block form" data-vip-form="admin-grant"><h3 class="block-head">Grant VIP manually</h3><div class="block-body"><div class="row wrap">' +
        '<label class="field"><span>Username</span><input name="username" required maxlength="24" list="vip-admin-names" data-lookup autocomplete="off"><datalist id="vip-admin-names"></datalist></label>' +
        '<label class="field"><span>Package</span><select name="product">' + cat.products.map((p) => '<option value="' + esc(p.slug) + '">' + esc(p.name) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Days (monthly packages)</span><input name="days" type="number" min="1" max="3650" value="30"></label>' +
        '<label class="field"><span>Avatar frame</span><select name="avatarFrame"><option value="">—</option>' + cat.frames.map((f) => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('') + '</select></label></div>' +
        '<label class="field"><span>Note (audit log)</span><input name="note" maxlength="300" required></label><div class="form-actions"><button class="btn btn-primary">Grant</button></div></div></form>';
    } else if (section === 'orders') {
      const params = { status: q.get('status') || '', gift: q.get('gift') || '', q: q.get('q') };
      const d = await api.get('/admin/vip/orders', params);
      const c = d.counts;
      h += '<dl class="pairs pairs--row vip-counts">' + ['paid', 'pending', 'failed', 'refunded', 'cancelled'].map((s) => '<div><dt>' + STATUS_LABEL[s] + '</dt><dd>' + ((c[s] || {}).count || 0) + (s === 'paid' && c.paid ? ' <span class="small muted">' + money(c.paid.cents) + '</span>' : '') + '</dd></div>').join('') + '</dl>' +
        '<form class="filter-bar" data-vip-form="admin-filter" data-section="orders"><input name="q" placeholder="Username" value="' + esc(params.q || '') + '"><select name="status">' + [['', 'Any status'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled']].map(([v, l]) => '<option value="' + v + '"' + (v === params.status ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><label class="check"><input type="checkbox" name="gift" value="1"' + (params.gift ? ' checked' : '') + '> Gifts only</label><button class="btn btn-sm">Filter</button></form>' +
        '<section class="block"><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Purchaser</th><th>Recipient</th><th>Package</th><th>Amount</th><th>Method</th><th>Status</th><th>Provider ids</th><th></th></tr></thead><tbody>' +
        (d.orders.length ? d.orders.map((o) => '<tr><td class="nowrap small">' + time(o.createdAt) + '</td><td>' + ui.username(U(o.purchaserId)) + '</td><td>' + (o.kind === 'gift' ? ui.username(U(o.recipientId)) : '<span class="muted small">' + esc(o.kind) + '</span>') + '</td><td>' + esc(o.product) + '</td><td>' + money(o.amountCents, o.currency) + '</td><td>' + (METHOD_ICON[o.paymentMethod] || '') + ' ' + esc(o.paymentMethod) + '</td><td>' + statusBadge(o.status) + (o.failureReason ? '<div class="small muted">' + esc(o.failureReason) + '</div>' : '') + '</td><td class="small"><code>' + esc(o.providerTxnId || o.providerRef || '') + '</code></td><td class="nowrap">' +
          (o.canRefund ? '<button class="btn btn-sm btn-danger" data-vip-act="refund" data-id="' + o.id + '" data-provider="' + (o.providerRefund ? 1 : '') + '">Refund</button> ' : '') + (['pending', 'failed', 'cancelled'].includes(o.status) && o.providerRef ? '<button class="btn btn-sm" data-vip-act="order-verify" data-id="' + o.id + '">Re-check</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No payments found.</td></tr>') +
        '</tbody></table></div></section>';
    } else if (section === 'products') {
      const d = await api.get('/admin/vip/products');
      PP.vipAdminCatalog = d;
      h += '<p class="small muted">Prices are in US dollars. Changes apply to new purchases immediately; existing memberships keep the benefits of their package definition.</p>' + d.products.map((p) =>
        '<form class="block form vip-admin-product" data-vip-form="admin-product" data-slug="' + esc(p.slug) + '"><h3 class="block-head">' + esc(p.name) + ' <code class="small">' + esc(p.slug) + '</code> ' + (p.active ? '<span class="badge">active</span>' : '<span class="badge badge--red">disabled</span>') + '</h3><div class="block-body">' +
        '<div class="row wrap"><label class="field"><span>Name</span><input name="name" value="' + esc(p.name) + '" maxlength="60" required></label>' +
        '<label class="field"><span>Price ($' + (p.lifetime ? ', one-time' : ' per month') + ')</span><input name="price" value="' + dollars(p.priceCents) + '" inputmode="decimal" required></label>' +
        (p.lifetime ? '' : '<label class="field"><span>Annual price ($, blank = not offered)</span><input name="annualPrice" value="' + dollars(p.annualPriceCents) + '" inputmode="decimal"></label>') +
        '<label class="field"><span>Display order</span><input name="position" type="number" value="' + p.position + '"></label></div>' +
        '<label class="field"><span>Description</span><input name="description" value="' + esc(p.description) + '" maxlength="500"></label>' +
        '<div class="row wrap"><label class="field"><span>Conversation limit</span><input name="conversationLimit" type="number" min="2" max="100" value="' + (p.conversationLimit || '') + '"></label>' +
        '<label class="field"><span>Username change cooldown (days)</span><input name="usernameChangeCooldownDays" type="number" min="1" value="' + (p.usernameChangeCooldownDays || '') + '"></label>' +
        '<label class="field"><span>Vanity URL cooldown (days)</span><input name="vanityUrlCooldownDays" type="number" min="1" value="' + (p.vanityUrlCooldownDays || '') + '"></label>' +
        '<label class="field"><span>Post edit window (minutes)</span><input name="postEditWindowMinutes" type="number" min="1" value="' + (p.postEditWindowMinutes || '') + '"></label></div>' +
        '<div class="field"><span>Username colors</span><div class="perm-grid">' + d.colors.map((c) => '<label class="check"><input type="checkbox" name="color" value="' + esc(c.id) + '"' + (p.allowedUsernameColors.includes(c.id) ? ' checked' : '') + '> ' + swatch(c) + ' ' + esc(c.name) + (c.lifetimeExclusive ? ' <span class="small muted">(exclusive)</span>' : '') + '</label>').join('') + '</div></div>' +
        '<div class="field"><span>Avatar frames</span><div class="perm-grid">' + d.frames.map((f) => '<label class="check"><input type="checkbox" name="frame" value="' + esc(f.id) + '"' + (p.availableAvatarFrames.includes(f.id) ? ' checked' : '') + '> ' + swatch({ hex1: f.hex }) + ' ' + esc(f.name) + '</label>').join('') + '</div></div>' +
        '<div class="field"><span>Benefits</span><div class="perm-grid">' + [['active', 'Package on sale'], ['requiresAvatarFrame', 'Frame choice required'], ['exclusiveColors', 'Lifetime-exclusive colors'], ['customUsernameColor', 'Custom username color'], ['customUsernameEffects', 'Username text effects'], ['customAvatarFrame', 'Custom avatar frame color'], ['customReactions', 'Custom reactions'], ['noAds', 'No ads'], ['vipForumAccess', 'VIP forum access'], ['ratingsThreadDeletion', 'Delete own Ratings threads'], ...(p.lifetime ? [['verifiedBadge', 'Verified badge']] : [])].map(([k, l]) => '<label class="check"><input type="checkbox" name="flag_' + k + '"' + (p[k] ? ' checked' : '') + '> ' + l + '</label>').join('') + '</div></div>' +
        '<label class="field"><span>Benefits shown on the VIP page (one per line)</span><textarea name="benefits" rows="6">' + esc(p.benefits.join('\n')) + '</textarea></label>' +
        '<label class="field"><span>Highlighted notes (one per line)</span><textarea name="notes" rows="2">' + esc(p.notes.join('\n')) + '</textarea></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save ' + esc(p.name) + '</button></div></div></form>').join('');
    } else if (section === 'cosmetics') {
      const d = await api.get('/admin/vip/products');
      const row = (kind, x) => '<form class="member-row" data-vip-form="admin-cosmetic" data-kind="' + kind + '" data-id="' + esc(x.id) + '">' + swatch(kind === 'frames' ? { hex1: x.hex } : x) + ' <code class="small">' + esc(x.id) + '</code>' +
        '<input name="name" value="' + esc(x.name) + '" maxlength="40" size="10">' +
        (kind === 'colors' ? '<input type="color" name="hex1" value="' + esc(x.hex1) + '"><label class="check small"><input type="checkbox" name="gradient"' + (x.hex2 ? ' checked' : '') + '> gradient</label><input type="color" name="hex2" value="' + esc(x.hex2 || x.hex1) + '"><label class="check small"><input type="checkbox" name="lifetimeExclusive"' + (x.lifetimeExclusive ? ' checked' : '') + '> lifetime exclusive</label>'
          : kind === 'frames' ? '<input type="color" name="hex" value="' + esc(x.hex) + '">' : '') +
        '<label class="check small"><input type="checkbox" name="active"' + (x.active ? ' checked' : '') + '> active</label><button class="btn btn-sm">Save</button></form>';
      h += '<section class="block"><h3 class="block-head">Username colors</h3><div class="block-body">' + d.colors.map((c) => row('colors', c)).join('') +
        '<form class="row wrap" data-vip-form="admin-cosmetic-new" data-kind="colors"><input name="id" placeholder="id (e.g. teal)" pattern="[a-z0-9\\-]{2,30}" required size="10"><input name="name" placeholder="Name" required maxlength="40" size="10"><input type="color" name="hex1" value="#0d9488"><label class="check small"><input type="checkbox" name="gradient"> gradient</label><input type="color" name="hex2" value="#6366f1"><label class="check small"><input type="checkbox" name="lifetimeExclusive"> lifetime exclusive</label><button class="btn btn-sm btn-primary">Add color</button></form></div></section>' +
        '<section class="block"><h3 class="block-head">Avatar frames</h3><div class="block-body">' + d.frames.map((f) => row('frames', f)).join('') +
        '<form class="row wrap" data-vip-form="admin-cosmetic-new" data-kind="frames"><input name="id" placeholder="id (e.g. pink)" pattern="[a-z0-9\\-]{2,30}" required size="10"><input name="name" placeholder="Name" required maxlength="40" size="10"><input type="color" name="hex" value="#ec4899"><button class="btn btn-sm btn-primary">Add frame</button></form></div></section>' +
        '<section class="block"><h3 class="block-head">Username text effects</h3><div class="block-body">' + d.effects.map((e) => row('effects', e).replace('<code', '<span class="username vipfx vipfx--' + esc(e.id) + '">' + esc(e.name) + '</span> <code')).join('') + '<p class="small muted">Effects are predefined styles; they can be renamed or switched off.</p></div></section>';
    } else if (section === 'wallets') {
      const name = q.get('q') || '';
      h += '<form class="filter-bar" data-vip-form="admin-filter" data-section="wallets"><input name="q" placeholder="Username" value="' + esc(name) + '" required><button class="btn btn-sm">Look up</button></form>';
      if (name) {
        const d = await api.get('/admin/vip/wallets', { username: name });
        h += '<section class="block"><h3 class="block-head">Wallet of ' + ui.username(U(d.userId)) + ': ' + money(d.balanceCents) + '</h3><div class="block-body">' +
          (d.transactions.length ? '<table class="table"><tbody>' + d.transactions.map((t) => '<tr><td class="small nowrap">' + time(t.at) + '</td><td>' + (t.amountCents > 0 ? '+' : '') + money(t.amountCents) + '</td><td>' + esc(t.kind) + '</td><td class="small">' + esc(t.reason) + '</td><td class="small">→ ' + money(t.balanceAfter) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No transactions.</p>') +
          '<form class="row wrap" data-vip-form="admin-wallet" data-username="' + esc(name) + '"><input name="amount" placeholder="Amount $ (negative to deduct)" required inputmode="decimal"><input name="reason" placeholder="Reason (audit log)" required maxlength="200" class="grow"><button class="btn btn-primary btn-sm">Adjust balance</button></form></div></section>';
      }
    } else if (section === 'settings') {
      const d = await api.get('/admin/vip/settings');
      h += '<form class="block form" data-vip-form="admin-settings"><div class="block-body"><h4>Payment methods</h4>' +
        d.paymentMethods.map((m) => '<label class="check"><input type="checkbox" name="pm_' + m.id + '"' + (m.enabled ? ' checked' : '') + '> ' + (METHOD_ICON[m.id] || '') + ' ' + esc(m.label) + ' <span class="small muted">— ' + (m.configured ? 'configured' : 'not configured on the server (add its environment variables)') + '</span></label>').join('') +
        '<h4>Limits for members without VIP</h4>' +
        '<label class="field"><span>Post editing window in minutes (0 = unlimited)</span><input type="number" name="postEditWindowMinutes" min="0" value="' + d.postEditWindowMinutes + '"></label>' +
        '<label class="field"><span>Maximum conversation participants (total)</span><input type="number" name="conversationMaxParticipants" min="2" max="100" value="' + d.conversationMaxParticipants + '"></label>' +
        '<label class="field"><span>Own Ratings threads can be deleted while they have at most this many replies</span><input type="number" name="ratingsDeleteMaxReplies" min="0" value="' + d.ratingsDeleteMaxReplies + '"></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save settings</button></div></div></form>';
    }
    return h;
  }

  /* ---------- events ---------- */

  const vipActions = {
    async 'vanity-clear'() { await api.put('/account/vanity', { vanity: '' }); await api.loadSession(); toast('Vanity URL removed.'); PP.app.refresh(); },
    revoke(el) {
      modal('Revoke VIP', '<form data-vip-form="admin-revoke" data-id="' + el.dataset.id + '"><label class="field"><span>Reason (shown to the member and in the audit log)</span><input name="reason" required maxlength="300"></label><div class="form-actions"><button class="btn btn-danger">Revoke</button></div></form>');
    },
    extend(el) {
      modal('Extend membership', '<form data-vip-form="admin-extend" data-id="' + el.dataset.id + '"><label class="field"><span>Days to add</span><input name="days" type="number" min="1" max="3650" value="30" required></label><label class="field"><span>Reason</span><input name="reason" maxlength="300"></label><div class="form-actions"><button class="btn btn-primary">Extend</button></div></form>');
    },
    refund(el) {
      const viaProvider = !!el.dataset.provider;
      modal('Refund payment', '<form data-vip-form="admin-refund" data-id="' + el.dataset.id + '"><p class="small">' + (viaProvider ? 'The money is returned through the payment provider (or to the wallet), and the membership is removed.' : 'This provider can\'t refund automatically. Refund the buyer yourself first, then mark the order refunded here to remove the membership.') + '</p>' +
        '<label class="field"><span>Reason</span><input name="reason" required maxlength="200"></label>' + (viaProvider ? '' : '<input type="hidden" name="markOnly" value="1">') + '<div class="form-actions"><button class="btn btn-danger">' + (viaProvider ? 'Refund' : 'Mark as refunded') + '</button></div></form>');
    },
    async 'order-verify'(el) { const r = await api.post('/admin/vip/orders/' + el.dataset.id + '/verify'); toast('Order status: ' + r.status); PP.app.refresh(); },
  };

  const vipForms = {
    async checkout(f) {
      if (f.querySelector('[data-step]').dataset.step === 'pay') return pay(f);
      return reviewOrder(f);
    },
    async style(f) {
      const fd = new FormData(f);
      const body = {};
      if (f.querySelector('[name=usernameColor]')) body.usernameColor = fd.get('usernameColor') || null;
      if (f.querySelector('[name=avatarFrame]')) body.avatarFrame = fd.get('avatarFrame') || null;
      if (f.querySelector('[name=customColor]')) body.customColor = fd.get('useCustom') ? String(fd.get('customColor')) : null;
      if (f.querySelector('[name=customEffect]')) body.customEffect = fd.get('customEffect') || null;
      if (f.querySelector('[name=customFrame]')) body.customFrame = fd.get('useCustomFrame') ? String(fd.get('customFrame')) : null;
      await api.patch('/vip/style', body);
      await api.loadSession();
      toast('Your VIP style has been saved.'); PP.app.refresh();
    },
    async username(f) {
      const fd = new FormData(f);
      await api.post('/account/username', { username: String(fd.get('username')).trim(), password: String(fd.get('password')) });
      await api.loadSession();
      toast('Your username has been changed.'); PP.app.refresh();
    },
    async vanity(f) {
      await api.put('/account/vanity', { vanity: String(new FormData(f).get('vanity') || '').trim().toLowerCase() });
      toast('Vanity URL saved.'); PP.app.refresh();
    },
    'admin-filter'(f) {
      const fd = new FormData(f); const p = new URLSearchParams({ section: f.dataset.section });
      fd.forEach((v, k) => { if (v) p.set(k, String(v)); });
      PP.app.go('#/mod/vip?' + p);
    },
    async 'admin-grant'(f) {
      const fd = new FormData(f);
      const body = { username: String(fd.get('username')).trim(), product: String(fd.get('product')), note: String(fd.get('note') || '') };
      if (fd.get('days')) body.days = Number(fd.get('days'));
      if (fd.get('avatarFrame')) body.avatarFrame = String(fd.get('avatarFrame'));
      await api.post('/admin/vip/memberships', body); toast('VIP granted.'); PP.app.refresh();
    },
    async 'admin-revoke'(f) { await api.post('/admin/vip/memberships/' + f.dataset.id + '/revoke', { reason: String(new FormData(f).get('reason')) }); closeModal(); toast('Membership revoked.'); PP.app.refresh(); },
    async 'admin-extend'(f) { const fd = new FormData(f); await api.post('/admin/vip/memberships/' + f.dataset.id + '/extend', { days: Number(fd.get('days')), reason: String(fd.get('reason') || '') }); closeModal(); toast('Membership extended.'); PP.app.refresh(); },
    async 'admin-refund'(f) {
      const fd = new FormData(f);
      await api.post('/admin/vip/orders/' + f.dataset.id + '/refund', { reason: String(fd.get('reason')), markOnly: !!fd.get('markOnly') });
      closeModal(); toast('Order refunded.'); PP.app.refresh();
    },
    async 'admin-product'(f) {
      const fd = new FormData(f);
      const lines = (k) => String(fd.get(k) || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const body = {
        name: String(fd.get('name')).trim(), description: String(fd.get('description') || '').trim(), priceCents: toCents(fd.get('price')), position: Number(fd.get('position')) || 0,
        conversationLimit: intOrNull(fd.get('conversationLimit')), usernameChangeCooldownDays: intOrNull(fd.get('usernameChangeCooldownDays')),
        vanityUrlCooldownDays: intOrNull(fd.get('vanityUrlCooldownDays')), postEditWindowMinutes: intOrNull(fd.get('postEditWindowMinutes')),
        allowedUsernameColors: fd.getAll('color').map(String), availableAvatarFrames: fd.getAll('frame').map(String),
        benefits: lines('benefits'), notes: lines('notes'),
      };
      if (f.querySelector('[name=annualPrice]')) body.annualPriceCents = toCents(fd.get('annualPrice'));
      ['active', 'requiresAvatarFrame', 'exclusiveColors', 'customUsernameColor', 'customUsernameEffects', 'customAvatarFrame', 'customReactions', 'noAds', 'vipForumAccess', 'ratingsThreadDeletion', 'verifiedBadge']
        .forEach((k) => { if (f.querySelector('[name=flag_' + k + ']')) body[k] = !!fd.get('flag_' + k); });
      await api.patch('/admin/vip/products/' + f.dataset.slug, body); toast('Package saved.'); PP.app.refresh();
    },
    async 'admin-cosmetic'(f) {
      const fd = new FormData(f);
      const body = { name: String(fd.get('name')).trim(), active: !!fd.get('active') };
      if (f.dataset.kind === 'colors') Object.assign(body, { hex1: String(fd.get('hex1')), hex2: fd.get('gradient') ? String(fd.get('hex2')) : null, lifetimeExclusive: !!fd.get('lifetimeExclusive') });
      if (f.dataset.kind === 'frames') body.hex = String(fd.get('hex'));
      await api.patch('/admin/vip/' + f.dataset.kind + '/' + f.dataset.id, body); toast('Saved.'); PP.app.refresh();
    },
    async 'admin-cosmetic-new'(f) {
      const fd = new FormData(f);
      const body = { id: String(fd.get('id')).trim(), name: String(fd.get('name')).trim() };
      if (f.dataset.kind === 'colors') Object.assign(body, { hex1: String(fd.get('hex1')), hex2: fd.get('gradient') ? String(fd.get('hex2')) : null, lifetimeExclusive: !!fd.get('lifetimeExclusive') });
      else body.hex = String(fd.get('hex'));
      await api.post('/admin/vip/' + f.dataset.kind, body); toast('Added.'); PP.app.refresh();
    },
    async 'admin-wallet'(f) {
      const fd = new FormData(f);
      const s = String(fd.get('amount')).trim();
      if (!/^-?\d{1,5}(\.\d{1,2})?$/.test(s)) throw new Error('Enter an amount like 10 or -2.50');
      const cents = Math.round(parseFloat(s) * 100);
      confirmBox('Change ' + f.dataset.username + '\'s wallet by ' + money(cents) + '?', async () => {
        try { await api.post('/admin/vip/wallets', { username: f.dataset.username, amountCents: cents, reason: String(fd.get('reason')) }); toast('Wallet updated.'); PP.app.refresh(); } catch (e) { toast(e.message, 'error'); }
      }, 'Adjust');
    },
    async 'admin-settings'(f) {
      const fd = new FormData(f);
      await api.patch('/admin/vip/settings', {
        paymentMethods: { card: !!fd.get('pm_card'), paypal: !!fd.get('pm_paypal'), wallet: !!fd.get('pm_wallet'), crypto: !!fd.get('pm_crypto') },
        postEditWindowMinutes: Number(fd.get('postEditWindowMinutes')), conversationMaxParticipants: Number(fd.get('conversationMaxParticipants')),
        ratingsDeleteMaxReplies: Number(fd.get('ratingsDeleteMaxReplies')),
      });
      toast('Settings saved.');
    },
  };

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-vip-act]');
    if (!el || !vipActions[el.dataset.vipAct]) return;
    e.preventDefault();
    try { await vipActions[el.dataset.vipAct](el, e); } catch (err) { toast(err.message, 'error'); }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-vip-form]');
    if (!f || !vipForms[f.dataset.vipForm]) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    try { await vipForms[f.dataset.vipForm](f); } catch (err) { toast(err.message, 'error'); } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });

  // Any change to the checkout form invalidates the reviewed quote, so the member always confirms
  // the exact order the server priced.
  const resetQuote = (e) => {
    const f = e.target.closest('form[data-vip-form="checkout"]');
    if (!f || e.target.name === 'confirm') return;
    updatePreview(f);
    if (!f.dataset.quoted) return;
    delete f.dataset.quoted;
    f.querySelector('[data-review]').innerHTML = '';
    const btn = f.querySelector('[data-step]'); btn.dataset.step = 'review'; btn.textContent = 'Review order';
  };
  document.addEventListener('change', resetQuote);
  document.addEventListener('input', resetQuote);

  PP.vipViews = { page, checkout, returned, vanity, accountVip, accountPurchases, adminVip, money };
})();

'use strict';
/* VIP end-to-end: login gating, pricing page, wallet checkout, gifting, entitlements in the UI,
   and Private Ratings / VIP Supporters visibility in a real browser. */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MAIL_DIR = path.join(__dirname, '..', 'storage', 'e2e-mail');
const DB_URL = process.env.DATABASE_URL_E2E || 'postgres://pinkpill:pinkpill@localhost:5432/pinkpill_e2e';
const PASSWORD = 'e2e password 123';
const R = Math.random().toString(36).slice(2, 6);

function latestMail(email) {
  const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).sort() : [];
  for (let i = files.length - 1; i >= 0; i--) {
    const text = fs.readFileSync(path.join(MAIL_DIR, files[i]), 'utf8');
    if (text.startsWith('To: ' + email)) return text;
  }
  return null;
}
async function sql(query, params) {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(query, params)).rows; } finally { await c.end(); }
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0 && !document.querySelector('#app.is-loading'));
}
async function nav(page, hash) {
  if (page.url().endsWith(hash)) await page.reload(); else await page.goto(hash);
  await ready(page);
}
async function register(page, username) {
  const email = username.toLowerCase() + '@example.com';
  await nav(page, '/#/register');
  await page.fill('[name=username]', username);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', PASSWORD);
  await page.fill('[name=birthday]', '1994-06-01');
  await page.check('[name=agree]');
  await page.click('form[data-form=register] button.btn-primary');
  await expect(page.locator('#userbar')).toContainText(username);
  await expect.poll(() => latestMail(email)).not.toBeNull();
  const link = latestMail(email).match(/http:\/\/\S+verify-email\?token=[\w-]+/)[0];
  await page.goto(link); await ready(page);
  await expect(page.locator('h2')).toContainText('Email verified');
}

test.describe('VIP', () => {
  test('logged-out visitors see the VIP menu item but are sent to login, then back to /vip', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const name = 'vipgate' + R;
    await register(page, name);
    await nav(page, '/#/account');
    await page.click('.side-nav [data-act=logout]');
    await expect(page.locator('#userbar')).toContainText('Log in');

    await nav(page, '/#/');
    await expect(page.locator('.site-nav a.nav-vip')).toBeVisible();
    await page.click('.site-nav a.nav-vip');
    await ready(page);
    await expect(page).toHaveURL(/#\/login\?return=%23%2Fvip/);
    await expect(page.locator('.vip-card')).toHaveCount(0);
    await expect(page.locator('.notice--vip')).toContainText('log in');

    // Typing the page URL directly is also redirected by the server.
    await page.goto('/vip'); await ready(page);
    await expect(page).toHaveURL(/#\/login\?return=/);
    await expect(page.locator('.vip-card')).toHaveCount(0);
    // The gift page too.
    await page.goto('/#/vip/gift/vip'); await ready(page);
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.locator('[data-vip-form=checkout]')).toHaveCount(0);

    // Logging in returns to the VIP page.
    await page.goto('/#/login?return=' + encodeURIComponent('#/vip')); await ready(page);
    await page.fill('[name=login]', name);
    await page.fill('[name=password]', PASSWORD);
    await page.click('form[data-form=login] button.btn-primary');
    await expect(page).toHaveURL(/#\/vip$/);
    await expect(page.locator('.vip-card')).toHaveCount(5);
    await expect(page.locator('.vip-card[data-product="lifetime-vip-plus"]')).toContainText('$108.00');
    await expect(page.locator('main')).not.toContainText('Lifetime means the lifetime of the forum');
    await expect(page.locator('.vip-card[data-product="lifetime-vip-plus-custom"]')).toContainText('This package includes a custom username color of your choice.');
    await ctx.close();
  });

  test('guests never see Private Ratings or VIP Supporters, even by direct URL', async ({ page }) => {
    await nav(page, '/#/');
    await expect(page.locator('.node-cat')).not.toHaveCount(0);
    await expect(page.locator('a[href="#/forums/f-private-rating"]')).toHaveCount(0);
    await expect(page.locator('a[href="#/forums/f-vip"]')).toHaveCount(0);
    await nav(page, '/#/forums/f-private-rating');
    await expect(page.locator('.notice--error')).toContainText('could not be found');
    await nav(page, '/#/forums/f-vip');
    await expect(page.locator('.notice--error')).toContainText('could not be found');
    await nav(page, '/#/search');
    await expect(page.locator('select[name=f] option[value="f-private-rating"]')).toHaveCount(0);
  });

  test('wallet checkout activates VIP+ with the chosen frame and color; gifts go to the recipient', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const name = 'vipbuyer' + R;
    await register(page, name);
    // Members see Private Ratings, but not VIP Supporters before buying.
    await nav(page, '/#/');
    await expect(page.locator('a[href="#/forums/f-private-rating"]').first()).toBeVisible();
    await expect(page.locator('a[href="#/forums/f-vip"]')).toHaveCount(0);

    await sql('INSERT INTO user_wallets (user_id, balance_cents) SELECT id, 10000 FROM users WHERE username = $1', [name]);
    await nav(page, '/#/vip');
    await page.click('.vip-card[data-product="vip-plus"] a.btn-primary');
    await ready(page);
    await expect(page.locator('[data-vip-form=checkout]')).toBeVisible();
    await page.check('input[name=paymentMethod][value=wallet]');
    // Frame is required for VIP+ (browser validation, and the server would refuse too).
    await page.locator('input[name=avatarFrame][value=green]').check();
    await page.locator('input[name=usernameColor][value=cosmic]').check();
    await page.click('[data-vip-form=checkout] button[data-step]');
    await expect(page.locator('.vip-review')).toContainText('$17.00');
    await page.check('input[name=confirm]');
    await page.click('[data-vip-form=checkout] button[data-step]');
    await expect(page.locator('.vip-result')).toContainText('membership is active');

    // Entitlements show up across the UI.
    await nav(page, '/#/');
    await expect(page.locator('a[href="#/forums/f-vip"]').first()).toBeVisible();
    await nav(page, '/#/account/vip');
    await expect(page.locator('main')).toContainText('VIP+');
    await expect(page.locator('main')).toContainText('Conversations with up to 25 people');
    await expect(page.locator('main a.username.username--gradient').first()).toBeVisible();
    await nav(page, '/#/account/purchases');
    await expect(page.locator('main table')).toContainText('VIP+');
    await expect(page.locator('main table')).toContainText('$17.00');

    // Gift VIP to another member.
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    const friend = 'vipfriend' + R;
    await register(p2, friend);
    await nav(page, '/#/vip/gift/vip');
    await page.fill('input[name=giftTo]', name);
    await page.check('input[name=paymentMethod][value=wallet]');
    await page.click('[data-vip-form=checkout] button[data-step]');
    await expect(page.locator('#toasts')).toContainText('can\'t gift VIP to yourself');
    await page.fill('input[name=giftTo]', friend);
    await page.click('[data-vip-form=checkout] button[data-step]');
    await expect(page.locator('.vip-review')).toContainText(friend);
    await page.check('input[name=confirm]');
    await page.click('[data-vip-form=checkout] button[data-step]');
    await expect(page.locator('.vip-result')).toContainText('gift');
    await nav(p2, '/#/account/vip');
    await expect(p2.locator('main')).toContainText('Current membership');
    await nav(p2, '/#/forums/f-vip');
    await expect(p2.locator('h1')).toContainText('VIP Supporters');
    await ctx.close(); await ctx2.close();
  });
});

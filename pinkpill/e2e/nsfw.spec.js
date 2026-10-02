'use strict';
/* NSFW content warning in the browser: posting option, label in lists and on the thread, warning banner. */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MAIL_DIR = path.join(__dirname, '..', 'storage', 'e2e-mail');
const R = Math.random().toString(36).slice(2, 6);
function latestMail(email) {
  const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).sort() : [];
  for (let i = files.length - 1; i >= 0; i--) { const t = fs.readFileSync(path.join(MAIL_DIR, files[i]), 'utf8'); if (t.startsWith('To: ' + email)) return t; }
  return null;
}
async function ready(page) { await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0 && !document.querySelector('#app.is-loading')); }
async function nav(page, hash) { if (page.url().endsWith(hash)) await page.reload(); else await page.goto(hash); await ready(page); }

test('an NSFW-tagged thread shows the warning in the forum list and on the thread, even for a logged-out visitor', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const name = 'nsfwposter' + R, email = name + '@example.com';
  await nav(page, '/#/register');
  await page.fill('[name=username]', name); await page.fill('[name=email]', email);
  await page.fill('[name=password]', 'e2e password 123'); await page.fill('[name=birthday]', '1994-06-01');
  await page.check('[name=agree]'); await page.click('form[data-form=register] button.btn-primary');
  await expect.poll(() => latestMail(email)).not.toBeNull();
  await page.goto(latestMail(email).match(/http:\/\/\S+verify-email\?token=[\w-]+/)[0]); await ready(page);

  await nav(page, '/#/post-thread/f-style');
  await page.fill('[name=title]', 'Lingerie fit check ' + R);
  await page.fill('form[data-form=post-thread] textarea[name=content]', 'Non-explicit fit photos');
  await page.check('input[name=nsfw]');
  await page.click('form[data-form=post-thread] button.btn-primary');
  await expect(page.locator('.notice--nsfw')).toContainText('Content warning');
  await expect(page.locator('h1 .nsfw-tag')).toBeVisible();

  const g = await (await browser.newContext()).newPage();
  await nav(g, '/#/forums/f-style');
  const row = g.locator('.thread-row', { hasText: 'Lingerie fit check ' + R });
  await expect(row.locator('.nsfw-tag')).toBeVisible();
  await nav(g, '/#/whats-new/posts');
  await expect(g.locator('.thread-row', { hasText: 'Lingerie fit check ' + R }).locator('.nsfw-tag')).toBeVisible();
  await ctx.close();
});

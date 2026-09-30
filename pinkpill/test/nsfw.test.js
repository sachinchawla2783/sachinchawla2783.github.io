'use strict';
/* Age policy (13+) and the NSFW content-warning tag: shown everywhere a thread appears, never used to hide
   content by age; any member can apply it to their own thread; staff tags are locked and audited. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db, lastMail } = require('./helpers');

let adult, mod, guest, teen;
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (y, extraDays = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + extraDays); return ymd(d); };

async function registerWithBirthday(username, birthday) {
  const c = client();
  const r = await c.post('/api/auth/register', { username, email: username + '@example.com', password: 'correct horse battery', birthday, agree: true });
  if (r.status !== 201) return { status: r.status, body: r.body };
  c.csrf = r.body.csrfToken;
  const token = lastMail(username + '@example.com').text.match(/token=([\w-]+)/)[1];
  await c.post('/api/auth/verify-email', { token });
  await c.refresh();
  return c;
}

before(async () => {
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  adult = await member({ username: 'adultmember' });
  mod = await member({ username: 'nsfwmod', role: 'moderator' });
  guest = client();
});
after(teardown);

test('members under 18 can register from age 13; under-13s cannot', async () => {
  const young = await registerWithBirthday('toyoung', yearsAgo(13, 1));
  assert.equal(young.status, 403);
  assert.match(young.body.error.message, /13 or older/);
  teen = await registerWithBirthday('teenmember', yearsAgo(15));
  assert.ok(teen.user, 'a 15-year-old can register');
});

test('NSFW tag appears wherever the thread is surfaced, for guests, teens and adults alike', async () => {
  const t = await adult.post('/api/forums/f-style/threads', { title: 'Swimwear haul feedback', content: 'Non-explicit try-on photos', nsfw: true });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.thread.id;
  await adult.put('/api/posts/' + t.body.postId + '/bookmark');
  for (const viewer of [guest, teen, adult]) {
    const th = await viewer.get('/api/threads/' + id);
    assert.equal(th.status, 200, 'visible to everyone who can see the forum (not age-gated)');
    assert.equal(th.body.thread.nsfw, true);
    assert.equal((await viewer.get('/api/forums/f-style')).body.threads.find((x) => x.id === id).nsfw, true, 'forum listing');
    const idx = (await viewer.get('/api/forums')).body.forums.find((f) => f.id === 'f-style');
    assert.equal(idx.stats.lastPost.nsfw, true, 'forum index latest post');
    assert.equal((await viewer.get('/api/whats-new/posts')).body.threads.find((x) => x.id === id).nsfw, true, 'what\'s new');
    assert.equal((await viewer.get('/api/widgets/sidebar')).body.latest.find((x) => x.id === id).nsfw, true, 'sidebar');
    assert.equal((await viewer.get('/api/whats-new/activity')).body.items.find((x) => x.threadId === id).nsfw, true, 'activity feed');
    assert.equal((await viewer.get('/api/search?q=swimwear')).body.results.find((x) => x.threadId === id).nsfw, true, 'search');
  }
  assert.equal((await adult.get('/api/account/bookmarks')).body.bookmarks[0].nsfw, true, 'bookmarks');
  // Alerts about the thread carry the warning too.
  await teen.put('/api/threads/' + id + '/watch');
  await adult.post('/api/threads/' + id + '/posts', { content: 'update' });
  const n = await db.one("SELECT text FROM notifications WHERE user_id = $1 AND type = 'reply' ORDER BY id DESC LIMIT 1", [teen.user.id]);
  assert.match(n.text, /\[NSFW\] Swimwear haul feedback/);
  // Untagged threads are not marked.
  const plain = await adult.post('/api/forums/f-style/threads', { title: 'Capsule wardrobe', content: 'x' });
  assert.equal((await guest.get('/api/threads/' + plain.body.thread.id)).body.thread.nsfw, false);
});

test('any member can tag their own thread NSFW (it is a tag, not a filter); staff can tag any thread', async () => {
  const r = await teen.post('/api/forums/f-style/threads', { title: 'Teen thread tagged', content: 'strong language', nsfw: true, prefix: 'rage' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await guest.get('/api/threads/' + r.body.thread.id)).body.thread.nsfw, true);
  assert.equal((await guest.get('/api/threads/' + r.body.thread.id)).body.thread.prefix, 'rage', 'NSFW combines with a prefix');
  const ok = await teen.post('/api/forums/f-style/threads', { title: 'Teen normal thread', content: 'x' });
  assert.equal(ok.status, 201);
  assert.equal((await teen.patch('/api/threads/' + ok.body.thread.id, { nsfw: true })).status, 200);
  assert.equal((await teen.patch('/api/threads/' + ok.body.thread.id, { nsfw: false })).status, 200);
  // Members can't tag other people's threads.
  assert.equal((await adult.patch('/api/threads/' + ok.body.thread.id, { nsfw: true })).status, 403);
  // Staff can tag anything; it's audited and the author is told.
  assert.equal((await mod.patch('/api/threads/' + ok.body.thread.id, { nsfw: true })).status, 200);
  assert.equal((await guest.get('/api/threads/' + ok.body.thread.id)).body.thread.nsfw, true);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'thread.nsfw_tag' AND target_id = $1", [ok.body.thread.id]));
  assert.ok(await db.one("SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'moderation' AND text LIKE '%as NSFW%'", [teen.user.id]));
});

test('the new prefix set is accepted and old prefixes are rejected', async () => {
  for (const p of ['question', 'lifefuel', 'blackpill', 'redpill', 'mogs', 'whitepill', 'bluepill', 'jfl', 'over', 'cope', 'slay', 'looksmax', 'rateme']) {
    assert.equal((await adult.post('/api/forums/f-offtopic/threads', { title: 'Prefix ' + p, content: 'x', prefix: p })).status, 201, p);
  }
  for (const p of ['routine', 'glowup', 'vent', 'nsfw']) {
    assert.equal((await adult.post('/api/forums/f-offtopic/threads', { title: 'Old ' + p, content: 'x', prefix: p })).status, 422, p);
  }
});

test('a tag set by staff cannot be removed by the author; author-set tags can', async () => {
  const t = await adult.post('/api/forums/f-style/threads', { title: 'Before and after', content: 'graphic healing photos' });
  const id = t.body.thread.id;
  assert.equal((await adult.patch('/api/threads/' + id, { nsfw: true })).status, 200);
  assert.equal((await adult.patch('/api/threads/' + id, { nsfw: false })).status, 200, 'author can remove their own tag');
  assert.equal((await mod.patch('/api/threads/' + id, { nsfw: true })).status, 200);
  const th = await adult.get('/api/threads/' + id);
  assert.equal(th.body.permissions.nsfwLockedByStaff, true);
  const blocked = await adult.patch('/api/threads/' + id, { nsfw: false });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error.message, /moderator/);
  assert.equal((await mod.patch('/api/threads/' + id, { nsfw: false })).status, 200);
  assert.ok(await db.one("SELECT 1 FROM audit_log WHERE action = 'thread.nsfw_untag' AND target_id = $1", [id]));
  // Members can report untagged NSFW content.
  const r = await teen.post('/api/reports', { type: 'post', id: t.body.postId, reason: 'Untagged NSFW content' });
  assert.equal(r.status, 201);
});

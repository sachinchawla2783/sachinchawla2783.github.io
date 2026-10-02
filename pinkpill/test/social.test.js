'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { setup, teardown, client, member, db } = require('./helpers');

let alice, bob, carol, mod, guest, png;

before(async () => {
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  alice = await member({ username: 'alice' });
  bob = await member({ username: 'bob' });
  carol = await member({ username: 'carol' });
  mod = await member({ username: 'mod', role: 'moderator' });
  guest = client();
  png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ec4899' } }).png().toBuffer();
});
after(teardown);

const upload = (c, buf, name, purpose = 'post', type = 'image/png') => {
  let r = c.agent.post('/api/uploads').set('X-Requested-With', 'fetch');
  if (c.csrf) r = r.set('X-CSRF-Token', c.csrf);
  return r.field('purpose', purpose).attach('file', buf, { filename: name, contentType: type });
};

test('conversations: create, reply, unread state, notifications', async () => {
  const r = await alice.post('/api/conversations', { to: ['bob'], title: 'Hi Bob', content: 'Private hello' });
  assert.equal(r.status, 201);
  const id = r.body.id;
  const counts = await bob.get('/api/me/counts');
  assert.equal(counts.body.conversations, 1);
  const list = await bob.get('/api/conversations?filter=unread');
  assert.equal(list.body.conversations[0].title, 'Hi Bob');
  const v = await bob.get(`/api/conversations/${id}`);
  assert.equal(v.body.messages[0].content, 'Private hello');
  assert.equal((await bob.get('/api/me/counts')).body.conversations, 0, 'marked read');
  assert.equal((await bob.post(`/api/conversations/${id}/messages`, { content: 'Hi Alice' })).status, 201);
  const va = await alice.get(`/api/conversations/${id}`);
  assert.equal(va.body.messages.length, 2);
  const n = await bob.get('/api/notifications');
  assert.ok(n.body.notifications.some((x) => x.type === 'conversation'));
});

test('conversations are private: non-participants get 404 everywhere (IDOR)', async () => {
  const r = await alice.post('/api/conversations', { to: 'bob', title: 'Secret', content: 'for bob only' });
  const id = r.body.id;
  assert.equal((await carol.get(`/api/conversations/${id}`)).status, 404);
  assert.equal((await carol.post(`/api/conversations/${id}/messages`, { content: 'intrude' })).status, 404);
  assert.equal((await carol.post(`/api/conversations/${id}/invite`, { names: ['carol'] })).status, 404);
  assert.equal((await carol.put(`/api/conversations/${id}/star`, { starred: true })).status, 404);
  assert.equal((await mod.get(`/api/conversations/${id}`)).status, 404, 'staff cannot read DMs either');
  assert.equal((await guest.get(`/api/conversations/${id}`)).status, 401);
  const carolList = await carol.get('/api/conversations');
  assert.ok(!carolList.body.conversations.some((c) => c.id === id));
  const msgId = (await alice.get(`/api/conversations/${id}`)).body.messages[0].id;
  assert.equal((await carol.post('/api/reports', { type: 'message', id: msgId, reason: 'spam spam' })).status, 404);
  assert.equal((await bob.post('/api/reports', { type: 'message', id: msgId, reason: 'harassing me' })).status, 201);
});

test('conversation privacy settings and ignore list are enforced', async () => {
  await carol.patch('/api/account/preferences', { allowDms: 'none' });
  assert.equal((await alice.post('/api/conversations', { to: ['carol'], title: 'x', content: 'y' })).status, 403);
  assert.equal((await mod.post('/api/conversations', { to: ['carol'], title: 'Staff', content: 'staff can reach you' })).status, 201);
  await carol.patch('/api/account/preferences', { allowDms: 'everyone' });
  await carol.put(`/api/members/${alice.user.id}/ignore`);
  assert.equal((await alice.post('/api/conversations', { to: ['carol'], title: 'x', content: 'y' })).status, 403);
  await carol.del(`/api/members/${alice.user.id}/ignore`);
  assert.equal((await alice.post('/api/conversations', { to: ['nobody-here'], title: 'x', content: 'y' })).status, 422);
  assert.equal((await alice.put(`/api/members/${mod.user.id}/ignore`)).status, 403, 'staff cannot be ignored');
});

test('leave and invite', async () => {
  const r = await alice.post('/api/conversations', { to: ['bob'], title: 'Group', content: 'hey', allowInvite: false });
  const id = r.body.id;
  assert.equal((await bob.post(`/api/conversations/${id}/invite`, { names: ['carol'] })).status, 403);
  assert.equal((await alice.post(`/api/conversations/${id}/invite`, { names: ['carol'] })).status, 200);
  assert.equal((await carol.get(`/api/conversations/${id}`)).status, 200);
  assert.equal((await carol.post(`/api/conversations/${id}/leave`)).status, 200);
  assert.equal((await carol.get(`/api/conversations/${id}`)).status, 404);
  await alice.post(`/api/conversations/${id}/messages`, { content: 'come back' });
  assert.equal((await carol.get(`/api/conversations/${id}`)).status, 200, 'rejoins on new message');
});

test('uploads: valid image is re-encoded to WebP and served safely', async () => {
  const r = await upload(alice, png, 'pic.png');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.url, /^\/media\/[0-9a-f-]{36}$/);
  // An upload that isn't embedded anywhere yet is visible only to its owner.
  assert.equal((await guest.agent.get(r.body.url)).status, 404);
  const m = await alice.agent.get(r.body.url).redirects(1);
  assert.equal(m.status, 200);
  assert.equal(m.headers['content-type'], 'image/webp');
  assert.equal(m.headers['x-content-type-options'], 'nosniff');
  assert.match(m.headers['content-security-policy'], /sandbox/);
  const meta = await sharp(m.body).metadata();
  assert.equal(meta.format, 'webp');
  // avatar is cropped square and can be set on the profile
  const av = await upload(alice, png, 'me.png', 'avatar');
  assert.equal(av.body.width, 256); assert.equal(av.body.height, 256);
  assert.equal((await alice.patch('/api/account/profile', { avatarId: av.body.id })).status, 200);
  assert.equal((await bob.patch('/api/account/profile', { avatarId: av.body.id })).status, 403, 'cannot use someone else\'s upload');
  const prof = await guest.get(`/api/members/${alice.user.id}`);
  assert.equal(prof.body.user.avatarUrl, '/media/' + av.body.id);
  // posts can embed uploaded images
  const t = await alice.post('/api/forums/f-skin/threads', { title: 'With image', content: `[img]${r.body.url}[/img]` });
  assert.equal(t.status, 201);
});

test('uploads: rejects non-images, disguised scripts, bad purposes, oversize, anonymous', async () => {
  assert.equal((await upload(alice, Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.php.png')).status, 415);
  assert.equal((await upload(alice, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg', 'post', 'image/svg+xml')).status, 415);
  const polyglot = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<script>alert(1)</script>')]);
  assert.equal((await upload(alice, polyglot, 'x.gif', 'post', 'image/gif')).status, 415);
  assert.equal((await upload(alice, png, 'x.png', '../../etc')).status, 422);
  const big = Buffer.alloc(6 * 1024 * 1024, 1);
  assert.equal((await upload(alice, big, 'big.png')).status, 413);
  assert.equal((await upload(guest, png, 'x.png')).status, 401);
  const noCsrf = await alice.agent.post('/api/uploads').set('X-Requested-With', 'fetch').field('purpose', 'post').attach('file', png, 'x.png');
  assert.equal(noCsrf.status, 403);
  assert.equal((await guest.agent.get('/media/../../package.json')).status, 404);
  assert.equal((await guest.agent.get('/media/not-a-uuid')).status, 404);
});

test('profile posts, comments, reactions, privacy', async () => {
  const r = await bob.post(`/api/members/${alice.user.id}/profile-posts`, { content: 'Welcome @alice!' });
  assert.equal(r.status, 201);
  assert.equal((await carol.post(`/api/profile-posts/${r.body.id}/comments`, { content: 'Hi!' })).status, 201);
  assert.equal((await alice.put(`/api/profile-posts/${r.body.id}/reaction`, { reaction: 'love' })).status, 200);
  assert.equal((await bob.put(`/api/profile-posts/${r.body.id}/reaction`, { reaction: 'love' })).status, 403, 'own content');
  const list = await guest.get(`/api/members/${alice.user.id}/profile-posts`);
  assert.equal(list.body.profilePosts[0].comments.length, 1);
  assert.equal((await carol.del(`/api/profile-posts/${r.body.id}`)).status, 403);
  await alice.patch('/api/account/preferences', { allowProfilePosts: 'none' });
  assert.equal((await carol.post(`/api/members/${alice.user.id}/profile-posts`, { content: 'hey' })).status, 403);
  await alice.patch('/api/account/preferences', { allowProfilePosts: 'everyone' });
  assert.equal((await alice.del(`/api/profile-posts/${r.body.id}`)).status, 200, 'profile owner can delete');
});

test('follow / unfollow notifies and counts; self-follow rejected', async () => {
  assert.equal((await bob.put(`/api/members/${alice.user.id}/follow`)).status, 200);
  assert.equal((await bob.put(`/api/members/${alice.user.id}/follow`)).status, 200, 'idempotent');
  assert.equal((await alice.put(`/api/members/${alice.user.id}/follow`)).status, 403);
  const p = await bob.get(`/api/members/${alice.user.id}`);
  assert.equal(p.body.relation.following, true);
  assert.equal(p.body.user.stats.followers, 1);
  const n = await alice.get('/api/notifications');
  assert.ok(n.body.notifications.some((x) => x.type === 'follow'));
  // followers get notified about new threads
  await alice.post('/api/forums/f-offtopic/threads', { title: 'New from alice', content: 'hello followers' });
  assert.ok((await bob.get('/api/notifications')).body.notifications.some((x) => x.type === 'follow-thread'));
  const feed = await bob.get('/api/whats-new/feed');
  assert.ok(feed.body.items.some((i) => i.threadTitle === 'New from alice'));
});

test('public profile never exposes private data', async () => {
  await alice.patch('/api/account/profile', { birthday: '1990-04-12' });
  const p = await guest.get(`/api/members/${alice.user.id}`);
  const body = JSON.stringify(p.body);
  assert.ok(!body.includes('alice@example.com'));
  assert.ok(!body.includes('argon2'));
  assert.ok(!body.includes('1990'));
  assert.deepEqual(p.body.profile.birthday, { month: 4, day: 12 });
  const list = await guest.get('/api/members?tab=list');
  assert.ok(!JSON.stringify(list.body).includes('@example.com'));
});

test('notifications: list, read-all, ignored users do not notify', async () => {
  await alice.post('/api/notifications/read-all');
  assert.equal((await alice.get('/api/me/counts')).body.alerts, 0);
  await alice.put(`/api/members/${carol.user.id}/ignore`);
  await carol.put(`/api/members/${alice.user.id}/follow`);
  assert.equal((await alice.get('/api/me/counts')).body.alerts, 0);
  await alice.del(`/api/members/${carol.user.id}/ignore`);
});

test('search: full text, member filter, titles only, member search', async () => {
  await bob.post('/api/forums/f-hair/threads', { title: 'Rosemary oil results', content: 'Rosemary oil helped my hairline grow back' });
  const s = await guest.get('/api/search?q=rosemary');
  assert.ok(s.body.results.length >= 1);
  assert.equal(s.body.results[0].threadTitle, 'Rosemary oil results');
  assert.equal((await guest.get('/api/search?q=rosemary&m=alice')).body.results.length, 0);
  assert.ok((await guest.get('/api/search?q=results&titles=1')).body.results.length >= 1);
  const mem = await guest.get('/api/search?q=bo&t=member');
  assert.ok(mem.body.results.some((r) => r.userId === bob.user.id));
  assert.equal((await guest.get('/api/search?q=' + 'x'.repeat(500))).status, 422);
});

test('widgets, members lists, online, tags', async () => {
  const w = await guest.get('/api/widgets/sidebar');
  assert.equal(w.status, 200);
  assert.ok(w.body.stats.members >= 4);
  assert.equal(typeof w.body.onlineTotal, 'number');
  assert.ok(w.body.onlineTotal >= w.body.online.length, 'total counts everyone, not just the names shown');
  assert.ok(w.body.online.length <= 50);
  const notable = await guest.get('/api/members?tab=notable');
  assert.ok(notable.body.mostMessages.length >= 1);
  const staff = await guest.get('/api/members?tab=staff');
  assert.ok(staff.body.moderators.includes(mod.user.id));
  assert.equal((await guest.get('/api/online')).status, 200);
  await alice.post('/api/forums/f-skin/threads', { title: 'Tagged', content: 'x', tags: ['niacinamide'] });
  const tag = await guest.get('/api/tags/niacinamide');
  assert.equal(tag.body.threads.length, 1);
  assert.equal((await guest.get('/api/members/by-name/alice')).body.id, alice.user.id);
});

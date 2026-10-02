'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, client, member, db } = require('./helpers');

let alice, bob, mod, admin, guest, unverified;

before(async () => {
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  alice = await member({ username: 'alice' });
  bob = await member({ username: 'bob' });
  mod = await member({ username: 'mod', role: 'moderator' });
  admin = await member({ username: 'admin', role: 'admin' });
  unverified = await member({ username: 'newbie', verify: false });
  guest = client();
});
after(teardown);

const newThread = (c, forum = 'f-skin', extra = {}) => c.post(`/api/forums/${forum}/threads`, Object.assign({ title: 'My skincare routine', content: 'Hello [b]world[/b] @bob' }, extra));

test('forum index lists the preserved structure; members-only forums hidden from guests', async () => {
  const g = await guest.get('/api/forums');
  assert.equal(g.status, 200);
  const ids = g.body.forums.map((f) => f.id);
  for (const id of ['f-news', 'f-announce', 'f-looks', 'f-skin', 'f-body', 'f-questions', 'f-rating', 'f-advice', 'f-offtopic']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('f-private-rating'));
  assert.equal(g.body.categories[0].title, 'Information');
  const m = await alice.get('/api/forums');
  assert.ok(m.body.forums.some((f) => f.id === 'f-private-rating'));
  assert.equal((await guest.get('/api/forums/f-private-rating')).status, 404);
  assert.equal((await guest.get('/api/forums/../../etc')).status, 404);
});

test('create thread, reply, pagination, counts, notifications', async () => {
  const r = await newThread(alice, 'f-skin', { tags: ['Skin Care', 'SPF'], prefix: 'guide' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tid = r.body.thread.id;
  const view = await guest.get(`/api/threads/${tid}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.thread.title, 'My skincare routine');
  assert.deepEqual(view.body.thread.tags, ['skin-care', 'spf']);
  assert.equal(view.body.posts[0].content, 'Hello [b]world[/b] @bob');
  assert.equal(view.body.permissions.reply, false, 'guests cannot reply');
  // bob was mentioned
  const bn = await bob.get('/api/notifications');
  assert.ok(bn.body.notifications.some((n) => n.type === 'mention'));
  // 25 replies → 2 pages
  for (let i = 0; i < 25; i++) assert.equal((await bob.post(`/api/threads/${tid}/posts`, { content: 'Reply ' + i })).status, 201);
  const p1 = await alice.get(`/api/threads/${tid}`);
  assert.equal(p1.body.pages, 2); assert.equal(p1.body.posts.length, 20);
  const p2 = await alice.get(`/api/threads/${tid}?page=2`);
  assert.equal(p2.body.posts.length, 6); assert.equal(p2.body.posts[0].position, 21);
  // alice watches her thread → notified of replies
  const an = await alice.get('/api/notifications');
  assert.ok(an.body.notifications.some((n) => n.type === 'reply'));
  const f = await guest.get('/api/forums/f-skin');
  const row = f.body.threads.find((t) => t.id === tid);
  assert.equal(row.replyCount, 25);
  assert.equal(row.pages, 2);
  const idx = await guest.get('/api/forums');
  const looks = idx.body.forums.find((x) => x.id === 'f-looks');
  assert.ok(looks.stats.messages >= 26, 'parent forum aggregates sub-forum stats');
});

test('thread creation permissions: guests, unverified, staff-only forums, hidden forums', async () => {
  assert.equal((await newThread(guest)).status, 401);
  const u = await newThread(unverified);
  assert.equal(u.status, 403); assert.match(u.body.error.message, /verify/i);
  assert.equal((await newThread(alice, 'f-news')).status, 403);
  assert.equal((await newThread(mod, 'f-news')).status, 201);
  assert.equal((await newThread(alice, 'f-nope')).status, 404);
  assert.equal((await newThread(alice, 'f-private-rating')).status, 201);
});

test('validation: title length, empty content, unknown fields, unsafe content', async () => {
  assert.equal((await newThread(alice, 'f-skin', { title: 'x' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { content: '   ' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { authorId: '1' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { sticky: true })).status, 422, 'members cannot create sticky threads');
  assert.equal((await newThread(alice, 'f-skin', { content: '[img]javascript:alert(1)[/img]' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { content: '[img]data:image/png;base64,AAAA[/img]' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { content: '[url=javascript:alert(1)]x[/url]' })).status, 422);
  assert.equal((await newThread(alice, 'f-skin', { prefix: 'admin' })).status, 422);
});

test('XSS payloads are stored verbatim as text (the API never returns HTML)', async () => {
  const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const r = await newThread(alice, 'f-skin', { title: 'XSS ' + payload.slice(0, 40), content: payload });
  assert.equal(r.status, 201);
  const v = await guest.get(`/api/threads/${r.body.thread.id}`);
  assert.equal(v.headers['content-type'].split(';')[0], 'application/json');
  assert.equal(v.body.posts[0].content, payload);
});

test('SQL injection attempts are treated as data', async () => {
  const r = await newThread(alice, 'f-skin', { title: "Robert'); DROP TABLE users;--", content: "' OR 1=1 --" });
  assert.equal(r.status, 201);
  assert.equal((await db.one('SELECT count(*)::int AS n FROM users')).n > 0, true);
  assert.equal((await guest.get("/api/forums/f-skin?starter=' OR '1'='1")).status, 200);
  assert.equal((await guest.get("/api/threads/1 OR 1=1")).status, 404);
  assert.equal((await guest.get('/api/search?q=' + encodeURIComponent("'; DROP TABLE posts; --"))).status, 200);
  assert.ok((await db.one('SELECT count(*)::int AS n FROM posts')).n > 0);
});

test('edit own post (with history); cannot edit others; moderators can, and it is audited', async () => {
  const r = await newThread(alice);
  const pid = r.body.postId;
  assert.equal((await bob.patch(`/api/posts/${pid}`, { content: 'hacked' })).status, 403);
  assert.equal((await alice.patch(`/api/posts/${pid}`, { content: 'Edited once', reason: 'typo' })).status, 200);
  assert.equal((await mod.patch(`/api/posts/${pid}`, { content: 'Edited by mod' })).status, 200);
  const h = await alice.get(`/api/posts/${pid}/history`);
  assert.equal(h.body.revisions.length, 2);
  assert.equal((await bob.get(`/api/posts/${pid}/history`)).status, 403);
  const log = await db.one("SELECT action, target_id FROM audit_log WHERE action = 'post.edit' ORDER BY id DESC LIMIT 1");
  assert.equal(log.target_id, pid);
});

test('delete: own reply soft-deleted, hidden from others, visible to mods, restorable', async () => {
  const r = await newThread(alice);
  const tid = r.body.thread.id;
  const rep = await bob.post(`/api/threads/${tid}/posts`, { content: 'to delete' });
  const pid = rep.body.post.id;
  assert.equal((await alice.del(`/api/posts/${pid}`, {})).status, 403);
  assert.equal((await bob.del(`/api/posts/${pid}`, { reason: 'oops' })).status, 200);
  const g = await guest.get(`/api/threads/${tid}`);
  assert.equal(g.body.posts.length, 1);
  assert.equal((await guest.get(`/api/posts/${pid}/reactions`)).status, 404);
  const m = await mod.get(`/api/threads/${tid}`);
  assert.equal(m.body.posts.length, 2);
  assert.equal(m.body.posts[1].deleted, true);
  assert.equal(m.body.posts[1].content, null);
  assert.equal((await bob.post(`/api/posts/${pid}/restore`)).status, 403);
  assert.equal((await mod.post(`/api/posts/${pid}/restore`)).status, 200);
  assert.equal((await guest.get(`/api/threads/${tid}`)).body.posts.length, 2);
  // deleting the first post deletes the thread
  assert.equal((await alice.del(`/api/posts/${r.body.postId}`, {})).status, 200);
  assert.equal((await guest.get(`/api/threads/${tid}`)).status, 404);
  assert.equal((await mod.get(`/api/threads/${tid}`)).status, 200);
});

test('lock, pin, move: moderator only; locked threads reject member replies', async () => {
  const r = await newThread(alice);
  const tid = r.body.thread.id;
  assert.equal((await alice.patch(`/api/threads/${tid}`, { locked: true })).status, 403);
  assert.equal((await alice.patch(`/api/threads/${tid}`, { sticky: true })).status, 403);
  assert.equal((await alice.patch(`/api/threads/${tid}`, { forumId: 'f-body' })).status, 403);
  assert.equal((await alice.patch(`/api/threads/${tid}`, { title: 'Renamed by owner' })).status, 200);
  assert.equal((await bob.patch(`/api/threads/${tid}`, { title: 'Renamed by bob' })).status, 403);
  assert.equal((await mod.patch(`/api/threads/${tid}`, { locked: true, sticky: true })).status, 200);
  assert.equal((await bob.post(`/api/threads/${tid}/posts`, { content: 'hi' })).status, 403);
  assert.equal((await mod.post(`/api/threads/${tid}/posts`, { content: 'staff note' })).status, 201);
  assert.equal((await mod.patch(`/api/threads/${tid}`, { forumId: 'f-body' })).status, 200);
  const f = await guest.get('/api/forums/f-body');
  assert.ok(f.body.sticky.some((t) => t.id === tid && t.locked));
  const actions = (await db.many("SELECT action FROM audit_log WHERE target_id = $1", [tid])).map((a) => a.action);
  assert.ok(actions.length >= 2);
});

test('reactions: one per user per post, no self-reactions, validated types', async () => {
  const r = await newThread(alice);
  const pid = r.body.postId;
  assert.equal((await alice.put(`/api/posts/${pid}/reaction`, { reaction: 'love' })).status, 403);
  assert.equal((await bob.put(`/api/posts/${pid}/reaction`, { reaction: 'evil' })).status, 422);
  assert.equal((await bob.put(`/api/posts/${pid}/reaction`, { reaction: 'love' })).status, 200);
  assert.equal((await bob.put(`/api/posts/${pid}/reaction`, { reaction: 'glow' })).status, 200);
  const list = await guest.get(`/api/posts/${pid}/reactions`);
  assert.equal(list.body.reactions.length, 1);
  assert.equal(list.body.reactions[0].reaction, 'glow');
  assert.equal((await guest.put(`/api/posts/${pid}/reaction`, { reaction: 'like' })).status, 401);
});

test('reputation: server computes value, no self/duplicate rep, negative rules, daily limit', async () => {
  const r = await newThread(alice);
  const pid = r.body.postId;
  assert.equal((await alice.post(`/api/posts/${pid}/reputation`, { positive: true })).status, 403, 'no self rep');
  assert.equal((await bob.post(`/api/posts/${pid}/reputation`, { positive: true, value: 100 })).status, 422, 'client cannot send a value');
  const ok = await bob.post(`/api/posts/${pid}/reputation`, { positive: true, comment: 'great' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.value, 1);
  assert.equal((await bob.post(`/api/posts/${pid}/reputation`, { positive: true })).status, 403, 'duplicate');
  const neg = await bob.post(`/api/threads/${r.body.thread.id}/posts`, { content: 'another' });
  assert.equal((await alice.post(`/api/posts/${neg.body.post.id}/reputation`, { positive: false, comment: 'bad' })).status, 403, 'needs 10 posts');
  const modRep = await mod.post(`/api/posts/${pid}/reputation`, { positive: true });
  assert.equal(modRep.body.value, 2, 'moderator rep power');
  const prof = await guest.get('/api/members/' + alice.user.id);
  assert.equal(prof.body.user.stats.rep, 3);
  // daily limit
  await db.query("UPDATE site_settings SET value = '1' WHERE key = 'rep_daily_limit'");
  require('../server/lib/settings').invalidate();
  const r2 = await newThread(alice);
  const lim = await bob.post(`/api/posts/${r2.body.postId}/reputation`, { positive: true });
  assert.equal(lim.status, 429);
  await db.query("UPDATE site_settings SET value = '10' WHERE key = 'rep_daily_limit'");
  require('../server/lib/settings').invalidate();
  // removal: giver or mod only
  const list = await guest.get(`/api/posts/${pid}/reputation`);
  const bobsRep = list.body.reputation.find((x) => x.giverId === bob.user.id);
  assert.equal((await alice.del(`/api/reputation/${bobsRep.id}`)).status, 403);
  assert.equal((await bob.del(`/api/reputation/${bobsRep.id}`)).status, 200);
});

test('ratings: opt-in threads only, one per member, not on own thread', async () => {
  const r = await newThread(alice, 'f-rating', { title: 'Rate me please' });
  const tid = r.body.thread.id;
  assert.equal((await alice.post(`/api/threads/${tid}/posts`, { content: 'self', rating: 10 })).status, 403);
  assert.equal((await bob.post(`/api/threads/${tid}/posts`, { content: 'nice', rating: 11 })).status, 422);
  assert.equal((await bob.post(`/api/threads/${tid}/posts`, { content: 'nice', rating: 7 })).status, 201);
  assert.equal((await bob.post(`/api/threads/${tid}/posts`, { content: 'again', rating: 9 })).status, 403);
  const v = await guest.get(`/api/threads/${tid}`);
  assert.equal(v.body.ratings[6], 1);
  const plain = await newThread(alice);
  assert.equal((await bob.post(`/api/threads/${plain.body.thread.id}/posts`, { content: 'x', rating: 5 })).status, 422);
});

test('polls: vote, duplicate prevention, single choice, foreign options, change vote, closed polls', async () => {
  const r = await newThread(alice, 'f-makeup', { title: 'Season poll', poll: { question: 'Season?', options: ['Spring', 'Summer', 'Autumn'], multiple: false } });
  assert.equal(r.status, 201);
  const tid = r.body.thread.id;
  const v = await bob.get(`/api/threads/${tid}`);
  const poll = v.body.poll;
  assert.equal(poll.options.length, 3);
  const [a, b] = poll.options.map((o) => o.id);
  assert.equal((await bob.post(`/api/polls/${poll.id}/votes`, { optionIds: [a, b] })).status, 422, 'single choice');
  const other = await newThread(alice, 'f-makeup', { title: 'Other poll', poll: { question: 'Q', options: ['x', 'y'] } });
  const otherOpt = (await bob.get(`/api/threads/${other.body.thread.id}`)).body.poll.options[0].id;
  assert.equal((await bob.post(`/api/polls/${poll.id}/votes`, { optionIds: [otherOpt] })).status, 422, 'option from another poll');
  assert.equal((await bob.post(`/api/polls/${poll.id}/votes`, { optionIds: [a] })).status, 201);
  assert.equal((await bob.post(`/api/polls/${poll.id}/votes`, { optionIds: [b] })).status, 403, 'duplicate vote');
  assert.equal((await guest.post(`/api/polls/${poll.id}/votes`, { optionIds: [a] })).status, 401);
  assert.equal((await bob.del(`/api/polls/${poll.id}/votes`)).status, 200);
  assert.equal((await bob.post(`/api/polls/${poll.id}/votes`, { optionIds: [b] })).status, 201);
  const after = (await guest.get(`/api/threads/${tid}`)).body.poll;
  assert.equal(after.voters, 1);
  assert.equal(after.options.find((o) => o.id === b).votes, 1);
  assert.equal((await alice.patch(`/api/threads/${tid}`, { pollClosed: true })).status, 200);
  assert.equal((await mod.post(`/api/polls/${poll.id}/votes`, { optionIds: [a] })).status, 403);
  assert.equal((await newThread(alice, 'f-makeup', { poll: { question: 'Q', options: ['same', 'Same'] } })).status, 422);
});

test('watch, bookmarks, read tracking', async () => {
  const r = await newThread(alice);
  const tid = r.body.thread.id;
  assert.equal((await bob.put(`/api/threads/${tid}/watch`)).status, 200);
  await alice.post(`/api/threads/${tid}/posts`, { content: 'update' });
  const n = await bob.get('/api/notifications');
  assert.ok(n.body.notifications.some((x) => x.type === 'reply' && x.link.includes(tid)));
  assert.equal((await bob.put(`/api/posts/${r.body.postId}/bookmark`)).status, 200);
  const bm = await bob.get('/api/account/bookmarks');
  assert.equal(bm.body.bookmarks.length, 1);
  const before = (await bob.get('/api/forums/f-skin')).body.threads.find((t) => t.id === tid);
  assert.equal(before.unread, true);
  await bob.get(`/api/threads/${tid}`);
  const afterRead = (await bob.get('/api/forums/f-skin')).body.threads.find((t) => t.id === tid);
  assert.equal(afterRead.unread, false);
});

test('private forum threads: invisible to guests everywhere', async () => {
  const r = await newThread(alice, 'f-private-rating', { title: 'Secret haircut rating', content: 'zebraword' });
  const tid = r.body.thread.id;
  assert.equal((await guest.get(`/api/threads/${tid}`)).status, 404);
  assert.equal((await guest.get(`/api/posts/${r.body.postId}/reactions`)).status, 404);
  const s = await guest.get('/api/search?q=zebraword');
  assert.equal(s.body.results.length, 0);
  const sm = await bob.get('/api/search?q=zebraword');
  assert.equal(sm.body.results.length, 1);
  const wn = await guest.get('/api/whats-new/posts');
  assert.ok(!wn.body.threads.some((t) => t.id === tid));
  const idx = await guest.get('/api/forums');
  assert.ok(!JSON.stringify(idx.body).includes('Secret haircut'));
});

test('no Community category: intro, success and mental health are prefixes; advice and VIP live in Looksmaxxing', async () => {
  const g = await guest.get('/api/forums');
  assert.ok(!g.body.categories.some((c) => c.id === 'c-community'));
  const ids = g.body.forums.map((f) => f.id);
  for (const gone of ['f-intro', 'f-success', 'f-wellbeing']) assert.ok(!ids.includes(gone), gone);
  assert.equal(g.body.forums.find((f) => f.id === 'f-advice').categoryId, 'c-looks');
  assert.equal(g.body.forums.find((f) => f.id === 'f-feedback').categoryId, 'c-info');
  assert.ok(!ids.includes('f-vip'), 'VIP Supporters stays hidden from guests');
  assert.ok(!(await alice.get('/api/forums')).body.forums.some((f) => f.id === 'f-vip'), 'and from members without VIP');
  const vipRow = await db.one("SELECT category_id, vip_only FROM forums WHERE id = 'f-vip'");
  assert.deepEqual(vipRow, { category_id: 'c-looks', vip_only: true });
  for (const prefix of ['intro', 'success', 'mentalhealth']) {
    assert.equal((await newThread(alice, 'f-offtopic', { title: 'Prefix ' + prefix, prefix })).status, 201, prefix);
  }
});

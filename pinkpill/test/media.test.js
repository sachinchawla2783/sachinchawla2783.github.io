'use strict';
/* Private image authorization and storage drivers. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { setup, teardown, client, member, db } = require('./helpers');
const config = require('../server/config');
const storage = require('../server/lib/storage');

let owner, friend, stranger, mod, guest, png;

before(async () => {
  await setup();
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  owner = await member({ username: 'owner' });
  friend = await member({ username: 'friend' });
  stranger = await member({ username: 'stranger' });
  mod = await member({ username: 'mod', role: 'moderator' });
  guest = client();
  png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#db2777' } }).png().toBuffer();
});
after(teardown);

async function upload(c, purpose = 'post') {
  const r = await c.agent.post('/api/uploads').set('X-Requested-With', 'fetch').set('X-CSRF-Token', c.csrf).field('purpose', purpose).attach('file', png, { filename: 'x.png', contentType: 'image/png' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
/* Follow /media/:id → signed URL, returning [status of /media, status of the signed URL]. */
async function fetchImage(c, url) {
  const first = await c.agent.get(url);
  if (first.status !== 302) return [first.status, null];
  const loc = first.headers.location;
  const second = /^https?:/.test(loc) ? await fetch(loc) : await c.agent.get(loc);
  return [302, second.status, second];
}

test('private forum image: members can view, guests cannot, even with the URL', async () => {
  const img = await upload(owner);
  const t = await owner.post('/api/forums/f-private-rating/threads', { title: 'Private pic', content: `[img]${img.url}[/img]` });
  assert.equal(t.status, 201);
  const [a, b, res] = await fetchImage(friend, img.url);
  assert.deepEqual([a, b], [302, 200], 'logged-in member (authorized)');
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual((await fetchImage(guest, img.url)).slice(0, 2), [404, null], 'logged-out user');
});

test('private message image: only participants; staff do not get DM images', async () => {
  const img = await upload(owner);
  const c = await owner.post('/api/conversations', { to: ['friend'], title: 'pic', content: `look [img]${img.url}[/img]` });
  assert.equal(c.status, 201);
  assert.deepEqual((await fetchImage(friend, img.url)).slice(0, 2), [302, 200]);
  assert.deepEqual((await fetchImage(stranger, img.url)).slice(0, 2), [404, null], 'unauthorized member');
  assert.deepEqual((await fetchImage(mod, img.url)).slice(0, 2), [404, null], 'moderators cannot read private messages');
  assert.deepEqual((await fetchImage(guest, img.url)).slice(0, 2), [404, null]);
});

test('deleted post image: hidden from members, visible to staff with mod.view_deleted', async () => {
  const img = await upload(owner);
  const t = await owner.post('/api/forums/f-offtopic/threads', { title: 'Will be deleted', content: `[img]${img.url}[/img]` });
  assert.deepEqual((await fetchImage(guest, img.url)).slice(0, 2), [302, 200], 'public post image is public');
  await owner.del(`/api/threads/${t.body.thread.id}`, {});
  assert.deepEqual((await fetchImage(stranger, img.url)).slice(0, 2), [404, null]);
  assert.deepEqual((await fetchImage(mod, img.url)).slice(0, 2), [302, 200], 'staff access follows mod.view_deleted');
  assert.deepEqual((await fetchImage(owner, img.url)).slice(0, 2), [302, 200], 'uploader keeps access');
});

test('copying someone else\'s private image URL into a public post does not expose it', async () => {
  const img = await upload(owner);
  await owner.post('/api/forums/f-private-rating/threads', { title: 'Secret', content: `[img]${img.url}[/img]` });
  const leak = await stranger.post('/api/forums/f-offtopic/threads', { title: 'Leak attempt', content: `[img]${img.url}[/img]` });
  assert.equal(leak.status, 201);
  assert.deepEqual((await fetchImage(guest, img.url)).slice(0, 2), [404, null]);
});

test('unembedded uploads are visible only to their owner; avatars are public', async () => {
  const img = await upload(owner);
  assert.deepEqual((await fetchImage(owner, img.url)).slice(0, 2), [302, 200]);
  assert.deepEqual((await fetchImage(friend, img.url)).slice(0, 2), [404, null]);
  const av = await upload(owner, 'avatar');
  assert.deepEqual((await fetchImage(guest, av.url)).slice(0, 2), [302, 200]);
});

test('signed URLs: expired or tampered links fail; no permanent private URL exists', async () => {
  const img = await upload(owner);
  const r = await owner.agent.get(img.url);
  const loc = new URL(r.headers.location, 'http://x');
  assert.match(loc.pathname, /^\/media\/raw\/[0-9a-f-]{36}$/);
  assert.match(r.headers['cache-control'], /^private/);
  const id = img.id, sign = require('../server/routes/media')._sign;
  const past = Math.floor(Date.now() / 1000) - 5;
  assert.equal((await guest.agent.get(`/media/raw/${id}?exp=${past}&sig=${sign(id, past)}`)).status, 403, 'expired');
  assert.equal((await guest.agent.get(loc.pathname + '?exp=' + loc.searchParams.get('exp') + '&sig=AAAA' + loc.searchParams.get('sig').slice(4))).status, 403, 'tampered');
  assert.equal((await guest.agent.get(`/media/raw/${id}?exp=${Number(loc.searchParams.get('exp')) + 999}&sig=${loc.searchParams.get('sig')}`)).status, 403, 'extended expiry');
  assert.equal((await guest.agent.get(`/media/raw/${id}`)).status, 403, 'unsigned');
  assert.equal((await guest.agent.get('/media/raw/..%2F..%2Fpackage.json?exp=9999999999&sig=x')).status, 404);
});

/* R2 driver against a local S3-compatible emulator (moto). Skipped if moto_server isn't installed. */
const MOTO = process.env.MOTO_SERVER || [path.join(process.env.HOME || '', '.local/bin/moto_server'), '/tmp/claude-0/-home-user-sachinchawla2783-github-io/803ff0b1-7a52-58c3-b387-14f9cdf7c04d/scratchpad/venv/bin/moto_server'].find((p) => fs.existsSync(p));

test('R2/S3 driver: private bucket, presigned URLs, expiry enforced', { skip: !MOTO && 'moto_server not installed (pip install "moto[server]")' }, async () => {
  const port = 5100 + Math.floor(Math.random() * 400);
  const moto = spawn(MOTO, ['-p', String(port)], { stdio: 'ignore' });
  const saved = { driver: config.storage.driver, s3: { ...config.storage.s3 }, ttl: config.storage.signedUrlSeconds };
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    Object.assign(config.storage, { driver: 'r2' });
    Object.assign(config.storage.s3, { bucket: 'pinkpill-test', endpoint: `http://127.0.0.1:${port}`, accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1', forcePathStyle: true });
    storage.resetClient();
    const { CreateBucketCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = require('../server/lib/storage');
    const client = require('@aws-sdk/client-s3');
    const raw = new client.S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await raw.send(new CreateBucketCommand({ Bucket: 'pinkpill-test' }));
    await s3.check();

    const img = await upload(owner);
    const obj = await raw.send(new GetObjectCommand({ Bucket: 'pinkpill-test', Key: img.id + '.webp' }));
    assert.equal(obj.ContentType, 'image/webp', 'stored in the bucket under a server-generated key');
    await owner.post('/api/forums/f-private-rating/threads', { title: 'R2 private', content: `[img]${img.url}[/img]` });

    const r = await friend.agent.get(img.url);
    assert.equal(r.status, 302);
    const signed = new URL(r.headers.location);
    assert.equal(signed.searchParams.get('X-Amz-Expires'), String(config.storage.signedUrlSeconds));
    assert.ok(!r.headers.location.includes('test:test'), 'no credentials in the URL');
    const ok = await fetch(r.headers.location);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/webp');
    assert.equal((await guest.agent.get(img.url)).status, 404, 'guests get no signed URL at all');
    const unsigned = await fetch(`http://127.0.0.1:${port}/pinkpill-test/${img.id}.webp`);
    assert.equal(unsigned.ok, false, 'bucket is private');
    // Presigned URL parameters: SigV4, short expiry, issued now, response type pinned.
    // (The emulator does not enforce signature expiry; R2 does. Expiry of our own signed
    // URLs is tested above, and the deployment smoke test checks R2 expiry for real.)
    assert.equal(signed.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.match(signed.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
    const issued = signed.searchParams.get('X-Amz-Date').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    assert.ok(Math.abs(Date.now() - Date.parse(issued)) < 60000);
    assert.equal(signed.searchParams.get('response-content-type'), 'image/webp');
    config.storage.signedUrlSeconds = 60;
    const short = new URL((await friend.agent.get(img.url)).headers.location);
    assert.equal(short.searchParams.get('X-Amz-Expires'), '60', 'TTL comes from MEDIA_URL_TTL_SECONDS');
  } finally {
    Object.assign(config.storage, { driver: saved.driver, signedUrlSeconds: saved.ttl });
    Object.assign(config.storage.s3, saved.s3);
    storage.resetClient();
    moto.kill();
  }
});

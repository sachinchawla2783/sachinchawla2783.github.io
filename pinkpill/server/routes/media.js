'use strict';
/* GET /media/:uuid
 *   1. look up the attachment and authorise the current viewer (see lib/attachments.js);
 *      anything the viewer may not see is a 404, indistinguishable from a missing image;
 *   2. redirect to a short-lived signed URL:
 *        R2/S3 → presigned GET on the private bucket (expires after MEDIA_URL_TTL_SECONDS);
 *        local → /media/raw/:uuid?exp=…&sig=… (HMAC, same lifetime), served by this app.
 * Nothing here ever returns a permanent URL for a private image. */
const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const storage = require('../lib/storage');
const { canView } = require('../lib/attachments');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Local signing key: MEDIA_SIGNING_SECRET if provided, else random per process (links are short-lived anyway).
const SIGNING_KEY = process.env.MEDIA_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (id, exp) => crypto.createHmac('sha256', SIGNING_KEY).update(id + ':' + exp).digest('base64url');

router.get('/raw/:id', async (req, res, next) => {
  const id = String(req.params.id);
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || '');
  if (!UUID.test(id) || !storage.isLocal()) return res.status(404).end();
  const expected = sign(id, exp);
  const valid = Number.isFinite(exp) && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid || exp < Math.floor(Date.now() / 1000)) return res.status(403).set('Cache-Control', 'no-store').end();
  const a = await db.one('SELECT storage_key, mime, bytes FROM attachments WHERE id = $1', [id]);
  if (!a) return res.status(404).end();
  const body = await storage.get(a.storage_key);
  if (!body) return res.status(404).end();
  res.set({
    'Content-Type': a.mime, 'Content-Length': String(a.bytes), 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline',
    'Cache-Control': `private, max-age=${Math.max(0, exp - Math.floor(Date.now() / 1000))}`, 'Cross-Origin-Resource-Policy': 'same-origin',
  });
  body.on('error', next);
  body.pipe(res);
});

router.get('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) return res.status(404).end();
  const a = await db.one('SELECT id, owner_id, purpose, storage_key, mime FROM attachments WHERE id = $1', [id]);
  if (!a || !(await canView(a, req.user))) return res.status(404).set('Cache-Control', 'no-store').end();
  const ttl = config.storage.signedUrlSeconds;
  const url = storage.isLocal()
    ? (() => { const exp = Math.floor(Date.now() / 1000) + ttl; return `/media/raw/${id}?exp=${exp}&sig=${sign(id, exp)}`; })()
    : await storage.signedUrl(a.storage_key, ttl, a.mime);
  // Let the browser reuse the redirect briefly, but never share it between users.
  res.set('Cache-Control', `private, max-age=${Math.max(0, ttl - 60)}`);
  res.set('Vary', 'Cookie');
  res.redirect(302, url);
});

module.exports = router;
module.exports._sign = sign;

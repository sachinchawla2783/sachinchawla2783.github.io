'use strict';
const express = require('express');
const db = require('../db');
const storage = require('../lib/storage');

const router = express.Router();

/* Serves uploaded images by UUID. The type is fixed server-side and the response can't execute. */
router.get('/:id', async (req, res, next) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return res.status(404).end();
  const a = await db.one('SELECT storage_key, mime, bytes FROM attachments WHERE id = $1', [id]);
  if (!a) return res.status(404).end();
  const body = await storage.get(a.storage_key);
  if (!body) return res.status(404).end();
  res.set({
    'Content-Type': a.mime,
    'Content-Length': String(a.bytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  body.on('error', next);
  body.pipe(res);
});

module.exports = router;

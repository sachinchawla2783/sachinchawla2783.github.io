'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { assertCan } = require('../lib/permissions');
const { invalid } = require('../lib/errors');
const { processImage } = require('../lib/images');
const storage = require('../lib/storage');
const limits = require('../lib/limits');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 2, parts: 3 } });

// Auth + permission are checked BEFORE the body is parsed, so anonymous users can't make us buffer files.
router.post('/uploads', (req, res, next) => { try { assertCan(req.user, 'upload.image'); next(); } catch (e) { next(e); } },
  limits.upload, upload.single('file'), async (req, res) => {
    const purpose = String((req.body && req.body.purpose) || '');
    if (!['avatar', 'banner', 'post'].includes(purpose)) throw invalid('Invalid upload purpose.');
    if (!req.file) throw invalid('Please choose an image.');
    const img = await processImage(req.file.buffer, purpose);
    const id = crypto.randomUUID();
    const key = id + '.webp';
    await storage.put(key, img.buffer, 'image/webp');
    try {
      await db.query(`INSERT INTO attachments (id, owner_id, purpose, storage_key, mime, bytes, width, height, sha256)
        VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, $8)`, [id, req.user.id, purpose, key, img.bytes, img.width, img.height, img.sha256]);
    } catch (e) { await storage.remove(key).catch(() => {}); throw e; }
    res.status(201).json({ id, url: '/media/' + id, width: img.width, height: img.height });
  });

module.exports = router;

'use strict';
/* Decode, validate and re-encode an uploaded image. Re-encoding to WebP strips metadata (EXIF/GPS)
   and guarantees the stored bytes are a plain image, never a script or polyglot file. */
const sharp = require('sharp');
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const config = require('../config');

// Koyeb free has 512 MB RAM: no libvips cache, one thread, and a cap on decoded pixels
// (24 MP ≈ 96 MB as RGBA), plus a queue so only IMAGE_CONCURRENCY images decode at once.
sharp.cache(false);
sharp.concurrency(1);
const MAX_PIXELS = 24e6;
let active = 0;
const waiting = [];
async function slot() {
  if (active < Math.max(1, config.imageConcurrency)) { active++; return; }
  if (waiting.length > 20) throw new HttpError(503, 'busy', 'The server is busy processing images. Please try again shortly.');
  await new Promise((r) => waiting.push(r));
  active++;
}
function release() { active--; const next = waiting.shift(); if (next) next(); }

const PRESETS = {
  avatar: { width: 256, height: 256, fit: 'cover' },
  banner: { width: 1500, height: 500, fit: 'cover' },
  post: { width: 1600, height: 1600, fit: 'inside' },
};
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif']);

async function processImage(buffer, purpose) {
  await slot();
  try { return await processImageInner(buffer, purpose); } finally { release(); }
}

async function processImageInner(buffer, purpose) {
  let meta;
  try { meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { throw new HttpError(415, 'unsupported_media', 'That file is not a valid image.'); }
  if (!ALLOWED.has(meta.format)) throw new HttpError(415, 'unsupported_media', 'Only JPEG, PNG, WebP and GIF images are allowed.');
  if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) throw new HttpError(422, 'validation_failed', 'That image is too small.');
  const p = PRESETS[purpose];
  const out = await sharp(buffer, { limitInputPixels: MAX_PIXELS, animated: false })
    .rotate()
    .resize({ width: p.width, height: p.height, fit: p.fit, withoutEnlargement: p.fit === 'inside' })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height, bytes: out.data.length, sha256: crypto.createHash('sha256').update(out.data).digest('hex') };
}

module.exports = { processImage, PRESETS };

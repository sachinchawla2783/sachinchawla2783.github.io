'use strict';
/* Storage drivers for uploaded images.
 *   local  development: files in STORAGE_DIR (outside the web root)
 *   r2     production: private Cloudflare R2 bucket via its S3-compatible API
 *   s3     any other S3-compatible service
 * Object keys are server-generated "<uuid>.webp" only; user input never becomes a key or path.
 * Buckets stay private: the browser only ever gets short-lived presigned GET URLs, issued after
 * the media route has authorised the request. Credentials never leave the server. */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const config = require('../config');

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const assertKey = (key) => { if (!KEY_RE.test(key)) throw new Error('Invalid storage key'); };

const local = {
  name: 'local',
  async put(key, buffer) {
    assertKey(key);
    await fs.mkdir(config.storage.localDir, { recursive: true });
    await fs.writeFile(path.join(config.storage.localDir, key), buffer, { flag: 'wx', mode: 0o640 });
  },
  async get(key) {
    assertKey(key);
    const file = path.join(config.storage.localDir, key);
    try { await fs.access(file); } catch { return null; }
    return fss.createReadStream(file);
  },
  async remove(key) { assertKey(key); await fs.rm(path.join(config.storage.localDir, key), { force: true }); },
  async check() { await fs.mkdir(config.storage.localDir, { recursive: true }); },
};

let s3client = null;
function s3() {
  if (!s3client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const c = config.storage.s3;
    s3client = new S3Client({
      region: c.region, endpoint: c.endpoint || undefined, forcePathStyle: c.forcePathStyle,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3client;
}

const s3driver = {
  name: config.storage.driver,
  async put(key, buffer, mime) {
    assertKey(key);
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new PutObjectCommand({ Bucket: config.storage.s3.bucket, Key: key, Body: buffer, ContentType: mime, CacheControl: 'private, max-age=31536000, immutable' }));
  },
  async remove(key) {
    assertKey(key);
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
  },
  /* Short-lived presigned GET URL; the response headers are pinned so the object can't be served as HTML. */
  async signedUrl(key, seconds, mime) {
    assertKey(key);
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(s3(), new GetObjectCommand({
      Bucket: config.storage.s3.bucket, Key: key,
      ResponseContentType: mime, ResponseContentDisposition: 'inline', ResponseCacheControl: `private, max-age=${seconds}`,
    }), { expiresIn: seconds });
  },
  async check() {
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    await s3().send(new HeadBucketCommand({ Bucket: config.storage.s3.bucket }));
  },
  _client: () => s3(),
};

function driver() { return config.storage.driver === 'local' ? local : s3driver; }

/* Delegate at call time so tests (and a config change) can switch drivers. */
module.exports = {
  put: (...a) => driver().put(...a),
  remove: (...a) => driver().remove(...a),
  get: (...a) => local.get(...a),
  signedUrl: (...a) => s3driver.signedUrl(...a),
  check: (...a) => driver().check(...a),
  isLocal: () => driver() === local,
  resetClient: () => { s3client = null; },
  KEY_RE,
};

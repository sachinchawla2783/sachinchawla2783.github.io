'use strict';
/* Storage drivers for uploaded images. Keys are server-generated UUID file names only
   (never user input), and files live outside the public web root. */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const config = require('../config');

const KEY_RE = /^[0-9a-f-]{36}\.webp$/;
const assertKey = (key) => { if (!KEY_RE.test(key)) throw new Error('Invalid storage key'); };

const local = {
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
};

let s3client = null;
function s3() {
  if (!s3client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const c = config.storage.s3;
    s3client = new S3Client({ region: c.region, endpoint: c.endpoint || undefined, forcePathStyle: !!c.endpoint, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
  }
  return s3client;
}
const s3driver = {
  async put(key, buffer, mime) {
    assertKey(key);
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new PutObjectCommand({ Bucket: config.storage.s3.bucket, Key: key, Body: buffer, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
  },
  async get(key) {
    assertKey(key);
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    try { return (await s3().send(new GetObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }))).Body; } catch (e) { if (e.name === 'NoSuchKey') return null; throw e; }
  },
  async remove(key) {
    assertKey(key);
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
  },
};

module.exports = config.storage.driver === 's3' ? s3driver : local;

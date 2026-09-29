'use strict';
/* Thin wrappers around vetted primitives: argon2 (Argon2id) and node:crypto. No custom crypto. */
const argon2 = require('argon2');
const crypto = require('node:crypto');

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP baseline

const hashPassword = (pw) => argon2.hash(pw, ARGON);
async function verifyPassword(hash, pw) {
  if (!hash) return false;
  try { return await argon2.verify(hash, pw); } catch { return false; }
}
// Used to keep login timing similar when the account doesn't exist.
let dummyHash = null;
async function dummyVerify(pw) { dummyHash = dummyHash || await hashPassword('not-a-real-password'); await verifyPassword(dummyHash, pw); }

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { hashPassword, verifyPassword, dummyVerify, randomToken, sha256, safeEqual };

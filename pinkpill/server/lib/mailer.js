'use strict';
/* Transactional email.
 *   resend  (production) → Resend HTTP API, https://api.resend.com/emails
 *   file    (development) → one .txt file per email in MAIL_DIR (links are clickable there)
 *   memory  (tests) → kept in `outbox`
 *   console (development) → prints recipient and subject only; links are redacted
 * Tokens and message bodies are never written to logs. Each recipient can receive at most
 * MAX_PER_HOUR emails of each kind per hour, so the endpoints can't be used to mail-bomb someone. */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const log = require('./log');

const outbox = [];
const MAX_PER_HOUR = 3;
const recent = new Map();   // kind:email -> [timestamps]

function allow(kind, to) {
  const key = kind + ':' + String(to).toLowerCase();
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 3600 * 1000);
  if (list.length >= MAX_PER_HOUR) { recent.set(key, list); return false; }
  list.push(now); recent.set(key, list);
  if (recent.size > 20000) recent.clear();
  return true;
}

const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

async function deliver({ to, subject, text, kind }) {
  const t = config.mail.transport;
  if (t === 'memory') { outbox.push({ to, subject, text, kind, sentAt: new Date() }); if (outbox.length > 200) outbox.shift(); return; }
  if (t === 'file') {
    fs.mkdirSync(config.mail.dir, { recursive: true });
    fs.writeFileSync(path.join(config.mail.dir, Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt'), `To: ${to}\nSubject: ${subject}\n\n${text}`, { mode: 0o600 });
    return;
  }
  if (t === 'console') { process.stdout.write(`[mail] ${kind} email to ${to}: "${subject}" (links redacted; use MAIL_TRANSPORT=file to read them)\n`); return; }
  if (t === 'resend') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(config.mail.resendApiUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.mail.resendApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mail.from, to: [to], subject, text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let code = '';
        try { const j = await res.json(); code = j.name || j.error || ''; } catch { /* ignore */ }
        throw new Error(`Resend responded ${res.status} ${code}`.trim());
      }
    } finally { clearTimeout(timer); }
  }
}

/* Returns true if the email was handed to the transport, false if rate-limited or failed. */
async function send(msg) {
  if (!allow(msg.kind, msg.to)) { log.warn('mail.rate_limited', { kind: msg.kind, to: maskEmail(msg.to) }); return false; }
  try {
    await deliver(msg);
    log.info('mail.sent', { kind: msg.kind, to: maskEmail(msg.to), transport: config.mail.transport });
    return true;
  } catch (err) {
    log.error('mail.failed', { kind: msg.kind, to: maskEmail(msg.to), message: err.message });
    return false;
  }
}

const link = (hashPath) => config.appUrl + '/#' + hashPath;

module.exports = {
  outbox,
  _reset: () => { recent.clear(); outbox.length = 0; },
  sendVerification: (to, username, token) => send({ kind: 'verification', to, subject: 'Verify your PinkPill email',
    text: `Hi ${username},\n\nConfirm your email address to start posting on PinkPill:\n${link('/verify-email?token=' + token)}\n\nThis link expires in 48 hours and can only be used once. If you didn't sign up, you can ignore this email.` }),
  sendPasswordReset: (to, username, token) => send({ kind: 'reset', to, subject: 'Reset your PinkPill password',
    text: `Hi ${username},\n\nSomeone (hopefully you) asked to reset your PinkPill password:\n${link('/reset-password?token=' + token)}\n\nThis link expires in 1 hour and can only be used once. If you didn't ask for this, you can ignore this email; your password hasn't changed.` }),
  sendPasswordChanged: (to, username) => send({ kind: 'notice', to, subject: 'Your PinkPill password was changed',
    text: `Hi ${username},\n\nThe password for your PinkPill account was just changed and your other devices were signed out.\n\nIf this wasn't you, reset your password immediately at ${link('/lost-password')} and contact the site administrators.` }),
};

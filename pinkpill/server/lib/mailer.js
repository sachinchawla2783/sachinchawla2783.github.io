'use strict';
const config = require('../config');

/* Outbox kept in memory for the `memory` transport (tests) and for inspection in development. */
const outbox = [];
let transporter = null;

async function send({ to, subject, text }) {
  const msg = { from: config.mail.from, to, subject, text };
  if (config.mail.transport === 'smtp') {
    if (!transporter) transporter = require('nodemailer').createTransport(config.mail.smtpUrl);
    await transporter.sendMail(msg);
    return;
  }
  outbox.push(Object.assign({ sentAt: new Date() }, msg));
  if (outbox.length > 100) outbox.shift();
  if (config.mail.transport === 'console') console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
}

const link = (hashPath) => config.appUrl + '/#' + hashPath;

module.exports = {
  outbox,
  sendVerification: (to, username, token) => send({ to, subject: 'Verify your PinkPill email',
    text: `Hi ${username},\n\nConfirm your email address to start posting on PinkPill:\n${link('/verify-email?token=' + token)}\n\nThis link expires in 48 hours. If you didn't sign up, ignore this email.` }),
  sendPasswordReset: (to, username, token) => send({ to, subject: 'Reset your PinkPill password',
    text: `Hi ${username},\n\nSomeone (hopefully you) asked to reset your PinkPill password:\n${link('/reset-password?token=' + token)}\n\nThis link expires in 1 hour and can only be used once. If you didn't ask for this, you can ignore this email.` }),
};

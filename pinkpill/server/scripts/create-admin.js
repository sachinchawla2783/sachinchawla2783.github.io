'use strict';
/* Create (or promote) a super administrator from the command line. No credentials live in code.
   Usage: npm run create-admin -- --username NAME --email EMAIL      (prompts for the password)
          npm run create-admin -- --promote NAME                      (existing account)
   The password can also be piped: echo "pw" | npm run create-admin -- --username ... --password-stdin */
const readline = require('node:readline');
const db = require('../db');
const { migrate } = require('../db/migrate');
const { hashPassword } = require('../lib/crypto');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) rl._writeToOutput = (s) => { if (!s.includes(question)) rl.output.write('*'); else rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  await migrate(db.pool, { log: () => {} });
  if (args.promote) {
    const r = await db.query(`UPDATE users SET role_id = 'super_admin' WHERE username = $1 AND status <> 'deleted'`, [args.promote]);
    console.log(r.rowCount ? `Promoted ${args.promote} to super administrator.` : 'No such user.');
    return;
  }
  const username = args.username || await ask('Username: ');
  const email = (args.email || await ask('Email: ')).toLowerCase();
  const password = args['password-stdin'] ? (await ask('')).trim() : await ask('Password (min 12 chars): ', true);
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) throw new Error('Invalid username.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email.');
  if (password.length < 12) throw new Error('Admin passwords must be at least 12 characters.');
  await db.tx(async (q) => {
    const u = await q.one(`INSERT INTO users (username, email, password_hash, role_id, status, email_verified_at)
      VALUES ($1, $2, $3, 'super_admin', 'active', now()) RETURNING id`, [username, email, await hashPassword(password)]);
    await q.query('INSERT INTO profiles (user_id, custom_title) VALUES ($1, $2)', [u.id, 'Founder']);
    await q.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [u.id]);
    await q.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (NULL, 'admin.created_via_cli', 'user', $1)`, [u.id]);
  });
  console.log(`Super administrator ${username} created.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.pool.end());

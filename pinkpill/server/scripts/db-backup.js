'use strict';
/* Export the whole database with pg_dump (custom format, compressed).
 *   npm run db:backup                          → backups/pinkpill-<timestamp>.dump from DATABASE_URL
 *   npm run db:backup -- --url <URL> --out f   → explicit source / output file
 * Needs pg_dump from PostgreSQL >= the server's major version (see DEPLOYMENT.md).
 * The password is passed via PGPASSWORD, so it doesn't show up in the process list. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; }

function connEnv(url) {
  const u = new URL(url);
  const env = Object.assign({}, process.env, { PGPASSWORD: decodeURIComponent(u.password) });
  if (u.searchParams.get('sslmode')) env.PGSSLMODE = u.searchParams.get('sslmode');
  u.password = '';
  u.searchParams.delete('sslmode'); u.searchParams.delete('channel_binding');
  return { env, url: u.toString() };
}

function backup(url, out) {
  const { env, url: safe } = connEnv(url);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', out, '--dbname', safe], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new Error('Could not run pg_dump: ' + r.error.message + ' (install the PostgreSQL client tools).');
  if (r.status !== 0) throw new Error('pg_dump failed with exit code ' + r.status);
  fs.chmodSync(out, 0o600);
  return { file: out, bytes: fs.statSync(out).size };
}

module.exports = { backup, connEnv };

if (require.main === module) {
  if (process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, '..', '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
  const url = arg('url') || process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { process.stderr.write('Set DATABASE_URL (or pass --url).\n'); process.exit(1); }
  const out = arg('out') || path.join(__dirname, '..', '..', 'backups', `pinkpill-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  try {
    const r = backup(url, out);
    process.stdout.write(`Backup written: ${r.file} (${(r.bytes / 1024).toFixed(1)} KB)\nStore it somewhere safe and off the server; it contains personal data.\n`);
  } catch (e) { process.stderr.write(e.message + '\n'); process.exit(1); }
}

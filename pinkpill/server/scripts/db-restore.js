'use strict';
/* Restore a pg_dump backup into a database you name explicitly.
 *   npm run db:restore -- <backup.dump> --target <DATABASE URL>
 * It never defaults to DATABASE_URL, and refuses to restore over the database in DATABASE_URL unless
 * --overwrite-production is also given. Restore into an EMPTY database (e.g. a new Neon branch or a
 * local test database), check it, then point the app at it. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { connEnv } = require('./db-backup');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; }

function restore(file, target) {
  const { env, url } = connEnv(target);
  const r = spawnSync('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', '--dbname', url, file], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new Error('Could not run pg_restore: ' + r.error.message);
  if (r.status !== 0) throw new Error('pg_restore failed with exit code ' + r.status + ' (is the target database empty?)');
}

module.exports = { restore };

if (require.main === module) {
  if (process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, '..', '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
  const file = process.argv[2];
  const target = arg('target');
  if (!file || !fs.existsSync(file) || !target) { process.stderr.write('Usage: npm run db:restore -- <backup.dump> --target <DATABASE URL>\n'); process.exit(1); }
  const norm = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u; } };
  if (process.env.DATABASE_URL && norm(target) === norm(process.env.DATABASE_URL) && !process.argv.includes('--overwrite-production')) {
    process.stderr.write('Refusing to restore over the database in DATABASE_URL. Restore into a separate database first.\n');
    process.exit(1);
  }
  try { restore(file, target); process.stdout.write('Restore complete.\n'); } catch (e) { process.stderr.write(e.message + '\n'); process.exit(1); }
}

'use strict';
/* Forward-only migrations: server/db/migrations/NNN_name.sql, applied in filename order, each in its
 * own transaction, recorded in schema_migrations. A PostgreSQL advisory lock makes concurrent runs
 * (two instances starting at once, or a manual run during a deploy) wait instead of racing.
 * Nothing here ever drops or resets data; a failed migration rolls back and stops the process.
 *   npm run db:migrate   apply pending migrations
 *   npm run db:status    list applied and pending migrations */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCK_ID = 7201984511; // arbitrary constant shared by every PinkPill process
const DIR = path.join(__dirname, 'migrations');

function files() {
  return fs.readdirSync(DIR).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();
}
const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
}

async function migrate(pool, { log = (m) => process.stdout.write(m + '\n') } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);
    const done = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    for (const file of files()) {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      if (done.has(file)) {
        const prev = done.get(file);
        if (prev && prev !== checksum(sql)) log(`[migrate] WARNING: ${file} changed after it was applied (migrations must never be edited).`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum(sql)]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
      }
      applied.push(file);
      log(`[migrate] applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}

async function status(pool) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const done = new Map((await client.query('SELECT name, applied_at FROM schema_migrations')).rows.map((r) => [r.name, r.applied_at]));
    return files().map((f) => ({ name: f, appliedAt: done.get(f) || null }));
  } finally { client.release(); }
}

module.exports = { migrate, status };

if (require.main === module) {
  const { pool } = require('./index');
  const cmd = process.argv[2] || 'up';
  (async () => {
    if (cmd === 'status') {
      const rows = await status(pool);
      rows.forEach((r) => process.stdout.write(`${r.appliedAt ? 'applied ' + r.appliedAt.toISOString() : 'PENDING                         '}  ${r.name}\n`));
      process.stdout.write(`${rows.filter((r) => !r.appliedAt).length} pending\n`);
    } else {
      const applied = await migrate(pool);
      process.stdout.write(applied.length ? `[migrate] ${applied.length} migration(s) applied\n` : '[migrate] already up to date\n');
    }
  })().then(() => pool.end()).catch(async (err) => { process.stderr.write(err.message + '\n'); await pool.end().catch(() => {}); process.exit(1); });
}

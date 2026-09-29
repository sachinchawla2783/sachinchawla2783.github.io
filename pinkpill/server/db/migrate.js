'use strict';
/* Applies server/db/migrations/*.sql in filename order, each in its own transaction. */
const fs = require('node:fs');
const path = require('node:path');

async function migrate(pool, { log = console.log } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = { migrate };

if (require.main === module) {
  const { pool } = require('./index');
  migrate(pool).then(() => { console.log('[migrate] up to date'); return pool.end(); })
    .catch((err) => { console.error(err.message); process.exit(1); });
}

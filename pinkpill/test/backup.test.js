'use strict';
/* Backup → restore round trip into a separate, freshly created database. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { setup, teardown, member, db } = require('./helpers');

const hasTools = spawnSync('pg_dump', ['--version']).status === 0 && spawnSync('pg_restore', ['--version']).status === 0;

before(setup);
after(teardown);

test('db:backup and db:restore round-trip into a separate database', { skip: !hasTools && 'pg_dump/pg_restore not installed' }, async () => {
  const c = await member({ username: 'backedup' });
  await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  const t = await c.post('/api/forums/f-offtopic/threads', { title: 'Survives backups', content: 'hello from before the backup' });
  assert.equal(t.status, 201);
  const src = process.env.DATABASE_URL_TEST;
  const out = path.join(os.tmpdir(), `pinkpill-test-${process.pid}.dump`);
  const { backup } = require('../server/scripts/db-backup');
  const { restore } = require('../server/scripts/db-restore');
  const r = backup(src, out);
  assert.ok(r.bytes > 1000);
  assert.equal((fs.statSync(out).mode & 0o777).toString(8), '600', 'backup file is private');

  const dbName = 'pinkpill_restore_' + process.pid;
  const admin = new Client({ connectionString: src });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const target = src.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  try {
    restore(out, target);
    const check = new Client({ connectionString: target });
    await check.connect();
    const thread = (await check.query("SELECT t.title, p.content FROM threads t JOIN posts p ON p.id = t.first_post_id WHERE t.title = 'Survives backups'")).rows[0];
    assert.equal(thread.content, 'hello from before the backup');
    const counts = (await check.query('SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM forums)::int AS f, (SELECT count(*) FROM schema_migrations)::int AS m')).rows[0];
    const orig = await db.one('SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM forums)::int AS f, (SELECT count(*) FROM schema_migrations)::int AS m');
    assert.deepEqual(counts, orig);
    await check.end();
  } finally {
    fs.rmSync(out, { force: true });
    const cleanup = new Client({ connectionString: src });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await cleanup.end();
  }
});

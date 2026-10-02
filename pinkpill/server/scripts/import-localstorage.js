'use strict';
/* Import a prototype export (Admin → Data → Export in the old localStorage version, or the raw value
   of localStorage['pinkpill.db.v1']) into the database.
   Usage: npm run import:localstorage -- path/to/pinkpill-backup.json
   Imported admins become administrators (never super administrators). */
const fs = require('node:fs');
const db = require('../db');
const { migrate } = require('../db/migrate');
const { importLegacy } = require('../lib/importer');

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import:localstorage -- <export.json>');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await migrate(db.pool, { log: () => {} });
  const r = await db.tx(async (q) => {
    const out = await importLegacy(q, data, { actorId: null });
    await q.query(`INSERT INTO audit_log (actor_id, action, target_type, details) VALUES (NULL, 'data.import', 'import', $1)`, [JSON.stringify({ imported: out.imported, skipped: out.skipped.length, via: 'cli' })]);
    return out;
  });
  console.log('Imported:', r.imported);
  if (r.skipped.length) console.log('Skipped:\n  ' + r.skipped.join('\n  '));
  console.log('Imported members have no password: they should use "Forgot your password?" to claim their accounts.');
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.pool.end());

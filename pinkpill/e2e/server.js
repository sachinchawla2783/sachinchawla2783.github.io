'use strict';
/* Starts a fresh PinkPill server for Playwright: clean e2e database, file-based mail outbox. */
const path = require('node:path');
const fs = require('node:fs');
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.E2E_PORT || '3200';
process.env.APP_URL = 'http://localhost:' + process.env.PORT;
process.env.DATABASE_URL = process.env.DATABASE_URL_E2E || 'postgres://pinkpill:pinkpill@localhost:5432/pinkpill_e2e';
process.env.MAIL_TRANSPORT = 'file';
process.env.MAIL_DIR = path.join(__dirname, '..', 'storage', 'e2e-mail');
process.env.STORAGE_DIR = path.join(__dirname, '..', 'storage', 'e2e-uploads');
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.RATE_LIMITS = 'false';

(async () => {
  if (process.env.E2E_KEEP_DB !== '1') {
    fs.rmSync(process.env.MAIL_DIR, { recursive: true, force: true });
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
    const db = require('../server/db');
    await require('../server/db/migrate').migrate(db.pool, { log: () => {} });
    await db.query("UPDATE site_settings SET value = '0' WHERE key = 'flood_seconds'");
  }
  require('../server/index.js');
})().catch((e) => { console.error(e); process.exit(1); });

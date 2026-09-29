'use strict';
const config = require('./config');
const { pool } = require('./db');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');

(async () => {
  await migrate(pool);
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`PinkPill listening on ${config.appUrl} (port ${config.port}, ${config.env})`));
  // Clean up expired sessions and tokens hourly.
  setInterval(() => {
    pool.query(`DELETE FROM sessions WHERE expires_at < now();
      DELETE FROM password_resets WHERE expires_at < now() - interval '1 day';
      DELETE FROM email_verifications WHERE expires_at < now() - interval '1 day';`).catch((e) => console.error(e.message));
  }, 3600 * 1000).unref();
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((err) => { console.error(err); process.exit(1); });

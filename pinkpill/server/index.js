'use strict';
/* Process entry point: migrate (optional), listen on 0.0.0.0:$PORT, shut down gracefully. */
const config = require('./config');
const db = require('./db');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');
const log = require('./lib/log');

let server = null;
let shuttingDown = false;

async function start() {
  if (config.migrateOnStart) await migrate(db.pool, { log: (m) => log.info('migrate', { message: m }) });
  const app = createApp({ isShuttingDown: () => shuttingDown });
  server = app.listen(config.port, config.host, () => log.info('server.listening', { host: config.host, port: config.port, env: config.env, appUrl: config.appUrl }));
  // Slightly above the typical proxy idle timeout so the proxy closes first.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 60000;
}

/* SIGTERM (Render redeploy/spin-down) or SIGINT: stop accepting connections, let in-flight requests
   finish (up to SHUTDOWN_TIMEOUT_MS), then close the database pool and exit. */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server.shutdown_started', { signal });
  const force = setTimeout(() => {
    log.warn('server.shutdown_forced', { timeoutMs: config.shutdownTimeoutMs });
    if (server) server.closeAllConnections();
  }, config.shutdownTimeoutMs);
  force.unref();
  try {
    if (server) {
      await new Promise((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); });
    }
    await db.pool.end();
    log.info('server.shutdown_complete', {});
    process.exit(0);
  } catch (err) {
    log.error('server.shutdown_error', { message: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('process.unhandled_rejection', { message: err && err.message, stack: err && err.stack }));
process.on('uncaughtException', (err) => { log.error('process.uncaught_exception', { message: err.message, stack: err.stack }); process.exit(1); });

start().catch((err) => {
  log.error('server.start_failed', { message: err.message });
  process.exit(1);
});

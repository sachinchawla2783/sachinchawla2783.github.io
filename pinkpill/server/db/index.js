'use strict';
/* PostgreSQL access through one bounded connection pool (never a connection per request).
 * Tuned for serverless Postgres (Neon) that may scale to zero: short idle timeout so connections are
 * released when the site is quiet, a connect timeout long enough for a cold start, and retries only
 * for failures while *opening* a connection (safe: no statement has run yet). Query errors are never
 * swallowed; they propagate to the caller and the request's error handler. */
const { Pool, types } = require('pg');
const config = require('../config');
const log = require('../lib/log');

// Return bigint ids as strings (JS numbers can't hold all int8 values); counts are cast in SQL.
types.setTypeParser(20, (v) => v);

function poolOptions() {
  let connectionString = config.databaseUrl;
  let ssl;
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get('sslmode');
    if (mode || config.db.ssl) {
      // Configure TLS explicitly (and drop sslmode from the URL so pg doesn't override it).
      u.searchParams.delete('sslmode');
      u.searchParams.delete('channel_binding');
      connectionString = u.toString();
      if (mode !== 'disable') ssl = { rejectUnauthorized: config.db.sslRejectUnauthorized };
    }
  } catch { /* not a URL; let pg report it */ }
  return {
    connectionString, ssl,
    max: config.db.poolMax,
    idleTimeoutMillis: config.db.idleTimeoutMs,
    connectionTimeoutMillis: config.db.connectionTimeoutMs,
    statement_timeout: config.db.statementTimeoutMs,
    query_timeout: config.db.statementTimeoutMs + 5000,
    application_name: 'pinkpill',
    keepAlive: true,
  };
}

const pool = new Pool(poolOptions());

// An idle client can be terminated by the server (e.g. Neon scaling to zero). Without this handler
// the 'error' event would crash the process; the pool discards the client and opens a new one later.
pool.on('error', (err) => log.warn('db.idle_client_error', { code: err.code, message: err.message }));

const TRANSIENT = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P03', '08000', '08001', '08003', '08006', '53300']);
const isTransient = (err) => TRANSIENT.has(err.code) || /timeout exceeded when trying to connect|Connection terminated|connection error/i.test(err.message || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Acquire a pooled client, retrying transient connect failures (e.g. a database waking up). */
async function connect() {
  const delays = [300, 1000, 2500];
  for (let attempt = 0; ; attempt++) {
    try {
      return await pool.connect();
    } catch (err) {
      if (!isTransient(err) || attempt >= delays.length) {
        log.error('db.connect_failed', { code: err.code, message: err.message, attempts: attempt + 1 });
        throw err;
      }
      log.warn('db.connect_retry', { code: err.code, attempt: attempt + 1 });
      await sleep(delays[attempt]);
    }
  }
}

async function query(text, params) {
  const client = await connect();
  let broken;
  try {
    return await client.query(text, params);
  } catch (err) {
    if (isTransient(err)) broken = err;   // don't return a dead connection to the pool
    throw err;
  } finally {
    client.release(broken);
  }
}
const one = async (text, params) => (await query(text, params)).rows[0] || null;
const many = async (text, params) => (await query(text, params)).rows;

/* Run fn(client) inside a transaction; the client exposes query/one/many like the module. */
async function tx(fn) {
  const client = await connect();
  const c = {
    query: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    many: async (t, p) => (await client.query(t, p)).rows,
  };
  let broken;
  try {
    await client.query('BEGIN');
    const result = await fn(c);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    if (isTransient(err)) broken = err;
    else await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release(broken);
  }
}

/* Readiness probe: a trivial query with a short timeout. */
async function ping(timeoutMs = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('db ping timeout')), timeoutMs); });
  try { await Promise.race([pool.query('SELECT 1'), timeout]); } finally { clearTimeout(timer); }
}

module.exports = { pool, query, one, many, tx, ping, isTransient };

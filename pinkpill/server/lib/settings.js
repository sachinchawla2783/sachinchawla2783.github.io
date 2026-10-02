'use strict';
const db = require('../db');
let cache = null, at = 0;
async function all() {
  if (cache && Date.now() - at < 15000) return cache;
  cache = {};
  (await db.many('SELECT key, value FROM site_settings')).forEach((r) => { cache[r.key] = r.value; });
  at = Date.now();
  return cache;
}
async function get(key, dflt) { const s = await all(); return key in s ? s[key] : dflt; }
function invalidate() { cache = null; }
module.exports = { all, get, invalidate };

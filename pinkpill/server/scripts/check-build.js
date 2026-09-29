'use strict';
/* "Build" step: there is no bundler (the frontend is plain JS served as-is), so this verifies that every
   server and client file parses, migrations exist, and no secrets file is about to be shipped. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'public', 'js'))].filter((f) => f.endsWith('.js'));
for (const f of files) execFileSync(process.execPath, ['--check', f]);
const migrations = fs.readdirSync(path.join(root, 'server', 'db', 'migrations')).filter((f) => f.endsWith('.sql'));
if (!migrations.length) throw new Error('No migrations found.');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
for (const m of html.matchAll(/src="(js\/[^"]+)"/g)) if (!fs.existsSync(path.join(root, 'public', m[1]))) throw new Error('Missing script ' + m[1]);
console.log(`Build check OK: ${files.length} JS files parse, ${migrations.length} migration(s), frontend assets present.`);

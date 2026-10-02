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
// The browser bundle must not contain secrets or development-only URLs.
const forbidden = [/localhost:\d+/, /127\.0\.0\.1/, /re_[A-Za-z0-9]{16,}/, /sk_(live|test)_/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /TURNSTILE_SECRET|RESEND_API_KEY|R2_SECRET/, /postgres(ql)?:\/\//];
for (const f of walk(path.join(root, 'public'))) {
  const text = fs.readFileSync(f, 'utf8');
  for (const re of forbidden) if (re.test(text)) throw new Error(`Frontend file ${path.relative(root, f)} matches forbidden pattern ${re}`);
}
console.log(`Build check OK: ${files.length} JS files parse, ${migrations.length} migration(s), frontend assets present.`);

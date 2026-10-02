'use strict';
const { z } = require('zod');
const { invalid, notFound } = require('./errors');

/* Parse untrusted input; unknown keys are rejected by .strict() schemas. */
function parse(schema, data) {
  const r = schema.safeParse(data === undefined ? {} : data);
  if (r.success) return r.data;
  const fields = {};
  r.error.issues.forEach((i) => { const k = i.path.join('.') || '_'; if (!fields[k]) fields[k] = i.message; });
  const first = r.error.issues[0];
  throw invalid((first.path.length ? first.path.join('.') + ': ' : '') + first.message, fields);
}

const id = z.string().regex(/^[1-9]\d{0,17}$/, 'Invalid id');
/* Validates an id path parameter; malformed ids are simply "not found". */
function idParam(v) { if (!/^[1-9]\d{0,17}$/.test(String(v))) throw notFound(); return String(v); }
function slugParam(v) { if (!/^[a-z0-9-]{2,40}$/.test(String(v))) throw notFound(); return String(v); }
const page = z.coerce.number().int().min(1).max(100000).default(1);
const username = z.string().trim().regex(/^[A-Za-z0-9_.-]{3,24}$/, 'Username must be 3-24 characters: letters, numbers, _ . -');
const password = z.string().min(8, 'Password must be at least 8 characters.').max(200);
const content = (max) => z.string().max(max).refine((s) => s.trim().length > 0, 'Please enter a message.');

module.exports = { z, parse, id, idParam, slugParam, page, username, password, content };

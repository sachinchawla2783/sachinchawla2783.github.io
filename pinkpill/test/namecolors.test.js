'use strict';
/* Post-count name colours: one tier per 250 messages, capped by 3 days of membership per tier, max 40. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameTier } = require('../server/lib/nameColors');

const now = Date.parse('2026-10-02T00:00:00Z');
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

test('a new colour every 250 messages', () => {
  assert.equal(nameTier(0, daysAgo(400), now), 0);
  assert.equal(nameTier(249, daysAgo(400), now), 0);
  assert.equal(nameTier(250, daysAgo(400), now), 1);
  assert.equal(nameTier(9999, daysAgo(400), now), 39);
  assert.equal(nameTier(10000, daysAgo(400), now), 40, 'glowing pink at 10k');
  assert.equal(nameTier(50000, daysAgo(400), now), 40, 'capped');
});

test('each tier also needs 3 days of membership (no spamming to the top)', () => {
  assert.equal(nameTier(10000, daysAgo(0), now), 0, 'brand-new account');
  assert.equal(nameTier(10000, daysAgo(7), now), 2);
  assert.equal(nameTier(2500, daysAgo(30), now), 10);
  assert.equal(nameTier(10000, daysAgo(119), now), 39);
  assert.equal(nameTier(10000, daysAgo(120), now), 40);
});

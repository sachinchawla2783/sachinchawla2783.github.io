'use strict';
/* Terms that flag content. `danger`: practices banned by the rules → auto-report to moderators.
   `crisis`: the client shows support resources to the author. */
// Phrases, not single words: e.g. "purging" alone is normal skincare talk ("retinol purging").
const DANGER = ['bonesmash', 'bone smash', 'pro-ana', 'pro ana', 'proana', 'thinspo', 'meanspo', 'purge after eating', 'purging after eating',
  'purge my food', 'make myself throw up', 'make yourself throw up', 'make myself vomit', 'self-induced vomiting', 'dry fast', 'dryfast',
  'laxative', 'diy filler', 'diy botox', 'diy injection', 'mewing with a hammer', 'bleach your skin', 'mercury cream'];
const CRISIS = ['kill myself', 'suicide', 'suicidal', 'end my life', 'want to die', 'self harm', 'self-harm', 'cut myself'];
const crisisRes = CRISIS.map((w) => new RegExp('\\b' + w.replace(/[-\s]/g, '[-\\s]?') + '\\b', 'i'));

function check(text) {
  const t = String(text || '').toLowerCase();
  return { danger: DANGER.filter((w) => t.includes(w)), crisis: CRISIS.filter((w, i) => crisisRes[i].test(t)) };
}

async function autoReport(q, contentType, contentId, words) {
  if (!words.length) return;
  await q.query(`INSERT INTO reports (reporter_id, content_type, content_id, reason) VALUES (NULL, $1, $2, $3)`,
    [contentType, contentId, 'Automatic flag: possible rule 3 violation (' + words.join(', ') + ')']);
}

module.exports = { check, autoReport };

'use strict';
/* Post-count name colours (similar to looksmax.org): a new colour every 250 messages, and a glowing
   pink gradient at 10,000. Like looksmax.org's time requirement, each tier also needs 3 days of
   membership so colours can't be farmed by spamming. Staff and VIP colours take precedence. */
const STEP = 250;
const MAX_TIER = 40;          // 40 x 250 = 10,000 messages
const DAYS_PER_TIER = 3;

function nameTier(posts, joinedAt, now = Date.now()) {
  const byPosts = Math.floor((posts || 0) / STEP);
  const days = Math.floor((now - new Date(joinedAt).getTime()) / 86400000);
  const byAge = Math.floor(Math.max(0, days) / DAYS_PER_TIER);
  return Math.max(0, Math.min(byPosts, byAge, MAX_TIER));
}
module.exports = { STEP, MAX_TIER, DAYS_PER_TIER, nameTier };

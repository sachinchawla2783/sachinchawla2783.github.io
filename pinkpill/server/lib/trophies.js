'use strict';
const { notify } = require('./notify');

const RANKS = [
  { min: 0, title: 'Newbie' }, { min: 10, title: 'Bloomer' }, { min: 50, title: 'Rising' },
  { min: 150, title: 'Glowing' }, { min: 400, title: 'Radiant' }, { min: 1000, title: 'Goddess' },
];
const TROPHIES = [
  { id: 'first-post', points: 1, title: 'First message', desc: 'Posted your first message.', test: (s) => s.posts >= 1 },
  { id: 'posts-30', points: 5, title: 'Keeps coming back', desc: '30 messages posted.', test: (s) => s.posts >= 30 },
  { id: 'posts-100', points: 10, title: 'Can\'t stop!', desc: '100 messages posted.', test: (s) => s.posts >= 100 },
  { id: 'posts-1000', points: 20, title: 'Addicted', desc: '1,000 messages posted.', test: (s) => s.posts >= 1000 },
  { id: 'react-1', points: 2, title: 'Somebody likes you', desc: 'Received your first reaction.', test: (s) => s.reactionScore >= 1 },
  { id: 'react-25', points: 10, title: 'I like it a lot', desc: 'Reaction score of 25.', test: (s) => s.reactionScore >= 25 },
  { id: 'react-100', points: 15, title: 'Seriously likeable!', desc: 'Reaction score of 100.', test: (s) => s.reactionScore >= 100 },
  { id: 'react-250', points: 20, title: 'Can\'t get enough of your stuff', desc: 'Reaction score of 250.', test: (s) => s.reactionScore >= 250 },
  { id: 'followers-5', points: 5, title: 'Trendsetter', desc: 'Followed by 5 members.', test: (s) => s.followers >= 5 },
  { id: 'rep-10', points: 5, title: 'Respected', desc: 'Reached 10 reputation.', test: (s) => s.rep >= 10 },
  { id: 'rep-50', points: 10, title: 'Trusted voice', desc: 'Reached 50 reputation.', test: (s) => s.rep >= 50 },
  { id: 'rep-250', points: 20, title: 'Legendary', desc: 'Reached 250 reputation.', test: (s) => s.rep >= 250 },
  { id: 'glowup', points: 10, title: 'Glow-up documented', desc: 'Started a thread in Glow-Ups & Success Stories.', test: (s) => s.glowups >= 1 },
];
const byId = Object.fromEntries(TROPHIES.map((t) => [t.id, t]));
const rankFor = (posts) => RANKS.filter((r) => posts >= r.min).pop().title;

/* Award any newly earned trophies. Trophies are never revoked (like the prototype). */
async function checkTrophies(q, userId) {
  const s = await q.one(`SELECT
      (SELECT count(*)::int FROM posts WHERE author_id = $1 AND deleted_at IS NULL) AS posts,
      (SELECT count(*)::int FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = $1 AND p.deleted_at IS NULL AND r.reaction IN ('like','love','glow','hug')) AS "reactionScore",
      (SELECT coalesce(sum(value), 0)::int FROM reputation WHERE receiver_id = $1) AS rep,
      (SELECT count(*)::int FROM follows WHERE followee_id = $1) AS followers,
      (SELECT count(*)::int FROM threads WHERE author_id = $1 AND prefix = 'success' AND deleted_at IS NULL) AS glowups`, [userId]);
  const have = new Set((await q.many('SELECT trophy_id FROM user_trophies WHERE user_id = $1', [userId])).map((r) => r.trophy_id));
  for (const t of TROPHIES) {
    if (have.has(t.id) || !t.test(s)) continue;
    const ins = await q.query('INSERT INTO user_trophies (user_id, trophy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, t.id]);
    if (ins.rowCount) await notify(q, { userId, type: 'trophy', text: 'You have been awarded a trophy: ' + t.title, link: `#/members/${userId}/trophies` });
  }
}

module.exports = { RANKS, TROPHIES, byId, rankFor, checkTrophies };

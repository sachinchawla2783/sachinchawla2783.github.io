'use strict';
/* Starter content for a new forum: 182 member accounts and casual forum threads with replies so the
 * site isn't empty. Owner-only (Admin panel → Data). The accounts have no password (nobody can log in
 * as them), never show as online, can't be messaged, and are flagged `starter` so the owner can remove
 * everything in one click. */
const { checkTrophies } = require('./trophies');
const THREADS = require('./starterData');

const MEMBER_COUNT = 182;
const FIRST = ['isla', 'amara', 'lena', 'sofia', 'priya', 'chloe', 'maya', 'hana', 'zara', 'elena', 'nadia', 'ruby', 'mia', 'ava', 'lily',
  'emma', 'grace', 'leah', 'jade', 'noor', 'yasmin', 'aisha', 'freya', 'poppy', 'evie', 'ella', 'sienna', 'luna', 'nina', 'tara', 'kiara',
  'bella', 'daisy', 'amelia', 'olivia', 'zoe', 'layla', 'mila', 'ivy', 'rosa', 'carmen', 'lucia', 'aria', 'sara', 'imani', 'tia', 'jasmine',
  'naomi', 'eva', 'clara', 'aliyah', 'skye', 'phoebe', 'lola', 'esme', 'violet', 'georgia', 'holly', 'kayla', 'riley', 'mei', 'yuna', 'anya'];
const WORDS = ['glow', 'skin', 'beauty', 'lashes', 'brows', 'curls', 'gloss', 'blush', 'rose', 'honey', 'peach', 'cherry', 'pearl', 'velvet', 'silk', 'bloom', 'aura'];
const BIOS = ['skincare obsessed', 'spf every day ☀️', 'learning makeup slowly', 'gym girlie', 'curly hair journey', 'just here to learn', 'pilates + matcha',
  'k-beauty fan', 'brow enthusiast', 'colour analysis nerd', 'glow up in progress ✨', 'student, broke, moisturised', 'fashion > everything', ''];
const PLACES = ['London', 'Manchester', 'Dublin', 'Toronto', 'NYC', 'LA', 'Sydney', 'Melbourne', 'Paris', 'Berlin', 'Madrid', 'Milan', 'Lagos', 'Seoul', 'Tokyo', 'Dubai', 'Austin', ''];
const COLORS = ['#ec4899', '#f472b6', '#db2777', '#a855f7', '#f43f5e', '#c026d3', '#fb7185', '#e879f9'];

/* Small seeded random generator so the same content is produced every time. */
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeUsernames(rand, taken) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const styles = [
    (n) => n.charAt(0).toUpperCase() + n.slice(1),
    (n) => n + '_' + (10 + Math.floor(rand() * 90)),
    (n) => n + '.' + pick(WORDS),
    (n) => pick(WORDS) + 'by' + n,
    (n) => 'its' + n,
    (n) => n + n.slice(-1) + n.slice(-1),
    (n) => n + 'x' + Math.floor(rand() * 9),
    (n) => pick(WORDS) + '_' + n,
    (n) => n.charAt(0).toUpperCase() + n.slice(1) + (2000 + Math.floor(rand() * 10)),
  ];
  const out = [];
  let guard = 0;
  while (out.length < MEMBER_COUNT && guard++ < 10000) {
    const name = pick(styles)(pick(FIRST)).slice(0, 24);
    if (name.length < 3 || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

async function addStarterContent(q) {
  const existing = await q.one('SELECT count(*)::int AS n FROM users WHERE starter AND status <> \'deleted\'');
  if (existing.n) return { created: false, members: existing.n };
  const rand = rng(20261002);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const taken = new Set((await q.many('SELECT lower(username) AS u FROM users')).map((r) => r.u));
  const names = makeUsernames(rand, taken);

  // Members joined 60-180 days ago.
  const days = names.map(() => 60 + Math.floor(rand() * 120));
  const users = await q.many(`INSERT INTO users (username, email, password_hash, role_id, status, email_verified_at, created_at, last_seen_at, starter)
    SELECT u, NULL, NULL, 'member', 'active', now(), now() - (d || ' days')::interval, now() - ((1 + d % 9) || ' days')::interval, true
    FROM unnest($1::text[], $2::int[]) AS t(u, d) RETURNING id, username`, [names, days]);
  const ids = users.map((u) => u.id);
  await q.query(`INSERT INTO profiles (user_id, bio, location, avatar_color)
    SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[])`,
  [ids, ids.map(() => pick(BIOS)), ids.map(() => pick(PLACES)), ids.map(() => pick(COLORS))]);
  await q.query(`INSERT INTO user_preferences (user_id, show_online, allow_dms, allow_profile_posts)
    SELECT id, false, 'none', 'none' FROM unnest($1::bigint[]) AS id`, [ids]);

  const forums = new Set((await q.many('SELECT id FROM forums')).map((r) => r.id));
  let threads = 0, posts = 0;
  const posters = new Set();
  for (const [forum, prefix, title, opening, replies] of THREADS) {
    if (!forums.has(forum)) continue;
    const author = pick(ids);
    let at = Date.now() - (2 + rand() * 55) * 86400000;
    const t = await q.one(`INSERT INTO threads (forum_id, author_id, title, prefix, rating_enabled, created_at, view_count)
      VALUES ($1, $2, $3, $4, (SELECT rating_enabled FROM forums WHERE id = $1), $5, $6) RETURNING id`,
    [forum, author, title, prefix, new Date(at), 40 + Math.floor(rand() * 900)]);
    const authors = [author], contents = [opening], times = [new Date(at)];
    for (const r of replies) {
      at += (10 + rand() * 600) * 60000;            // 10 minutes to 10 hours apart
      authors.push(pick(ids)); contents.push(r); times.push(new Date(Math.min(at, Date.now() - 60000)));
    }
    const rows = await q.many(`INSERT INTO posts (thread_id, author_id, content, created_at)
      SELECT $1, a, c, ts FROM unnest($2::bigint[], $3::text[], $4::timestamptz[]) AS t(a, c, ts) RETURNING id, author_id, created_at`,
    [t.id, authors, contents, times]);
    authors.forEach((a) => posters.add(a));
    // A few reactions per post from other starter members.
    const rPost = [], rUser = [], rKind = [];
    for (const p of rows) {
      const n = Math.floor(rand() * 6);
      const seen = new Set([String(p.author_id)]);
      for (let i = 0; i < n; i++) {
        const u = pick(ids);
        if (seen.has(String(u))) continue;
        seen.add(String(u));
        rPost.push(p.id); rUser.push(u); rKind.push(pick(['like', 'like', 'love', 'glow']));
      }
    }
    if (rPost.length) await q.query('INSERT INTO reactions (post_id, user_id, reaction) SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[]) ON CONFLICT DO NOTHING', [rPost, rUser, rKind]);
    const last = rows.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
    await q.query('UPDATE threads SET first_post_id = (SELECT min(id) FROM posts WHERE thread_id = $1), last_post_id = $2, last_post_at = $3, reply_count = $4 WHERE id = $1',
      [t.id, last.id, last.created_at, rows.length - 1]);
    threads++; posts += rows.length;
  }
  for (const id of posters) await checkTrophies(q, id);
  return { created: true, members: ids.length, threads, posts };
}

/* Removes the starter threads and posts (soft delete, like moderation) and closes the accounts. */
async function removeStarterContent(q) {
  const ids = (await q.many('SELECT id FROM users WHERE starter AND status <> \'deleted\'')).map((r) => r.id);
  if (!ids.length) return { removed: 0 };
  await q.query('UPDATE threads SET deleted_at = now() WHERE author_id = ANY($1::bigint[]) AND deleted_at IS NULL', [ids]);
  await q.query('UPDATE posts SET deleted_at = now() WHERE author_id = ANY($1::bigint[]) AND deleted_at IS NULL', [ids]);
  await q.query('DELETE FROM reactions WHERE user_id = ANY($1::bigint[])', [ids]);
  await q.query(`UPDATE users SET username = 'deleted-' || id, email = NULL, password_hash = NULL, status = 'deleted', updated_at = now()
    WHERE id = ANY($1::bigint[])`, [ids]);
  return { removed: ids.length };
}

module.exports = { addStarterContent, removeStarterContent, MEMBER_COUNT };

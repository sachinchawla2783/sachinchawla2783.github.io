'use strict';
/* Starter content for a new forum: a handful of member accounts and threads so the site isn't empty.
 * Owner-only (Admin panel → Data). The accounts have no password (nobody can log in as them), never
 * show as online, and are flagged `starter` so the owner can remove all of it in one click. */
const { checkTrophies } = require('./trophies');

// [username, custom title, bio, location, avatar colour, days since joining]
const USERS = [
  ['Isla', '', 'Skincare minimalist. SPF every day.', 'Melbourne', '#f472b6', 58],
  ['Amara', '', 'Natural hair, 4C. Ask me about wash days.', 'Lagos', '#a855f7', 55],
  ['Lena', '', 'Pilates + strength training.', 'Berlin', '#ec4899', 54],
  ['Sofia', '', 'Colour analysis nerd 🎨', 'Madrid', '#db2777', 51],
  ['Priya', '', 'Brows, lashes and everything in between.', 'Toronto', '#f43f5e', 49],
  ['Chloe', '', 'Slowly learning makeup.', 'Manchester', '#f472b6', 46],
  ['Maya', '', 'Posture fixer in progress.', 'Austin', '#c026d3', 44],
  ['Hana', '', 'K-beauty fan.', 'Seoul', '#ec4899', 41],
  ['Zara', '', 'Style over trends.', 'London', '#a855f7', 39],
  ['Elena', '', 'Nutrition student.', 'Milan', '#db2777', 36],
  ['Nadia', '', 'Here for the glow-up.', 'Paris', '#f43f5e', 33],
  ['Ruby', '', 'Just vibing.', 'Dublin', '#ec4899', 30],
];

// [forum, author, title, prefix, tags, [ [author, content], ... ]]
const THREADS = [
  ['f-skin', 'Isla', 'My 3-step routine that finally cleared my skin', 'guide', ['skincare', 'routine'], [
    ['Isla', 'After years of 10-step routines, this is what actually worked for me:\n\n[b]AM:[/b] gentle cleanser → moisturiser → SPF 50\n[b]PM:[/b] cleanser → retinoid (3x a week) → moisturiser\n\nThe biggest change was being consistent and not switching products every two weeks. Give anything new at least 6–8 weeks.'],
    ['Hana', 'Agree on consistency. Which retinoid do you use?'],
    ['Isla', 'Adapalene 0.1%. Started twice a week and built up slowly.'],
    ['Chloe', 'Saving this. I definitely over-exfoliate 😅']]],
  ['f-skin', 'Hana', 'Does double cleansing actually matter?', 'question', ['skincare'], [
    ['Hana', 'I see it everywhere. Is it worth it if I don\'t wear much makeup?'],
    ['Isla', 'Only really needed on days you wear SPF or makeup. Otherwise one gentle cleanse is fine.'],
    ['Elena', 'Same, I only do it at night after sunscreen days.']]],
  ['f-hair', 'Amara', 'Wash day routine for 4C hair', 'guide', ['hair'], [
    ['Amara', 'Pre-poo with oil → sulfate-free shampoo → deep condition 30 min with heat → leave-in → seal with oil → protective style.\n\nThe deep condition is the step I\'d never skip.'],
    ['Priya', 'How often do you trim?'],
    ['Amara', 'Every 3 months, just dusting the ends.']]],
  ['f-hair', 'Priya', 'Growing out over-plucked brows: progress after 4 months', 'success', ['brows'], [
    ['Priya', 'Stopped tweezing completely, brushed them up daily, and let them grow wild for 4 months. They\'re finally filling in! Patience is everything.'],
    ['Sofia', 'This gives me hope, mine are so thin at the tails.'],
    ['Nadia', 'Congrats!! The awkward phase is the worst part.']]],
  ['f-makeup', 'Chloe', 'Beginner here: what are the 5 products I actually need?', 'question', ['makeup'], [
    ['Chloe', 'Overwhelmed by everything. If you had to start with 5 products, what would they be?'],
    ['Sofia', 'Skin tint, concealer, brow gel, mascara and a cream blush. That covers 90% of looks.'],
    ['Hana', 'Add a tinted lip balm and you\'re set.'],
    ['Chloe', 'Thank you both, this is so helpful 💕']]],
  ['f-makeup', 'Sofia', 'How I found my colour season (and why it changed my makeup)', 'guide', ['colouranalysis'], [
    ['Sofia', 'Daylight, no makeup, hair pulled back. Hold gold vs silver fabric under your face and see which makes your skin look clearer. I\'m a soft summer: muted, cool colours. Swapping my warm bronzer for a cool rose blush was a game changer.'],
    ['Zara', 'Soft summer twins! Dusty pinks forever.'],
    ['Ruby', 'Doing this tomorrow morning.']]],
  ['f-fitness', 'Lena', 'Pilates vs weights for a toned look?', 'discussion', ['fitness'], [
    ['Lena', 'I\'ve done both. Honestly, lifting changed my shape the most, and Pilates helped my posture and core. Doing both is ideal if you have time.'],
    ['Maya', 'Pilates fixed my lower back pain, so it\'s staying in my week.'],
    ['Elena', 'And eat enough protein or neither will show results!']]],
  ['f-fitness', 'Maya', 'Posture check: 30 days of wall angels and chin tucks', 'success', ['posture'], [
    ['Maya', 'Did 10 minutes every morning for a month. My shoulders sit so much further back and my neck looks longer in photos.'],
    ['Lena', 'Love this. Rows at the gym helped me too.']]],
  ['f-nutrition', 'Elena', 'Simple high-protein breakfasts', 'guide', ['nutrition'], [
    ['Elena', 'Greek yoghurt + berries + granola, eggs on toast, overnight oats with protein powder, cottage cheese bowls. Protein at breakfast keeps me full until lunch.'],
    ['Lena', 'Overnight oats are my go-to before the gym.'],
    ['Isla', 'Adding cottage cheese bowls to my list.']]],
  ['f-style', 'Zara', 'Building a capsule wardrobe: what\'s in yours?', 'discussion', ['style'], [
    ['Zara', 'Mine: white tee, black tee, straight jeans, black trousers, trench coat, a good blazer, loafers, white trainers. Everything goes with everything.'],
    ['Sofia', 'Same but in soft summer colours, so navy and grey instead of black.'],
    ['Nadia', 'A good blazer really does make every outfit look put together.']]],
  ['f-questions', 'Nadia', 'Where should a total beginner start?', 'question', [], [
    ['Nadia', 'I want to glow up but don\'t know where to start. What made the biggest difference for you?'],
    ['Isla', 'Sleep, SPF and drinking water. Boring but true.'],
    ['Lena', 'Posture and moving every day.'],
    ['Zara', 'Clothes that actually fit you. Get things tailored!'],
    ['Nadia', 'Okay, starting with sleep and SPF this week. Thank you!']]],
  ['f-advice', 'Ruby', 'How do you stop comparing yourself on Instagram?', 'serious', [], [
    ['Ruby', 'I always feel worse after scrolling. How do you deal with it?'],
    ['Maya', 'I unfollowed accounts that made me feel bad and followed ones that teach skills instead.'],
    ['Amara', 'Remember most photos are edited and filtered. Compare yourself to you from last month.']]],
  ['f-offtopic', 'Ruby', 'What are you listening to right now? 🎧', 'discussion', [], [
    ['Ruby', 'Drop your current song!'],
    ['Chloe', 'Gym playlist on repeat lol'],
    ['Hana', 'NewJeans, always.'],
    ['Zara', 'Old Amy Winehouse albums.']]],
  ['f-offtopic', 'Chloe', 'Introduce yourself here! 👋', 'intro', [], [
    ['Chloe', 'Hi everyone! I\'m Chloe from Manchester, here to learn makeup and skincare. Say hi below!'],
    ['Isla', 'Hi Chloe! Isla from Melbourne, skincare is my thing.'],
    ['Amara', 'Amara here, hair care all day 💕'],
    ['Lena', 'Lena from Berlin, fitness and Pilates.']]],
];

async function addStarterContent(q) {
  const existing = await q.one('SELECT count(*)::int AS n FROM users WHERE starter');
  if (existing.n) return { created: false, members: existing.n };
  const ids = {};
  for (const [name, title, bio, loc, color, days] of USERS) {
    // Skip names a real member already uses.
    if (await q.one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [name])) continue;
    const u = await q.one(`INSERT INTO users (username, email, password_hash, role_id, status, email_verified_at, created_at, last_seen_at, starter)
      VALUES ($1, NULL, NULL, 'member', 'active', now(), now() - ($2 || ' days')::interval, now() - interval '3 days', true) RETURNING id`, [name, String(days)]);
    await q.query('INSERT INTO profiles (user_id, custom_title, bio, location, avatar_color) VALUES ($1, $2, $3, $4, $5)', [u.id, title, bio, loc, color]);
    await q.query("INSERT INTO user_preferences (user_id, show_online, allow_dms, allow_profile_posts) VALUES ($1, false, 'none', 'none')", [u.id]);
    ids[name] = u.id;
  }
  let t0 = Date.now() - 28 * 86400000;
  let threads = 0;
  for (const [forum, author, title, prefix, tags, posts] of THREADS) {
    if (!ids[author] || !(await q.one('SELECT 1 FROM forums WHERE id = $1', [forum]))) continue;
    const t = await q.one(`INSERT INTO threads (forum_id, author_id, title, prefix, rating_enabled, created_at, view_count)
      VALUES ($1, $2, $3, $4, (SELECT rating_enabled FROM forums WHERE id = $1), $5, $6) RETURNING id`,
    [forum, ids[author], title, prefix, new Date(t0), 30 + Math.floor(Math.random() * 400)]);
    for (const tag of tags) await q.query('INSERT INTO thread_tags (thread_id, tag) VALUES ($1, $2)', [t.id, tag]);
    let last = null, n = 0;
    for (const [who, content] of posts) {
      if (!ids[who]) continue;
      t0 += Math.floor(Math.random() * 6 * 3600000) + 30 * 60000;
      last = await q.one('INSERT INTO posts (thread_id, author_id, content, created_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at', [t.id, ids[who], content, new Date(t0)]);
      n++;
      for (const [name, id] of Object.entries(ids)) {
        if (name !== who && Math.random() < 0.25) await q.query('INSERT INTO reactions (post_id, user_id, reaction) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [last.id, id, ['like', 'love', 'glow'][Math.floor(Math.random() * 3)]]);
      }
    }
    await q.query('UPDATE threads SET first_post_id = (SELECT min(id) FROM posts WHERE thread_id = $1), last_post_id = $2, last_post_at = $3, reply_count = $4 WHERE id = $1',
      [t.id, last.id, last.created_at, Math.max(0, n - 1)]);
    threads++;
    t0 += 10 * 3600000;
  }
  for (const id of Object.values(ids)) await checkTrophies(q, id);
  return { created: true, members: Object.keys(ids).length, threads };
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

module.exports = { addStarterContent, removeStarterContent, STARTER_USERS: USERS };

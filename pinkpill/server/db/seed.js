'use strict';
/* Seeding.
 *   npm run seed          → applies migrations (roles, permissions, settings and the forum structure
 *                           are part of the migrations, so this is all production needs).
 *   npm run seed:demo     → ALSO creates demo members and the prototype's sample threads, for local
 *                           development only. Refuses to run when NODE_ENV=production.
 * Demo members share one password taken from SEED_DEMO_PASSWORD, or a random one printed once. */
const crypto = require('node:crypto');
const db = require('./index');
const { migrate } = require('./migrate');
const { hashPassword } = require('../lib/crypto');
const { checkTrophies } = require('../lib/trophies');

const demo = process.argv.includes('--demo');

const USERS = [
  ['Aurora', 'super_admin', 'Founder', 'Built this place so we could glow up together, kindly. ✨', 'Everywhere'],
  ['Celeste', 'moderator', 'Moderator', 'Skincare nerd. Dermatology student. Wear your sunscreen.', 'London'],
  ['Vivienne', 'member', '', 'Hair growth journey since 2024.', 'Paris'],
  ['Mireille', 'member', 'MUA', 'Makeup artist. Ask me anything about colour theory.', 'Montreal'],
  ['Sakura', 'member', '', 'Lifting 4x a week 🏋️‍♀️', 'Osaka'],
  ['Noor', 'member', '', 'Orthodontics + posture research.', 'Dubai'],
  ['Dahlia', 'member', '', 'Style is a language.', 'NYC'],
  ['Freya', 'member', '', 'Just here to learn!', 'Oslo'],
];

const THREADS = [
  ['f-announce', 'Aurora', 'Welcome to PinkPill — read this first 💗', 'discussion', { sticky: true, tags: ['welcome', 'rules'] }, [
    ['Aurora', '[b]Welcome to PinkPill![/b]\n\nThis is a looksmaxxing community for women: skincare, hair, makeup, fitness, style, facial aesthetics and everything in between.\n\n[b]What makes us different:[/b]\n• Evidence over hype. Cite sources when you can.\n• Feedback is [i]opt-in[/i] and constructive. No bullying, no "it\'s over".\n• Zero tolerance for pro-ED content, DIY injections, bonesmashing or other dangerous practices.\n\nPlease read the [url=#/help/rules]forum rules[/url] and introduce yourself in [url=#/forums/f-intro]Introductions[/url]. ✨'],
    ['Celeste', 'So happy this exists. If you need help with anything, tag @Celeste 💕'],
    ['Vivienne', 'Finally a place like this that isn\'t toxic. Thank you!']]],
  ['f-news', 'Aurora', 'New study: daily SPF use slows visible skin aging', 'news', { tags: ['news', 'spf'] }, [
    ['Aurora', 'A randomised trial summary making the rounds again: participants who applied broad-spectrum sunscreen [b]daily[/b] showed significantly less photoaging over 4.5 years than those who used it at their own discretion.\n\nTakeaway: the best anti-aging product is still the one you wear every morning.'],
    ['Celeste', 'The classic Nambour trial! Always worth re-sharing.']]],
  ['f-intro', 'Freya', 'Hi from Norway 👋', null, {}, [
    ['Freya', 'Hi everyone! I\'m Freya. Mostly here to learn about skincare and figure out my colour season. Nice to meet you all!'],
    ['Mireille', 'Welcome Freya! Post a no-makeup pic in daylight in the colour analysis thread and I\'ll help you out.'],
    ['Aurora', 'Welcome aboard 💗']]],
  ['f-looks', 'Dahlia', 'What was your single biggest looksmax so far?', 'discussion', {}, [
    ['Dahlia', 'For me it was getting my brows shaped professionally. Changed my whole face. What about you?'],
    ['Vivienne', 'Fixing my sleep. Skin, under-eyes, mood — everything improved.'],
    ['Sakura', 'Lifting. Posture + shoulders changed how clothes fit completely.']]],
  ['f-skin', 'Celeste', 'The Beginner Skincare Routine (evidence-based)', 'guide', { sticky: true, tags: ['skincare', 'routine', 'beginner'] }, [
    ['Celeste', '[b]The only 3 steps you truly need[/b]\n\n1. [b]Gentle cleanser[/b]\n2. [b]Moisturiser[/b] suited to your skin type\n3. [b]Broad-spectrum SPF 30+[/b] every morning\n\n[b]Then add ONE active at a time:[/b]\n• Retinoid — anti-aging & acne\n• Azelaic acid — redness, PIH, acne\n• Vitamin C — antioxidant\n\n[quote=Celeste]Patch test everything. Introduce actives 2-3 nights a week and build up.[/quote]'],
    ['Freya', 'Saving this! Is it ok to use vitamin C and retinol together?'],
    ['Celeste', '@Freya Easiest is Vit C in the morning (under SPF) and retinoid at night.']]],
  ['f-questions', 'Sakura', 'Best sunscreens for oily skin that don\'t pill?', 'question', { tags: ['spf', 'oily-skin'] }, [
    ['Sakura', 'Everything I try either pills under makeup or makes me look greasy by noon. Recommendations?'],
    ['Mireille', 'Look for fluid/gel textures. Let it set 5-10 min before makeup.']]],
  ['f-hair', 'Vivienne', 'My 12-month hair growth log', 'guide', { tags: ['hair-growth', 'progress'] }, [
    ['Vivienne', 'Routine:\n• Scalp massage 5 min daily\n• Gentle shampoo, 3x/week\n• Silk pillowcase\n• Minimised heat\n• Iron & vit D bloodwork checked with my GP\n\n[spoiler]Gained about 14cm and much less breakage.[/spoiler]']]],
  ['f-makeup', 'Mireille', 'Colour analysis megathread — find your season', 'guide', { sticky: true, tags: ['colour-analysis'], poll: { question: 'What season are you?', options: ['Spring', 'Summer', 'Autumn', 'Winter', 'No idea yet'] } }, [
    ['Mireille', 'Post a [b]no-makeup photo in natural daylight[/b] and I\'ll give my best guess on your season.\n\nRemember this is a tool, not a rule. Wear what makes you happy.']]],
  ['f-body', 'Sakura', 'Posture fixes that made the biggest visual difference', 'guide', { tags: ['posture'] }, [
    ['Sakura', '• Chin tucks (2x10 daily)\n• Wall angels\n• Face pulls & rows\n• Hip flexor stretches if you sit all day'],
    ['Noor', 'Adding thoracic extensions over a foam roller — game changer.']]],
  ['f-rating', 'Freya', 'Rate me honestly (but nicely) — what should I improve?', 'question', { tags: ['feedback'] }, [
    ['Freya', 'No makeup, daylight. What would you focus on first?'],
    ['Mireille', 'Lovely eyes! Brows a touch fuller would frame your face more.', 7],
    ['Dahlia', 'Warm-toned blush would brighten everything up!', 8]]],
  ['f-private-rating', 'Dahlia', 'Private: rate my new haircut (members only)', 'question', { tags: ['hair'] }, [
    ['Dahlia', 'Posting here since it\'s hidden from guests. Went from long layers to a collarbone bob. Thoughts?'],
    ['Mireille', 'Suits your jaw so well!', 8]]],
  ['f-advice', 'Freya', 'He only texts me late at night — am I overthinking?', 'question', { tags: ['dating'] }, [
    ['Freya', 'He\'s sweet in person, but mostly messages after 11pm and rarely makes plans. Red flag?'],
    ['Dahlia', 'Not overthinking. Ask him directly for a proper date this weekend and see how he responds.']]],
  ['f-wellbeing', 'Aurora', 'Support resources (pinned)', 'serious', { sticky: true, locked: true, tags: ['support'] }, [
    ['Aurora', 'If you\'re struggling, you\'re not alone and you deserve help. See [url=#/help/resources]Support resources[/url]. This forum is peer support, not a replacement for professional care.']]],
  ['f-offtopic', 'Dahlia', 'What are you listening to right now?', null, {}, [
    ['Dahlia', 'Drop your current song 🎧'], ['Sakura', 'Gym playlist on repeat lol']]],
];

(async () => {
  await migrate(db.pool);
  if (!demo) { console.log('[seed] Structure is up to date. Run `npm run seed:demo` for sample content (development only).'); return; }
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to create demo content in production.');
  if (await db.one("SELECT 1 FROM users WHERE username = 'Celeste'")) { console.log('[seed] Demo content already present.'); return; }
  const password = process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const hash = await hashPassword(password);
  const ids = {};
  await db.tx(async (q) => {
    for (const [name, role, title, bio, loc] of USERS) {
      const existing = await q.one('SELECT id FROM users WHERE username = $1', [name]);
      if (existing) { ids[name] = existing.id; continue; }
      const u = await q.one(`INSERT INTO users (username, email, password_hash, role_id, status, email_verified_at, created_at)
        VALUES ($1, $2, $3, $4, 'active', now(), now() - (random() * 300 || ' days')::interval) RETURNING id`, [name, name.toLowerCase() + '@example.com', hash, role]);
      await q.query('INSERT INTO profiles (user_id, custom_title, bio, location, avatar_color) VALUES ($1, $2, $3, $4, $5)', [u.id, title, bio, loc, ['#ec4899', '#f472b6', '#db2777', '#a855f7', '#f43f5e', '#fb7185', '#c026d3'][Object.keys(ids).length % 7]]);
      await q.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [u.id]);
      ids[name] = u.id;
    }
    let t0 = Date.now() - 20 * 86400000;
    for (const [forum, author, title, prefix, opts, posts] of THREADS) {
      const created = new Date(t0);
      const t = await q.one(`INSERT INTO threads (forum_id, author_id, title, prefix, sticky, locked, rating_enabled, created_at, view_count)
        VALUES ($1, $2, $3, $4, $5, $6, (SELECT rating_enabled FROM forums WHERE id = $1), $7, $8) RETURNING id`, [forum, ids[author], title, prefix, !!opts.sticky, !!opts.locked, created, 20 + Math.floor(Math.random() * 500)]);
      for (const tag of opts.tags || []) await q.query('INSERT INTO thread_tags (thread_id, tag) VALUES ($1, $2)', [t.id, tag]);
      let last = null;
      for (const [who, content, rating] of posts) {
        t0 += Math.floor(Math.random() * 5 * 3600000) + 20 * 60000;
        last = await q.one('INSERT INTO posts (thread_id, author_id, content, rating, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at', [t.id, ids[who], content, rating || null, new Date(t0)]);
        for (const [name, id] of Object.entries(ids)) {
          if (name !== who && Math.random() < 0.3) await q.query('INSERT INTO reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)', [last.id, id, ['like', 'love', 'glow', 'hug'][Math.floor(Math.random() * 4)]]);
          if (name !== who && Math.random() < 0.08) await q.query('INSERT INTO reputation (post_id, giver_id, receiver_id, value, comment) VALUES ($1, $2, $3, 1, $4)', [last.id, id, ids[who], 'Helpful, thank you!']);
        }
      }
      await q.query('UPDATE threads SET first_post_id = (SELECT min(id) FROM posts WHERE thread_id = $1), last_post_id = $2, last_post_at = $3, reply_count = $4 WHERE id = $1', [t.id, last.id, last.created_at, posts.length - 1]);
      if (opts.poll) {
        const p = await q.one('INSERT INTO polls (thread_id, question) VALUES ($1, $2) RETURNING id', [t.id, opts.poll.question]);
        for (let i = 0; i < opts.poll.options.length; i++) await q.query('INSERT INTO poll_options (poll_id, text, position) VALUES ($1, $2, $3)', [p.id, opts.poll.options[i], i]);
      }
      t0 += 6 * 3600000;
    }
    for (const n of ['Vivienne', 'Mireille', 'Sakura', 'Noor', 'Dahlia', 'Freya']) await q.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ids[n], ids.Aurora]);
    await q.query('INSERT INTO profile_posts (profile_user_id, author_id, content) VALUES ($1, $2, $3)', [ids.Freya, ids.Mireille, 'Welcome to PinkPill! 💕']);
    for (const id of Object.values(ids)) await checkTrophies(q, id);
  });
  console.log(`[seed] Demo members created: ${USERS.map((u) => u[0]).join(', ')}`);
  console.log(`[seed] Demo password for all of them: ${process.env.SEED_DEMO_PASSWORD ? '(from SEED_DEMO_PASSWORD)' : password}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.pool.end());

/* PinkPill data layer.
 * All data lives in localStorage under one key. Every read/write goes through
 * this module so it can be swapped for a real backend (Firebase, Supabase, ...)
 * without touching the views. */
(function () {
  'use strict';

  const KEY = 'pinkpill.db.v1';
  const SESSION_KEY = 'pinkpill.session';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  const REACTIONS = [
    { id: 'like', emoji: '👍', label: 'Like', score: 1 },
    { id: 'love', emoji: '💖', label: 'Love', score: 1 },
    { id: 'glow', emoji: '✨', label: 'Glow', score: 1 },
    { id: 'haha', emoji: '😂', label: 'Haha', score: 0 },
    { id: 'wow', emoji: '😮', label: 'Wow', score: 0 },
    { id: 'hug', emoji: '🫂', label: 'Hug', score: 1 },
    { id: 'sad', emoji: '😢', label: 'Sad', score: 0 },
  ];

  const PREFIXES = [
    { id: 'question', label: 'Question', color: '#3b82f6' },
    { id: 'discussion', label: 'Discussion', color: '#8b5cf6' },
    { id: 'guide', label: 'Guide', color: '#10b981' },
    { id: 'routine', label: 'Routine', color: '#f59e0b' },
    { id: 'rateme', label: 'Rate Me', color: '#ec4899' },
    { id: 'glowup', label: 'Glow-Up', color: '#e11d48' },
    { id: 'research', label: 'Research', color: '#0ea5e9' },
    { id: 'serious', label: 'Serious', color: '#475569' },
    { id: 'vent', label: 'Vent', color: '#64748b' },
  ];

  const RANKS = [
    { min: 0, title: 'Newbie' },
    { min: 10, title: 'Bloomer' },
    { min: 50, title: 'Rising' },
    { min: 150, title: 'Glowing' },
    { min: 400, title: 'Radiant' },
    { min: 1000, title: 'Goddess' },
  ];

  const TROPHIES = [
    { id: 'first-post', points: 1, title: 'First message', desc: 'Posted your first message.', test: (s) => s.posts >= 1 },
    { id: 'posts-30', points: 5, title: 'Keeps coming back', desc: '30 messages posted.', test: (s) => s.posts >= 30 },
    { id: 'posts-100', points: 10, title: 'Can\'t stop!', desc: '100 messages posted.', test: (s) => s.posts >= 100 },
    { id: 'posts-1000', points: 20, title: 'Addicted', desc: '1,000 messages posted.', test: (s) => s.posts >= 1000 },
    { id: 'react-1', points: 2, title: 'Somebody likes you', desc: 'Received your first reaction.', test: (s) => s.score >= 1 },
    { id: 'react-25', points: 10, title: 'I like it a lot', desc: 'Reaction score of 25.', test: (s) => s.score >= 25 },
    { id: 'react-100', points: 15, title: 'Seriously likeable!', desc: 'Reaction score of 100.', test: (s) => s.score >= 100 },
    { id: 'react-250', points: 20, title: 'Can\'t get enough of your stuff', desc: 'Reaction score of 250.', test: (s) => s.score >= 250 },
    { id: 'followers-5', points: 5, title: 'Trendsetter', desc: 'Followed by 5 members.', test: (s) => s.followers >= 5 },
    { id: 'rep-10', points: 5, title: 'Respected', desc: 'Reached 10 reputation.', test: (s) => s.rep >= 10 },
    { id: 'rep-50', points: 10, title: 'Trusted voice', desc: 'Reached 50 reputation.', test: (s) => s.rep >= 50 },
    { id: 'rep-250', points: 20, title: 'Legendary', desc: 'Reached 250 reputation.', test: (s) => s.rep >= 250 },
    { id: 'glowup', points: 10, title: 'Glow-up documented', desc: 'Started a thread in Glow-Ups & Success Stories.', test: (s) => s.glowups >= 1 },
  ];

  /* Words that trigger the safety system. `danger` terms flag posts for moderators
   * (practices banned by the rules); `crisis` terms show support resources. */
  const SAFETY = {
    danger: ['bonesmash', 'bone smash', 'pro-ana', 'pro ana', 'proana', 'thinspo', 'meanspo', 'purging', 'dry fast', 'dryfast',
      'laxative', 'diy filler', 'diy botox', 'diy injection', 'mewing with a hammer', 'bleach your skin', 'mercury cream'],
    crisis: ['kill myself', 'suicide', 'suicidal', 'end my life', 'want to die', 'self harm', 'self-harm', 'cut myself', 'rope'],
  };

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function hashPassword(pw, salt) {
    const data = new TextEncoder().encode(salt + ':' + pw);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (const b of data) h = (h * 31 + b) | 0;
    return 'x' + h;
  }

  /* Category → forum layout. A forum with `parentId` is a sub-forum of that forum.
   * `membersOnly` forums are hidden from guests entirely. */
  function forumStructure() {
    return [
      { id: 'c-info', title: 'Information', forums: [
        { id: 'f-news', title: 'News', desc: 'Beauty, health and science news worth knowing about.', icon: '📰', staffOnly: true },
        { id: 'f-announce', title: 'Announcements', desc: 'Site updates, rule changes and events.', icon: '📣', staffOnly: true },
      ] },
      { id: 'c-looks', title: 'Looksmaxxing', forums: [
        { id: 'f-looks', title: 'Looksmaxxing', desc: 'General looksmaxxing discussion, plus sub-forums for every area.', icon: '🌸' },
        { id: 'f-skin', parentId: 'f-looks', title: 'Skincare', desc: 'Routines, actives, acne, anti-aging, SPF.', icon: '🧴' },
        { id: 'f-hair', parentId: 'f-looks', title: 'Hair, Brows & Lashes', desc: 'Growth, colour, cuts, care and styling.', icon: '💇‍♀️' },
        { id: 'f-makeup', parentId: 'f-looks', title: 'Makeup', desc: 'Techniques, products, colour analysis, face-shape tips.', icon: '💄' },
        { id: 'f-fitness', parentId: 'f-looks', title: 'Fitness', desc: 'Training programs, strength, cardio, posture work.', icon: '🏋️‍♀️' },
        { id: 'f-body', parentId: 'f-looks', title: 'Body', desc: 'Body composition, proportions, posture, body care — sustainably.', icon: '🧘‍♀️' },
        { id: 'f-nutrition', parentId: 'f-looks', title: 'Nutrition & Health', desc: 'Evidence-based eating, sleep, hormones. No crash diets.', icon: '🥗' },
        { id: 'f-face', parentId: 'f-looks', title: 'Facial Aesthetics', desc: 'Face shape, harmony, orthodontics, jawline.', icon: '💎' },
        { id: 'f-style', parentId: 'f-looks', title: 'Style & Fashion', desc: 'Wardrobe, colour seasons, body-type dressing, fragrance.', icon: '👗' },
        { id: 'f-procedures', parentId: 'f-looks', title: 'Cosmetic Procedures', desc: 'Research & experiences with licensed professionals only.', icon: '🩺' },
        { id: 'f-questions', title: 'Looksmaxxing Questions', desc: 'Ask anything about looksmaxxing — no question is too basic.', icon: '❓' },
      ] },
      { id: 'c-rating', title: 'Rating', forums: [
        { id: 'f-rating', title: 'Rating', desc: 'Opt-in, constructive ratings and feedback on your pics. Be kind or be banned.', icon: '⭐', rating: true },
        { id: 'f-private-rating', parentId: 'f-rating', title: 'Private Ratings', desc: 'Only visible to logged-in members. Hidden from guests and search engines.', icon: '🔒', rating: true, membersOnly: true },
      ] },
      { id: 'c-community', title: 'Community', forums: [
        { id: 'f-intro', title: 'Introductions', desc: 'New here? Say hi and tell us about your goals.', icon: '👋' },
        { id: 'f-advice', title: 'Situations & Dating Advice', desc: 'Get advice on your problems, life situations, dating and relationships. Be supportive.', icon: '💌', notice: 'Be kind and supportive. Keep other people anonymous: no names, photos or screenshots of them. If you\'re unsafe in a relationship, see the <a href="#/help/resources">support resources</a>.' },
        { id: 'f-success', title: 'Glow-Ups & Success Stories', desc: 'Before & afters, progress logs, wins.', icon: '🏆' },
        { id: 'f-wellbeing', title: 'Mental Health & Confidence', desc: 'Body image, self-esteem, support. Resources pinned.', icon: '🫶' },
        { id: 'f-feedback', title: 'Site Feedback & Bugs', desc: 'Suggestions and bug reports for PinkPill.', icon: '🛠️' },
      ] },
      { id: 'c-offtopic', title: 'Off-Topic', forums: [
        { id: 'f-offtopic', title: 'Off-Topic', desc: 'Anything not about looks: music, shows, life, memes. Keep it civil.', icon: '☕' },
      ] },
    ];
  }

  /* Upgrade databases saved by older versions of the site. */
  function migrate(d) {
    if (d.version < 2) {
      const known = new Set();
      const cats = forumStructure();
      const oldForums = d.forums;
      d.categories = []; d.forums = [];
      cats.forEach((c, ci) => {
        d.categories.push({ id: c.id, title: c.title, order: ci });
        c.forums.forEach((f, fi) => { known.add(f.id); d.forums.push(Object.assign({ categoryId: c.id, order: fi, parentId: null }, f)); });
      });
      // keep forums an admin created, moving them into Community
      oldForums.filter((f) => !known.has(f.id) && f.id !== 'f-general').forEach((f) => d.forums.push(Object.assign({}, f, { categoryId: 'c-community', parentId: null })));
      d.threads.forEach((t) => { if (t.forumId === 'f-general') t.forumId = 'f-looks'; });
      d.reps = d.reps || [];
      d.version = 2;
    }
    if (d.version < 3) {
      if (!d.forums.some((f) => f.id === 'f-advice')) {
        const def = forumStructure().find((c) => c.id === 'c-community').forums.find((f) => f.id === 'f-advice');
        d.forums.filter((f) => f.categoryId === 'c-community' && !f.parentId && f.order >= 1).forEach((f) => { f.order++; });
        d.forums.push(Object.assign({ categoryId: 'c-community', order: 1, parentId: null }, def));
      }
      d.version = 3;
    }
    return d;
  }

  /* ---------- seed data ---------- */

  function seed() {
    const now = Date.now();
    const db = {
      version: 3,
      users: [], reps: [], categories: [], forums: [], threads: [], posts: [],
      profilePosts: [], conversations: [], alerts: [], reports: [],
      settings: { siteName: 'PinkPill', created: now },
    };

    const mkUser = (username, opts = {}) => {
      const u = Object.assign({
        id: uid('u'), username, email: username.toLowerCase() + '@example.com',
        salt: uid(), passHash: null, role: 'member', banned: false,
        avatar: null, color: ['#ec4899', '#f472b6', '#db2777', '#a855f7', '#f43f5e', '#fb7185', '#c026d3'][db.users.length % 7],
        customTitle: '', bio: '', location: '', website: '', birthday: '',
        joined: now - (30 + db.users.length * 40) * DAY, lastSeen: now - Math.floor(Math.random() * 3 * DAY),
        activity: 'Viewing forum index',
        followers: [], following: [], ignoring: [], bookmarks: [], watched: [], trophies: [],
        signature: '', settings: { theme: 'auto', emailAlerts: false, showOnline: true, allowDMs: 'everyone', allowProfilePosts: 'everyone' },
      }, opts);
      db.users.push(u);
      return u;
    };

    const admin = mkUser('Aurora', { role: 'admin', customTitle: 'Founder', bio: 'Built this place so we could glow up together, kindly. ✨', location: 'Everywhere', lastSeen: now - 5 * MIN, activity: 'Viewing thread Welcome to PinkPill' });
    const mod = mkUser('Celeste', { role: 'mod', customTitle: 'Moderator', bio: 'Skincare nerd. Dermatology student. Wear your sunscreen.', location: 'London', lastSeen: now - 2 * MIN, activity: 'Viewing forum Skincare' });
    const u1 = mkUser('Vivienne', { bio: 'Hair growth journey since 2024.', location: 'Paris', lastSeen: now - 8 * MIN });
    const u2 = mkUser('Mireille', { bio: 'Makeup artist. Ask me anything about colour theory.', customTitle: 'MUA', location: 'Montreal' });
    const u3 = mkUser('Sakura', { bio: 'Lifting 4x a week 🏋️‍♀️', location: 'Osaka', lastSeen: now - 12 * MIN });
    const u4 = mkUser('Noor', { bio: 'Orthodontics + posture research.', location: 'Dubai' });
    const u5 = mkUser('Dahlia', { bio: 'Style is a language.', location: 'NYC' });
    const u6 = mkUser('Freya', { bio: 'Just here to learn!', location: 'Oslo' });
    const users = [admin, mod, u1, u2, u3, u4, u5, u6];

    const cats = forumStructure();
    cats.forEach((c, ci) => {
      db.categories.push({ id: c.id, title: c.title, order: ci });
      c.forums.forEach((f, fi) => db.forums.push(Object.assign({ categoryId: c.id, order: fi, parentId: null }, f)));
    });

    let t0 = now - 20 * DAY;
    const mkThread = (forumId, author, title, prefix, posts, opts = {}) => {
      const th = Object.assign({ id: uid('t'), forumId, authorId: author.id, title, prefix, created: t0, sticky: false, locked: false, views: 20 + Math.floor(Math.random() * 900), tags: [], poll: null, watchers: [author.id] }, opts);
      db.threads.push(th);
      posts.forEach(([who, content, extra], i) => {
        t0 += Math.floor(Math.random() * 6 * HOUR) + 20 * MIN;
        const reactions = {};
        users.forEach((u) => { if (u !== who && Math.random() < (i === 0 ? 0.55 : 0.3)) reactions[u.id] = REACTIONS[Math.floor(Math.random() * 6)].id; });
        db.posts.push(Object.assign({ id: uid('p'), threadId: th.id, authorId: who.id, content, created: i === 0 ? th.created : t0, edited: null, reactions, deleted: false }, extra || {}));
      });
      t0 += 7 * HOUR;
      return th;
    };

    mkThread('f-announce', admin, 'Welcome to PinkPill — read this first 💗', 'discussion', [
      [admin, '[b]Welcome to PinkPill![/b]\n\nThis is a looksmaxxing community for women: skincare, hair, makeup, fitness, style, facial aesthetics and everything in between.\n\n[b]What makes us different:[/b]\n• Evidence over hype. Cite sources when you can.\n• Feedback is [i]opt-in[/i] and constructive. No bullying, no "it\'s over".\n• Zero tolerance for pro-ED content, DIY injections, bonesmashing or other dangerous practices.\n\nPlease read the [url=#/help/rules]forum rules[/url] and introduce yourself in [url=#/forums/f-intro]Introductions[/url]. ✨'],
      [mod, 'So happy this exists. If you need help with anything, tag @Celeste 💕'],
      [u1, 'Finally a place like this that isn\'t toxic. Thank you!'],
    ], { sticky: true, locked: false, tags: ['welcome', 'rules'] });

    mkThread('f-announce', admin, 'New features: polls, trophies, bookmarks and dark mode', 'discussion', [
      [admin, 'We just shipped:\n\n• [b]Polls[/b] when creating threads\n• [b]Trophies[/b] and ranks\n• [b]Bookmarks[/b] and [b]watched threads[/b]\n• [b]Dark mode[/b] — toggle it in the footer or in your preferences\n\nReport bugs in [url=#/forums/f-feedback]Site Feedback[/url].'],
    ], { sticky: true, locked: true, tags: ['update'] });

    mkThread('f-advice', u6, 'He only texts me late at night — am I overthinking?', 'question', [
      [u6, 'Been talking to a guy for ~3 weeks. He\'s sweet in person, but he mostly messages after 11pm and rarely makes plans in advance. Am I overthinking it or is this a red flag?'],
      [u5, 'Not overthinking. Consistency during the day and making real plans = interest. Ask him directly for a proper date this weekend and see how he responds.'],
      [mod, 'Agree with Dahlia. You can say what you want kindly and clearly: "I\'d love to see you Saturday afternoon." His response will tell you everything.'],
      [u1, 'And remember you\'re allowed to want more than a late-night text 💗'],
    ], { tags: ['dating', 'relationships'] });

    mkThread('f-advice', u3, 'Friend group keeps commenting on my weight loss — how do I handle it?', 'serious', [
      [u3, 'I\'ve been lifting and eating better and lost some fat. Now every hangout turns into comments about my body, some nice, some weird. How do I set a boundary without being rude?'],
      [u2, '"Thanks! I\'d rather not talk about my body though — how was your week?" Redirect, every time. People get it fast.'],
    ], { tags: ['friendships', 'boundaries'] });

    mkThread('f-intro', u6, 'Hi from Norway 👋', null, [
      [u6, 'Hi everyone! I\'m Freya, 22. Mostly here to learn about skincare and figure out my colour season. Nice to meet you all!'],
      [u2, 'Welcome Freya! Post a no-makeup pic in daylight in the colour analysis thread and I\'ll help you out.'],
      [admin, 'Welcome aboard 💗'],
    ]);

    mkThread('f-skin', mod, 'The Beginner Skincare Routine (evidence-based)', 'guide', [
      [mod, '[b]The only 3 steps you truly need[/b]\n\n1. [b]Gentle cleanser[/b] (PM, and AM if oily)\n2. [b]Moisturiser[/b] suited to your skin type\n3. [b]Broad-spectrum SPF 30+[/b] every morning, reapplied if outdoors\n\n[b]Then add ONE active at a time:[/b]\n• Retinoid (adapalene / tretinoin / retinal) — anti-aging & acne\n• Azelaic acid — redness, PIH, acne\n• Vitamin C — antioxidant, brightening\n• AHA/BHA — texture, clogged pores\n\n[quote=Celeste]Patch test everything. Introduce actives 2-3 nights a week and build up.[/quote]\n\nSee a dermatologist for persistent acne — prescription options work far better than anything OTC.', ],
      [u6, 'Saving this! Is it ok to use vitamin C and retinol together?'],
      [mod, '@Freya Easiest is Vit C in the morning (under SPF) and retinoid at night. Less irritation.'],
      [u1, 'Adapalene changed my skin completely. Purging for ~6 weeks then clear.'],
    ], { sticky: true, tags: ['skincare', 'routine', 'beginner'] });

    mkThread('f-questions', u3, 'Best sunscreens for oily skin that don\'t pill?', 'question', [
      [u3, 'Everything I try either pills under makeup or makes me look greasy by noon. Recommendations?'],
      [u2, 'Look for fluid/gel textures. Let it set 5-10 min before makeup and use a silicone-free primer if it pills.'],
      [mod, 'Asian and EU formulas tend to be more elegant. Also, pilling is often from layering too many products — simplify.'],
    ], { tags: ['spf', 'oily-skin'] });

    mkThread('f-hair', u1, 'My 12-month hair growth log (with pics)', 'routine', [
      [u1, 'Routine:\n• Scalp massage 5 min daily\n• Gentle sulfate-free shampoo, 3x/week\n• Silk pillowcase\n• Minimised heat, low-tension hairstyles\n• Iron & vit D bloodwork checked with my GP\n\nMonth 12 update coming soon! [spoiler]Gained about 14cm and much less breakage.[/spoiler]'],
      [u6, 'Amazing progress! Did you use any oils?'],
      [u1, 'Rosemary oil on and off. Honestly the bloodwork + lower heat made the biggest difference.'],
    ], { tags: ['hair-growth', 'progress'] });

    mkThread('f-makeup', u2, 'Colour analysis megathread — find your season', 'guide', [
      [u2, 'Post a [b]no-makeup photo in natural daylight[/b] (face + neck, hair pulled back) and I\'ll give my best guess on your season.\n\n[b]Quick self-test:[/b]\n• Veins greenish → warm; bluish → cool\n• Gold or silver jewellery flatters more?\n• Pure white or off-white near your face?\n\nRemember this is a tool, not a rule. Wear what makes you happy.'],
      [u5, 'I was typed as Deep Autumn and my whole wardrobe makes sense now lol'],
    ], { sticky: true, tags: ['colour-analysis', 'megathread'], poll: {
      question: 'What season are you?', multiple: false, closes: null,
      options: [{ text: 'Spring', votes: [u3.id] }, { text: 'Summer', votes: [u6.id, u1.id] }, { text: 'Autumn', votes: [u5.id, u2.id] }, { text: 'Winter', votes: [mod.id] }, { text: 'No idea yet', votes: [] }],
    } });

    mkThread('f-fitness', u3, 'Glute & posture program for beginners', 'routine', [
      [u3, '3x per week, full body:\n\n• Hip thrust 3x8-12\n• Romanian deadlift 3x8-10\n• Goblet squat 3x10\n• Face pulls 3x15 (posture!)\n• Dead bugs 3x10\n\nProgressive overload is everything. Eat enough protein (~1.6g/kg).'],
      [u4, 'Face pulls are so underrated for rounded shoulders.'],
      [u6, 'Starting this Monday 💪'],
    ], { tags: ['fitness', 'posture'] });

    mkThread('f-nutrition', mod, 'Why crash diets backfire (and what works instead)', 'research', [
      [mod, 'Very low calorie diets cause muscle loss, hair shedding (telogen effluvium), fatigue and often rebound weight gain.\n\n[b]Sustainable approach:[/b]\n• Modest deficit if fat loss is the goal (~300-500 kcal)\n• Protein at every meal\n• Resistance training to keep muscle\n• Sleep 7-9h\n\nIf you\'re struggling with food or body image, please see the pinned resources in [url=#/forums/f-wellbeing]Mental Health & Confidence[/url].'],
      [u1, 'The hair shedding part is so real. Lost a ton after a crash diet in 2023.'],
    ], { sticky: true, tags: ['nutrition', 'evidence'] });

    mkThread('f-face', u4, 'Tongue posture, orthodontics & what actually changes your face', 'research', [
      [u4, 'Summary of what the evidence says:\n\n• [b]Adults:[/b] tongue posture alone won\'t reshape bone. Orthodontics/orthognathic surgery can.\n• [b]Head/neck posture[/b] affects how your jawline photographs a lot.\n• [b]Body fat[/b] & [b]water retention[/b] change facial definition.\n• [b]Brows, hair framing and makeup contour[/b] give the fastest visible change.\n\nAnd to be crystal clear: never try any "DIY" bone or jaw hacks. See an orthodontist or maxillofacial surgeon.'],
      [u6, 'Didn\'t know head posture made such a difference in photos. Tried it, wow.'],
    ], { tags: ['jawline', 'orthodontics'] });

    mkThread('f-style', u5, 'Build a capsule wardrobe in 30 pieces', 'guide', [
      [u5, 'Pick 2 neutrals + 1-2 accent colours from your season. Then:\n\n• 5 tops, 3 knits, 4 bottoms, 2 dresses\n• 2 jackets, 1 coat\n• 4 pairs of shoes\n• Accessories to taste\n\nFit > brand. A good tailor is the ultimate looksmax.'],
    ], { tags: ['capsule', 'style'] });

    mkThread('f-procedures', mod, 'Choosing a qualified injector / surgeon — checklist', 'guide', [
      [mod, '• Board-certified (dermatology / plastic surgery) — verify on the official registry\n• Consultation before any treatment, with risks explained\n• Uses licensed products and can tell you the batch number\n• Has a plan for complications (e.g. hyaluronidase on hand for fillers)\n• Never pressures you\n\n[b]Never buy fillers or botox online to self-inject.[/b] It can cause blindness and necrosis.'],
    ], { sticky: true, locked: true, tags: ['safety'] });

    mkThread('f-rating', u6, 'Rate me honestly (but nicely) — what should I improve?', 'rateme', [
      [u6, 'Here\'s me, no makeup, daylight. What would you focus on first?\n\n[i](image removed in demo)[/i]', { rating: null }],
      [u2, 'You have lovely eyes! Brows a touch fuller would frame your face more. Try a tinted brow gel.', { rating: 7 }],
      [u3, 'Great skin. I\'d try a curtain bang — would suit your face shape.', { rating: 7 }],
      [u5, 'Warm-toned blush and a slightly lighter hair colour would brighten everything up!', { rating: 8 }],
    ], { tags: ['feedback'], ratingEnabled: true });

    mkThread('f-success', u1, 'From constant breakouts to clear skin — 8 months', 'glowup', [
      [u1, 'Dermatologist → adapalene + azelaic acid + boring moisturiser + SPF. That\'s it. Took 8 months and a lot of patience.\n\nThank you all for the support in my old thread! 💗'],
      [mod, 'This is what we love to see. Congrats!'],
      [admin, 'Incredible progress 🏆'],
    ], { tags: ['acne', 'success'] });

    mkThread('f-wellbeing', admin, 'Support resources (pinned)', 'serious', [
      [admin, 'If you\'re struggling, you\'re not alone and you deserve help.\n\n• [b]Emergency:[/b] call your local emergency number\n• [b]US:[/b] 988 Suicide & Crisis Lifeline (call or text 988)\n• [b]UK & ROI:[/b] Samaritans 116 123\n• [b]Eating disorders:[/b] NEDA (US), Beat (UK) 0808 801 0677\n• [b]International:[/b] findahelpline.com\n\nThis forum is peer support, not a replacement for professional care.'],
    ], { sticky: true, locked: true, tags: ['support'] });

    mkThread('f-wellbeing', u3, 'How do you stop comparing yourself to people online?', 'discussion', [
      [u3, 'Some days I spend more time looking at other people than working on myself. How do you deal with it?'],
      [mod, 'Curating my feed helped a lot. Unfollow anything that makes you feel worse, follow people who teach something.'],
      [u5, 'Remind yourself most photos are filtered/edited/angled. Compare you to you from last year instead.'],
    ], { tags: ['confidence'] });

    mkThread('f-offtopic', u5, 'What are you listening to right now?', null, [
      [u5, 'Drop your current song 🎧'],
      [u3, 'Gym playlist on repeat lol'],
      [u1, 'Lo-fi while doing my hair mask'],
    ]);

    mkThread('f-feedback', u6, 'Suggestion: progress photo comparison slider', null, [
      [u6, 'Would love a before/after slider in glow-up threads!'],
      [admin, 'Added to the roadmap 💗'],
    ]);

    mkThread('f-news', admin, 'New study: daily SPF use slows visible skin aging', 'research', [
      [admin, 'A randomised trial summary making the rounds again: participants who applied broad-spectrum sunscreen [b]daily[/b] showed significantly less photoaging over 4.5 years than those who used it at their own discretion.\n\nTakeaway: the best anti-aging product is still the one you wear every morning. Discuss in [url=#/forums/f-skin]Skincare[/url].'],
      [mod, 'The classic Nambour trial! Always worth re-sharing.'],
    ], { tags: ['news', 'spf'] });

    mkThread('f-looks', u5, 'What was your single biggest looksmax so far?', 'discussion', [
      [u5, 'For me it was getting my brows shaped professionally. Changed my whole face. What about you?'],
      [u1, 'Fixing my sleep. Skin, under-eyes, mood — everything improved.'],
      [u3, 'Lifting. Posture + shoulders changed how clothes fit completely.'],
      [u6, 'Finding my colour season 💗'],
    ], { tags: ['discussion'] });

    mkThread('f-body', u3, 'Posture fixes that made the biggest visual difference', 'guide', [
      [u3, '• Chin tucks (2x10 daily)\n• Wall angels\n• Face pulls & rows > pressing for a while\n• Hip flexor stretches if you sit all day\n\nTake a side-profile photo now and in 8 weeks. You\'ll be surprised.'],
      [u4, 'Adding thoracic extensions over a foam roller — game changer.'],
    ], { tags: ['posture', 'body'] });

    mkThread('f-questions', u6, 'Is it worth seeing a dermatologist for mild acne?', 'question', [
      [u6, 'My acne isn\'t severe but it never fully goes away. Is a derm overkill?'],
      [mod, 'Not overkill at all. Prescription topicals (adapalene, azelaic acid, clindamycin, etc.) are cheap and much more effective than guessing with OTC products.'],
    ], { tags: ['acne', 'dermatology'] });

    mkThread('f-private-rating', u5, 'Private: rate my new haircut (members only)', 'rateme', [
      [u5, 'Posting here since it\'s hidden from guests. Went from long layers to a collarbone bob. Thoughts?\n\n[i](image removed in demo)[/i]'],
      [u2, 'Suits your jaw so well! Maybe a slightly warmer gloss next time.', { rating: 8 }],
      [u1, 'The length is perfect for you.', { rating: 8 }],
    ], { tags: ['hair', 'feedback'], ratingEnabled: true });

    // Reputation: members rep helpful posts (+) or rule-breaking ones (−).
    const repComments = ['Super helpful, thank you!', 'Great advice 💗', 'Saved this', 'So informative', 'Exactly what I needed', 'Love this'];
    db.posts.forEach((p) => {
      users.forEach((g) => {
        if (g.id !== p.authorId && Math.random() < 0.12) {
          db.reps.push({ id: uid('rep'), postId: p.id, fromId: g.id, toId: p.authorId, value: g.role === 'admin' ? 3 : g.role === 'mod' ? 2 : 1, comment: Math.random() < 0.6 ? repComments[Math.floor(Math.random() * repComments.length)] : '', created: p.created + HOUR });
        }
      });
    });

    db.profilePosts.push(
      { id: uid('pp'), profileUserId: u6.id, authorId: u2.id, content: 'Welcome to PinkPill! 💕', created: now - 3 * DAY, reactions: { [u6.id]: 'love' }, comments: [{ id: uid('pc'), authorId: u6.id, content: 'Thank you!!', created: now - 3 * DAY + HOUR }] },
      { id: uid('pp'), profileUserId: u1.id, authorId: u3.id, content: 'Your hair log is so motivating!', created: now - 2 * DAY, reactions: {}, comments: [] },
    );

    // Social graph
    const follow = (a, b) => { a.following.push(b.id); b.followers.push(a.id); };
    [u1, u2, u3, u4, u5, u6].forEach((u) => follow(u, admin));
    [u1, u3, u6, u5].forEach((u) => follow(u, mod));
    follow(u6, u2); follow(u6, u1); follow(u3, u1);

    return db;
  }

  /* ---------- persistence ---------- */

  let db = null;
  const listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : null;
    } catch (e) { db = null; }
    if (!db || !db.version) { db = seed(); save(); } else if (db.version < 3) { migrate(db); save(); }
    return db;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.error(e);
      alert('Storage is full. Try removing large images from your posts or clearing old conversations.');
      return false;
    }
  }

  function commit() { save(); listeners.forEach((fn) => fn()); }

  function reset() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION_KEY); load(); }

  function exportJSON() { return JSON.stringify(db, null, 2); }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.users) || !Array.isArray(data.threads)) throw new Error('Not a PinkPill backup file.');
    db = migrate(data.version ? data : Object.assign(data, { version: 1 })); commit();
  }

  /* ---------- session ---------- */

  function currentUser() {
    let id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    const u = id && user(id);
    if (!u || u.banned) return null;
    return u;
  }

  function touch(activity) {
    const u = currentUser();
    if (!u) return;
    u.lastSeen = Date.now();
    if (activity) u.activity = activity;
    save();
  }

  async function register({ username, email, password }) {
    username = (username || '').trim();
    email = (email || '').trim().toLowerCase();
    if (!/^[A-Za-z0-9_.\-]{3,24}$/.test(username)) throw new Error('Username must be 3-24 characters: letters, numbers, _ . -');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter a valid email address.');
    if ((password || '').length < 8) throw new Error('Password must be at least 8 characters.');
    if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('That username is taken.');
    if (db.users.some((u) => u.email === email)) throw new Error('An account with that email already exists.');
    const salt = uid();
    const u = {
      id: uid('u'), username, email, salt, passHash: await hashPassword(password, salt),
      role: db.users.length === 0 ? 'admin' : 'member', banned: false, avatar: null,
      color: ['#ec4899', '#a855f7', '#f43f5e', '#db2777', '#c026d3'][Math.floor(Math.random() * 5)],
      customTitle: '', bio: '', location: '', website: '', birthday: '', signature: '',
      joined: Date.now(), lastSeen: Date.now(), activity: 'Registering',
      followers: [], following: [], ignoring: [], bookmarks: [], watched: [], trophies: [],
      settings: { theme: 'auto', emailAlerts: false, showOnline: true, allowDMs: 'everyone', allowProfilePosts: 'everyone' },
    };
    db.users.push(u);
    localStorage.setItem(SESSION_KEY, u.id);
    addAlert(u.id, null, 'welcome', 'Welcome to PinkPill! Start by introducing yourself.', '#/forums/f-intro');
    commit();
    return u;
  }

  async function login(name, password) {
    const n = (name || '').trim().toLowerCase();
    const u = db.users.find((x) => x.username.toLowerCase() === n || x.email === n);
    if (!u) throw new Error('Incorrect username/email or password.');
    if (u.banned) throw new Error('This account has been banned.' + (u.banReason ? ' Reason: ' + u.banReason : ''));
    if (!u.passHash) throw new Error('This is a demo account without a password. Use "Log in as demo user" instead.');
    if ((await hashPassword(password, u.salt)) !== u.passHash) throw new Error('Incorrect username/email or password.');
    localStorage.setItem(SESSION_KEY, u.id);
    u.lastSeen = Date.now();
    commit();
    return u;
  }

  function loginAs(id) { localStorage.setItem(SESSION_KEY, id); touch(); listeners.forEach((fn) => fn()); }

  function logout() { localStorage.removeItem(SESSION_KEY); listeners.forEach((fn) => fn()); }

  async function changePassword(u, oldPw, newPw) {
    if (u.passHash && (await hashPassword(oldPw, u.salt)) !== u.passHash) throw new Error('Current password is incorrect.');
    if ((newPw || '').length < 8) throw new Error('New password must be at least 8 characters.');
    u.salt = uid(); u.passHash = await hashPassword(newPw, u.salt); commit();
  }

  /* ---------- lookups ---------- */

  const user = (id) => db.users.find((u) => u.id === id);
  const userByName = (name) => db.users.find((u) => u.username.toLowerCase() === String(name).toLowerCase());
  const forum = (id) => db.forums.find((f) => f.id === id);
  const thread = (id) => db.threads.find((t) => t.id === id);
  const post = (id) => db.posts.find((p) => p.id === id);
  const postsIn = (threadId) => db.posts.filter((p) => p.threadId === threadId).sort((a, b) => a.created - b.created);
  const threadsIn = (forumId) => db.threads.filter((t) => t.forumId === forumId);
  const lastPost = (threadId) => { const ps = postsIn(threadId).filter((p) => !p.deleted); return ps[ps.length - 1]; };

  const childForums = (id) => db.forums.filter((f) => f.parentId === id).sort((a, b) => a.order - b.order);
  function forumTree(id) { return [id].concat(...childForums(id).map((c) => forumTree(c.id))); }
  function forumPath(f) { const out = []; while (f) { out.unshift(f); f = f.parentId ? forum(f.parentId) : null; } return out; }
  /* A forum is visible if it (and every parent) allows the viewer; membersOnly hides it from guests. */
  function canViewForum(f, u) {
    if (!f) return false;
    if (f.membersOnly && !u) return false;
    return f.parentId ? canViewForum(forum(f.parentId), u) : true;
  }
  const canViewThread = (t, u) => !!t && canViewForum(forum(t.forumId), u);
  const canViewPost = (p, u) => !!p && canViewThread(thread(p.threadId), u);

  function forumStats(forumId, u) {
    const ids = new Set(forumTree(forumId).filter((id) => arguments.length < 2 || canViewForum(forum(id), u)));
    const ts = db.threads.filter((t) => ids.has(t.forumId));
    const tids = new Set(ts.map((t) => t.id));
    const ps = db.posts.filter((p) => tids.has(p.threadId) && !p.deleted);
    let last = null;
    ps.forEach((p) => { if (!last || p.created > last.created) last = p; });
    return { threads: ts.length, messages: ps.length, last };
  }

  function userStats(u) {
    const ps = db.posts.filter((p) => p.authorId === u.id && !p.deleted);
    let score = 0;
    ps.forEach((p) => Object.values(p.reactions || {}).forEach((r) => { const def = REACTIONS.find((x) => x.id === r); score += def ? def.score : 0; }));
    db.profilePosts.filter((p) => p.authorId === u.id).forEach((p) => { score += Object.keys(p.reactions || {}).length; });
    const glowups = db.threads.filter((t) => t.authorId === u.id && t.forumId === 'f-success').length;
    const s = { posts: ps.length, score, rep: repFor(u.id), followers: u.followers.length, glowups, threads: db.threads.filter((t) => t.authorId === u.id).length };
    s.trophies = TROPHIES.filter((t) => t.test(s));
    s.points = s.trophies.reduce((a, t) => a + t.points, 0);
    s.rank = RANKS.filter((r) => s.posts >= r.min).pop().title;
    return s;
  }

  function isOnline(u) { return u && u.settings.showOnline !== false && Date.now() - u.lastSeen < 15 * MIN; }
  const isStaff = (u) => !!u && (u.role === 'admin' || u.role === 'mod');

  /* ---------- alerts ---------- */

  function addAlert(userId, fromId, type, text, link) {
    if (!userId || userId === fromId) return;
    const target = user(userId);
    if (target && fromId && target.ignoring.includes(fromId)) return;
    db.alerts.push({ id: uid('a'), userId, fromId, type, text, link, created: Date.now(), read: false });
  }

  function alertsFor(u) { return db.alerts.filter((a) => a.userId === u.id).sort((a, b) => b.created - a.created); }

  function markAlertsRead(u) { db.alerts.forEach((a) => { if (a.userId === u.id) a.read = true; }); commit(); }

  function checkTrophies(u) {
    const s = userStats(u);
    s.trophies.forEach((t) => {
      if (!u.trophies.includes(t.id)) {
        u.trophies.push(t.id);
        addAlert(u.id, null, 'trophy', 'You have been awarded a trophy: ' + t.title, '#/members/' + u.id + '/trophies');
      }
    });
  }

  function mentions(content, from, link, threadTitle) {
    const names = new Set();
    (content.match(/@([A-Za-z0-9_.\-]{3,24})/g) || []).forEach((m) => names.add(m.slice(1).toLowerCase()));
    names.forEach((n) => {
      const u = userByName(n);
      if (u) addAlert(u.id, from.id, 'mention', from.username + ' mentioned you in ' + threadTitle, link);
    });
    const quoted = content.match(/\[quote=([^\]\s]+)[^\]]*\]/g) || [];
    quoted.forEach((q) => {
      const u = userByName(q.slice(7, -1).split(/[\s,]/)[0]);
      if (u) addAlert(u.id, from.id, 'quote', from.username + ' quoted your post in ' + threadTitle, link);
    });
  }

  /* ---------- safety ---------- */

  function safetyCheck(text) {
    const t = (text || '').toLowerCase();
    return {
      danger: SAFETY.danger.filter((w) => t.includes(w)),
      crisis: SAFETY.crisis.filter((w) => new RegExp('\\b' + w.replace(/[-\s]/g, '[-\\s]?') + '\\b').test(t)),
    };
  }

  function autoReport(postId, words) {
    db.reports.push({ id: uid('r'), kind: 'post', targetId: postId, reporterId: null, reason: 'Automatic flag: possible rule 3 violation (' + words.join(', ') + ')', created: Date.now(), resolved: false });
  }

  /* ---------- actions ---------- */

  function assertCan(u) {
    if (!u) throw new Error('You must be logged in to do that.');
    if (u.banned) throw new Error('Your account is banned.');
  }

  function createThread(u, { forumId, title, content, prefix, tags, poll, ratingEnabled }) {
    assertCan(u);
    const f = forum(forumId);
    if (!f) throw new Error('Forum not found.');
    if (f.staffOnly && !isStaff(u)) throw new Error('Only staff can post in this forum.');
    if (!canViewForum(f, u)) throw new Error('You don\'t have access to this forum.');
    title = (title || '').trim();
    if (title.length < 3) throw new Error('Please enter a title of at least 3 characters.');
    if ((content || '').trim().length < 2) throw new Error('Please enter a message.');
    const th = {
      id: uid('t'), forumId, authorId: u.id, title: title.slice(0, 150), prefix: prefix || null, created: Date.now(),
      sticky: false, locked: false, views: 0, tags: (tags || []).slice(0, 10), poll: poll || null, watchers: [u.id],
      ratingEnabled: !!(ratingEnabled || f.rating),
    };
    db.threads.push(th);
    const p = { id: uid('p'), threadId: th.id, authorId: u.id, content, created: th.created, edited: null, reactions: {}, deleted: false };
    db.posts.push(p);
    if (!u.watched.includes(th.id)) u.watched.push(th.id);
    u.followers.forEach((fid) => addAlert(fid, u.id, 'follow-thread', u.username + ' started a new thread: ' + th.title, '#/threads/' + th.id));
    mentions(content, u, '#/threads/' + th.id + '/post-' + p.id, th.title);
    const s = safetyCheck(title + ' ' + content);
    if (s.danger.length) autoReport(p.id, s.danger);
    checkTrophies(u);
    commit();
    return { thread: th, post: p, safety: s };
  }

  function reply(u, threadId, content, rating) {
    assertCan(u);
    const th = thread(threadId);
    if (!th) throw new Error('Thread not found.');
    if (th.locked && !isStaff(u)) throw new Error('This thread is locked.');
    if ((content || '').trim().length < 2) throw new Error('Please enter a message.');
    const p = { id: uid('p'), threadId, authorId: u.id, content, created: Date.now(), edited: null, reactions: {}, deleted: false };
    const alreadyRated = db.posts.some((x) => x.threadId === threadId && x.authorId === u.id && x.rating != null && !x.deleted);
    if (th.ratingEnabled && rating != null && rating !== '' && th.authorId !== u.id && !alreadyRated) {
      const n = Math.max(1, Math.min(10, Number(rating)));
      if (!isNaN(n)) p.rating = n;
    }
    db.posts.push(p);
    const link = '#/threads/' + th.id + '/post-' + p.id;
    (th.watchers || []).forEach((wid) => addAlert(wid, u.id, 'reply', u.username + ' replied to the thread ' + th.title, link));
    if (!th.watchers.includes(u.id)) th.watchers.push(u.id);
    if (!u.watched.includes(th.id)) u.watched.push(th.id);
    mentions(content, u, link, th.title);
    const s = safetyCheck(content);
    if (s.danger.length) autoReport(p.id, s.danger);
    checkTrophies(u);
    commit();
    return { post: p, safety: s };
  }

  function editPost(u, postId, content, reason) {
    const p = post(postId);
    if (!p) throw new Error('Post not found.');
    if (p.authorId !== u.id && !isStaff(u)) throw new Error('You cannot edit this post.');
    p.history = p.history || [];
    p.history.push({ content: p.content, at: p.edited || p.created });
    p.content = content; p.edited = Date.now(); p.editReason = reason || '';
    p.editedBy = u.id;
    const s = safetyCheck(content);
    if (s.danger.length) autoReport(p.id, s.danger);
    commit();
    return s;
  }

  function deletePost(u, postId, reason) {
    const p = post(postId);
    if (!p) return;
    if (p.authorId !== u.id && !isStaff(u)) throw new Error('You cannot delete this post.');
    const th = thread(p.threadId);
    const first = postsIn(th.id)[0];
    if (first.id === p.id) { deleteThread(u, th.id); return 'thread'; }
    p.deleted = true; p.deletedBy = u.id; p.deleteReason = reason || '';
    commit();
    return 'post';
  }

  function undeletePost(u, postId) {
    if (!isStaff(u)) return;
    const p = post(postId); if (p) { p.deleted = false; commit(); }
  }

  function deleteThread(u, threadId) {
    const th = thread(threadId);
    if (!th) return;
    if (th.authorId !== u.id && !isStaff(u)) throw new Error('You cannot delete this thread.');
    db.threads = db.threads.filter((t) => t.id !== threadId);
    const removed = new Set(db.posts.filter((p) => p.threadId === threadId).map((p) => p.id));
    db.posts = db.posts.filter((p) => p.threadId !== threadId);
    db.users.forEach((x) => { x.bookmarks = x.bookmarks.filter((b) => !removed.has(b)); x.watched = x.watched.filter((w) => w !== threadId); });
    commit();
  }

  function updateThread(u, threadId, changes) {
    const th = thread(threadId);
    if (!th) return;
    const own = th.authorId === u.id;
    if (!own && !isStaff(u)) throw new Error('No permission.');
    ['title', 'prefix', 'tags'].forEach((k) => { if (k in changes) th[k] = changes[k]; });
    if (isStaff(u)) ['sticky', 'locked', 'forumId'].forEach((k) => { if (k in changes) th[k] = changes[k]; });
    commit();
  }

  function react(u, kind, id, reactionId) {
    assertCan(u);
    let target, link, what;
    if (kind === 'post') {
      target = post(id); const th = target && thread(target.threadId);
      link = '#/threads/' + target.threadId + '/post-' + id; what = 'your post in ' + (th ? th.title : 'a thread');
    } else {
      target = db.profilePosts.find((p) => p.id === id);
      link = '#/members/' + target.profileUserId; what = 'your profile post';
    }
    if (!target) return;
    if (target.authorId === u.id) throw new Error('You can\'t react to your own content.');
    target.reactions = target.reactions || {};
    if (target.reactions[u.id] === reactionId || !reactionId) delete target.reactions[u.id];
    else {
      const had = !!target.reactions[u.id];
      target.reactions[u.id] = reactionId;
      if (!had) {
        const def = REACTIONS.find((r) => r.id === reactionId);
        addAlert(target.authorId, u.id, 'reaction', u.username + ' reacted to ' + what + ' with ' + def.emoji + ' ' + def.label, link);
      }
    }
    const author = user(target.authorId); if (author) checkTrophies(author);
    commit();
  }

  function votePoll(u, threadId, optionIdxs) {
    assertCan(u);
    const th = thread(threadId);
    if (!th || !th.poll) return;
    if (th.poll.closes && Date.now() > th.poll.closes) throw new Error('This poll has closed.');
    th.poll.options.forEach((o) => { o.votes = o.votes.filter((v) => v !== u.id); });
    optionIdxs.forEach((i) => { if (th.poll.options[i]) th.poll.options[i].votes.push(u.id); });
    commit();
  }

  function toggleIn(list, id) { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); return i < 0; }

  function toggleBookmark(u, postId) { assertCan(u); const on = toggleIn(u.bookmarks, postId); commit(); return on; }

  function toggleWatch(u, threadId) {
    assertCan(u);
    const th = thread(threadId);
    const on = toggleIn(u.watched, threadId);
    if (on) { if (!th.watchers.includes(u.id)) th.watchers.push(u.id); } else th.watchers = th.watchers.filter((w) => w !== u.id);
    commit(); return on;
  }

  function toggleFollow(u, targetId) {
    assertCan(u);
    const t = user(targetId);
    if (!t || t.id === u.id) return;
    const on = toggleIn(u.following, t.id);
    if (on) { t.followers.push(u.id); addAlert(t.id, u.id, 'follow', u.username + ' started following you.', '#/members/' + u.id); }
    else t.followers = t.followers.filter((x) => x !== u.id);
    checkTrophies(t);
    commit(); return on;
  }

  function toggleIgnore(u, targetId) {
    assertCan(u);
    const t = user(targetId);
    if (!t || t.id === u.id) return;
    if (isStaff(t)) throw new Error('Staff members cannot be ignored.');
    const on = toggleIn(u.ignoring, targetId); commit(); return on;
  }

  function report(u, kind, targetId, reason) {
    assertCan(u);
    if (!(reason || '').trim()) throw new Error('Please give a reason.');
    db.reports.push({ id: uid('r'), kind, targetId, reporterId: u.id, reason: reason.trim(), created: Date.now(), resolved: false });
    db.users.filter(isStaff).forEach((s) => addAlert(s.id, u.id, 'report', u.username + ' reported content: ' + reason.slice(0, 60), '#/mod/reports'));
    commit();
  }

  function resolveReport(u, reportId, note) {
    if (!isStaff(u)) return;
    const r = db.reports.find((x) => x.id === reportId);
    if (r) { r.resolved = true; r.resolvedBy = u.id; r.resolvedAt = Date.now(); r.note = note || ''; if (r.reporterId) addAlert(r.reporterId, u.id, 'report-resolved', 'Your report has been resolved. Thank you!', '#/alerts'); commit(); }
  }

  function banUser(u, targetId, reason) {
    if (!isStaff(u)) return;
    const t = user(targetId);
    if (!t || t.role === 'admin') throw new Error('Admins cannot be banned.');
    t.banned = !t.banned; t.banReason = t.banned ? (reason || '') : '';
    commit(); return t.banned;
  }

  function setRole(u, targetId, role) {
    if (!u || u.role !== 'admin') throw new Error('Only admins can change roles.');
    const t = user(targetId); if (t && t.id !== u.id) { t.role = role; commit(); }
  }

  function warnUser(u, targetId, reason, points) {
    if (!isStaff(u)) return;
    const t = user(targetId);
    t.warnings = t.warnings || [];
    t.warnings.push({ id: uid('w'), by: u.id, reason, points: Number(points) || 1, created: Date.now() });
    addAlert(t.id, null, 'warning', 'You received a warning: ' + reason, '#/account/warnings');
    commit();
  }

  function updateProfile(u, changes) {
    ['customTitle', 'bio', 'location', 'website', 'birthday', 'signature', 'avatar', 'color', 'banner'].forEach((k) => { if (k in changes) u[k] = changes[k]; });
    if (changes.settings) Object.assign(u.settings, changes.settings);
    commit();
  }

  function addProfilePost(u, profileUserId, content) {
    assertCan(u);
    const target = user(profileUserId);
    if (target.ignoring.includes(u.id)) throw new Error('You can\'t post on this profile.');
    if (target.settings.allowProfilePosts === 'none' && target.id !== u.id) throw new Error('This member doesn\'t accept profile posts.');
    if (target.settings.allowProfilePosts === 'followed' && target.id !== u.id && !target.following.includes(u.id)) throw new Error('This member only accepts profile posts from people they follow.');
    if (!(content || '').trim()) throw new Error('Please enter a message.');
    const pp = { id: uid('pp'), profileUserId, authorId: u.id, content, created: Date.now(), reactions: {}, comments: [] };
    db.profilePosts.push(pp);
    addAlert(profileUserId, u.id, 'profile-post', u.username + ' wrote on your profile.', '#/members/' + profileUserId);
    mentions(content, u, '#/members/' + profileUserId, 'a profile post');
    commit();
    return pp;
  }

  function commentProfilePost(u, ppId, content) {
    assertCan(u);
    const pp = db.profilePosts.find((p) => p.id === ppId);
    if (!pp || !(content || '').trim()) return;
    pp.comments.push({ id: uid('pc'), authorId: u.id, content, created: Date.now() });
    addAlert(pp.authorId, u.id, 'profile-comment', u.username + ' commented on your profile post.', '#/members/' + pp.profileUserId);
    if (pp.profileUserId !== pp.authorId) addAlert(pp.profileUserId, u.id, 'profile-comment', u.username + ' commented on a post on your profile.', '#/members/' + pp.profileUserId);
    commit();
  }

  function deleteProfilePost(u, ppId) {
    const pp = db.profilePosts.find((p) => p.id === ppId);
    if (!pp) return;
    if (pp.authorId !== u.id && pp.profileUserId !== u.id && !isStaff(u)) throw new Error('No permission.');
    db.profilePosts = db.profilePosts.filter((p) => p.id !== ppId); commit();
  }

  /* ---------- conversations (DMs) ---------- */

  function conversationsFor(u) {
    return db.conversations.filter((c) => c.participants.includes(u.id) && !(c.left || []).includes(u.id))
      .sort((a, b) => lastMsgAt(b) - lastMsgAt(a));
  }
  const lastMsgAt = (c) => c.messages[c.messages.length - 1].created;
  const isUnread = (c, u) => lastMsgAt(c) > ((c.readBy || {})[u.id] || 0);

  function canDM(from, to) {
    if (!to || to.id === from.id) return false;
    if (isStaff(from)) return true;
    if (to.ignoring.includes(from.id)) return false;
    if (to.settings.allowDMs === 'none') return false;
    if (to.settings.allowDMs === 'followed') return to.following.includes(from.id);
    return true;
  }

  function startConversation(u, { to, title, content, allowInvite }) {
    assertCan(u);
    const names = (to || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new Error('Please enter at least one recipient.');
    const recips = names.map((n) => { const r = userByName(n); if (!r) throw new Error('Member not found: ' + n); if (!canDM(u, r)) throw new Error(r.username + ' can\'t receive messages from you.'); return r; });
    if (!(title || '').trim()) throw new Error('Please enter a title.');
    if (!(content || '').trim()) throw new Error('Please enter a message.');
    const c = {
      id: uid('c'), title: title.trim(), starterId: u.id, participants: [u.id, ...recips.map((r) => r.id)].filter((v, i, a) => a.indexOf(v) === i),
      allowInvite: !!allowInvite, left: [], starred: [], readBy: { [u.id]: Date.now() },
      messages: [{ id: uid('m'), authorId: u.id, content, created: Date.now(), reactions: {} }],
    };
    db.conversations.push(c);
    recips.forEach((r) => addAlert(r.id, u.id, 'conversation', u.username + ' started a conversation with you: ' + c.title, '#/conversations/' + c.id));
    commit();
    return c;
  }

  function replyConversation(u, convId, content) {
    const c = db.conversations.find((x) => x.id === convId);
    if (!c || !c.participants.includes(u.id)) throw new Error('Conversation not found.');
    if (!(content || '').trim()) throw new Error('Please enter a message.');
    c.messages.push({ id: uid('m'), authorId: u.id, content, created: Date.now(), reactions: {} });
    c.left = []; // members who left rejoin when a new message arrives
    c.readBy[u.id] = Date.now();
    commit();
  }

  function inviteToConversation(u, convId, names) {
    const c = db.conversations.find((x) => x.id === convId);
    if (!c || (c.starterId !== u.id && !c.allowInvite)) throw new Error('You can\'t invite members to this conversation.');
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => {
      const r = userByName(n);
      if (!r) throw new Error('Member not found: ' + n);
      if (!c.participants.includes(r.id)) { c.participants.push(r.id); addAlert(r.id, u.id, 'conversation', u.username + ' invited you to a conversation: ' + c.title, '#/conversations/' + c.id); }
    });
    commit();
  }

  function markConvRead(u, c) { c.readBy = c.readBy || {}; c.readBy[u.id] = Date.now(); save(); }
  function leaveConversation(u, convId) { const c = db.conversations.find((x) => x.id === convId); if (c) { c.left = c.left || []; c.left.push(u.id); commit(); } }
  function toggleStarConv(u, convId) { const c = db.conversations.find((x) => x.id === convId); if (c) { c.starred = c.starred || []; toggleIn(c.starred, u.id); commit(); } }

  /* ---------- reputation ---------- */

  const REP_DAILY_LIMIT = 10;
  const NEG_REP_MIN_POSTS = 10;

  /* How much one rep from this member is worth: grows with activity, staff get a bonus. */
  function repPower(u) {
    if (!u) return 0;
    const posts = db.posts.filter((p) => p.authorId === u.id && !p.deleted).length;
    const base = Math.min(5, 1 + Math.floor(posts / 100));
    return base + (u.role === 'admin' ? 2 : u.role === 'mod' ? 1 : 0);
  }
  const repFor = (userId) => (db.reps || []).filter((r) => r.toId === userId).reduce((a, r) => a + r.value, 0);
  const repsForPost = (postId) => (db.reps || []).filter((r) => r.postId === postId);
  const repsGivenToday = (u) => (db.reps || []).filter((r) => r.fromId === u.id && Date.now() - r.created < DAY).length;

  function repLevel(total) {
    if (total >= 250) return { label: 'Legendary', cls: 'rep--5' };
    if (total >= 100) return { label: 'Highly respected', cls: 'rep--4' };
    if (total >= 30) return { label: 'Respected', cls: 'rep--3' };
    if (total >= 5) return { label: 'Well liked', cls: 'rep--2' };
    if (total >= 0) return { label: 'Neutral', cls: 'rep--1' };
    return { label: 'Negative', cls: 'rep--neg' };
  }

  function giveRep(u, postId, positive, comment) {
    assertCan(u);
    const p = post(postId);
    if (!p || p.deleted) throw new Error('Post not found.');
    if (p.authorId === u.id) throw new Error('You can\'t give reputation to yourself.');
    db.reps = db.reps || [];
    if (db.reps.some((r) => r.postId === postId && r.fromId === u.id)) throw new Error('You have already given reputation for this post.');
    if (repsGivenToday(u) >= REP_DAILY_LIMIT) throw new Error('You\'ve given ' + REP_DAILY_LIMIT + ' reputation in the last 24 hours. Try again later.');
    const own = db.posts.filter((x) => x.authorId === u.id && !x.deleted).length;
    if (!positive && own < NEG_REP_MIN_POSTS && !isStaff(u)) throw new Error('You need at least ' + NEG_REP_MIN_POSTS + ' messages to give negative reputation.');
    comment = (comment || '').trim().slice(0, 200);
    if (!positive && !comment) throw new Error('Please explain why you\'re giving negative reputation.');
    const value = (positive ? 1 : -1) * repPower(u);
    db.reps.push({ id: uid('rep'), postId, fromId: u.id, toId: p.authorId, value, comment, created: Date.now() });
    const th = thread(p.threadId);
    addAlert(p.authorId, u.id, 'rep', u.username + ' gave you ' + (value > 0 ? '+' : '') + value + ' reputation for your post in ' + th.title + (comment ? ': "' + comment + '"' : ''), '#/threads/' + th.id + '/post-' + p.id);
    const author = user(p.authorId); if (author) checkTrophies(author);
    commit();
    return value;
  }

  function removeRep(u, repId) {
    const r = (db.reps || []).find((x) => x.id === repId);
    if (!r) return;
    if (r.fromId !== u.id && !isStaff(u)) throw new Error('No permission.');
    db.reps = db.reps.filter((x) => x.id !== repId);
    commit();
  }

  /* ---------- search ---------- */

  function search({ q, type, member, forumId, titlesOnly, order, viewer }) {
    q = (q || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const match = (s) => words.every((w) => s.toLowerCase().includes(w));
    const author = member ? userByName(member) : null;
    if (member && !author) return [];
    let results = [];
    if (!type || type === 'post' || type === 'thread') {
      db.threads.forEach((t) => {
        if (forumId && !forumTree(forumId).includes(t.forumId)) return;
        if (!canViewThread(t, viewer)) return;
        const ps = postsIn(t.id).filter((p) => !p.deleted);
        const titleHit = !words.length || match(t.title) || t.tags.some((tag) => words.includes(tag));
        if (type === 'thread' || titlesOnly) {
          if (titleHit && (!author || t.authorId === author.id)) results.push({ kind: 'thread', thread: t, post: ps[0], created: t.created });
          return;
        }
        ps.forEach((p, i) => {
          if (author && p.authorId !== author.id) return;
          if ((i === 0 && titleHit && words.length) || (words.length && match(p.content)) || (!words.length && author)) results.push({ kind: i === 0 ? 'thread' : 'post', thread: t, post: p, created: p.created });
        });
      });
    }
    if (!type || type === 'profile_post') {
      db.profilePosts.forEach((pp) => {
        if (author && pp.authorId !== author.id) return;
        if ((words.length && match(pp.content)) || (!words.length && author)) results.push({ kind: 'profile_post', profilePost: pp, created: pp.created });
      });
    }
    if (order === 'relevance' && words.length) {
      const score = (r) => words.reduce((a, w) => a + ((r.thread ? r.thread.title : '').toLowerCase().includes(w) ? 5 : 0) + ((r.post || r.profilePost || {}).content || '').toLowerCase().split(w).length - 1, 0);
      results.sort((a, b) => score(b) - score(a));
    } else results.sort((a, b) => b.created - a.created);
    return results.slice(0, 200);
  }

  window.PP = window.PP || {};
  Object.assign(window.PP, {
    store: {
      load, save, commit, reset, exportJSON, importJSON, get db() { return db; }, onChange: (fn) => listeners.push(fn),
      currentUser, touch, register, login, loginAs, logout, changePassword,
      user, userByName, forum, thread, post, postsIn, threadsIn, lastPost, forumStats, userStats, isOnline, isStaff,
      childForums, forumTree, forumPath, canViewForum, canViewThread, canViewPost,
      repPower, repFor, repsForPost, repsGivenToday, repLevel, giveRep, removeRep, REP_DAILY_LIMIT, NEG_REP_MIN_POSTS,
      alertsFor, markAlertsRead, addAlert, safetyCheck,
      createThread, reply, editPost, deletePost, undeletePost, deleteThread, updateThread, react, votePoll,
      toggleBookmark, toggleWatch, toggleFollow, toggleIgnore, report, resolveReport, banUser, setRole, warnUser,
      updateProfile, addProfilePost, commentProfilePost, deleteProfilePost,
      conversationsFor, isUnread, canDM, startConversation, replyConversation, inviteToConversation, markConvRead, leaveConversation, toggleStarConv,
      search,
    },
    REACTIONS, PREFIXES, RANKS, TROPHIES, SAFETY, uid, MIN, HOUR, DAY,
  });
})();

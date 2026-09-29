'use strict';
const db = require('../db');
const config = require('../config');
const { summaries } = require('./users');

/* The logged-in user's own view of themselves: includes private fields only they may see. */
async function mePayload(user) {
  if (!user) return null;
  const [s] = Object.values(await summaries([user.id]));
  const row = await db.one(`SELECT u.email, u.status, u.email_verified_at, u.read_all_at,
      p.bio, p.website, p.birthday, p.banner_id,
      pr.theme, pr.show_online, pr.allow_dms, pr.allow_profile_posts, pr.show_signatures, pr.auto_watch
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN user_preferences pr ON pr.user_id = u.id WHERE u.id = $1`, [user.id]);
  return Object.assign(s, {
    email: row.email,
    status: row.status,
    emailVerified: !!row.email_verified_at,
    mustVerifyEmail: config.requireEmailVerification && row.status !== 'active',
    permissions: [...user.permissions].sort(),
    rankLevel: user.rank,
    ban: user.ban,
    bio: row.bio || '', website: row.website || '',
    birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : '',
    bannerUrl: row.banner_id ? '/media/' + row.banner_id : null,
    prefs: {
      theme: row.theme || 'auto', showOnline: row.show_online !== false, allowDms: row.allow_dms || 'everyone',
      allowProfilePosts: row.allow_profile_posts || 'everyone', showSignatures: row.show_signatures !== false, autoWatch: row.auto_watch !== false,
    },
  });
}
module.exports = { mePayload };

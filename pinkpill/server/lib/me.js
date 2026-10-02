'use strict';
const db = require('../db');
const config = require('../config');
const { summaries } = require('./users');
const vip = require('./vip');

/* The logged-in user's own view of themselves: includes private fields only they may see. */
async function mePayload(user) {
  if (!user) return null;
  const [s] = Object.values(await summaries([user.id]));
  const row = await db.one(`SELECT u.email, u.status, u.email_verified_at, u.read_all_at,
      u.username_changed_at, p.bio, p.website, p.birthday, p.banner_id, p.vanity, p.vanity_changed_at,
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
    vipStatus: await vip.selfView(user.id),
    walletCents: await vip.walletBalance(user.id),
    // There is no advertising system yet; this flag tells any future ad slot whether to render.
    showAds: !(user.vip && user.vip.noAds),
    usernameChangedAt: row.username_changed_at,
    vanity: row.vanity || null,
    vanityChangedAt: row.vanity_changed_at,
    prefs: {
      theme: row.theme || 'auto', showOnline: row.show_online !== false, allowDms: row.allow_dms || 'everyone',
      allowProfilePosts: row.allow_profile_posts || 'everyone', showSignatures: row.show_signatures !== false, autoWatch: row.auto_watch !== false,
    },
  });
}
module.exports = { mePayload };

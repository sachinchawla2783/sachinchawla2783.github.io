/* PinkPill client state and display constants.
 * All forum data now lives on the server (see /api). This file only holds labels used for
 * rendering and small helpers for reading the cached, server-provided member summaries. */
(function () {
  'use strict';
  const PP = window.PP = window.PP || {};

  PP.REACTIONS = [
    { id: 'like', emoji: '👍', label: 'Like', score: 1 },
    { id: 'love', emoji: '💖', label: 'Love', score: 1 },
    { id: 'glow', emoji: '✨', label: 'Glow', score: 1 },
    { id: 'haha', emoji: '😂', label: 'Haha', score: 0 },
    { id: 'wow', emoji: '😮', label: 'Wow', score: 0 },
    { id: 'hug', emoji: '🫂', label: 'Hug', score: 1 },
    { id: 'sad', emoji: '😢', label: 'Sad', score: 0 },
  ];

  // VIP+ custom reactions. The server only accepts them from members whose membership includes them.
  PP.VIP_REACTIONS = [
    { id: 'fire', emoji: '🔥', label: 'Fire', score: 0, vip: true },
    { id: 'crown', emoji: '👑', label: 'Crown', score: 0, vip: true },
    { id: 'gem', emoji: '💎', label: 'Gem', score: 0, vip: true },
    { id: 'butterfly', emoji: '🦋', label: 'Butterfly', score: 0, vip: true },
  ];
  PP.reactionDef = (id) => PP.REACTIONS.concat(PP.VIP_REACTIONS).find((r) => r.id === id) || null;

  PP.PREFIXES = [
    { id: 'question', label: 'Question', color: '#3b82f6' },
    { id: 'lifefuel', label: 'LifeFuel', color: '#16a34a' },
    { id: 'discussion', label: 'Discussion', color: '#8b5cf6' },
    { id: 'blackpill', label: 'Blackpill', color: '#111827' },
    { id: 'redpill', label: 'Redpill', color: '#dc2626' },
    { id: 'mogs', label: 'Mogs', color: '#c026d3' },
    { id: 'whitepill', label: 'Whitepill', color: '#64748b' },
    { id: 'bluepill', label: 'Bluepill', color: '#2563eb' },
    { id: 'guide', label: 'Guide', color: '#10b981' },
    { id: 'serious', label: 'Serious', color: '#475569' },
    { id: 'success', label: 'Success', color: '#059669' },
    { id: 'motivation', label: 'Motivation', color: '#f59e0b' },
    { id: 'rage', label: 'Rage', color: '#b91c1c' },
    { id: 'looksmax', label: 'Looksmax', color: '#ec4899' },
    { id: 'news', label: 'News', color: '#0ea5e9' },
    { id: 'jfl', label: 'JFL', color: '#ea580c' },
    { id: 'theory', label: 'Theory', color: '#6366f1' },
    { id: 'venting', label: 'Venting', color: '#78716c' },
    { id: 'over', label: 'Over', color: '#1f2937' },
    { id: 'cope', label: 'Cope', color: '#a16207' },
    { id: 'slay', label: 'Slay', color: '#db2777' },
    { id: 'rateme', label: 'Rate Me', color: '#ec4899' },
  ];

  PP.ROLE_TITLES = { member: 'Registered member', moderator: 'Moderator', admin: 'Admin', global_admin: 'Global Admin', super_admin: 'Owner' };

  function repLevel(total) {
    if (total >= 250) return { label: 'Legendary', cls: 'rep--5' };
    if (total >= 100) return { label: 'Highly respected', cls: 'rep--4' };
    if (total >= 30) return { label: 'Respected', cls: 'rep--3' };
    if (total >= 5) return { label: 'Well liked', cls: 'rep--2' };
    if (total >= 0) return { label: 'Neutral', cls: 'rep--1' };
    return { label: 'Negative', cls: 'rep--neg' };
  }

  PP.store = {
    me: () => PP.session.user,
    user: (id) => (id ? PP.users[String(id)] || null : null),
    can: (perm) => !!(PP.session.user && PP.session.user.permissions.includes(perm) && !PP.session.user.ban && !PP.session.user.mustVerifyEmail),
    isStaff: (u) => !!u && !!u.isStaff,
    isOnline: (u) => !!u && !!u.online,
    repLevel,
    REP_DAILY_LIMIT: 10,
    NEG_REP_MIN_POSTS: 10,
  };
})();

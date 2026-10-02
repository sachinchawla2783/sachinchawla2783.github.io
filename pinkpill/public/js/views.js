/* Page views. Each is async, loads its data from the API and returns { title, html, sidebar?, after? }.
 * The markup and CSS classes are unchanged from the prototype. */
(function () {
  'use strict';
  const PP = window.PP;
  const { store, api, esc, bbcode, time, num, ui, snippet, fullDate, timeAgo } = PP;
  const { avatar, username, userTitle, prefix, pagination, breadcrumb, editor, nsfwTag } = ui;
  const me = () => PP.session.user;
  const U = (id) => store.user(id);
  const can = (p) => store.can(p);

  function repBadge(total) {
    const lv = store.repLevel(total || 0);
    return '<span class="rep ' + lv.cls + '" title="Reputation: ' + lv.label + '">' + (total > 0 ? '+' : '') + num(total || 0) + '</span>';
  }

  /* ---------- sidebar widgets (one API call, cached briefly) ---------- */

  let widgetCache = null, widgetAt = 0;
  async function widgets() {
    if (!widgetCache || Date.now() - widgetAt > 20000) { widgetCache = await api.get('/widgets/sidebar'); widgetAt = Date.now(); }
    return widgetCache;
  }
  PP.invalidateWidgets = () => { widgetCache = null; };

  function widgetOnline(w) {
    const online = w.online.map((o) => U(o.userId)).filter(Boolean);
    const staff = online.filter((u) => u.isStaff);
    const total = Math.max(w.onlineTotal || 0, online.length);
    const more = total - online.length;
    return '<section class="block"><h3 class="block-head"><a href="#/online">Members online</a></h3><div class="block-body">' +
      (online.length ? '<div class="online-names">' + online.map((u) => username(u)).join(', ') + (more > 0 ? ' <a href="#/online" class="muted">and ' + num(more) + ' more…</a>' : '') + '</div>' : '<p class="muted">No members online right now.</p>') +
      '<p class="small muted">Total: ' + num(total) + ' member' + (total === 1 ? '' : 's') + ' online (last 15 minutes)</p></div></section>' +
      (staff.length ? '<section class="block"><h3 class="block-head">Staff online</h3><div class="block-body">' + staff.map((u) => '<div class="mini-user">' + avatar(u, 's') + '<div>' + username(u) + '<div class="small muted">' + userTitle(u) + '</div></div></div>').join('') + '</div></section>' : '');
  }

  function widgetLatestPosts(w, n) {
    return '<section class="block"><h3 class="block-head"><a href="#/whats-new">Latest posts</a></h3><div class="block-body">' +
      (w.latest.length ? w.latest.slice(0, n || 6).map((t) => { const lu = U(t.lastPost && t.lastPost.userId); return '<div class="mini-post">' + avatar(lu, 's') + '<div><a href="#/threads/' + t.id + '/post-' + t.lastPost.id + '" class="mini-title">' + nsfwTag(t.nsfw) + prefix(t.prefix) + esc(t.title) + '</a><div class="small muted">Latest: ' + esc(lu ? lu.username : '?') + ' · ' + time(t.lastPost.at) + '</div><div class="small muted">' + esc(t.forumTitle || '') + '</div></div></div>'; }).join('') : '<p class="muted">No posts yet.</p>') + '</div></section>';
  }

  function widgetStats(w) {
    return '<section class="block"><h3 class="block-head">Forum statistics</h3><div class="block-body"><dl class="pairs">' +
      '<div><dt>Threads</dt><dd>' + num(w.stats.threads) + '</dd></div>' +
      '<div><dt>Messages</dt><dd>' + num(w.stats.messages) + '</dd></div>' +
      '<div><dt>Members</dt><dd>' + num(w.stats.members) + '</dd></div>' +
      (w.stats.newest ? '<div><dt>Latest member</dt><dd>' + username(U(w.stats.newest)) + '</dd></div>' : '') + '</dl></div></section>';
  }

  function widgetProfilePosts(w) {
    if (!w.profilePosts.length) return '';
    return '<section class="block"><h3 class="block-head"><a href="#/whats-new/profile-posts">New profile posts</a></h3><div class="block-body">' +
      w.profilePosts.map((pp) => '<div class="mini-post">' + avatar(U(pp.authorId), 's') + '<div><div class="small">' + username(U(pp.authorId)) + (pp.authorId !== pp.profileUserId ? ' › ' + username(U(pp.profileUserId)) : '') + '</div><div class="small">' + esc(snippet(pp.content, 90)) + '</div><div class="small muted">' + time(pp.at) + '</div></div></div>').join('') + '</div></section>';
  }

  // Members online goes last: with many members online it's the longest widget.
  async function defaultSidebar() { const w = await widgets(); return widgetLatestPosts(w) + widgetProfilePosts(w) + widgetStats(w) + widgetOnline(w); }
  async function smallSidebar() { const w = await widgets(); return widgetLatestPosts(w, 5) + widgetOnline(w); }

  /* ---------- forum index ---------- */

  function nodeRow(f, all) {
    const s = f.stats || { threads: 0, messages: 0 };
    const lp = s.lastPost, lu = lp && U(lp.userId);
    const subs = all.filter((c) => c.parentId === f.id).sort((a, b) => a.position - b.position);
    return '<div class="node' + (s.unread ? ' node--unread' : '') + '"><div class="node-icon">' + esc(f.icon) + '</div>' +
      '<div class="node-main"><a class="node-title" href="#/forums/' + f.id + '">' + esc(f.title) + '</a>' + (f.vipOnly ? ' <span class="badge badge--vip" title="Only visible to VIP members">👑 VIP only</span>' : f.membersOnly ? ' <span class="badge" title="Only visible to logged-in members">🔒 Members only</span>' : '') + '<div class="node-desc">' + esc(f.description) + '</div>' +
      (subs.length ? '<div class="node-subs">' + subs.map((c) => '<a href="#/forums/' + c.id + '" class="' + (c.stats && c.stats.unread ? 'unread' : '') + '">' + esc(c.icon) + ' ' + esc(c.title) + '</a>').join('') + '</div>' : '') + '</div>' +
      '<dl class="node-stats"><div><dt>Threads</dt><dd>' + num(s.threads) + '</dd></div><div><dt>Messages</dt><dd>' + num(s.messages) + '</dd></div></dl>' +
      '<div class="node-last">' + (lp ? avatar(lu, 's') + '<div><a href="#/threads/' + lp.threadId + '/post-' + lp.postId + '" class="node-last-title">' + nsfwTag(lp.nsfw) + prefix(lp.prefix) + esc(lp.threadTitle) + '</a><div class="small muted">' + time(lp.at) + ' · ' + username(lu) + '</div></div>' : '<span class="muted">None</span>') + '</div></div>';
  }

  async function home() {
    const [d, sidebar] = await Promise.all([api.get('/forums'), defaultSidebar()]);
    const u = me();
    let html = '<div class="page-head"><h1>PinkPill</h1><p class="muted">The looksmaxxing forum for women — skincare, hair, makeup, fitness, style &amp; confidence.</p>' +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="mark-all-read">Mark forums read</button> ' : '') + '<a class="btn btn-primary" href="#/post-thread">Post thread…</a></div></div>';
    if (!u) html += '<div class="notice notice--welcome"><b>Welcome to PinkPill! 💗</b> Join to post, react, follow members and send messages. <a class="btn btn-primary btn-sm" href="#/register">Register</a> <a class="btn btn-sm" href="#/login">Log in</a></div>';
    if (u && u.mustVerifyEmail) html += verifyNotice();
    d.categories.forEach((c) => {
      const forums = d.forums.filter((f) => f.categoryId === c.id && !f.parentId).sort((a, b) => a.position - b.position);
      if (!forums.length) return;
      html += '<section class="block node-cat"><h2 class="block-head block-head--cat" data-collapse>' + esc(c.title) + '</h2><div class="block-body">' + forums.map((f) => nodeRow(f, d.forums)).join('') + '</div></section>';
    });
    return { title: 'Forums', html, sidebar };
  }

  function verifyNotice() {
    return '<div class="notice">📧 <b>Please verify your email address.</b> We sent a link to ' + esc(me().email) + '. You can browse, but posting is disabled until you verify. <button class="btn btn-sm" data-act="resend-verification">Resend email</button></div>';
  }

  /* ---------- thread list ---------- */

  function threadRow(t, opts) {
    opts = opts || {};
    const au = U(t.authorId), lu = t.lastPost && U(t.lastPost.userId);
    let pageLinks = '';
    if (t.pages > 1) pageLinks = '<span class="thread-pages">' + [...new Set([1, 2, 3, t.pages - 1, t.pages].filter((n) => n > 0 && n <= t.pages))].map((n) => '<a href="#/threads/' + t.id + (n > 1 ? '/page-' + n : '') + '">' + n + '</a>').join(' ') + '</span>';
    return '<div class="thread-row' + (t.unread ? ' thread-row--unread' : '') + (t.sticky ? ' thread-row--sticky' : '') + '">' +
      '<div class="thread-avatar">' + avatar(au, 'm') + '</div>' +
      '<div class="thread-main"><div class="thread-title">' + nsfwTag(t.nsfw) + prefix(t.prefix) + '<a href="#/threads/' + t.id + (t.unread ? '?unread=1' : '') + '">' + esc(t.title) + '</a></div>' +
      '<div class="thread-meta small muted">' + (opts.forum && t.forumTitle ? '<a href="#/forums/' + t.forumId + '">' + esc(t.forumTitle) + '</a> · ' : '') + username(au) + ' · ' + time(t.createdAt) + ' ' + pageLinks +
      '<span class="thread-icons">' + (t.sticky ? '<span title="Sticky">📌</span>' : '') + (t.locked ? '<span title="Locked">🔒</span>' : '') + (t.hasPoll ? '<span title="Poll">📊</span>' : '') + (t.ratingEnabled ? '<span title="Rating thread">⭐</span>' : '') + (t.watched ? '<span title="Watched">👁</span>' : '') + '</span></div></div>' +
      '<dl class="thread-stats"><div><dt>Replies</dt><dd>' + num(t.replyCount) + '</dd></div><div><dt>Views</dt><dd>' + num(t.viewCount) + '</dd></div></dl>' +
      '<div class="thread-last">' + (t.lastPost ? '<div class="small"><a href="#/threads/' + t.id + '/post-' + t.lastPost.id + '">' + time(t.lastPost.at) + '</a></div><div class="small">' + username(lu) + '</div>' : '') + '</div>' +
      '<div class="thread-last-avatar">' + (lu ? avatar(lu, 's') : '') + '</div></div>';
  }

  const crumbs = (d) => [['#/', d.category ? d.category.title : 'Forums']].concat(d.path.map((x) => ['#/forums/' + x.id, x.title]));

  async function forum([id, page], q) {
    const params = { page: page || 1, prefix: q.get('prefix'), order: q.get('order'), dir: q.get('dir'), starter: q.get('starter'), unread: q.get('unread') };
    const [d, sidebar] = await Promise.all([api.get('/forums/' + encodeURIComponent(id), params), smallSidebar()]);
    const f = d.forum, u = me();
    const pfx = q.get('prefix') || '', order = q.get('order') || 'last', dir = q.get('dir') || 'desc', starter = q.get('starter') || '';
    const qs = q.toString() ? '?' + q.toString() : '';
    let html = breadcrumb(crumbs(d)) +
      '<div class="page-head"><h1>' + esc(f.icon) + ' ' + esc(f.title) + '</h1><p class="muted">' + esc(f.description) + '</p>' +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="mark-forum-read" data-id="' + f.id + '">Mark read</button> ' : '') +
      (d.canPost ? '<a class="btn btn-primary" href="#/post-thread/' + f.id + '">Post thread</a>' : (f.curated && u ? '<span class="muted small">Only the owner and global admins add guides here.</span>' : f.staffOnly ? '<span class="muted small">Only staff can post here.</span>' : (!u ? '<a class="btn btn-primary" href="#/login">Log in to post</a>' : ''))) + '</div></div>';
    if (d.subforums.length) html += '<section class="block node-cat"><h2 class="block-head block-head--cat" data-collapse>Sub-forums</h2><div class="block-body">' + d.subforums.map((s) => nodeRow(s, d.subforums.flatMap((x) => x.children || []))).join('') + '</div></section>';
    if (f.notice) html += '<div class="notice">' + esc(f.notice) + (f.id === 'f-advice' ? ' <a href="#/help/resources">Support resources</a>' : '') + '</div>';
    if (f.vipOnly) html += '<div class="notice notice--vip">👑 <b>VIP Supporters forum.</b> Only members with an active VIP membership (and staff) can see and post here. Thank you for supporting PinkPill!</div>';
    else if (f.membersOnly) html += '<div class="notice">🔒 <b>Private forum.</b> Threads here are only visible to logged-in members. They don\'t appear to guests, in guest searches or in public activity feeds.</div>';
    if (f.ratingEnabled) html += '<div class="notice"><b>Rating rules:</b> feedback is opt-in and must be constructive. Point out strengths and suggest actionable changes.</div>';
    html += '<form class="filter-bar" data-form="thread-filter" data-forum="' + f.id + '">' +
      '<label>Prefix <select name="prefix"><option value="">Any</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (p.id === pfx ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></label>' +
      '<label>Started by <input name="starter" value="' + esc(starter) + '" placeholder="Member" size="10"></label>' +
      '<label>Sort by <select name="order">' + [['last', 'Last message'], ['created', 'First message'], ['title', 'Title'], ['replies', 'Replies'], ['views', 'Views']].map(([v, l]) => '<option value="' + v + '"' + (v === order ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label><select name="dir"><option value="desc"' + (dir === 'desc' ? ' selected' : '') + '>Descending</option><option value="asc"' + (dir === 'asc' ? ' selected' : '') + '>Ascending</option></select></label>' +
      (u ? '<label class="check"><input type="checkbox" name="unread" value="1"' + (q.get('unread') ? ' checked' : '') + '> Unread only</label>' : '') +
      '<button class="btn btn-sm">Filter</button>' + (q.toString() ? ' <a class="btn btn-sm" href="#/forums/' + f.id + '">Clear</a>' : '') + '</form>';
    html += '<section class="block">';
    if (d.sticky.length) html += '<div class="block-sub">Sticky threads</div>' + d.sticky.map((t) => threadRow(t)).join('') + (d.threads.length ? '<div class="block-sub">Normal threads</div>' : '');
    html += d.threads.map((t) => threadRow(t)).join('');
    if (!d.sticky.length && !d.threads.length) html += '<div class="empty">There are no threads' + (q.toString() ? ' matching your filters' : ' here yet') + '.</div>';
    html += '</section>' + pagination(d.total, d.perPage, d.page, '#/forums/' + f.id).replace(/href="([^"]+)"/g, (m, h) => 'href="' + h + qs + '"');
    return { title: f.title, html, sidebar };
  }

  /* ---------- thread ---------- */

  function reactionSummary(target, kind) {
    const list = target.reactions || [];
    if (!list.length) return '';
    const types = [...new Set(list.map((r) => r.reaction))].map(PP.reactionDef).filter(Boolean);
    const u = me();
    const names = list.map((r) => (u && r.userId === u.id ? 'You' : (U(r.userId) || {}).username)).filter(Boolean);
    names.sort((a) => (a === 'You' ? -1 : 0));
    let text = names.slice(0, 3).join(', ');
    if (names.length > 3) text += ' and ' + (names.length - 3) + ' other' + (names.length - 3 > 1 ? 's' : '');
    return '<button class="reactions-bar" data-act="reactors" data-kind="' + kind + '" data-id="' + target.id + '"><span class="reaction-emojis">' + types.map((r) => r.emoji).join('') + '</span> ' + esc(text) + '</button>';
  }

  function reactButton(target, kind, mine, vipReactions) {
    const def = PP.reactionDef(mine);
    const list = vipReactions ? PP.REACTIONS.concat(PP.VIP_REACTIONS) : PP.REACTIONS;
    return '<span class="react-wrap"><button class="action' + (mine ? ' action--active' : '') + '" data-act="react" data-kind="' + kind + '" data-id="' + target.id + '" data-mine="' + (mine || '') + '">' + (def ? def.emoji + ' ' + def.label : '👍 Like') + '</button>' +
      '<span class="react-picker">' + list.map((r) => '<button' + (r.vip ? ' class="react-vip"' : '') + ' data-act="react" data-kind="' + kind + '" data-id="' + target.id + '" data-r="' + r.id + '" data-mine="' + (mine || '') + '" title="' + r.label + (r.vip ? ' (VIP+)' : '') + '">' + r.emoji + '</button>').join('') + '</span></span>';
  }

  function authorPanel(a) {
    if (!a || a.deleted) return '<div class="message-user"><span class="avatar avatar-l" style="background:#999">?</span><div class="message-username">Deleted member</div></div>';
    const s = a.stats;
    return '<div class="message-user">' + avatar(a, 'l') + (a.online ? '<span class="online-badge" title="Online now"></span>' : '') +
      '<div class="message-username">' + username(a) + '</div><div class="message-title">' + userTitle(a) + '</div>' + ui.roleBanner(a) +
      '<dl class="pairs pairs--compact"><div><dt>Joined</dt><dd>' + fullDate(a.joinedAt) + '</dd></div><div><dt>Messages</dt><dd>' + num(s.posts) + '</dd></div><div><dt>Reaction score</dt><dd>' + num(s.reactionScore) + '</dd></div><div><dt>Rep</dt><dd>' + repBadge(s.rep) + '</dd></div><div><dt>Points</dt><dd>' + s.points + '</dd></div>' + (a.location ? '<div><dt>Location</dt><dd>' + esc(a.location) + '</dd></div>' : '') + '</dl></div>';
  }

  function postHtml(p, d) {
    const u = me();
    const a = U(p.authorId);
    if (p.deleted) {
      return '<article class="message message--deleted" id="post-' + p.id + '"><div class="message-deleted">🗑 Post by ' + username(a) + ' deleted by ' + username(U(p.deletedBy)) + (p.deleteReason ? ' — ' + esc(p.deleteReason) : '') + (d.permissions.deleteAny ? ' <button class="action" data-act="undelete-post" data-id="' + p.id + '">Undelete</button>' : '') + '</div></article>';
    }
    if (u && PP.ignoring && PP.ignoring.has(String(p.authorId))) {
      return '<article class="message message--ignored" id="post-' + p.id + '"><div class="message-deleted">You are ignoring content by this member. <button class="action" data-act="show-ignored" data-id="' + p.id + '">Show ignored content</button></div><template>' + postBody(p, d, a) + '</template></article>';
    }
    return '<article class="message" id="post-' + p.id + '">' + postBody(p, d, a) + '</article>';
  }

  function postBody(p, d, a) {
    const u = me(), th = d.thread, perm = d.permissions;
    const own = u && p.authorId === u.id;
    const mq = (PP.multiQuote || []).includes(p.id);
    // The server enforces the edit window; this only hides the button once it has passed.
    const inWindow = !perm.editWindowMinutes || Date.now() - new Date(p.createdAt).getTime() < perm.editWindowMinutes * 60000;
    const canEdit = (own && perm.editOwn && inWindow) || perm.editAny;
    const canDelete = (own && perm.deleteOwn) || perm.deleteAny;
    const showSig = a && a.signature && (!u || u.prefs.showSignatures);
    return authorPanel(a) + '<div class="message-main"><header class="message-attribution"><a href="#/threads/' + th.id + '/post-' + p.id + '" class="muted small">' + time(p.createdAt) + '</a>' +
      '<span class="message-attribution-opposite">' + (p.rep.count ? '<button class="rep-post ' + (p.rep.total < 0 ? 'neg' : '') + '" data-act="rep-list" data-id="' + p.id + '" title="Reputation given for this post">⚖ ' + (p.rep.total > 0 ? '+' : '') + p.rep.total + ' rep</button>' : '') + (p.rating != null ? '<span class="rating-badge">⭐ Rated ' + p.rating + '/10</span>' : '') +
      '<button class="icon-btn" data-act="share" data-id="' + p.id + '" data-thread="' + th.id + '" title="Share">🔗</button>' +
      (u ? '<button class="icon-btn' + (p.bookmarked ? ' on' : '') + '" data-act="bookmark" data-id="' + p.id + '" data-on="' + (p.bookmarked ? 1 : '') + '" title="Bookmark">' + (p.bookmarked ? '🔖' : '📑') + '</button>' : '') +
      '<a href="#/threads/' + th.id + '/post-' + p.id + '" class="muted small">#' + p.position + '</a></span></header>' +
      '<div class="message-content bbwrap">' + bbcode(p.content) + '</div>' +
      (p.editedAt ? '<div class="message-edited small muted">Last edited' + (p.editedBy && p.editedBy !== p.authorId ? ' by a moderator' : '') + ': ' + time(p.editedAt) + (p.editReason ? ' — ' + esc(p.editReason) : '') + ((own || perm.editAny) && p.hasHistory ? ' · <button class="link" data-act="history" data-id="' + p.id + '">History</button>' : '') + '</div>' : '') +
      (showSig ? '<aside class="message-signature bbwrap">' + bbcode(a.signature) + '</aside>' : '') +
      '<footer class="message-footer"><div class="message-actions">' +
      (u && !own && perm.report ? '<button class="action" data-act="report" data-kind="post" data-id="' + p.id + '">Report</button>' : '') +
      (canEdit ? '<button class="action" data-act="edit-post" data-id="' + p.id + '">Edit</button>' : '') +
      (canDelete ? '<button class="action" data-act="delete-post" data-id="' + p.id + '" data-first="' + (p.position === 1 ? 1 : '') + '">Delete</button>' : '') +
      (perm.warn && a && !own && !a.deleted ? '<button class="action" data-act="warn" data-id="' + a.id + '">Warn</button>' : '') +
      '</div><div class="message-actions">' +
      (u && !own && perm.rep ? (p.rep.mine ? '<span class="action action--active" title="You already gave rep for this post">⚖ Repped</span>' : '<button class="action" data-act="rep" data-id="' + p.id + '" title="Give reputation">⚖ Rep</button>') : '') +
      (u && !own && perm.react ? reactButton(p, 'post', p.myReaction, perm.vipReactions) : '') +
      (perm.reply ? '<button class="action" data-act="mq" data-id="' + p.id + '">' + (mq ? '− Quote' : '+ Quote') + '</button><button class="action" data-act="quote" data-id="' + p.id + '">Reply</button>' : '') +
      '</div></footer>' + reactionSummary(p, 'post') + '</div>';
  }

  function pollHtml(poll, th, perm) {
    const total = poll.options.reduce((a, o) => a + o.votes, 0);
    const showResults = poll.voted || poll.closed || !perm.vote || PP.pollResults === poll.id;
    let h = '<section class="block poll"><h3 class="block-head">📊 ' + esc(poll.question) + '</h3><div class="block-body">';
    if (showResults) {
      h += poll.options.map((o) => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return '<div class="poll-result' + (o.mine ? ' mine' : '') + '"><div class="poll-label">' + esc(o.text) + (o.mine ? ' ✓' : '') + '</div><div class="poll-bar"><span style="width:' + pct + '%"></span></div><div class="poll-count">' + o.votes + ' <span class="muted">(' + pct + '%)</span></div></div>';
      }).join('');
      h += '<p class="small muted">Total voters: ' + poll.voters + (poll.multiple ? ' · Multiple votes allowed' : '') + (poll.closesAt ? ' · ' + (poll.closed ? 'Poll closed ' : 'Closes ') + fullDate(poll.closesAt) : '') + '</p>';
      if (perm.vote && !poll.closed) h += poll.voted ? '<button class="btn btn-sm" data-act="poll-change" data-id="' + poll.id + '">Change vote</button>' : '<button class="btn btn-sm" data-act="poll-vote-view" data-id="' + poll.id + '">Vote</button>';
    } else {
      h += '<form data-form="poll-vote" data-id="' + poll.id + '">' + poll.options.map((o) => '<label class="poll-option"><input type="' + (poll.multiple ? 'checkbox' : 'radio') + '" name="opt" value="' + o.id + '"> ' + esc(o.text) + '</label>').join('') +
        '<div class="form-actions"><button class="btn btn-primary btn-sm">Cast vote</button> <button type="button" class="btn btn-sm" data-act="poll-results" data-id="' + poll.id + '">View results</button></div></form>';
    }
    return h + '</div></section>';
  }

  function ratingSummary(dist) {
    const n = dist.reduce((a, b) => a + b, 0);
    if (!n) return '<section class="block rating-summary"><div class="block-body"><b>⭐ Community rating:</b> <span class="muted">No ratings yet. Reply with a rating and constructive feedback.</span></div></section>';
    const avg = dist.reduce((a, c, i) => a + c * (i + 1), 0) / n;
    const max = Math.max(...dist);
    return '<section class="block rating-summary"><div class="block-body"><div class="rating-big">' + avg.toFixed(1) + '<small>/10</small></div><div><b>Community rating</b><div class="muted small">from ' + n + ' rating' + (n > 1 ? 's' : '') + '</div></div>' +
      '<div class="rating-dist">' + dist.map((c, i) => '<div class="rd-col" title="' + (i + 1) + ': ' + c + '"><span style="height:' + (max ? (c / max) * 100 : 0) + '%"></span><em>' + (i + 1) + '</em></div>').join('') + '</div></div></section>';
  }

  async function threadView([id, page, postId], q) {
    const d = await api.get('/threads/' + encodeURIComponent(id), { page: postId ? undefined : page, post: postId, unread: q.get('unread') });
    PP.currentThread = d;
    const th = d.thread, perm = d.permissions, u = me();
    const author = U(th.authorId);
    const tools = (perm.editThread || perm.deleteThread || perm.sticky || perm.lock || perm.move);
    let html = breadcrumb(crumbs(d).concat([['#/threads/' + th.id, th.title]])) +
      '<div class="page-head"><h1>' + nsfwTag(th.nsfw) + prefix(th.prefix) + esc(th.title) + '</h1>' +
      '<div class="thread-info muted small">' + username(author) + ' · ' + time(th.createdAt) + (th.locked ? ' · 🔒 Locked' : '') + (th.sticky ? ' · 📌 Sticky' : '') + (th.deleted ? ' · 🗑 Deleted' : '') + '</div>' +
      (th.tags.length ? '<div class="tags">' + th.tags.map((t) => '<a class="tag" href="#/tags/' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('') + '</div>' : '') +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="watch-thread" data-id="' + th.id + '" data-on="' + (th.watching ? 1 : '') + '">' + (th.watching ? '👁 Unwatch' : '👁 Watch') + '</button> ' : '') +
      (tools ? '<span class="menu-wrap"><button class="btn" data-menu="thread-tools">⚙ Thread tools ▾</button><div class="menu" data-menu-body="thread-tools">' +
        (perm.editThread ? '<button data-act="edit-thread" data-id="' + th.id + '">Edit thread</button>' : '') +
        (perm.sticky ? '<button data-act="toggle-sticky" data-id="' + th.id + '" data-on="' + (th.sticky ? 1 : '') + '">' + (th.sticky ? 'Unstick thread' : 'Stick thread') + '</button>' : '') +
        (perm.lock ? '<button data-act="toggle-lock" data-id="' + th.id + '" data-on="' + (th.locked ? 1 : '') + '">' + (th.locked ? 'Unlock thread' : 'Lock thread') + '</button>' : '') +
        (perm.move ? '<button data-act="move-thread" data-id="' + th.id + '" data-forum="' + th.forumId + '">Move thread</button>' : '') +
        (perm.curate && th.forumId !== 'f-best' ? '<button data-act="best-thread" data-id="' + th.id + '">🏅 Add to Best of the Best</button>' : '') +
        (th.deleted && perm.deleteAny ? '<button data-act="restore-thread" data-id="' + th.id + '">Restore thread</button>' : '') +
        (perm.deleteThread && !th.deleted ? '<button data-act="delete-thread" data-id="' + th.id + '" data-forum="' + th.forumId + '" class="danger">Delete thread</button>' : '') + '</div></span>' : '') +
      '</div></div>';
    if (th.nsfw) html += '<div class="notice notice--nsfw">' + nsfwTag(true) + '<b>Content warning.</b> This thread contains mature or sensitive (non-explicit) content.</div>';
    if (u && u.mustVerifyEmail) html += verifyNotice();
    html += pagination(d.total || th.total, d.perPage, d.page, '#/threads/' + th.id);
    if (d.poll) html += pollHtml(d.poll, th, perm);
    if (d.ratings) html += ratingSummary(d.ratings);
    html += '<div class="messages">' + d.posts.map((p) => postHtml(p, d)).join('') + '</div>';
    html += pagination(th.total, d.perPage, d.page, '#/threads/' + th.id);

    if (!u) html += '<div class="notice">You must <a href="#/login?return=' + encodeURIComponent('#/threads/' + th.id) + '">log in</a> or <a href="#/register">register</a> to reply here.</div>';
    else if (th.locked && !perm.reply) html += '<div class="notice">🔒 This thread is locked. New replies are not allowed.</div>';
    else if (perm.reply) {
      html += '<section class="block quick-reply" id="reply"><div class="quick-reply-inner">' + avatar(u, 'm') + '<form data-form="reply" data-thread="' + th.id + '" data-draft="reply-' + th.id + '" class="grow">' +
        editor('content', '', { rows: 5, placeholder: 'Write your reply…' }) +
        '<div class="form-actions">' +
        (th.ratingEnabled && th.authorId !== u.id ? (perm.rate ? '<label>Rating <select name="rating"><option value="">No rating</option>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => '<option>' + i + '</option>').join('') + '</select></label>' : '<span class="small muted">You\'ve already rated this thread.</span>') : '') +
        '<button class="btn btn-primary">↩ Post reply</button> <button type="button" class="btn" data-act="mq-insert" data-thread="' + th.id + '"' + ((PP.multiQuote || []).length ? '' : ' hidden') + '>Insert quotes (' + (PP.multiQuote || []).length + ')</button>' +
        '<span class="small muted">Ctrl+Enter to post</span></div></form></div></section>';
    }
    const sidebar = '<section class="block"><h3 class="block-head">Thread information</h3><div class="block-body"><dl class="pairs"><div><dt>Started by</dt><dd>' + username(author) + '</dd></div><div><dt>Replies</dt><dd>' + num(th.replyCount) + '</dd></div><div><dt>Views</dt><dd>' + num(th.viewCount) + '</dd></div><div><dt>Watchers</dt><dd>' + th.watchers + '</dd></div><div><dt>Participants</dt><dd>' + th.participants + '</dd></div></dl></div></section>' +
      (d.similar.length ? '<section class="block"><h3 class="block-head">Similar threads</h3><div class="block-body">' + d.similar.map((t) => '<div class="mini-post"><div><a class="mini-title" href="#/threads/' + t.id + '">' + nsfwTag(t.nsfw) + prefix(t.prefix) + esc(t.title) + '</a></div></div>').join('') + '</div></section>' : '') +
      widgetOnline(await widgets());
    const target = d.targetPostId;
    return {
      title: th.title, html, sidebar, keepScroll: !target,
      after: () => {
        if (target) { const el = document.getElementById('post-' + target); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('message--highlight'); } }
      },
    };
  }

  /* ---------- post thread ---------- */

  async function postThread([forumId]) {
    const u = me();
    if (!u) return loginRequired();
    const d = await api.get('/forums');
    const canStaff = u.permissions.includes('forum.post_staff_only');
    const canCurate = u.permissions.includes('forum.curate');
    if (!forumId) {
      const html = '<div class="page-head"><h1>Post thread</h1><p class="muted">Choose a forum to post in:</p></div><section class="block"><div class="block-body">' +
        d.categories.map((c) => {
          const list = [];
          const add = (f, depth) => { if ((!f.staffOnly || canStaff) && (!f.curated || canCurate)) list.push('<a class="btn' + (depth ? ' btn-sub' : '') + '" href="#/post-thread/' + f.id + '">' + (depth ? '↳ ' : '') + esc(f.icon) + ' ' + esc(f.title) + '</a>'); d.forums.filter((x) => x.parentId === f.id).sort((a, b) => a.position - b.position).forEach((ch) => add(ch, depth + 1)); };
          d.forums.filter((f) => f.categoryId === c.id && !f.parentId).sort((a, b) => a.position - b.position).forEach((f) => add(f, 0));
          return list.length ? '<h3>' + esc(c.title) + '</h3><div class="forum-pick">' + list.join('') + '</div>' : '';
        }).join('') + '</div></section>';
      return { title: 'Post thread', html };
    }
    const f = d.forums.find((x) => x.id === forumId);
    if (!f) return notFound('forum');
    if (f.staffOnly && !canStaff) return errorView('Only staff can post in this forum.');
    if (f.curated && !canCurate) return errorView('Only the owner and global admins can add guides to ' + f.title + '.');
    const path = [];
    for (let cur = f; cur; cur = cur.parentId ? d.forums.find((x) => x.id === cur.parentId) : null) path.unshift(['#/forums/' + cur.id, cur.title]);
    const cat = d.categories.find((c) => c.id === f.categoryId);
    const html = breadcrumb([['#/', cat ? cat.title : 'Forums']].concat(path, [['', 'Post thread']])) +
      '<div class="page-head"><h1>Post thread in ' + esc(f.title) + '</h1></div>' +
      (u.mustVerifyEmail ? verifyNotice() : '') +
      (f.membersOnly ? '<div class="notice">🔒 This is a <b>members-only</b> forum: your thread will be hidden from guests.</div>' : '') +
      (f.ratingEnabled ? '<div class="notice">Posting in <b>' + esc(f.title) + '</b>: you\'re opting in to ratings and feedback. Only post photos of yourself. Revealing photos must be of adults (18+) and tagged NSFW. You can delete your thread at any time.</div>' : '') +
      '<form class="block form" data-form="post-thread" data-forum="' + f.id + '" data-draft="thread-' + f.id + '"><div class="block-body">' +
      '<div class="row"><select name="prefix" class="prefix-select"><option value="">(No prefix)</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (f.ratingEnabled && p.id === 'rateme' ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select>' +
      '<input name="title" class="grow input-title" placeholder="Thread title" maxlength="150" required></div>' +
      editor('content', '', { rows: 12, required: true }) +
      '<label class="field"><span>Tags</span><input name="tags" placeholder="Separate with commas, e.g. skincare, acne"></label>' +
      (can('poll.create') ? '<details class="poll-builder"><summary>📊 Add a poll</summary><div class="field-group">' +
      '<label class="field"><span>Question</span><input name="poll_q" maxlength="200"></label>' +
      '<div data-poll-options>' + [1, 2, 3].map((i) => '<input name="poll_opt" placeholder="Option ' + i + '" class="poll-opt" maxlength="100">').join('') + '</div>' +
      '<button type="button" class="btn btn-sm" data-act="poll-add-option">+ Add option</button>' +
      '<label class="check"><input type="checkbox" name="poll_multi"> Allow selecting multiple options</label>' +
      '<label class="field"><span>Close poll after (days, blank = never)</span><input name="poll_days" type="number" min="1" max="365"></label></div></details>' : '') +
      (!f.ratingEnabled ? '<label class="check"><input type="checkbox" name="rating_enabled"> ⭐ Enable community ratings on this thread (opt-in)</label>' : '') +
      '<div class="nsfw-choice"><label class="check"><input type="checkbox" name="nsfw"> ' + nsfwTag(true) + '<b>This thread contains NSFW content</b> (required if it does)</label>' +
      '<p class="small muted">Mature or sensitive but <b>non-explicit</b> content: revealing photos (swimwear, lingerie), graphic before/after photos, strong language or mature discussions. Pornography and sexually explicit material are not allowed, tagged or not. Untagged NSFW posts can be reported and tagged by moderators.</p></div>' +
      '<label class="check"><input type="checkbox" name="watch"' + (u.prefs.autoWatch ? ' checked' : '') + '> Watch this thread and receive alerts for replies</label>' +
      '<div class="form-actions"><button class="btn btn-primary">✚ Post thread</button> <a class="btn" href="#/forums/' + f.id + '">Cancel</a></div></div></form>';
    return { title: 'Post thread', html };
  }

  /* ---------- members ---------- */

  function memberList(ids, statFn, statLabel) {
    const users = ids.map(U).filter(Boolean);
    if (!users.length) return '<div class="empty">Nobody here yet.</div>';
    return '<div class="member-list">' + users.map((m) => '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '<div class="small muted">' + userTitle(m) + (m.location ? ' · ' + esc(m.location) : '') + '</div></div>' + (statFn ? '<div class="member-stat"><b>' + num(statFn(m)) + '</b><div class="small muted">' + statLabel + '</div></div>' : '') + '</div>').join('') + '</div>';
  }

  const memberTabs = (tab) => '<nav class="tabs">' + [['notable', 'Notable members'], ['list', 'Registered members'], ['staff', 'Staff members'], ['online', 'Current visitors']].map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="' + (k === 'online' ? '#/online' : '#/members/' + k) + '">' + l + '</a>').join('') + '</nav>';

  async function members([tab], q) {
    tab = tab || 'notable';
    if (tab === 'online') return online();
    const [d, w] = await Promise.all([api.get('/members', { tab, sort: q.get('sort'), page: q.get('page') }), widgets()]);
    let body = '';
    const st = (k) => (u) => u.stats[k];
    if (tab === 'notable') {
      body = '<div class="grid-2">' +
        '<section class="block"><h3 class="block-head">Most messages</h3><div class="block-body">' + memberList(d.mostMessages, st('posts'), 'Messages') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Highest reaction score</h3><div class="block-body">' + memberList(d.mostReactions, st('reactionScore'), 'Reactions') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Highest reputation</h3><div class="block-body">' + memberList(d.mostRep, st('rep'), 'Rep') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Most points</h3><div class="block-body">' + memberList(d.mostPoints, st('points'), 'Points') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Newest members</h3><div class="block-body">' + memberList(d.newest) + '</div></section>' +
        '</div>' + (d.birthdays.length ? '<section class="block"><h3 class="block-head">🎂 Today\'s birthdays</h3><div class="block-body">' + memberList(d.birthdays) + '</div></section>' : '');
    } else if (tab === 'list') {
      const sort = q.get('sort') || 'joined';
      body = '<div class="filter-bar">Sort by: ' + [['joined', 'Newest'], ['messages', 'Messages'], ['reactions', 'Reactions'], ['rep', 'Reputation'], ['name', 'Name']].map(([k, l]) => '<a class="btn btn-sm' + (k === sort ? ' btn-primary' : '') + '" href="#/members/list?sort=' + k + '">' + l + '</a>').join(' ') + '</div>' +
        '<section class="block"><div class="block-body">' + memberList(d.list, st('posts'), 'Messages') + '</div></section>' +
        pagination(d.total, d.perPage, d.page, '#/members/list').replace(/\/page-(\d+)/g, '?sort=' + sort + '&page=$1');
    } else if (tab === 'staff') {
      body = '<section class="block"><h3 class="block-head">Administrators</h3><div class="block-body">' + memberList(d.admins) + '</div></section>' +
        '<section class="block"><h3 class="block-head">Moderators</h3><div class="block-body">' + memberList(d.moderators) + '</div></section>';
    }
    const html = '<div class="page-head"><h1>Members</h1><form class="find-member" data-form="find-member"><input name="name" placeholder="Find member…" list="member-names" autocomplete="off" data-lookup><datalist id="member-names"></datalist><button class="btn btn-sm">Go</button></form></div>' + memberTabs(tab) + body;
    return { title: 'Members', html, sidebar: widgetOnline(w) + widgetStats(w) };
  }

  async function online() {
    const [d, w] = await Promise.all([api.get('/online'), widgets()]);
    const html = '<div class="page-head"><h1>Current visitors</h1><p class="muted">Members active in the last hour.</p></div>' + memberTabs('online') +
      '<section class="block"><div class="block-body">' + (d.online.length ? '<div class="member-list">' + d.online.map((o) => { const m = U(o.userId); const a = o.activity; const act = typeof a === 'string' ? esc(a) : esc(a.text) + ' <a href="#/threads/' + a.threadId + '">' + esc(a.title) + '</a>'; return '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '<div class="small muted">' + act + ' · ' + time(o.at) + '</div></div></div>'; }).join('') + '</div>' : '<div class="empty">Nobody has been active in the last hour.</div>') + '</div></section>';
    return { title: 'Current visitors', html, sidebar: widgetStats(w) };
  }

  /* ---------- member profile ---------- */

  function activityItem(i) {
    const a = U(i.authorId);
    if (i.kind === 'profile_post') {
      return '<div class="activity-item">' + avatar(a, 's') + '<div class="grow"><div>' + username(a) + (i.profileUserId === i.authorId ? ' updated their status.' : ' wrote on ' + username(U(i.profileUserId)) + '\'s profile.') + '</div><div class="activity-snippet">' + esc(snippet(i.content, 220)) + '</div><div class="small muted">' + time(i.at) + '</div></div></div>';
    }
    return '<div class="activity-item">' + avatar(a, 's') + '<div class="grow"><div>' + username(a) + (i.kind === 'thread' ? ' started the thread ' : ' replied to the thread ') + '<a href="#/threads/' + i.threadId + '/post-' + (i.id || i.postId) + '">' + nsfwTag(i.nsfw) + prefix(i.prefix) + esc(i.threadTitle) + '</a>.</div><div class="activity-snippet">' + esc(snippet(i.content, 220)) + '</div><div class="small muted">' + time(i.at) + (i.forumTitle ? ' · ' + esc(i.forumTitle) : '') + '</div></div></div>';
  }

  function profilePostHtml(pp) {
    const u = me(), a = U(pp.authorId);
    if (PP.ignoring && PP.ignoring.has(String(pp.authorId))) return '<div class="profile-post muted small">Ignored content.</div>';
    const mine = u && (pp.reactions || []).find((r) => r.userId === u.id);
    (PP.ppCache = PP.ppCache || {})[pp.id] = pp.reactions || [];
    return '<div class="profile-post" id="pp-' + pp.id + '">' + avatar(a, 'm') + '<div class="grow"><div>' + username(a) + (pp.authorId !== pp.profileUserId ? ' › ' + username(U(pp.profileUserId)) : '') + '</div>' +
      '<div class="bbwrap">' + bbcode(pp.content) + '</div>' +
      '<div class="pp-footer small muted">' + time(pp.at) + ' ' + (u && u.id !== pp.authorId && can('post.react') ? reactButton(pp, 'profile', mine && mine.reaction) : '') +
      (u && can('profile_post.create') ? '<button class="action" data-act="pp-comment-toggle" data-id="' + pp.id + '">Comment</button>' : '') +
      (u && u.id !== pp.authorId && can('report.create') ? '<button class="action" data-act="report" data-kind="profile_post" data-id="' + pp.id + '">Report</button>' : '') +
      (pp.canDelete ? '<button class="action" data-act="pp-delete" data-id="' + pp.id + '">Delete</button>' : '') + '</div>' + reactionSummary(pp, 'profile') +
      '<div class="pp-comments">' + pp.comments.map((c) => '<div class="pp-comment">' + avatar(U(c.authorId), 's') + '<div>' + username(U(c.authorId)) + ' <span class="bbwrap">' + bbcode(c.content) + '</span><div class="small muted">' + time(c.at) + '</div></div></div>').join('') +
      (u ? '<form class="pp-comment-form" data-form="pp-comment" data-id="' + pp.id + '" hidden><input name="content" placeholder="Write a comment…" required class="grow" maxlength="1000"><button class="btn btn-sm">Post</button></form>' : '') + '</div></div></div>';
  }

  async function member([id, tab]) {
    if (id && id[0] === '@') {
      const r = await api.get('/members/by-name/' + encodeURIComponent(id.slice(1)));
      location.replace('#/members/' + r.id + (tab ? '/' + tab : ''));
      return { title: 'Loading', html: '' };
    }
    tab = tab || 'profile-posts';
    const d = await api.get('/members/' + encodeURIComponent(id));
    const m = d.user, perm = d.permissions, s = m.stats;
    const banner = d.profile.bannerUrl && PP.safeUrl(d.profile.bannerUrl) ? ' style="--banner:url(' + esc(d.profile.bannerUrl) + ')"' : '';
    let head = '<section class="block profile-head"' + banner + '><div class="profile-banner"></div><div class="profile-head-body">' + avatar(m, 'xl') +
      '<div class="grow"><h1><span class="' + ui.vipName(m).cls + '"' + (ui.vipName(m).style ? ' style="' + ui.vipName(m).style + '"' : '') + '>' + esc(m.username) + '</span>' + ui.verifiedBadge(m) + (m.banned ? ' <span class="badge badge--red">Banned</span>' : '') + '</h1><div class="muted">' + userTitle(m) + '</div>' + ui.roleBanner(m) +
      (m.vip ? '<div class="vip-chip">👑 ' + esc(m.vip.label) + (m.vip.lifetime ? ' · Lifetime' : '') + '</div>' : '') +
      (d.profile.vanity ? '<div class="small muted">🔗 <a href="#/u/' + encodeURIComponent(d.profile.vanity) + '">' + esc(location.origin) + '/u/' + esc(d.profile.vanity) + '</a></div>' : '') +
      '<div class="small muted">' + (m.location ? '📍 ' + esc(m.location) + ' · ' : '') + 'Joined ' + fullDate(m.joinedAt) + (m.online ? ' · <span class="online-dot"></span> Online now' : m.lastSeenAt ? ' · Last seen ' + timeAgo(m.lastSeenAt) : '') + '</div>' +
      '<dl class="pairs pairs--row"><div><dt>Messages</dt><dd>' + num(s.posts) + '</dd></div><div><dt>Reaction score</dt><dd>' + num(s.reactionScore) + '</dd></div><div><dt>Reputation</dt><dd><a href="#/members/' + m.id + '/reputation">' + repBadge(s.rep) + '</a> <span class="small muted">' + store.repLevel(s.rep).label + '</span></dd></div><div><dt>Points</dt><dd><a href="#/members/' + m.id + '/trophies">' + s.points + '</a></dd></div><div><dt>Followers</dt><dd><a href="#/members/' + m.id + '/followers">' + s.followers + '</a></dd></div></dl>' +
      (d.ban ? '<div class="notice notice--error small">Banned: ' + esc(d.ban.reason) + (d.ban.expiresAt ? ' (until ' + esc(fullDate(d.ban.expiresAt)) + ')' : '') + '</div>' : '') + '</div>' +
      '<div class="profile-actions">' +
      (perm.isMe ? '<a class="btn" href="#/account/personal">Edit profile</a>' : '') +
      (perm.follow ? '<button class="btn btn-primary" data-act="follow" data-id="' + m.id + '" data-on="' + (d.relation.following ? 1 : '') + '">' + (d.relation.following ? 'Unfollow' : 'Follow') + '</button>' : '') +
      (perm.message ? '<a class="btn" href="#/conversations/new?to=' + encodeURIComponent(m.username) + '">✉ Start conversation</a>' : '') +
      (!perm.isMe && me() ? '<span class="menu-wrap"><button class="btn" data-menu="profile-more">⋯</button><div class="menu" data-menu-body="profile-more">' +
        (perm.ignore ? '<button data-act="ignore" data-id="' + m.id + '" data-on="' + (d.relation.ignoring ? 1 : '') + '">' + (d.relation.ignoring ? 'Unignore' : 'Ignore') + '</button>' : '') +
        (perm.report ? '<button data-act="report" data-kind="user" data-id="' + m.id + '">Report</button>' : '') +
        '<a href="#/search?m=' + encodeURIComponent(m.username) + '">Find content</a>' +
        (perm.warn ? '<button data-act="warn" data-id="' + m.id + '">Warn</button>' : '') +
        (perm.ban ? '<button data-act="ban" data-id="' + m.id + '" data-on="' + (m.banned ? 1 : '') + '" class="danger">' + (m.banned ? 'Lift ban' : 'Ban / suspend') + '</button>' : '') +
        (perm.setRole ? '<button data-act="set-role" data-id="' + m.id + '" data-role="' + m.role + '">Change user group</button>' : '') +
        (me() && me().permissions.includes('admin.users') ? '<a href="#/mod/accounts?user=' + m.id + '">🕵 IPs, devices &amp; alts</a>' : '') +
        '</div></span>' : '') +
      '</div></div></section>';
    const tabs = [['profile-posts', 'Profile posts'], ['activity', 'Latest activity'], ['postings', 'Postings'], ['about', 'About'], ['reputation', 'Reputation'], ['trophies', 'Trophies'], ['followers', 'Followers'], ['following', 'Following']];
    if (perm.viewWarnings) tabs.push(['warnings', 'Warnings']);
    head += '<nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/members/' + m.id + '/' + k + '">' + l + '</a>').join('') + '</nav>';
    let body = '';
    if (tab === 'profile-posts') {
      const r = await api.get('/members/' + m.id + '/profile-posts');
      body = (perm.profilePost ? '<form class="block form pp-new" data-form="pp-new" data-id="' + m.id + '"><div class="block-body">' + avatar(me(), 'm') + '<textarea name="content" rows="2" maxlength="2000" placeholder="' + (perm.isMe ? 'Update your status…' : 'Write something…') + '" required class="grow"></textarea><button class="btn btn-primary">Post</button></div></form>' : '') +
        '<section class="block"><div class="block-body">' + (r.profilePosts.length ? r.profilePosts.map(profilePostHtml).join('') : '<div class="empty">There are no messages on ' + esc(m.username) + '\'s profile yet.</div>') + '</div></section>';
    } else if (tab === 'activity' || tab === 'postings') {
      const r = await api.get('/members/' + m.id + '/' + tab);
      body = '<section class="block"><div class="block-body">' + (r.items.length ? r.items.map(activityItem).join('') : '<div class="empty">No activity yet.</div>') + '</div></section>' +
        (tab === 'postings' ? '<p><a class="btn" href="#/search?m=' + encodeURIComponent(m.username) + '">Find all content by ' + esc(m.username) + '</a> <a class="btn" href="#/search?m=' + encodeURIComponent(m.username) + '&t=thread">Find all threads by ' + esc(m.username) + '</a></p>' : '');
    } else if (tab === 'about') {
      const [fo, fi] = await Promise.all([api.get('/members/' + m.id + '/following'), api.get('/members/' + m.id + '/followers')]);
      const bd = d.profile.birthday;
      body = '<section class="block"><div class="block-body">' + (d.profile.bio ? '<div class="bbwrap">' + bbcode(d.profile.bio) + '</div>' : '<p class="muted">No bio yet.</p>') +
        '<dl class="pairs">' + (bd ? '<div><dt>Birthday</dt><dd>' + esc(new Date(2000, bd.month - 1, bd.day).toLocaleDateString([], { month: 'long', day: 'numeric' })) + '</dd></div>' : '') +
        (d.profile.website && /^https?:\/\//i.test(d.profile.website) ? '<div><dt>Website</dt><dd><a href="' + esc(d.profile.website) + '" target="_blank" rel="noopener nofollow ugc">' + esc(d.profile.website) + '</a></dd></div>' : '') +
        (m.location ? '<div><dt>Location</dt><dd>' + esc(m.location) + '</dd></div>' : '') + '<div><dt>Threads started</dt><dd>' + d.counts.threads + '</dd></div><div><dt>Rank</dt><dd>' + esc(m.rank) + '</dd></div></dl>' +
        (m.signature ? '<h4>Signature</h4><div class="bbwrap">' + bbcode(m.signature) + '</div>' : '') +
        '<h4>Following</h4><div class="avatar-row">' + (fo.ids.length ? fo.ids.map((x) => avatar(U(x), 's')).join('') : '<span class="muted">Nobody yet</span>') + '</div>' +
        '<h4>Followers</h4><div class="avatar-row">' + (fi.ids.length ? fi.ids.map((x) => avatar(U(x), 's')).join('') : '<span class="muted">Nobody yet</span>') + '</div></div></section>';
    } else if (tab === 'reputation') {
      const r = await api.get('/members/' + m.id + '/reputation');
      body = '<section class="block"><div class="block-body"><div class="rep-summary">' + repBadge(r.totals.total) + '<div><b>' + store.repLevel(r.totals.total).label + '</b><div class="small muted">' + r.totals.pos + ' positive · ' + r.totals.neg + ' negative · rep power ' + r.totals.power + '</div></div></div>' +
        (r.reputation.length ? r.reputation.map((x) => '<div class="activity-item">' + avatar(U(x.giverId), 's') + '<div class="grow"><div>' + username(U(x.giverId)) + ' gave <span class="rep ' + (x.value < 0 ? 'rep--neg' : 'rep--3') + '">' + (x.value > 0 ? '+' : '') + x.value + '</span>' + (x.threadId ? ' for <a href="#/threads/' + x.threadId + '/post-' + x.postId + '">' + nsfwTag(x.nsfw) + esc(x.threadTitle) + '</a>' : '') + '</div>' + (x.comment ? '<div class="activity-snippet">“' + esc(x.comment) + '”</div>' : '') + '<div class="small muted">' + time(x.at) + '</div></div>' + (x.canRemove ? '<button class="btn btn-sm" data-act="rep-remove" data-id="' + x.id + '">Remove</button>' : '') + '</div>').join('') : '<div class="empty">' + esc(m.username) + ' hasn\'t received any reputation yet.</div>') + '</div></section>';
    } else if (tab === 'trophies') {
      body = '<section class="block"><div class="block-body">' + (d.trophies.length ? d.trophies.map((t) => '<div class="trophy"><div class="trophy-points">' + t.points + '</div><div><b>' + esc(t.title) + '</b><div class="small muted">' + esc(t.desc) + ' · ' + time(t.awardedAt) + '</div></div></div>').join('') : '<div class="empty">No trophies yet.</div>') + '</div></section>';
    } else if (tab === 'followers' || tab === 'following') {
      const r = await api.get('/members/' + m.id + '/' + tab);
      body = '<section class="block"><div class="block-body">' + memberList(r.ids) + '</div></section>';
    } else if (tab === 'warnings' && perm.viewWarnings) {
      const r = await api.get('/members/' + m.id + '/warnings');
      body = '<section class="block"><div class="block-body">' + (r.warnings.length ? r.warnings.map((w) => '<div class="activity-item"><div><b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">by ' + username(U(w.issuedBy)) + ' · ' + time(w.at) + '</div></div></div>').join('') : '<div class="empty">No warnings.</div>') + '</div></section>';
    }
    return { title: m.username, html: head + body };
  }

  /* ---------- auth pages ---------- */

  function login(_, q) {
    const ret = q.get('return') || '#/';
    const html = '<div class="auth-wrap">' + (/^#\/(vip|account\/(vip|purchases))/.test(ret) ? '<div class="notice notice--vip">👑 Please log in to view VIP memberships.</div>' : '') + '<form class="block form" data-form="login" data-return="' + esc(ret) + '"><h2 class="block-head">Log in</h2><div class="block-body">' +
      '<label class="field"><span>Your name or email address</span><input name="login" autocomplete="username" required maxlength="254"></label>' +
      '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>' +
      '<label class="check"><input type="checkbox" name="stay" checked> Stay logged in</label>' +
      (PP.session.turnstile && PP.session.turnstile.onLogin ? '<div data-turnstile></div>' : '') +
      '<div class="form-actions"><button class="btn btn-primary">Log in</button> <a href="#/lost-password" class="small">Forgot your password?</a></div>' +
      '<p class="small">Don\'t have an account? <a href="#/register">Register now</a></p></div></form></div>';
    return { title: 'Log in', html };
  }

  function register() {
    const html = '<div class="auth-wrap"><form class="block form" data-form="register"><h2 class="block-head">Register</h2><div class="block-body">' +
      '<label class="field"><span>User name</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]+" autocomplete="username"><small class="muted">This is the name that will be shown with your messages. 3-24 characters.</small></label>' +
      '<label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" maxlength="254"></label>' +
      '<label class="field"><span>Password</span><input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>' +
      '<label class="field"><span>Date of birth</span><input name="birthday" type="date" required></label>' +
      '<label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>' +
      (PP.session.turnstile && PP.session.turnstile.siteKey ? '<div data-turnstile></div>' : '') +
      '<label class="check"><input type="checkbox" name="agree" required> I agree to the <a href="#/help/terms">terms</a>, <a href="#/help/rules">rules</a> and <a href="#/help/privacy">privacy policy</a>.</label>' +
      '<div class="form-actions"><button class="btn btn-primary">Register</button></div>' +
      '<p class="small muted">You must be 13 or older to join. We\'ll email you a link to verify your address.</p></div></form></div>';
    return { title: 'Register', html };
  }

  function lostPassword() {
    return { title: 'Lost password', html: '<div class="auth-wrap"><form class="block form" data-form="reset-request"><h2 class="block-head">Lost password</h2><div class="block-body"><p>Enter your email address and we\'ll send you a link to reset your password.</p>' +
      '<label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' + (PP.session.turnstile && PP.session.turnstile.siteKey ? '<div data-turnstile></div>' : '') + '<div class="form-actions"><button class="btn btn-primary">Send reset link</button></div></div></form></div>' };
  }

  function resetPassword(_, q) {
    return { title: 'Reset password', html: '<div class="auth-wrap"><form class="block form" data-form="reset-confirm" data-token="' + esc(q.get('token') || '') + '"><h2 class="block-head">Choose a new password</h2><div class="block-body">' +
      '<label class="field"><span>New password</span><input name="password" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>' +
      '<label class="field"><span>Confirm new password</span><input name="confirm" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>' +
      '<div class="form-actions"><button class="btn btn-primary">Save password</button></div></div></form></div>' };
  }

  async function verifyEmail(_, q) {
    try {
      await api.post('/auth/verify-email', { token: q.get('token') || '' });
      await api.loadSession();
      return { title: 'Email verified', html: '<div class="auth-wrap"><section class="block"><h2 class="block-head">Email verified 💗</h2><div class="block-body"><p>Thanks! Your account is active and you can start posting.</p><a class="btn btn-primary" href="#/forums/f-intro">Introduce yourself</a></div></section></div>' };
    } catch (e) {
      return { title: 'Verification failed', html: '<div class="auth-wrap"><section class="block"><h2 class="block-head">Verification failed</h2><div class="block-body"><p>' + esc(e.message) + '</p>' + (me() ? '<button class="btn" data-act="resend-verification">Send a new link</button>' : '<a class="btn" href="#/login">Log in to request a new link</a>') + '</div></section></div>' };
    }
  }

  function claimAdmin() {
    if (!me()) return loginRequired('Register or log in first, then come back to this page.');
    return { title: 'Claim admin', html: '<div class="auth-wrap"><form class="block form" data-form="claim-admin"><h2 class="block-head">Claim administrator</h2><div class="block-body">' +
      '<p class="small muted">Only works once, while the site has no super administrator. Enter the <code>ADMIN_CLAIM_TOKEN</code> you set on your server.</p>' +
      '<label class="field"><span>Claim token</span><input name="token" type="password" required autocomplete="off"></label>' +
      '<div class="form-actions"><button class="btn btn-primary">Make me super administrator</button></div></div></form></div>' };
  }

  /* ---------- account ---------- */

  async function account([tab]) {
    const u = me();
    if (!u) return loginRequired();
    tab = tab || 'details';
    const tabs = [['details', 'Account details'], ['personal', 'Personal details'], ['security', 'Password & security'], ['privacy', 'Privacy'], ['preferences', 'Preferences'], ['signature', 'Signature'], ['following', 'Following'], ['ignoring', 'Ignoring'], ['bookmarks', 'Bookmarks'], ['watched', 'Watched threads'], ['warnings', 'Warnings'], ['vip', '👑 VIP membership'], ['purchases', 'Purchases'], ['data', 'Your data']].concat(u.role === 'super_admin' ? [['owner-style', '✨ Owner style']] : []);
    let body = '';
    if (tab === 'details') {
      body = '<form class="block form" data-form="account-details"><div class="block-body"><dl class="pairs"><div><dt>User name</dt><dd>' + esc(u.username) + '</dd></div><div><dt>Joined</dt><dd>' + fullDate(u.joinedAt) + '</dd></div><div><dt>User group</dt><dd>' + esc(PP.ROLE_TITLES[u.role] || u.role) + '</dd></div><div><dt>Email status</dt><dd>' + (u.emailVerified ? 'Verified ✓' : 'Not verified <button type="button" class="btn btn-sm" data-act="resend-verification">Resend link</button>') + '</dd></div></dl>' +
        '<label class="field"><span>Email</span><input name="email" type="email" value="' + esc(u.email) + '" required maxlength="254"></label>' +
        '<label class="field"><span>Current password (required to change email)</span><input name="password" type="password" required autocomplete="current-password"></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'personal') {
      body = '<form class="block form" data-form="account-personal"><div class="block-body">' +
        '<div class="avatar-editor">' + avatar(u, 'xl') + '<div><label class="btn">Upload avatar<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" name="avatar_file" hidden></label> ' + (u.avatarUrl ? '<button type="button" class="btn" data-act="remove-avatar">Remove</button>' : '') +
        '<label class="field"><span>Letter avatar colour</span><input type="color" name="color" value="' + ui.safeColor(u.color) + '"></label></div></div>' +
        '<div class="field"><span>Profile banner</span><label class="btn btn-sm">Upload banner<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" name="banner_file" hidden></label>' + (u.bannerUrl ? ' <button type="button" class="btn btn-sm" data-act="remove-banner">Remove banner</button>' : '') + '</div>' +
        '<label class="field"><span>Custom title</span><input name="customTitle" maxlength="50" value="' + esc(u.customTitle) + '" placeholder="' + esc(u.rank) + '"></label>' +
        '<label class="field"><span>Location</span><input name="location" maxlength="50" value="' + esc(u.location) + '"></label>' +
        '<label class="field"><span>Website</span><input name="website" type="url" maxlength="200" value="' + esc(u.website) + '" placeholder="https://"></label>' +
        '<label class="field"><span>Date of birth</span><input name="birthday" type="date" value="' + esc(u.birthday) + '"></label>' +
        '<label class="field"><span>About you</span>' + editor('bio', u.bio, { rows: 5 }) + '</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'signature') {
      body = '<form class="block form" data-form="account-signature"><div class="block-body">' + editor('signature', u.signature, { rows: 4 }) + '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'security') {
      const s = await api.get('/account/sessions');
      body = '<form class="block form" data-form="account-password"><h3 class="block-head">Change password</h3><div class="block-body">' +
        '<label class="field"><span>Current password</span><input name="current" type="password" required autocomplete="current-password"></label>' +
        '<label class="field"><span>New password</span><input name="new" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>' +
        '<label class="field"><span>Confirm new password</span><input name="confirm" type="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>' +
        '<p class="small muted">Changing your password logs out all your other devices.</p><div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>' +
        '<section class="block"><h3 class="block-head">Active sessions</h3><div class="block-body">' + s.sessions.map((x) => '<div class="activity-item"><div class="grow"><b>' + esc((x.userAgent || 'Unknown device').slice(0, 90)) + '</b>' + (x.current ? ' <span class="badge">This device</span>' : '') + '<div class="small muted">' + esc(x.ip || '') + ' · last active ' + time(x.lastUsedAt) + '</div></div></div>').join('') +
        (s.sessions.length > 1 ? '<div class="form-actions"><button class="btn" data-act="revoke-sessions">Log out all other devices</button></div>' : '') + '</div></section>';
    } else if (tab === 'privacy') {
      const opt = (name, val) => '<select name="' + name + '">' + [['everyone', 'All members'], ['followed', 'People you follow'], ['none', 'Nobody']].map(([v, l]) => '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
      body = '<form class="block form" data-form="account-privacy"><div class="block-body">' +
        '<label class="check"><input type="checkbox" name="showOnline"' + (u.prefs.showOnline ? ' checked' : '') + '> Show your online status</label>' +
        '<label class="field"><span>Who can start conversations with you</span>' + opt('allowDms', u.prefs.allowDms) + '</label>' +
        '<label class="field"><span>Who can post on your profile</span>' + opt('allowProfilePosts', u.prefs.allowProfilePosts) + '</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'owner-style' && u.role === 'super_admin') {
      const cur = u.special || {};
      const NAMES = { rainbow: 'Rainbow', galaxy: 'Galaxy', inferno: 'Inferno', frost: 'Frost', royal: 'Royal gold', toxic: 'Toxic', sakura: 'Sakura', midnight: 'Midnight' };
      const FX = { flow: 'Flowing colours', pulse: 'Pulsing glow', sparkle: 'Sparkle', neon: 'Neon' };
      const sample = (c, fx) => '<span class="username username--special sp--' + c + (fx ? ' spfx--' + fx : '') + '">' + esc(u.username) + '</span>';
      body = '<form class="block form" data-form="owner-style"><h3 class="block-head">✨ Owner style</h3><div class="block-body">' +
        '<p class="small muted">Special username colours and effects only the owner can use. They replace any VIP colour.</p>' +
        '<div class="field"><span>Colour</span><div class="owner-swatches">' +
        '<label class="vip-choice"><input type="radio" name="color" value=""' + (!cur.color ? ' checked' : '') + '> None</label>' +
        ui.SPECIAL_COLORS.map((c) => '<label class="vip-choice"><input type="radio" name="color" value="' + c + '"' + (cur.color === c ? ' checked' : '') + '> ' + sample(c, 'flow') + ' <span class="small muted">' + NAMES[c] + '</span></label>').join('') + '</div></div>' +
        '<label class="field"><span>Effect</span><select name="effect"><option value="">None</option>' + ui.SPECIAL_EFFECTS.map((x) => '<option value="' + x + '"' + (cur.effect === x ? ' selected' : '') + '>' + FX[x] + '</option>').join('') + '</select></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save style</button> <span class="small muted">Now: ' + ui.username(u) + '</span></div></div></form>';
    } else if (tab === 'preferences') {
      body = '<form class="block form" data-form="account-prefs"><div class="block-body">' +
        '<label class="field"><span>Style</span><select name="theme">' + [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => '<option value="' + v + '"' + (v === u.prefs.theme ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
        '<label class="check"><input type="checkbox" name="showSignatures"' + (u.prefs.showSignatures ? ' checked' : '') + '> Show people\'s signatures with their messages</label>' +
        '<label class="check"><input type="checkbox" name="autoWatch"' + (u.prefs.autoWatch ? ' checked' : '') + '> Automatically watch threads you create or reply to</label>' +
        '<label class="check"><input type="checkbox" name="desktopAlerts"' + (localPref('desktopAlerts') ? ' checked' : '') + '> Show browser notifications for new alerts (this device)</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'following' || tab === 'ignoring') {
      const r = await api.get('/account/' + tab);
      const list = r.ids.map(U).filter(Boolean);
      body = '<section class="block"><div class="block-body">' + (list.length ? '<div class="member-list">' + list.map((m) => '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '</div><button class="btn btn-sm" data-act="' + (tab === 'following' ? 'follow' : 'ignore') + '" data-id="' + m.id + '" data-on="1">' + (tab === 'following' ? 'Unfollow' : 'Unignore') + '</button></div>').join('') + '</div>' : '<div class="empty">You\'re not ' + tab + ' anyone.</div>') + '</div></section>';
    } else if (tab === 'bookmarks') {
      const r = await api.get('/account/bookmarks');
      body = '<section class="block"><div class="block-body">' + (r.bookmarks.length ? r.bookmarks.map((b) => '<div class="activity-item">' + avatar(U(b.authorId), 's') + '<div class="grow"><a href="#/threads/' + b.threadId + '/post-' + b.postId + '">' + nsfwTag(b.nsfw) + esc(b.threadTitle) + '</a><div class="activity-snippet">' + esc(snippet(b.content, 200)) + '</div><div class="small muted">' + username(U(b.authorId)) + ' · ' + time(b.at) + '</div></div><button class="btn btn-sm" data-act="bookmark" data-id="' + b.postId + '" data-on="1">Remove</button></div>').join('') : '<div class="empty">You haven\'t bookmarked anything yet. Use 📑 on any post.</div>') + '</div></section>';
    } else if (tab === 'watched') {
      const r = await api.get('/account/watched');
      body = '<section class="block">' + (r.threads.length ? r.threads.map((t) => '<div class="watched-row">' + threadRow(t) + '<button class="btn btn-sm" data-act="watch-thread" data-id="' + t.id + '" data-on="1">Unwatch</button></div>').join('') : '<div class="empty">You aren\'t watching any threads.</div>') + '</section>';
    } else if (tab === 'warnings') {
      const r = await api.get('/account/warnings');
      body = '<section class="block"><div class="block-body">' + (r.warnings.length ? r.warnings.map((w) => '<div class="activity-item"><div><b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">' + time(w.at) + '</div></div></div>').join('') : '<div class="empty">You have no warnings. 💗</div>') + '</div></section>';
    } else if (tab === 'vip') {
      body = await PP.vipViews.accountVip();
    } else if (tab === 'purchases') {
      body = await PP.vipViews.accountPurchases();
    } else if (tab === 'data') {
      body = '<section class="block"><div class="block-body"><p>Download a copy of the content you\'ve posted.</p><a class="btn" href="/api/account/export" download>Download my data</a>' +
        '<hr><p>Deleting your account removes your profile, email and password. Your posts remain and are shown as “Deleted member”.</p><button class="btn btn-danger" data-act="delete-account">Delete my account</button></div></section>';
    }
    const html = '<div class="page-head"><h1>Your account</h1></div>' + (u.mustVerifyEmail ? verifyNotice() : '') + '<div class="account-layout"><nav class="side-nav">' + tabs.map(([k, l]) => '<a class="' + (k === tab ? 'active' : '') + '" href="#/account/' + k + '">' + l + '</a>').join('') + '<a href="#/alerts">Alerts</a><a href="#/conversations">Conversations</a><a href="#/members/' + u.id + '">Your profile</a><button data-act="logout" class="link">Log out</button></nav><div class="grow">' + body + '</div></div>';
    return { title: 'Your account', html };
  }

  function localPref(k) { try { return localStorage.getItem('pinkpill.pref.' + k) === '1'; } catch (e) { return false; } }

  /* ---------- alerts ---------- */

  function alertIcon(t) { return { reply: '💬', mention: '@', quote: '❝', reaction: '💖', follow: '➕', 'follow-thread': '🧵', trophy: '🏆', conversation: '✉', 'profile-post': '📝', 'profile-comment': '💭', report: '🚩', 'report-resolved': '✅', warning: '⚠', welcome: '🌸', rep: '⚖', moderation: '🛡', vip: '👑', account: '🕵' }[t] || '🔔'; }

  function alertRow(a) {
    const from = a.actorId && U(a.actorId);
    const link = /^#\//.test(a.link || '') ? a.link : '#/alerts';
    return '<a class="alert-row' + (a.read ? '' : ' unread') + '" href="' + esc(link) + '">' + (from && !from.deleted ? avatar(from, 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') : '<span class="avatar avatar-s alert-icon">' + alertIcon(a.type) + '</span>') + '<span class="grow"><span>' + esc(a.text) + '</span><span class="small muted block">' + esc(timeAgo(a.at)) + '</span></span></a>';
  }

  async function alerts() {
    if (!me()) return loginRequired();
    const d = await api.get('/notifications');
    const html = '<div class="page-head"><h1>Alerts</h1><div class="head-actions"><button class="btn" data-act="alerts-read-all">Mark all read</button> <a class="btn" href="#/account/preferences">Preferences</a></div></div><section class="block"><div class="block-body alerts-list">' + (d.notifications.length ? d.notifications.map(alertRow).join('') : '<div class="empty">You have no alerts.</div>') + '</div></section>';
    return { title: 'Alerts', html, after: () => { if (d.notifications.some((n) => !n.read)) setTimeout(() => api.post('/notifications/read-all').then(() => PP.refreshCounts && PP.refreshCounts()).catch(() => {}), 1500); } };
  }

  /* ---------- conversations ---------- */

  async function conversations(_, q) {
    if (!me()) return loginRequired();
    const filter = q.get('filter') || '';
    const d = await api.get('/conversations', { filter });
    const html = '<div class="page-head"><h1>Conversations</h1><div class="head-actions">' + (can('conversation.start') ? '<a class="btn btn-primary" href="#/conversations/new">✚ Start conversation</a>' : '') + '</div></div>' +
      '<nav class="tabs">' + [['', 'All'], ['unread', 'Unread'], ['starred', 'Starred'], ['started', 'Started by you']].map(([k, l]) => '<a class="tab' + (k === filter ? ' active' : '') + '" href="#/conversations' + (k ? '?filter=' + k : '') + '">' + l + '</a>').join('') + '</nav>' +
      '<section class="block">' + (d.conversations.length ? d.conversations.map((c) => {
        const others = c.participants.filter((x) => x !== me().id).map(U).filter(Boolean);
        return '<div class="thread-row' + (c.unread ? ' thread-row--unread' : '') + '"><div class="thread-avatar">' + avatar(U(c.starterId), 'm') + '</div><div class="thread-main"><div class="thread-title">' + (c.starred ? '⭐ ' : '') + '<a href="#/conversations/' + c.id + '">' + esc(c.title) + '</a></div><div class="small muted">' + others.map((o) => username(o)).join(', ') + '</div></div><dl class="thread-stats"><div><dt>Replies</dt><dd>' + c.replies + '</dd></div><div><dt>Participants</dt><dd>' + c.participants.length + '</dd></div></dl><div class="thread-last">' + (c.last ? '<div class="small">' + time(c.last.at) + '</div><div class="small">' + username(U(c.last.authorId)) + '</div>' : '') + '</div></div>';
      }).join('') : '<div class="empty">You have no conversations' + (filter ? ' matching this filter' : '') + '.</div>') + '</section>';
    return { title: 'Conversations', html };
  }

  function conversationNew(_, q) {
    if (!me()) return loginRequired();
    const html = breadcrumb([['#/conversations', 'Conversations'], ['', 'Start conversation']]) + '<div class="page-head"><h1>Start conversation</h1></div>' +
      '<form class="block form" data-form="conv-new" data-draft="conv-new"><div class="block-body">' +
      '<label class="field"><span>Recipients</span><input name="to" value="' + esc(q.get('to') || '') + '" placeholder="Separate names with a comma" list="member-names-dm" required autocomplete="off" data-lookup><datalist id="member-names-dm"></datalist></label>' +
      '<label class="field"><span>Title</span><input name="title" maxlength="100" required></label>' + editor('content', '', { rows: 8, required: true }) +
      '<label class="check"><input type="checkbox" name="allowInvite"> Allow anyone in the conversation to invite others</label>' +
      '<div class="form-actions"><button class="btn btn-primary">Start conversation</button></div></div></form>';
    return { title: 'Start conversation', html };
  }

  async function conversation([id], q) {
    if (!me()) return loginRequired();
    const d = await api.get('/conversations/' + encodeURIComponent(id), { page: q.get('page') });
    PP.currentConversation = d;
    const c = d.conversation;
    const html = breadcrumb([['#/conversations', 'Conversations'], ['', c.title]]) +
      '<div class="page-head"><h1>' + esc(c.title) + '</h1><div class="small muted">Started by ' + username(U(c.starterId)) + ' · ' + time(c.createdAt) + '</div>' +
      '<div class="head-actions"><button class="btn" data-act="conv-star" data-id="' + c.id + '" data-on="' + (c.starred ? 1 : '') + '">' + (c.starred ? '★ Unstar' : '☆ Star') + '</button> ' +
      (c.canInvite ? '<button class="btn" data-act="conv-invite" data-id="' + c.id + '">Invite members</button> ' : '') +
      '<button class="btn" data-act="conv-leave" data-id="' + c.id + '">Leave conversation</button></div></div>' +
      pagination(d.pages * 50, 50, d.page, '#/conversations/' + c.id).replace(/\/page-(\d+)/g, '?page=$1') +
      '<div class="messages">' + d.messages.map((m) => '<article class="message" id="msg-' + m.id + '">' + authorPanel(U(m.authorId)) + '<div class="message-main"><header class="message-attribution"><span class="muted small">' + time(m.at) + '</span><span class="message-attribution-opposite small muted">#' + m.position + '</span></header><div class="message-content bbwrap">' + bbcode(m.content) + '</div><footer class="message-footer"><div class="message-actions">' + (m.authorId !== me().id ? '<button class="action" data-act="report" data-kind="message" data-id="' + m.id + '">Report</button>' : '') + '</div><div class="message-actions"><button class="action" data-act="conv-quote" data-id="' + m.id + '">Reply</button></div></footer></div></article>').join('') + '</div>' +
      (can('conversation.start') ? '<section class="block quick-reply"><div class="quick-reply-inner">' + avatar(me(), 'm') + '<form class="grow" data-form="conv-reply" data-id="' + c.id + '" data-draft="conv-' + c.id + '">' + editor('content', '', { rows: 4 }) + '<div class="form-actions"><button class="btn btn-primary">↩ Reply</button></div></form></div></section>' : '');
    const sidebar = '<section class="block"><h3 class="block-head">Participants</h3><div class="block-body">' + d.participants.map((p) => { const u = U(p.userId); return '<div class="mini-user">' + avatar(u, 's') + '<div>' + username(u) + (p.left ? ' <span class="small muted">(left)</span>' : '') + '<div class="small muted">' + userTitle(u) + '</div></div></div>'; }).join('') + '</div></section>';
    return { title: c.title, html, sidebar, after: () => { if (!q.get('page')) window.scrollTo(0, document.body.scrollHeight); if (PP.refreshCounts) PP.refreshCounts(); } };
  }

  /* ---------- search, tags, what's new ---------- */

  function resultRow(r) {
    if (r.kind === 'member') { const m = U(r.userId); return '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '<div class="small muted">' + userTitle(m) + '</div></div></div>'; }
    if (r.kind === 'profile_post') {
      return '<div class="activity-item">' + avatar(U(r.authorId), 's') + '<div class="grow"><a href="#/members/' + r.profileUserId + '">Profile post by ' + esc((U(r.authorId) || {}).username || '?') + '</a><div class="activity-snippet">' + esc(snippet(r.content, 240)) + '</div><div class="small muted">Profile post · ' + time(r.at) + '</div></div></div>';
    }
    return '<div class="activity-item">' + avatar(U(r.authorId), 's') + '<div class="grow"><a href="#/threads/' + r.threadId + '/post-' + r.postId + '">' + nsfwTag(r.nsfw) + prefix(r.prefix) + esc(r.threadTitle) + '</a><div class="activity-snippet">' + esc(snippet(r.content, 240)) + '</div><div class="small muted">' + username(U(r.authorId)) + ' · ' + (r.kind === 'thread' ? 'Thread' : 'Post') + ' · ' + time(r.at) + ' · Forum: <a href="#/forums/' + r.forumId + '">' + esc(r.forumTitle) + '</a></div></div></div>';
  }

  async function search(_, q) {
    const kw = q.get('q') || '', t = q.get('t') || '', m = q.get('m') || '', f = q.get('f') || '', titles = q.get('titles') === '1', o = q.get('o') || 'date';
    const searched = kw || m;
    const [res, forums] = await Promise.all([searched ? api.get('/search', { q: kw, t, m, f, titles: titles ? 1 : '', o }) : Promise.resolve({ results: [] }), api.get('/forums')]);
    const html = '<div class="page-head"><h1>' + (searched ? 'Search results' + (kw ? ' for query: ' + esc(kw) : '') + (m ? ' by member: ' + esc(m) : '') : 'Search') + '</h1></div>' +
      '<form class="block form search-form" data-form="search"><div class="block-body">' +
      '<label class="field"><span>Keywords</span><input name="q" value="' + esc(kw) + '" maxlength="200" autofocus></label>' +
      '<label class="check"><input type="checkbox" name="titles" value="1"' + (titles ? ' checked' : '') + '> Search titles only</label>' +
      '<div class="row wrap"><label class="field"><span>Posted by member</span><input name="m" value="' + esc(m) + '" list="member-names-s" data-lookup maxlength="24"><datalist id="member-names-s"></datalist></label>' +
      '<label class="field"><span>Search in</span><select name="t">' + [['', 'Everything'], ['thread', 'Threads'], ['post', 'Posts'], ['profile_post', 'Profile posts'], ['member', 'Members']].map(([v, l]) => '<option value="' + v + '"' + (v === t ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Forum</span><select name="f"><option value="">All forums</option>' + forums.forums.map((x) => '<option value="' + x.id + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Order by</span><select name="o"><option value="date"' + (o === 'date' ? ' selected' : '') + '>Date</option><option value="relevance"' + (o === 'relevance' ? ' selected' : '') + '>Relevance</option></select></label></div>' +
      '<div class="form-actions"><button class="btn btn-primary">🔍 Search</button></div></div></form>' +
      (searched ? '<section class="block"><h3 class="block-head">' + res.results.length + ' result' + (res.results.length === 1 ? '' : 's') + '</h3><div class="block-body">' + (res.results.length ? res.results.map(resultRow).join('') : '<div class="empty">No results found.</div>') + '</div></section>' : '');
    return { title: 'Search', html };
  }

  async function tag([t]) {
    const d = await api.get('/tags/' + encodeURIComponent(decodeURIComponent(t)));
    const html = '<div class="page-head"><h1>Tag: ' + esc(d.tag) + '</h1></div><section class="block">' + (d.threads.length ? d.threads.map((x) => threadRow(x)).join('') : '<div class="empty">No content with this tag.</div>') + '</section>';
    const sidebar = '<section class="block"><h3 class="block-head">Popular tags</h3><div class="block-body tags">' + d.popular.map((p) => '<a class="tag" href="#/tags/' + encodeURIComponent(p.tag) + '">' + esc(p.tag) + ' <small>' + p.n + '</small></a>').join('') + '</div></section>';
    return { title: 'Tag: ' + d.tag, html, sidebar };
  }

  async function whatsNew([tab], q) {
    tab = tab || 'posts';
    const u = me();
    const tabs = [['posts', 'New posts'], ['profile-posts', 'New profile posts'], ['activity', 'Latest activity']];
    if (u) tabs.push(['feed', 'Your news feed']);
    let body = '';
    if (tab === 'posts') {
      const unread = q.get('unread') && u, watched = q.get('watched') && u;
      const d = await api.get('/whats-new/posts', { unread: unread ? 1 : '', watched: watched ? 1 : '' });
      body = (u ? '<div class="filter-bar">Show only: <a class="btn btn-sm' + (unread ? ' btn-primary' : '') + '" href="#/whats-new/posts' + (unread ? '' : '?unread=1') + '">Unread</a> <a class="btn btn-sm' + (watched ? ' btn-primary' : '') + '" href="#/whats-new/posts' + (watched ? '' : '?watched=1') + '">Watched</a> <button class="btn btn-sm" data-act="mark-all-read">Mark all read</button></div>' : '') +
        '<section class="block">' + (d.threads.length ? d.threads.map((t) => threadRow(t, { forum: true })).join('') : '<div class="empty">No results found.</div>') + '</section>';
    } else if (tab === 'profile-posts') {
      const d = await api.get('/whats-new/profile-posts');
      body = '<section class="block"><div class="block-body">' + (d.profilePosts.length ? d.profilePosts.map(profilePostHtml).join('') : '<div class="empty">No profile posts yet.</div>') + '</div></section>';
    } else {
      const d = await api.get(tab === 'feed' ? '/whats-new/feed' : '/whats-new/activity');
      body = '<section class="block"><div class="block-body">' + (d.items.length ? d.items.map(activityItem).join('') : '<div class="empty">' + (tab === 'feed' ? 'Your news feed is empty. Follow members to see their activity here.' : 'No activity yet.') + '</div>') + '</div></section>';
    }
    const w = await widgets();
    const html = '<div class="page-head"><h1>What\'s new</h1></div><nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/whats-new/' + k + '">' + l + '</a>').join('') + '</nav>' + body;
    return { title: 'What\'s new', html, sidebar: widgetOnline(w) + widgetStats(w) };
  }

  /* ---------- help ---------- */

  let trophyCache = null;
  async function help([page]) {
    page = page || 'index';
    const pages = [['rules', 'Forum rules'], ['faq', 'FAQ'], ['bbcode', 'BB codes'], ['reactions', 'Reactions'], ['reputation', 'Reputation'], ['trophies', 'Trophies & ranks'], ['name-colours', 'Name colours'], ['smilies', 'Smilies'], ['terms', 'Terms and rules'], ['privacy', 'Privacy policy'], ['cookies', 'Cookie usage'], ['resources', 'Support resources']];
    if (page === 'trophies' && !trophyCache) trophyCache = await api.get('/trophies');
    const bbExamples = ['[b]Bold[/b]', '[i]Italic[/i]', '[u]Underline[/u]', '[s]Strike[/s]', '[color=#ec4899]Pink text[/color]', '[size=5]Big text[/size]', '[url=https://example.com]Link[/url]', '[media]https://youtu.be/dQw4w9WgXcQ[/media]', '[quote=Aurora]Quoted text[/quote]', '[spoiler]Hidden text[/spoiler]', '[code]code block[/code]', '[list]\n[*]One\n[*]Two\n[/list]', '[center]Centered[/center]', '@Aurora (mention)'];
    const map = {
      index: '<div class="help-grid">' + pages.map(([k, l]) => '<a class="block help-card" href="#/help/' + k + '"><b>' + l + '</b></a>').join('') + '</div>',
      rules: '<ol class="rules">' +
        '<li><b>Keep low-effort posts in Off-Topic.</b><ul><li>Short, throwaway posts belong in the Off-Topic section only.</li><li>They\'re never okay in threads marked “Serious.”</li></ul></li>' +
        '<li><b>Don\'t revive dead threads.</b><ul><li>Leave threads older than a month alone unless you\'re adding something real.</li><li>Bumping, one-word replies, quotes or “this” don\'t count.</li></ul></li>' +
        '<li><b>Nothing illegal.</b><ul><li>Don\'t post illegal content or encourage anyone to break the law.</li><li>When in doubt, leave it out.</li></ul></li>' +
        '<li><b>Tag NSFW content.</b><ul><li>Threads with mature or sensitive must carry the NSFW tag.</li><li>Moderators tag untagged NSFW threads; repeatedly skipping the tag can lead to a ban.</li></ul></li>' +
        '<li><b>One account per person, and it\'s yours alone.</b><ul><li>Duplicate or shared accounts get every linked account banned.</li></ul></li>' +
        '<li><b>Don\'t post for banned members.</b></li>' +
        '<li><b>No gore or shock content.</b></li>' +
        '<li><b>No scat content.</b></li>' +
        '<li><b>No repfarming.</b><ul><li>Don\'t game the reputation system to boost yourself or others.</li></ul></li>' +
        '<li><b>Don\'t be here just to troll.</b><ul><li>Over-the-top personas are fine, but accounts that mainly exist to provoke, start fights or damage the forum will be removed permanently.</li></ul></li>' +
        '<li><b>Keep private things private.</b><ul><li>Don\'t share private messages, personal information or private images.</li></ul></li>' +
        '<li><b>Don\'t share private surgery results without clear consent</b><ul><li>This is a permanent ban, even if it was an accident.</li></ul></li>' +
        '<li><b>No doxxing or threats to dox.</b><ul><li>This covers everyone, including people outside the forum.</li></ul></li>' +
        '<li><b>Don\'t mass-tag members.</b></li>' +
        '<li><b>No spam.</b><ul><li>Don\'t flood the forum with repetitive posts.</li></ul></li>' +
        '<li><b>Write in your own words.</b><ul><li>AI-generated posts aren\'t banned, but they\'re discouraged. People come here to hear from real members.</li></ul></li>' +
        '<li><b>No bots or automation.</b><ul><li>Don\'t use scripts or bots to post or to move reputation.</li></ul></li>' +
        '<li><b>Don\'t impersonate other members.</b><ul><li>That includes using someone\'s current or past username.</li></ul></li>' +
        '<li><b>Don\'t spread misinformation.</b></li>' +
        '<li><b>No promoting or advertising without contacting an admin first.</b></li></ol>',
      faq: '<dl class="faq"><dt>What is PinkPill?</dt><dd>A looksmaxxing (appearance-improvement) community for women focused on evidence-based, safe and kind self-improvement.</dd>' +
        '<dt>How do alerts work?</dt><dd>You receive alerts when someone replies to a thread you watch, mentions you with @name, quotes you, reacts to your content, gives you reputation, follows you, writes on your profile, or starts a conversation with you.</dd>' +
        '<dt>How do I get a rating?</dt><dd>Post in <a href="#/forums/f-rating">Rating</a> (or its members-only Private Ratings sub-forum), or tick "Enable community ratings" when creating a thread. Each member can rate once (1–10) alongside constructive feedback.</dd>' +
        '<dt>What is rep?</dt><dd>Reputation is a trust score members give each other for helpful (or harmful) posts. See <a href="#/help/reputation">Reputation</a>.</dd>' +
        '<dt>What is the Private Ratings forum?</dt><dd>A sub-forum of Rating that only logged-in members can see. Guests can\'t view, search or find its threads.</dd>' +
        '<dt>Where can I ask for advice about my life or dating?</dt><dd>Post in <a href="#/forums/f-advice">Situations &amp; Dating Advice</a>. Never post other people\'s personal details.</dd>' +
        '<dt>Why can\'t I post yet?</dt><dd>New accounts must verify their email address first. Check your inbox (and spam folder) for the link, or resend it from Account details.</dd>' +
        '<dt>How do I ignore someone?</dt><dd>Open their profile → ⋯ → Ignore. Their posts are hidden and they can\'t message you or post on your profile.</dd>' +
        '<dt>What does the NSFW tag mean?</dt><dd>It\'s a content warning for mature or sensitive, explicit content: revealing photos, graphic before/after photos, strong language or mature discussions, and other things. It shows on every list, search result and feed where the thread appears.</dd>' +
        '<dt>What is VIP?</dt><dd>An optional paid membership that supports PinkPill and unlocks perks such as VIP username colors, the VIP Supporters forum and larger conversations. See <a href="#/vip">VIP</a> (log in first). Monthly packages are one-time payments for one month and don\'t renew automatically.</dd>' +
        '<dt>Can I delete my account?</dt><dd>Yes: Account → Your data.</dd></dl>',
      bbcode: '<table class="table"><thead><tr><th>You type</th><th>You get</th></tr></thead><tbody>' + bbExamples.map((e) => '<tr><td><code>' + esc(e).replace(/\n/g, '<br>') + '</code></td><td class="bbwrap">' + bbcode(e) + '</td></tr>').join('') + '<tr><td><code>[img]https://…[/img]</code></td><td>An image (or use 📎 in the editor to upload one)</td></tr></tbody></table>',
      reactions: '<table class="table"><tbody>' + PP.REACTIONS.map((r) => '<tr><td style="font-size:1.6em">' + r.emoji + '</td><td><b>' + r.label + '</b></td><td class="muted">' + (r.score > 0 ? 'Adds +' + r.score + ' to reaction score' : 'Neutral') + '</td></tr>').join('') + '</tbody></table>',
      reputation: '<p><b>Reputation (rep)</b> shows how much the community trusts a member. Click <b>⚖ Rep</b> under any post to give a member positive or negative rep for it.</p><ul>' +
        '<li>You can rep each post once, and give up to <b>' + store.REP_DAILY_LIMIT + '</b> reps every 24 hours.</li>' +
        '<li><b>Rep power</b> — how much your rep is worth — starts at 1 and grows by 1 for every 100 messages you post (max 5). Moderators get +1 and admins +2. It\'s calculated by the server.</li>' +
        '<li>Negative rep needs at least <b>' + store.NEG_REP_MIN_POSTS + '</b> messages and a comment explaining why. Use it for rule-breaking or harmful advice, not disagreements.</li>' +
        '<li>You can take back rep you gave from the member\'s Reputation tab. Staff can remove abusive rep.</li></ul>' +
        '<h3>Rep levels</h3><table class="table"><tbody>' + [[-1, 'Negative'], [0, 'Neutral'], [5, 'Well liked'], [30, 'Respected'], [100, 'Highly respected'], [250, 'Legendary']].map(([n, l]) => '<tr><td>' + repBadge(n) + '</td><td><b>' + l + '</b></td><td class="muted">' + (n < 0 ? 'below 0' : n + '+') + '</td></tr>').join('') + '</tbody></table>',
      trophies: trophyCache ? '<h3>Trophies</h3>' + trophyCache.trophies.map((t) => '<div class="trophy"><div class="trophy-points">' + t.points + '</div><div><b>' + esc(t.title) + '</b><div class="small muted">' + esc(t.desc) + '</div></div></div>').join('') +
        '<h3>Ranks</h3><table class="table"><tbody>' + trophyCache.ranks.map((r) => '<tr><td><b>' + esc(r.title) + '</b></td><td>' + r.min + '+ messages</td></tr>').join('') + '</tbody></table>' : '',
      'name-colours': '<p>Your username changes colour as you post: a <b>new colour every 250 messages</b>, and a <b>glowing pink gradient at 10,000 messages</b>. Each colour also needs <b>3 days of membership</b>, so colours can\'t be rushed by spamming. Staff colours, VIP colours and the owner\'s style take priority.</p>' +
        (me() ? '<p>You have <b>' + num(me().stats.posts) + '</b> messages' + (me().nameTier < 40 ? ' — next colour at <b>' + num((me().nameTier + 1) * 250) + '</b> (if you\'ve been a member long enough).' : '. You\'ve reached the top colour!') + '</p>' : '') +
        '<table class="table tier-table"><tbody>' + Array.from({ length: 40 }, (_, i) => i + 1).map((t) => '<tr><td>' + num(t * 250) + '+ messages</td><td>' + (t * 3) + '+ days</td><td>' + (t >= 40 ? '<span class="username username--tier-max">Glowing pink</span>' : '<span class="username username--tier" style="--th:' + ui.tierHue(t) + '">Colour ' + t + '</span>') + '</td></tr>').join('') + '</tbody></table>',
      smilies: '<p>Use the 😊 button in the editor or type any emoji directly.</p><div class="smilies">' + '😀 😂 🥹 😊 😍 🥰 😘 😎 🤔 😮 😢 😭 😤 🙄 😴 🤗 🫶 💖 💕 💗 ✨ 🌸 🌷 💅 💄 💋 👑 💎 🔥 💯 👏 🙏 💪'.split(' ').map((e) => '<span>' + e + '</span>').join('') + '</div>',
      terms: '<p>By using PinkPill you agree to follow the <a href="#/help/rules">forum rules</a>. Content you post is your own responsibility. Staff may edit, move or remove content and suspend accounts that break the rules. Advice shared here is peer opinion, not medical advice — consult licensed professionals.</p>',
      privacy: '<p>PinkPill stores your account (username, email, a salted Argon2id password hash, profile details and preferences) and the content you post in its database. Your email address and date of birth are never shown publicly (only the month and day of your birthday are). Private conversations are visible only to their participants. Uploaded images are re-encoded and stripped of metadata such as GPS location.</p><p><b>Preventing alt accounts:</b> when you register and each time you log in, we record your IP address, your browser and device type, a random device ID stored in a cookie on your browser and, where our network provider supplies it, your country. Only administrators can see this. It is used to detect duplicate accounts and ban evasion, and is deleted after one year.</p><p>You can download your data or delete your account at any time from Account → Your data.</p>',
      cookies: '<p>PinkPill sets two essential cookies: <code>pp_session</code> keeps you logged in, and <code>pp_device</code> is a random device ID used to detect duplicate accounts (see the privacy policy). Both are HttpOnly (not readable by scripts). There are no tracking or advertising cookies. Your theme, drafts and a few display preferences are kept in your browser\'s local storage.</p>',
      resources: '<ul class="resources"><li><b>Emergency:</b> call your local emergency number</li><li><b>US:</b> 988 Suicide &amp; Crisis Lifeline — call or text 988</li><li><b>UK &amp; ROI:</b> Samaritans — 116 123</li><li><b>Eating disorders:</b> NEDA (US) · Beat (UK) 0808 801 0677 · Butterfly (AU) 1800 33 4673</li><li><b>Body dysmorphic disorder:</b> BDD Foundation — bddfoundation.org</li><li><b>Worldwide:</b> <a href="https://findahelpline.com" target="_blank" rel="noopener">findahelpline.com</a></li></ul>',
    };
    const body = map[page] || map.index;
    const title = page === 'index' ? 'Help' : (pages.find((p) => p[0] === page) || [0, 'Help'])[1];
    const html = breadcrumb([['#/help', 'Help'], ['', title]]) + '<div class="page-head"><h1>' + esc(title) + '</h1></div><div class="account-layout"><nav class="side-nav">' + pages.map(([k, l]) => '<a class="' + (k === page ? 'active' : '') + '" href="#/help/' + k + '">' + l + '</a>').join('') + '</nav><section class="block grow"><div class="block-body help-body">' + body + '</div></section></div>';
    return { title, html };
  }

  /* ---------- moderator / admin panel ---------- */

  async function mod([tab], q) {
    const u = me();
    if (!u) return loginRequired();
    const P = (p) => u.permissions.includes(p);
    if (!P('mod.view_reports') && !P('admin.users')) return errorView('You do not have permission to view this page.');
    const tabs = [];
    if (P('mod.view_reports')) tabs.push(['reports', 'Report queue']);
    if (P('mod.ban')) tabs.push(['members', 'Members'], ['banned', 'Banned members']);
    if (P('mod.warn')) tabs.push(['warnings', 'Warnings']);
    if (P('mod.view_log')) tabs.push(['log', 'Moderation log']);
    if (P('admin.stats')) tabs.push(['stats', 'Dashboard']);
    if (P('admin.forums')) tabs.push(['forums', 'Forums']);
    if (P('admin.users')) tabs.push(['accounts', '🕵 New accounts & alts'], ['roles', 'Roles & permissions']);
    if (P('admin.settings')) tabs.push(['settings', 'Settings']);
    if (P('admin.vip')) tabs.push(['vip', '👑 VIP']);
    if (P('admin.import')) tabs.push(['data', 'Data']);
    tab = tab || tabs[0][0];
    if (!tabs.some((t) => t[0] === tab)) return errorView('You do not have permission to view this page.');
    let body = '';
    if (tab === 'reports') {
      const status = q.get('status') || 'open';
      const d = await api.get('/mod/reports', { status });
      body = '<div class="filter-bar">' + ['open', 'resolved', 'rejected'].map((s) => '<a class="btn btn-sm' + (s === status ? ' btn-primary' : '') + '" href="#/mod/reports?status=' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</a>').join(' ') + '</div><section class="block"><div class="block-body">' + (d.reports.length ? d.reports.map((r) => {
        const t = r.target;
        let target = '<span class="muted">Content no longer exists</span>';
        if (t && r.type === 'post') target = 'Post by ' + username(U(t.authorId)) + ' in <a href="#/threads/' + t.threadId + '/post-' + r.contentId + '">' + nsfwTag(t.nsfw) + esc(t.threadTitle) + '</a>' + (t.deleted ? ' <span class="badge">deleted</span>' : '') + '<div class="activity-snippet">' + esc(snippet(t.content, 300)) + '</div>';
        else if (t && r.type === 'profile_post') target = 'Profile post by ' + username(U(t.authorId)) + ' on <a href="#/members/' + t.profileUserId + '">their profile</a><div class="activity-snippet">' + esc(snippet(t.content, 300)) + '</div>';
        else if (t && r.type === 'message') target = 'Private message by ' + username(U(t.authorId)) + '<div class="activity-snippet">' + esc(snippet(t.content, 300)) + '</div>';
        else if (t && r.type === 'user') target = 'Member ' + username(U(t.userId));
        return '<div class="report-row"><div class="grow"><div><b>' + esc(r.reason) + '</b></div><div class="small muted">Reported by ' + (r.reporterId ? username(U(r.reporterId)) : '🤖 System') + ' · ' + time(r.at) + '</div><div class="report-target">' + target + '</div>' + (r.status !== 'open' ? '<div class="small muted">' + esc(r.status) + ' by ' + username(U(r.resolvedBy)) + ' ' + time(r.resolvedAt) + (r.note ? ': ' + esc(r.note) : '') + '</div>' : '') + '</div>' +
          (r.status === 'open' ? '<div class="report-actions"><button class="btn btn-sm btn-primary" data-act="resolve-report" data-id="' + r.id + '" data-status="resolved">Resolve</button><button class="btn btn-sm" data-act="resolve-report" data-id="' + r.id + '" data-status="rejected">Reject</button>' + (r.type === 'post' && t && !t.deleted ? '<button class="btn btn-sm btn-danger" data-act="delete-post" data-id="' + r.contentId + '">Delete post</button>' : '') + ((t && (t.authorId || t.userId)) ? '<button class="btn btn-sm" data-act="warn" data-id="' + (t.authorId || t.userId) + '">Warn</button>' : '') + '</div>' : '') + '</div>';
      }).join('') : '<div class="empty">No ' + status + ' reports. 🎉</div>') + '</div></section>';
    } else if (tab === 'members' || tab === 'banned') {
      const d = await api.get('/mod/users', { q: q.get('q'), filter: tab === 'banned' ? 'banned' : 'all' });
      body = '<form class="filter-bar" data-form="mod-user-search" data-tab="' + tab + '"><input name="q" value="' + esc(q.get('q') || '') + '" placeholder="Username"><button class="btn btn-sm">Search</button></form>' +
        '<section class="block"><table class="table"><thead><tr><th>Member</th><th>Group</th>' + (P('admin.users') ? '<th>Email</th>' : '') + '<th>Warnings</th><th>Status</th><th></th></tr></thead><tbody>' + d.members.map((m) => {
          const mu = U(m.userId);
          return '<tr><td>' + avatar(mu, 's') + ' ' + username(mu) + '</td><td>' + esc(PP.ROLE_TITLES[m.role] || m.role) + '</td>' + (P('admin.users') ? '<td class="small">' + esc(m.email || '') + '</td>' : '') + '<td>' + m.warningPoints + '</td><td>' + (m.ban ? '<span class="badge badge--red">' + (m.ban.expiresAt ? 'suspended' : 'banned') + '</span>' : esc(m.status)) + '</td><td class="nowrap">' +
            (m.canModerate ? (P('mod.warn') ? '<button class="btn btn-sm" data-act="warn" data-id="' + m.userId + '">Warn</button> ' : '') + '<button class="btn btn-sm" data-act="ban" data-id="' + m.userId + '" data-on="' + (m.ban ? 1 : '') + '">' + (m.ban ? 'Lift ban' : 'Ban') + '</button> ' + (P('admin.users') ? '<button class="btn btn-sm" data-act="set-role" data-id="' + m.userId + '" data-role="' + m.role + '">Group</button>' : '') : '') + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    } else if (tab === 'warnings') {
      const d = await api.get('/mod/warnings');
      body = '<section class="block"><div class="block-body">' + (d.warnings.length ? d.warnings.map((w) => '<div class="activity-item"><div>' + username(U(w.userId)) + ': <b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">by ' + username(U(w.issuedBy)) + ' · ' + time(w.at) + '</div></div></div>').join('') : '<div class="empty">No warnings issued.</div>') + '</div></section>';
    } else if (tab === 'log') {
      const page = Number(q.get('page')) || 1;
      const d = await api.get('/mod/log', { page });
      body = '<section class="block"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th>' + (P('admin.users') ? '<th>IP</th>' : '') + '</tr></thead><tbody>' + d.entries.map((e) => '<tr><td class="nowrap small">' + time(e.at) + '</td><td>' + (e.actorId ? username(U(e.actorId)) : '<span class="muted">system</span>') + '</td><td><code>' + esc(e.action) + '</code></td><td class="small">' + esc((e.targetType || '') + (e.targetId ? ' #' + e.targetId : '')) + '</td><td class="small">' + esc(JSON.stringify(e.details).slice(0, 160)) + '</td>' + (P('admin.users') ? '<td class="small">' + esc(e.ip || '') + '</td>' : '') + '</tr>').join('') + '</tbody></table></section>' +
        '<div class="form-actions">' + (page > 1 ? '<a class="btn btn-sm" href="#/mod/log?page=' + (page - 1) + '">‹ Newer</a>' : '') + (d.entries.length === 100 ? '<a class="btn btn-sm" href="#/mod/log?page=' + (page + 1) + '">Older ›</a>' : '') + '</div>';
    } else if (tab === 'stats') {
      const d = await api.get('/admin/stats');
      const s = d.stats, max = Math.max(1, ...d.days.map((x) => x.posts));
      body = '<section class="block"><div class="block-body"><dl class="pairs pairs--row"><div><dt>Members</dt><dd>' + num(s.members) + '</dd></div><div><dt>Unverified</dt><dd>' + num(s.unverified) + '</dd></div><div><dt>Online</dt><dd>' + num(s.online) + '</dd></div><div><dt>Threads</dt><dd>' + num(s.threads) + '</dd></div><div><dt>Posts</dt><dd>' + num(s.posts) + '</dd></div><div><dt>Profile posts</dt><dd>' + num(s.profile_posts) + '</dd></div><div><dt>Conversations</dt><dd>' + num(s.conversations) + '</dd></div><div><dt>Open reports</dt><dd>' + num(s.open_reports) + '</dd></div><div><dt>Active bans</dt><dd>' + num(s.active_bans) + '</dd></div><div><dt>Uploads</dt><dd>' + (Number(s.upload_bytes) / 1048576).toFixed(1) + ' MB</dd></div></dl>' +
        '<h4>Posts per day (last 14 days)</h4><div class="bar-chart">' + d.days.map((x) => '<div class="bar" title="' + esc(new Date(x.day).toLocaleDateString()) + ': ' + x.posts + ' posts, ' + x.signups + ' signups"><span style="height:' + (x.posts / max) * 100 + '%"></span><em>' + new Date(x.day).getDate() + '</em></div>').join('') + '</div></div></section>';
    } else if (tab === 'forums') {
      const d = await api.get('/forums');
      PP.adminForums = d;
      body = d.categories.map((c) => '<section class="block"><h3 class="block-head">' + esc(c.title) + ' <button class="btn btn-sm" data-act="edit-category" data-id="' + c.id + '">Edit</button></h3><div class="block-body">' +
        d.forums.filter((f) => f.categoryId === c.id && !f.parentId).sort((a, b) => a.position - b.position).flatMap((f) => { const out = []; const walk = (x, depth) => { out.push([x, depth]); d.forums.filter((ch) => ch.parentId === x.id).sort((a, b) => a.position - b.position).forEach((ch) => walk(ch, depth + 1)); }; walk(f, 0); return out; })
          .map(([f, depth]) => '<div class="member-row" style="padding-left:' + depth * 28 + 'px">' + (depth ? '<span class="muted">↳</span>' : '') + '<span class="node-icon">' + esc(f.icon) + '</span><div class="grow"><b>' + esc(f.title) + '</b> <code class="small">' + esc(f.id) + '</code><div class="small muted">' + esc(f.description) + (f.staffOnly ? ' · staff-only posting' : '') + (f.ratingEnabled ? ' · rating forum' : '') + (f.membersOnly ? ' · 🔒 members only' : '') + (f.vipOnly ? ' · 👑 VIP only' : '') + '</div></div><button class="btn btn-sm" data-act="edit-forum" data-id="' + f.id + '">Edit</button> <button class="btn btn-sm btn-danger" data-act="delete-forum" data-id="' + f.id + '">Delete</button></div>').join('') + '</div></section>').join('') +
        '<div class="form-actions"><button class="btn btn-primary" data-act="edit-forum">✚ Add forum</button> <button class="btn" data-act="edit-category">✚ Add category</button></div>';
    } else if (tab === 'roles') {
      const d = await api.get('/admin/roles');
      body = '<p class="small muted">Permissions are enforced by the server on every request. ' + (d.canEditPermissions ? 'You can edit roles below your own rank.' : 'Only super administrators can change role permissions.') + '</p>' +
        d.roles.map((r) => '<form class="block form" data-form="role-perms" data-id="' + r.id + '"><h3 class="block-head">' + esc(r.title) + ' <span class="small muted">rank ' + r.rank + '</span></h3><div class="block-body perm-grid">' +
          d.knownPermissions.filter((p) => p !== 'admin.permissions').map((p) => '<label class="check"><input type="checkbox" name="perm" value="' + p + '"' + (r.permissions.includes(p) ? ' checked' : '') + (d.canEditPermissions && r.rank < u.rankLevel ? '' : ' disabled') + '> <code>' + p + '</code></label>').join('') +
          (d.canEditPermissions && r.rank < u.rankLevel ? '<div class="form-actions"><button class="btn btn-primary btn-sm">Save ' + esc(r.title) + '</button></div>' : '') + '</div></form>').join('');
    } else if (tab === 'settings') {
      const d = await api.get('/admin/settings');
      const s = d.settings;
      body = '<form class="block form" data-form="site-settings"><div class="block-body">' +
        '<label class="field"><span>Site name</span><input name="site_name" value="' + esc(s.site_name) + '" maxlength="60" required></label>' +
        '<label class="field"><span>Site description</span><input name="site_description" value="' + esc(s.site_description) + '" maxlength="300"></label>' +
        '<label class="check"><input type="checkbox" name="registration_open"' + (s.registration_open ? ' checked' : '') + '> Registration open</label>' +
        '<label class="field"><span>Seconds between posts (flood control, staff exempt)</span><input type="number" name="flood_seconds" min="0" max="600" value="' + Number(s.flood_seconds) + '"></label>' +
        '<label class="field"><span>Reputation given per member per 24h</span><input type="number" name="rep_daily_limit" min="1" max="1000" value="' + Number(s.rep_daily_limit) + '"></label>' +
        '<label class="field"><span>Messages required to give negative rep</span><input type="number" name="neg_rep_min_posts" min="0" max="10000" value="' + Number(s.neg_rep_min_posts) + '"></label>' +
        '<label class="field"><span>Maximum poll options</span><input type="number" name="max_poll_options" min="2" max="50" value="' + Number(s.max_poll_options) + '"></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save settings</button></div></div></form>';
    } else if (tab === 'accounts') {
      const sig = (s) => '<span class="small">' + esc(s.ip || '?') + ' · ' + esc(s.deviceName) + (s.country ? ' · ' + esc(s.country) : '') + ' · <code title="Device ID (browser cookie)">' + esc((s.deviceId || '').slice(0, 8)) + '…</code></span>';
      const matchList = (ms) => (ms.length ? ms.map((m) => username(U(m.userId)) + ' <span class="badge' + (m.sameDevice ? ' badge--red' : '') + '">' + (m.sameDevice ? 'same device' : 'same IP') + '</span>' + (m.banned ? ' <span class="badge badge--red">banned</span>' : '')).join(', ') : '<span class="muted small">none</span>');
      if (q.get('user')) {
        const d = await api.get('/admin/users/' + encodeURIComponent(q.get('user')) + '/signals');
        body = '<p><a href="#/mod/accounts">‹ All new accounts</a></p><section class="block"><h3 class="block-head">' + username(U(d.userId)) + ': accounts sharing an IP or device</h3><div class="block-body">' + matchList(d.matches) + '</div></section>' +
          '<section class="block"><h3 class="block-head">Sign-ups and logins</h3><table class="table"><thead><tr><th>When</th><th>Event</th><th>IP</th><th>Device</th><th>Country</th><th>Device ID</th></tr></thead><tbody>' +
          d.signals.map((s) => '<tr><td class="small nowrap">' + time(s.at) + '</td><td>' + esc(s.event) + '</td><td class="small">' + esc(s.ip || '') + '</td><td class="small" title="' + esc(s.userAgent) + '">' + esc(s.deviceName) + '</td><td>' + esc(s.country || '—') + '</td><td><code class="small">' + esc(s.deviceId || '') + '</code></td></tr>').join('') + '</tbody></table></section>';
      } else {
        const d = await api.get('/admin/accounts');
        body = '<p class="small muted">Every new account is recorded with its IP address, device (browser/OS), a per-browser device ID and, if configured, country. Admins are alerted when a new account shares an IP or device with another, and when a banned member\'s device or IP is used to log in. Shared IPs can be innocent (households, schools, mobile networks); a shared device ID is a stronger sign.</p>' +
          '<section class="block"><table class="table"><thead><tr><th>New account</th><th>Joined</th><th>Signals</th><th>Shares IP/device with</th></tr></thead><tbody>' +
          (d.accounts.length ? d.accounts.map((a) => '<tr><td><a href="#/mod/accounts?user=' + a.userId + '">' + esc((U(a.userId) || {}).username || '?') + '</a></td><td class="small nowrap">' + time(a.at) + '</td><td>' + sig(a) + '</td><td>' + matchList(a.matches) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">No sign-ups recorded yet.</td></tr>') + '</tbody></table></section>';
      }
    } else if (tab === 'vip') {
      body = await PP.vipViews.adminVip(q);
    } else if (tab === 'data') {
      let legacy = null;
      try { legacy = localStorage.getItem('pinkpill.db.v1'); } catch (e) { /* ignore */ }
      body = '<section class="block"><h3 class="block-head">Import from the prototype</h3><div class="block-body"><p>Import threads, posts, members and more from the old browser-only PinkPill prototype (its <i>Admin → Data → Export</i> JSON file). Imported members get no password and must use “Forgot your password?” to claim their account. Nothing is overwritten; imported usernames that already exist are skipped and their content is attributed to the existing member only if the emails match.</p>' +
        (legacy ? '<p><button class="btn btn-primary" data-act="import-legacy-local">Import the prototype data stored in this browser</button></p>' : '') +
        '<label class="btn">⬆ Import a prototype JSON file<input type="file" accept="application/json,.json" data-import hidden></label><div data-import-result></div></div></section>';
    }
    const html = '<div class="page-head"><h1>' + (P('admin.stats') ? 'Admin & moderator panel' : 'Moderator panel') + '</h1></div><nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/mod/' + k + '">' + l + '</a>').join('') + '</nav>' + body;
    return { title: 'Moderator panel', html };
  }

  /* ---------- misc ---------- */

  function notFound(what) { return { title: 'Not found', html: '<div class="notice notice--error">The requested ' + esc(what || 'page') + ' could not be found. <a href="#/">Back to forums</a></div>' }; }
  function errorView(msg) { return { title: 'Oops', html: '<div class="notice notice--error">' + esc(msg) + '</div>' }; }
  function loginRequired(msg) { return { title: 'Log in required', html: '<div class="notice">' + esc(typeof msg === 'string' ? msg : 'You must be logged in to do that.') + ' <a class="btn btn-primary btn-sm" href="#/login?return=' + encodeURIComponent(location.hash) + '">Log in</a> <a class="btn btn-sm" href="#/register">Register</a></div>' }; }

  PP.views = { claimAdmin, repBadge, home, forum, threadView, postThread, members, online, member, login, register, lostPassword, resetPassword, verifyEmail, account, alerts, alertRow, conversations, conversationNew, conversation, search, tag, whatsNew, help, mod, notFound, errorView, loginRequired };
})();

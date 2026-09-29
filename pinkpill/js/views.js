/* Page views. Each returns { title, html, sidebar?, activity?, after? }. */
(function () {
  'use strict';
  const PP = window.PP;
  const { store, esc, bbcode, time, num, ui, snippet, fullDate, timeAgo } = PP;
  const { avatar, username, userTitle, prefix, pagination, breadcrumb, editor } = ui;
  const PER_POSTS = 20, PER_THREADS = 20;
  const me = () => store.currentUser();
  const db = () => store.db;

  /* ---------- read tracking ---------- */

  function readCutoff(u, threadId) {
    return Math.max(((u.readMarks || {})[threadId]) || 0, u.readAllAt || 0, Date.now() - 30 * PP.DAY);
  }
  function threadUnread(t, u) {
    if (!u) return false;
    const lp = store.lastPost(t.id);
    return !!lp && lp.authorId !== u.id && lp.created > readCutoff(u, t.id);
  }
  function forumUnread(f, u) { return !!u && store.threadsIn(f.id).some((t) => threadUnread(t, u)); }

  /* ---------- sidebar widgets ---------- */

  function widgetOnline() {
    const online = db().users.filter(store.isOnline).sort((a, b) => b.lastSeen - a.lastSeen);
    const staff = online.filter(store.isStaff);
    return '<section class="block"><h3 class="block-head"><a href="#/online">Members online</a></h3><div class="block-body">' +
      (online.length ? '<div class="inline-list">' + online.map((u) => username(u)).join(', ') + '</div>' : '<p class="muted">No members online right now.</p>') +
      '<p class="small muted">Total: ' + online.length + ' member' + (online.length === 1 ? '' : 's') + ' online (last 15 minutes)</p></div></section>' +
      (staff.length ? '<section class="block"><h3 class="block-head">Staff online</h3><div class="block-body">' + staff.map((u) => '<div class="mini-user">' + avatar(u, 's') + '<div>' + username(u) + '<div class="small muted">' + userTitle(u) + '</div></div></div>').join('') + '</div></section>' : '');
  }

  function widgetLatestPosts(n) {
    const ts = db().threads.map((t) => ({ t, lp: store.lastPost(t.id) })).filter((x) => x.lp).sort((a, b) => b.lp.created - a.lp.created).slice(0, n || 6);
    return '<section class="block"><h3 class="block-head"><a href="#/whats-new">Latest posts</a></h3><div class="block-body">' +
      ts.map(({ t, lp }) => '<div class="mini-post">' + avatar(store.user(lp.authorId), 's') + '<div><a href="#/threads/' + t.id + '/post-' + lp.id + '" class="mini-title">' + prefix(t.prefix) + esc(t.title) + '</a><div class="small muted">Latest: ' + esc((store.user(lp.authorId) || {}).username || '?') + ' · ' + time(lp.created) + '</div><div class="small muted">' + esc(store.forum(t.forumId).title) + '</div></div></div>').join('') + '</div></section>';
  }

  function widgetStats() {
    const d = db();
    const newest = d.users.slice().sort((a, b) => b.joined - a.joined)[0];
    return '<section class="block"><h3 class="block-head">Forum statistics</h3><div class="block-body"><dl class="pairs">' +
      '<div><dt>Threads</dt><dd>' + num(d.threads.length) + '</dd></div>' +
      '<div><dt>Messages</dt><dd>' + num(d.posts.filter((p) => !p.deleted).length) + '</dd></div>' +
      '<div><dt>Members</dt><dd>' + num(d.users.length) + '</dd></div>' +
      '<div><dt>Latest member</dt><dd>' + username(newest) + '</dd></div></dl></div></section>';
  }

  function widgetProfilePosts() {
    const pps = db().profilePosts.slice().sort((a, b) => b.created - a.created).slice(0, 4);
    if (!pps.length) return '';
    return '<section class="block"><h3 class="block-head"><a href="#/whats-new/profile-posts">New profile posts</a></h3><div class="block-body">' +
      pps.map((pp) => '<div class="mini-post">' + avatar(store.user(pp.authorId), 's') + '<div><div class="small">' + username(store.user(pp.authorId)) + (pp.authorId !== pp.profileUserId ? ' › ' + username(store.user(pp.profileUserId)) : '') + '</div><div class="small">' + esc(snippet(pp.content, 90)) + '</div><div class="small muted">' + time(pp.created) + '</div></div></div>').join('') + '</div></section>';
  }

  const defaultSidebar = () => widgetOnline() + widgetLatestPosts() + widgetProfilePosts() + widgetStats();

  /* ---------- home ---------- */

  function home() {
    const u = me();
    const cats = db().categories.slice().sort((a, b) => a.order - b.order);
    let html = '<div class="page-head"><h1>PinkPill</h1><p class="muted">The looksmaxxing forum for women — skincare, hair, makeup, fitness, style &amp; confidence.</p>' +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="mark-all-read">Mark forums read</button> ' : '') + '<a class="btn btn-primary" href="#/post-thread">Post thread…</a></div></div>';
    if (!u) html += '<div class="notice notice--welcome"><b>Welcome to PinkPill! 💗</b> Join to post, react, follow members and send messages. <a class="btn btn-primary btn-sm" href="#/register">Register</a> <a class="btn btn-sm" href="#/login">Log in</a></div>';
    cats.forEach((c) => {
      const forums = db().forums.filter((f) => f.categoryId === c.id).sort((a, b) => a.order - b.order);
      html += '<section class="block node-cat"><h2 class="block-head block-head--cat" data-collapse>' + esc(c.title) + '</h2><div class="block-body">';
      forums.forEach((f) => {
        const s = store.forumStats(f.id);
        const lp = s.last, lt = lp && store.thread(lp.threadId), lu = lp && store.user(lp.authorId);
        const unread = forumUnread(f, u);
        html += '<div class="node' + (unread ? ' node--unread' : '') + '"><div class="node-icon">' + f.icon + '</div>' +
          '<div class="node-main"><a class="node-title" href="#/forums/' + f.id + '">' + esc(f.title) + '</a><div class="node-desc">' + esc(f.desc) + '</div></div>' +
          '<dl class="node-stats"><div><dt>Threads</dt><dd>' + num(s.threads) + '</dd></div><div><dt>Messages</dt><dd>' + num(s.messages) + '</dd></div></dl>' +
          '<div class="node-last">' + (lp ? avatar(lu, 's') + '<div><a href="#/threads/' + lt.id + '/post-' + lp.id + '" class="node-last-title">' + prefix(lt.prefix) + esc(lt.title) + '</a><div class="small muted">' + time(lp.created) + ' · ' + username(lu) + '</div></div>' : '<span class="muted">None</span>') + '</div></div>';
      });
      html += '</div></section>';
    });
    return { title: 'Forums', html, sidebar: defaultSidebar(), activity: 'Viewing forum index' };
  }

  /* ---------- forum (thread list) ---------- */

  function threadRow(t, u) {
    const ps = store.postsIn(t.id).filter((p) => !p.deleted);
    const lp = ps[ps.length - 1], au = store.user(t.authorId), lu = lp && store.user(lp.authorId);
    const pages = Math.ceil(ps.length / PER_POSTS);
    const unread = threadUnread(t, u);
    const ignored = u && u.ignoring.includes(t.authorId);
    let pageLinks = '';
    if (pages > 1) pageLinks = '<span class="thread-pages">' + [...new Set([1, 2, 3, pages - 1, pages].filter((n) => n > 0 && n <= pages))].map((n) => '<a href="#/threads/' + t.id + (n > 1 ? '/page-' + n : '') + '">' + n + '</a>').join(' ') + '</span>';
    return '<div class="thread-row' + (unread ? ' thread-row--unread' : '') + (t.sticky ? ' thread-row--sticky' : '') + (ignored ? ' is-ignored' : '') + '">' +
      '<div class="thread-avatar">' + avatar(au, 'm') + '</div>' +
      '<div class="thread-main"><div class="thread-title">' + prefix(t.prefix) + '<a href="#/threads/' + t.id + (unread ? '?unread=1' : '') + '">' + esc(t.title) + '</a></div>' +
      '<div class="thread-meta small muted">' + username(au) + ' · ' + time(t.created) + ' ' + pageLinks +
      '<span class="thread-icons">' + (t.sticky ? '<span title="Sticky">📌</span>' : '') + (t.locked ? '<span title="Locked">🔒</span>' : '') + (t.poll ? '<span title="Poll">📊</span>' : '') + (t.ratingEnabled ? '<span title="Rating thread">⭐</span>' : '') + (u && u.watched.includes(t.id) ? '<span title="Watched">👁</span>' : '') + '</span></div></div>' +
      '<dl class="thread-stats"><div><dt>Replies</dt><dd>' + num(ps.length - 1) + '</dd></div><div><dt>Views</dt><dd>' + num(t.views) + '</dd></div></dl>' +
      '<div class="thread-last">' + (lp ? '<div class="small"><a href="#/threads/' + t.id + '/post-' + lp.id + '">' + time(lp.created) + '</a></div><div class="small">' + username(lu) + '</div>' : '') + '</div>' +
      '<div class="thread-last-avatar">' + (lu ? avatar(lu, 's') : '') + '</div></div>';
  }

  function sortThreads(list, order, dir) {
    const lastAt = (t) => { const lp = store.lastPost(t.id); return lp ? lp.created : t.created; };
    const replies = (t) => store.postsIn(t.id).filter((p) => !p.deleted).length;
    const reacts = (t) => { const f = store.postsIn(t.id)[0]; return f ? Object.keys(f.reactions || {}).length : 0; };
    const key = { last: lastAt, created: (t) => t.created, title: (t) => t.title.toLowerCase(), replies, views: (t) => t.views, reactions: reacts }[order] || lastAt;
    return list.sort((a, b) => { const x = key(a), y = key(b); const r = x < y ? -1 : x > y ? 1 : 0; return dir === 'asc' ? r : -r; });
  }

  function forum([id, page], q) {
    const f = store.forum(id);
    if (!f) return notFound('forum');
    const u = me();
    const pg = Number(page) || 1;
    const cat = db().categories.find((c) => c.id === f.categoryId);
    const pfx = q.get('prefix') || '', order = q.get('order') || 'last', dir = q.get('dir') || 'desc', starter = q.get('starter') || '';
    let list = store.threadsIn(f.id).filter((t) => !u || !u.ignoring.includes(t.authorId) || q.get('ignored'));
    if (pfx) list = list.filter((t) => t.prefix === pfx);
    if (starter) { const su = store.userByName(starter); list = list.filter((t) => su && t.authorId === su.id); }
    if (q.get('unread') && u) list = list.filter((t) => threadUnread(t, u));
    const sticky = sortThreads(list.filter((t) => t.sticky), 'last', 'desc');
    const normal = sortThreads(list.filter((t) => !t.sticky), order, dir);
    const pageItems = normal.slice((pg - 1) * PER_THREADS, pg * PER_THREADS);
    const canPost = !f.staffOnly || store.isStaff(u);
    const qs = (extra) => { const p = new URLSearchParams(q); Object.entries(extra).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k))); const s = p.toString(); return s ? '?' + s : ''; };

    let html = breadcrumb([['#/', cat.title], ['#/forums/' + f.id, f.title]]) +
      '<div class="page-head"><h1>' + f.icon + ' ' + esc(f.title) + '</h1><p class="muted">' + esc(f.desc) + '</p>' +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="mark-forum-read" data-id="' + f.id + '">Mark read</button> ' : '') +
      (canPost ? '<a class="btn btn-primary" href="#/post-thread/' + f.id + '">Post thread</a>' : '<span class="muted small">Only staff can post here.</span>') + '</div></div>';
    if (f.rating) html += '<div class="notice"><b>Rate Me rules:</b> feedback is opt-in and must be constructive. Point out strengths, suggest actionable changes. No insults, no "it\'s over", no comments on things people can\'t change. Violations = ban.</div>';
    html += '<form class="filter-bar" data-form="thread-filter" data-forum="' + f.id + '">' +
      '<label>Prefix <select name="prefix"><option value="">Any</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (p.id === pfx ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></label>' +
      '<label>Started by <input name="starter" value="' + esc(starter) + '" placeholder="Member" size="10"></label>' +
      '<label>Sort by <select name="order">' + [['last', 'Last message'], ['created', 'First message'], ['title', 'Title'], ['replies', 'Replies'], ['views', 'Views'], ['reactions', 'First message reactions']].map(([v, l]) => '<option value="' + v + '"' + (v === order ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label><select name="dir"><option value="desc"' + (dir === 'desc' ? ' selected' : '') + '>Descending</option><option value="asc"' + (dir === 'asc' ? ' selected' : '') + '>Ascending</option></select></label>' +
      (u ? '<label class="check"><input type="checkbox" name="unread" value="1"' + (q.get('unread') ? ' checked' : '') + '> Unread only</label>' : '') +
      '<button class="btn btn-sm">Filter</button>' + (q.toString() ? ' <a class="btn btn-sm" href="#/forums/' + f.id + '">Clear</a>' : '') + '</form>';
    html += '<section class="block">';
    if (sticky.length && pg === 1) html += '<div class="block-sub">Sticky threads</div>' + sticky.map((t) => threadRow(t, u)).join('') + (pageItems.length ? '<div class="block-sub">Normal threads</div>' : '');
    html += pageItems.map((t) => threadRow(t, u)).join('');
    if (!sticky.length && !pageItems.length) html += '<div class="empty">There are no threads matching your filters.</div>';
    html += '</section>' + pagination(normal.length, PER_THREADS, pg, '#/forums/' + f.id).replace(/href="([^"]+)"/g, (m, h) => 'href="' + h + qs({}) + '"');
    return { title: f.title, html, sidebar: widgetOnline() + widgetLatestPosts(5), activity: 'Viewing forum ' + f.title };
  }

  /* ---------- thread ---------- */

  function reactionSummary(target, kind) {
    const entries = Object.entries(target.reactions || {});
    if (!entries.length) return '';
    const types = [...new Set(entries.map((e) => e[1]))].map((r) => PP.REACTIONS.find((x) => x.id === r)).filter(Boolean);
    const u = me();
    const names = entries.map(([id]) => (u && id === u.id ? 'You' : (store.user(id) || {}).username)).filter(Boolean);
    names.sort((a) => (a === 'You' ? -1 : 0));
    let text = names.slice(0, 3).join(', ');
    if (names.length > 3) text += ' and ' + (names.length - 3) + ' other' + (names.length - 3 > 1 ? 's' : '');
    return '<button class="reactions-bar" data-act="reactors" data-kind="' + kind + '" data-id="' + target.id + '"><span class="reaction-emojis">' + types.map((r) => r.emoji).join('') + '</span> ' + esc(text) + '</button>';
  }

  function reactButton(target, kind) {
    const u = me();
    const mine = u && (target.reactions || {})[u.id];
    const def = PP.REACTIONS.find((r) => r.id === mine);
    return '<span class="react-wrap"><button class="action' + (mine ? ' action--active' : '') + '" data-act="react" data-kind="' + kind + '" data-id="' + target.id + '" data-r="' + (mine || 'like') + '">' + (def ? def.emoji + ' ' + def.label : '👍 Like') + '</button>' +
      '<span class="react-picker">' + PP.REACTIONS.map((r) => '<button data-act="react" data-kind="' + kind + '" data-id="' + target.id + '" data-r="' + r.id + '" title="' + r.label + '">' + r.emoji + '</button>').join('') + '</span></span>';
  }

  function authorPanel(a) {
    if (!a) return '<div class="message-user"><div class="muted">Deleted member</div></div>';
    const s = store.userStats(a);
    return '<div class="message-user">' + avatar(a, 'l') + (store.isOnline(a) ? '<span class="online-badge" title="Online now"></span>' : '') +
      '<div class="message-username">' + username(a) + '</div><div class="message-title">' + userTitle(a) + '</div>' + ui.roleBanner(a) +
      '<dl class="pairs pairs--compact"><div><dt>Joined</dt><dd>' + fullDate(a.joined) + '</dd></div><div><dt>Messages</dt><dd>' + num(s.posts) + '</dd></div><div><dt>Reaction score</dt><dd>' + num(s.score) + '</dd></div><div><dt>Points</dt><dd>' + s.points + '</dd></div>' + (a.location ? '<div><dt>Location</dt><dd>' + esc(a.location) + '</dd></div>' : '') + '</dl></div>';
  }

  function postHtml(p, th, n, u) {
    const a = store.user(p.authorId);
    const own = u && u.id === p.authorId;
    const staff = store.isStaff(u);
    if (p.deleted) {
      return '<article class="message message--deleted" id="post-' + p.id + '"><div class="message-deleted">🗑 Post by ' + username(a) + ' deleted by ' + username(store.user(p.deletedBy)) + (p.deleteReason ? ' — ' + esc(p.deleteReason) : '') + ' <button class="action" data-act="undelete-post" data-id="' + p.id + '">Undelete</button></div></article>';
    }
    if (u && u.ignoring.includes(p.authorId)) {
      return '<article class="message message--ignored" id="post-' + p.id + '"><div class="message-deleted">You are ignoring content by this member. <button class="action" data-act="show-ignored" data-id="' + p.id + '">Show ignored content</button></div><template>' + postBody(p, th, n, u, a, own, staff) + '</template></article>';
    }
    return '<article class="message" id="post-' + p.id + '">' + postBody(p, th, n, u, a, own, staff) + '</article>';
  }

  function postBody(p, th, n, u, a, own, staff) {
    const bookmarked = u && u.bookmarks.includes(p.id);
    const mq = (PP.multiQuote || []).includes(p.id);
    return authorPanel(a) + '<div class="message-main"><header class="message-attribution"><a href="#/threads/' + th.id + '/post-' + p.id + '" class="muted small">' + time(p.created) + '</a>' +
      '<span class="message-attribution-opposite">' + (p.rating != null ? '<span class="rating-badge">⭐ Rated ' + p.rating + '/10</span>' : '') +
      '<button class="icon-btn" data-act="share" data-id="' + p.id + '" data-thread="' + th.id + '" title="Share">🔗</button>' +
      (u ? '<button class="icon-btn' + (bookmarked ? ' on' : '') + '" data-act="bookmark" data-id="' + p.id + '" title="Bookmark">' + (bookmarked ? '🔖' : '📑') + '</button>' : '') +
      '<a href="#/threads/' + th.id + '/post-' + p.id + '" class="muted small">#' + n + '</a></span></header>' +
      '<div class="message-content bbwrap">' + bbcode(p.content) + '</div>' +
      (p.edited ? '<div class="message-edited small muted">Last edited' + (p.editedBy && p.editedBy !== p.authorId ? ' by a moderator' : '') + ': ' + time(p.edited) + (p.editReason ? ' — ' + esc(p.editReason) : '') + (own || staff ? ' · <button class="link" data-act="history" data-id="' + p.id + '">History</button>' : '') + '</div>' : '') +
      (a && a.signature && (!u || u.settings.showSignatures !== false) ? '<aside class="message-signature bbwrap">' + bbcode(a.signature) + '</aside>' : '') +
      '<footer class="message-footer"><div class="message-actions">' +
      (u ? '<button class="action" data-act="report" data-kind="post" data-id="' + p.id + '">Report</button>' : '') +
      ((own || staff) ? '<button class="action" data-act="edit-post" data-id="' + p.id + '">Edit</button><button class="action" data-act="delete-post" data-id="' + p.id + '">Delete</button>' : '') +
      (staff && a && a.id !== u.id ? '<button class="action" data-act="warn" data-id="' + a.id + '">Warn</button>' : '') +
      '</div><div class="message-actions">' +
      (u && !own ? reactButton(p, 'post') : '') +
      (u && (!th.locked || staff) ? '<button class="action" data-act="mq" data-id="' + p.id + '">' + (mq ? '− Quote' : '+ Quote') + '</button><button class="action" data-act="quote" data-id="' + p.id + '">Reply</button>' : '') +
      '</div></footer>' + reactionSummary(p, 'post') + '</div>';
  }

  function pollHtml(th, u) {
    const p = th.poll;
    const total = p.options.reduce((a, o) => a + o.votes.length, 0);
    const voters = new Set(p.options.flatMap((o) => o.votes)).size;
    const voted = u && p.options.some((o) => o.votes.includes(u.id));
    const closed = p.closes && Date.now() > p.closes;
    const showResults = voted || closed || !u || PP.pollResults === th.id;
    let h = '<section class="block poll"><h3 class="block-head">📊 ' + esc(p.question) + '</h3><div class="block-body">';
    if (showResults) {
      h += p.options.map((o) => {
        const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
        const mine = u && o.votes.includes(u.id);
        return '<div class="poll-result' + (mine ? ' mine' : '') + '"><div class="poll-label">' + esc(o.text) + (mine ? ' ✓' : '') + '</div><div class="poll-bar"><span style="width:' + pct + '%"></span></div><div class="poll-count">' + o.votes.length + ' <span class="muted">(' + pct + '%)</span></div></div>';
      }).join('');
      h += '<p class="small muted">Total voters: ' + voters + (p.multiple ? ' · Multiple votes allowed' : '') + (p.closes ? ' · ' + (closed ? 'Poll closed ' : 'Closes ') + fullDate(p.closes) : '') + '</p>';
      if (u && !closed) h += '<button class="btn btn-sm" data-act="poll-change" data-id="' + th.id + '">' + (voted ? 'Change vote' : 'Vote') + '</button>';
    } else {
      h += '<form data-form="poll-vote" data-id="' + th.id + '">' + p.options.map((o, i) => '<label class="poll-option"><input type="' + (p.multiple ? 'checkbox' : 'radio') + '" name="opt" value="' + i + '"> ' + esc(o.text) + '</label>').join('') +
        '<div class="form-actions"><button class="btn btn-primary btn-sm">Cast vote</button> <button type="button" class="btn btn-sm" data-act="poll-results" data-id="' + th.id + '">View results</button></div></form>';
    }
    return h + '</div></section>';
  }

  function ratingSummary(posts) {
    const rs = posts.filter((p) => !p.deleted && p.rating != null).map((p) => p.rating);
    if (!rs.length) return '<section class="block rating-summary"><div class="block-body"><b>⭐ Community rating:</b> <span class="muted">No ratings yet. Reply with a rating and constructive feedback.</span></div></section>';
    const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
    const dist = Array.from({ length: 10 }, (_, i) => rs.filter((r) => r === i + 1).length);
    const max = Math.max(...dist);
    return '<section class="block rating-summary"><div class="block-body"><div class="rating-big">' + avg.toFixed(1) + '<small>/10</small></div><div><b>Community rating</b><div class="muted small">from ' + rs.length + ' rating' + (rs.length > 1 ? 's' : '') + '</div></div>' +
      '<div class="rating-dist">' + dist.map((d, i) => '<div class="rd-col" title="' + (i + 1) + ': ' + d + '"><span style="height:' + (max ? (d / max) * 100 : 0) + '%"></span><em>' + (i + 1) + '</em></div>').join('') + '</div></div></section>';
  }

  function threadView([id, page, postId], q) {
    const th = store.thread(id);
    if (!th) return notFound('thread');
    const u = me();
    const staff = store.isStaff(u);
    const f = store.forum(th.forumId), cat = db().categories.find((c) => c.id === f.categoryId);
    let all = store.postsIn(th.id);
    if (!staff) all = all.filter((p) => !p.deleted);
    let pg = Number(page) || 1;
    let target = postId;
    if (q.get('unread') && u) {
      const cutoff = readCutoff(u, th.id);
      const firstNew = all.find((p) => p.created > cutoff);
      if (firstNew) target = firstNew.id;
    }
    if (target) { const i = all.findIndex((p) => p.id === target); if (i >= 0) pg = Math.floor(i / PER_POSTS) + 1; }
    const pages = Math.max(1, Math.ceil(all.length / PER_POSTS));
    pg = Math.min(pg, pages);
    const slice = all.slice((pg - 1) * PER_POSTS, pg * PER_POSTS);

    // counters & read marks (saved without re-render)
    PP.viewed = PP.viewed || new Set();
    if (!PP.viewed.has(th.id)) { PP.viewed.add(th.id); th.views++; }
    if (u) { u.readMarks = u.readMarks || {}; u.readMarks[th.id] = Date.now(); }
    store.save();

    const author = store.user(th.authorId);
    const watching = u && u.watched.includes(th.id);
    const own = u && u.id === th.authorId;
    let html = breadcrumb([['#/', cat.title], ['#/forums/' + f.id, f.title], ['#/threads/' + th.id, th.title]]) +
      '<div class="page-head"><h1>' + prefix(th.prefix) + esc(th.title) + '</h1>' +
      '<div class="thread-info muted small">' + username(author) + ' · ' + time(th.created) + (th.locked ? ' · 🔒 Locked' : '') + (th.sticky ? ' · 📌 Sticky' : '') + '</div>' +
      (th.tags.length ? '<div class="tags">' + th.tags.map((t) => '<a class="tag" href="#/tags/' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('') + '</div>' : '') +
      '<div class="head-actions">' + (u ? '<button class="btn" data-act="watch-thread" data-id="' + th.id + '">' + (watching ? '👁 Unwatch' : '👁 Watch') + '</button> ' : '') +
      ((own || staff) ? '<span class="menu-wrap"><button class="btn" data-menu="thread-tools">⚙ Thread tools ▾</button><div class="menu" data-menu-body="thread-tools">' +
        '<button data-act="edit-thread" data-id="' + th.id + '">Edit thread</button>' +
        (staff ? '<button data-act="toggle-sticky" data-id="' + th.id + '">' + (th.sticky ? 'Unstick thread' : 'Stick thread') + '</button><button data-act="toggle-lock" data-id="' + th.id + '">' + (th.locked ? 'Unlock thread' : 'Lock thread') + '</button><button data-act="move-thread" data-id="' + th.id + '">Move thread</button>' : '') +
        '<button data-act="delete-thread" data-id="' + th.id + '" class="danger">Delete thread</button></div></span>' : '') +
      '</div></div>';
    html += pagination(all.length, PER_POSTS, pg, '#/threads/' + th.id);
    if (th.poll) html += pollHtml(th, u);
    if (th.ratingEnabled) html += ratingSummary(all);
    let n = (pg - 1) * PER_POSTS;
    html += '<div class="messages">' + slice.map((p) => postHtml(p, th, ++n, u)).join('') + '</div>';
    html += pagination(all.length, PER_POSTS, pg, '#/threads/' + th.id);

    if (!u) html += '<div class="notice">You must <a href="#/login?return=' + encodeURIComponent('#/threads/' + th.id) + '">log in</a> or <a href="#/register">register</a> to reply here.</div>';
    else if (th.locked && !staff) html += '<div class="notice">🔒 This thread is locked. New replies are not allowed.</div>';
    else {
      const rated = all.some((p) => p.authorId === u.id && p.rating != null);
      html += '<section class="block quick-reply" id="reply"><div class="quick-reply-inner">' + avatar(u, 'm') + '<form data-form="reply" data-thread="' + th.id + '" data-draft="reply-' + th.id + '" class="grow">' +
        editor('content', '', { rows: 5, placeholder: 'Write your reply…' }) +
        '<div class="form-actions">' +
        (th.ratingEnabled && !own ? (rated ? '<span class="small muted">You\'ve already rated this thread.</span>' : '<label>Rating <select name="rating"><option value="">No rating</option>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => '<option>' + i + '</option>').join('') + '</select></label>') : '') +
        '<button class="btn btn-primary">↩ Post reply</button> <button type="button" class="btn" data-act="mq-insert" data-thread="' + th.id + '"' + ((PP.multiQuote || []).length ? '' : ' hidden') + '>Insert quotes (' + (PP.multiQuote || []).length + ')</button>' +
        '<span class="small muted">Ctrl+Enter to post</span></div></form></div></section>';
    }
    const similar = db().threads.filter((t) => t.id !== th.id && (t.forumId === th.forumId || t.tags.some((x) => th.tags.includes(x)))).slice(0, 5);
    const sidebar = '<section class="block"><h3 class="block-head">Thread information</h3><div class="block-body"><dl class="pairs"><div><dt>Started by</dt><dd>' + username(author) + '</dd></div><div><dt>Replies</dt><dd>' + (all.length - 1) + '</dd></div><div><dt>Views</dt><dd>' + num(th.views) + '</dd></div><div><dt>Watchers</dt><dd>' + th.watchers.length + '</dd></div><div><dt>Participants</dt><dd>' + new Set(all.map((p) => p.authorId)).size + '</dd></div></dl></div></section>' +
      (similar.length ? '<section class="block"><h3 class="block-head">Similar threads</h3><div class="block-body">' + similar.map((t) => '<div class="mini-post"><div><a class="mini-title" href="#/threads/' + t.id + '">' + prefix(t.prefix) + esc(t.title) + '</a><div class="small muted">' + esc(store.forum(t.forumId).title) + '</div></div></div>').join('') + '</div></section>' : '') +
      widgetOnline();
    return {
      title: th.title, html, sidebar, activity: 'Viewing thread ' + th.title,
      after: () => {
        if (target) {
          const el = document.getElementById('post-' + target);
          if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('message--highlight'); }
        }
      },
    };
  }

  /* ---------- post thread ---------- */

  function postThread([forumId]) {
    const u = me();
    if (!u) return loginRequired();
    if (!forumId) {
      const html = '<div class="page-head"><h1>Post thread</h1><p class="muted">Choose a forum to post in:</p></div><section class="block"><div class="block-body">' +
        db().categories.map((c) => '<h3>' + esc(c.title) + '</h3><div class="forum-pick">' + db().forums.filter((f) => f.categoryId === c.id && (!f.staffOnly || store.isStaff(u))).map((f) => '<a class="btn" href="#/post-thread/' + f.id + '">' + f.icon + ' ' + esc(f.title) + '</a>').join('') + '</div>').join('') + '</div></section>';
      return { title: 'Post thread', html };
    }
    const f = store.forum(forumId);
    if (!f) return notFound('forum');
    if (f.staffOnly && !store.isStaff(u)) return errorView('Only staff can post in this forum.');
    const cat = db().categories.find((c) => c.id === f.categoryId);
    const html = breadcrumb([['#/', cat.title], ['#/forums/' + f.id, f.title], ['', 'Post thread']]) +
      '<div class="page-head"><h1>Post thread in ' + esc(f.title) + '</h1></div>' +
      (f.rating ? '<div class="notice">Posting in <b>Rate Me &amp; Feedback</b>: you\'re opting in to ratings and feedback. Only post photos of yourself, and only if you\'re 18+. You can delete your thread at any time.</div>' : '') +
      '<form class="block form" data-form="post-thread" data-forum="' + f.id + '" data-draft="thread-' + f.id + '"><div class="block-body">' +
      '<div class="row"><select name="prefix" class="prefix-select"><option value="">(No prefix)</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (f.rating && p.id === 'rateme' ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select>' +
      '<input name="title" class="grow input-title" placeholder="Thread title" maxlength="150" required></div>' +
      editor('content', '', { rows: 12, required: true }) +
      '<label class="field"><span>Tags</span><input name="tags" placeholder="Separate with commas, e.g. skincare, acne"></label>' +
      '<details class="poll-builder"><summary>📊 Add a poll</summary><div class="field-group">' +
      '<label class="field"><span>Question</span><input name="poll_q" maxlength="200"></label>' +
      '<div data-poll-options>' + [1, 2, 3].map((i) => '<input name="poll_opt" placeholder="Option ' + i + '" class="poll-opt">').join('') + '</div>' +
      '<button type="button" class="btn btn-sm" data-act="poll-add-option">+ Add option</button>' +
      '<label class="check"><input type="checkbox" name="poll_multi"> Allow selecting multiple options</label>' +
      '<label class="field"><span>Close poll after (days, blank = never)</span><input name="poll_days" type="number" min="1" max="365"></label></div></details>' +
      (!f.rating ? '<label class="check"><input type="checkbox" name="rating_enabled"> ⭐ Enable community ratings on this thread (opt-in)</label>' : '') +
      '<label class="check"><input type="checkbox" name="watch" checked> Watch this thread and receive alerts for replies</label>' +
      '<div class="form-actions"><button class="btn btn-primary">✚ Post thread</button> <a class="btn" href="#/forums/' + f.id + '">Cancel</a></div></div></form>';
    return { title: 'Post thread', html, activity: 'Posting a new thread' };
  }

  /* ---------- members ---------- */

  function memberList(users, statFn, statLabel) {
    return '<div class="member-list">' + users.map((m) => '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '<div class="small muted">' + userTitle(m) + (m.location ? ' · ' + esc(m.location) : '') + '</div></div>' + (statFn ? '<div class="member-stat"><b>' + num(statFn(m)) + '</b><div class="small muted">' + statLabel + '</div></div>' : '') + '</div>').join('') + '</div>';
  }

  function members([tab], q) {
    tab = tab || 'notable';
    const all = db().users.filter((u) => !u.banned || store.isStaff(me()));
    const stats = new Map(all.map((u) => [u.id, store.userStats(u)]));
    const tabs = [['notable', 'Notable members'], ['list', 'Registered members'], ['staff', 'Staff members'], ['online', 'Current visitors']];
    let body = '';
    if (tab === 'notable') {
      const top = (fn) => all.slice().sort((a, b) => fn(b) - fn(a)).slice(0, 8);
      body = '<div class="grid-2">' +
        '<section class="block"><h3 class="block-head">Most messages</h3><div class="block-body">' + memberList(top((u) => stats.get(u.id).posts), (u) => stats.get(u.id).posts, 'Messages') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Highest reaction score</h3><div class="block-body">' + memberList(top((u) => stats.get(u.id).score), (u) => stats.get(u.id).score, 'Reactions') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Most points</h3><div class="block-body">' + memberList(top((u) => stats.get(u.id).points), (u) => stats.get(u.id).points, 'Points') + '</div></section>' +
        '<section class="block"><h3 class="block-head">Newest members</h3><div class="block-body">' + memberList(all.slice().sort((a, b) => b.joined - a.joined).slice(0, 8), null) + '</div></section>' +
        '</div>';
      const today = new Date();
      const bdays = all.filter((u) => { if (!u.birthday) return false; const d = new Date(u.birthday); return d.getMonth() === today.getMonth() && d.getDate() === today.getDate(); });
      if (bdays.length) body += '<section class="block"><h3 class="block-head">🎂 Today\'s birthdays</h3><div class="block-body">' + memberList(bdays) + '</div></section>';
    } else if (tab === 'list') {
      const sort = q.get('sort') || 'joined';
      const key = { joined: (u) => u.joined, messages: (u) => stats.get(u.id).posts, reactions: (u) => stats.get(u.id).score, name: (u) => u.username.toLowerCase() }[sort];
      const list = all.slice().sort((a, b) => (sort === 'name' ? (key(a) < key(b) ? -1 : 1) : key(b) - key(a)));
      body = '<div class="filter-bar">Sort by: ' + [['joined', 'Newest'], ['messages', 'Messages'], ['reactions', 'Reactions'], ['name', 'Name']].map(([k, l]) => '<a class="btn btn-sm' + (k === sort ? ' btn-primary' : '') + '" href="#/members/list?sort=' + k + '">' + l + '</a>').join(' ') + '</div>' +
        '<section class="block"><div class="block-body">' + memberList(list, (u) => stats.get(u.id).posts, 'Messages') + '</div></section>';
    } else if (tab === 'staff') {
      body = '<section class="block"><h3 class="block-head">Administrators</h3><div class="block-body">' + memberList(all.filter((u) => u.role === 'admin')) + '</div></section>' +
        '<section class="block"><h3 class="block-head">Moderators</h3><div class="block-body">' + memberList(all.filter((u) => u.role === 'mod')) + '</div></section>';
    } else if (tab === 'online') {
      return online();
    }
    const html = '<div class="page-head"><h1>Members</h1><form class="find-member" data-form="find-member"><input name="name" placeholder="Find member…" list="member-names" autocomplete="off"><datalist id="member-names">' + all.map((u) => '<option value="' + esc(u.username) + '">').join('') + '</datalist><button class="btn btn-sm">Go</button></form></div>' +
      '<nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/members/' + k + '">' + l + '</a>').join('') + '</nav>' + body;
    return { title: 'Members', html, sidebar: widgetOnline() + widgetStats(), activity: 'Viewing member list' };
  }

  function online() {
    const list = db().users.filter((u) => Date.now() - u.lastSeen < 60 * PP.MIN && u.settings.showOnline !== false).sort((a, b) => b.lastSeen - a.lastSeen);
    const html = '<div class="page-head"><h1>Current visitors</h1><p class="muted">Members active in the last hour.</p></div>' +
      '<nav class="tabs"><a class="tab" href="#/members/notable">Notable members</a><a class="tab" href="#/members/list">Registered members</a><a class="tab" href="#/members/staff">Staff members</a><a class="tab active" href="#/online">Current visitors</a></nav>' +
      '<section class="block"><div class="block-body">' + (list.length ? '<div class="member-list">' + list.map((m) => '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '<div class="small muted">' + esc(m.activity || 'Browsing') + ' · ' + time(m.lastSeen) + '</div></div></div>').join('') + '</div>' : '<div class="empty">Nobody has been active in the last hour.</div>') + '</div></section>';
    return { title: 'Current visitors', html, sidebar: widgetStats(), activity: 'Viewing list of online members' };
  }

  /* ---------- member profile ---------- */

  function activityItems(filterFn, limit) {
    const items = [];
    db().threads.forEach((t) => {
      store.postsIn(t.id).forEach((p, i) => {
        if (p.deleted || !filterFn(p)) return;
        items.push({ created: p.created, html: avatar(store.user(p.authorId), 's') + '<div class="grow"><div>' + username(store.user(p.authorId)) + (i === 0 ? ' started the thread ' : ' replied to the thread ') + '<a href="#/threads/' + t.id + '/post-' + p.id + '">' + prefix(t.prefix) + esc(t.title) + '</a>.</div><div class="activity-snippet">' + esc(snippet(p.content, 220)) + '</div><div class="small muted">' + time(p.created) + ' · ' + esc(store.forum(t.forumId).title) + '</div></div>' });
      });
    });
    db().profilePosts.forEach((pp) => {
      if (!filterFn(pp)) return;
      items.push({ created: pp.created, html: avatar(store.user(pp.authorId), 's') + '<div class="grow"><div>' + username(store.user(pp.authorId)) + (pp.profileUserId === pp.authorId ? ' updated their status.' : ' wrote on ' + username(store.user(pp.profileUserId)) + '\'s profile.') + '</div><div class="activity-snippet">' + esc(snippet(pp.content, 220)) + '</div><div class="small muted">' + time(pp.created) + '</div></div>' });
    });
    return items.sort((a, b) => b.created - a.created).slice(0, limit || 30);
  }

  function profilePostHtml(pp, u) {
    const a = store.user(pp.authorId);
    const canDel = u && (u.id === pp.authorId || u.id === pp.profileUserId || store.isStaff(u));
    if (u && u.ignoring.includes(pp.authorId)) return '<div class="profile-post muted small">Ignored content.</div>';
    return '<div class="profile-post" id="pp-' + pp.id + '">' + avatar(a, 'm') + '<div class="grow"><div>' + username(a) + (pp.authorId !== pp.profileUserId ? ' › ' + username(store.user(pp.profileUserId)) : '') + '</div>' +
      '<div class="bbwrap">' + bbcode(pp.content) + '</div>' +
      '<div class="pp-footer small muted">' + time(pp.created) + ' ' + (u && u.id !== pp.authorId ? reactButton(pp, 'profile') : '') +
      (u ? '<button class="action" data-act="pp-comment-toggle" data-id="' + pp.id + '">Comment</button><button class="action" data-act="report" data-kind="profile_post" data-id="' + pp.id + '">Report</button>' : '') +
      (canDel ? '<button class="action" data-act="pp-delete" data-id="' + pp.id + '">Delete</button>' : '') + '</div>' + reactionSummary(pp, 'profile') +
      '<div class="pp-comments">' + pp.comments.map((c) => '<div class="pp-comment">' + avatar(store.user(c.authorId), 's') + '<div>' + username(store.user(c.authorId)) + ' <span class="bbwrap">' + bbcode(c.content) + '</span><div class="small muted">' + time(c.created) + '</div></div></div>').join('') +
      (u ? '<form class="pp-comment-form" data-form="pp-comment" data-id="' + pp.id + '" hidden><input name="content" placeholder="Write a comment…" required class="grow"><button class="btn btn-sm">Post</button></form>' : '') + '</div></div></div>';
  }

  function member([id, tab]) {
    const m = store.user(id);
    if (!m) return notFound('member');
    const u = me();
    const s = store.userStats(m);
    const staff = store.isStaff(u);
    const isMe = u && u.id === m.id;
    tab = tab || 'profile-posts';
    const following = u && u.following.includes(m.id);
    const ignoring = u && u.ignoring.includes(m.id);
    let head = '<section class="block profile-head"' + (m.banner ? ' style="--banner:url(' + esc(m.banner) + ')"' : '') + '><div class="profile-banner"></div><div class="profile-head-body">' + avatar(m, 'xl') +
      '<div class="grow"><h1>' + esc(m.username) + (m.banned ? ' <span class="badge badge--red">Banned</span>' : '') + '</h1><div class="muted">' + userTitle(m) + '</div>' + ui.roleBanner(m) +
      '<div class="small muted">' + (m.location ? '📍 ' + esc(m.location) + ' · ' : '') + 'Joined ' + fullDate(m.joined) + ' · ' + (store.isOnline(m) ? '<span class="online-dot"></span> Online now' : 'Last seen ' + timeAgo(m.lastSeen)) + '</div>' +
      '<dl class="pairs pairs--row"><div><dt>Messages</dt><dd>' + num(s.posts) + '</dd></div><div><dt>Reaction score</dt><dd>' + num(s.score) + '</dd></div><div><dt>Points</dt><dd><a href="#/members/' + m.id + '/trophies">' + s.points + '</a></dd></div><div><dt>Followers</dt><dd><a href="#/members/' + m.id + '/followers">' + m.followers.length + '</a></dd></div></dl></div>' +
      '<div class="profile-actions">' +
      (isMe ? '<a class="btn" href="#/account/personal">Edit profile</a>' : '') +
      (u && !isMe ? '<button class="btn btn-primary" data-act="follow" data-id="' + m.id + '">' + (following ? 'Unfollow' : 'Follow') + '</button>' +
        (store.canDM(u, m) ? '<a class="btn" href="#/conversations/new?to=' + encodeURIComponent(m.username) + '">✉ Start conversation</a>' : '') +
        '<span class="menu-wrap"><button class="btn" data-menu="profile-more">⋯</button><div class="menu" data-menu-body="profile-more">' +
        (!store.isStaff(m) ? '<button data-act="ignore" data-id="' + m.id + '">' + (ignoring ? 'Unignore' : 'Ignore') + '</button>' : '') +
        '<button data-act="report" data-kind="user" data-id="' + m.id + '">Report</button>' +
        '<a href="#/search?m=' + encodeURIComponent(m.username) + '">Find content</a>' +
        (staff ? '<button data-act="warn" data-id="' + m.id + '">Warn</button>' + (m.role !== 'admin' ? '<button data-act="ban" data-id="' + m.id + '" class="danger">' + (m.banned ? 'Lift ban' : 'Ban') + '</button>' : '') : '') +
        (u.role === 'admin' ? '<button data-act="set-role" data-id="' + m.id + '">Change user group</button>' : '') +
        '</div></span>' : '') +
      '</div></div></section>';
    const tabs = [['profile-posts', 'Profile posts'], ['activity', 'Latest activity'], ['postings', 'Postings'], ['about', 'About'], ['trophies', 'Trophies'], ['followers', 'Followers'], ['following', 'Following']];
    if (staff) tabs.push(['warnings', 'Warnings']);
    head += '<nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/members/' + m.id + '/' + k + '">' + l + '</a>').join('') + '</nav>';
    let body = '';
    if (tab === 'profile-posts') {
      const pps = db().profilePosts.filter((p) => p.profileUserId === m.id).sort((a, b) => b.created - a.created);
      const canPost = u && !m.ignoring.includes(u.id) && (isMe || m.settings.allowProfilePosts === 'everyone' || (m.settings.allowProfilePosts === 'followed' && m.following.includes(u.id)));
      body = (canPost ? '<form class="block form pp-new" data-form="pp-new" data-id="' + m.id + '"><div class="block-body">' + avatar(u, 'm') + '<textarea name="content" rows="2" placeholder="' + (isMe ? 'Update your status…' : 'Write something…') + '" required class="grow"></textarea><button class="btn btn-primary">Post</button></div></form>' : '') +
        '<section class="block"><div class="block-body">' + (pps.length ? pps.map((p) => profilePostHtml(p, u)).join('') : '<div class="empty">There are no messages on ' + esc(m.username) + '\'s profile yet.</div>') + '</div></section>';
    } else if (tab === 'activity') {
      const items = activityItems((p) => p.authorId === m.id);
      body = '<section class="block"><div class="block-body">' + (items.length ? items.map((i) => '<div class="activity-item">' + i.html + '</div>').join('') : '<div class="empty">No activity yet.</div>') + '</div></section>';
    } else if (tab === 'postings') {
      const items = activityItems((p) => p.authorId === m.id && p.threadId);
      body = '<section class="block"><div class="block-body">' + (items.length ? items.map((i) => '<div class="activity-item">' + i.html + '</div>').join('') : '<div class="empty">' + esc(m.username) + ' has not posted any content yet.</div>') + '</div></section>' +
        '<p><a class="btn" href="#/search?m=' + encodeURIComponent(m.username) + '">Find all content by ' + esc(m.username) + '</a> <a class="btn" href="#/search?m=' + encodeURIComponent(m.username) + '&t=thread">Find all threads by ' + esc(m.username) + '</a></p>';
    } else if (tab === 'about') {
      body = '<section class="block"><div class="block-body">' + (m.bio ? '<div class="bbwrap">' + bbcode(m.bio) + '</div>' : '<p class="muted">No bio yet.</p>') +
        '<dl class="pairs">' + (m.birthday ? '<div><dt>Birthday</dt><dd>' + esc(new Date(m.birthday).toLocaleDateString([], { month: 'long', day: 'numeric' })) + '</dd></div>' : '') + (m.website && PP.safeUrl(m.website) ? '<div><dt>Website</dt><dd><a href="' + esc(m.website) + '" target="_blank" rel="noopener nofollow">' + esc(m.website) + '</a></dd></div>' : '') + (m.location ? '<div><dt>Location</dt><dd>' + esc(m.location) + '</dd></div>' : '') + '<div><dt>Threads started</dt><dd>' + s.threads + '</dd></div><div><dt>Rank</dt><dd>' + s.rank + '</dd></div></dl>' +
        (m.signature ? '<h4>Signature</h4><div class="bbwrap">' + bbcode(m.signature) + '</div>' : '') +
        '<h4>Following</h4><div class="avatar-row">' + m.following.map((id) => avatar(store.user(id), 's')).join('') + (m.following.length ? '' : '<span class="muted">Nobody yet</span>') + '</div>' +
        '<h4>Followers</h4><div class="avatar-row">' + m.followers.map((id) => avatar(store.user(id), 's')).join('') + (m.followers.length ? '' : '<span class="muted">Nobody yet</span>') + '</div></div></section>';
    } else if (tab === 'trophies') {
      body = '<section class="block"><div class="block-body">' + (s.trophies.length ? s.trophies.map((t) => '<div class="trophy"><div class="trophy-points">' + t.points + '</div><div><b>' + esc(t.title) + '</b><div class="small muted">' + esc(t.desc) + '</div></div></div>').join('') : '<div class="empty">No trophies yet.</div>') + '</div></section>';
    } else if (tab === 'followers' || tab === 'following') {
      const list = m[tab].map((x) => store.user(x)).filter(Boolean);
      body = '<section class="block"><div class="block-body">' + (list.length ? memberList(list) : '<div class="empty">Nobody here yet.</div>') + '</div></section>';
    } else if (tab === 'warnings' && staff) {
      const ws = m.warnings || [];
      body = '<section class="block"><div class="block-body">' + (ws.length ? ws.map((w) => '<div class="activity-item"><div><b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">by ' + username(store.user(w.by)) + ' · ' + time(w.created) + '</div></div></div>').join('') : '<div class="empty">No warnings.</div>') + '</div></section>';
    }
    return { title: m.username, html: head + body, activity: 'Viewing member profile ' + m.username };
  }

  /* ---------- login / register ---------- */

  function login(_, q) {
    const ret = q.get('return') || '#/';
    const demo = db().users.filter((u) => !u.passHash && !u.banned).slice(0, 8);
    const html = '<div class="auth-wrap"><form class="block form" data-form="login" data-return="' + esc(ret) + '"><h2 class="block-head">Log in</h2><div class="block-body">' +
      '<label class="field"><span>Your name or email address</span><input name="name" autocomplete="username" required></label>' +
      '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>' +
      '<label class="check"><input type="checkbox" name="stay" checked> Stay logged in</label>' +
      '<div class="form-actions"><button class="btn btn-primary">Log in</button> <a href="#/lost-password" class="small">Forgot your password?</a></div>' +
      '<p class="small">Don\'t have an account? <a href="#/register">Register now</a></p></div></form>' +
      '<section class="block"><h3 class="block-head">Try a demo account</h3><div class="block-body"><p class="small muted">Explore as one of the sample members (no password):</p><div class="demo-users">' +
      demo.map((u) => '<button class="demo-user" data-act="login-as" data-id="' + u.id + '" data-return="' + esc(ret) + '">' + avatar(u, 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') + ' ' + esc(u.username) + ' <span class="small muted">' + (u.role !== 'member' ? u.role : '') + '</span></button>').join('') + '</div></div></section></div>';
    return { title: 'Log in', html, activity: 'Logging in' };
  }

  function register() {
    const html = '<div class="auth-wrap"><form class="block form" data-form="register"><h2 class="block-head">Register</h2><div class="block-body">' +
      '<label class="field"><span>User name</span><input name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-]+" autocomplete="username"><small class="muted">This is the name that will be shown with your messages. 3-24 characters.</small></label>' +
      '<label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>' +
      '<label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label class="field"><span>Date of birth</span><input name="birthday" type="date" required></label>' +
      '<label class="check"><input type="checkbox" name="agree" required> I agree to the <a href="#/help/terms">terms</a>, <a href="#/help/rules">rules</a> and <a href="#/help/privacy">privacy policy</a>.</label>' +
      '<div class="form-actions"><button class="btn btn-primary">Register</button></div>' +
      '<p class="small muted">PinkPill is an 18+ community. Accounts are stored in this browser only (see <a href="#/help/faq">FAQ</a>).</p></div></form></div>';
    return { title: 'Register', html, activity: 'Registering' };
  }

  function lostPassword() {
    return { title: 'Lost password', html: '<div class="auth-wrap"><section class="block"><h2 class="block-head">Lost password</h2><div class="block-body"><p>This version of PinkPill stores accounts in your browser, so there\'s no email server to send a reset link.</p><p>If you\'re still logged in on another tab, you can change your password in <a href="#/account/security">Account → Password &amp; security</a>. Otherwise ask an administrator to help you recover your account.</p></div></section></div>' };
  }

  /* ---------- account ---------- */

  function account([tab]) {
    const u = me();
    if (!u) return loginRequired();
    tab = tab || 'details';
    const tabs = [['details', 'Account details'], ['personal', 'Personal details'], ['security', 'Password & security'], ['privacy', 'Privacy'], ['preferences', 'Preferences'], ['signature', 'Signature'], ['following', 'Following'], ['ignoring', 'Ignoring'], ['bookmarks', 'Bookmarks'], ['watched', 'Watched threads'], ['warnings', 'Warnings'], ['data', 'Your data']];
    let body = '';
    if (tab === 'details') {
      body = '<form class="block form" data-form="account-details"><div class="block-body"><dl class="pairs"><div><dt>User name</dt><dd>' + esc(u.username) + '</dd></div><div><dt>Joined</dt><dd>' + fullDate(u.joined) + '</dd></div></dl>' +
        '<label class="field"><span>Email</span><input name="email" type="email" value="' + esc(u.email) + '" required></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'personal') {
      body = '<form class="block form" data-form="account-personal"><div class="block-body">' +
        '<div class="avatar-editor">' + avatar(u, 'xl') + '<div><label class="btn">Upload avatar<input type="file" accept="image/*" name="avatar_file" hidden></label> ' + (u.avatar ? '<button type="button" class="btn" data-act="remove-avatar">Remove</button>' : '') +
        '<label class="field"><span>Letter avatar colour</span><input type="color" name="color" value="' + esc(u.color) + '"></label></div></div>' +
        '<div class="field"><span>Profile banner</span><label class="btn btn-sm">Upload banner<input type="file" accept="image/*" name="banner_file" hidden></label>' + (u.banner ? ' <button type="button" class="btn btn-sm" data-act="remove-banner">Remove banner</button>' : '') + '</div>' +
        '<label class="field"><span>Custom title</span><input name="customTitle" maxlength="50" value="' + esc(u.customTitle) + '" placeholder="' + esc(store.userStats(u).rank) + '"></label>' +
        '<label class="field"><span>Location</span><input name="location" maxlength="50" value="' + esc(u.location) + '"></label>' +
        '<label class="field"><span>Website</span><input name="website" type="url" value="' + esc(u.website) + '" placeholder="https://"></label>' +
        '<label class="field"><span>Date of birth</span><input name="birthday" type="date" value="' + esc(u.birthday) + '"></label>' +
        '<label class="field"><span>About you</span>' + editor('bio', u.bio, { rows: 5 }) + '</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'signature') {
      body = '<form class="block form" data-form="account-signature"><div class="block-body">' + editor('signature', u.signature, { rows: 4 }) + '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'security') {
      body = '<form class="block form" data-form="account-password"><div class="block-body">' +
        (u.passHash ? '<label class="field"><span>Current password</span><input name="old" type="password" required autocomplete="current-password"></label>' : '<p class="small muted">This demo account has no password yet. Set one to log in normally.</p>') +
        '<label class="field"><span>New password</span><input name="new" type="password" required minlength="8" autocomplete="new-password"></label>' +
        '<label class="field"><span>Confirm new password</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'privacy') {
      const opt = (name, val) => '<select name="' + name + '">' + [['everyone', 'All members'], ['followed', 'People you follow'], ['none', 'Nobody']].map(([v, l]) => '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
      body = '<form class="block form" data-form="account-privacy"><div class="block-body">' +
        '<label class="check"><input type="checkbox" name="showOnline"' + (u.settings.showOnline !== false ? ' checked' : '') + '> Show your online status</label>' +
        '<label class="field"><span>Who can start conversations with you</span>' + opt('allowDMs', u.settings.allowDMs) + '</label>' +
        '<label class="field"><span>Who can post on your profile</span>' + opt('allowProfilePosts', u.settings.allowProfilePosts) + '</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'preferences') {
      body = '<form class="block form" data-form="account-prefs"><div class="block-body">' +
        '<label class="field"><span>Style</span><select name="theme">' + [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => '<option value="' + v + '"' + (v === u.settings.theme ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
        '<label class="check"><input type="checkbox" name="showSignatures"' + (u.settings.showSignatures !== false ? ' checked' : '') + '> Show people\'s signatures with their messages</label>' +
        '<label class="check"><input type="checkbox" name="autoWatch"' + (u.settings.autoWatch !== false ? ' checked' : '') + '> Automatically watch threads you create or reply to</label>' +
        '<label class="check"><input type="checkbox" name="desktopAlerts"' + (u.settings.desktopAlerts ? ' checked' : '') + '> Show browser notifications for new alerts</label>' +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></div></form>';
    } else if (tab === 'following' || tab === 'ignoring') {
      const list = u[tab].map((x) => store.user(x)).filter(Boolean);
      body = '<section class="block"><div class="block-body">' + (list.length ? '<div class="member-list">' + list.map((m) => '<div class="member-row">' + avatar(m, 'm') + '<div class="grow">' + username(m) + '</div><button class="btn btn-sm" data-act="' + (tab === 'following' ? 'follow' : 'ignore') + '" data-id="' + m.id + '">' + (tab === 'following' ? 'Unfollow' : 'Unignore') + '</button></div>').join('') + '</div>' : '<div class="empty">You\'re not ' + tab + ' anyone.</div>') + '</div></section>';
    } else if (tab === 'bookmarks') {
      const items = u.bookmarks.map((id) => store.post(id)).filter(Boolean).reverse();
      body = '<section class="block"><div class="block-body">' + (items.length ? items.map((p) => { const t = store.thread(p.threadId); return '<div class="activity-item">' + avatar(store.user(p.authorId), 's') + '<div class="grow"><a href="#/threads/' + t.id + '/post-' + p.id + '">' + esc(t.title) + '</a><div class="activity-snippet">' + esc(snippet(p.content, 200)) + '</div><div class="small muted">' + username(store.user(p.authorId)) + ' · ' + time(p.created) + '</div></div><button class="btn btn-sm" data-act="bookmark" data-id="' + p.id + '">Remove</button></div>'; }).join('') : '<div class="empty">You haven\'t bookmarked anything yet. Use 📑 on any post.</div>') + '</div></section>';
    } else if (tab === 'watched') {
      const ts = u.watched.map((id) => store.thread(id)).filter(Boolean);
      body = '<section class="block">' + (ts.length ? ts.map((t) => '<div class="watched-row">' + threadRow(t, u) + '<button class="btn btn-sm" data-act="watch-thread" data-id="' + t.id + '">Unwatch</button></div>').join('') : '<div class="empty">You aren\'t watching any threads.</div>') + '</section>';
    } else if (tab === 'warnings') {
      const ws = u.warnings || [];
      body = '<section class="block"><div class="block-body">' + (ws.length ? ws.map((w) => '<div class="activity-item"><div><b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">' + time(w.created) + '</div></div></div>').join('') : '<div class="empty">You have no warnings. 💗</div>') + '</div></section>';
    } else if (tab === 'data') {
      body = '<section class="block"><div class="block-body"><p>Download a copy of the content you\'ve posted.</p><button class="btn" data-act="export-mine">Download my data</button>' +
        '<hr><p>Deleting your account removes your profile. Your posts will be shown as “Deleted member”.</p><button class="btn btn-danger" data-act="delete-account">Delete my account</button></div></section>';
    }
    const html = '<div class="page-head"><h1>Your account</h1></div><div class="account-layout"><nav class="side-nav">' + tabs.map(([k, l]) => '<a class="' + (k === tab ? 'active' : '') + '" href="#/account/' + k + '">' + l + '</a>').join('') + '<a href="#/alerts">Alerts</a><a href="#/conversations">Conversations</a><a href="#/members/' + u.id + '">Your profile</a><button data-act="logout" class="link">Log out</button></nav><div class="grow">' + body + '</div></div>';
    return { title: 'Your account', html, activity: 'Managing account' };
  }

  /* ---------- alerts ---------- */

  function alertIcon(t) { return { reply: '💬', mention: '@', quote: '❝', reaction: '💖', follow: '➕', 'follow-thread': '🧵', trophy: '🏆', conversation: '✉', 'profile-post': '📝', 'profile-comment': '💭', report: '🚩', 'report-resolved': '✅', warning: '⚠', welcome: '🌸' }[t] || '🔔'; }

  function alertRow(a) {
    const from = a.fromId && store.user(a.fromId);
    return '<a class="alert-row' + (a.read ? '' : ' unread') + '" href="' + esc(a.link || '#/alerts') + '">' + (from ? avatar(from, 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') : '<span class="avatar avatar-s alert-icon">' + alertIcon(a.type) + '</span>') + '<span class="grow"><span>' + esc(a.text) + '</span><span class="small muted block">' + esc(timeAgo(a.created)) + '</span></span></a>';
  }

  function alerts() {
    const u = me();
    if (!u) return loginRequired();
    const list = store.alertsFor(u);
    const html = '<div class="page-head"><h1>Alerts</h1><div class="head-actions"><button class="btn" data-act="alerts-read-all">Mark all read</button> <a class="btn" href="#/account/preferences">Preferences</a></div></div><section class="block"><div class="block-body alerts-list">' + (list.length ? list.map(alertRow).join('') : '<div class="empty">You have no alerts.</div>') + '</div></section>';
    return { title: 'Alerts', html, activity: 'Viewing alerts', after: () => { setTimeout(() => store.markAlertsRead(u), 1500); } };
  }

  /* ---------- conversations ---------- */

  function conversations(_, q) {
    const u = me();
    if (!u) return loginRequired();
    const filter = q.get('filter') || '';
    let list = store.conversationsFor(u);
    if (filter === 'unread') list = list.filter((c) => store.isUnread(c, u));
    if (filter === 'starred') list = list.filter((c) => (c.starred || []).includes(u.id));
    if (filter === 'started') list = list.filter((c) => c.starterId === u.id);
    const html = '<div class="page-head"><h1>Conversations</h1><div class="head-actions"><a class="btn btn-primary" href="#/conversations/new">✚ Start conversation</a></div></div>' +
      '<nav class="tabs">' + [['', 'All'], ['unread', 'Unread'], ['starred', 'Starred'], ['started', 'Started by you']].map(([k, l]) => '<a class="tab' + (k === filter ? ' active' : '') + '" href="#/conversations' + (k ? '?filter=' + k : '') + '">' + l + '</a>').join('') + '</nav>' +
      '<section class="block">' + (list.length ? list.map((c) => {
        const last = c.messages[c.messages.length - 1];
        const others = c.participants.filter((x) => x !== u.id).map((x) => store.user(x)).filter(Boolean);
        return '<div class="thread-row' + (store.isUnread(c, u) ? ' thread-row--unread' : '') + '"><div class="thread-avatar">' + avatar(store.user(c.starterId), 'm') + '</div><div class="thread-main"><div class="thread-title">' + ((c.starred || []).includes(u.id) ? '⭐ ' : '') + '<a href="#/conversations/' + c.id + '">' + esc(c.title) + '</a></div><div class="small muted">' + others.map((o) => username(o)).join(', ') + '</div></div><dl class="thread-stats"><div><dt>Replies</dt><dd>' + (c.messages.length - 1) + '</dd></div><div><dt>Participants</dt><dd>' + c.participants.length + '</dd></div></dl><div class="thread-last"><div class="small">' + time(last.created) + '</div><div class="small">' + username(store.user(last.authorId)) + '</div></div></div>';
      }).join('') : '<div class="empty">You have no conversations' + (filter ? ' matching this filter' : '') + '.</div>') + '</section>';
    return { title: 'Conversations', html, activity: 'Viewing conversations' };
  }

  function conversationNew(_, q) {
    const u = me();
    if (!u) return loginRequired();
    const html = breadcrumb([['#/conversations', 'Conversations'], ['', 'Start conversation']]) + '<div class="page-head"><h1>Start conversation</h1></div>' +
      '<form class="block form" data-form="conv-new" data-draft="conv-new"><div class="block-body">' +
      '<label class="field"><span>Recipients</span><input name="to" value="' + esc(q.get('to') || '') + '" placeholder="Separate names with a comma" list="member-names-dm" required autocomplete="off"><datalist id="member-names-dm">' + db().users.filter((x) => x.id !== u.id).map((x) => '<option value="' + esc(x.username) + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>Title</span><input name="title" maxlength="100" required></label>' + editor('content', '', { rows: 8, required: true }) +
      '<label class="check"><input type="checkbox" name="allowInvite"> Allow anyone in the conversation to invite others</label>' +
      '<div class="form-actions"><button class="btn btn-primary">Start conversation</button></div></div></form>';
    return { title: 'Start conversation', html, activity: 'Starting a conversation' };
  }

  function conversation([id]) {
    const u = me();
    if (!u) return loginRequired();
    const c = db().conversations.find((x) => x.id === id);
    if (!c || !c.participants.includes(u.id)) return notFound('conversation');
    store.markConvRead(u, c);
    const people = c.participants.map((x) => store.user(x)).filter(Boolean);
    const html = breadcrumb([['#/conversations', 'Conversations'], ['', c.title]]) +
      '<div class="page-head"><h1>' + esc(c.title) + '</h1><div class="small muted">Started by ' + username(store.user(c.starterId)) + ' · ' + time(c.messages[0].created) + '</div>' +
      '<div class="head-actions"><button class="btn" data-act="conv-star" data-id="' + c.id + '">' + ((c.starred || []).includes(u.id) ? '★ Unstar' : '☆ Star') + '</button> ' +
      (c.starterId === u.id || c.allowInvite ? '<button class="btn" data-act="conv-invite" data-id="' + c.id + '">Invite members</button> ' : '') +
      '<button class="btn" data-act="conv-leave" data-id="' + c.id + '">Leave conversation</button></div></div>' +
      '<div class="messages">' + c.messages.map((m, i) => '<article class="message" id="msg-' + m.id + '">' + authorPanel(store.user(m.authorId)) + '<div class="message-main"><header class="message-attribution"><span class="muted small">' + time(m.created) + '</span><span class="message-attribution-opposite small muted">#' + (i + 1) + '</span></header><div class="message-content bbwrap">' + bbcode(m.content) + '</div><footer class="message-footer"><div class="message-actions"><button class="action" data-act="report" data-kind="message" data-id="' + m.id + '">Report</button></div><div class="message-actions"><button class="action" data-act="conv-quote" data-conv="' + c.id + '" data-id="' + m.id + '">Reply</button></div></footer></div></article>').join('') + '</div>' +
      '<section class="block quick-reply"><div class="quick-reply-inner">' + avatar(u, 'm') + '<form class="grow" data-form="conv-reply" data-id="' + c.id + '" data-draft="conv-' + c.id + '">' + editor('content', '', { rows: 4 }) + '<div class="form-actions"><button class="btn btn-primary">↩ Reply</button></div></form></div></section>';
    const sidebar = '<section class="block"><h3 class="block-head">Participants</h3><div class="block-body">' + people.map((p) => '<div class="mini-user">' + avatar(p, 's') + '<div>' + username(p) + ((c.left || []).includes(p.id) ? ' <span class="small muted">(left)</span>' : '') + '<div class="small muted">' + userTitle(p) + '</div></div></div>').join('') + '</div></section>';
    return { title: c.title, html, sidebar, activity: 'Viewing a conversation' };
  }

  /* ---------- search ---------- */

  function resultRow(r) {
    if (r.kind === 'profile_post') {
      const pp = r.profilePost;
      return '<div class="activity-item">' + avatar(store.user(pp.authorId), 's') + '<div class="grow"><a href="#/members/' + pp.profileUserId + '">Profile post by ' + esc((store.user(pp.authorId) || {}).username) + '</a><div class="activity-snippet">' + esc(snippet(pp.content, 240)) + '</div><div class="small muted">Profile post · ' + time(pp.created) + '</div></div></div>';
    }
    const t = r.thread, p = r.post;
    return '<div class="activity-item">' + avatar(store.user(p.authorId), 's') + '<div class="grow"><a href="#/threads/' + t.id + '/post-' + p.id + '">' + prefix(t.prefix) + esc(t.title) + '</a><div class="activity-snippet">' + esc(snippet(p.content, 240)) + '</div><div class="small muted">' + username(store.user(p.authorId)) + ' · ' + (r.kind === 'thread' ? 'Thread' : 'Post #' + (store.postsIn(t.id).indexOf(p) + 1)) + ' · ' + time(p.created) + ' · Forum: <a href="#/forums/' + t.forumId + '">' + esc(store.forum(t.forumId).title) + '</a></div></div></div>';
  }

  function search(_, q) {
    const kw = q.get('q') || '', t = q.get('t') || '', m = q.get('m') || '', f = q.get('f') || '', titles = q.get('titles') === '1', o = q.get('o') || 'date';
    const searched = kw || m;
    const results = searched ? store.search({ q: kw, type: t, member: m, forumId: f, titlesOnly: titles, order: o }) : [];
    const html = '<div class="page-head"><h1>' + (searched ? 'Search results' + (kw ? ' for query: ' + esc(kw) : '') + (m ? ' by member: ' + esc(m) : '') : 'Search') + '</h1></div>' +
      '<form class="block form search-form" data-form="search"><div class="block-body">' +
      '<label class="field"><span>Keywords</span><input name="q" value="' + esc(kw) + '" autofocus></label>' +
      '<label class="check"><input type="checkbox" name="titles" value="1"' + (titles ? ' checked' : '') + '> Search titles only</label>' +
      '<div class="row wrap"><label class="field"><span>Posted by member</span><input name="m" value="' + esc(m) + '" list="member-names-s"><datalist id="member-names-s">' + db().users.map((u) => '<option value="' + esc(u.username) + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>Search in</span><select name="t">' + [['', 'Everything'], ['thread', 'Threads'], ['post', 'Posts'], ['profile_post', 'Profile posts']].map(([v, l]) => '<option value="' + v + '"' + (v === t ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Forum</span><select name="f"><option value="">All forums</option>' + db().forums.map((x) => '<option value="' + x.id + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Order by</span><select name="o"><option value="date"' + (o === 'date' ? ' selected' : '') + '>Date</option><option value="relevance"' + (o === 'relevance' ? ' selected' : '') + '>Relevance</option></select></label></div>' +
      '<div class="form-actions"><button class="btn btn-primary">🔍 Search</button></div></div></form>' +
      (searched ? '<section class="block"><h3 class="block-head">' + results.length + ' result' + (results.length === 1 ? '' : 's') + '</h3><div class="block-body">' + (results.length ? results.map(resultRow).join('') : '<div class="empty">No results found.</div>') + '</div></section>' : '');
    return { title: 'Search', html, activity: 'Searching' };
  }

  function tag([t]) {
    t = decodeURIComponent(t);
    const ts = db().threads.filter((x) => x.tags.includes(t)).sort((a, b) => b.created - a.created);
    const all = {};
    db().threads.forEach((x) => x.tags.forEach((g) => { all[g] = (all[g] || 0) + 1; }));
    const html = '<div class="page-head"><h1>Tag: ' + esc(t) + '</h1></div><section class="block">' + (ts.length ? ts.map((x) => threadRow(x, me())).join('') : '<div class="empty">No content with this tag.</div>') + '</section>';
    const sidebar = '<section class="block"><h3 class="block-head">Popular tags</h3><div class="block-body tags">' + Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([g, n]) => '<a class="tag" href="#/tags/' + encodeURIComponent(g) + '">' + esc(g) + ' <small>' + n + '</small></a>').join('') + '</div></section>';
    return { title: 'Tag: ' + t, html, sidebar };
  }

  /* ---------- what's new ---------- */

  function whatsNew([tab], q) {
    tab = tab || 'posts';
    const u = me();
    const tabs = [['posts', 'New posts'], ['profile-posts', 'New profile posts'], ['activity', 'Latest activity']];
    if (u) tabs.push(['feed', 'Your news feed']);
    let body = '';
    if (tab === 'posts') {
      const unread = q.get('unread') && u, watched = q.get('watched') && u;
      let ts = db().threads.map((t) => ({ t, lp: store.lastPost(t.id) })).filter((x) => x.lp && x.lp.created > Date.now() - 60 * PP.DAY);
      if (unread) ts = ts.filter((x) => threadUnread(x.t, u));
      if (watched) ts = ts.filter((x) => u.watched.includes(x.t.id));
      if (u) ts = ts.filter((x) => !u.ignoring.includes(x.t.authorId));
      ts.sort((a, b) => b.lp.created - a.lp.created);
      body = (u ? '<div class="filter-bar">Show only: <a class="btn btn-sm' + (unread ? ' btn-primary' : '') + '" href="#/whats-new/posts' + (unread ? '' : '?unread=1') + '">Unread</a> <a class="btn btn-sm' + (watched ? ' btn-primary' : '') + '" href="#/whats-new/posts' + (watched ? '' : '?watched=1') + '">Watched</a> <button class="btn btn-sm" data-act="mark-all-read">Mark all read</button></div>' : '') +
        '<section class="block">' + (ts.length ? ts.slice(0, 50).map((x) => threadRow(x.t, u).replace('<div class="thread-meta small muted">', '<div class="thread-meta small muted"><a href="#/forums/' + x.t.forumId + '">' + esc(store.forum(x.t.forumId).title) + '</a> · ')).join('') : '<div class="empty">No results found.</div>') + '</section>';
    } else if (tab === 'profile-posts') {
      const pps = db().profilePosts.slice().sort((a, b) => b.created - a.created);
      body = '<section class="block"><div class="block-body">' + (pps.length ? pps.map((p) => profilePostHtml(p, u)).join('') : '<div class="empty">No profile posts yet.</div>') + '</section>';
    } else if (tab === 'activity' || tab === 'feed') {
      const filter = tab === 'feed' ? (p) => u.following.includes(p.authorId) : () => true;
      const items = activityItems(filter, 40);
      body = '<section class="block"><div class="block-body">' + (items.length ? items.map((i) => '<div class="activity-item">' + i.html + '</div>').join('') : '<div class="empty">' + (tab === 'feed' ? 'Your news feed is empty. Follow members to see their activity here.' : 'No activity yet.') + '</div>') + '</div></section>';
    }
    const html = '<div class="page-head"><h1>What\'s new</h1></div><nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/whats-new/' + k + '">' + l + '</a>').join('') + '</nav>' + body;
    return { title: 'What\'s new', html, sidebar: widgetOnline() + widgetStats(), activity: 'Viewing latest content' };
  }

  /* ---------- help ---------- */

  function help([page]) {
    page = page || 'index';
    const pages = [['rules', 'Forum rules'], ['faq', 'FAQ'], ['bbcode', 'BB codes'], ['reactions', 'Reactions'], ['trophies', 'Trophies & ranks'], ['smilies', 'Smilies'], ['terms', 'Terms and rules'], ['privacy', 'Privacy policy'], ['cookies', 'Cookie usage'], ['resources', 'Support resources']];
    let body = '';
    const bbExamples = [['[b]Bold[/b]'], ['[i]Italic[/i]'], ['[u]Underline[/u]'], ['[s]Strike[/s]'], ['[color=#ec4899]Pink text[/color]'], ['[size=5]Big text[/size]'], ['[url=https://example.com]Link[/url]'], ['[img]https://via.placeholder.com/80[/img]'], ['[media]https://youtu.be/dQw4w9WgXcQ[/media]'], ['[quote=Aurora]Quoted text[/quote]'], ['[spoiler]Hidden text[/spoiler]'], ['[code]code block[/code]'], ['[list]\n[*]One\n[*]Two\n[/list]'], ['[center]Centered[/center]'], ['@Aurora (mention)']];
    const map = {
      index: '<div class="help-grid">' + pages.map(([k, l]) => '<a class="block help-card" href="#/help/' + k + '"><b>' + l + '</b></a>').join('') + '</div>',
      rules: '<ol class="rules">' +
        '<li><b>18+ only.</b> You must be an adult to join. Never post images of minors.</li>' +
        '<li><b>Be kind.</b> No bullying, harassment, slurs, body-shaming, or "it\'s over"/doomer posting at other members. Critique features constructively and only in opt-in threads.</li>' +
        '<li><b>No dangerous practices.</b> Pro-ED/thinspo/meanspo content, crash/dry-fasting advice, purging, bonesmashing, DIY injections (filler, botox), black-market drugs, skin-lightening with mercury/steroids are banned. Posts mentioning these are automatically flagged for moderators.</li>' +
        '<li><b>Medical claims need care.</b> Share experiences, cite sources, and recommend licensed professionals. No selling or promoting unregulated products.</li>' +
        '<li><b>Consent.</b> Only post photos of yourself. No rating celebrities\' or strangers\' photos, no screenshots of private people.</li>' +
        '<li><b>No hate.</b> No misogyny, misandry, racism, homophobia, transphobia or ideology wars.</li>' +
        '<li><b>No spam or self-promotion</b> without staff permission.</li>' +
        '<li><b>Crisis content.</b> If you\'re in crisis, please reach out to the <a href="#/help/resources">support resources</a>. Encouraging self-harm = permanent ban.</li>' +
        '<li><b>One account per person.</b> Ban evasion results in permanent bans.</li>' +
        '<li><b>Report, don\'t retaliate.</b> Use the Report button; moderators review everything.</li></ol>',
      faq: '<dl class="faq"><dt>What is PinkPill?</dt><dd>A looksmaxxing (appearance-improvement) community for women focused on evidence-based, safe and kind self-improvement.</dd>' +
        '<dt>Where is my data stored?</dt><dd>This version of PinkPill runs entirely in your browser. Accounts, posts and messages are saved in your browser\'s local storage, so they\'re only visible on this device. Admins can export/import the whole database from the Moderator panel. To make it a shared, multi-user forum, the data layer (<code>js/store.js</code>) can be connected to a hosted database.</dd>' +
        '<dt>How do alerts work?</dt><dd>You receive alerts when someone replies to a thread you watch, mentions you with @name, quotes you, reacts to your content, follows you, writes on your profile, or starts a conversation with you.</dd>' +
        '<dt>How do I get a rating?</dt><dd>Post in <a href="#/forums/f-rating">Rate Me &amp; Feedback</a> or tick "Enable community ratings" when creating a thread. Each member can rate once (1–10) alongside constructive feedback.</dd>' +
        '<dt>What are points and ranks?</dt><dd>You earn trophy points for milestones. Your rank is based on your message count. See <a href="#/help/trophies">Trophies</a>.</dd>' +
        '<dt>How do I ignore someone?</dt><dd>Open their profile → ⋯ → Ignore. Their posts are hidden and they can\'t message you or post on your profile.</dd>' +
        '<dt>Can I delete my account?</dt><dd>Yes: Account → Your data.</dd></dl>',
      bbcode: '<table class="table"><thead><tr><th>You type</th><th>You get</th></tr></thead><tbody>' + bbExamples.map(([e]) => '<tr><td><code>' + esc(e).replace(/\n/g, '<br>') + '</code></td><td class="bbwrap">' + bbcode(e) + '</td></tr>').join('') + '</tbody></table>',
      reactions: '<table class="table"><tbody>' + PP.REACTIONS.map((r) => '<tr><td style="font-size:1.6em">' + r.emoji + '</td><td><b>' + r.label + '</b></td><td class="muted">' + (r.score > 0 ? 'Adds +' + r.score + ' to reaction score' : 'Neutral') + '</td></tr>').join('') + '</tbody></table>',
      trophies: '<h3>Trophies</h3>' + PP.TROPHIES.map((t) => '<div class="trophy"><div class="trophy-points">' + t.points + '</div><div><b>' + esc(t.title) + '</b><div class="small muted">' + esc(t.desc) + '</div></div></div>').join('') +
        '<h3>Ranks</h3><table class="table"><tbody>' + PP.RANKS.map((r) => '<tr><td><b>' + r.title + '</b></td><td>' + r.min + '+ messages</td></tr>').join('') + '</tbody></table>',
      smilies: '<p>Use the 😊 button in the editor or type any emoji directly.</p><div class="smilies">' + '😀 😂 🥹 😊 😍 🥰 😘 😎 🤔 😮 😢 😭 😤 🙄 😴 🤗 🫶 💖 💕 💗 ✨ 🌸 🌷 💅 💄 💋 👑 💎 🔥 💯 👏 🙏 💪'.split(' ').map((e) => '<span>' + e + '</span>').join('') + '</div>',
      terms: '<p>By using PinkPill you agree to follow the <a href="#/help/rules">forum rules</a>. Content you post is your own responsibility. Staff may edit, move or remove content and suspend accounts that break the rules. Advice shared here is peer opinion, not medical advice — consult licensed professionals.</p>',
      privacy: '<p>This edition of PinkPill stores all data in your browser\'s local storage on your device. Nothing is sent to a server. Passwords are stored as salted SHA-256 hashes. Clearing your browser data deletes your account and posts from this device.</p>',
      cookies: '<p>PinkPill doesn\'t use tracking cookies. It uses local storage to remember your session, drafts, theme and forum data.</p>',
      resources: '<ul class="resources"><li><b>Emergency:</b> call your local emergency number</li><li><b>US:</b> 988 Suicide &amp; Crisis Lifeline — call or text 988</li><li><b>UK &amp; ROI:</b> Samaritans — 116 123</li><li><b>Eating disorders:</b> NEDA (US) · Beat (UK) 0808 801 0677 · Butterfly (AU) 1800 33 4673</li><li><b>Body dysmorphic disorder:</b> BDD Foundation — bddfoundation.org</li><li><b>Worldwide:</b> <a href="https://findahelpline.com" target="_blank" rel="noopener">findahelpline.com</a></li></ul>',
    };
    body = map[page] || map.index;
    const title = page === 'index' ? 'Help' : (pages.find((p) => p[0] === page) || [0, 'Help'])[1];
    const html = breadcrumb([['#/help', 'Help'], ['', title]]) + '<div class="page-head"><h1>' + esc(title) + '</h1></div><div class="account-layout"><nav class="side-nav">' + pages.map(([k, l]) => '<a class="' + (k === page ? 'active' : '') + '" href="#/help/' + k + '">' + l + '</a>').join('') + '</nav><section class="block grow"><div class="block-body help-body">' + body + '</div></section></div>';
    return { title, html, activity: 'Viewing help' };
  }

  /* ---------- moderator / admin ---------- */

  function mod([tab]) {
    const u = me();
    if (!store.isStaff(u)) return errorView('You do not have permission to view this page.');
    tab = tab || 'reports';
    const tabs = [['reports', 'Report queue'], ['members', 'Members'], ['banned', 'Banned members'], ['warnings', 'Warnings']];
    if (u.role === 'admin') tabs.push(['forums', 'Forums'], ['stats', 'Statistics'], ['data', 'Data']);
    let body = '';
    if (tab === 'reports') {
      const show = (location.hash.includes('resolved=1'));
      const rs = db().reports.filter((r) => r.resolved === show).sort((a, b) => b.created - a.created);
      body = '<div class="filter-bar"><a class="btn btn-sm' + (!show ? ' btn-primary' : '') + '" href="#/mod/reports">Open</a> <a class="btn btn-sm' + (show ? ' btn-primary' : '') + '" href="#/mod/reports?resolved=1">Resolved</a></div><section class="block"><div class="block-body">' + (rs.length ? rs.map((r) => {
        let target = '', link = '#/';
        if (r.kind === 'post') { const p = store.post(r.targetId); if (p) { link = '#/threads/' + p.threadId + '/post-' + p.id; target = 'Post by ' + username(store.user(p.authorId)) + ' in <a href="' + link + '">' + esc(store.thread(p.threadId).title) + '</a><div class="activity-snippet">' + esc(snippet(p.content, 300)) + '</div>'; } else target = '<span class="muted">Content deleted</span>'; }
        else if (r.kind === 'user') { const m = store.user(r.targetId); target = 'Member ' + username(m); }
        else if (r.kind === 'profile_post') { const pp = db().profilePosts.find((x) => x.id === r.targetId); target = pp ? 'Profile post by ' + username(store.user(pp.authorId)) + '<div class="activity-snippet">' + esc(snippet(pp.content, 300)) + '</div>' : '<span class="muted">Content deleted</span>'; }
        else if (r.kind === 'message') { let msg = null; db().conversations.forEach((c) => { const m = c.messages.find((x) => x.id === r.targetId); if (m) msg = m; }); target = msg ? 'Conversation message by ' + username(store.user(msg.authorId)) + '<div class="activity-snippet">' + esc(snippet(msg.content, 300)) + '</div>' : '<span class="muted">Content deleted</span>'; }
        return '<div class="report-row"><div class="grow"><div><b>' + esc(r.reason) + '</b></div><div class="small muted">Reported by ' + (r.reporterId ? username(store.user(r.reporterId)) : '🤖 Safety filter') + ' · ' + time(r.created) + '</div><div class="report-target">' + target + '</div>' + (r.resolved ? '<div class="small muted">Resolved by ' + username(store.user(r.resolvedBy)) + ' ' + time(r.resolvedAt) + (r.note ? ': ' + esc(r.note) : '') + '</div>' : '') + '</div>' +
          (!r.resolved ? '<div class="report-actions"><button class="btn btn-sm btn-primary" data-act="resolve-report" data-id="' + r.id + '">Resolve</button>' + (r.kind === 'post' && store.post(r.targetId) && !store.post(r.targetId).deleted ? '<button class="btn btn-sm btn-danger" data-act="delete-post" data-id="' + r.targetId + '">Delete post</button>' : '') + '</div>' : '') + '</div>';
      }).join('') : '<div class="empty">No ' + (show ? 'resolved' : 'open') + ' reports. 🎉</div>') + '</div></section>';
    } else if (tab === 'members' || tab === 'banned') {
      const list = db().users.filter((m) => tab === 'members' || m.banned);
      body = '<section class="block"><table class="table"><thead><tr><th>Member</th><th>Group</th><th>Email</th><th>Messages</th><th>Warnings</th><th></th></tr></thead><tbody>' + list.map((m) => '<tr><td>' + avatar(m, 's') + ' ' + username(m) + '</td><td>' + m.role + (m.banned ? ' <span class="badge badge--red">banned</span>' : '') + '</td><td class="small">' + esc(m.email) + '</td><td>' + store.userStats(m).posts + '</td><td>' + (m.warnings || []).reduce((a, w) => a + w.points, 0) + '</td><td class="nowrap">' +
        (m.id !== u.id ? '<button class="btn btn-sm" data-act="warn" data-id="' + m.id + '">Warn</button> ' + (m.role !== 'admin' ? '<button class="btn btn-sm" data-act="ban" data-id="' + m.id + '">' + (m.banned ? 'Unban' : 'Ban') + '</button> ' : '') + (u.role === 'admin' ? '<button class="btn btn-sm" data-act="set-role" data-id="' + m.id + '">Group</button>' : '') : '') + '</td></tr>').join('') + '</tbody></table></section>';
    } else if (tab === 'warnings') {
      const ws = [];
      db().users.forEach((m) => (m.warnings || []).forEach((w) => ws.push(Object.assign({ user: m }, w))));
      ws.sort((a, b) => b.created - a.created);
      body = '<section class="block"><div class="block-body">' + (ws.length ? ws.map((w) => '<div class="activity-item"><div>' + username(w.user) + ': <b>' + esc(w.reason) + '</b> <span class="badge">' + w.points + ' pt</span><div class="small muted">by ' + username(store.user(w.by)) + ' · ' + time(w.created) + '</div></div></div>').join('') : '<div class="empty">No warnings issued.</div>') + '</div></section>';
    } else if (tab === 'forums' && u.role === 'admin') {
      body = db().categories.slice().sort((a, b) => a.order - b.order).map((c) => '<section class="block"><h3 class="block-head">' + esc(c.title) + ' <button class="btn btn-sm" data-act="edit-category" data-id="' + c.id + '">Edit</button></h3><div class="block-body">' +
        db().forums.filter((f) => f.categoryId === c.id).sort((a, b) => a.order - b.order).map((f) => '<div class="member-row"><span class="node-icon">' + f.icon + '</span><div class="grow"><b>' + esc(f.title) + '</b><div class="small muted">' + esc(f.desc) + (f.staffOnly ? ' · staff-only posting' : '') + (f.rating ? ' · rating forum' : '') + '</div></div><button class="btn btn-sm" data-act="edit-forum" data-id="' + f.id + '">Edit</button> <button class="btn btn-sm btn-danger" data-act="delete-forum" data-id="' + f.id + '">Delete</button></div>').join('') + '</div></section>').join('') +
        '<div class="form-actions"><button class="btn btn-primary" data-act="edit-forum">✚ Add forum</button> <button class="btn" data-act="edit-category">✚ Add category</button></div>';
    } else if (tab === 'stats' && u.role === 'admin') {
      const d = db();
      const days = Array.from({ length: 14 }, (_, i) => { const start = new Date(); start.setHours(0, 0, 0, 0); const s = start.getTime() - (13 - i) * PP.DAY; return { s, n: d.posts.filter((p) => p.created >= s && p.created < s + PP.DAY).length }; });
      const max = Math.max(1, ...days.map((x) => x.n));
      body = '<section class="block"><div class="block-body"><dl class="pairs pairs--row"><div><dt>Members</dt><dd>' + d.users.length + '</dd></div><div><dt>Threads</dt><dd>' + d.threads.length + '</dd></div><div><dt>Posts</dt><dd>' + d.posts.length + '</dd></div><div><dt>Profile posts</dt><dd>' + d.profilePosts.length + '</dd></div><div><dt>Conversations</dt><dd>' + d.conversations.length + '</dd></div><div><dt>Open reports</dt><dd>' + d.reports.filter((r) => !r.resolved).length + '</dd></div><div><dt>Storage used</dt><dd>' + Math.round(store.exportJSON().length / 1024) + ' KB</dd></div></dl>' +
        '<h4>Posts per day (last 14 days)</h4><div class="bar-chart">' + days.map((x) => '<div class="bar" title="' + new Date(x.s).toLocaleDateString() + ': ' + x.n + '"><span style="height:' + (x.n / max) * 100 + '%"></span><em>' + new Date(x.s).getDate() + '</em></div>').join('') + '</div></div></section>';
    } else if (tab === 'data' && u.role === 'admin') {
      body = '<section class="block"><div class="block-body"><p>Export the entire forum database as JSON (backup or to move to another browser), or import a backup.</p>' +
        '<button class="btn" data-act="export-all">⬇ Export database</button> <label class="btn">⬆ Import database<input type="file" accept="application/json,.json" data-import hidden></label>' +
        '<hr><p>Reset everything back to the demo content. This deletes all accounts, posts and messages in this browser.</p><button class="btn btn-danger" data-act="reset-data">Reset forum</button></div></section>';
    }
    const html = '<div class="page-head"><h1>' + (u.role === 'admin' ? 'Admin & moderator panel' : 'Moderator panel') + '</h1></div><nav class="tabs">' + tabs.map(([k, l]) => '<a class="tab' + (k === tab ? ' active' : '') + '" href="#/mod/' + k + '">' + l + (k === 'reports' ? ' <span class="count">' + db().reports.filter((r) => !r.resolved).length + '</span>' : '') + '</a>').join('') + '</nav>' + body;
    return { title: 'Moderator panel', html, activity: 'Moderating' };
  }

  /* ---------- misc ---------- */

  function notFound(what) { return { title: 'Not found', html: '<div class="notice notice--error">The requested ' + esc(what || 'page') + ' could not be found. <a href="#/">Back to forums</a></div>' }; }
  function errorView(msg) { return { title: 'Oops', html: '<div class="notice notice--error">' + esc(msg) + '</div>' }; }
  function loginRequired() { return { title: 'Log in required', html: '<div class="notice">You must be logged in to do that. <a class="btn btn-primary btn-sm" href="#/login?return=' + encodeURIComponent(location.hash) + '">Log in</a> <a class="btn btn-sm" href="#/register">Register</a></div>' }; }

  PP.views = { home, forum, threadView, postThread, members, online, member, login, register, lostPassword, account, alerts, alertRow, conversations, conversationNew, conversation, search, tag, whatsNew, help, mod, notFound, errorView, threadUnread, forumUnread };
})();

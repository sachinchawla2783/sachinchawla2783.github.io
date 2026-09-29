/* Router, header and event handling. */
(function () {
  'use strict';
  const PP = window.PP;
  const { store, esc, ui, views } = PP;
  const { toast, modal, closeModal, confirmBox, handleSafety } = ui;
  const me = () => store.currentUser();
  const db = () => store.db;
  PP.multiQuote = [];

  const routes = [
    [/^\/?$/, views.home],
    [/^\/forums\/([^/]+)(?:\/page-(\d+))?$/, views.forum],
    [/^\/threads\/([^/]+)(?:\/page-(\d+))?(?:\/post-([^/]+))?$/, views.threadView],
    [/^\/post-thread(?:\/([^/]+))?$/, views.postThread],
    [/^\/members(?:\/(notable|list|staff|online))?$/, views.members],
    [/^\/online$/, views.online],
    [/^\/members\/([^/]+)(?:\/([a-z-]+))?$/, views.member],
    [/^\/login$/, views.login],
    [/^\/register$/, views.register],
    [/^\/lost-password$/, views.lostPassword],
    [/^\/account(?:\/([a-z-]+))?$/, views.account],
    [/^\/alerts$/, views.alerts],
    [/^\/conversations$/, views.conversations],
    [/^\/conversations\/new$/, views.conversationNew],
    [/^\/conversations\/([^/]+)$/, views.conversation],
    [/^\/search$/, views.search],
    [/^\/tags\/([^/]+)$/, views.tag],
    [/^\/whats-new(?:\/([a-z-]+))?$/, views.whatsNew],
    [/^\/latest-activity$/, () => views.whatsNew(['activity'], new URLSearchParams())],
    [/^\/help(?:\/([a-z-]+))?$/, views.help],
    [/^\/mod(?:\/([a-z-]+))?$/, views.mod],
  ];

  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const i = h.indexOf('?');
    return { path: i >= 0 ? h.slice(0, i) : h, q: new URLSearchParams(i >= 0 ? h.slice(i + 1) : '') };
  }

  let lastPath = null;
  function render(keepScroll) {
    const { path, q } = parseHash();
    let out = null;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try { out = fn(m.slice(1), q); } catch (e) { console.error(e); out = views.errorView('Something went wrong: ' + e.message); }
        break;
      }
    }
    if (!out) out = views.notFound('page');
    const scroll = window.scrollY;
    const app = document.getElementById('app');
    app.innerHTML = '<div class="layout' + (out.sidebar ? ' layout--sidebar' : '') + '"><div class="layout-main">' + out.html + '</div>' + (out.sidebar ? '<aside class="layout-sidebar">' + out.sidebar + '</aside>' : '') + '</div>';
    document.title = out.title + ' | PinkPill';
    ui.bindEditors(app);
    renderHeader(path);
    if (out.activity) store.touch(out.activity);
    if (keepScroll) window.scrollTo(0, scroll);
    else if (path !== lastPath || !out.after) window.scrollTo(0, 0);
    lastPath = path;
    if (out.after) out.after();
    if (PP.pendingSafety) { handleSafety(PP.pendingSafety); PP.pendingSafety = null; }
  }
  const refresh = () => render(true);

  /* ---------- header ---------- */

  function renderHeader(path) {
    const u = me();
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const k = a.dataset.nav;
      const active = (k === 'forums' && (path === '/' || /^\/(forums|threads|post-thread|tags)/.test(path))) || (k !== 'forums' && path.startsWith('/' + k));
      a.classList.toggle('active', active);
    });
    const bar = document.getElementById('userbar');
    if (!u) {
      bar.innerHTML = '<a class="ub-link" href="#/login">Log in</a><a class="ub-link ub-link--primary" href="#/register">Register</a>';
    } else {
      const unreadAlerts = store.alertsFor(u).filter((a) => !a.read).length;
      const unreadConvs = store.conversationsFor(u).filter((c) => store.isUnread(c, u)).length;
      const reports = store.isStaff(u) ? db().reports.filter((r) => !r.resolved).length : 0;
      bar.innerHTML =
        (store.isStaff(u) ? '<a class="ub-link" href="#/mod" title="Moderator panel">🛡' + (reports ? '<span class="count">' + reports + '</span>' : '') + '</a>' : '') +
        '<span class="menu-wrap"><button class="ub-link" data-menu="user">' + ui.avatar(u, 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') + '<span class="ub-name">' + esc(u.username) + '</span></button><div class="menu menu--right" data-menu-body="user"></div></span>' +
        '<span class="menu-wrap"><button class="ub-link" data-menu="inbox" title="Inbox">✉' + (unreadConvs ? '<span class="count">' + unreadConvs + '</span>' : '') + '</button><div class="menu menu--right menu--wide" data-menu-body="inbox"></div></span>' +
        '<span class="menu-wrap"><button class="ub-link" data-menu="alerts" title="Alerts">🔔' + (unreadAlerts ? '<span class="count">' + unreadAlerts + '</span>' : '') + '</button><div class="menu menu--right menu--wide" data-menu-body="alerts"></div></span>';
      const title = (unreadAlerts + unreadConvs) ? '(' + (unreadAlerts + unreadConvs) + ') ' : '';
      if (!document.title.startsWith('(')) document.title = title + document.title;
    }
    applyTheme();
  }

  function fillMenu(name, body) {
    const u = me();
    if (name === 'user' && u) {
      const s = store.userStats(u);
      body.innerHTML = '<div class="menu-head">' + ui.avatar(u, 'm') + '<div>' + ui.username(u) + '<div class="small muted">' + ui.userTitle(u) + '</div><div class="small muted">Messages: ' + s.posts + ' · Reactions: ' + s.score + ' · Points: ' + s.points + '</div></div></div>' +
        '<a href="#/members/' + u.id + '">Your profile</a><a href="#/whats-new/feed">Your news feed</a><a href="#/members/' + u.id + '/postings">Your content</a><a href="#/account/bookmarks">Bookmarks</a><a href="#/account/watched">Watched threads</a><hr>' +
        '<a href="#/account/details">Account details</a><a href="#/account/personal">Personal details</a><a href="#/account/security">Password &amp; security</a><a href="#/account/privacy">Privacy</a><a href="#/account/preferences">Preferences</a><a href="#/account/signature">Signature</a><a href="#/account/following">Following</a><a href="#/account/ignoring">Ignoring</a><hr>' +
        '<form data-form="status" class="menu-status"><input name="content" placeholder="Update your status…" maxlength="140"><button class="btn btn-sm">Post</button></form><button data-act="logout">Log out</button>';
    } else if (name === 'alerts' && u) {
      const list = store.alertsFor(u).slice(0, 8);
      body.innerHTML = '<div class="menu-title">Alerts <button class="link small" data-act="alerts-read-all">Mark read</button></div><div class="alerts-list">' + (list.length ? list.map(views.alertRow).join('') : '<div class="empty small">You have no new alerts.</div>') + '</div><a class="menu-foot" href="#/alerts">Show all</a>';
    } else if (name === 'inbox' && u) {
      const list = store.conversationsFor(u).slice(0, 6);
      body.innerHTML = '<div class="menu-title">Conversations <a class="small" href="#/conversations/new">Start new</a></div>' + (list.length ? list.map((c) => { const last = c.messages[c.messages.length - 1]; return '<a class="alert-row' + (store.isUnread(c, u) ? ' unread' : '') + '" href="#/conversations/' + c.id + '">' + ui.avatar(store.user(last.authorId), 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') + '<span class="grow"><b>' + esc(c.title) + '</b><span class="small muted block">' + esc(PP.snippet(last.content, 60)) + ' · ' + esc(PP.timeAgo(last.created)) + '</span></span></a>'; }).join('') : '<div class="empty small">You have no conversations.</div>') + '<a class="menu-foot" href="#/conversations">Show all</a>';
    }
  }

  function applyTheme() {
    const u = me();
    let t = 'auto';
    try { t = (u && u.settings.theme) || localStorage.getItem('pinkpill.theme') || 'auto'; } catch (e) { /* ignore */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = t;
  }

  function setTheme(t) {
    const u = me();
    if (u) store.updateProfile(u, { settings: { theme: t } });
    try { localStorage.setItem('pinkpill.theme', t); } catch (e) { /* ignore */ }
    applyTheme();
  }

  /* ---------- helpers ---------- */

  function need() { if (!me()) { location.hash = '#/login?return=' + encodeURIComponent(location.hash); return false; } return true; }
  function run(fn) { try { const r = fn(); if (r && r.catch) r.catch((e) => toast(e.message, 'error')); return r; } catch (e) { toast(e.message, 'error'); return undefined; } }
  const formData = (form) => { const o = {}; new FormData(form).forEach((v, k) => { if (k in o) o[k] = [].concat(o[k], v); else o[k] = v; }); return o; };
  const quoteOf = (p) => '[quote=' + ((store.user(p.authorId) || {}).username || 'Member') + ', post: ' + p.id + ']' + p.content.replace(/\[quote[\s\S]*?\[\/quote\]\n?/gi, '').trim() + '[/quote]\n';

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function replyBox() { return document.querySelector('form[data-form="reply"] textarea'); }

  function notifyNewAlerts() {
    const u = me();
    if (!u || !u.settings.desktopAlerts || !('Notification' in window) || Notification.permission !== 'granted') return;
    const seen = Number(sessionStorage.getItem('pinkpill.notified') || Date.now());
    store.alertsFor(u).filter((a) => !a.read && a.created > seen).slice(0, 3).forEach((a) => new Notification('PinkPill', { body: a.text }));
    sessionStorage.setItem('pinkpill.notified', Date.now());
  }

  /* ---------- click actions ---------- */

  const actions = {
    logout() { store.logout(); toast('You have been logged out.'); location.hash = '#/'; render(); },
    'login-as'(el) { store.loginAs(el.dataset.id); toast('Logged in as ' + store.user(el.dataset.id).username); location.hash = el.dataset.return || '#/'; render(); },
    'mark-all-read'() { const u = me(); u.readAllAt = Date.now(); u.readMarks = {}; store.commit(); toast('All forums marked read.'); refresh(); },
    'mark-forum-read'(el) { const u = me(); u.readMarks = u.readMarks || {}; store.threadsIn(el.dataset.id).forEach((t) => { u.readMarks[t.id] = Date.now(); }); store.commit(); refresh(); },
    react(el) {
      if (!need()) return;
      const u = me(), kind = el.dataset.kind, id = el.dataset.id;
      const target = kind === 'post' ? store.post(id) : db().profilePosts.find((p) => p.id === id);
      const current = (target.reactions || {})[u.id];
      const r = el.closest('.react-picker') ? el.dataset.r : (current ? null : 'like');
      run(() => store.react(u, kind, id, r)); refresh();
    },
    reactors(el) {
      const target = el.dataset.kind === 'post' ? store.post(el.dataset.id) : db().profilePosts.find((p) => p.id === el.dataset.id);
      const entries = Object.entries(target.reactions || {});
      const groups = PP.REACTIONS.map((r) => [r, entries.filter((e) => e[1] === r.id)]).filter((g) => g[1].length);
      modal('Members who reacted', '<div class="tabs">' + '<span class="tab active">All (' + entries.length + ')</span>' + groups.map(([r, l]) => '<span class="tab">' + r.emoji + ' ' + l.length + '</span>').join('') + '</div><div class="member-list">' + entries.map(([uid, r]) => { const m = store.user(uid); return m ? '<div class="member-row">' + ui.avatar(m, 's') + '<div class="grow">' + ui.username(m) + '<div class="small muted">' + ui.userTitle(m) + '</div></div><span style="font-size:1.4em">' + PP.REACTIONS.find((x) => x.id === r).emoji + '</span></div>' : ''; }).join('') + '</div>');
    },
    quote(el) {
      const ta = replyBox(); if (!ta) return;
      ui.insertAt(ta, quoteOf(store.post(el.dataset.id)));
      ta.closest('form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    mq(el) {
      const i = PP.multiQuote.indexOf(el.dataset.id);
      if (i >= 0) PP.multiQuote.splice(i, 1); else PP.multiQuote.push(el.dataset.id);
      el.textContent = i >= 0 ? '+ Quote' : '− Quote';
      const b = document.querySelector('[data-act="mq-insert"]');
      if (b) { b.hidden = !PP.multiQuote.length; b.textContent = 'Insert quotes (' + PP.multiQuote.length + ')'; }
    },
    'mq-insert'() {
      const ta = replyBox(); if (!ta) return;
      PP.multiQuote.map((id) => store.post(id)).filter(Boolean).sort((a, b) => a.created - b.created).forEach((p) => ui.insertAt(ta, quoteOf(p)));
      PP.multiQuote = [];
      refresh();
    },
    'edit-post'(el) {
      const p = store.post(el.dataset.id);
      const m = modal('Edit post', '<form data-form="edit-post" data-id="' + p.id + '">' + ui.editor('content', p.content, { rows: 10 }) + '<label class="field"><span>Edit reason (optional)</span><input name="reason" maxlength="100"></label><div class="form-actions"><button class="btn btn-primary">Save</button> <button type="button" class="btn" data-close>Cancel</button></div></form>', { wide: true });
      m.querySelector('textarea').focus();
    },
    'delete-post'(el) {
      const p = store.post(el.dataset.id);
      const first = store.postsIn(p.threadId)[0].id === p.id;
      const m = modal('Delete post', '<form data-form="delete-post" data-id="' + p.id + '"><p>' + (first ? 'This is the first post: deleting it will <b>delete the whole thread</b>.' : 'Are you sure you want to delete this post?') + '</p><label class="field"><span>Reason for deletion</span><input name="reason" maxlength="100"></label><div class="form-actions"><button class="btn btn-danger">Delete</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
      m.querySelector('input').focus();
    },
    'undelete-post'(el) { store.undeletePost(me(), el.dataset.id); refresh(); },
    history(el) {
      const p = store.post(el.dataset.id);
      modal('Post history', (p.history || []).slice().reverse().map((h) => '<div class="history-item"><div class="small muted">Version from ' + PP.dateTime(h.at) + '</div><div class="bbwrap">' + PP.bbcode(h.content) + '</div></div>').join('') || '<p>No history.</p>', { wide: true });
    },
    report(el) {
      if (!need()) return;
      modal('Report content', '<form data-form="report" data-kind="' + el.dataset.kind + '" data-id="' + el.dataset.id + '"><p class="small muted">Reports are sent to moderators. Please explain what rule this breaks.</p>' +
        '<label class="field"><span>Reason</span><select name="preset"><option value="">Choose…</option><option>Bullying or harassment</option><option>Dangerous practice (pro-ED, DIY procedures, etc.)</option><option>Self-harm / someone at risk</option><option>Spam</option><option>Photo of someone else / minor</option><option>Hate speech</option><option>Other</option></select></label>' +
        '<label class="field"><span>Details</span><textarea name="reason" rows="3"></textarea></label><div class="form-actions"><button class="btn btn-primary">Report</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
    },
    bookmark(el) { if (!need()) return; const on = run(() => store.toggleBookmark(me(), el.dataset.id)); toast(on ? 'Bookmark added.' : 'Bookmark removed.'); refresh(); },
    share(el) {
      const url = location.href.split('#')[0] + '#/threads/' + el.dataset.thread + '/post-' + el.dataset.id;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied to clipboard.'), () => prompt('Copy this link:', url));
      else prompt('Copy this link:', url);
    },
    'watch-thread'(el) { if (!need()) return; const on = run(() => store.toggleWatch(me(), el.dataset.id)); toast(on ? 'You are now watching this thread.' : 'You are no longer watching this thread.'); refresh(); },
    'toggle-sticky'(el) { const t = store.thread(el.dataset.id); run(() => store.updateThread(me(), t.id, { sticky: !t.sticky })); refresh(); },
    'toggle-lock'(el) { const t = store.thread(el.dataset.id); run(() => store.updateThread(me(), t.id, { locked: !t.locked })); refresh(); },
    'move-thread'(el) {
      const t = store.thread(el.dataset.id);
      modal('Move thread', '<form data-form="move-thread" data-id="' + t.id + '"><label class="field"><span>Destination forum</span><select name="forumId">' + db().forums.map((f) => '<option value="' + f.id + '"' + (f.id === t.forumId ? ' selected' : '') + '>' + esc(f.title) + '</option>').join('') + '</select></label><label class="check"><input type="checkbox" name="notify" checked> Notify thread starter</label><div class="form-actions"><button class="btn btn-primary">Move</button></div></form>');
    },
    'edit-thread'(el) {
      const t = store.thread(el.dataset.id);
      modal('Edit thread', '<form data-form="edit-thread" data-id="' + t.id + '"><label class="field"><span>Prefix</span><select name="prefix"><option value="">(No prefix)</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (p.id === t.prefix ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Title</span><input name="title" value="' + esc(t.title) + '" required maxlength="150"></label><label class="field"><span>Tags</span><input name="tags" value="' + esc(t.tags.join(', ')) + '"></label>' +
        (t.poll ? '<label class="check"><input type="checkbox" name="closePoll"' + (t.poll.closes && t.poll.closes < Date.now() ? ' checked' : '') + '> Close poll</label>' : '') +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    'delete-thread'(el) {
      const t = store.thread(el.dataset.id);
      confirmBox('Delete the thread "' + t.title + '" and all its posts? This cannot be undone.', () => { run(() => store.deleteThread(me(), t.id)); toast('Thread deleted.'); location.hash = '#/forums/' + t.forumId; }, 'Delete thread');
    },
    'poll-results'(el) { PP.pollResults = el.dataset.id; refresh(); },
    'poll-change'(el) { if (!need()) return; const t = store.thread(el.dataset.id); t.poll.options.forEach((o) => { o.votes = o.votes.filter((v) => v !== me().id); }); PP.pollResults = null; store.commit(); refresh(); },
    'poll-add-option'(el) {
      const box = el.parentElement.querySelector('[data-poll-options]');
      if (box.children.length >= 20) return toast('Maximum 20 options.', 'warn');
      const i = document.createElement('input'); i.name = 'poll_opt'; i.className = 'poll-opt'; i.placeholder = 'Option ' + (box.children.length + 1); box.appendChild(i); i.focus();
    },
    follow(el) { if (!need()) return; const on = run(() => store.toggleFollow(me(), el.dataset.id)); if (on !== undefined) toast(on ? 'You are now following ' + store.user(el.dataset.id).username + '.' : 'Unfollowed.'); refresh(); },
    ignore(el) { if (!need()) return; const on = run(() => store.toggleIgnore(me(), el.dataset.id)); if (on !== undefined) toast(on ? 'You are now ignoring this member.' : 'You are no longer ignoring this member.'); refresh(); },
    'show-ignored'(el) { const art = el.closest('article'); art.innerHTML = art.querySelector('template').innerHTML; art.classList.remove('message--ignored'); },
    warn(el) {
      const m = store.user(el.dataset.id);
      modal('Warn ' + m.username, '<form data-form="warn" data-id="' + m.id + '"><label class="field"><span>Reason</span><select name="preset"><option>Bullying / unkind feedback</option><option>Dangerous content</option><option>Spam</option><option>Off-topic / derailing</option><option>Inappropriate images</option><option>Other</option></select></label><label class="field"><span>Details</span><input name="details"></label><label class="field"><span>Points</span><input type="number" name="points" value="1" min="1" max="10"></label><div class="form-actions"><button class="btn btn-primary">Warn</button></div></form>');
    },
    ban(el) {
      const m = store.user(el.dataset.id);
      if (m.banned) { run(() => store.banUser(me(), m.id)); toast('Ban lifted.'); refresh(); return; }
      modal('Ban ' + m.username, '<form data-form="ban" data-id="' + m.id + '"><label class="field"><span>Reason (shown to the member)</span><input name="reason" required></label><div class="form-actions"><button class="btn btn-danger">Ban member</button></div></form>');
    },
    'set-role'(el) {
      const m = store.user(el.dataset.id);
      modal('Change user group: ' + m.username, '<form data-form="set-role" data-id="' + m.id + '"><label class="field"><span>User group</span><select name="role">' + [['member', 'Registered member'], ['mod', 'Moderator'], ['admin', 'Administrator']].map(([v, l]) => '<option value="' + v + '"' + (v === m.role ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    'pp-delete'(el) { confirmBox('Delete this profile post?', () => { run(() => store.deleteProfilePost(me(), el.dataset.id)); refresh(); }, 'Delete'); },
    'pp-comment-toggle'(el) { const f = document.querySelector('form[data-form="pp-comment"][data-id="' + el.dataset.id + '"]'); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); } },
    'alerts-read-all'() { store.markAlertsRead(me()); refresh(); },
    'conv-star'(el) { store.toggleStarConv(me(), el.dataset.id); refresh(); },
    'conv-leave'(el) { confirmBox('Leave this conversation? You\'ll rejoin automatically if someone replies.', () => { store.leaveConversation(me(), el.dataset.id); location.hash = '#/conversations'; }, 'Leave'); },
    'conv-invite'(el) { modal('Invite members', '<form data-form="conv-invite" data-id="' + el.dataset.id + '"><label class="field"><span>Members to invite</span><input name="names" placeholder="Separate names with a comma" required></label><div class="form-actions"><button class="btn btn-primary">Invite</button></div></form>'); },
    'conv-quote'(el) {
      const c = db().conversations.find((x) => x.id === el.dataset.conv); const m = c.messages.find((x) => x.id === el.dataset.id);
      const ta = document.querySelector('form[data-form="conv-reply"] textarea');
      ui.insertAt(ta, '[quote=' + store.user(m.authorId).username + ']' + m.content + '[/quote]\n'); ta.scrollIntoView({ block: 'center' });
    },
    'resolve-report'(el) { store.resolveReport(me(), el.dataset.id, prompt('Resolution note (optional):') || ''); toast('Report resolved.'); refresh(); },
    'remove-avatar'() { store.updateProfile(me(), { avatar: null }); refresh(); },
    'remove-banner'() { store.updateProfile(me(), { banner: null }); refresh(); },
    'export-all'() { download('pinkpill-backup-' + new Date().toISOString().slice(0, 10) + '.json', store.exportJSON()); },
    'export-mine'() {
      const u = me();
      const data = { profile: Object.assign({}, u, { passHash: undefined, salt: undefined }), posts: db().posts.filter((p) => p.authorId === u.id), threads: db().threads.filter((t) => t.authorId === u.id), profilePosts: db().profilePosts.filter((p) => p.authorId === u.id), conversations: store.conversationsFor(u) };
      download('pinkpill-my-data.json', JSON.stringify(data, null, 2));
    },
    'delete-account'() {
      const u = me();
      if (u.role === 'admin' && db().users.filter((x) => x.role === 'admin').length === 1) return toast('You are the only administrator. Promote someone else first.', 'error');
      confirmBox('Permanently delete your account? Your posts will remain as "Deleted member".', () => {
        const d = db();
        d.users = d.users.filter((x) => x.id !== u.id);
        d.users.forEach((x) => { x.followers = x.followers.filter((i) => i !== u.id); x.following = x.following.filter((i) => i !== u.id); });
        d.alerts = d.alerts.filter((a) => a.userId !== u.id);
        store.logout(); store.commit(); toast('Your account has been deleted.'); location.hash = '#/';
      }, 'Delete account');
    },
    'reset-data'() { confirmBox('Reset the whole forum to demo content? All data in this browser will be lost.', () => { store.reset(); toast('Forum reset.'); location.hash = '#/'; render(); }, 'Reset'); },
    'edit-forum'(el) {
      const f = el.dataset.id ? store.forum(el.dataset.id) : { id: '', title: '', desc: '', icon: '💬', categoryId: db().categories[0].id };
      modal(f.id ? 'Edit forum' : 'Add forum', '<form data-form="edit-forum" data-id="' + f.id + '"><label class="field"><span>Title</span><input name="title" value="' + esc(f.title) + '" required></label><label class="field"><span>Description</span><input name="desc" value="' + esc(f.desc) + '"></label><label class="field"><span>Icon (emoji)</span><input name="icon" value="' + esc(f.icon) + '" maxlength="4"></label>' +
        '<label class="field"><span>Category</span><select name="categoryId">' + db().categories.map((c) => '<option value="' + c.id + '"' + (c.id === f.categoryId ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('') + '</select></label><label class="field"><span>Display order</span><input type="number" name="order" value="' + (f.order || 0) + '"></label>' +
        '<label class="check"><input type="checkbox" name="staffOnly"' + (f.staffOnly ? ' checked' : '') + '> Only staff can post threads</label><label class="check"><input type="checkbox" name="rating"' + (f.rating ? ' checked' : '') + '> Rating forum (threads have ratings enabled)</label><div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    'delete-forum'(el) {
      const f = store.forum(el.dataset.id);
      if (store.threadsIn(f.id).length) return toast('Move or delete this forum\'s ' + store.threadsIn(f.id).length + ' threads first.', 'error');
      confirmBox('Delete forum "' + f.title + '"?', () => { db().forums = db().forums.filter((x) => x.id !== f.id); store.commit(); refresh(); }, 'Delete');
    },
    'edit-category'(el) {
      const c = el.dataset.id ? db().categories.find((x) => x.id === el.dataset.id) : { id: '', title: '', order: db().categories.length };
      modal(c.id ? 'Edit category' : 'Add category', '<form data-form="edit-category" data-id="' + c.id + '"><label class="field"><span>Title</span><input name="title" value="' + esc(c.title) + '" required></label><label class="field"><span>Display order</span><input type="number" name="order" value="' + c.order + '"></label><div class="form-actions"><button class="btn btn-primary">Save</button>' + (c.id && !db().forums.some((f) => f.categoryId === c.id) ? ' <button type="button" class="btn btn-danger" data-act="delete-category" data-id="' + c.id + '">Delete</button>' : '') + '</div></form>');
    },
    'delete-category'(el) { db().categories = db().categories.filter((c) => c.id !== el.dataset.id); store.commit(); closeModal(); refresh(); },
    'nav-toggle'() { document.body.classList.toggle('nav-open'); },
  };

  document.addEventListener('click', (e) => {
    // dropdown menus
    const mt = e.target.closest('[data-menu]');
    if (mt) {
      e.preventDefault();
      const body = mt.parentElement.querySelector('[data-menu-body="' + mt.dataset.menu + '"]');
      const open = body.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!open) { fillMenu(mt.dataset.menu, body); body.classList.add('open'); }
      return;
    }
    if (!e.target.closest('.menu') || e.target.closest('a, button')) document.querySelectorAll('.menu.open').forEach((m) => { if (!m.contains(e.target) || e.target.closest('a, button[data-act]')) m.classList.remove('open'); });
    const collapse = e.target.closest('[data-collapse]');
    if (collapse) { collapse.parentElement.classList.toggle('collapsed'); return; }
    const el = e.target.closest('[data-act]');
    if (!el || !actions[el.dataset.act]) return;
    e.preventDefault();
    actions[el.dataset.act](el, e);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); }
  });

  /* ---------- forms ---------- */

  const forms = {
    async login(f, d) {
      await store.login(d.name, d.password);
      toast('Welcome back, ' + me().username + '!');
      location.hash = f.dataset.return || '#/';
    },
    async register(f, d) {
      const age = (Date.now() - new Date(d.birthday).getTime()) / (365.25 * PP.DAY);
      if (!(age >= 18)) throw new Error('You must be 18 or older to join PinkPill.');
      const u = await store.register(d);
      store.updateProfile(u, { birthday: d.birthday });
      toast('Welcome to PinkPill, ' + u.username + '! 💗');
      location.hash = '#/forums/f-intro';
    },
    'post-thread'(f, d) {
      const u = me();
      const opts = [].concat(d.poll_opt || []).map((s) => s.trim()).filter(Boolean);
      let poll = null;
      if ((d.poll_q || '').trim()) {
        if (opts.length < 2) throw new Error('A poll needs at least 2 options.');
        poll = { question: d.poll_q.trim(), multiple: !!d.poll_multi, closes: d.poll_days ? Date.now() + Number(d.poll_days) * PP.DAY : null, options: opts.map((text) => ({ text, votes: [] })) };
      }
      const tags = (d.tags || '').split(',').map((s) => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
      const r = store.createThread(u, { forumId: f.dataset.forum, title: d.title, content: d.content, prefix: d.prefix, tags, poll, ratingEnabled: !!d.rating_enabled });
      if (!d.watch) store.toggleWatch(u, r.thread.id);
      ui.clearDraft(f);
      PP.pendingSafety = r.safety;
      location.hash = '#/threads/' + r.thread.id;
    },
    reply(f, d) {
      const u = me();
      const r = store.reply(u, f.dataset.thread, d.content, d.rating);
      if (u.settings.autoWatch === false && u.watched.includes(f.dataset.thread)) store.toggleWatch(u, f.dataset.thread);
      ui.clearDraft(f);
      PP.pendingSafety = r.safety;
      location.hash = '#/threads/' + f.dataset.thread + '/post-' + r.post.id;
    },
    'edit-post'(f, d) { const s = store.editPost(me(), f.dataset.id, d.content, d.reason); closeModal(); refresh(); handleSafety(s); },
    'delete-post'(f, d) { const kind = store.deletePost(me(), f.dataset.id, d.reason); closeModal(); toast(kind === 'thread' ? 'Thread deleted.' : 'Post deleted.'); if (kind === 'thread') location.hash = '#/'; else refresh(); },
    report(f, d) { store.report(me(), f.dataset.kind, f.dataset.id, [d.preset, d.reason].filter(Boolean).join(': ')); closeModal(); toast('Thank you for reporting this content.'); },
    'poll-vote'(f) { const vals = [...f.querySelectorAll('input:checked')].map((i) => Number(i.value)); if (!vals.length) throw new Error('Please select an option.'); store.votePoll(me(), f.dataset.id, vals); toast('Your vote has been cast.'); refresh(); },
    'edit-thread'(f, d) {
      const t = store.thread(f.dataset.id);
      store.updateThread(me(), t.id, { title: d.title.trim(), prefix: d.prefix || null, tags: (d.tags || '').split(',').map((s) => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean) });
      if (t.poll) { if (d.closePoll) t.poll.closes = t.poll.closes && t.poll.closes < Date.now() ? t.poll.closes : Date.now() - 1; else if (t.poll.closes && t.poll.closes < Date.now()) t.poll.closes = null; store.commit(); }
      closeModal(); refresh();
    },
    'move-thread'(f, d) {
      const t = store.thread(f.dataset.id);
      store.updateThread(me(), t.id, { forumId: d.forumId });
      if (d.notify) { store.addAlert(t.authorId, me().id, 'reply', 'Your thread ' + t.title + ' was moved to ' + store.forum(d.forumId).title, '#/threads/' + t.id); store.commit(); }
      closeModal(); toast('Thread moved.'); refresh();
    },
    'thread-filter'(f, d) {
      const p = new URLSearchParams();
      ['prefix', 'starter', 'unread'].forEach((k) => { if (d[k]) p.set(k, d[k]); });
      if (d.order && d.order !== 'last') p.set('order', d.order);
      if (d.dir && d.dir !== 'desc') p.set('dir', d.dir);
      location.hash = '#/forums/' + f.dataset.forum + (p.toString() ? '?' + p : '');
    },
    'find-member'(f, d) { const u = store.userByName(d.name.trim()); if (!u) throw new Error('The specified member cannot be found.'); location.hash = '#/members/' + u.id; },
    'pp-new'(f, d) { store.addProfilePost(me(), f.dataset.id, d.content); refresh(); },
    'pp-comment'(f, d) { store.commentProfilePost(me(), f.dataset.id, d.content); refresh(); },
    status(f, d) { if (!d.content.trim()) return; store.addProfilePost(me(), me().id, d.content); toast('Status updated.'); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); refresh(); },
    'conv-new'(f, d) { const c = store.startConversation(me(), d); ui.clearDraft(f); location.hash = '#/conversations/' + c.id; },
    'conv-reply'(f, d) { store.replyConversation(me(), f.dataset.id, d.content); ui.clearDraft(f); refresh(); window.scrollTo(0, document.body.scrollHeight); },
    'conv-invite'(f, d) { store.inviteToConversation(me(), f.dataset.id, d.names); closeModal(); toast('Members invited.'); refresh(); },
    search(f, d) {
      const p = new URLSearchParams();
      Object.entries({ q: d.q, m: d.m, t: d.t, f: d.f, titles: d.titles, o: d.o !== 'date' ? d.o : '' }).forEach(([k, v]) => { if (v) p.set(k, v.trim ? v.trim() : v); });
      if (!p.get('q') && !p.get('m')) throw new Error('Please enter a search term or member.');
      location.hash = '#/search?' + p;
    },
    'quick-search'(f, d) { if (d.q.trim()) location.hash = '#/search?q=' + encodeURIComponent(d.q.trim()); },
    'account-details'(f, d) {
      const u = me(), email = d.email.trim().toLowerCase();
      if (db().users.some((x) => x.id !== u.id && x.email === email)) throw new Error('That email is already in use.');
      u.email = email; store.commit(); toast('Your changes have been saved.');
    },
    async 'account-personal'(f, d) {
      const u = me();
      const changes = { customTitle: d.customTitle.trim(), location: d.location.trim(), website: d.website.trim(), birthday: d.birthday, bio: d.bio, color: d.color };
      const av = f.querySelector('[name=avatar_file]').files[0], bn = f.querySelector('[name=banner_file]').files[0];
      if (av) changes.avatar = await PP.readImage(av, 256, 0.85);
      if (bn) changes.banner = await PP.readImage(bn, 1200, 0.75);
      store.updateProfile(u, changes); toast('Your changes have been saved.'); refresh();
    },
    'account-signature'(f, d) { store.updateProfile(me(), { signature: d.signature.slice(0, 1000) }); toast('Signature saved.'); },
    async 'account-password'(f, d) {
      if (d.new !== d.confirm) throw new Error('Passwords don\'t match.');
      await store.changePassword(me(), d.old, d.new); f.reset(); toast('Your password has been changed.'); refresh();
    },
    'account-privacy'(f, d) { store.updateProfile(me(), { settings: { showOnline: !!d.showOnline, allowDMs: d.allowDMs, allowProfilePosts: d.allowProfilePosts } }); toast('Your changes have been saved.'); },
    'account-prefs'(f, d) {
      store.updateProfile(me(), { settings: { theme: d.theme, showSignatures: !!d.showSignatures, autoWatch: !!d.autoWatch, desktopAlerts: !!d.desktopAlerts } });
      if (d.desktopAlerts && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      applyTheme(); toast('Your changes have been saved.');
    },
    warn(f, d) { store.warnUser(me(), f.dataset.id, d.preset + (d.details ? ': ' + d.details : ''), d.points); closeModal(); toast('Warning issued.'); refresh(); },
    ban(f, d) { store.banUser(me(), f.dataset.id, d.reason); closeModal(); toast('Member banned.'); refresh(); },
    'set-role'(f, d) { store.setRole(me(), f.dataset.id, d.role); closeModal(); toast('User group updated.'); refresh(); },
    'edit-forum'(f, d) {
      const vals = { title: d.title.trim(), desc: d.desc.trim(), icon: d.icon || '💬', categoryId: d.categoryId, order: Number(d.order) || 0, staffOnly: !!d.staffOnly, rating: !!d.rating };
      if (f.dataset.id) Object.assign(store.forum(f.dataset.id), vals);
      else db().forums.push(Object.assign({ id: PP.uid('f-') }, vals));
      store.commit(); closeModal(); refresh();
    },
    'edit-category'(f, d) {
      if (f.dataset.id) Object.assign(db().categories.find((c) => c.id === f.dataset.id), { title: d.title.trim(), order: Number(d.order) || 0 });
      else db().categories.push({ id: PP.uid('c-'), title: d.title.trim(), order: Number(d.order) || 0 });
      store.commit(); closeModal(); refresh();
    },
  };

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f || !forms[f.dataset.form]) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    try { await forms[f.dataset.form](f, formData(f)); } catch (err) { toast(err.message, 'error'); } finally { if (btn) btn.disabled = false; }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'theme-select') setTheme(e.target.value);
    if (e.target.matches('[data-import]')) {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => { try { store.importJSON(r.result); toast('Database imported.'); render(); } catch (err) { toast(err.message, 'error'); } };
      r.readAsText(file);
    }
  });

  /* ---------- boot ---------- */

  store.load();
  ui.bindUserTips();
  window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); ui.closeModal(); render(); });
  // Pick up changes made in other tabs.
  window.addEventListener('storage', (e) => { if (e.key === 'pinkpill.db.v1') { store.load(); refresh(); } });
  setInterval(() => { renderHeader(parseHash().path); notifyNewAlerts(); }, 60 * 1000);
  document.getElementById('year').textContent = new Date().getFullYear();
  render();
})();

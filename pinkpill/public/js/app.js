/* Router, header and event handling. All data changes go through the API. */
(function () {
  'use strict';
  const PP = window.PP;
  const { store, api, esc, ui, views } = PP;
  const { toast, modal, closeModal, confirmBox } = ui;
  const me = () => PP.session.user;
  PP.multiQuote = [];
  PP.ignoring = new Set();

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
    [/^\/reset-password$/, views.resetPassword],
    [/^\/verify-email$/, views.verifyEmail],
    [/^\/claim-admin$/, views.claimAdmin],
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
    [/^\/vip$/, (m, q) => PP.vipViews.page(m, q)],
    [/^\/vip\/(checkout|gift)\/([a-z0-9-]+)$/, (m, q) => PP.vipViews.checkout(m, q)],
    [/^\/vip\/return$/, (m, q) => PP.vipViews.returned(m, q)],
    [/^\/u\/([a-z0-9_-]+)$/i, (m) => PP.vipViews.vanity(m)],
    [/^\/mod(?:\/([a-z-]+))?$/, views.mod],
  ];

  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const i = h.indexOf('?');
    return { path: i >= 0 ? h.slice(0, i) : h, q: new URLSearchParams(i >= 0 ? h.slice(i + 1) : '') };
  }

  let renderSeq = 0, lastPath = null;
  async function render(keepScroll) {
    const seq = ++renderSeq;
    const { path, q } = parseHash();
    const app = document.getElementById('app');
    const scroll = window.scrollY;
    const loadingTimer = setTimeout(() => { if (seq === renderSeq) app.classList.add('is-loading'); }, 150);
    let out = null;
    try {
      for (const [re, fn] of routes) {
        const m = path.match(re);
        if (m) { out = await fn(m.slice(1).map((x) => (x === undefined ? undefined : decodeURIComponent(x))), q); break; }
      }
      if (!out) out = views.notFound('page');
    } catch (e) {
      if (e.status === 404) out = views.notFound();
      else if (e.status === 401) out = views.loginRequired();
      else if (e.status === 403) out = views.errorView(e.message);
      else out = { title: 'Error', html: '<div class="notice notice--error">' + esc(e.message) + ' <button class="btn btn-sm" data-act="retry">Try again</button></div>' };
    } finally { clearTimeout(loadingTimer); }
    if (seq !== renderSeq) return;       // a newer navigation started while this one loaded
    app.classList.remove('is-loading');
    app.innerHTML = '<div class="layout' + (out.sidebar ? ' layout--sidebar' : '') + '"><div class="layout-main">' + out.html + '</div>' + (out.sidebar ? '<aside class="layout-sidebar">' + out.sidebar + '</aside>' : '') + '</div>';
    document.title = out.title + ' | PinkPill';
    ui.bindEditors(app);
    mountTurnstile(app);
    renderHeader(path);
    if (keepScroll) window.scrollTo(0, scroll);
    else if (path !== lastPath || !out.after) window.scrollTo(0, 0);
    lastPath = path;
    if (out.after) out.after();
  }
  const refresh = () => { PP.invalidateWidgets(); return render(true); };
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  /* ---------- header ---------- */

  let counts = {};
  async function refreshCounts() {
    if (!me()) { counts = {}; return; }
    try { counts = await api.get('/me/counts'); } catch (e) { counts = {}; }
    renderHeader(parseHash().path);
  }
  PP.refreshCounts = refreshCounts;
  PP.app = { go: (h) => go(h), refresh: () => refresh(), render: (k) => render(k) };

  function renderHeader(path) {
    const u = me();
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const k = a.dataset.nav;
      a.classList.toggle('active', (k === 'forums' && (path === '/' || /^\/(forums|threads|post-thread|tags)/.test(path))) || (k !== 'forums' && path.startsWith('/' + k)) || (k === 'vip' && /^\/account\/(vip|purchases)/.test(path)));
    });
    const bar = document.getElementById('userbar');
    if (!u) {
      bar.innerHTML = '<a class="ub-link" href="#/login">Log in</a><a class="ub-link ub-link--primary" href="#/register">Register</a>';
    } else {
      const isStaff = u.permissions.includes('mod.view_reports') || u.permissions.includes('admin.users');
      bar.innerHTML =
        (isStaff ? '<a class="ub-link" href="#/mod" title="Moderator panel">🛡' + (counts.reports ? '<span class="count">' + counts.reports + '</span>' : '') + '</a>' : '') +
        '<span class="menu-wrap"><button class="ub-link" data-menu="user">' + ui.avatar(u, 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') + '<span class="ub-name">' + esc(u.username) + '</span></button><div class="menu menu--right" data-menu-body="user"></div></span>' +
        '<span class="menu-wrap"><button class="ub-link" data-menu="inbox" title="Inbox">✉' + (counts.conversations ? '<span class="count">' + counts.conversations + '</span>' : '') + '</button><div class="menu menu--right menu--wide" data-menu-body="inbox"></div></span>' +
        '<span class="menu-wrap"><button class="ub-link" data-menu="alerts" title="Alerts">🔔' + (counts.alerts ? '<span class="count">' + counts.alerts + '</span>' : '') + '</button><div class="menu menu--right menu--wide" data-menu-body="alerts"></div></span>';
      const n = (counts.alerts || 0) + (counts.conversations || 0);
      document.title = document.title.replace(/^\(\d+\) /, '');
      if (n) document.title = '(' + n + ') ' + document.title;
    }
    applyTheme();
  }

  async function fillMenu(name, body) {
    const u = me();
    if (!u) return;
    if (name === 'user') {
      const s = u.stats;
      body.innerHTML = '<div class="menu-head">' + ui.avatar(u, 'm') + '<div>' + ui.username(u) + '<div class="small muted">' + ui.userTitle(u) + '</div><div class="small muted">Messages: ' + s.posts + ' · Reactions: ' + s.reactionScore + ' · Rep: ' + s.rep + '</div></div></div>' +
        '<a href="#/members/' + u.id + '">Your profile</a><a href="#/whats-new/feed">Your news feed</a><a href="#/members/' + u.id + '/postings">Your content</a><a href="#/account/bookmarks">Bookmarks</a><a href="#/account/watched">Watched threads</a><hr>' +
        '<a href="#/account/details">Account details</a><a href="#/account/personal">Personal details</a><a href="#/account/security">Password &amp; security</a><a href="#/account/privacy">Privacy</a><a href="#/account/preferences">Preferences</a><a href="#/account/signature">Signature</a><a href="#/account/following">Following</a><a href="#/account/ignoring">Ignoring</a><a href="#/account/vip">👑 VIP membership</a><a href="#/account/purchases">Purchases</a><hr>' +
        (store.can('profile_post.create') ? '<form data-form="status" class="menu-status"><input name="content" placeholder="Update your status…" maxlength="140"><button class="btn btn-sm">Post</button></form>' : '') + '<button data-act="logout">Log out</button>';
    } else if (name === 'alerts') {
      body.innerHTML = '<div class="menu-title">Alerts</div><div class="empty small">Loading…</div>';
      const d = await api.get('/notifications', { limit: 8 });
      body.innerHTML = '<div class="menu-title">Alerts <button class="link small" data-act="alerts-read-all">Mark read</button></div><div class="alerts-list">' + (d.notifications.length ? d.notifications.map(views.alertRow).join('') : '<div class="empty small">You have no alerts.</div>') + '</div><a class="menu-foot" href="#/alerts">Show all</a>';
    } else if (name === 'inbox') {
      body.innerHTML = '<div class="menu-title">Conversations</div><div class="empty small">Loading…</div>';
      const d = await api.get('/conversations');
      body.innerHTML = '<div class="menu-title">Conversations ' + (store.can('conversation.start') ? '<a class="small" href="#/conversations/new">Start new</a>' : '') + '</div>' + (d.conversations.length ? d.conversations.slice(0, 6).map((c) => '<a class="alert-row' + (c.unread ? ' unread' : '') + '" href="#/conversations/' + c.id + '">' + ui.avatar(store.user(c.last && c.last.authorId), 's').replace(/<a /, '<span ').replace(/<\/a>/, '</span>') + '<span class="grow"><b>' + esc(c.title) + '</b><span class="small muted block">' + esc(PP.snippet(c.last ? c.last.content : '', 60)) + ' · ' + esc(PP.timeAgo(c.lastMessageAt)) + '</span></span></a>').join('') : '<div class="empty small">You have no conversations.</div>') + '<a class="menu-foot" href="#/conversations">Show all</a>';
    }
  }

  function applyTheme() {
    const u = me();
    let t = 'auto';
    try { t = (u && u.prefs.theme) || localStorage.getItem('pinkpill.theme') || 'auto'; } catch (e) { /* ignore */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = t;
  }

  async function setTheme(t) {
    try { localStorage.setItem('pinkpill.theme', t); } catch (e) { /* ignore */ }
    if (me()) { const r = await api.patch('/account/preferences', { theme: t }); PP.session.user = r.user; }
    applyTheme();
  }

  /* ---------- Cloudflare Turnstile (only when the server provides a site key) ---------- */

  let turnstileLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
      turnstileLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => resolve(window.turnstile);
        s.onerror = () => { turnstileLoading = null; reject(new Error('Could not load the anti-spam check. Check your connection or disable blockers for this site.')); };
        document.head.appendChild(s);
      });
    }
    return turnstileLoading;
  }
  function mountTurnstile(root) {
    const siteKey = PP.session.turnstile && PP.session.turnstile.siteKey;
    const slots = root.querySelectorAll('[data-turnstile]');
    if (!siteKey || !slots.length) return;
    loadTurnstile().then((ts) => slots.forEach((el) => {
      if (el.dataset.widgetId) return;
      el.dataset.widgetId = ts.render(el, { sitekey: siteKey, theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'auto' });
    })).catch((e) => toast(e.message, 'error'));
  }
  function turnstileToken(form) {
    const el = form.querySelector('[data-turnstile]');
    if (!el || !window.turnstile || !el.dataset.widgetId) return undefined;
    return window.turnstile.getResponse(el.dataset.widgetId) || undefined;
  }
  function resetTurnstile(form) {
    const el = form && form.querySelector('[data-turnstile]');
    if (el && window.turnstile && el.dataset.widgetId) window.turnstile.reset(el.dataset.widgetId);
  }

  /* ---------- helpers ---------- */

  function need() { if (!me()) { location.hash = '#/login?return=' + encodeURIComponent(location.hash); return false; } return true; }
  async function run(fn) { try { return await fn(); } catch (e) { toast(e.message, 'error'); return undefined; } }
  const formData = (form) => { const o = {}; new FormData(form).forEach((v, k) => { if (v instanceof File) return; if (k in o) o[k] = [].concat(o[k], v); else o[k] = v; }); return o; };
  const quoteText = (name, content) => '[quote=' + name + ']' + String(content || '').replace(/\[quote[\s\S]*?\[\/quote\]\n?/gi, '').trim() + '[/quote]\n';
  const findPost = (id) => PP.currentThread && PP.currentThread.posts.find((p) => p.id === id);
  const replyBox = () => document.querySelector('form[data-form="reply"] textarea');

  async function afterLogin(ret) {
    await api.loadSession();
    await loadIgnoring();
    await refreshCounts();
    go(ret && /^#\//.test(ret) ? ret : '#/');
  }
  async function loadIgnoring() {
    PP.ignoring = new Set();
    if (!me()) return;
    try { (await api.get('/account/ignoring')).ids.forEach((id) => PP.ignoring.add(String(id))); } catch (e) { /* ignore */ }
  }

  let lastNotified = Date.now();
  async function desktopNotify() {
    let on = false;
    try { on = localStorage.getItem('pinkpill.pref.desktopAlerts') === '1'; } catch (e) { /* ignore */ }
    if (!on || !me() || !('Notification' in window) || Notification.permission !== 'granted' || !counts.alerts) return;
    const d = await api.get('/notifications', { limit: 5 });
    d.notifications.filter((n) => !n.read && new Date(n.at).getTime() > lastNotified).slice(0, 3).forEach((n) => new Notification('PinkPill', { body: n.text }));
    lastNotified = Date.now();
  }

  /* ---------- click actions ---------- */

  const actions = {
    retry() { render(); },
    async logout() { await run(() => api.post('/auth/logout')); PP.session.user = null; await api.loadSession(); PP.ignoring = new Set(); counts = {}; toast('You have been logged out.'); go('#/'); },
    async 'resend-verification'() { if (await run(() => api.post('/auth/resend-verification'))) toast('Verification email sent. Check your inbox.'); },
    async 'mark-all-read'() { if (await run(() => api.post('/forums/read-all'))) { toast('All forums marked read.'); refresh(); } },
    async 'mark-forum-read'(el) { if (await run(() => api.post('/forums/' + el.dataset.id + '/read'))) refresh(); },
    async react(el) {
      if (!need()) return;
      const kind = el.dataset.kind, id = el.dataset.id, mine = el.dataset.mine;
      const base = kind === 'post' ? '/posts/' : '/profile-posts/';
      const chosen = el.closest('.react-picker') ? el.dataset.r : (mine ? null : 'like');
      const ok = await run(() => (chosen && chosen !== mine ? api.put(base + id + '/reaction', { reaction: chosen }) : api.del(base + id + '/reaction')));
      if (ok) refresh();
    },
    async reactors(el) {
      let list;
      if (el.dataset.kind === 'post') list = (await run(() => api.get('/posts/' + el.dataset.id + '/reactions')) || {}).reactions;
      else list = (PP.ppCache || {})[el.dataset.id];
      if (!list) { const t = findPost(el.dataset.id); list = t ? t.reactions : []; }
      modal('Members who reacted', '<div class="member-list">' + list.map((r) => { const m = store.user(r.userId); const def = PP.reactionDef(r.reaction); return m ? '<div class="member-row">' + ui.avatar(m, 's') + '<div class="grow">' + ui.username(m) + '<div class="small muted">' + ui.userTitle(m) + '</div></div><span style="font-size:1.4em">' + (def ? def.emoji : '') + '</span></div>' : ''; }).join('') + '</div>');
    },
    quote(el) {
      const ta = replyBox(); const p = findPost(el.dataset.id);
      if (!ta || !p) return;
      ui.insertAt(ta, quoteText((store.user(p.authorId) || {}).username || 'Member', p.content));
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
      PP.multiQuote.map(findPost).filter(Boolean).forEach((p) => ui.insertAt(ta, quoteText((store.user(p.authorId) || {}).username || 'Member', p.content)));
      PP.multiQuote = [];
      const b = document.querySelector('[data-act="mq-insert"]'); if (b) b.hidden = true;
    },
    'edit-post'(el) {
      const p = findPost(el.dataset.id); if (!p) return;
      modal('Edit post', '<form data-form="edit-post" data-id="' + p.id + '">' + ui.editor('content', p.content, { rows: 10 }) + '<label class="field"><span>Edit reason (optional)</span><input name="reason" maxlength="100"></label><div class="form-actions"><button class="btn btn-primary">Save</button> <button type="button" class="btn" data-close>Cancel</button></div></form>', { wide: true });
    },
    'delete-post'(el) {
      const first = el.dataset.first;
      modal('Delete post', '<form data-form="delete-post" data-id="' + el.dataset.id + '"><p>' + (first ? 'This is the first post: deleting it will <b>delete the whole thread</b>.' : 'Are you sure you want to delete this post?') + '</p><label class="field"><span>Reason for deletion</span><input name="reason" maxlength="100"></label><div class="form-actions"><button class="btn btn-danger">Delete</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
    },
    async 'undelete-post'(el) { if (await run(() => api.post('/posts/' + el.dataset.id + '/restore'))) refresh(); },
    async history(el) {
      const d = await run(() => api.get('/posts/' + el.dataset.id + '/history'));
      if (d) modal('Post history', d.revisions.map((h) => '<div class="history-item"><div class="small muted">Version from ' + esc(PP.dateTime(h.at)) + '</div><div class="bbwrap">' + PP.bbcode(h.content) + '</div></div>').join('') || '<p>No history.</p>', { wide: true });
    },
    report(el) {
      if (!need()) return;
      modal('Report content', '<form data-form="report" data-kind="' + el.dataset.kind + '" data-id="' + el.dataset.id + '"><p class="small muted">Reports are sent to moderators. Please explain what rule this breaks.</p>' +
        '<label class="field"><span>Reason</span><select name="preset"><option value="">Choose…</option><option>Low-effort post outside Off-Topic</option><option>Necroposting</option><option>Illegal content</option><option>Sexualizing minors</option><option>Multiple or shared accounts</option><option>Posting for a banned user</option><option>Gore or shock material</option><option>Scat</option><option>Repfarming</option><option>Trolling / disruption</option><option>Private content</option><option>Private surgery results</option><option>Doxxing</option><option>Mass-tagging</option><option>Spam or bots</option><option>Impersonation</option><option>Misinformation</option><option>Advertising</option><option>Other</option></select></label>' +
        '<label class="field"><span>Details</span><textarea name="reason" rows="3" maxlength="400"></textarea></label><div class="form-actions"><button class="btn btn-primary">Report</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
    },
    async bookmark(el) {
      if (!need()) return;
      const on = !!el.dataset.on;
      if (await run(() => (on ? api.del('/posts/' + el.dataset.id + '/bookmark') : api.put('/posts/' + el.dataset.id + '/bookmark')))) { toast(on ? 'Bookmark removed.' : 'Bookmark added.'); refresh(); }
    },
    share(el) {
      const url = location.href.split('#')[0] + '#/threads/' + el.dataset.thread + '/post-' + el.dataset.id;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied to clipboard.'), () => prompt('Copy this link:', url));
      else prompt('Copy this link:', url);
    },
    async 'watch-thread'(el) {
      if (!need()) return;
      const on = !!el.dataset.on;
      if (await run(() => (on ? api.del('/threads/' + el.dataset.id + '/watch') : api.put('/threads/' + el.dataset.id + '/watch')))) { toast(on ? 'You are no longer watching this thread.' : 'You are now watching this thread.'); refresh(); }
    },
    async 'toggle-sticky'(el) { if (await run(() => api.patch('/threads/' + el.dataset.id, { sticky: !el.dataset.on }))) refresh(); },
    async 'toggle-lock'(el) { if (await run(() => api.patch('/threads/' + el.dataset.id, { locked: !el.dataset.on }))) refresh(); },
    async 'restore-thread'(el) { if (await run(() => api.post('/threads/' + el.dataset.id + '/restore'))) refresh(); },
    async 'move-thread'(el) {
      const d = await run(() => api.get('/forums'));
      if (!d) return;
      modal('Move thread', '<form data-form="move-thread" data-id="' + el.dataset.id + '"><label class="field"><span>Destination forum</span><select name="forumId">' + d.forums.map((f) => '<option value="' + f.id + '"' + (f.id === el.dataset.forum ? ' selected' : '') + '>' + (f.parentId ? '↳ ' : '') + esc(f.title) + '</option>').join('') + '</select></label><label class="check"><input type="checkbox" name="notify" checked> Notify thread starter</label><div class="form-actions"><button class="btn btn-primary">Move</button></div></form>');
    },
    'edit-thread'() {
      const d = PP.currentThread; if (!d) return;
      const t = d.thread;
      modal('Edit thread', '<form data-form="edit-thread" data-id="' + t.id + '"><label class="field"><span>Prefix</span><select name="prefix"><option value="">(No prefix)</option>' + PP.PREFIXES.map((p) => '<option value="' + p.id + '"' + (p.id === t.prefix ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Title</span><input name="title" value="' + esc(t.title) + '" required maxlength="150"></label><label class="field"><span>Tags</span><input name="tags" value="' + esc(t.tags.join(', ')) + '"></label>' +
        (d.poll ? '<label class="check"><input type="checkbox" name="closePoll"' + (d.poll.closed ? ' checked' : '') + '> Close poll</label>' : '') +
        '<div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    'delete-thread'(el) {
      confirmBox('Delete this thread and all its posts? Moderators can restore it later.', async () => {
        if (await run(() => api.del('/threads/' + el.dataset.id, {}))) { toast('Thread deleted.'); go('#/forums/' + el.dataset.forum); }
      }, 'Delete thread');
    },
    'poll-results'(el) { PP.pollResults = el.dataset.id; render(true); },
    'poll-vote-view'() { PP.pollResults = null; const d = PP.currentThread; if (d && d.poll) { d.poll.voted = false; } render(true); },
    async 'poll-change'(el) { if (!need()) return; if (await run(() => api.del('/polls/' + el.dataset.id + '/votes'))) { PP.pollResults = null; refresh(); } },
    'poll-add-option'(el) {
      const box = el.parentElement.querySelector('[data-poll-options]');
      if (box.children.length >= 20) return toast('Maximum 20 options.', 'warn');
      const i = document.createElement('input'); i.name = 'poll_opt'; i.className = 'poll-opt'; i.maxLength = 100; i.placeholder = 'Option ' + (box.children.length + 1); box.appendChild(i); i.focus();
    },
    async follow(el) {
      if (!need()) return;
      const on = !!el.dataset.on;
      if (await run(() => (on ? api.del('/members/' + el.dataset.id + '/follow') : api.put('/members/' + el.dataset.id + '/follow')))) { toast(on ? 'Unfollowed.' : 'You are now following ' + ((store.user(el.dataset.id) || {}).username || 'this member') + '.'); refresh(); }
    },
    async ignore(el) {
      if (!need()) return;
      const on = !!el.dataset.on;
      if (await run(() => (on ? api.del('/members/' + el.dataset.id + '/ignore') : api.put('/members/' + el.dataset.id + '/ignore')))) { await loadIgnoring(); toast(on ? 'You are no longer ignoring this member.' : 'You are now ignoring this member.'); refresh(); }
    },
    'show-ignored'(el) { const art = el.closest('article'); art.innerHTML = art.querySelector('template').innerHTML; art.classList.remove('message--ignored'); },
    warn(el) {
      const m = store.user(el.dataset.id);
      modal('Warn ' + (m ? m.username : 'member'), '<form data-form="warn" data-id="' + el.dataset.id + '"><label class="field"><span>Reason</span><select name="preset"><option>Bullying / unkind feedback</option><option>Dangerous content</option><option>Spam</option><option>Off-topic / derailing</option><option>Inappropriate images</option><option>Other</option></select></label><label class="field"><span>Details</span><input name="details" maxlength="200"></label><label class="field"><span>Points</span><input type="number" name="points" value="1" min="1" max="10"></label><div class="form-actions"><button class="btn btn-primary">Warn</button></div></form>');
    },
    async ban(el) {
      if (el.dataset.on) { if (await run(() => api.del('/mod/users/' + el.dataset.id + '/ban'))) { toast('Ban lifted.'); refresh(); } return; }
      const m = store.user(el.dataset.id);
      modal('Ban ' + (m ? m.username : 'member'), '<form data-form="ban" data-id="' + el.dataset.id + '"><label class="field"><span>Reason (shown to the member)</span><input name="reason" required maxlength="300"></label><label class="field"><span>Length</span><select name="days"><option value="">Permanent ban</option><option value="1">Suspend 1 day</option><option value="3">Suspend 3 days</option><option value="7">Suspend 7 days</option><option value="30">Suspend 30 days</option></select></label><div class="form-actions"><button class="btn btn-danger">Ban member</button></div></form>');
    },
    'set-role'(el) {
      const m = store.user(el.dataset.id);
      modal('Change user group: ' + (m ? m.username : ''), '<form data-form="set-role" data-id="' + el.dataset.id + '"><label class="field"><span>User group</span><select name="role">' + Object.entries(PP.ROLE_TITLES).map(([v, l]) => '<option value="' + v + '"' + (v === el.dataset.role ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><p class="small muted">You can only grant groups below your own.</p><div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    rep(el) {
      if (!need()) return;
      const p = findPost(el.dataset.id); const a = p && store.user(p.authorId);
      modal('Give reputation to ' + (a ? a.username : 'member'), '<form data-form="give-rep" data-id="' + el.dataset.id + '"><p class="small muted">Your rep power is calculated by the server from your activity. You can give up to ' + store.REP_DAILY_LIMIT + ' reps a day. <a href="#/help/reputation" data-close>How rep works</a></p>' +
        '<div class="rep-choice"><label><input type="radio" name="kind" value="pos" checked> <span class="rep rep--3">+ Positive</span> <span class="small muted">helpful, informative, kind</span></label>' +
        '<label><input type="radio" name="kind" value="neg"> <span class="rep rep--neg">− Negative</span> <span class="small muted">harmful advice or rule-breaking</span></label></div>' +
        '<label class="field"><span>Comment <span class="muted small">(optional for positive, required for negative)</span></span><input name="comment" maxlength="200"></label><div class="form-actions"><button class="btn btn-primary">Give rep</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
    },
    async 'rep-list'(el) {
      const d = await run(() => api.get('/posts/' + el.dataset.id + '/reputation'));
      if (!d) return;
      modal('Reputation for this post', '<div class="member-list">' + d.reputation.map((r) => { const g = store.user(r.giverId); return '<div class="member-row">' + ui.avatar(g, 's') + '<div class="grow">' + ui.username(g) + (r.comment ? '<div class="small">“' + esc(r.comment) + '”</div>' : '') + '<div class="small muted">' + esc(PP.timeAgo(r.at)) + '</div></div><span class="rep ' + (r.value < 0 ? 'rep--neg' : 'rep--3') + '">' + (r.value > 0 ? '+' : '') + r.value + '</span>' + (r.canRemove ? ' <button class="btn btn-sm" data-act="rep-remove" data-id="' + r.id + '">Remove</button>' : '') + '</div>'; }).join('') + '</div>');
    },
    'rep-remove'(el) { confirmBox('Remove this reputation?', async () => { if (await run(() => api.del('/reputation/' + el.dataset.id))) { toast('Reputation removed.'); refresh(); } }, 'Remove'); },
    'pp-delete'(el) { confirmBox('Delete this profile post?', async () => { if (await run(() => api.del('/profile-posts/' + el.dataset.id))) refresh(); }, 'Delete'); },
    'pp-comment-toggle'(el) { const f = document.querySelector('form[data-form="pp-comment"][data-id="' + el.dataset.id + '"]'); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); } },
    async 'alerts-read-all'() { if (await run(() => api.post('/notifications/read-all'))) { await refreshCounts(); if (parseHash().path === '/alerts') refresh(); } },
    async 'conv-star'(el) { if (await run(() => api.put('/conversations/' + el.dataset.id + '/star', { starred: !el.dataset.on }))) refresh(); },
    'conv-leave'(el) { confirmBox('Leave this conversation? You\'ll rejoin automatically if someone replies.', async () => { if (await run(() => api.post('/conversations/' + el.dataset.id + '/leave'))) go('#/conversations'); }, 'Leave'); },
    'conv-invite'(el) { modal('Invite members', '<form data-form="conv-invite" data-id="' + el.dataset.id + '"><label class="field"><span>Members to invite</span><input name="names" placeholder="Separate names with a comma" required></label><div class="form-actions"><button class="btn btn-primary">Invite</button></div></form>'); },
    'conv-quote'(el) {
      const d = PP.currentConversation; const m = d && d.messages.find((x) => x.id === el.dataset.id);
      const ta = document.querySelector('form[data-form="conv-reply"] textarea');
      if (!m || !ta) return;
      ui.insertAt(ta, quoteText((store.user(m.authorId) || {}).username || 'Member', m.content)); ta.scrollIntoView({ block: 'center' });
    },
    async 'resolve-report'(el) {
      const note = el.dataset.status === 'rejected' ? (prompt('Why is this report rejected? (optional)') || '') : (prompt('Resolution note (optional):') || '');
      if (await run(() => api.post('/mod/reports/' + el.dataset.id + '/resolve', { status: el.dataset.status || 'resolved', note }))) { toast('Report updated.'); refreshCounts(); refresh(); }
    },
    async 'remove-avatar'() { const r = await run(() => api.patch('/account/profile', { avatarId: null })); if (r) { PP.session.user = r.user; refresh(); } },
    async 'remove-banner'() { const r = await run(() => api.patch('/account/profile', { bannerId: null })); if (r) { PP.session.user = r.user; refresh(); } },
    async 'revoke-sessions'() { if (await run(() => api.post('/account/sessions/revoke-others'))) { toast('Other devices have been logged out.'); refresh(); } },
    'delete-account'() {
      modal('Delete your account', '<form data-form="delete-account"><p>This permanently removes your profile, email and password. Your posts stay up as “Deleted member”. This cannot be undone.</p><label class="field"><span>Confirm with your password</span><input name="password" type="password" required autocomplete="current-password"></label><div class="form-actions"><button class="btn btn-danger">Delete my account</button> <button type="button" class="btn" data-close>Cancel</button></div></form>');
    },
    'edit-forum'(el) {
      const d = PP.adminForums; if (!d) return;
      const f = el.dataset.id ? d.forums.find((x) => x.id === el.dataset.id) : { id: '', title: '', description: '', icon: '💬', categoryId: d.categories[0].id, parentId: null, position: 0 };
      const desc = (id) => { const out = [id]; d.forums.filter((x) => x.parentId === id).forEach((c) => out.push(...desc(c.id))); return out; };
      const parents = d.forums.filter((x) => !(f.id && desc(f.id).includes(x.id)));
      modal(f.id ? 'Edit forum' : 'Add forum', '<form data-form="edit-forum" data-id="' + f.id + '"><label class="field"><span>Title</span><input name="title" value="' + esc(f.title) + '" required maxlength="80"></label><label class="field"><span>Description</span><input name="description" value="' + esc(f.description) + '" maxlength="300"></label><label class="field"><span>Icon (emoji)</span><input name="icon" value="' + esc(f.icon) + '" maxlength="8"></label>' +
        '<label class="field"><span>Category</span><select name="categoryId">' + d.categories.map((c) => '<option value="' + c.id + '"' + (c.id === f.categoryId ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Parent forum <span class="small muted">(makes this a sub-forum)</span></span><select name="parentId"><option value="">(None — top-level forum)</option>' + parents.map((x) => '<option value="' + x.id + '"' + (x.id === f.parentId ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Display order</span><input type="number" name="position" value="' + (f.position || 0) + '"></label>' +
        '<label class="field"><span>Notice shown at the top of the forum</span><input name="notice" value="' + esc(f.notice || '') + '" maxlength="500"></label>' +
        '<label class="check"><input type="checkbox" name="membersOnly"' + (f.membersOnly ? ' checked' : '') + '> 🔒 Members only (hidden from guests)</label>' +
        '<label class="check"><input type="checkbox" name="vipOnly"' + (f.vipOnly ? ' checked' : '') + '> 👑 VIP only (hidden from everyone without an active VIP membership; staff always see it)</label>' +
        '<label class="check"><input type="checkbox" name="staffOnly"' + (f.staffOnly ? ' checked' : '') + '> Only staff can post threads</label><label class="check"><input type="checkbox" name="ratingEnabled"' + (f.ratingEnabled ? ' checked' : '') + '> Rating forum (threads have ratings enabled)</label><div class="form-actions"><button class="btn btn-primary">Save</button></div></form>');
    },
    'delete-forum'(el) { confirmBox('Delete this forum? It must have no threads or sub-forums.', async () => { if (await run(() => api.del('/admin/forums/' + el.dataset.id))) { toast('Forum deleted.'); refresh(); } }, 'Delete'); },
    'edit-category'(el) {
      const d = PP.adminForums; if (!d) return;
      const c = el.dataset.id ? d.categories.find((x) => x.id === el.dataset.id) : { id: '', title: '', position: d.categories.length };
      modal(c.id ? 'Edit category' : 'Add category', '<form data-form="edit-category" data-id="' + c.id + '"><label class="field"><span>Title</span><input name="title" value="' + esc(c.title) + '" required maxlength="80"></label><label class="field"><span>Display order</span><input type="number" name="position" value="' + c.position + '"></label><div class="form-actions"><button class="btn btn-primary">Save</button>' + (c.id ? ' <button type="button" class="btn btn-danger" data-act="delete-category" data-id="' + c.id + '">Delete</button>' : '') + '</div></form>');
    },
    async 'delete-category'(el) { if (await run(() => api.del('/admin/categories/' + el.dataset.id))) { closeModal(); refresh(); } },
    async 'import-legacy-local'() {
      let raw = null;
      try { raw = localStorage.getItem('pinkpill.db.v1'); } catch (e) { /* ignore */ }
      if (raw) await importLegacy(raw);
    },
    'nav-toggle'() { document.body.classList.toggle('nav-open'); },
  };

  async function importLegacy(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return toast('That file is not valid JSON.', 'error'); }
    const r = await run(() => api.post('/admin/import', data));
    const box = document.querySelector('[data-import-result]');
    if (r && box) box.innerHTML = '<div class="notice">Imported: ' + Object.entries(r.imported).map(([k, v]) => esc(k) + ' ' + v).join(', ') + (r.skipped.length ? '<br>Skipped: ' + esc(r.skipped.slice(0, 20).join('; ')) : '') + '</div>';
  }

  document.addEventListener('click', async (e) => {
    const mt = e.target.closest('[data-menu]');
    if (mt) {
      e.preventDefault();
      const body = mt.parentElement.querySelector('[data-menu-body="' + mt.dataset.menu + '"]');
      const open = body.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!open) { body.classList.add('open'); try { await fillMenu(mt.dataset.menu, body); } catch (err) { body.innerHTML = '<div class="empty small">' + esc(err.message) + '</div>'; } }
      return;
    }
    if (!e.target.closest('.menu') || e.target.closest('a, button')) document.querySelectorAll('.menu.open').forEach((m) => { if (!m.contains(e.target) || e.target.closest('a, button[data-act]')) m.classList.remove('open'); });
    const collapse = e.target.closest('[data-collapse]');
    if (collapse) { collapse.parentElement.classList.toggle('collapsed'); return; }
    const el = e.target.closest('[data-act]');
    if (!el || !actions[el.dataset.act]) return;
    e.preventDefault();
    try { await actions[el.dataset.act](el, e); } catch (err) { toast(err.message, 'error'); }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); } });

  /* ---------- forms ---------- */

  const tagsOf = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

  const forms = {
    async login(f, d) {
      await api.post('/auth/login', { login: d.login, password: d.password, stay: !!d.stay, turnstileToken: turnstileToken(f) });
      await afterLogin(f.dataset.return);
      toast('Welcome back, ' + me().username + '!');
    },
    async register(f, d) {
      const r = await api.post('/auth/register', { username: d.username, email: d.email, password: d.password, birthday: d.birthday, agree: !!d.agree, website: d.website || '', turnstileToken: turnstileToken(f) });
      await afterLogin('#/forums/f-intro');
      toast('Welcome to PinkPill, ' + me().username + '! 💗' + (r.emailSent === false ? ' We couldn\'t send your verification email just now; use "Resend email" in a few minutes.' : me().mustVerifyEmail ? ' Check your email to verify your account.' : ''));
    },
    async 'claim-admin'(f, d) {
      await api.post('/auth/claim-admin', { token: d.token });
      await afterLogin('#/mod');
      toast('You are now the super administrator. Remove ADMIN_CLAIM_TOKEN from your server settings.');
    },
    async 'reset-request'(f, d) {
      const r = await api.post('/auth/password-reset/request', { email: d.email, turnstileToken: turnstileToken(f) });
      f.innerHTML = '<h2 class="block-head">Check your email</h2><div class="block-body"><p>' + esc(r.message) + '</p></div>';
    },
    async 'reset-confirm'(f, d) {
      if (d.password !== d.confirm) throw new Error('Passwords don\'t match.');
      await api.post('/auth/password-reset/confirm', { token: f.dataset.token, password: d.password });
      toast('Your password has been changed. Please log in.');
      go('#/login');
    },
    async 'post-thread'(f, d) {
      const opts = [].concat(d.poll_opt || []).map((s) => s.trim()).filter(Boolean);
      let poll = null;
      if ((d.poll_q || '').trim()) {
        if (opts.length < 2) throw new Error('A poll needs at least 2 options.');
        poll = { question: d.poll_q.trim(), options: opts, multiple: !!d.poll_multi, closeDays: d.poll_days ? Number(d.poll_days) : null };
      }
      const r = await api.post('/forums/' + f.dataset.forum + '/threads', { title: d.title, content: d.content, prefix: d.prefix || null, tags: tagsOf(d.tags), poll, ratingEnabled: !!d.rating_enabled, watch: !!d.watch });
      ui.clearDraft(f);
      go('#/threads/' + r.thread.id);
    },
    async reply(f, d) {
      const body = { content: d.content };
      if (d.rating) body.rating = Number(d.rating);
      const r = await api.post('/threads/' + f.dataset.thread + '/posts', body);
      ui.clearDraft(f);
      go('#/threads/' + f.dataset.thread + '/post-' + r.post.id);
    },
    async 'edit-post'(f, d) { await api.patch('/posts/' + f.dataset.id, { content: d.content, reason: d.reason || '' }); closeModal(); await refresh(); },
    async 'delete-post'(f, d) {
      const r = await api.del('/posts/' + f.dataset.id, { reason: d.reason || '' });
      closeModal(); toast(r.deleted === 'thread' ? 'Thread deleted.' : 'Post deleted.');
      if (r.deleted === 'thread') go('#/forums/' + r.forumId); else refresh();
    },
    async report(f, d) {
      const reason = [d.preset, d.reason].filter(Boolean).join(': ');
      await api.post('/reports', { type: f.dataset.kind, id: f.dataset.id, reason });
      closeModal(); toast('Thank you for reporting this content.');
    },
    async 'poll-vote'(f) {
      const vals = [...f.querySelectorAll('input:checked')].map((i) => i.value);
      if (!vals.length) throw new Error('Please select an option.');
      await api.post('/polls/' + f.dataset.id + '/votes', { optionIds: vals });
      toast('Your vote has been cast.'); refresh();
    },
    async 'edit-thread'(f, d) {
      const body = { title: d.title.trim(), prefix: d.prefix || null, tags: tagsOf(d.tags) };
      if (PP.currentThread && PP.currentThread.poll) body.pollClosed = !!d.closePoll;
      await api.patch('/threads/' + f.dataset.id, body);
      closeModal(); refresh();
    },
    async 'move-thread'(f, d) { await api.patch('/threads/' + f.dataset.id, { forumId: d.forumId, notify: !!d.notify }); closeModal(); toast('Thread moved.'); refresh(); },
    'thread-filter'(f, d) {
      const p = new URLSearchParams();
      ['prefix', 'starter', 'unread'].forEach((k) => { if (d[k]) p.set(k, d[k]); });
      if (d.order && d.order !== 'last') p.set('order', d.order);
      if (d.dir && d.dir !== 'desc') p.set('dir', d.dir);
      go('#/forums/' + f.dataset.forum + (p.toString() ? '?' + p : ''));
    },
    async 'find-member'(f, d) { const r = await api.get('/members/by-name/' + encodeURIComponent(d.name.trim())); go('#/members/' + r.id); },
    async 'pp-new'(f, d) { await api.post('/members/' + f.dataset.id + '/profile-posts', { content: d.content }); refresh(); },
    async 'pp-comment'(f, d) { await api.post('/profile-posts/' + f.dataset.id + '/comments', { content: d.content }); refresh(); },
    async status(f, d) {
      if (!d.content.trim()) return;
      await api.post('/members/' + me().id + '/profile-posts', { content: d.content });
      toast('Status updated.'); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); refresh();
    },
    async 'conv-new'(f, d) { const r = await api.post('/conversations', { to: d.to, title: d.title, content: d.content, allowInvite: !!d.allowInvite }); ui.clearDraft(f); go('#/conversations/' + r.id); },
    async 'conv-reply'(f, d) { await api.post('/conversations/' + f.dataset.id + '/messages', { content: d.content }); ui.clearDraft(f); await render(); window.scrollTo(0, document.body.scrollHeight); },
    async 'conv-invite'(f, d) { await api.post('/conversations/' + f.dataset.id + '/invite', { names: d.names }); closeModal(); toast('Members invited.'); refresh(); },
    search(f, d) {
      const p = new URLSearchParams();
      Object.entries({ q: d.q, m: d.m, t: d.t, f: d.f, titles: d.titles, o: d.o !== 'date' ? d.o : '' }).forEach(([k, v]) => { if (v) p.set(k, String(v).trim()); });
      if (!p.get('q') && !p.get('m')) throw new Error('Please enter a search term or member.');
      go('#/search?' + p);
    },
    'quick-search'(f, d) { if (d.q.trim()) go('#/search?q=' + encodeURIComponent(d.q.trim())); },
    async 'account-details'(f, d) { const r = await api.patch('/account/email', { email: d.email.trim(), password: d.password }); PP.session.user = r.user; toast('Your changes have been saved.' + (r.user.emailVerified ? '' : ' Please verify your new email address.')); refresh(); },
    async 'account-personal'(f, d) {
      const changes = { customTitle: d.customTitle.trim(), location: d.location.trim(), website: d.website.trim(), birthday: d.birthday, bio: d.bio, color: d.color };
      const av = f.querySelector('[name=avatar_file]').files[0], bn = f.querySelector('[name=banner_file]').files[0];
      if (av) changes.avatarId = (await api.upload(av, 'avatar')).id;
      if (bn) changes.bannerId = (await api.upload(bn, 'banner')).id;
      const r = await api.patch('/account/profile', changes);
      PP.session.user = r.user; toast('Your changes have been saved.'); refresh();
    },
    async 'account-signature'(f, d) { const r = await api.patch('/account/profile', { signature: d.signature.slice(0, 1000) }); PP.session.user = r.user; toast('Signature saved.'); },
    async 'account-password'(f, d) {
      if (d.new !== d.confirm) throw new Error('Passwords don\'t match.');
      await api.post('/account/password', { current: d.current, new: d.new });
      f.reset(); toast('Your password has been changed. Other devices were logged out.'); refresh();
    },
    async 'account-privacy'(f, d) { const r = await api.patch('/account/preferences', { showOnline: !!d.showOnline, allowDms: d.allowDms, allowProfilePosts: d.allowProfilePosts }); PP.session.user = r.user; toast('Your changes have been saved.'); },
    async 'account-prefs'(f, d) {
      const r = await api.patch('/account/preferences', { theme: d.theme, showSignatures: !!d.showSignatures, autoWatch: !!d.autoWatch });
      PP.session.user = r.user;
      try { localStorage.setItem('pinkpill.pref.desktopAlerts', d.desktopAlerts ? '1' : '0'); localStorage.setItem('pinkpill.theme', d.theme); } catch (e) { /* ignore */ }
      if (d.desktopAlerts && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      applyTheme(); toast('Your changes have been saved.');
    },
    async 'delete-account'(f, d) { await api.del('/account', { password: d.password }); closeModal(); await api.loadSession(); counts = {}; toast('Your account has been deleted.'); go('#/'); },
    async 'give-rep'(f, d) { const r = await api.post('/posts/' + f.dataset.id + '/reputation', { positive: d.kind !== 'neg', comment: d.comment || '' }); closeModal(); toast('You gave ' + (r.value > 0 ? '+' : '') + r.value + ' reputation.'); refresh(); },
    async warn(f, d) { await api.post('/mod/users/' + f.dataset.id + '/warn', { reason: d.preset + (d.details ? ': ' + d.details : ''), points: Number(d.points) || 1 }); closeModal(); toast('Warning issued.'); refresh(); },
    async ban(f, d) { await api.post('/mod/users/' + f.dataset.id + '/ban', { reason: d.reason, days: d.days ? Number(d.days) : null }); closeModal(); toast(d.days ? 'Member suspended.' : 'Member banned.'); refresh(); },
    async 'set-role'(f, d) { await api.patch('/admin/users/' + f.dataset.id + '/role', { role: d.role }); closeModal(); toast('User group updated.'); refresh(); },
    'mod-user-search'(f, d) { go('#/mod/' + f.dataset.tab + (d.q ? '?q=' + encodeURIComponent(d.q) : '')); },
    async 'role-perms'(f) {
      const perms = [...f.querySelectorAll('input[name=perm]:checked')].map((i) => i.value);
      await api.put('/admin/roles/' + f.dataset.id + '/permissions', { permissions: perms });
      toast('Permissions saved.');
    },
    async 'site-settings'(f, d) {
      await api.patch('/admin/settings', { site_name: d.site_name, site_description: d.site_description, registration_open: !!d.registration_open, flood_seconds: Number(d.flood_seconds), rep_daily_limit: Number(d.rep_daily_limit), neg_rep_min_posts: Number(d.neg_rep_min_posts), max_poll_options: Number(d.max_poll_options) });
      toast('Settings saved.');
    },
    async 'edit-forum'(f, d) {
      const body = { title: d.title.trim(), description: d.description.trim(), icon: d.icon || '💬', categoryId: d.categoryId, parentId: d.parentId || null, position: Number(d.position) || 0, staffOnly: !!d.staffOnly, membersOnly: !!d.membersOnly || !!d.vipOnly, vipOnly: !!d.vipOnly, ratingEnabled: !!d.ratingEnabled, notice: d.notice || '' };
      if (f.dataset.id) await api.patch('/admin/forums/' + f.dataset.id, body); else await api.post('/admin/forums', body);
      closeModal(); toast('Forum saved.'); refresh();
    },
    async 'edit-category'(f, d) {
      const body = { title: d.title.trim(), position: Number(d.position) || 0 };
      if (f.dataset.id) await api.patch('/admin/categories/' + f.dataset.id, body); else await api.post('/admin/categories', body);
      closeModal(); refresh();
    },
  };

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f || !forms[f.dataset.form]) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    try { await forms[f.dataset.form](f, formData(f)); } catch (err) { toast(err.message, 'error'); resetTurnstile(f); } finally { if (btn) btn.disabled = false; }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'theme-select') run(() => setTheme(e.target.value));
    if (e.target.matches('[data-import]')) {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => importLegacy(r.result);
      r.readAsText(file);
    }
  });

  /* Member-name autocomplete for inputs marked data-lookup (server-side lookup, 10 results). */
  let lookupTimer = null;
  document.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-lookup]');
    if (!inp) return;
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const term = inp.value.split(',').pop().trim();
      if (term.length < 2) return;
      try {
        const r = await api.get('/members/lookup', { q: term });
        const dl = document.getElementById(inp.getAttribute('list'));
        const prefix = inp.value.includes(',') ? inp.value.slice(0, inp.value.lastIndexOf(',') + 1) + ' ' : '';
        if (dl) dl.innerHTML = r.members.map((m) => '<option value="' + esc(prefix + m.username) + '">').join('');
      } catch (err) { /* ignore */ }
    }, 200);
  });

  document.addEventListener('pp:session-expired', () => {
    toast('Your session has expired. Please log in again.', 'warn');
    counts = {}; renderHeader(parseHash().path);
    api.loadSession().catch(() => {});
  });

  /* ---------- boot ---------- */

  ui.bindUserTips();
  window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); ui.closeModal(); render(); });
  // Poll badge counts only while the tab is visible, so idle tabs don't keep the server and database awake.
  setInterval(async () => { if (document.visibilityState !== 'visible' || !me()) return; await refreshCounts(); desktopNotify().catch(() => {}); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me()) refreshCounts(); });
  document.getElementById('year').textContent = new Date().getFullYear();
  (async () => {
    try { await api.loadSession(); } catch (e) { toast(e.message, 'error'); }
    await loadIgnoring();
    await refreshCounts();
    render();
  })();
})();

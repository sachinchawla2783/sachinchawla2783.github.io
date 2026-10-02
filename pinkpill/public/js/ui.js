/* Reusable UI pieces: avatars, usernames, editor, modals, toasts, pagination. */
(function () {
  'use strict';
  const { esc, store } = window.PP;

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const safeColor = (c) => (HEX.test(c || '') ? c : '#ec4899');
  // VIP username effects are predefined styles picked by id; unknown ids are ignored.
  const VIP_EFFECTS = { glow: 1, shimmer: 1, sparkle: 1, outline: 1 };

  /* VIP decoration comes from the server (u.vip is computed from active entitlements); colors are
     re-validated here so only #RRGGBB values ever reach a style attribute. */
  function vipName(u) {
    const v = u && u.vip;
    if (!v) return { cls: '', style: '' };
    let cls = ' username--vip', style = '';
    const c = v.color;
    if (c && HEX.test(c.hex1 || '')) {
      if (c.hex2 && HEX.test(c.hex2)) { cls += ' username--gradient'; style = '--c1:' + c.hex1 + ';--c2:' + c.hex2; } else style = 'color:' + c.hex1;
    }
    if (v.effect && VIP_EFFECTS[v.effect]) cls += ' vipfx vipfx--' + v.effect;
    return { cls, style };
  }
  const frameAttr = (u) => (u && u.vip && HEX.test(u.vip.frame || '') ? { cls: ' avatar--frame', style: '--frame:' + u.vip.frame + ';' } : { cls: '', style: '' });
  /* Staff badges next to the name: owner black check, global admin glowing gold + tag, moderator glowing purple. */
  const ownerBadge = (u) => {
    if (!u || u.deleted) return '';
    if (u.role === 'super_admin') return '<span class="owner-badge" title="Owner" aria-label="Owner">✔</span>';
    if (u.role === 'global_admin') return '<span class="staff-badge staff-badge--gadmin" title="Global Admin" aria-label="Global Admin">✔</span><span class="staff-tag">Global Admin</span>';
    if (u.role === 'moderator') return '<span class="staff-badge staff-badge--mod" title="Moderator" aria-label="Moderator">✔</span>';
    return '';
  };
  const SPECIAL_COLORS = ['rainbow', 'galaxy', 'inferno', 'frost', 'royal', 'toxic', 'sakura', 'midnight'];
  const SPECIAL_EFFECTS = ['flow', 'pulse', 'sparkle', 'neon'];
  /* Owner-only colour/effect; overrides VIP styling. Ids are checked against fixed lists before use. */
  function specialName(u) {
    const s = u && u.special;
    if (!s || u.role !== 'super_admin' || !SPECIAL_COLORS.includes(s.color)) return null;
    return ' username--special sp--' + s.color + (SPECIAL_EFFECTS.includes(s.effect) ? ' spfx--' + s.effect : '');
  }
  const verifiedBadge = (u) => (u && u.vip && u.vip.badge ? '<span class="vip-verified" title="Lifetime VIP" aria-label="Lifetime VIP">✔</span>' : '');

  function avatar(u, size) {
    size = size || 'm';
    if (!u || u.deleted) return '<span class="avatar avatar-' + size + '" style="background:#999">?</span>';
    const link = '#/members/' + u.id;
    const fr = frameAttr(u);
    if (u.avatarUrl && window.PP.safeUrl(u.avatarUrl)) return '<a href="' + link + '" class="avatar avatar-' + size + fr.cls + '"' + (fr.style ? ' style="' + fr.style + '"' : '') + ' title="' + esc(u.username) + '"><img src="' + esc(u.avatarUrl) + '" alt="' + esc(u.username) + '"></a>';
    return '<a href="' + link + '" class="avatar avatar-' + size + fr.cls + '" style="' + fr.style + 'background:' + safeColor(u.color) + '" title="' + esc(u.username) + '">' + esc(u.username[0].toUpperCase()) + '</a>';
  }

  /* Post-count colour tiers 1..39 get distinct hues (golden-angle spacing); tier 40 is the glowing pink gradient. */
  const tierHue = (t) => Math.round((205 + t * 137.508) % 360);
  function tierName(u) {
    const t = Number(u && u.nameTier) || 0;
    if (t >= 40) return { cls: ' username--tier-max', style: '' };
    if (t >= 1) return { cls: ' username--tier', style: '--th:' + tierHue(t) };
    return null;
  }
  /* Owner style picker (shown on the owner's VIP membership page). */
  function ownerStyleForm(u) {
    const cur = u.special || {};
    const NAMES = { rainbow: 'Rainbow', galaxy: 'Galaxy', inferno: 'Inferno', frost: 'Frost', royal: 'Royal gold', toxic: 'Toxic', sakura: 'Sakura', midnight: 'Midnight' };
    const FX = { flow: 'Flowing colours', pulse: 'Pulsing glow', sparkle: 'Sparkle', neon: 'Neon' };
    const sample = (c, fx) => '<span class="username username--special sp--' + c + (fx ? ' spfx--' + fx : '') + '">' + esc(u.username) + '</span>';
    return '<form class="block form" data-form="owner-style"><h3 class="block-head">✨ Owner style <span class="small muted">— only you can use these</span></h3><div class="block-body">' +
      '<p class="small muted">Special username colours and effects reserved for the owner. They replace any VIP colour.</p>' +
      '<div class="field"><span>Colour</span><div class="owner-swatches">' +
      '<label class="vip-choice"><input type="radio" name="color" value=""' + (!cur.color ? ' checked' : '') + '> None</label>' +
      SPECIAL_COLORS.map((c) => '<label class="vip-choice"><input type="radio" name="color" value="' + c + '"' + (cur.color === c ? ' checked' : '') + '> ' + sample(c, 'flow') + ' <span class="small muted">' + NAMES[c] + '</span></label>').join('') + '</div></div>' +
      '<label class="field"><span>Effect</span><select name="effect"><option value="">None</option>' + SPECIAL_EFFECTS.map((x) => '<option value="' + x + '"' + (cur.effect === x ? ' selected' : '') + '>' + FX[x] + '</option>').join('') + '</select></label>' +
      '<div class="form-actions"><button class="btn btn-primary">Save owner style</button> <span class="small muted">Now: ' + username(u) + '</span></div></div></form>';
  }
  function username(u, cls) {
    if (!u || u.deleted) return '<span class="username">Deleted member</span>';
    const role = u.role === 'admin' || u.role === 'global_admin' || u.role === 'super_admin' ? ' username--admin' : u.role === 'moderator' ? ' username--mod' : '';
    const sp = specialName(u);
    let v = sp ? { cls: sp, style: '' } : vipName(u);
    // Post-count colour for members whose name isn't already coloured by staff role, VIP or owner style.
    if (!sp && !role && !v.style) { const t = tierName(u); if (t) v = { cls: v.cls + t.cls, style: t.style }; }
    return '<a href="#/members/' + u.id + '" class="username' + role + v.cls + (u.banned ? ' username--banned' : '') + ' ' + (cls || '') + '"' + (v.style ? ' style="' + v.style + '"' : '') + ' data-user-tip="' + u.id + '">' + esc(u.username) + '</a>' + ownerBadge(u) + verifiedBadge(u);
  }

  function userTitle(u) {
    if (!u) return '';
    if (u.banned) return 'Banned';
    if (u.customTitle) return esc(u.customTitle);
    return esc(u.rank || '');
  }

  function roleBanner(u) {
    if (!u) return '';
    if (u.role === 'super_admin') return '<div class="role-banner role-banner--owner">Owner</div>';
    if (u.role === 'global_admin') return '<div class="role-banner role-banner--gadmin">Global Admin</div>';
    if (u.role === 'admin') return '<div class="role-banner role-banner--admin">Admin</div>';
    if (u.role === 'moderator') return '<div class="role-banner role-banner--mod">Moderator</div>';
    return '';
  }

  /* NSFW content warning: mature or sensitive but non-explicit content. Shown wherever a thread appears. */
  const nsfwTag = (on) => (on ? '<span class="nsfw-tag" title="Content warning: mature or sensitive (non-explicit) content">NSFW</span> ' : '');

  function prefix(id) {
    const p = window.PP.PREFIXES.find((x) => x.id === id);
    return p ? '<span class="prefix" style="--c:' + p.color + '">' + esc(p.label) + '</span> ' : '';
  }

  function pagination(total, perPage, page, base) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    if (pages <= 1) return '';
    const link = (n, label, cls) => '<a class="page' + (cls ? ' ' + cls : '') + '" href="' + base + (n > 1 ? '/page-' + n : '') + '">' + (label || n) + '</a>';
    let h = '<nav class="pagination">';
    if (page > 1) h += link(page - 1, '‹ Prev');
    const shown = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
    let last = 0;
    [...shown].sort((a, b) => a - b).forEach((n) => {
      if (n - last > 1) h += '<span class="page-gap">…</span>';
      h += n === page ? '<span class="page current">' + n + '</span>' : link(n);
      last = n;
    });
    if (page < pages) h += link(page + 1, 'Next ›');
    h += '<span class="page-of">Page ' + page + ' of ' + pages + '</span></nav>';
    return h;
  }

  function breadcrumb(items) {
    return '<nav class="breadcrumb">' + [['#/', 'Forums']].concat(items).map((it, i, a) =>
      i === a.length - 1 && a.length > 1 ? '<span>' + esc(it[1]) + '</span>' : '<a href="' + it[0] + '">' + esc(it[1]) + '</a>').join('<span class="sep">›</span>') + '</nav>';
  }

  /* ---------- editor ---------- */

  const TOOLBAR = [
    ['b', '<b>B</b>', 'Bold'], ['i', '<i>I</i>', 'Italic'], ['u', '<u>U</u>', 'Underline'], ['s', '<s>S</s>', 'Strike'],
    ['color', '🎨', 'Colour'], ['size', 'A±', 'Size'], ['url', '🔗', 'Link'], ['img', '🖼️', 'Image URL'], ['upload', '📎', 'Upload image'],
    ['media', '▶️', 'Embed YouTube'], ['quote', '❝', 'Quote'], ['spoiler', '🙈', 'Spoiler'], ['code', '&lt;/&gt;', 'Code'], ['list', '•', 'List'],
    ['center', '≡', 'Center'], ['emoji', '😊', 'Emoji'], ['preview', '👁', 'Preview'],
  ];
  const EMOJI = '😀 😂 🥹 😊 😍 🥰 😘 😎 🤔 😮 😢 😭 😤 🙄 😴 🤗 🫶 💖 💕 💗 ✨ 🌸 🌷 💅 💄 💋 👑 💎 🔥 💯 👏 🙏 💪 🏋️‍♀️ 🧴 💇‍♀️ 👗 👠 ☕ 🎧'.split(' ');

  function editor(name, value, opts) {
    opts = opts || {};
    return '<div class="editor" data-editor>' +
      '<div class="editor-toolbar">' + TOOLBAR.map((t) => '<button type="button" class="tb" data-tb="' + t[0] + '" title="' + t[2] + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="editor-emoji" hidden>' + EMOJI.map((e) => '<button type="button" data-emoji="' + e + '">' + e + '</button>').join('') + '</div>' +
      '<textarea name="' + name + '" rows="' + (opts.rows || 6) + '" placeholder="' + esc(opts.placeholder || 'Write your message…') + '"' + (opts.required ? ' required' : '') + '>' + esc(value || '') + '</textarea>' +
      '<div class="editor-preview bbwrap" hidden></div>' +
      '<input type="file" accept="image/*" hidden data-upload>' +
      '</div>';
  }

  function wrapSel(ta, open, close, fallback) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || fallback || '';
    ta.setRangeText(open + sel + close, s, e, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertAt(ta, text) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); }

  function bindEditors(root) {
    root.querySelectorAll('[data-editor]').forEach((ed) => {
      if (ed._bound) return; ed._bound = true;
      const ta = ed.querySelector('textarea');
      const pv = ed.querySelector('.editor-preview');
      const emo = ed.querySelector('.editor-emoji');
      const file = ed.querySelector('[data-upload]');
      // restore draft
      const draftKey = ed.closest('[data-draft]') && 'pinkpill.draft.' + ed.closest('[data-draft]').dataset.draft;
      if (draftKey && !ta.value) { try { ta.value = localStorage.getItem(draftKey) || ''; } catch (e) { /* ignore */ } }
      if (draftKey) ta.addEventListener('input', () => { try { localStorage.setItem(draftKey, ta.value); } catch (e) { /* ignore */ } });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); const f = ta.closest('form'); if (f) f.requestSubmit(); }
        if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key)) { e.preventDefault(); wrapSel(ta, '[' + e.key + ']', '[/' + e.key + ']'); }
      });
      ed.addEventListener('click', async (e) => {
        const em = e.target.closest('[data-emoji]');
        if (em) { insertAt(ta, em.dataset.emoji); return; }
        const b = e.target.closest('[data-tb]');
        if (!b) return;
        const t = b.dataset.tb;
        if (['b', 'i', 'u', 's', 'spoiler', 'code', 'center', 'quote'].includes(t)) wrapSel(ta, '[' + t + ']', '[/' + t + ']');
        else if (t === 'url') { const u = prompt('Link URL:', 'https://'); if (u) wrapSel(ta, '[url=' + u + ']', '[/url]', u); }
        else if (t === 'img') { const u = prompt('Image URL:', 'https://'); if (u) insertAt(ta, '[img]' + u + '[/img]'); }
        else if (t === 'media') { const u = prompt('YouTube URL:'); if (u) insertAt(ta, '[media]' + u + '[/media]'); }
        else if (t === 'color') { const c = prompt('Colour (name or #hex):', '#ec4899'); if (c) wrapSel(ta, '[color=' + c + ']', '[/color]'); }
        else if (t === 'size') { const n = prompt('Size 1-7:', '4'); if (n) wrapSel(ta, '[size=' + n + ']', '[/size]'); }
        else if (t === 'list') wrapSel(ta, '[list]\n[*]', '\n[*]\n[/list]');
        else if (t === 'emoji') emo.hidden = !emo.hidden;
        else if (t === 'upload') file.click();
        else if (t === 'preview') {
          pv.hidden = !pv.hidden;
          ta.hidden = !pv.hidden;
          if (!pv.hidden) pv.innerHTML = window.PP.bbcode(ta.value) || '<em class="muted">Nothing to preview.</em>';
          b.classList.toggle('active', !pv.hidden);
        }
      });
      file.addEventListener('change', async () => {
        const f = file.files[0]; file.value = '';
        if (!f) return;
        try {
          toast('Uploading image…');
          const r = await window.PP.api.upload(f, 'post');
          insertAt(ta, '[img]' + r.url + '[/img]\n');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function clearDraft(form) {
    const d = form.closest('[data-draft]') || form.querySelector('[data-draft]') || (form.matches('[data-draft]') && form);
    if (d) try { localStorage.removeItem('pinkpill.draft.' + d.dataset.draft); } catch (e) { /* ignore */ }
  }

  /* ---------- toasts & modals ---------- */

  function toast(msg, kind) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast toast--' + (kind || 'info');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('hide'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  function modal(title, bodyHtml, opts) {
    opts = opts || {};
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = '<div class="modal' + (opts.wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close" aria-label="Close">×</button></div><div class="modal-body">' + bodyHtml + '</div></div>';
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.modal-close') || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(wrap);
    bindEditors(wrap);
    const first = wrap.querySelector('input, textarea, select, button:not(.modal-close)');
    if (first) first.focus();
    return wrap;
  }

  function closeModal() { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); }

  function confirmBox(msg, onYes, yesLabel) {
    const m = modal('Please confirm', '<p>' + esc(msg) + '</p><div class="form-actions"><button class="btn btn-primary" data-yes>' + esc(yesLabel || 'Confirm') + '</button> <button class="btn" data-close>Cancel</button></div>');
    m.querySelector('[data-yes]').addEventListener('click', () => { closeModal(); onYes(); });
  }


  /* ---------- member tooltip ---------- */

  let tipTimer = null;
  function bindUserTips() {
    document.addEventListener('mouseover', (e) => {
      const a = e.target.closest('[data-user-tip]');
      if (!a || window.matchMedia('(hover: none)').matches) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(a), 450);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-user-tip]') || e.target.closest('.user-tip')) { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 300); }
    });
    document.addEventListener('mouseover', (e) => { if (e.target.closest('.user-tip')) clearTimeout(tipTimer); });
  }
  function hideTip() { document.querySelectorAll('.user-tip').forEach((t) => t.remove()); }
  function showTip(a) {
    hideTip();
    const u = store.user(a.dataset.userTip); if (!u || u.deleted) return;
    const s = u.stats || { posts: 0, reactionScore: 0, rep: 0, points: 0 };
    const el = document.createElement('div');
    el.className = 'user-tip';
    el.innerHTML = '<div class="user-tip-head">' + avatar(u, 'l') + '<div><div class="user-tip-name">' + username(u) + '</div><div class="muted">' + userTitle(u) + '</div>' +
      '<div class="small muted">Joined ' + window.PP.fullDate(u.joinedAt) + (u.online ? ' · <span class="online-dot"></span> Online now' : u.lastSeenAt ? ' · Last seen ' + window.PP.timeAgo(u.lastSeenAt) : '') + '</div></div></div>' +
      '<dl class="pairs pairs--row"><div><dt>Messages</dt><dd>' + window.PP.num(s.posts) + '</dd></div><div><dt>Reaction score</dt><dd>' + window.PP.num(s.reactionScore) + '</dd></div><div><dt>Rep</dt><dd>' + window.PP.views.repBadge(s.rep) + '</dd></div><div><dt>Points</dt><dd>' + s.points + '</dd></div></dl>';
    document.body.appendChild(el);
    const r = a.getBoundingClientRect();
    el.style.top = (window.scrollY + r.bottom + 6) + 'px';
    el.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 8)) + 'px';
  }

  window.PP.ui = { ownerStyleForm, nsfwTag, safeColor, vipName, tierHue, ownerBadge, SPECIAL_COLORS, SPECIAL_EFFECTS, verifiedBadge, avatar, username, userTitle, roleBanner, prefix, pagination, breadcrumb, editor, bindEditors, clearDraft, toast, modal, closeModal, confirmBox, bindUserTips, insertAt };
})();

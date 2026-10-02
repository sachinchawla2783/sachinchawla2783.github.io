/* Shared helpers: escaping, time formatting, BBCode rendering, images. */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ms = (ts) => (typeof ts === 'number' ? ts : new Date(ts).getTime());

  function timeAgo(ts) {
    ts = ms(ts);
    const d = Date.now() - ts;
    const s = Math.floor(d / 1000);
    if (s < 60) return 'A moment ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' minute' + (m > 1 ? 's' : '') + ' ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hour' + (h > 1 ? 's' : '') + ' ago';
    const days = Math.floor(h / 24);
    if (days === 1) return 'Yesterday at ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days < 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' }) + ' at ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return fullDate(ts);
  }

  const fullDate = (ts) => new Date(ms(ts)).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const dateTime = (ts) => new Date(ms(ts)).toLocaleString();
  const time = (ts) => (ts ? '<time title="' + esc(dateTime(ts)) + '" datetime="' + new Date(ms(ts)).toISOString() + '">' + esc(timeAgo(ts)) + '</time>' : '');
  const num = (n) => Number(n || 0).toLocaleString();

  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^(https?:\/\/|mailto:|#\/)/i.test(u)) return u;
    if (/^\/media\/[0-9a-f-]{36}$/.test(u)) return u;
    return null;
  }

  /* BBCode → HTML. Input is escaped first, then a whitelist of tags is converted. */
  function bbcode(src) {
    let s = esc(src || '');
    const blocks = [];
    // [code] blocks are protected from further parsing
    s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, c) => { blocks.push('<pre class="bb-code">' + c + '</pre>'); return '\u0000' + (blocks.length - 1) + '\u0000'; });
    s = s.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, u) => {
      const url = safeUrl(u.replace(/&amp;/g, '&'));
      return url ? '<img class="bb-img" loading="lazy" src="' + esc(url) + '" alt="Image">' : '';
    });
    s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, u, t) => {
      const url = safeUrl(u.replace(/&amp;/g, '&'));
      return url ? '<a href="' + esc(url) + '"' + (url[0] === '#' ? '' : ' target="_blank" rel="noopener nofollow ugc"') + '>' + t + '</a>' : t;
    });
    s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, u) => {
      const url = safeUrl(u.replace(/&amp;/g, '&'));
      return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener nofollow ugc">' + u + '</a>' : u;
    });
    const media = (u) => {
      const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
      if (m) return '<div class="bb-media"><iframe src="https://www.youtube-nocookie.com/embed/' + m[1] + '" allowfullscreen loading="lazy" title="Video"></iframe></div>';
      const url = safeUrl(u);
      return url && url[0] !== '#' ? '<a href="' + esc(url) + '" target="_blank" rel="noopener nofollow ugc">' + esc(url) + '</a>' : esc(u);
    };
    s = s.replace(/\[media\]([\s\S]*?)\[\/media\]/gi, (_, u) => media(u.replace(/&amp;/g, '&')));
    const simple = { b: 'strong', i: 'em', u: 'u', s: 's' };
    Object.keys(simple).forEach((k) => {
      const re = new RegExp('\\[' + k + '\\]([\\s\\S]*?)\\[\\/' + k + '\\]', 'gi');
      for (let i = 0; i < 5; i++) s = s.replace(re, '<' + simple[k] + '>$1</' + simple[k] + '>');
    });
    s = s.replace(/\[color=(#[0-9a-f]{3,6}|[a-z]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
    s = s.replace(/\[size=([1-7])\]([\s\S]*?)\[\/size\]/gi, (_, n, t) => '<span style="font-size:' + [0, 10, 12, 15, 18, 22, 26, 32][n] + 'px">' + t + '</span>');
    s = s.replace(/\[(center|left|right)\]([\s\S]*?)\[\/\1\]/gi, '<div style="text-align:$1">$2</div>');
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, body) => '<ul>' + body.split(/\[\*\]/).slice(1).map((li) => '<li>' + li.trim() + '</li>').join('') + '</ul>');
    for (let i = 0; i < 4; i++) {
      s = s.replace(/\[spoiler(?:=([^\]]*))?\]([\s\S]*?)\[\/spoiler\]/gi, (_, t, body) => '<details class="bb-spoiler"><summary>Spoiler' + (t ? ': ' + t : '') + '</summary><div>' + body + '</div></details>');
      s = s.replace(/\[quote(?:=([^\]]*))?\]([\s\S]*?)\[\/quote\]/gi, (_, who, body) => {
        let head = '';
        if (who) {
          const name = who.split(/,/)[0].replace(/&quot;/g, '').trim();
          head = '<div class="bb-quote-head">' + name + ' said:</div>';
        }
        return '<blockquote class="bb-quote">' + head + '<div>' + body.replace(/^\n|\n$/g, '') + '</div></blockquote>';
      });
    }
    // auto-link bare URLs not already inside tags
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre, u) => pre + '<a href="' + u + '" target="_blank" rel="noopener nofollow ugc">' + u + '</a>');
    s = s.replace(/(^|[\s>])@([A-Za-z0-9_.\-]{3,24})/g, (m, pre, name) => pre + '<a class="mention" href="#/members/@' + name + '">@' + name + '</a>');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/(<\/(?:blockquote|div|ul|li|details|summary|pre)>)<br>/g, '$1').replace(/<br>(<(?:ul|li|\/ul))/g, '$1');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
    return s;
  }

  const stripBB = (s) => String(s || '').replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/gi, '').replace(/\[img\][\s\S]*?\[\/img\]/gi, '[image]').replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, '').trim();
  const snippet = (s, n) => { const t = stripBB(s); return t.length > (n || 140) ? t.slice(0, n || 140) + '…' : t; };


  window.PP = window.PP || {};
  Object.assign(window.PP, { esc, timeAgo, fullDate, dateTime, time, num, bbcode, stripBB, snippet, safeUrl, ms });
})();

/* PinkPill API client. The browser never decides who you are or what you may do: every request
   carries only the HttpOnly session cookie (sent automatically) and the CSRF token. */
(function () {
  'use strict';
  const PP = window.PP = window.PP || {};
  const meta = document.querySelector('meta[name="pinkpill-api"]');
  const BASE = ((meta && meta.content) || '') + '/api';

  PP.users = PP.users || {};         // public member summaries, merged from every response
  PP.session = { user: null, csrf: null, loaded: false };

  class ApiError extends Error {
    constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    const headers = { 'X-Requested-With': 'fetch', Accept: 'application/json' };
    if (PP.session.csrf) headers['X-CSRF-Token'] = PP.session.csrf;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (data && data.users) Object.assign(PP.users, data.users);
    if (!res.ok) {
      const e = (data && data.error) || {};
      const err = new ApiError(res.status, e.code || 'error', e.message || 'Request failed (' + res.status + ').', e.fields);
      if (res.status === 401 && PP.session.user && !opts.noExpire) {
        PP.session.user = null; PP.session.csrf = null;
        document.dispatchEvent(new CustomEvent('pp:session-expired'));
      }
      // The CSRF token rotates with the session; refresh once and retry.
      if (res.status === 403 && /CSRF/i.test(err.message) && !opts.retried) {
        await loadSession();
        return request(method, path, body, Object.assign({}, opts, { retried: true }));
      }
      throw err;
    }
    return data;
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v); });
    const s = p.toString();
    return s ? '?' + s : '';
  }

  async function loadSession() {
    const r = await request('GET', '/auth/session', undefined, { noExpire: true });
    PP.session.user = r.user;
    PP.session.csrf = r.csrfToken;
    PP.session.loaded = true;
    PP.session.requireEmailVerification = r.requireEmailVerification;
    PP.session.turnstile = r.turnstile || { siteKey: null, onLogin: false };
    if (r.user) PP.users[r.user.id] = r.user;
    return r.user;
  }

  PP.ApiError = ApiError;
  PP.api = {
    get: (path, params) => request('GET', path + qs(params)),
    post: (path, body) => request('POST', path, body === undefined ? {} : body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body === undefined ? {} : body),
    del: (path, body) => request('DELETE', path, body),
    upload: (file, purpose) => { const fd = new FormData(); fd.append('purpose', purpose); fd.append('file', file); return request('POST', '/uploads', fd); },
    loadSession,
  };
})();

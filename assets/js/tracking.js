/* Knight Fit tracking: Meta Pixel + Conversions API mirror, attribution capture, and first-party
   visitor analytics for /admin.
   - KF.track(): Meta events. Browser pixel AND /api/track (server → CAPI) with the same event_id,
     so Meta deduplicates. Conversion events can be switched to manual-only in admin Settings.
   - KF.event(): first-party events (page views, sections, clicks, video progress, form steps),
     batched to /api/track and shown on the visitor timeline in /admin. */
(function () {
  'use strict';

  var C = window.KF_CONFIG || {};
  var DAY = 864e5;
  var SESSION_IDLE = 30 * 60 * 1000;
  var ENDPOINT = C.TRACK_ENDPOINT || '/api/track';

  function log() {
    if (C.DEBUG && window.console) console.log.apply(console, ['[KF]'].concat([].slice.call(arguments)));
  }

  /* ---------- storage helpers (never throw: private mode / blocked storage) ---------- */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function getCookie(name) {
    var m = document.cookie.match('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var exp = new Date(Date.now() + days * DAY).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  // "Exclude this browser" (admin → Settings): no pixel, no CAPI, no analytics from this device.
  var ignored = false;
  try { ignored = localStorage.getItem('kf_ignore') === '1'; } catch (e) {}

  /* ---------- visitor + session ids ---------- */
  var visitorId = getCookie('kf_vid') || lsGet('kf_vid') || ('v_' + uid());
  setCookie('kf_vid', visitorId, 365);
  lsSet('kf_vid', visitorId);

  // New session after 30 minutes without activity (or a new tab/browser session).
  var sessionId = ssGet('kf_sid');
  var lastActive = Number(ssGet('kf_sid_last')) || 0;
  var newSession = !sessionId || Date.now() - lastActive > SESSION_IDLE;
  if (newSession) sessionId = 's_' + uid();
  ssSet('kf_sid', sessionId);
  function touchSession() { ssSet('kf_sid_last', Date.now()); }
  touchSession();

  /* ---------- attribution: UTMs, Meta ad ids, click ids, first + last touch ---------- */
  var params = new URLSearchParams(location.search);
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
    'campaign_id', 'adset_id', 'ad_id', 'placement', 'site_source_name', 'fbclid', 'gclid', 'ttclid'];
  var touch = {};
  KEYS.forEach(function (k) { var v = params.get(k); if (v) touch[k] = v; });

  if (Object.keys(touch).length) {
    touch.landing_url = location.href;
    touch.referrer = document.referrer || '';
    touch.ts = new Date().toISOString();
    if (!lsGet('kf_first_touch')) lsSet('kf_first_touch', touch);
    lsSet('kf_last_touch', touch);
  } else if (!lsGet('kf_first_touch')) {
    lsSet('kf_first_touch', { landing_url: location.href, referrer: document.referrer || '', ts: new Date().toISOString() });
  }

  // _fbc: Meta click id cookie, built from fbclid when the pixel hasn't set it yet.
  if (touch.fbclid) {
    var currentFbc = getCookie('_fbc');
    if (!currentFbc || currentFbc.split('.').pop() !== touch.fbclid) {
      setCookie('_fbc', 'fb.1.' + Date.now() + '.' + touch.fbclid, 90);
    }
  }
  // _fbp: browser id. The pixel normally sets this; we set one if it's blocked so CAPI still matches.
  if (!getCookie('_fbp')) setCookie('_fbp', 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10), 90);

  function attribution() {
    return {
      first_touch: lsGet('kf_first_touch') || {},
      last_touch: lsGet('kf_last_touch') || {},
      visitor_id: visitorId,
      session_id: sessionId
    };
  }

  /* ---------- user data for advanced matching ---------- */
  function splitName(full) {
    var parts = String(full || '').trim().split(/\s+/);
    return { fn: parts[0] || '', ln: parts.length > 1 ? parts[parts.length - 1] : '' };
  }
  function normPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) d = '1' + d; // assume US/Canada when no country code
    return d;
  }
  function getUser() { return ssGet('kf_user') || lsGet('kf_user') || {}; }

  function setUser(u) {
    var n = splitName(u.name);
    var user = {
      em: String(u.email || '').trim().toLowerCase(),
      ph: normPhone(u.phone),
      fn: n.fn.toLowerCase(),
      ln: n.ln.toLowerCase()
    };
    ssSet('kf_user', user);
    lsSet('kf_user', user);
    if (window.fbq && C.PIXEL_ID && !ignored) {
      // Re-init with advanced matching; the pixel hashes these values itself.
      window.fbq('init', C.PIXEL_ID, matching());
    }
    log('user set for matching');
  }

  function matching() {
    var u = getUser();
    var m = { external_id: visitorId };
    ['em', 'ph', 'fn', 'ln'].forEach(function (k) { if (u[k]) m[k] = u[k]; });
    return m;
  }

  /* ---------- auto-send switches (admin → Settings) ---------- */
  var auto = ssGet('kf_auto') || {};
  if (!ignored) {
    try {
      fetch(ENDPOINT + '?op=config').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && j.auto) { auto = j.auto; ssSet('kf_auto', auto); }
      }).catch(function () {});
    } catch (e) {}
  }
  function autoOn(name) { return auto[name] !== false; }

  /* ---------- Meta Pixel loader ---------- */
  if (C.PIXEL_ID && !ignored) {
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    // No automatic events (SubscribedButtonClick etc.): every event we want is sent explicitly.
    window.fbq('set', 'autoConfig', false, C.PIXEL_ID);
    window.fbq('init', C.PIXEL_ID, matching());
  }

  /* ---------- transport ---------- */
  function scrollPct() {
    var d = document.documentElement;
    var max = Math.max(1, (d.scrollHeight || 0) - window.innerHeight);
    return Math.max(0, Math.min(100, Math.round((window.scrollY / max) * 100)));
  }
  var maxScroll = 0;
  window.addEventListener('scroll', function () { var s = scrollPct(); if (s > maxScroll) maxScroll = s; }, { passive: true });

  var sentFirst = false;
  function envelope(extra) {
    var b = {
      visitor: {
        id: visitorId,
        fbc: getCookie('_fbc') || undefined,
        fbp: getCookie('_fbp') || undefined
      },
      session: { id: sessionId, is_new: newSession && !sentFirst }
    };
    if (!sentFirst) {
      var ft = lsGet('kf_first_touch') || {};
      var lt = lsGet('kf_last_touch') || {};
      // Fill gaps in first touch from the latest ad click so ad ids are never lost.
      KEYS.forEach(function (k) { if (!ft[k] && lt[k]) ft[k] = lt[k]; });
      b.visitor.first_touch = ft;
      b.visitor.device = {
        screen: (window.screen ? screen.width + 'x' + screen.height : ''),
        language: navigator.language || '',
        timezone: (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || ''
      };
    }
    sentFirst = true;
    for (var k in extra) b[k] = extra[k];
    return b;
  }

  function post(url, body, beacon) {
    if (!url) return Promise.resolve();
    var json = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return Promise.resolve(); } catch (e) {}
    }
    try {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: json.length < 60000 })
        .catch(function (e) { log('send failed', url, e); });
    } catch (e) {
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }));
      return Promise.resolve();
    }
  }

  /* ---------- first-party event queue ---------- */
  var queue = [];
  var timer = null;

  function event(type, name, data) {
    if (ignored) return;
    queue.push({ type: type, name: name || null, path: location.pathname, scroll_pct: scrollPct(), data: data || null, ts: Date.now() });
    touchSession();
    if (queue.length >= 10) flush();
    else if (!timer) timer = setTimeout(flush, 5000);
  }

  function flush(beacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length || ignored) return;
    var batch = queue.splice(0, 50);
    post(ENDPOINT, envelope({ events: batch }), beacon);
  }

  /* ---------- track(): pixel + CAPI with shared event_id ---------- */
  var STANDARD = ['PageView', 'ViewContent', 'Lead', 'SubmitApplication', 'Schedule', 'Contact', 'CompleteRegistration'];

  function track(name, data, opts) {
    data = data || {};
    opts = opts || {};
    var eventId = name + '.' + uid();
    if (ignored) { log('ignored (excluded browser)', name); return eventId; }
    var isStd = STANDARD.indexOf(name) !== -1;

    if (window.fbq && C.PIXEL_ID && autoOn(name)) {
      window.fbq(isStd ? 'track' : 'trackCustom', name, data, { eventID: eventId });
    }

    var u = getUser();
    flush(); // keep timeline order: queued events go first
    post(ENDPOINT, envelope({
      meta: {
        event_name: name,
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: location.href,
        path: location.pathname,
        lead_id: opts.lead_id || undefined,
        custom_data: data,
        user_data: {
          em: u.em || undefined,
          ph: u.ph || undefined,
          fn: u.fn || undefined,
          ln: u.ln || undefined,
          fbp: getCookie('_fbp') || undefined,
          fbc: getCookie('_fbc') || undefined
        }
      }
    }));
    touchSession();
    log(name, data, eventId, autoOn(name) ? '' : '(held: auto-send off)');
    return eventId;
  }

  /* ---------- automatic first-party events ---------- */
  event('pageview', document.title, { referrer: document.referrer || undefined, query: location.search || undefined });

  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var key = el.getAttribute('data-section') || el.id;
        if (!key || seen[key]) return;
        seen[key] = true;
        event('section_view', key);
        io.unobserve(el);
      });
    }, { threshold: 0.35 });
    var observe = function () {
      document.querySelectorAll('[data-section], section[id]').forEach(function (el) { io.observe(el); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe);
    else observe();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a, button, [role="button"]');
    // Form clicks are tracked as app steps; player controls inside a playing video are noise.
    if (!el || el.closest('.apply-card, [data-apply-inline], .is-playing')) return;
    var text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var href = el.getAttribute('href') || '';
    if (el.hasAttribute('data-apply')) return event('cta_click', 'apply_' + (el.getAttribute('data-apply') || 'button'), { text: text });
    if (el.hasAttribute('data-wistia')) return event('click', 'video_' + (el.getAttribute('data-name') || el.getAttribute('data-wistia')), { text: text });
    if (href && /^https?:/i.test(href) && el.host !== location.host) {
      return event('outbound_click', /instagram\.com/i.test(href) ? 'instagram' : el.host, { href: href.slice(0, 300), text: text });
    }
    event('click', text || el.tagName.toLowerCase(), href ? { href: href.slice(0, 300) } : null);
  }, true);

  var startedAt = Date.now();
  var ended = false;
  function endPage(reason) {
    if (ended) return;
    ended = true;
    event('session_end', reason, { max_scroll: Math.max(maxScroll, scrollPct()), seconds_on_page: Math.round((Date.now() - startedAt) / 1000) });
    flush(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { flush(true); }
    else { ended = false; }
  });
  window.addEventListener('pagehide', function () { endPage('pagehide'); });

  window.KF = {
    track: track,
    event: event,
    flush: flush,
    setUser: setUser,
    attribution: attribution,
    send: post,
    visitorId: visitorId,
    sessionId: sessionId,
    ignored: ignored,
    log: log
  };

  track('PageView'); // standard PageView carries no parameters; the URL already has the path
})();

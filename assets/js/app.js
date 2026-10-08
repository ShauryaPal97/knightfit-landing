/* Knight Fit landing page: inline application form, video embeds, sticky CTA. Depends on config.js + tracking.js. */
(function () {
  'use strict';

  var C = window.KF_CONFIG || {};
  var KF = window.KF || { track: function () {}, event: function () {}, flush: function () {}, setUser: function () {}, attribution: function () { return {}; }, send: function () { return Promise.resolve(); }, log: function () {} };

  /* ================= Application steps ================= */
  var STEPS = [
    { id: 'goal', type: 'single', title: "What's the main thing you want right now?",
      options: [
        { v: 'lose-fat', l: 'Lose fat', d: 'Without giving up the food I grew up on' },
        { v: 'build-muscle', l: 'Build muscle and get strong', d: 'Without living in the gym' },
        { v: 'confidence', l: 'Feel confident in my body again', d: 'Look in the mirror and like what I see' },
        { v: 'healthiest', l: "Be the healthiest I've ever been", d: 'And still eat with my family' }
      ] },
    { id: 'challenge', type: 'single', title: "What's been the hardest part so far?",
      options: [
        { v: 'family-food', l: 'Family dinners and events', d: "Mom's cooking, parties, people always offering food" },
        { v: 'time', l: 'Finding the time', d: 'Work and life eat up the whole day' },
        { v: 'consistency', l: 'Staying consistent', d: 'I start strong, then fall off' },
        { v: 'knowledge', l: "Not knowing what actually works", d: 'Too much advice that contradicts itself' }
      ] },
    { id: 'tried', type: 'multi', title: 'What have you tried before?', hint: 'Pick all that apply.',
      options: [
        { v: 'cut-carbs', l: 'Cutting out rice, noodles or carbs' },
        { v: 'calorie-app', l: 'Counting calories in an app' },
        { v: 'gym-alone', l: 'Going to the gym on my own' },
        { v: 'other-coach', l: 'Another coach or program' },
        { v: 'nothing', l: "Nothing yet, this would be my first time", exclusive: true }
      ] },
    { id: 'invest', type: 'single', title: "Coaching is a real investment. If it's the right fit, are you ready?",
      options: [
        { v: 'ready-now', l: "Yes, I'm ready to start this month" },
        { v: 'ready-if-fit', l: "Yes, if it's the right fit", d: 'I want to talk it through on a call first' },
        { v: 'budget', l: 'I need to think about my budget', d: 'I might be ready after we talk' },
        { v: 'not-investing', l: 'Not looking to invest right now', d: "I'm just after free tips", dq: 'not_investing' }
      ] },
    { id: 'about', type: 'fields', title: 'A little about you',
      fields: [
        { n: 'age', l: 'Age', type: 'number', inputmode: 'numeric', req: true, ph: 'e.g. 29', min: 13, max: 99 },
        { n: 'occupation', l: 'What do you do for work?', req: true, ph: 'e.g. Nurse, engineer, business owner', ac: 'organization-title' }
      ] },
    { id: 'contact', type: 'fields', title: 'Where should I reach you?', hint: 'I read every application myself.',
      fields: [
        { n: 'name', l: 'Full name', req: true, ph: 'Your name', ac: 'name' },
        { n: 'email', l: 'Email', type: 'email', inputmode: 'email', req: true, ph: 'you@email.com', ac: 'email' },
        { n: 'phone', l: 'Phone', type: 'tel', inputmode: 'tel', req: true, ph: '(555) 555-5555', ac: 'tel' },
        { n: 'instagram', l: 'Instagram', req: true, ph: '@yourhandle', ac: 'off' }
      ] }
  ];

  var state = { i: 0, answers: {}, source: '', started: false, submitting: false, done: false };
  var card, body, bar, count, backBtn;

  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function optionLabel(stepId, v) {
    var s = STEPS.filter(function (x) { return x.id === stepId; })[0];
    var o = s && s.options && s.options.filter(function (x) { return x.v === v; })[0];
    return o ? o.l : v;
  }

  function mount(root) {
    card = root;
    card.innerHTML =
      '<div class="apply-top">' +
        '<button type="button" class="apply-back" aria-label="Previous question">&larr;</button>' +
        '<span class="apply-count"></span>' +
        '<span class="apply-top-spacer" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="apply-progress"><div class="apply-bar"></div></div>' +
      '<div class="apply-body"></div>';
    body = card.querySelector('.apply-body');
    bar = card.querySelector('.apply-bar');
    count = card.querySelector('.apply-count');
    backBtn = card.querySelector('.apply-back');
    backBtn.addEventListener('click', back);
    render();
  }

  // First real interaction with the form.
  function markStarted() {
    if (state.started) return;
    state.started = true;
    KF.track('ApplicationStart', { source: state.source || 'inline' });
  }

  // Keep the top of the card visible when a step changes (long steps, phone keyboard).
  function keepCardInView() {
    var top = card.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function scrollToForm(source) {
    state.source = source;
    KF.track('ApplyClick', { source: source });
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = card.querySelector('input, .apply-opt');
    if (first && window.matchMedia('(hover: hover)').matches) setTimeout(function () { first.focus({ preventScroll: true }); }, 450);
  }

  function back() {
    if (state.i > 0) { state.i--; render(); keepCardInView(); }
  }

  function next() {
    var s = STEPS[state.i];
    var ans = s.type === 'fields' ? undefined : state.answers[s.id];
    var answer = s.type === 'fields' || s.id === 'about' ? undefined : (Array.isArray(ans) ? ans.join(',') : ans);
    KF.track('ApplicationStep', { step: state.i + 1, step_id: s.id, answer: answer });
    // Furthest step reached, for the admin funnel and visitor list.
    KF.event('app_step', s.id, { step: state.i + 1, answer: answer });
    if (state.i < STEPS.length - 1) { state.i++; render(); keepCardInView(); }
    else submit();
  }

  function render() {
    var s = STEPS[state.i];
    count.textContent = 'Question ' + (state.i + 1) + ' of ' + STEPS.length;
    bar.style.width = Math.round(((state.i + 1) / STEPS.length) * 100) + '%';
    backBtn.style.visibility = state.i > 0 ? 'visible' : 'hidden';
    body.innerHTML = '';

    body.appendChild(h('h2', { id: 'apply-title', class: 'apply-q' }, esc(s.title)));
    if (s.hint) body.appendChild(h('p', { class: 'apply-hint' }, esc(s.hint)));

    if (s.type === 'single') renderSingle(s);
    else if (s.type === 'multi') renderMulti(s);
    else renderFields(s);

    // Only move focus once the visitor is using the form, so the page never jumps on load.
    var focusEl = body.querySelector('input');
    if (state.started && focusEl && window.matchMedia('(hover: hover)').matches) focusEl.focus({ preventScroll: true });
  }

  function renderSingle(s) {
    var list = h('div', { class: 'apply-opts', role: 'radiogroup', 'aria-labelledby': 'apply-title' });
    s.options.forEach(function (o) {
      var on = state.answers[s.id] === o.v;
      var b = h('button', { type: 'button', class: 'apply-opt' + (on ? ' is-on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false' },
        '<span class="apply-opt-l">' + esc(o.l) + '</span>' + (o.d ? '<span class="apply-opt-d">' + esc(o.d) + '</span>' : ''));
      b.addEventListener('click', function () {
        state.answers[s.id] = o.v;
        list.querySelectorAll('.apply-opt').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('is-on');
        b.setAttribute('aria-checked', 'true');
        setTimeout(next, 260);
      });
      list.appendChild(b);
    });
    body.appendChild(list);
  }

  function renderMulti(s) {
    var picked = state.answers[s.id] || [];
    var list = h('div', { class: 'apply-opts', role: 'group', 'aria-labelledby': 'apply-title' });
    var cta = h('button', { type: 'button', class: 'btn btn-block apply-next' }, 'Continue');
    function sync() {
      list.querySelectorAll('.apply-opt').forEach(function (x) {
        var on = picked.indexOf(x.getAttribute('data-v')) !== -1;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      cta.disabled = !picked.length;
    }
    s.options.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'apply-opt apply-opt-check', 'data-v': o.v }, '<span class="apply-opt-l">' + esc(o.l) + '</span>');
      b.addEventListener('click', function () {
        var idx = picked.indexOf(o.v);
        if (idx !== -1) picked.splice(idx, 1);
        else if (o.exclusive) picked = [o.v];
        else {
          picked = picked.filter(function (v) { return !s.options.some(function (x) { return x.exclusive && x.v === v; }); });
          picked.push(o.v);
        }
        state.answers[s.id] = picked;
        sync();
      });
      list.appendChild(b);
    });
    cta.addEventListener('click', function () { if (picked.length) next(); });
    body.appendChild(list);
    body.appendChild(h('div', { class: 'apply-actions' })).appendChild(cta);
    sync();
  }

  function renderFields(s) {
    var form = h('form', { class: 'apply-form', novalidate: true });
    s.fields.forEach(function (f) {
      var id = 'kf-' + f.n;
      var wrap = h('div', { class: 'apply-field' });
      wrap.appendChild(h('label', { for: id }, esc(f.l)));
      var input = h('input', {
        id: id, name: f.n, type: f.type || 'text', inputmode: f.inputmode, placeholder: f.ph || '',
        autocomplete: f.ac || 'on', required: !!f.req, min: f.min, max: f.max
      });
      input.value = state.answers[f.n] || '';
      wrap.appendChild(input);
      wrap.appendChild(h('span', { class: 'apply-field-err', 'aria-live': 'polite' }));
      form.appendChild(wrap);
    });
    var last = state.i === STEPS.length - 1;
    var btn = h('button', { type: 'submit', class: 'btn btn-block apply-next' }, last ? 'Send my application' : 'Continue');
    form.appendChild(h('div', { class: 'apply-actions' })).appendChild(btn);
    if (last) {
      form.appendChild(h('p', { class: 'apply-fine' },
        'By applying you agree to our <a href="/tos" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. No spam, ever.'));
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.submitting) return;
      if (!validate(s, form)) return;
      next();
    });
    body.appendChild(form);
  }

  function validate(s, form) {
    var ok = true, firstBad = null;
    s.fields.forEach(function (f) {
      var input = form.elements[f.n];
      var v = input.value.trim();
      var msg = '';
      if (f.req && !v) msg = 'Required';
      else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = 'Check your email address';
      else if (f.type === 'tel' && v && v.replace(/\D/g, '').length < 10) msg = 'Enter a full phone number';
      else if (f.n === 'age' && v && (!/^\d{1,2}$/.test(v) || +v < 13)) msg = 'Enter your age';
      input.classList.toggle('is-bad', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      input.parentNode.querySelector('.apply-field-err').textContent = msg;
      if (msg) { ok = false; firstBad = firstBad || input; }
      state.answers[f.n] = v;
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  function dqReason() {
    var a = state.answers;
    if (a.invest === 'not-investing') return 'not_investing';
    if (a.age && +a.age < (C.MIN_AGE || 21)) return 'under_min_age';
    return null;
  }

  function submit() {
    state.submitting = true;
    state.done = true;
    var a = state.answers;
    var reason = dqReason();
    var qualified = !reason;
    var applicationId = 'app_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    KF.setUser({ name: a.name, email: a.email, phone: a.phone });

    body.innerHTML = '<div class="apply-loading"><span class="spinner" aria-hidden="true"></span><p>Sending your application…</p></div>';

    var link = { lead_id: applicationId };
    var eventId = KF.track('SubmitApplication', { lead_status: qualified ? 'qualified' : 'disqualified', goal: a.goal, invest: a.invest }, link);
    var leadEventId = qualified
      ? KF.track('Lead', { lead_status: 'qualified', goal: a.goal, invest: a.invest, content_name: 'Coaching application' }, link)
      : KF.track('DisqualifiedLead', { reason: reason }, link);

    var payload = {
      application_id: applicationId,
      submitted_at: new Date().toISOString(),
      lead_status: qualified ? 'qualified' : 'disqualified',
      dq_reason: reason,
      contact: { name: a.name, email: a.email, phone: a.phone, instagram: a.instagram || '' },
      answers: {
        goal: { code: a.goal, label: optionLabel('goal', a.goal) },
        challenge: { code: a.challenge, label: optionLabel('challenge', a.challenge) },
        tried_before: (a.tried || []).map(function (v) { return { code: v, label: optionLabel('tried', v) }; }),
        invest: { code: a.invest, label: optionLabel('invest', a.invest) },
        age: a.age ? +a.age : null,
        occupation: a.occupation
      },
      cta_source: state.source || 'inline',
      attribution: KF.attribution(),
      meta: { submit_event_id: eventId, lead_event_id: leadEventId },
      page: { url: location.href, title: document.title, user_agent: navigator.userAgent }
    };

    // Prefills Cal.com's "Additional notes" on /booking so Knight sees the answers on the booking.
    var ans = payload.answers;
    var notes = [
      'Goal: ' + ans.goal.label,
      'Hardest part: ' + ans.challenge.label,
      ans.tried_before.length ? 'Tried: ' + ans.tried_before.map(function (t) { return t.label; }).join(', ') : '',
      'Ready to invest: ' + ans.invest.label,
      [ans.age ? 'Age: ' + ans.age : '', ans.occupation ? 'Work: ' + ans.occupation : ''].filter(Boolean).join(' · '),
      a.instagram ? 'Instagram: ' + a.instagram : ''
    ].filter(Boolean).join('\n');

    try {
      sessionStorage.setItem('kf_applicant', JSON.stringify({
        name: a.name, email: a.email, phone: a.phone, lead_status: payload.lead_status, application_id: applicationId, notes: notes
      }));
    } catch (e) {}

    var timeout = new Promise(function (r) { setTimeout(r, 3500); });
    Promise.race([KF.send(C.LEAD_ENDPOINT, payload), timeout]).then(function () {
      state.submitting = false;
      if (qualified) {
        // Small pause so the pixel request leaves before navigation.
        setTimeout(function () { location.href = '/booking'; }, 350);
      } else {
        renderDq(reason);
      }
    });
  }

  function renderDq(reason) {
    state.done = true;
    var sticky = document.querySelector('.sticky-cta');
    if (sticky) sticky.classList.remove('is-on');
    bar.style.width = '100%';
    count.textContent = '';
    backBtn.style.visibility = 'hidden';
    var why = reason === 'under_min_age'
      ? "Right now I only coach people " + (C.MIN_AGE || 21) + " and up. That's not a knock on you, it's just where I do my best work."
      : "Coaching only works when you're ready to put money and time into it. No pressure at all. When that changes, come back and apply again.";
    body.innerHTML =
      '<div class="apply-done">' +
        '<h2 class="apply-q" id="apply-title">Thanks for applying. It\'s not the right time yet.</h2>' +
        '<p>' + esc(why) + '</p>' +
        '<p>In the meantime, I post free content on Instagram, including the food I actually eat and how I train.</p>' +
        '<a class="btn btn-block" href="' + esc(C.INSTAGRAM_URL || '#') + '" target="_blank" rel="noopener" data-ig>Follow @knightnakanishi</a>' +
      '</div>';
    var ig = body.querySelector('[data-ig]');
    if (ig) ig.addEventListener('click', function () { KF.track('InstagramClick', { from: 'dq_screen' }); });
  }

  /* ================= Videos (Wistia) ================= */
  var wistiaLoaded = false;
  function loadWistia() {
    if (wistiaLoaded) return;
    wistiaLoaded = true;
    var s = document.createElement('script');
    s.src = 'https://fast.wistia.com/assets/external/E-v1.js';
    s.async = true;
    document.head.appendChild(s);
  }

  function mountVideo(node, opts) {
    var id = node.getAttribute('data-wistia');
    if (!id) return;
    node.addEventListener('click', function () {
      if (node.classList.contains('is-playing')) return;
      node.classList.add('is-playing');
      node.innerHTML = '<div class="wistia_embed wistia_async_' + id + ' videoFoam=false autoPlay=true playsinline=true" style="position:absolute;inset:0;width:100%;height:100%"></div>';
      loadWistia();
      window._wq = window._wq || [];
      window._wq.push({
        id: id,
        onReady: function (video) { trackPlayer(video, id, opts); }
      });
    }, { once: false });
  }

  // Shared by Wistia players and the self-hosted VSL (via nativePlayer, which mimics Wistia's API).
  function trackPlayer(video, id, opts) {
    var label = opts.label || id;
    KF.track(opts.vsl ? 'ViewContent' : 'TestimonialPlay', { content_name: label, content_type: 'video', video_id: id });
    if (!opts.vsl) return;
    var fired = {};
    video.bind('percentwatchedchanged', function (p) {
      [25, 50, 75, 95].forEach(function (m) {
        if (p * 100 >= m && !fired[m]) { fired[m] = true; KF.track('VideoProgress', { video_id: id, percent: m }); }
      });
    });
    trackWatchTime(video, id);
  }

  // Wraps a <video> element in the slice of Wistia's player API that the tracking uses.
  // Seconds watched = unique seconds played (video.played ranges), same as Wistia's secondsWatched.
  function nativePlayer(v) {
    function watched() {
      var t = 0;
      for (var i = 0; i < v.played.length; i++) t += v.played.end(i) - v.played.start(i);
      return t;
    }
    function duration() { return isFinite(v.duration) ? v.duration : 0; }
    function percent() { return duration() ? Math.min(1, watched() / duration()) : 0; }
    var EVENTS = { play: 'play', pause: 'pause', end: 'ended', secondchange: 'timeupdate', percentwatchedchanged: 'timeupdate' };
    return {
      secondsWatched: watched,
      percentWatched: percent,
      duration: duration,
      bind: function (name, fn) {
        v.addEventListener(EVENTS[name], function () { fn(name === 'percentwatchedchanged' ? percent() : undefined); });
      }
    };
  }

  function mountNativeVsl(node) {
    node.addEventListener('click', function () {
      if (node.classList.contains('is-playing')) return;
      node.classList.add('is-playing');
      var v = document.createElement('video');
      v.src = C.VSL_SRC;
      v.controls = true;
      v.playsInline = true;
      v.preload = 'auto';
      if (C.VSL_POSTER) v.poster = C.VSL_POSTER;
      node.innerHTML = '';
      node.appendChild(v);
      trackPlayer(nativePlayer(v), 'vsl', { vsl: true, label: 'VSL' });
      var p = v.play();
      if (p && p.catch) p.catch(function () {}); // autoplay refused: controls stay up for a manual play
    });
    node.addEventListener('keydown', function (e) {
      if (e.target === node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); node.click(); }
    });
  }

  // VSL watch time for the admin: unique seconds watched + % of the video, sent every 10s of
  // watching and on pause / end / leaving the page.
  function trackWatchTime(video, id) {
    var lastSent = -1;
    function report(trigger) {
      var secs = Math.round(video.secondsWatched() || 0);
      if (secs === lastSent && trigger === 'tick') return;
      lastSent = secs;
      KF.event('video_progress', 'vsl', {
        video_id: id,
        seconds: secs,
        pct: Math.round((video.percentWatched() || 0) * 100),
        duration: Math.round(video.duration() || 0),
        trigger: trigger
      });
      // Leaving / backgrounding: send now (beacon), the page may not get another chance.
      if (trigger === 'exit' || trigger === 'hidden' || trigger === 'end') KF.flush(true);
    }
    video.bind('play', function () { report('play'); });
    video.bind('secondchange', function () {
      var secs = Math.round(video.secondsWatched() || 0);
      if (secs - Math.max(lastSent, 0) >= 10) report('tick');
    });
    video.bind('pause', function () { report('pause'); });
    video.bind('end', function () { report('end'); });
    window.addEventListener('pagehide', function () { report('exit'); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') report('hidden'); });
  }

  function initVideos() {
    var vsl = document.querySelector('[data-vsl]');
    if (vsl && C.VSL_SRC) {
      vsl.classList.remove('is-empty');
      vsl.innerHTML = '<img src="' + (C.VSL_POSTER || '/assets/img/headshot.jpg') + '" alt="" width="1280" height="720" fetchpriority="high">' +
        '<span class="play" aria-hidden="true"></span><span class="video-cap">Tap to watch</span>';
      vsl.setAttribute('role', 'button');
      vsl.setAttribute('aria-label', 'Play video');
      vsl.tabIndex = 0;
      mountNativeVsl(vsl);
    }
    document.querySelectorAll('[data-wistia]:not([data-vsl])').forEach(function (n) {
      mountVideo(n, { label: n.getAttribute('data-name') || '' });
    });
    document.querySelectorAll('[data-wistia]').forEach(function (n) {
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.click(); } });
    });
  }

  /* ================= Sticky CTA ================= */
  // Phone-only "Apply" bar: visible once the form card has scrolled up past the viewport.
  function initSticky() {
    var sticky = document.querySelector('.sticky-cta');
    if (!sticky || !card || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      var passed = !e.isIntersecting && e.boundingClientRect.top < 0;
      sticky.classList.toggle('is-on', passed && !state.done);
    }, { threshold: 0 }).observe(card);
  }

  /* ================= Wire up ================= */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-apply]');
    if (!t) return;
    e.preventDefault();
    scrollToForm(t.getAttribute('data-apply') || 'button');
  });

  var inline = document.querySelector('[data-apply-inline]');
  if (inline) {
    mount(inline);
    inline.addEventListener('click', markStarted);
    inline.addEventListener('input', markStarted);
  }
  initVideos();
  initSticky();

  // Deep link: knightfit.io/#apply jumps straight to the form.
  if (location.hash === '#apply' && card) setTimeout(function () { scrollToForm('deeplink'); }, 300);
})();

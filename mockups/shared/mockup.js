/* Shared mockup behaviour: quiz flow (front-end only) + Wistia video facades.
   Each mockup styles the generated markup with its own CSS. */
(function () {
  'use strict';

  var STEPS = [
    { id: 'culturalFoods', type: 'single', prompt: 'Are you Southeast Asian?',
      options: [{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }] },
    { id: 'situation', type: 'single', prompt: "What's your biggest challenge right now?",
      options: [
        { v: 'time', l: 'Finding time for meal prep', d: 'Busy schedule makes healthy eating hard' },
        { v: 'family-meals', l: 'Balancing family meals with goals', d: 'Family dinners make it difficult to stay on track' },
        { v: 'motivation', l: 'Staying motivated and consistent', d: 'Starting is easy, sticking with it is hard' },
        { v: 'knowledge', l: 'Not knowing what actually works', d: 'Too much conflicting information out there' }
      ] },
    { id: 'goal', type: 'single', prompt: 'How can I help you?',
      options: [
        { v: 'lose-fat', l: 'Lose fat while eating your favorite foods', d: 'Get lean without giving up adobo, pho, or pad thai' },
        { v: 'gain-muscle', l: 'Gain muscle without changing your lifestyle', d: 'Build strength while keeping cultural meals' },
        { v: 'body-confidence', l: 'Be confident in your own body', d: 'Feel strong and proud in your own skin' },
        { v: 'healthy-traditional', l: "Be the healthiest you've ever been", d: 'Still eating traditional foods' }
      ] },
    { id: 'readiness', type: 'single', prompt: 'If this is the right fit, are you ready to invest in coaching?',
      options: [
        { v: 'ready-now', l: "Yes, I'm ready this month", d: 'I want a plan and accountability now' },
        { v: 'ready-if-fit', l: "Yes, if it's the right fit", d: 'I want to talk it through on a call' },
        { v: 'need-to-think', l: 'I need to think about budget', d: 'I might be ready after we talk' },
        { v: 'not-investing', l: 'Not looking to invest right now', d: 'Just browsing or looking for free tips', dq: true }
      ] },
    { id: 'about', type: 'fields', prompt: 'A little about you',
      fields: [
        { n: 'occupation', l: 'Occupation', ph: 'e.g. Nurse, engineer, student', req: true },
        { n: 'age', l: 'Age', ph: 'e.g. 29', type: 'number' }
      ] },
    { id: 'contact', type: 'fields', prompt: 'Where should we send your next step?',
      fields: [
        { n: 'name', l: 'Full name', ph: 'Your name', req: true, ac: 'name' },
        { n: 'email', l: 'Email', ph: 'you@email.com', req: true, type: 'email', ac: 'email' },
        { n: 'phone', l: 'Phone', ph: '(555) 555-5555', req: true, type: 'tel', ac: 'tel' },
        { n: 'social', l: 'Instagram (optional)', ph: '@handle' }
      ] }
  ];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function initQuiz(root) {
    var i = 0, answers = {};

    function render() {
      var s = STEPS[i];
      root.innerHTML = '';
      var head = el('div', 'quiz-head');
      head.appendChild(el('span', 'quiz-count', 'Step ' + (i + 1) + ' of ' + STEPS.length));
      if (i > 0) {
        var back = el('button', 'quiz-back', '&larr; Back');
        back.type = 'button';
        back.onclick = function () { i--; render(); };
        head.appendChild(back);
      }
      root.appendChild(head);
      var bar = el('div', 'quiz-progress');
      var fill = el('div', 'quiz-bar');
      fill.style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
      bar.appendChild(fill);
      root.appendChild(bar);
      root.appendChild(el('h3', 'quiz-q', s.prompt));

      if (s.type === 'single') {
        var list = el('div', 'quiz-opts' + (s.options.length === 2 ? ' is-pair' : ''));
        s.options.forEach(function (o) {
          var b = el('button', 'quiz-opt' + (answers[s.id] === o.v ? ' is-on' : ''));
          b.type = 'button';
          b.innerHTML = '<span class="quiz-opt-l">' + o.l + '</span>' + (o.d ? '<span class="quiz-opt-d">' + o.d + '</span>' : '');
          b.onclick = function () {
            answers[s.id] = o.v;
            b.classList.add('is-on');
            setTimeout(function () { i++; render(); }, 280);
          };
          list.appendChild(b);
        });
        root.appendChild(list);
      } else {
        var form = el('form', 'quiz-form');
        form.noValidate = true;
        s.fields.forEach(function (f) {
          var w = el('label', 'quiz-field');
          w.appendChild(el('span', 'quiz-field-l', f.l));
          var inp = document.createElement('input');
          inp.name = f.n; inp.placeholder = f.ph || ''; inp.type = f.type || 'text';
          if (f.ac) inp.autocomplete = f.ac;
          if (f.req) inp.required = true;
          inp.value = answers[f.n] || '';
          w.appendChild(inp);
          form.appendChild(w);
        });
        var err = el('p', 'quiz-err');
        form.appendChild(err);
        var last = i === STEPS.length - 1;
        var btn = el('button', 'quiz-btn', last ? 'See if I qualify &rarr;' : 'Continue &rarr;');
        btn.type = 'submit';
        form.appendChild(btn);
        if (last) form.appendChild(el('p', 'quiz-fine', 'No spam. Your info is only used to book your call.'));
        form.onsubmit = function (e) {
          e.preventDefault();
          var ok = true;
          s.fields.forEach(function (f) {
            var v = form.elements[f.n].value.trim();
            answers[f.n] = v;
            var bad = (f.req && !v) || (f.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v));
            form.elements[f.n].classList.toggle('is-bad', bad);
            if (bad) ok = false;
          });
          if (!ok) { err.textContent = 'Please fill in the highlighted fields.'; return; }
          if (last) done(); else { i++; render(); }
        };
        root.appendChild(form);
      }
    }

    function done() {
      var dq = answers.readiness === 'not-investing';
      root.innerHTML = '';
      var box = el('div', 'quiz-done');
      box.innerHTML = dq
        ? '<h3 class="quiz-q">Not the right time</h3><p>Coaching only works when you\'re ready to invest. We saved your info. When you\'re ready, come back and apply again.</p>'
        : '<h3 class="quiz-q">You\'re a fit, ' + (answers.name || '').split(' ')[0] + '!</h3><p>Next step: pick a time for your free consultation call.</p><p class="quiz-fine">(Mockup: this goes to the Calendly booking page.)</p>';
      root.appendChild(box);
    }

    render();
  }

  /* Video facade: poster + play button, swaps to Wistia iframe on click. */
  function initVideo(node) {
    var id = node.getAttribute('data-wistia');
    node.addEventListener('click', function () {
      if (node.classList.contains('is-playing')) return;
      node.classList.add('is-playing');
      node.innerHTML = '<iframe src="https://fast.wistia.net/embed/iframe/' + id +
        '?autoPlay=true&playsinline=true" allow="autoplay; fullscreen" allowfullscreen title="Video" frameborder="0"></iframe>';
    });
  }

  document.querySelectorAll('[data-quiz]').forEach(initQuiz);
  document.querySelectorAll('[data-wistia]').forEach(initVideo);
  document.querySelectorAll('[data-scroll-quiz]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var q = document.getElementById('apply');
      if (!q) return;
      e.preventDefault();
      q.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();

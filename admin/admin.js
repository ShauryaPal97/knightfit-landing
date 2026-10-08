/* Knight Fit admin: hash-routed single page. Data comes from /api/admin?op=… (cookie session). */
(function () {
  'use strict';

  /* ================= helpers ================= */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var view = $('#view');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('kfa_' + k);
      localStorage.setItem('kfa_' + k, v);
    } catch (e) { return null; }
  }
  function num(n) { return (Number(n) || 0).toLocaleString('en-US'); }
  function money(n) { return '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '–'; }
  function dur(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  function when(t) {
    if (!t) return '';
    var d = new Date(t);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function day(t) { return t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function clock(t) { return t ? new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''; }
  function ago(t) {
    if (!t) return '';
    var s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return day(t);
  }
  function place(r) { return [r.city, r.country].filter(Boolean).join(', '); }

  var STAGES = [
    ['applied', 'Applied'], ['booked', 'Booked'], ['showed', 'Showed'], ['closed', 'Closed'],
    ['no_show', 'No-show'], ['lost', 'Lost'], ['disqualified', 'Disqualified']
  ];
  var STAGE_LABEL = {};
  STAGES.forEach(function (s) { STAGE_LABEL[s[0]] = s[1]; });
  function stageBadge(s) { return s ? '<span class="badge st-' + esc(s) + '">' + esc(STAGE_LABEL[s] || s) + '</span>' : ''; }
  var STEP_NAMES = ['', 'Goal', 'Challenge', 'Tried before', 'Investment', 'Age + job', 'Contact', 'Submitted'];
  function stepLabel(n) { return n ? (n >= 7 ? 'Submitted' : 'Q' + n + ' ' + STEP_NAMES[n]) : '–'; }
  var SOURCES = [['ad', 'Ad'], ['organic', 'Organic'], ['referral', 'Referral'], ['dm', 'DM'], ['other', 'Other']];

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 5000 : 2600);
  }

  /* ================= API ================= */
  function api(op, params, body) {
    var qs = new URLSearchParams(Object.assign({ op: op }, params || {}));
    Object.keys(params || {}).forEach(function (k) { if (params[k] === '' || params[k] == null) qs.delete(k); });
    return fetch('/api/admin?' + qs.toString(), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && op !== 'login') { showLogin(); throw new Error('unauthorized'); }
        if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
        return j;
      });
    });
  }

  /* ================= auth ================= */
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    var inp = $('#login-form input');
    if (inp) inp.focus();
  }
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
  }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var err = $('.err', f);
    err.textContent = '';
    f.querySelector('button').disabled = true;
    api('login', null, { password: f.password.value }).then(function () {
      f.password.value = '';
      showApp();
      route();
    }).catch(function (ex) {
      err.textContent = ex.message === 'unauthorized' ? 'Incorrect password' : ex.message;
    }).then(function () { f.querySelector('button').disabled = false; });
  });
  $('[data-logout]').addEventListener('click', function () {
    api('logout', null, {}).then(showLogin, showLogin);
  });

  /* ================= nav + router ================= */
  var NAV = [
    ['overview', 'Overview'], ['visitors', 'Visitors'], ['leads', 'Leads'], ['bookings', 'Bookings'],
    ['archived', 'Archived'], ['settings', 'Settings']
  ];
  // The phone bottom bar is the coach view's nav (same routes, simpler pages).
  var COACH_NAV = [['overview', 'Home'], ['leads', 'Leads'], ['bookings', 'Calls'], ['visitors', 'Visitors'], ['settings', 'Settings']];
  // Icons show only in the phone bottom bar.
  var NAV_ICON = {
    overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    visitors: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>',
    leads: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    bookings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    archived: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  $$('[data-nav]').forEach(function (n) {
    var bottom = n.classList.contains('topnav');
    n.innerHTML = (bottom ? COACH_NAV : NAV).map(function (x) {
      var icon = NAV_ICON[bottom && x[0] === 'overview' ? 'home' : x[0]];
      return '<a href="#/' + x[0] + '" data-r="' + x[0] + '">' +
        '<svg class="ni" viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg><span>' + x[1] + '</span></a>';
    }).join('');
  });

  var refreshTimer = null;
  var chart = null;

  function route() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (chart) { chart.destroy(); chart = null; }
    var parts = (location.hash.replace(/^#\/?/, '') || 'overview').split('/');
    var page = parts[0];
    var arg = parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : '';
    var coach = isCoach();
    var tab = page === 'visitor' ? 'visitors' : coach && page === 'archived' ? 'leads' : page;
    $$('[data-r]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-r') === tab); });
    closeDrawer(true);
    var pages = coach
      ? { overview: coachHome, leads: coachLeads, archived: function () { coachLeads('', true); }, bookings: coachCalls,
          visitors: coachVisitors, visitor: coachVisitor, settings: coachSettings }
      : { overview: overview, visitors: visitors, visitor: visitor, leads: leadsPage, archived: archivedPage,
          bookings: bookings, settings: settings };
    (pages[page] || pages.overview)(arg);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  function loading() { view.innerHTML = '<div class="loading">Loading…</div>'; }
  function fail(e) {
    if (e.message === 'unauthorized') return;
    view.innerHTML = '<div class="card"><b>Couldn\'t load this page.</b><p class="muted">' + esc(e.message) + '</p></div>';
  }

  function rangePills(current, ranges) {
    ranges = ranges || ['24h', '7d', '30d', '90d', 'all'];
    return '<div class="pills" data-range>' + ranges.map(function (r) {
      return '<button type="button" data-v="' + r + '" class="' + (r === current ? 'on' : '') + '">' + (r === 'all' ? 'All' : r) + '</button>';
    }).join('') + '</div>';
  }
  function onPills(root, sel, cb) {
    $$(sel + ' button', root).forEach(function (b) {
      b.addEventListener('click', function () { cb(b.getAttribute('data-v')); });
    });
  }

  function bars(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty">No data yet</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    var total = opts.total || rows.reduce(function (a, r) { return a + r.n; }, 0) || 1;
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar-row"><span class="k" title="' + esc(r.k) + '">' + esc(r.k || '(none)') + '</span>' +
        '<span class="track"><span class="fill ' + (opts.color || '') + '" style="width:' + Math.max(1, (r.n / max) * 100) + '%"></span></span>' +
        '<span class="v">' + num(r.n) + '<small>' + pct(r.n, total) + '</small></span></div>';
    }).join('') + '</div>';
  }

  function csvDownload(name, cols, rows) {
    var cell = function (v) {
      if (v == null) return '';
      var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s(]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var out = [cols.map(function (c) { return c[1]; }).join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return cell(typeof c[0] === 'function' ? c[0](r) : r[c[0]]); }).join(',');
    })).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv' }));
    a.download = 'knight-' + name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ================= Overview ================= */
  function overview() {
    var range = store('ov_range') || '7d';
    var level = store('ov_level') || 'campaign';
    loading();

    function load(quiet) {
      if (!quiet) loading();
      api('overview', { range: range, level: level }).then(function (d) { render(d); }).catch(fail);
    }

    function render(d) {
      var k = d.kpi, f = d.funnel;
      var showRate = k.showed + k.no_show ? pct(k.showed, k.showed + k.no_show) : '–';
      var funnel = [
        ['Landed', f.landed], ['Played VSL', f.played], ['Watched 50% VSL', f.vsl50], ['Started application', f.started],
        ['Submitted', f.submitted], ['Qualified', f.qualified], ['Booked call', f.booked], ['Showed', f.showed], ['Closed', f.closed]
      ];
      var top = f.landed || 1;
      var stepsMax = (d.steps[0] && d.steps[0].n) || 0;
      var levelLabel = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' }[level];

      view.innerHTML =
        '<div class="ph"><div><h1>Overview</h1><div class="sub">New visitors in range and what they did. Refreshes every 30s.</div></div>' +
        '<div class="actions">' + rangePills(range) + '</div></div>' +

        '<div class="kpis">' +
          kpi('Visitors', num(k.visitors)) +
          kpi('Applications', num(k.applications)) +
          kpi('Qualified', num(k.qualified), pct(k.qualified, k.applications) + ' of applications') +
          kpi('Calls booked', num(k.bookings), pct(k.bookings, k.qualified) + ' of qualified', 'accent') +
          kpi('Show rate', showRate, num(k.showed) + ' showed · ' + num(k.no_show) + ' no-show') +
          kpi('Closed', num(k.closed)) +
          kpi('Revenue', money(k.revenue), '', 'good') +
        '</div>' +

        '<div class="grid g-wide">' +
          '<div class="card"><h2>' + (d.hourly ? 'Visitors per hour' : 'Visitors per day') + '<span class="muted" style="letter-spacing:0;text-transform:none;font-weight:400">— applications in amber</span></h2><div class="chart-box"><canvas id="ov-chart"></canvas></div></div>' +
          '<div class="card"><h2>VSL</h2>' +
            '<div class="kpis" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">' +
              kpiMini('Plays', num(f.played), pct(f.played, f.landed) + ' of visitors') +
              kpiMini('Avg watched', dur(f.vsl_avg_seconds), Math.round(f.vsl_avg_pct) + '% of video') +
            '</div>' +
            bars([
              { k: 'Started', n: f.played }, { k: 'Reached 25%', n: f.vsl25 }, { k: 'Reached 50%', n: f.vsl50 },
              { k: 'Reached 75%', n: f.vsl75 }, { k: 'Reached 95%', n: f.vsl95 }
            ], { total: f.played || 1 }) +
          '</div>' +
        '</div>' +

        '<div class="grid g2">' +
          '<div class="card"><h2>Funnel</h2><div class="funnel">' + funnel.map(function (s, i) {
            return '<div class="step"><span class="k">' + s[0] + '</span><span class="track"><span class="fill" style="width:' +
              Math.max(0.5, (s[1] / top) * 100) + '%"></span></span><span class="v">' + num(s[1]) +
              '<small>' + (i ? pct(s[1], top) : '') + '</small></span></div>';
          }).join('') + '</div><div class="muted mt" style="font-size:12px">% = share of all visitors who reached that step.</div></div>' +
          '<div class="card"><h2>Application drop-off</h2>' + (stepsMax ? bars(d.steps.map(function (s) {
            return { k: STEP_NAMES[s.step] + (s.step < 7 ? ' (Q' + s.step + ')' : ''), n: s.n };
          }), { total: stepsMax, color: 'amber' }) : '<div class="empty">No one has started the application yet</div>') + '</div>' +
        '</div>' +

        '<div class="card" style="margin-bottom:14px"><h2>Ads performance <div class="pills" data-level>' +
          [['campaign', 'Campaign'], ['adset', 'Ad set'], ['ad', 'Ad']].map(function (x) {
            return '<button type="button" data-v="' + x[0] + '" class="' + (x[0] === level ? 'on' : '') + '">' + x[1] + '</button>';
          }).join('') + '</div></h2>' +
          '<div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>' + levelLabel + '</th><th class="n">Visitors</th><th class="n">VSL plays</th><th class="n">Applied</th><th class="n">Qualified</th><th class="n">Booked</th><th class="n">Showed</th><th class="n">Closed</th><th class="n">Revenue</th><th class="n">Visit → book</th></tr></thead><tbody>' +
          (d.ads.length ? d.ads.map(function (r) {
            var name = r.label || '(no ' + levelLabel.toLowerCase() + ' / organic)';
            var parent = level === 'adset' ? r.campaign : level === 'ad' ? [r.campaign, r.adset].filter(Boolean).join(' › ') : '';
            var id = level === 'campaign' ? r.campaign_id : level === 'adset' ? r.adset_id : r.ad_id;
            return '<tr class="click" data-filter="' + esc(JSON.stringify(level === 'campaign' ? { campaign: r.campaign || '' } : level === 'adset' ? { campaign: r.campaign || '', adset: r.adset || '' } : { campaign: r.campaign || '', adset: r.adset || '', ad: r.label || '' })) + '">' +
              '<td><div class="trunc" title="' + esc(name) + '">' + esc(name) + '</div>' +
              (parent || id ? '<div class="sub trunc">' + esc(parent) + (id ? (parent ? ' · ' : '') + 'id ' + esc(id) : '') + '</div>' : '') + '</td>' +
              '<td class="n" data-l="Visitors">' + num(r.visitors) + '</td><td class="n" data-l="VSL plays">' + num(r.played) + '</td>' +
              '<td class="n" data-l="Applied">' + num(r.applications) + '</td><td class="n" data-l="Qualified">' + num(r.qualified) + '</td>' +
              '<td class="n" data-l="Booked">' + num(r.booked) + '</td><td class="n" data-l="Showed">' + num(r.showed) + '</td>' +
              '<td class="n" data-l="Closed">' + num(r.closed) + '</td><td class="n" data-l="Revenue">' + money(r.revenue) + '</td>' +
              '<td class="n" data-l="Visit → book">' + pct(r.booked, r.visitors) + '</td></tr>';
          }).join('') : '<tr><td colspan="10" class="empty">No visitors in this range</td></tr>') +
          '</tbody></table></div></div>' +

        '<div class="grid g2">' +
          '<div class="card"><h2>Traffic sources</h2>' + bars(d.sources, { total: k.visitors }) + '</div>' +
          '<div class="card"><h2>Countries</h2>' + bars(d.countries, { total: k.visitors, color: 'amber' }) + '</div>' +
        '</div>';

      onPills(view, '[data-range]', function (v) { range = v; store('ov_range', v); load(); });
      onPills(view, '[data-level]', function (v) { level = v; store('ov_level', v); load(); });
      $$('tr[data-filter]', view).forEach(function (tr) {
        tr.addEventListener('click', function () {
          var f = JSON.parse(tr.getAttribute('data-filter'));
          store('vf', JSON.stringify(Object.assign({ range: range === '24h' ? '24h' : range }, f)));
          location.hash = '#/visitors';
        });
      });
      drawChart(d);
    }

    load();
    refreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible' && !$('.drawer')) load(true);
    }, 30000);
  }

  function kpi(label, val, hint, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="label">' + label + '</div><div class="val">' + val + '</div>' +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function kpiMini(label, val, hint) {
    return '<div class="kpi" style="padding:12px"><div class="label">' + label + '</div><div class="val" style="font-size:24px">' + val + '</div>' +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }

  function drawChart(d) {
    var canvas = $('#ov-chart');
    if (!canvas || !window.Chart) return;
    if (chart) chart.destroy();
    var keyOf = function (t) { return new Date(t).toISOString().slice(0, d.hourly ? 13 : 10); };
    var leadMap = {};
    d.leadSeries.forEach(function (p) { leadMap[keyOf(p.t)] = p.n; });
    var labels = d.series.map(function (p) {
      var dt = new Date(p.t);
      return d.hourly ? dt.toLocaleTimeString(undefined, { hour: 'numeric' }) : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Visitors', data: d.series.map(function (p) { return p.n; }), borderColor: '#ff4a2e', backgroundColor: 'rgba(255,74,46,.12)', fill: true, tension: .3, pointRadius: 2 },
          { label: 'Applications', data: d.series.map(function (p) { return leadMap[keyOf(p.t)] || 0; }), borderColor: '#ffb627', backgroundColor: 'transparent', tension: .3, pointRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8a786a', maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#8a786a', precision: 0 }, grid: { color: 'rgba(58,42,34,.6)' } }
        }
      }
    });
  }

  /* ================= Visitors ================= */
  function visitors() {
    var f = {};
    try { f = JSON.parse(store('vf') || '{}') || {}; } catch (e) {}
    f = Object.assign({ range: '7d', q: '', campaign: '', adset: '', ad: '', country: '', did: '' }, f);
    var opts = null;
    var rows = [];
    loading();

    api('filters').then(function (r) {
      opts = r;
      shell();
      load();
    }).catch(fail);

    function select(name, label, list) {
      return '<select data-f="' + name + '"><option value="">' + label + '</option>' + (list || []).map(function (v) {
        return '<option value="' + esc(v) + '"' + (f[name] === v ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('') + '</select>';
    }

    function shell() {
      view.innerHTML =
        '<div class="ph"><div><h1>Visitors</h1><div class="sub" data-count></div></div>' +
        '<div class="actions">' + rangePills(f.range) + '<button class="btn ghost" data-csv>Export CSV</button></div></div>' +
        '<div class="filters">' +
          '<input type="search" data-f="q" placeholder="Search name, campaign, city, id…" value="' + esc(f.q) + '">' +
          select('campaign', 'All campaigns', opts.campaigns) +
          select('adset', 'All ad sets', opts.adsets) +
          select('ad', 'All ads', opts.ads) +
          select('country', 'All countries', opts.countries) +
          '<select data-f="did"><option value="">Any activity</option>' + [
            ['ads', 'Came from an ad'], ['vsl', 'Watched VSL'], ['started', 'Started application'], ['applied', 'Applied'],
            ['booked', 'Booked a call'], ['none', 'Didn\'t apply']
          ].map(function (x) { return '<option value="' + x[0] + '"' + (f.did === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
        '</div>' +
        '<div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>Visitor</th><th>Campaign / Ad set / Ad</th><th>Location</th><th>Device</th><th class="n">VSL watched</th><th>Furthest</th><th>Last seen</th></tr></thead><tbody data-rows><tr><td colspan="7" class="loading">Loading…</td></tr></tbody></table></div>';

      onPills(view, '[data-range]', function (v) {
        f.range = v; save();
        $$('[data-range] button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
        load();
      });
      var t;
      $$('[data-f]', view).forEach(function (el) {
        el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () {
          f[el.getAttribute('data-f')] = el.value; save();
          clearTimeout(t); t = setTimeout(load, el.tagName === 'INPUT' ? 300 : 0);
        });
      });
      $('[data-csv]', view).addEventListener('click', function () {
        csvDownload('visitors', [
          ['id', 'Visitor ID'], ['name', 'Name'], ['stage', 'Lead stage'], ['first_seen_at', 'First seen'], ['last_seen_at', 'Last seen'],
          ['utm_source', 'Source'], ['utm_campaign', 'Campaign'], ['utm_term', 'Ad set'], ['utm_content', 'Ad'],
          ['campaign_id', 'Campaign ID'], ['adset_id', 'Ad set ID'], ['ad_id', 'Ad ID'], ['city', 'City'], ['region', 'Region'], ['country', 'Country'],
          ['device', 'Device'], ['vsl_seconds', 'VSL seconds'], ['vsl_pct', 'VSL %'], [function (r) { return stepLabel(r.furthest_step); }, 'Furthest step'],
          ['booked', 'Booked'], ['total_sessions', 'Sessions'], ['landing_url', 'Landing URL'], ['referrer', 'Referrer']
        ], rows);
      });
    }

    function save() { store('vf', JSON.stringify(f)); }

    function load() {
      api('visitors', f).then(function (d) {
        rows = d.rows;
        $('[data-count]', view).textContent = num(rows.length) + (rows.length === 500 ? '+ (showing latest 500)' : '') + ' visitors seen in range';
        $('[data-rows]', view).innerHTML = rows.length ? rows.map(function (r) {
          var who = r.name ? '<b>' + esc(r.name) + '</b>' : '<span class="muted">' + esc(r.id.slice(2, 10)) + '</span>';
          var ad = [r.utm_campaign, r.utm_term, r.utm_content].filter(Boolean);
          return '<tr class="click" data-id="' + esc(r.id) + '">' +
            '<td>' + who + ' ' + stageBadge(r.stage) + (r.booked && r.stage !== 'booked' ? ' <span class="badge st-booked">Booked</span>' : '') + '</td>' +
            '<td data-l="Ad">' + (ad.length ? '<div class="trunc" title="' + esc(ad.join(' › ')) + '">' + esc(r.utm_campaign || '–') + '</div><div class="sub trunc">' + esc([r.utm_term, r.utm_content].filter(Boolean).join(' › ')) + '</div>'
              : '<span class="muted">' + esc(r.utm_source || (r.referrer ? 'referral' : 'direct')) + '</span>') + '</td>' +
            '<td data-l="Location">' + esc(place(r) || '–') + '</td>' +
            '<td data-l="Device">' + esc(r.device || '–') + '</td>' +
            '<td class="n" data-l="VSL">' + (r.vsl_seconds ? dur(r.vsl_seconds) + ' <span class="sub">' + r.vsl_pct + '%</span>' : '<span class="muted">–</span>') + '</td>' +
            '<td data-l="Furthest">' + esc(stepLabel(r.furthest_step)) + '</td>' +
            '<td data-l="Last seen" title="' + esc(when(r.last_seen_at)) + '">' + esc(ago(r.last_seen_at)) + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty">No visitors match these filters</td></tr>';
        $$('tr[data-id]', view).forEach(function (tr) {
          tr.addEventListener('click', function () { location.hash = '#/visitor/' + encodeURIComponent(tr.getAttribute('data-id')); });
        });
      }).catch(fail);
    }
  }

  /* ================= Visitor detail ================= */
  function visitor(id) {
    loading();
    api('visitor', { id: id }).then(function (d) {
      var v = d.visitor;
      var lead = d.leads[0];
      var sessions = [];
      var byId = {};
      d.events.forEach(function (e) {
        var sid = e.session_id || 'none';
        if (!byId[sid]) { byId[sid] = { id: sid, events: [] }; sessions.push(byId[sid]); }
        byId[sid].events.push(e);
      });
      sessions.reverse(); // newest session first

      var info = [
        ['First seen', when(v.first_seen_at)], ['Last seen', when(v.last_seen_at)],
        ['Sessions', v.total_sessions], ['VSL watched', v.vsl_seconds ? dur(v.vsl_seconds) + ' (' + v.vsl_pct + '%)' : 'Didn\'t play'],
        ['Furthest step', stepLabel(v.furthest_step)],
        ['Source', v.utm_source], ['Medium', v.utm_medium], ['Placement', v.placement || v.site_source_name],
        ['Campaign', v.utm_campaign], ['Campaign ID', v.campaign_id, 1],
        ['Ad set', v.utm_term], ['Ad set ID', v.adset_id, 1],
        ['Ad', v.utm_content], ['Ad ID', v.ad_id, 1],
        ['Location', [v.city, v.region, v.country].filter(Boolean).join(', ')], ['IP', v.ip, 1],
        ['Device', v.device], ['Screen', v.screen], ['Language', v.language], ['Timezone', v.timezone],
        ['Landing URL', v.landing_url, 1], ['Referrer', v.referrer, 1],
        ['fbc', v.fbc, 1], ['fbp', v.fbp, 1], ['Visitor ID', v.id, 1], ['User agent', v.user_agent, 1]
      ].filter(function (x) { return x[1] !== null && x[1] !== undefined && x[1] !== ''; });

      view.innerHTML =
        '<a class="back" href="#/visitors">← Visitors</a>' +
        '<div class="ph"><div><h1>' + esc(lead && lead.name ? lead.name : 'Visitor ' + v.id.slice(2, 10)) + '</h1>' +
        '<div class="sub">' + esc([v.utm_campaign, v.utm_term, v.utm_content].filter(Boolean).join(' › ') || v.utm_source || 'No ad attribution') + '</div></div>' +
        '<div class="actions">' + d.leads.map(function (l) {
          return '<button class="btn ghost" data-lead="' + esc(l.id) + '">Open lead ' + stageBadge(l.stage) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="card" style="margin-bottom:14px"><div class="kv">' + info.map(function (x) {
          return '<div><div class="k">' + esc(x[0]) + '</div><div class="v' + (x[2] ? ' mono' : '') + '">' + esc(x[1]) + '</div></div>';
        }).join('') + '</div></div>' +
        '<div class="card"><h2>Activity <span class="muted" style="letter-spacing:0;text-transform:none;font-weight:400">' + num(d.events.length) + ' events</span></h2>' +
        (sessions.length ? sessions.map(sessionHtml).join('') : '<div class="empty">No events recorded</div>') + '</div>';

      $$('[data-lead]', view).forEach(function (b) { b.addEventListener('click', function () { openLead(b.getAttribute('data-lead')); }); });
    }).catch(fail);
  }

  function sessionHtml(s) {
    var ev = collapseVideo(s.events);
    var start = s.events[0].created_at, end = s.events[s.events.length - 1].created_at;
    var secs = (new Date(end) - new Date(start)) / 1000;
    return '<div class="session"><div class="session-h"><b>' + esc(when(start)) + '</b><span>' + s.events.length + ' events</span><span>' + dur(secs) + ' long</span></div>' +
      ev.map(evHtml).join('') + '</div>';
  }

  // Many video_progress pings in a row → keep only the last one.
  function collapseVideo(list) {
    var out = [];
    list.forEach(function (e) {
      var prev = out[out.length - 1];
      if (e.type === 'video_progress' && prev && prev.type === 'video_progress') out[out.length - 1] = e;
      else out.push(e);
    });
    return out;
  }

  function evHtml(e) {
    var d = e.data || {};
    var ic = '•', cls = '', text = '', sub = '';
    switch (e.type) {
      case 'pageview': ic = 'P'; text = 'Viewed ' + (e.path || '/'); sub = d.query || ''; break;
      case 'section_view': ic = 'S'; text = 'Saw section: ' + e.name; break;
      case 'cta_click': ic = '→'; cls = 'c-cta'; text = 'Clicked ' + (e.name || '').replace(/^apply_/, 'Apply (') + (/^apply_/.test(e.name || '') ? ')' : ''); break;
      case 'click': ic = 'C'; text = 'Clicked ' + (e.name || ''); sub = d.href || ''; break;
      case 'outbound_click': ic = '↗'; cls = 'c-cta'; text = 'Left to ' + (e.name || ''); sub = d.href || ''; break;
      case 'video_progress': ic = '▶'; cls = 'c-video'; text = 'Watched VSL ' + dur(d.seconds) + ' (' + (d.pct || 0) + '%)'; sub = d.duration ? 'video is ' + dur(d.duration) + ' · ' + (d.trigger || '') : ''; break;
      case 'app_step': ic = 'Q'; cls = 'c-form'; text = 'Answered Q' + d.step + ' ' + (STEP_NAMES[d.step] || e.name || ''); sub = d.answer || ''; break;
      case 'lead': ic = '✓'; cls = 'c-lead'; text = e.name === 'application_disqualified' ? 'Submitted application (disqualified' + (d.dq_reason ? ': ' + d.dq_reason : '') + ')' : 'Submitted application (qualified)'; break;
      case 'booking': ic = '◷'; cls = 'c-book'; text = ({ booking_created: 'Booked a call', cal_booked: 'Booked a call (on page)', booking_cancelled: 'Cancelled call', booking_no_show: 'Marked no-show', call_showed: 'Marked showed', call_no_show: 'Marked no-show', call_accepted: 'Reset call status' })[e.name] || e.name; sub = d.start_time ? 'for ' + when(d.start_time) : ''; break;
      case 'session_end': ic = '×'; text = 'Left page'; sub = 'scrolled ' + (d.max_scroll || 0) + '% · ' + dur(d.seconds_on_page) + ' on page'; break;
      case 'meta': ic = 'M'; text = 'Meta event: ' + e.name; sub = ''; break;
      default: text = e.type + (e.name ? ': ' + e.name : '');
    }
    return '<div class="ev' + (e.type === 'meta' ? ' meta' : '') + '"><span class="t">' + esc(clock(e.created_at)) + '</span><span class="ic ' + cls + '">' + esc(ic) + '</span>' +
      '<span class="d">' + esc(text) + (e.scroll_pct != null && e.type !== 'session_end' && e.type !== 'meta' ? ' <span class="sub">· ' + e.scroll_pct + '% down</span>' : '') +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</span></div>';
  }

  /* ================= Leads ================= */
  function leadsPage(openId) { leadList(false, openId); }
  function archivedPage() { leadList(true); }

  function leadList(archived, openId) {
    var key = archived ? 'af' : 'lf';
    var f = {};
    try { f = JSON.parse(store(key) || '{}') || {}; } catch (e) {}
    f = Object.assign({ range: 'all', q: '', stage: '', source: '' }, f);
    var rows = [];

    view.innerHTML =
      '<div class="ph"><div><h1>' + (archived ? 'Archived' : 'Leads') + '</h1><div class="sub" data-count></div></div>' +
      '<div class="actions">' + rangePills(f.range, ['7d', '30d', '90d', 'all']) + '<button class="btn ghost" data-csv>Export CSV</button></div></div>' +
      (archived ? '' : '<div class="kpis" data-kpis></div>') +
      '<div class="chips" data-stages></div>' +
      '<div class="filters"><input type="search" data-f="q" placeholder="Search name, email, phone, campaign…" value="' + esc(f.q) + '">' +
      '<select data-f="source"><option value="">All sources</option>' + SOURCES.concat([['none', 'Not set']]).map(function (s) {
        return '<option value="' + s[0] + '"' + (f.source === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>Lead</th><th>Stage</th><th>Campaign / Ad</th><th class="n">VSL</th><th>Next call</th><th class="n">Paid</th><th>Meta</th><th>Applied</th></tr></thead><tbody data-rows><tr><td colspan="8" class="loading">Loading…</td></tr></tbody></table></div>';

    function save() { store(key, JSON.stringify(f)); }
    onPills(view, '[data-range]', function (v) {
      f.range = v; save();
      $$('[data-range] button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
      load();
    });
    var t;
    $$('[data-f]', view).forEach(function (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () {
        f[el.getAttribute('data-f')] = el.value; save();
        clearTimeout(t); t = setTimeout(load, el.tagName === 'INPUT' ? 300 : 0);
      });
    });
    $('[data-csv]', view).addEventListener('click', function () {
      var ans = function (k) { return function (r) { var a = r.answers || {}; var v = a[k]; return Array.isArray(v) ? v.map(function (x) { return x.label; }).join('; ') : v && typeof v === 'object' ? v.label : v; }; };
      csvDownload(archived ? 'archived-leads' : 'leads', [
        ['id', 'Lead ID'], ['created_at', 'Applied'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['instagram', 'Instagram'],
        [function (r) { return STAGE_LABEL[r.stage] || r.stage; }, 'Stage'], ['source', 'Origin'], ['lead_source', 'Lead source'],
        ['utm_source', 'UTM source'], ['utm_campaign', 'Campaign'], ['utm_term', 'Ad set'], ['utm_content', 'Ad'],
        [ans('goal'), 'Goal'], [ans('challenge'), 'Challenge'], [ans('tried_before'), 'Tried before'], [ans('invest'), 'Investment'],
        [ans('age'), 'Age'], [ans('occupation'), 'Occupation'], ['dq_reason', 'DQ reason'],
        ['vsl_seconds', 'VSL seconds'], ['vsl_pct', 'VSL %'], ['next_call', 'Next call'], ['plan', 'Plan'], ['amount_paid', 'Amount paid'],
        ['meta_lead_sent_at', 'Meta Lead sent'], ['meta_schedule_sent_at', 'Meta Schedule sent'], ['meta_purchase_sent_at', 'Meta Purchase sent']
      ], rows);
    });

    function load() {
      api('leads', { range: f.range, q: f.q, source: f.source, stage: f.stage, archived: archived ? '1' : '' }).then(function (d) {
        rows = d.rows;
        var k = d.kpi;
        $('[data-count]', view).textContent = num(rows.length) + ' ' + (f.stage ? (STAGE_LABEL[f.stage] || '').toLowerCase() + ' ' : '') + (archived ? 'archived leads' : 'leads');
        if (!archived) {
          $('[data-kpis]', view).innerHTML =
            kpi('Leads', num(k.total), num(k.disqualified) + ' disqualified (not counted)') +
            kpi('Booked', num(k.booked), pct(k.booked, k.total) + ' of leads', 'accent') +
            kpi('Showed', num(k.showed), 'show rate ' + (k.showed + k.no_show ? pct(k.showed, k.showed + k.no_show) : '–')) +
            kpi('Closed', num(k.closed), 'close rate ' + pct(k.closed, k.showed) + ' of shows') +
            kpi('Revenue', money(k.revenue), k.closed ? money(k.revenue / k.closed) + ' per close' : '', 'good');
        }
        $('[data-stages]', view).innerHTML = [['', 'All']].concat(STAGES).map(function (s) {
          return '<button class="chip' + (f.stage === s[0] ? ' on' : '') + '" data-v="' + s[0] + '">' + s[1] + '</button>';
        }).join('');
        $$('[data-stages] .chip', view).forEach(function (c) {
          c.addEventListener('click', function () { f.stage = c.getAttribute('data-v'); save(); load(); });
        });
        $('[data-rows]', view).innerHTML = rows.length ? rows.map(function (r) {
          var ad = [r.utm_term, r.utm_content].filter(Boolean).join(' › ');
          return '<tr class="click" data-id="' + esc(r.id) + '">' +
            '<td><b>' + esc(r.name || '(no name)') + '</b>' + (r.source === 'booking' ? ' <span class="badge plain">booked direct</span>' : '') +
            '<div class="sub">' + esc([r.email, r.phone].filter(Boolean).join(' · ')) + '</div></td>' +
            '<td data-l="Stage">' + stageBadge(r.stage) + '</td>' +
            '<td data-l="Ad">' + (r.utm_campaign ? '<div class="trunc" title="' + esc(r.utm_campaign + (ad ? ' › ' + ad : '')) + '">' + esc(r.utm_campaign) + '</div><div class="sub trunc">' + esc(ad) + '</div>'
              : '<span class="muted">' + esc(r.lead_source || r.utm_source || '–') + '</span>') + '</td>' +
            '<td class="n" data-l="VSL">' + (r.vsl_seconds ? dur(r.vsl_seconds) + ' <span class="sub">' + r.vsl_pct + '%</span>' : '<span class="muted">–</span>') + '</td>' +
            '<td data-l="Next call">' + (r.next_call ? esc(when(r.next_call)) : '<span class="muted">–</span>') + '</td>' +
            '<td class="n" data-l="Paid">' + (r.amount_paid ? money(r.amount_paid) : '<span class="muted">–</span>') + '</td>' +
            '<td data-l="Meta"><span class="dots" title="Sent to Meta: Lead / Schedule / Purchase">' +
              '<i class="' + (r.meta_lead_sent_at ? 'on' : '') + '">L</i><i class="' + (r.meta_schedule_sent_at ? 'on' : '') + '">S</i><i class="' + (r.meta_purchase_sent_at ? 'on' : '') + '">P</i></span></td>' +
            '<td data-l="Applied" title="' + esc(when(r.created_at)) + '">' + esc(ago(r.created_at)) + '</td></tr>';
        }).join('') : '<tr><td colspan="8" class="empty">No leads here yet</td></tr>';
        $$('tr[data-id]', view).forEach(function (tr) {
          tr.addEventListener('click', function () { openLead(tr.getAttribute('data-id'), load); });
        });
      }).catch(fail);
    }

    load();
    if (openId) openLead(openId, load);
  }

  /* ================= Lead drawer ================= */
  var drawerOnChange = null;

  function closeDrawer(silent) {
    var bg = $('.drawer-bg'), dr = $('.drawer');
    if (bg) bg.remove();
    if (dr) dr.remove();
    document.removeEventListener('keydown', escClose);
    if (!silent && drawerOnChange) drawerOnChange();
    if (silent) drawerOnChange = null;
  }
  function escClose(e) { if (e.key === 'Escape') closeDrawer(); }

  function openLead(id, onChange) {
    closeDrawer(true);
    drawerOnChange = onChange || null;
    var bg = document.createElement('div');
    bg.className = 'drawer-bg';
    var dr = document.createElement('aside');
    dr.className = 'drawer';
    dr.setAttribute('role', 'dialog');
    dr.setAttribute('aria-label', 'Lead');
    dr.innerHTML = '<div class="loading">Loading…</div>';
    document.body.appendChild(bg);
    document.body.appendChild(dr);
    bg.addEventListener('click', function () { closeDrawer(); });
    document.addEventListener('keydown', escClose);
    (isCoach() ? renderCoachLead : renderLead)(id, dr);
  }

  function renderLead(id, dr) {
    api('lead', { id: id }).then(function (d) {
      var l = d.lead, v = d.visitor;
      var a = l.answers || {};
      var lbl = function (x) { return Array.isArray(x) ? x.map(function (y) { return y.label; }).join(', ') : x && typeof x === 'object' ? x.label : x; };
      var answers = [
        ['Goal', lbl(a.goal)], ['Hardest part', lbl(a.challenge)], ['Tried before', lbl(a.tried_before)],
        ['Ready to invest', lbl(a.invest)], ['Age', a.age], ['Work', a.occupation]
      ].filter(function (x) { return x[1]; });

      dr.innerHTML =
        '<div class="dh"><div><h2>' + esc(l.name || '(no name)') + '</h2><div class="muted" style="margin-top:6px">' +
          (l.source === 'booking' ? 'Booked without applying · ' : l.source === 'manual' ? 'Added manually · ' : 'Applied ') + esc(when(l.created_at)) +
          (l.archived_at ? ' · <b>archived</b>' : '') + '</div></div><button class="x" data-close aria-label="Close">✕</button></div>' +

        '<section><h3>Stage</h3><div class="stage-pick">' + STAGES.map(function (s) {
          return '<button type="button" class="badge st-' + s[0] + (l.stage === s[0] ? ' on' : '') + '" data-stage="' + s[0] + '">' + s[1] + '</button>';
        }).join('') + '</div>' + (l.dq_reason ? '<div class="muted mt">Disqualified by form: ' + esc(l.dq_reason.replace(/_/g, ' ')) + '</div>' : '') + '</section>' +

        '<section><h3>Send to Meta</h3>' +
          (d.metaConfigured ? '' : '<div class="muted" style="margin-bottom:10px">Conversions API isn\'t set up yet (META_PIXEL_ID / META_CAPI_TOKEN). Sends will be logged as skipped.</div>') +
          '<div class="meta-rows">' + metaRow('Lead', l.meta_lead_sent_at, d.sends, [l.lead_event_id]) +
          metaRow('Schedule', l.meta_schedule_sent_at, d.sends, [l.schedule_event_id]) +
          metaRow('Purchase', l.meta_purchase_sent_at, d.sends, [], l.amount_paid) + '</div>' +
          '<div class="muted mt" style="font-size:12px">Lead and Schedule reuse the browser\'s event ID when there is one, so Meta merges them with any automatic copy instead of counting twice.</div>' +
        '</section>' +

        '<section><h3>Contact & deal</h3><form class="form-grid" data-form>' +
          field('name', 'Name', l.name) + field('email', 'Email', l.email, 'email') +
          field('phone', 'Phone', l.phone, 'tel') + field('instagram', 'Instagram', l.instagram) +
          field('plan', 'Plan / package', l.plan) + field('amount_paid', 'Amount paid (USD)', l.amount_paid, 'number') +
          '<label>Lead source<select name="lead_source"><option value="">Not set</option>' + SOURCES.map(function (s) {
            return '<option value="' + s[0] + '"' + (l.lead_source === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
          }).join('') + '</select></label>' +
          '<label style="justify-content:flex-end"><button class="btn" type="submit">Save</button></label>' +
        '</form></section>' +

        (answers.length ? '<section><h3>Application</h3><div class="answers">' + answers.map(function (x) {
          return '<div><span class="k">' + esc(x[0]) + '</span><span>' + esc(x[1]) + '</span></div>';
        }).join('') + '</div></section>' : '') +

        '<section><h3>Calls</h3>' + (d.bookings.length ? d.bookings.map(function (b) {
          return '<div class="toggle-row"><div><b>' + esc(when(b.start_time)) + '</b><div class="sub">' + esc(b.title || '') + '</div></div><span class="badge bk-' + esc(b.status) + '">' + esc(b.status.replace('_', '-')) + '</span></div>';
        }).join('') : '<div class="muted">No calls booked</div>') + '</section>' +

        '<section><h3>Attribution</h3><div class="kv">' + [
          ['Source', l.utm_source], ['Campaign', l.utm_campaign], ['Ad set', l.utm_term], ['Ad', l.utm_content],
          ['Campaign ID', l.campaign_id], ['Ad set ID', l.adset_id], ['Ad ID', l.ad_id],
          ['VSL watched', v && v.vsl_seconds ? dur(v.vsl_seconds) + ' (' + v.vsl_pct + '%)' : null],
          ['Location', v ? [v.city, v.region, v.country].filter(Boolean).join(', ') : null], ['Device', v && v.device],
          ['Click ID (fbc)', l.fbc ? 'yes' : 'no'], ['CTA used', l.cta_source]
        ].filter(function (x) { return x[1]; }).map(function (x) {
          return '<div><div class="k">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div></div>';
        }).join('') + '</div>' +
          (l.visitor_id ? '<a class="btn ghost sm mt" href="#/visitor/' + encodeURIComponent(l.visitor_id) + '">View full activity →</a>' : '<div class="muted mt">No website visit linked.</div>') +
        '</section>' +

        '<section><h3>Notes</h3><form data-note><textarea name="note" placeholder="Add a note…"></textarea><button class="btn sm mt" type="submit">Add note</button></form>' +
          d.notes.map(function (n) { return '<div class="note">' + esc(n.note) + '<div class="sub">' + esc(when(n.created_at)) + '</div></div>'; }).join('') +
        '</section>' +

        '<section style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-archive>' + (l.archived_at ? 'Unarchive' : 'Archive') + '</button></section>';

      $('[data-close]', dr).addEventListener('click', function () { closeDrawer(); });

      bindLeadEdits(l, dr, renderLead, l.meta_purchase_sent_at ? '' : 'Closed. Enter the amount and press Send Purchase to tell Meta.');

      $$('[data-send]', dr).forEach(function (btn) {
        btn.addEventListener('click', function () { sendMeta(l, btn.getAttribute('data-send'), dr, false); });
      });
    }).catch(function (e) {
      if (e.message !== 'unauthorized') dr.innerHTML = '<div class="dh"><h2>Error</h2><button class="x" data-close>✕</button></div><p>' + esc(e.message) + '</p>';
      var x = $('[data-close]', dr);
      if (x) x.addEventListener('click', function () { closeDrawer(); });
    });
  }

  // Stage buttons, details form, notes and archive: shared by the full and the coach lead views.
  function bindLeadEdits(l, dr, rerender, closedMsg) {
    $$('[data-stage]', dr).forEach(function (b) {
      b.addEventListener('click', function () {
        var stage = b.getAttribute('data-stage');
        api('updateLead', null, { id: l.id, fields: { stage: stage } }).then(function () {
          toast('Stage: ' + STAGE_LABEL[stage]);
          if (stage === 'closed' && closedMsg) toast(closedMsg);
          rerender(l.id, dr);
        }).catch(function (e) { toast(e.message, true); });
      });
    });

    $('[data-form]', dr).addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var fields = {};
      fd.forEach(function (val, k) { fields[k] = val; });
      api('updateLead', null, { id: l.id, fields: fields }).then(function () { toast('Saved'); rerender(l.id, dr); })
        .catch(function (ex) { toast(ex.message, true); });
    });

    $('[data-note]', dr).addEventListener('submit', function (e) {
      e.preventDefault();
      var note = e.target.note.value.trim();
      if (!note) return;
      api('addNote', null, { id: l.id, note: note }).then(function () { rerender(l.id, dr); }).catch(function (ex) { toast(ex.message, true); });
    });

    $('[data-archive]', dr).addEventListener('click', function () {
      api('archiveLead', null, { id: l.id, archived: !l.archived_at }).then(function () {
        toast(l.archived_at ? 'Unarchived' : 'Archived');
        closeDrawer();
      }).catch(function (ex) { toast(ex.message, true); });
    });
  }

  function field(name, label, val, type) {
    return '<label>' + label + '<input type="' + (type || 'text') + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '"' +
      (type === 'number' ? ' min="0" step="0.01" inputmode="decimal"' : '') + '></label>';
  }

  function errText(r) {
    if (!r) return '';
    if (r.error && typeof r.error === 'object') return r.error.error_user_msg || r.error.message || JSON.stringify(r.error);
    return r.error || r.reason || '';
  }

  function metaRow(name, sentAt, sends, ids, amount) {
    var latest = sends.filter(function (s) { return s.event_name === name; })[0];
    var status, info;
    if (sentAt) {
      var bySent = sends.filter(function (s) { return s.event_name === name && s.status === 'sent'; })[0];
      status = 'sent';
      info = 'Sent ' + (bySent ? bySent.origin : '') + ' ' + ago(sentAt);
    } else if (latest) {
      status = latest.status;
      info = latest.status === 'held' ? 'Held: auto-send is off. Press Send when you\'re happy with this lead.'
        : latest.status === 'failed' ? 'Last try failed ' + ago(latest.created_at) + '<span class="err">' + esc(errText(latest.response)) + '</span>'
        : latest.status === 'skipped' ? 'Skipped: Conversions API not configured' : latest.status;
    } else {
      status = 'none';
      info = name === 'Purchase' ? 'Not sent. Purchase is always manual.' : 'Not sent';
    }
    var go = name === 'Purchase'
      ? '<input type="number" min="0" step="0.01" inputmode="decimal" data-amount placeholder="Amount" value="' + esc(amount || '') + '"><span class="muted">USD</span>'
      : '';
    return '<div class="meta-row"><span class="nm">' + name + '</span><span class="info"><span class="badge ms-' + status + '">' + (status === 'none' ? 'not sent' : status) + '</span> ' + info + '</span>' +
      '<span class="go">' + go + '<button class="btn sm' + (sentAt ? ' ghost' : '') + '" data-send="' + name + '">' + (sentAt ? 'Resend' : 'Send') + '</button></span></div>';
  }

  function sendMeta(l, name, dr, force) {
    var body = { id: l.id, event: name, force: force };
    if (name === 'Purchase') {
      var amt = $('[data-amount]', dr);
      body.value = amt ? amt.value : '';
      body.currency = 'USD';
      if (!(Number(body.value) > 0)) { toast('Enter the purchase amount first', true); return; }
    }
    var btn = $('[data-send="' + name + '"]', dr);
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    api('sendMeta', null, body).then(function (r) {
      if (r.needConfirm) {
        var msg = name + ' was already sent to Meta ' + ago(r.sent_at) + '.\n\n' +
          (name === 'Purchase' ? 'Sending again uses the same event ID, so Meta should treat it as the same purchase (update) rather than a second sale.' : 'Sending again uses the same event ID, so Meta merges it with the earlier one.') +
          '\n\nSend again?';
        if (window.confirm(msg)) return sendMeta(l, name, dr, true);
        renderLead(l.id, dr);
        return;
      }
      if (r.ok) toast(name + ' sent to Meta');
      else toast(name + ' not sent: ' + (r.error || r.status), true);
      renderLead(l.id, dr);
      if (drawerOnChange) drawerOnChange();
    }).catch(function (e) {
      toast(e.message, true);
      renderLead(l.id, dr);
    });
  }

  /* ================= Bookings ================= */
  function bookings() {
    var tab = store('bk_tab') || 'upcoming';
    view.innerHTML =
      '<div class="ph"><div><h1>Bookings</h1><div class="sub">Calls booked through Cal.com. Mark shows and no-shows here.</div></div>' +
      '<div class="actions"><div class="pills" data-tab>' + [['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']].map(function (x) {
        return '<button type="button" data-v="' + x[0] + '" class="' + (x[0] === tab ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div></div></div>' +
      '<div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>Call</th><th>Who</th><th>Lead</th><th>Campaign / Ad</th><th>Status</th><th></th></tr></thead><tbody data-rows><tr><td colspan="6" class="loading">Loading…</td></tr></tbody></table></div>';

    onPills(view, '[data-tab]', function (v) {
      tab = v; store('bk_tab', v);
      $$('[data-tab] button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
      load();
    });

    function load() {
      api('bookings', { tab: tab }).then(function (d) {
        $('[data-rows]', view).innerHTML = d.rows.length ? d.rows.map(function (b) {
          var canMark = tab !== 'cancelled';
          return '<tr><td><b>' + esc(when(b.start_time)) + '</b><div class="sub">' + esc(b.title || '') + '</div></td>' +
            '<td data-l="Who">' + esc(b.attendee_name || b.lead_name || '–') + '<div class="sub">' + esc([b.attendee_email, b.attendee_phone].filter(Boolean).join(' · ')) + '</div></td>' +
            '<td data-l="Lead">' + (b.lead_id ? '<a href="#" data-lead="' + esc(b.lead_id) + '">' + stageBadge(b.stage) + '</a>' + (b.lead_origin === 'booking' ? ' <span class="sub">no application</span>' : '') : '<span class="muted">–</span>') + '</td>' +
            '<td data-l="Ad">' + (b.utm_campaign ? '<div class="trunc">' + esc(b.utm_campaign) + '</div><div class="sub trunc">' + esc([b.utm_term, b.utm_content].filter(Boolean).join(' › ')) + '</div>' : '<span class="muted">–</span>') + '</td>' +
            '<td data-l="Status"><span class="badge bk-' + esc(b.status) + '">' + esc(b.status === 'accepted' ? 'scheduled' : b.status.replace('_', '-')) + '</span></td>' +
            '<td>' + (canMark ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              (b.status !== 'showed' ? '<button class="btn sm ghost" data-mark="showed" data-uid="' + esc(b.uid) + '">Showed</button>' : '') +
              (b.status !== 'no_show' ? '<button class="btn sm ghost" data-mark="no_show" data-uid="' + esc(b.uid) + '">No-show</button>' : '') +
              (b.status !== 'accepted' ? '<button class="btn sm ghost" data-mark="accepted" data-uid="' + esc(b.uid) + '">Reset</button>' : '') +
            '</div>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="empty">No ' + tab + ' calls</td></tr>';
        $$('[data-lead]', view).forEach(function (a) {
          a.addEventListener('click', function (e) { e.preventDefault(); openLead(a.getAttribute('data-lead'), load); });
        });
        $$('[data-mark]', view).forEach(function (btn) {
          btn.addEventListener('click', function () {
            btn.disabled = true;
            api('bookingStatus', null, { uid: btn.getAttribute('data-uid'), status: btn.getAttribute('data-mark') })
              .then(function () { toast('Updated'); load(); })
              .catch(function (e) { toast(e.message, true); btn.disabled = false; });
          });
        });
      }).catch(fail);
    }
    load();
  }

  /* ================= Settings ================= */
  function settings() {
    loading();
    api('settings').then(render).catch(fail);

    function render(s) {
      var ignored = false;
      try { ignored = localStorage.getItem('kf_ignore') === '1'; } catch (e) {}
      var DESC = {
        SubmitApplication: 'Every completed application, qualified or not.',
        Lead: 'Qualified applications. The event your ads usually optimise for.',
        DisqualifiedLead: 'Under the minimum age or not ready to invest. Useful as an exclusion audience.',
        Schedule: 'Call booked in Cal.com.'
      };
      var st = s.status;
      var checks = [
        ['Database', st.database], ['Meta Pixel ID (server)', st.pixel], ['Conversions API token', st.capi],
        ['Cal.com webhook secret', st.cal], ['Email alerts (Gmail SMTP)', st.smtp], ['Phone notifications (VAPID keys)', st.push], ['Lead webhook (CRM)', st.lead_webhook],
        ['ADMIN_SESSION_SECRET', st.session_secret]
      ];
      view.innerHTML =
        '<div class="ph"><div><h1>Settings</h1></div></div>' +
        '<div class="card" data-push style="margin-bottom:14px"></div>' +
        '<div class="card" data-alerts style="margin-bottom:14px"></div>' +
        '<div class="grid g2">' +
          '<div class="card"><h2>Automatic sending to Meta</h2>' +
            '<p class="muted" style="margin-top:-4px">Off = the browser pixel and the server both hold the event. It\'s logged as <b>held</b> and you send it from the lead with the Send button. Page views, video and form-step events always send. Purchase is always manual.</p>' +
            Object.keys(s.auto).map(function (e) {
              return '<div class="toggle-row"><div><b>' + e + '</b><div class="sub">' + (DESC[e] || '') + '</div></div>' +
                '<label class="switch"><input type="checkbox" data-auto="' + e + '"' + (s.auto[e] ? ' checked' : '') + '><span></span></label></div>';
            }).join('') +
            '<p class="muted" style="font-size:12px">Changes reach visitors\' browsers within about a minute.</p>' +
          '</div>' +
          '<div>' +
            '<div class="card" style="margin-bottom:14px"><h2>Meta test events</h2>' +
              '<p class="muted" style="margin-top:-4px">Paste the code from Events Manager → Test events to see server events there live. Clear it before running ads.' + (s.env_test_code ? ' (META_TEST_EVENT_CODE env var is also set and is used when this is empty.)' : '') + '</p>' +
              '<form data-test style="display:flex;gap:8px"><input type="text" name="code" placeholder="e.g. TEST12345" value="' + esc(s.test_code) + '" style="flex:1"><button class="btn" type="submit">Save</button></form>' +
            '</div>' +
            '<div class="card"><h2>This browser</h2>' +
              '<div class="toggle-row"><div><b>Exclude my visits</b><div class="sub">Stops this browser from being tracked or sent to Meta on the site. Turn on for everyone on the team who tests the page.</div></div>' +
              '<label class="switch"><input type="checkbox" data-ignore' + (ignored ? ' checked' : '') + '><span></span></label></div>' +
              '<div class="device-foot"><a class="btn ghost sm" href="/" target="_blank" rel="noopener">View site ↗</a>' +
              '<button type="button" class="btn ghost sm" data-signout>Sign out</button></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card" style="margin-bottom:14px"><h2>Setup status</h2><div class="checks">' + checks.map(function (c) {
          return '<div><span class="' + (c[1] ? 'ok' : 'no') + '">' + (c[1] ? '●' : '○') + '</span>' + esc(c[0]) + (c[1] ? '' : ' <span class="muted">not set</span>') + '</div>';
        }).join('') + '</div></div>' +
        '<div class="grid g2">' +
          '<div class="card"><h2>Export</h2><p class="muted" style="margin-top:-4px">Full tables as CSV.</p><div style="display:flex;flex-wrap:wrap;gap:8px">' +
            ['visitors', 'events', 'leads', 'bookings'].map(function (t) {
              return '<a class="btn ghost sm" href="/api/admin?op=exportCsv&table=' + t + '">' + t.replace('_', ' ') + '.csv</a>';
            }).join('') + '</div></div>' +
          '<div class="card"><h2>Danger zone</h2><p class="muted" style="margin-top:-4px">Deletes every visitor, event, lead, booking and note (' + num(s.visitors) + ' visitors). Settings are kept. This can\'t be undone.</p>' +
            '<button class="btn danger" data-wipe>Delete all data</button></div>' +
        '</div>';

      renderAlerts(s.alerts);
      renderPush(s.push);
      $('[data-signout]', view).addEventListener('click', function () {
        api('logout', null, {}).then(showLogin, showLogin);
      });

      $$('[data-auto]', view).forEach(function (cb) {
        cb.addEventListener('change', function () {
          var auto = {};
          auto[cb.getAttribute('data-auto')] = cb.checked;
          api('saveSettings', null, { auto: auto }).then(function () {
            toast(cb.getAttribute('data-auto') + ': auto-send ' + (cb.checked ? 'on' : 'off'));
          }).catch(function (e) { cb.checked = !cb.checked; toast(e.message, true); });
        });
      });
      $('[data-test]', view).addEventListener('submit', function (e) {
        e.preventDefault();
        api('saveSettings', null, { test_code: e.target.code.value.trim() }).then(function () { toast('Test code saved'); })
          .catch(function (ex) { toast(ex.message, true); });
      });
      $('[data-ignore]', view).addEventListener('change', function (e) {
        try {
          if (e.target.checked) localStorage.setItem('kf_ignore', '1');
          else localStorage.removeItem('kf_ignore');
          toast(e.target.checked ? 'This browser is excluded from tracking' : 'This browser is tracked again');
        } catch (ex) { toast('Browser storage is blocked', true); }
      });
      $('[data-wipe]', view).addEventListener('click', function () {
        var typed = window.prompt('Type DELETE to permanently remove all tracking data, leads and bookings.');
        if (typed !== 'DELETE') return;
        api('deleteAll', null, { confirm: 'DELETE' }).then(function () { toast('All data deleted'); settings(); })
          .catch(function (e) { toast(e.message, true); });
      });
    }
  }

  // Email alerts card: recipients, the alert types each one gets, and a test send.
  function renderAlerts(a) {
    var box = $('[data-alerts]', view);
    if (!box) return;
    var list = a.recipients.map(function (r) { return { email: r.email, types: r.types.slice() }; });
    var allTypes = a.types.map(function (t) { return t.key; });

    function save(next, msg) {
      return api('saveSettings', null, { alert_recipients: next }).then(function (res) {
        toast(msg);
        renderAlerts(res.alerts);
      }).catch(function (e) { toast(e.message, true); renderAlerts(a); });
    }

    var note = '';
    if (!a.smtp) note += '<p class="alert-note bad">Gmail SMTP isn\'t set up yet (SMTP_USER / SMTP_PASS on Vercel), so no alerts will send.</p>';
    if (!list.length && a.env_fallback.length) {
      note += '<p class="alert-note">No emails added here, so all alerts go to <b>' + esc(a.env_fallback.join(', ')) + '</b> (ALERT_EMAIL_TO on Vercel). Add emails below to take over.</p>';
    } else if (!list.length) {
      note += '<p class="alert-note bad">No one gets alerts yet. Add an email below.</p>';
    }

    box.innerHTML =
      '<h2>Email alerts</h2>' +
      '<p class="muted" style="margin-top:-4px">Who gets an email, and for what. Tap a type to switch it on or off for that person.</p>' +
      note +
      (list.length ? '<div class="alert-list">' + list.map(function (r, i) {
        return '<div class="alert-row">' +
          '<div class="alert-email">' + esc(r.email) + '</div>' +
          '<div class="chips alert-types">' + a.types.map(function (t) {
            var on = r.types.indexOf(t.key) !== -1;
            return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-i="' + i + '" data-type="' + t.key + '" aria-pressed="' + on + '">' + esc(t.label) + '</button>';
          }).join('') + '</div>' +
          '<button type="button" class="btn ghost sm" data-remove="' + i + '" aria-label="Remove ' + esc(r.email) + '">Remove</button>' +
        '</div>';
      }).join('') + '</div>' : '') +
      '<form class="alert-add" data-add novalidate>' +
        '<input type="email" name="email" placeholder="name@email.com" autocomplete="off" aria-label="Email to add">' +
        '<button class="btn" type="submit">Add email</button>' +
      '</form>' +
      '<p class="alert-err" data-err></p>' +
      '<div class="alert-foot">' +
        '<button type="button" class="btn ghost sm" data-test-mail' + (a.smtp && (list.length || a.env_fallback.length) ? '' : ' disabled') + '>Send test email</button>' +
        '<span class="muted" style="font-size:12px">Sends one test email to everyone listed.</span>' +
      '</div>';

    $$('[data-type]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = list[+b.getAttribute('data-i')];
        var k = b.getAttribute('data-type');
        var idx = r.types.indexOf(k);
        if (idx === -1) r.types.push(k); else r.types.splice(idx, 1);
        save(list, r.email + ': ' + b.textContent + (idx === -1 ? ' on' : ' off'));
      });
    });
    $$('[data-remove]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = list[+b.getAttribute('data-remove')];
        if (!window.confirm('Stop sending alerts to ' + r.email + '?')) return;
        save(list.filter(function (x) { return x !== r; }), r.email + ' removed');
      });
    });
    $('[data-add]', box).addEventListener('submit', function (e) {
      e.preventDefault();
      var input = e.target.email;
      var email = input.value.trim().toLowerCase();
      var err = $('[data-err]', box);
      if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(email)) { err.textContent = 'That doesn\'t look like an email address.'; input.focus(); return; }
      if (list.some(function (r) { return r.email === email; })) { err.textContent = email + ' is already on the list.'; input.focus(); return; }
      if (list.length >= 20) { err.textContent = 'You can add up to 20 emails.'; return; }
      err.textContent = '';
      save(list.concat([{ email: email, types: allTypes.slice() }]), email + ' added');
    });
    $('[data-test-mail]', box).addEventListener('click', function (e) {
      var btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      api('testAlert', null, {}).then(function (res) {
        toast('Test email sent to ' + res.recipients.join(', '));
      }).catch(function (ex) { toast(ex.message, true); }).then(function () {
        btn.disabled = false;
        btn.textContent = 'Send test email';
      });
    });
  }

  /* ================= Coach view (phone) ================= */
  // Phone-sized screens get a simple view for coaches: leads, calls and visitors in plain words.
  // Ad names (campaign › ad set › ad) are shown; Meta sends, IDs, exports and setup stay on the full panel (wider screens).
  var coachMQ = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;
  function isCoach() { return Boolean(coachMQ && coachMQ.matches); }
  function syncCoach() { document.body.classList.toggle('coach', isCoach()); }
  syncCoach();
  if (coachMQ) {
    var onCoachChange = function () { syncCoach(); if (!$('#app').hidden) route(); };
    if (coachMQ.addEventListener) coachMQ.addEventListener('change', onCoachChange);
    else if (coachMQ.addListener) coachMQ.addListener(onCoachChange);
  }

  var CI = {
    filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
    call: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    text: '<path d="M4 4h16v12H8l-4 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    insta: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".5"/>'
  };
  function cIcon(k) { return '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true">' + CI[k] + '</svg>'; }

  // "Today · 3:00 PM", "Tomorrow · 9:30 AM", "Tue, Oct 7 · 3:00 PM"
  function callTime(t) {
    if (!t) return '';
    var d = new Date(t), now = new Date();
    var dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    var dayText = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return dayText + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  // 12 → "12 sec", 134 → "2 min 14 sec"
  function spoken(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(sec / 60), r = sec % 60;
    return m ? m + ' min' + (r ? ' ' + r + ' sec' : '') : r + ' sec';
  }
  function readStore(k) {
    try { return JSON.parse(store(k) || '{}') || {}; } catch (e) { return {}; }
  }
  function coachPills(attr, current, list) {
    return '<div class="pills" ' + attr + '>' + list.map(function (x) {
      return '<button type="button" data-v="' + x[0] + '" class="' + (x[0] === current ? 'on' : '') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  // "Campaign › Ad set › Ad" for a lead/visitor row, '' when it didn't come from a tagged ad.
  function adLine(r) {
    return [r.utm_campaign, r.utm_term, r.utm_content].filter(Boolean).join(' › ');
  }
  function adSub(r) {
    var a = adLine(r);
    return a ? '<div class="c-sub c-ad" title="' + esc(a) + '">' + esc(a) + '</div>' : '';
  }
  function bookingBadge(status) {
    return '<span class="badge bk-' + esc(status) + '">' + esc(status === 'accepted' ? 'scheduled' : String(status).replace('_', '-')) + '</span>';
  }

  // Search box + small Filters button (with a count of active filters) that opens a bottom sheet.
  function searchRow(placeholder) {
    return '<div class="c-search"><input type="search" data-q placeholder="' + esc(placeholder) + '" aria-label="Search">' +
      '<button type="button" class="btn ghost c-filter" data-filters>' + cIcon('filter') + 'Filters<span class="c-badge" data-badge hidden></span></button></div>';
  }
  function setupSearch(groups, getF, defaults, onSearch, onApply) {
    var t;
    $('[data-q]', view).addEventListener('input', function (e) {
      clearTimeout(t);
      var v = e.target.value.trim();
      t = setTimeout(function () { onSearch(v); }, 300);
    });
    $('[data-filters]', view).addEventListener('click', function () { openFilters(groups, getF(), defaults, onApply); });
    badge();
    function badge() {
      var f = getF();
      var n = groups.filter(function (g) { return f[g.key] !== defaults[g.key]; }).length;
      var b = $('[data-badge]', view);
      b.hidden = !n;
      b.textContent = n;
    }
    return badge;
  }
  // groups: [{ key, label, options: [[value, label], ...] }]; one pick per group. onApply gets the new values.
  function openFilters(groups, current, defaults, onApply) {
    var draft = Object.assign({}, current);
    var bg = document.createElement('div');
    bg.className = 'sheet-bg';
    var sh = document.createElement('div');
    sh.className = 'sheet';
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-label', 'Filters');
    document.body.appendChild(bg);
    document.body.appendChild(sh);
    bg.addEventListener('click', close);
    draw();

    function draw() {
      sh.innerHTML = '<div class="sheet-grip"></div>' +
        '<div class="sheet-h"><b>Filters</b><button type="button" class="link" data-reset>Reset</button></div>' +
        groups.map(function (g) {
          return '<div class="sheet-g"><div class="sheet-l">' + esc(g.label) + '</div><div class="chips">' + g.options.map(function (o) {
            return '<button type="button" class="chip' + (draft[g.key] === o[0] ? ' on' : '') + '" data-g="' + g.key + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
          }).join('') + '</div></div>';
        }).join('') +
        '<button type="button" class="btn sheet-go" data-done>Show results</button>';
      $$('[data-g]', sh).forEach(function (b) {
        b.addEventListener('click', function () { draft[b.getAttribute('data-g')] = b.getAttribute('data-v'); draw(); });
      });
      $('[data-reset]', sh).addEventListener('click', function () { draft = Object.assign({}, defaults); draw(); });
      $('[data-done]', sh).addEventListener('click', function () { close(); onApply(draft); });
    }
    function close() { bg.remove(); sh.remove(); }
  }

  /* ---------- Home ---------- */
  function coachHome() {
    var range = store('ch_range') || '7d';
    view.innerHTML =
      '<div class="ph"><div><h1>Home</h1></div>' + coachPills('data-range', range, [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']]) + '</div>' +
      '<div class="c-tiles" data-tiles><div class="loading">Loading…</div></div>' +
      '<h2 class="c-h2">Upcoming calls</h2><div class="c-list" data-calls></div>' +
      '<a class="c-more" href="#/bookings">See all calls →</a>';

    onPills(view, '[data-range]', function (v) {
      range = v; store('ch_range', v);
      $$('[data-range] button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
      load();
    });

    function load() {
      Promise.all([api('leads', { range: range }), api('bookings', { tab: 'upcoming' })]).then(function (r) {
        var k = r[0].kpi;
        $('[data-tiles]', view).innerHTML =
          kpi('New leads', num(k.total), k.disqualified ? '+' + num(k.disqualified) + ' didn\'t qualify' : '') +
          kpi('Calls booked', num(k.booked), '', 'accent') +
          kpi('Showed up', num(k.showed), k.no_show ? num(k.no_show) + ' no-show' : '') +
          kpi('Closed', num(k.closed), '', 'good');
        var calls = r[1].rows.slice(0, 5);
        $('[data-calls]', view).innerHTML = calls.length ? calls.map(callCard).join('') : '<div class="c-empty">No calls coming up</div>';
        bindCallCards(load);
      }).catch(fail);
    }
    load();
    refreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible' && !$('.drawer') && !$('.sheet')) load();
    }, 60000);
  }

  function callCard(b, opts) {
    var name = b.lead_name || b.attendee_name || b.attendee_email || 'Someone';
    var marks = opts && opts.marks;
    return '<div class="c-card' + (b.lead_id ? '' : ' static') + '"' + (b.lead_id ? ' role="button" tabindex="0" data-lead="' + esc(b.lead_id) + '"' : '') + '>' +
      '<div class="c-top"><b class="c-when">' + esc(callTime(b.start_time)) + '</b>' + (b.status !== 'accepted' ? bookingBadge(b.status) : '') + '</div>' +
      // One badge per card: the call's own status once it's set, otherwise the lead's stage.
      '<div class="c-sub">' + esc(name) + ' ' + (b.stage && b.status === 'accepted' ? stageBadge(b.stage) : '') + '</div>' +
      (marks ? '<div class="c-marks">' +
        (b.status !== 'showed' ? '<button type="button" class="btn ghost sm" data-mark="showed" data-uid="' + esc(b.uid) + '">Showed</button>' : '') +
        (b.status !== 'no_show' ? '<button type="button" class="btn ghost sm" data-mark="no_show" data-uid="' + esc(b.uid) + '">No-show</button>' : '') +
        (b.status !== 'accepted' ? '<button type="button" class="btn ghost sm" data-mark="accepted" data-uid="' + esc(b.uid) + '">Undo</button>' : '') +
      '</div>' : '') +
    '</div>';
  }
  function bindCallCards(reload) {
    $$('.c-card[data-lead]', view).forEach(function (c) {
      var open = function (e) {
        if (e.target.closest('[data-mark]')) return;
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        openLead(c.getAttribute('data-lead'), reload);
      };
      c.addEventListener('click', open);
      c.addEventListener('keydown', open);
    });
    $$('[data-mark]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        api('bookingStatus', null, { uid: btn.getAttribute('data-uid'), status: btn.getAttribute('data-mark') })
          .then(function () { toast('Updated'); reload(); })
          .catch(function (e) { toast(e.message, true); btn.disabled = false; });
      });
    });
  }

  /* ---------- Leads ---------- */
  function coachLeads(openId, archivedRoute) {
    var defaults = { stage: '', range: 'all', archived: '' };
    var f = Object.assign({}, defaults, readStore('cl'));
    if (archivedRoute) f.archived = '1';
    var q = '';
    var groups = [
      { key: 'stage', label: 'Stage', options: [['', 'All']].concat(STAGES) },
      { key: 'range', label: 'Applied', options: [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['all', 'Any time']] },
      { key: 'archived', label: 'Show', options: [['', 'Active leads'], ['1', 'Archived leads']] }
    ];
    view.innerHTML =
      '<div class="ph"><div><h1>Leads</h1><div class="sub" data-count></div></div></div>' +
      searchRow('Search leads') +
      '<div class="c-list" data-list><div class="loading">Loading…</div></div>';
    var badge = setupSearch(groups, function () { return f; }, defaults, function (v) { q = v; load(); }, function (next) {
      f = next; store('cl', JSON.stringify(f)); badge(); load();
    });

    function load() {
      api('leads', { range: f.range, q: q, stage: f.stage, archived: f.archived }).then(function (d) {
        var rows = d.rows;
        $('[data-count]', view).textContent = num(rows.length) + ' ' + (f.stage ? (STAGE_LABEL[f.stage] || '').toLowerCase() + ' ' : '') +
          (f.archived ? 'archived ' : '') + (rows.length === 1 ? 'lead' : 'leads');
        $('[data-list]', view).innerHTML = rows.length ? rows.map(function (r) {
          var line = r.next_call ? 'Call ' + callTime(r.next_call) : (r.source === 'booking' ? 'Booked ' : 'Applied ') + ago(r.created_at);
          return '<button type="button" class="c-card" data-id="' + esc(r.id) + '">' +
            '<div class="c-top"><b>' + esc(r.name || '(no name)') + '</b>' + stageBadge(r.stage) + '</div>' +
            '<div class="c-sub">' + esc(line) + '</div>' + adSub(r) + '</button>';
        }).join('') : '<div class="c-empty">No leads here' + (q || f.stage || f.range !== 'all' ? ' with these filters' : ' yet') + '</div>';
        $$('[data-id]', view).forEach(function (c) {
          c.addEventListener('click', function () { openLead(c.getAttribute('data-id'), load); });
        });
      }).catch(fail);
    }
    load();
    if (openId) openLead(openId, load);
  }

  /* ---------- Lead sheet ---------- */
  function renderCoachLead(id, dr) {
    api('lead', { id: id }).then(function (d) {
      var l = d.lead;
      var a = l.answers || {};
      var lbl = function (x) { return Array.isArray(x) ? x.map(function (y) { return y.label; }).join(', ') : x && typeof x === 'object' ? x.label : x; };
      var answers = [
        ['Goal', lbl(a.goal)], ['Hardest part', lbl(a.challenge)], ['Tried before', lbl(a.tried_before)],
        ['Ready to invest', lbl(a.invest)], ['Age', a.age], ['Work', a.occupation]
      ].filter(function (x) { return x[1]; });
      // No "+" and 10 digits = US/Canada (same rule as the booking page and SMSLoop).
      var phone = String(l.phone || '').replace(/[^\d+]/g, '');
      if (/^\d{10}$/.test(phone)) phone = '+1' + phone;
      var ig = String(l.instagram || '').trim();
      var igUrl = !ig ? '' : /^https?:\/\//i.test(ig) ? ig : 'https://instagram.com/' + encodeURIComponent(ig.replace(/^@/, '').replace(/\s+/g, ''));
      var acts = [];
      if (phone) acts.push(['tel:' + phone, 'Call', 'call'], ['sms:' + phone, 'Text', 'text']);
      if (l.email) acts.push(['mailto:' + l.email, 'Email', 'mail']);
      if (igUrl) acts.push([igUrl, 'Instagram', 'insta']);
      var next = d.bookings.filter(function (b) { return b.status === 'accepted' && new Date(b.start_time) >= new Date(); })
        .sort(function (x, y) { return new Date(x.start_time) - new Date(y.start_time); })[0];

      dr.innerHTML =
        '<div class="dh"><div><h2>' + esc(l.name || '(no name)') + '</h2><div class="muted" style="margin-top:8px">' + stageBadge(l.stage) + ' ' +
          esc(l.source === 'booking' ? 'Booked without applying' : l.source === 'manual' ? 'Added by hand' : 'Applied ' + day(l.created_at)) +
          (l.archived_at ? ' · archived' : '') + '</div></div><button class="x" data-close aria-label="Close">✕</button></div>' +

        (next ? '<div class="c-next">Call booked for <b>' + esc(callTime(next.start_time)) + '</b></div>' : '') +
        (acts.length ? '<div class="c-acts">' + acts.map(function (x) {
          return '<a class="c-act" href="' + esc(x[0]) + '"' + (x[2] === 'insta' ? ' target="_blank" rel="noopener"' : '') + '>' + cIcon(x[2]) + '<span>' + x[1] + '</span></a>';
        }).join('') + '</div>' : '') +

        '<section><h3>Stage</h3><div class="stage-pick">' + STAGES.map(function (s) {
          return '<button type="button" class="badge st-' + s[0] + (l.stage === s[0] ? ' on' : '') + '" data-stage="' + s[0] + '">' + s[1] + '</button>';
        }).join('') + '</div></section>' +

        (answers.length ? '<section><h3>Their answers</h3><div class="answers">' + answers.map(function (x) {
          return '<div><span class="k">' + esc(x[0]) + '</span><span>' + esc(x[1]) + '</span></div>';
        }).join('') + '</div></section>' : '') +

        '<section><h3>Calls</h3>' + (d.bookings.length ? d.bookings.map(function (b) {
          return '<div class="toggle-row"><b>' + esc(callTime(b.start_time)) + '</b>' + bookingBadge(b.status) + '</div>';
        }).join('') : '<div class="muted">No calls booked yet</div>') + '</section>' +

        '<section><h3>Notes</h3><form data-note><textarea name="note" placeholder="Add a note…"></textarea><button class="btn sm mt" type="submit">Add note</button></form>' +
          d.notes.map(function (n) { return '<div class="note">' + esc(n.note) + '<div class="sub">' + esc(when(n.created_at)) + '</div></div>'; }).join('') +
        '</section>' +

        '<section><details class="c-details"><summary>Edit details</summary><form class="form-grid" data-form>' +
          field('name', 'Name', l.name) + field('email', 'Email', l.email, 'email') +
          field('phone', 'Phone', l.phone, 'tel') + field('instagram', 'Instagram', l.instagram) +
          field('plan', 'Plan / package', l.plan) + field('amount_paid', 'Amount paid (USD)', l.amount_paid, 'number') +
          '<label class="full"><button class="btn" type="submit">Save</button></label>' +
        '</form></details></section>' +

        '<section><button class="btn ghost" data-archive>' + (l.archived_at ? 'Unarchive' : 'Archive') + '</button></section>';

      $('[data-close]', dr).addEventListener('click', function () { closeDrawer(); });
      bindLeadEdits(l, dr, renderCoachLead, 'Closed! Add the amount paid under Edit details.');
    }).catch(function (e) {
      if (e.message !== 'unauthorized') dr.innerHTML = '<div class="dh"><h2>Couldn\'t open</h2><button class="x" data-close>✕</button></div><p>' + esc(e.message) + '</p>';
      var x = $('[data-close]', dr);
      if (x) x.addEventListener('click', function () { closeDrawer(); });
    });
  }

  /* ---------- Calls ---------- */
  function coachCalls() {
    var tab = store('bk_tab') || 'upcoming';
    view.innerHTML =
      '<div class="ph"><div><h1>Calls</h1></div>' +
      coachPills('data-tab', tab, [['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']]) + '</div>' +
      '<div class="c-list" data-list><div class="loading">Loading…</div></div>';
    onPills(view, '[data-tab]', function (v) {
      tab = v; store('bk_tab', v);
      $$('[data-tab] button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
      load();
    });
    function load() {
      api('bookings', { tab: tab }).then(function (d) {
        $('[data-list]', view).innerHTML = d.rows.length ? d.rows.map(function (b) { return callCard(b, { marks: tab === 'past' }); }).join('')
          : '<div class="c-empty">No ' + tab + ' calls</div>';
        bindCallCards(load);
      }).catch(fail);
    }
    load();
  }

  /* ---------- Visitors ---------- */
  function coachVisitors() {
    var defaults = { range: '7d', did: '' };
    var f = Object.assign({}, defaults, readStore('cv'));
    var q = '';
    var groups = [
      { key: 'range', label: 'Seen', options: [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'Any time']] },
      { key: 'did', label: 'Who', options: [['', 'Everyone'], ['ads', 'Came from an ad'], ['vsl', 'Watched the video'], ['started', 'Started the application'],
        ['applied', 'Applied'], ['booked', 'Booked a call'], ['none', 'Didn\'t apply']] }
    ];
    view.innerHTML =
      '<div class="ph"><div><h1>Visitors</h1><div class="sub" data-count></div></div></div>' +
      searchRow('Search by name') +
      '<div class="c-list" data-list><div class="loading">Loading…</div></div>';
    var badge = setupSearch(groups, function () { return f; }, defaults, function (v) { q = v; load(); }, function (next) {
      f = next; store('cv', JSON.stringify(f)); badge(); load();
    });

    function load() {
      api('visitors', { range: f.range, did: f.did, q: q }).then(function (d) {
        var rows = d.rows;
        $('[data-count]', view).textContent = num(rows.length) + (rows.length === 500 ? '+' : '') + (rows.length === 1 ? ' person' : ' people') + ' visited the page';
        $('[data-list]', view).innerHTML = rows.length ? rows.map(function (r) {
          var video = r.vsl_seconds ? 'Watched ' + spoken(r.vsl_seconds) + ' of the video (' + r.vsl_pct + '%)' : 'Didn\'t watch the video';
          var progress = r.booked ? 'Booked a call' : r.lead_id || r.furthest_step >= 7 ? 'Applied'
            : r.furthest_step ? 'Got to question ' + r.furthest_step + ' of 6' : 'Didn\'t start the application';
          return '<button type="button" class="c-card" data-id="' + esc(r.id) + '">' +
            '<div class="c-top"><b>' + esc(r.name || 'Visitor') + '</b><span class="c-tag' + (r.from_ad ? ' ad' : '') + '">' + (r.from_ad ? 'Ad' : 'Direct') + '</span></div>' +
            '<div class="c-sub">' + esc(video) + '</div>' +
            '<div class="c-sub">' + esc(progress) + ' · ' + esc(ago(r.last_seen_at)) + '</div>' + adSub(r) + '</button>';
        }).join('') : '<div class="c-empty">No visitors' + (q || f.did ? ' match these filters' : ' in this time range') + '</div>';
        $$('[data-id]', view).forEach(function (c) {
          c.addEventListener('click', function () { location.hash = '#/visitor/' + encodeURIComponent(c.getAttribute('data-id')); });
        });
      }).catch(fail);
    }
    load();
  }

  var BOOKING_TEXT = {
    booking_created: 'Booked a call', booking_cancelled: 'Cancelled the call', booking_no_show: 'Missed the call',
    call_showed: 'Showed up to the call', call_no_show: 'Missed the call'
  };
  // Visitor events in plain words. Returns null for events coaches don't need.
  function plainEvent(e) {
    var d = e.data || {};
    switch (e.type) {
      case 'pageview': return e.path === '/booking' ? 'Opened the booking page' : e.path === '/thank-you' ? 'Reached the thank-you page' : 'Opened the page';
      case 'video_progress': return 'Watched ' + spoken(d.seconds) + ' of the video (' + (d.pct || 0) + '%)';
      case 'cta_click': return /^apply_/.test(e.name || '') ? 'Tapped Apply' : null;
      case 'app_step': return 'Answered question ' + d.step + (STEP_NAMES[d.step] ? ' (' + STEP_NAMES[d.step] + ')' : '');
      case 'lead': return e.name === 'application_disqualified' ? 'Sent the application (didn\'t qualify)' : 'Sent the application';
      case 'booking': return BOOKING_TEXT[e.name] ? BOOKING_TEXT[e.name] + (d.start_time ? ' for ' + callTime(d.start_time) : '') : null;
      case 'session_end': return d.seconds_on_page ? 'Left after ' + spoken(d.seconds_on_page) : 'Left the page';
      default: return null;
    }
  }

  function coachVisitor(id) {
    loading();
    api('visitor', { id: id }).then(function (d) {
      var v = d.visitor;
      var lead = d.leads[0];
      var fromAd = Boolean(v.utm_campaign || v.fbclid);
      var adRows = [['Campaign', v.utm_campaign], ['Ad set', v.utm_term], ['Ad', v.utm_content]].filter(function (x) { return x[1]; });
      var sessions = [];
      var byId = {};
      d.events.forEach(function (e) {
        var sid = e.session_id || 'none';
        if (!byId[sid]) { byId[sid] = { events: [] }; sessions.push(byId[sid]); }
        byId[sid].events.push(e);
      });
      sessions.reverse(); // newest visit first

      var html = sessions.map(function (s) {
        // Keep only the furthest video point of each visit.
        var lastVideo = s.events.filter(function (e) { return e.type === 'video_progress'; }).pop();
        var items = s.events.filter(function (e) { return e.type !== 'video_progress' || e === lastVideo; })
          .map(function (e) { return { t: e.created_at, text: plainEvent(e) }; })
          .filter(function (x) { return x.text; });
        if (!items.length) return '';
        return '<div class="c-visit"><div class="c-visit-h">' + esc(callTime(s.events[0].created_at)) + '</div>' + items.map(function (x) {
          return '<div class="c-tl"><span class="t">' + esc(new Date(x.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) + '</span><span>' + esc(x.text) + '</span></div>';
        }).join('') + '</div>';
      }).join('');

      view.innerHTML =
        '<a class="back" href="#/visitors">← Visitors</a>' +
        '<div class="ph"><div><h1>' + esc(lead && lead.name ? lead.name : 'Visitor') + '</h1>' +
        '<div class="sub">' + (fromAd ? 'Came from an ad' : 'Came directly') + ' · first visit ' + esc(day(v.first_seen_at)) + '</div></div>' +
        (lead ? '<button class="btn" data-lead="' + esc(lead.id) + '">Open lead</button>' : '') + '</div>' +
        (adRows.length ? '<div class="card" style="margin-bottom:14px"><div class="kv">' + adRows.map(function (x) {
          return '<div><div class="k">' + x[0] + '</div><div class="v">' + esc(x[1]) + '</div></div>';
        }).join('') + '</div></div>' : '') +
        '<div class="card">' + (html || '<div class="c-empty">Nothing to show yet</div>') + '</div>';

      var b = $('[data-lead]', view);
      if (b) b.addEventListener('click', function () { openLead(b.getAttribute('data-lead')); });
    }).catch(fail);
  }

  /* ---------- Settings ---------- */
  function coachSettings() {
    loading();
    api('settings').then(function (s) {
      var ignored = false;
      try { ignored = localStorage.getItem('kf_ignore') === '1'; } catch (e) {}
      view.innerHTML =
        '<div class="ph"><div><h1>Settings</h1></div></div>' +
        '<div class="card" data-push style="margin-bottom:14px"></div>' +
        '<div class="card" style="margin-bottom:14px">' +
          '<div class="toggle-row"><div><b>Don\'t track this phone</b><div class="sub">Turn on so your own visits to the website don\'t show up as visitors.</div></div>' +
          '<label class="switch"><input type="checkbox" data-ignore' + (ignored ? ' checked' : '') + '><span></span></label></div>' +
        '</div>' +
        '<button type="button" class="btn ghost c-signout" data-signout>Sign out</button>';
      renderPush(s.push);
      $('[data-ignore]', view).addEventListener('change', function (e) {
        try {
          if (e.target.checked) localStorage.setItem('kf_ignore', '1');
          else localStorage.removeItem('kf_ignore');
          toast(e.target.checked ? 'This phone won\'t be tracked' : 'This phone is tracked again');
        } catch (ex) { toast('Couldn\'t save this setting', true); }
      });
      $('[data-signout]', view).addEventListener('click', function () {
        api('logout', null, {}).then(showLogin, showLogin);
      });
    }).catch(fail);
  }

  /* ================= phone notifications (web push) ================= */
  var pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('standalone'); // see admin.css: home-screen app height fix
  var swReady = null;

  function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    if (!swReady) {
      swReady = navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' })
        .then(function () { return navigator.serviceWorker.ready; })
        .catch(function (e) { swReady = null; throw e; });
    }
    return swReady;
  }
  if ('serviceWorker' in navigator) {
    registerSW().catch(function () {});
    // A tapped notification while the app is open: switch to the page it points at.
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'open' && e.data.url) {
        var h = new URL(e.data.url, location.href).hash;
        if (h && h !== location.hash) location.hash = h; else route();
      }
    });
  }

  function deviceName() {
    var ua = navigator.userAgent;
    var dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIOS && !/iPhone/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android' :
      /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
    if (isIOS || dev === 'Android') return dev;
    var br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? dev + ' · ' + br : dev;
  }
  function b64ToBytes(s) {
    var b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function currentSub() {
    if (!pushSupported) return Promise.resolve(null);
    return registerSW().then(function (reg) { return reg.pushManager.getSubscription(); }).catch(function () { return null; });
  }

  // Phone notifications card: turn push on for this device, pick alert types per device, test, remove.
  function renderPush(p) {
    var box = $('[data-push]', view);
    if (!box) return;
    currentSub().then(function (sub) { draw(p, sub ? sub.endpoint : ''); });

    function save(op, body, msg) {
      return api(op, null, body).then(function (res) { if (msg) toast(msg); renderPush(res.push); })
        .catch(function (e) { toast(e.message, true); renderPush(p); });
    }

    function draw(p, mine) {
      var list = p.devices.map(function (d) { return { endpoint: d.endpoint, name: d.name, types: d.types.slice() }; });
      var me = list.filter(function (d) { return d.endpoint === mine; })[0];
      var perm = pushSupported ? Notification.permission : 'default';
      var state = '';
      if (!p.configured) {
        state = '<p class="alert-note bad">Push isn\'t set up yet (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on Vercel), so no notifications will send.</p>';
      } else if (isIOS && !standalone) {
        state = '<div class="install-steps"><b>Get alerts on this iPhone</b><ol>' +
          '<li>Open this page in <b>Safari</b>.</li>' +
          '<li>Tap <b>Share</b> <span class="muted">(square with arrow)</span> → <b>Add to Home Screen</b>.</li>' +
          '<li>Open <b>Knight</b> from your home screen, sign in, and come back here to turn on notifications.</li></ol></div>';
      } else if (!pushSupported) {
        state = '<p class="alert-note">This browser can\'t receive push notifications.</p>';
      } else if (me) {
        state = '<div class="push-on"><span class="ok">●</span> Notifications are on for this device.' +
          '<span class="push-btns"><button type="button" class="btn ghost sm" data-ptest="' + esc(me.endpoint) + '">Send test</button>' +
          '<button type="button" class="btn ghost sm" data-poff>Turn off</button></span></div>';
      } else if (perm === 'denied') {
        state = '<p class="alert-note bad">Notifications are blocked for this app. ' +
          (isIOS ? 'Open iPhone <b>Settings → Notifications → Knight</b> and allow them, then reopen the app.' : 'Allow notifications for this site in your browser settings, then reload.') + '</p>';
      } else {
        state = '<button type="button" class="btn" data-pon>Turn on notifications for this device</button>';
      }

      box.innerHTML =
        '<h2>Phone notifications</h2>' +
        '<p class="muted" style="margin-top:-4px">Get a notification when someone applies, books, cancels or no-shows. Each device picks its own alerts.</p>' +
        state +
        (list.length ? '<div class="alert-list" style="margin-top:12px">' + list.map(function (d, i) {
          return '<div class="alert-row">' +
            '<div class="alert-email">' + esc(d.name) + (d.endpoint === mine ? ' <span class="this-dev">This device</span>' : '') + '</div>' +
            '<div class="chips alert-types">' + p.types.map(function (t) {
              var on = d.types.indexOf(t.key) !== -1;
              return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-i="' + i + '" data-ptype="' + t.key + '" aria-pressed="' + on + '">' + esc(t.label) + '</button>';
            }).join('') + '</div>' +
            '<button type="button" class="btn ghost sm" data-premove="' + i + '" aria-label="Remove ' + esc(d.name) + '">Remove</button>' +
          '</div>';
        }).join('') + '</div>' : '');

      $$('[data-ptype]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var d = list[+b.getAttribute('data-i')];
          var k = b.getAttribute('data-ptype');
          var idx = d.types.indexOf(k);
          if (idx === -1) d.types.push(k); else d.types.splice(idx, 1);
          save('pushUpdate', { endpoint: d.endpoint, types: d.types }, d.name + ': ' + b.textContent + (idx === -1 ? ' on' : ' off'));
        });
      });
      $$('[data-premove]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          var d = list[+b.getAttribute('data-premove')];
          if (!window.confirm('Stop notifications on ' + d.name + '?')) return;
          if (d.endpoint === mine) return turnOff();
          save('pushRemove', { endpoint: d.endpoint }, d.name + ' removed');
        });
      });
      var on = $('[data-pon]', box);
      if (on) on.addEventListener('click', function () {
        on.disabled = true;
        on.textContent = 'Turning on…';
        // Ask right inside the tap: iOS only shows the prompt for a user gesture.
        Notification.requestPermission().then(function (res) {
          if (res !== 'granted') throw new Error(res === 'denied' ? 'Notifications were blocked.' : 'Notifications weren\'t allowed.');
          return registerSW();
        }).then(function (reg) {
          var key = b64ToBytes(p.public_key);
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(function () {
            // An old subscription made with a different key blocks a new one: drop it and retry.
            return reg.pushManager.getSubscription().then(function (old) { return old && old.unsubscribe(); })
              .then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
          });
        }).then(function (sub) {
          return save('pushSubscribe', { subscription: sub.toJSON(), name: deviceName() }, 'Notifications on for this device');
        }).catch(function (e) { toast(e.message, true); renderPush(p); });
      });
      var off = $('[data-poff]', box);
      if (off) off.addEventListener('click', turnOff);
      $$('[data-ptest]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          api('pushTest', null, { endpoint: b.getAttribute('data-ptest') }).then(function () { toast('Test sent. It should arrive in a few seconds.'); })
            .catch(function (e) { toast(e.message, true); renderPush(p); })
            .then(function () { b.disabled = false; });
        });
      });

      function turnOff() {
        currentSub().then(function (sub) { return sub && sub.unsubscribe(); }).catch(function () {})
          .then(function () { save('pushRemove', { endpoint: mine }, 'Notifications off for this device'); });
      }
    }
  }

  // Coming back to the home-screen app after a while: reload the page's data (there's no pull-to-refresh).
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 60000 && !$('#app').hidden && !$('.drawer')) route();
    hiddenAt = 0;
  });

  /* ================= boot ================= */
  api('session').then(function () { showApp(); route(); }).catch(function (e) {
    if (e.message !== 'unauthorized') { showApp(); fail(e); }
  });
})();

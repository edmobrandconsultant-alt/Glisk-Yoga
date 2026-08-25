/* Glisk diary — private admin screen. Vanilla, no dependencies. */
(function () {
  'use strict';

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var token = sessionStorage.getItem('glisk-admin') || '';

  var signin = document.getElementById('signin');
  var panel = document.getElementById('panel');

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ authorization: 'Bearer ' + token }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Something went wrong.');
        return body;
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var fmtWhen = function (ms) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(ms));
  };

  var hhmm = function (min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  };
  var toMin = function (text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec((text || '').trim());
    if (!m) return null;
    var v = +m[1] * 60 + +m[2];
    return v >= 0 && v <= 1440 ? v : null;
  };

  // ---- sign in -------------------------------------------------------------

  document.getElementById('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    token = new FormData(e.target).get('token');
    api('/api/admin/bookings').then(function () {
      sessionStorage.setItem('glisk-admin', token);
      open();
    }).catch(function (err) {
      var box = document.getElementById('signin-error');
      box.textContent = err.message === 'Not authorised' ? 'That password is not right.' : err.message;
      box.hidden = false;
    });
  });

  function open() {
    signin.hidden = true;
    panel.hidden = false;
    loadBookings();
    loadHours();
    loadBlackouts();
  }

  // ---- bookings ------------------------------------------------------------

  var money = function (p) { return '£' + (p / 100).toFixed(2); };

  function loadBookings() {
    api('/api/admin/bookings').then(function (data) {
      var live = data.bookings.filter(function (b) {
        return b.status === 'confirmed' || b.status === 'awaiting_review';
      });
      var waiting = live.filter(function (b) { return b.status === 'awaiting_review'; });

      document.getElementById('bookings-summary').textContent =
        (live.length ? live.length + ' booking' + (live.length === 1 ? '' : 's') + ' from today onwards.'
                     : 'Nothing booked yet.')
        + (waiting.length ? '  ' + waiting.length + ' home visit'
            + (waiting.length === 1 ? '' : 's') + ' waiting for you to confirm or refund.' : '');

      // Anything waiting on Fleur goes first — it is the only thing here that
      // needs an action rather than just reading.
      live.sort(function (a, b) {
        if ((a.status === 'awaiting_review') !== (b.status === 'awaiting_review')) {
          return a.status === 'awaiting_review' ? -1 : 1;
        }
        return a.start_utc - b.start_utc;
      });

      document.getElementById('bookings').innerHTML = live.map(function (b) {
        var review = b.status === 'awaiting_review';
        var paid = b.payment_status === 'paid' ? money(b.amount_pence) + ' paid'
                 : b.payment_status === 'simulated' ? money(b.amount_pence) + ' (test payment)'
                 : b.payment_status;
        return '<div class="place" style="margin-bottom:14px' + (review ? ';border-left:3px solid var(--gleam)' : '') + '">'
          + '<div class="city">' + esc(fmtWhen(b.start_utc)) + (review ? ' · needs you' : '') + '</div>'
          + '<h3>' + esc(b.name) + ' — ' + esc(b.service_name) + '</h3>'
          + '<p>' + esc(paid) + '<br>' + esc(b.email) + (b.phone ? ' · ' + esc(b.phone) : '')
          + (b.address ? '<br><strong>Address:</strong> ' + esc(b.address) : '')
          + (b.notes ? '<br><strong>Notes:</strong> ' + esc(b.notes) : '')
          + '<br><span class="muted-line">Ref ' + esc(b.ref) + '</span></p>'
          + (review
              ? '<div class="step-nav" style="margin-top:12px">'
                + '<button type="button" class="btn" data-approve="' + esc(b.id) + '">Confirm this visit</button>'
                + '<button type="button" class="btn btn-ghost" data-refund="' + esc(b.id) + '">Refund and decline</button>'
                + '</div>'
              : '')
          + '</div>';
      }).join('') || '';
    }).catch(function (err) { document.getElementById('bookings-summary').textContent = err.message; });
  }

  document.getElementById('bookings').addEventListener('click', function (event) {
    var approve = event.target.closest('[data-approve]');
    var decline = event.target.closest('[data-refund]');
    if (!approve && !decline) return;

    var id = (approve || decline).getAttribute(approve ? 'data-approve' : 'data-refund');
    if (approve) {
      if (!window.confirm('Confirm this home visit? They get an email saying you are coming.')) return;
      api('/api/admin/bookings/' + id + '/approve', { method: 'POST' })
        .then(loadBookings).catch(function (e) { window.alert(e.message); });
      return;
    }

    var reason = window.prompt('Refund and decline. Anything you want to say to them? (optional)');
    if (reason === null) return;
    api('/api/admin/bookings/' + id + '/refund', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason }),
    }).then(loadBookings).catch(function (e) { window.alert(e.message); });
  });

  // ---- working hours -------------------------------------------------------

  function loadHours() {
    api('/api/admin/availability').then(function (data) {
      var byDay = {};
      data.availability.forEach(function (r) { byDay[r.weekday] = r; });
      document.getElementById('hours-form').innerHTML = DAYS.map(function (name, i) {
        var r = byDay[i];
        return '<label>' + name
          + '<span style="display:flex;gap:10px;align-items:center">'
          + '<input type="text" inputmode="numeric" placeholder="10:00" data-day="' + i + '" data-kind="start" value="' + (r ? hhmm(r.start_min) : '') + '">'
          + '<span class="opt">to</span>'
          + '<input type="text" inputmode="numeric" placeholder="17:00" data-day="' + i + '" data-kind="end" value="' + (r ? hhmm(r.end_min) : '') + '">'
          + '</span></label>';
      }).join('');
    });
  }

  document.getElementById('save-hours').addEventListener('click', function () {
    var status = document.getElementById('hours-status');
    var rows = [], bad = null;
    DAYS.forEach(function (_, i) {
      var s = document.querySelector('[data-day="' + i + '"][data-kind="start"]').value;
      var e = document.querySelector('[data-day="' + i + '"][data-kind="end"]').value;
      if (!s.trim() && !e.trim()) return;                    // day off
      var sm = toMin(s), em = toMin(e);
      if (sm === null || em === null) { bad = DAYS[i] + ' needs times like 10:00'; return; }
      if (em <= sm) { bad = DAYS[i] + ' finishes before it starts'; return; }
      rows.push({ weekday: i, start_min: sm, end_min: em });
    });
    if (bad) { status.textContent = bad; return; }

    status.textContent = 'Saving…';
    api('/api/admin/availability', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ availability: rows }),
    }).then(function () { status.textContent = 'Saved.'; })
      .catch(function (err) { status.textContent = err.message; });
  });

  // ---- days away -----------------------------------------------------------

  function loadBlackouts() {
    api('/api/admin/blackouts').then(function (data) {
      document.getElementById('blackouts').innerHTML = data.blackouts.map(function (b) {
        var span = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
        return '<p class="muted-line">' + esc(span.format(new Date(b.start_utc))) + ' – '
          + esc(span.format(new Date(b.end_utc - 1))) + (b.reason ? ' · ' + esc(b.reason) : '')
          + ' <button type="button" class="slot" data-remove="' + b.id + '">Remove</button></p>';
      }).join('') || '<p class="muted-line">Nothing booked off.</p>';
    });
  }

  document.getElementById('blackouts').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    api('/api/admin/blackouts/' + btn.getAttribute('data-remove'), { method: 'DELETE' })
      .then(loadBlackouts);
  });

  document.getElementById('blackout-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = new FormData(e.target);
    var from = d.get('from'), to = d.get('to');
    if (!from || !to) return;
    // Local midnight to midnight after the last day, so "to" is inclusive.
    var start = new Date(from + 'T00:00:00Z').getTime();
    var end = new Date(to + 'T00:00:00Z').getTime() + 86400000;
    if (end <= start) return;
    api('/api/admin/blackouts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start_utc: start, end_utc: end, reason: d.get('reason') }),
    }).then(function () { e.target.reset(); loadBlackouts(); });
  });

  if (token) open();
})();

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

  function loadBookings() {
    api('/api/admin/bookings').then(function (data) {
      var live = data.bookings.filter(function (b) { return b.status === 'confirmed'; });
      document.getElementById('bookings-summary').textContent =
        live.length ? live.length + ' booking' + (live.length === 1 ? '' : 's') + ' from today onwards.'
                    : 'Nothing booked yet.';
      document.getElementById('bookings').innerHTML = live.map(function (b) {
        return '<div class="place" style="margin-bottom:14px">'
          + '<div class="city">' + esc(fmtWhen(b.start_utc)) + '</div>'
          + '<h3>' + esc(b.name) + ' — ' + esc(b.service_name) + '</h3>'
          + '<p>' + esc(b.email) + (b.phone ? ' · ' + esc(b.phone) : '')
          + (b.notes ? '<br><strong>Notes:</strong> ' + esc(b.notes) : '')
          + '<br><span class="muted-line">Ref ' + esc(b.ref) + '</span></p></div>';
      }).join('') || '';
    }).catch(function (err) { document.getElementById('bookings-summary').textContent = err.message; });
  }

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

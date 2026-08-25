/* Glisk booking — vanilla, no dependencies, no build step.
 *
 * The page ships with the widget hidden and unhides it here, so anyone without
 * JavaScript sees the <noscript> fallback rather than a set of dead buttons.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-booking]');
  if (!root) return;
  root.hidden = false;

  var state = { service: null, start: null, from: null, days: 14 };

  var el = {
    services: document.getElementById('services'),
    days: document.getElementById('days'),
    loading: document.getElementById('loading'),
    noSlots: document.getElementById('no-slots'),
    whenIntro: document.getElementById('when-intro'),
    chosen: document.getElementById('chosen-summary'),
    form: document.getElementById('details-form'),
    formError: document.getElementById('form-error'),
    confirm: document.getElementById('confirm'),
    more: document.getElementById('more-days'),
  };

  var money = function (pence) { return '£' + (pence / 100).toFixed(0); };

  function busy(message) {
    el.loading.textContent = message || '';
  }

  function show(name) {
    var steps = root.querySelectorAll('.step');
    for (var i = 0; i < steps.length; i++) {
      steps[i].hidden = steps[i].getAttribute('data-step') !== name;
    }
    var heading = root.querySelector('.step:not([hidden]) h2, .step:not([hidden]) h3');
    if (heading) heading.setAttribute('tabindex', '-1'), heading.focus();
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
        return body;
      });
    });
  }

  // ---- dates ---------------------------------------------------------------

  function todayKey() {
    // en-CA formats as YYYY-MM-DD, which is exactly the key the API wants.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }

  function dayLabel(key) {
    var parts = key.split('-');
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12));
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
    }).format(d);
  }

  function timeLabel(ms) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(ms)).replace(/ /g, ' ');
  }

  // ---- step 1: treatments --------------------------------------------------

  function loadServices() {
    busy('Loading treatments…');
    return api('/api/services').then(function (data) {
      busy('');
      el.services.innerHTML = '';
      data.services.forEach(function (svc) {
        var card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'listitem');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost';
        btn.textContent = 'Choose this';
        card.innerHTML = '<h3>' + esc(svc.name) + '</h3>'
          + '<div class="price">' + svc.duration_min + ' min · ' + money(svc.price_pence) + '</div>'
          + (svc.blurb ? '<p>' + esc(svc.blurb) + '</p>' : '');
        card.appendChild(btn);
        btn.addEventListener('click', function () { pickService(svc); });
        el.services.appendChild(card);
      });
    }).catch(fail);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pickService(svc) {
    state.service = svc;
    state.from = todayKey();
    state.days = 14;
    el.whenIntro.textContent = svc.name + ', ' + svc.duration_min + ' minutes, ' + money(svc.price_pence) + '.';
    show('when');
    loadSlots();
  }

  // ---- step 2: times -------------------------------------------------------

  function loadSlots() {
    busy('Finding free times…');
    el.days.innerHTML = '';
    return api('/api/slots?service=' + encodeURIComponent(state.service.id)
               + '&from=' + state.from + '&days=' + state.days)
      .then(function (data) {
        busy('');
        el.noSlots.hidden = data.days.length > 0;
        data.days.forEach(function (day) {
          var group = document.createElement('div');
          group.className = 'slot-day';
          var h = document.createElement('h3');
          h.textContent = dayLabel(day.date);
          group.appendChild(h);
          var list = document.createElement('div');
          list.className = 'slot-list';
          day.slots.forEach(function (ms) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'slot';
            b.textContent = timeLabel(ms);
            b.addEventListener('click', function () { pickSlot(ms); });
            list.appendChild(b);
          });
          group.appendChild(list);
          el.days.appendChild(group);
        });
      }).catch(fail);
  }

  el.more.addEventListener('click', function () {
    state.days = Math.min(state.days + 21, 60);
    loadSlots();
  });

  function pickSlot(ms) {
    state.start = ms;
    el.chosen.textContent = state.service.name + ' — ' + dayLabel(todayKeyFor(ms)) + ', ' + timeLabel(ms) + '.';
    show('details');
  }

  function todayKeyFor(ms) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));
  }

  // ---- step 3: details -----------------------------------------------------

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    el.formError.hidden = true;

    var data = new FormData(el.form);
    var payload = {
      service: state.service.id,
      start: state.start,
      name: (data.get('name') || '').trim(),
      email: (data.get('email') || '').trim(),
      phone: (data.get('phone') || '').trim(),
      notes: (data.get('notes') || '').trim(),
      website: data.get('website') || '',
    };

    if (payload.name.length < 2) return showFormError('Please give your name.');
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(payload.email)) {
      return showFormError('That email address does not look right.');
    }

    el.confirm.disabled = true;
    busy('Confirming…');

    api('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      busy('');
      document.getElementById('done-detail').textContent =
        state.service.name + ', ' + dayLabel(todayKeyFor(state.start)) + ' at ' + timeLabel(state.start)
        + '. St Anne’s House, St Anne’s Road, Brislington, BS4 4AB.';
      document.getElementById('done-ref').textContent =
        'Reference ' + res.ref + '. A confirmation is on its way to ' + payload.email + '.';
      show('done');
    }).catch(function (err) {
      busy('');
      el.confirm.disabled = false;
      showFormError(err.message);
      // A gone slot means the calendar on screen is stale — refresh it.
      if (/gone|booked that slot/i.test(err.message)) {
        show('when');
        loadSlots();
      }
    });
  });

  function showFormError(message) {
    el.formError.textContent = message;
    el.formError.hidden = false;
    el.confirm.disabled = false;
  }

  function fail(err) {
    busy('');
    el.days.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'formerror';
    p.textContent = err.message + ' If it keeps happening, email hello@gliskmassage.co.uk.';
    el.days.appendChild(p);
  }

  // ---- back buttons --------------------------------------------------------

  root.addEventListener('click', function (event) {
    var back = event.target.closest('[data-back]');
    if (back) show(back.getAttribute('data-back'));
  });

  // ---- managing an existing booking ---------------------------------------

  function manageView(token) {
    busy('Looking up your booking…');
    api('/api/manage/' + token).then(function (data) {
      busy('');
      var b = data.booking;
      var detail = document.getElementById('manage-detail');
      if (b.status === 'cancelled') {
        detail.textContent = 'This booking (' + b.ref + ') has been cancelled.';
        document.getElementById('cancel-booking').hidden = true;
      } else {
        detail.textContent = b.service_name + ', ' + dayLabel(todayKeyFor(b.start_utc))
          + ' at ' + timeLabel(b.start_utc) + '. Reference ' + b.ref + '.';
      }
      show('manage');
    }).catch(function (err) {
      busy('');
      document.getElementById('manage-detail').textContent = err.message;
      document.getElementById('cancel-booking').hidden = true;
      show('manage');
    });

    document.getElementById('cancel-booking').addEventListener('click', function () {
      if (!window.confirm('Cancel this booking?')) return;
      busy('Cancelling…');
      api('/api/manage/' + token, { method: 'POST' }).then(function () {
        busy('');
        document.getElementById('manage-detail').textContent =
          'That’s cancelled, and the slot is free again. Thank you for letting me know.';
        document.getElementById('cancel-booking').hidden = true;
      }).catch(function (err) { busy(''); window.alert(err.message); });
    });
  }

  var manageToken = new URLSearchParams(location.search).get('manage');
  if (manageToken && /^[a-f0-9]{32}$/.test(manageToken)) {
    manageView(manageToken);
  } else {
    show('service');
    loadServices();
  }
})();

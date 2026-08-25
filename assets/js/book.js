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

  // Whole pounds stay clean (£60); anything with pence shows them (£75.95).
  // Travel charges are rarely round, and a rounded figure here would not match
  // what the card is actually charged.
  var money = function (pence) {
    return '£' + (pence % 100 === 0 ? (pence / 100).toFixed(0) : (pence / 100).toFixed(2));
  };

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
    document.getElementById('home-notice').hidden = !svc.requires_review;
    var addr = document.getElementById('address-field');
    addr.hidden = !svc.needs_address;
    addr.querySelector('textarea').required = Boolean(svc.needs_address);
    document.getElementById('postcode-field').hidden = !svc.needs_address;
    document.getElementById('travel-line').hidden = true;
    state.travel = null;
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

  // ---- travel, for home visits ---------------------------------------------

  var travelLine = document.getElementById('travel-line');

  function priceTravel() {
    var input = document.querySelector('input[name="postcode"]');
    var postcode = (input.value || '').trim();
    if (!state.service || !state.service.needs_address || postcode.length < 5) {
      travelLine.hidden = true;
      state.travel = null;
      return;
    }

    travelLine.hidden = false;
    travelLine.textContent = 'Working out the travel…';

    api('/api/travel-quote?postcode=' + encodeURIComponent(postcode)).then(function (q) {
      state.travel = q;
      var total = state.service.price_pence + q.pence;
      travelLine.classList.remove('is-problem');
      travelLine.textContent = q.pence
        ? q.miles + ' miles from Hanham. ' + (q.miles - q.chargeable_miles) + ' included, '
          + q.chargeable_miles + ' charged at 45p — travel ' + money(q.pence)
          + ', so ' + money(total) + ' altogether.'
        : q.miles + ' miles from Hanham, which is inside the five I include — no travel charge. '
          + money(total) + ' altogether.';
    }).catch(function (err) {
      state.travel = null;
      travelLine.classList.add('is-problem');
      travelLine.textContent = err.message;
    });
  }

  var travelTimer;
  document.addEventListener('input', function (event) {
    if (event.target.name !== 'postcode') return;
    clearTimeout(travelTimer);
    travelTimer = setTimeout(priceTravel, 500);
  });
  document.addEventListener('change', function (event) {
    if (event.target.name === 'postcode') { clearTimeout(travelTimer); priceTravel(); }
  });

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
      address: (data.get('address') || '').trim(),
      postcode: (data.get('postcode') || '').trim(),
      notes: (data.get('notes') || '').trim(),
      website: data.get('website') || '',
    };

    if (payload.name.length < 2) return showFormError('Please give your name.');
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(payload.email)) {
      return showFormError('That email address does not look right.');
    }
    if (state.service.needs_address) {
      if (payload.postcode.length < 5) return showFormError('Please give the postcode for the visit.');
      if (payload.address.length < 6) return showFormError('Please give the address for the visit.');
      if (!state.travel) return showFormError('I could not price the travel for that postcode. Check it and try again.');
    }

    el.confirm.disabled = true;
    busy('Confirming…');

    api('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      busy('Taking you to the payment page…');
      // res.amount_pence is what will actually be charged — the server prices
      // the travel again rather than trusting the figure shown on screen.
      // The slot is held from this moment, and released again if payment is
      // never completed — so leaving the tab open does not block anyone.
      window.location.href = res.checkout_url;
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

  // Clear a complaint as soon as the person starts addressing it, rather than
  // leaving a stale error sitting under a field they have already fixed.
  el.form.addEventListener('input', function () { el.formError.hidden = true; });

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

  var params = new URLSearchParams(location.search);
  var manageToken = params.get('manage');

  if (manageToken && /^[a-f0-9]{32}$/.test(manageToken)) {
    if (params.get('paid')) settleReturn(manageToken, params.get('simulated'));
    else manageView(manageToken);
  } else {
    show('service');
    loadServices();
  }

  /* Back from the payment page. With Stripe connected the webhook does the
   * confirming, so we poll briefly rather than trust the redirect — the redirect
   * only means the customer came back, not that the money arrived. Without
   * Stripe, the simulated endpoint stands in for the webhook. */
  function settleReturn(token, simulated) {
    show('done');
    var head = document.getElementById('done-head');
    var detail = document.getElementById('done-detail');
    head.textContent = 'Confirming your payment…';
    detail.textContent = 'One moment.';

    var finish = function (b) {
      var paid = b.payment_status === 'paid' || b.payment_status === 'simulated';
      if (!paid) {
        head.textContent = 'Payment not completed';
        detail.textContent = 'Nothing has been taken. You can start again, or email hello@gliskmassage.co.uk and I will sort it out.';
        return;
      }
      var reviewing = b.status === 'awaiting_review';
      head.textContent = reviewing ? 'Thank you — that\u2019s paid.' : 'You\u2019re booked in.';
      detail.textContent = reviewing
        ? 'I\u2019ll be in touch shortly to check a few details before the visit. If I can\u2019t come, you\u2019re refunded in full.'
        : b.service_name + ', ' + dayLabel(todayKeyFor(b.start_utc)) + ' at ' + timeLabel(b.start_utc)
          + '. St Anne\u2019s House, St Anne\u2019s Road, Brislington, BS4 4AB.';
      document.getElementById('done-ref').textContent =
        'Reference ' + b.ref + '. A confirmation email is on its way.'
        + (b.payment_status === 'simulated' ? ' (Test payment — no money was taken.)' : '');
    };

    var start = simulated
      ? api('/api/simulate-payment', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ manage_token: token }),
        })
      : Promise.resolve();

    start.then(function () { return poll(0); }).catch(function (err) {
      head.textContent = 'Something went wrong';
      detail.textContent = err.message + ' Please email hello@gliskmassage.co.uk with your name and the time you wanted.';
    });

    function poll(attempt) {
      return api('/api/manage/' + token).then(function (data) {
        var b = data.booking;
        if (b.payment_status !== 'unpaid' || attempt >= 6) return finish(b);
        return new Promise(function (r) { setTimeout(r, 1000); }).then(function () { return poll(attempt + 1); });
      });
    }
  }
})();

/* Gift vouchers — pick an amount, pay by card. Vanilla, no dependencies. */
(function () {
  'use strict';

  var buy = document.getElementById('voucher-buy');
  if (!buy) return;

  var form = document.getElementById('voucher-form');
  var errorBox = document.getElementById('voucher-error');
  var submit = document.getElementById('voucher-submit');
  var heading = document.getElementById('voucher-heading');

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
        return body;
      });
    });
  }

  var pounds = function (pence) { return '£' + (pence / 100).toFixed(0); };

  // Any of the tier buttons opens the form with that amount filled in.
  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-voucher]');
    if (!btn) return;
    var pence = Number(btn.getAttribute('data-voucher'));
    buy.hidden = false;
    form.elements.amount.value = (pence / 100).toFixed(0);
    heading.textContent = 'Your ' + pounds(pence) + ' voucher';
    buy.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.buyer_name.focus({ preventScroll: true });
  });

  function fail(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    submit.disabled = false;
  }

  form.addEventListener('input', function () { errorBox.hidden = true; });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;

    var data = new FormData(form);
    var amount = String(data.get('amount') || '').replace(/[£,\s]/g, '');
    var pence = Math.round(parseFloat(amount) * 100);

    if (!Number.isFinite(pence) || pence < 2000 || pence > 50000) {
      return fail('Please choose an amount between £20 and £500.');
    }
    if (String(data.get('buyer_name') || '').trim().length < 2) return fail('Please give your name.');
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(String(data.get('buyer_email') || '').trim())) {
      return fail('That email address does not look right.');
    }

    submit.disabled = true;
    api('/api/vouchers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount_pence: pence,
        buyer_name: String(data.get('buyer_name')).trim(),
        buyer_email: String(data.get('buyer_email')).trim(),
        recipient_name: String(data.get('recipient_name') || '').trim(),
        message: String(data.get('message') || '').trim(),
        website: data.get('website') || '',
      }),
    }).then(function (res) {
      window.location.href = res.checkout_url;
    }).catch(function (err) { fail(err.message); });
  });

  // Back from the payment page.
  var params = new URLSearchParams(location.search);
  var bought = params.get('bought');
  if (bought) {
    var done = document.getElementById('voucher-done');
    var detail = document.getElementById('voucher-done-detail');
    done.hidden = false;
    detail.textContent = 'Confirming your payment…';
    done.scrollIntoView({ block: 'start' });

    var afterwards = function (code) {
      document.getElementById('voucher-done-head').textContent = 'Thank you — that’s bought.';
      detail.textContent = code
        ? 'The voucher code is ' + code + ', and it is on its way to your inbox along with everything you need to pass it on.'
        : 'The voucher is on its way to your inbox, along with everything you need to pass it on.';
    };

    if (params.get('simulated')) {
      api('/api/simulate-payment', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voucher_id: bought }),
      }).then(function (r) { afterwards(r.code); })
        .catch(function (err) { detail.textContent = err.message; });
    } else {
      // With Stripe connected the webhook issues the voucher; the redirect only
      // means the buyer came back, so the email is the source of truth.
      afterwards(null);
    }
  }
})();

import { generateSlots, blocksFor, loadSettings, sweepExpired, HttpError } from './booking.js';
import { localDateKey, formatLocal, parseDateKey } from './time.js';
import { createCheckout, refund, verifyWebhook, voucherCode, isLive } from './payments.js';
import { quote as travelQuote } from './travel.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const LIMITS = { name: 80, email: 160, phone: 40, notes: 800, address: 300, message: 400, postcode: 10 };
const HOLD_MS = 20 * 60 * 1000;   // how long a slot is held while paying
const VOUCHER_MIN = 2000, VOUCHER_MAX = 50000;

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Deliberately permissive: the only thing worth rejecting here is input that
// clearly is not an address, since a real one is confirmed by the email landing.
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

function token(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function bookingRef() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY349'; // no look-alikes, read aloud cleanly
  const pick = crypto.getRandomValues(new Uint8Array(4));
  return 'GL-' + [...pick].map(b => alphabet[b % alphabet.length]).join('');
}

/** Constant-time compare so admin token guesses learn nothing from timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(request, env) {
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !safeEqual(supplied, env.ADMIN_TOKEN)) {
    throw new HttpError(401, 'Not authorised');
  }
}

async function sendMail(env, { to, subject, text }) {
  // Fail-soft on purpose: a booking that is safely in the database must not be
  // lost because a mail provider had a bad minute. Failures are logged instead.
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log('mail skipped (no provider configured):', subject, '->', to);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) console.error('mail failed', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('mail threw', err);
    return false;
  }
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const db = env.DB;

  if (request.method === 'GET' && pathname === '/api/services') {
    const { results } = await db
      .prepare(`SELECT id, name, duration_min, price_pence, blurb, location, requires_review, needs_address
                  FROM services WHERE active = 1 ORDER BY sort_order, name`)
      .all();
    return json({ services: results ?? [] });
  }

  if (request.method === 'GET' && pathname === '/api/slots') {
    const serviceId = url.searchParams.get('service');
    const from = url.searchParams.get('from') || localDateKey(Date.now());
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 14, 1), 60);
    if (!parseDateKey(from)) throw new HttpError(400, 'Bad from date');

    const service = await db.prepare('SELECT * FROM services WHERE id = ?1 AND active = 1').bind(serviceId).first();
    if (!service) throw new HttpError(404, 'No such treatment');

    const days_ = await generateSlots(db, service, from, days, Date.now());
    return json({ service: { id: service.id, name: service.name, duration_min: service.duration_min }, days: days_ });
  }

  if (request.method === 'GET' && pathname === '/api/travel-quote') {
    const settings = await loadSettings(db);
    const q = await travelQuote(db, settings, url.searchParams.get('postcode'));
    if (!q.ok && q.reason === 'unknown_postcode') throw new HttpError(400, 'I could not find that postcode. Check it and try again.');
    if (!q.ok && q.reason === 'too_far') {
      throw new HttpError(400, `That is about ${q.miles} miles from me, which is further than I travel. Email hello@gliskmassage.co.uk and we will see what is possible.`);
    }
    return json(q);
  }

  if (request.method === 'POST' && pathname === '/api/bookings') {
    const body = await request.json().catch(() => ({}));

    // Honeypot: a real person never fills a hidden field.
    if (clean(body.website, 100)) return json({ ok: true, checkout_url: url.origin + '/book.html' });

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email);
    const phone = clean(body.phone, LIMITS.phone);
    const address = clean(body.address, LIMITS.address);
    const notes = clean(body.notes, LIMITS.notes);
    const start = Number(body.start);

    if (name.length < 2) throw new HttpError(400, 'Please give your name');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right');
    if (!Number.isFinite(start)) throw new HttpError(400, 'Pick a time');

    const service = await db.prepare('SELECT * FROM services WHERE id = ?1 AND active = 1').bind(body.service).first();
    if (!service) throw new HttpError(404, 'No such treatment');
    if (service.needs_address && address.length < 8) {
      throw new HttpError(400, 'Please give the address for the visit');
    }

    await sweepExpired(db, Date.now());

    // Re-derive the offered slots server-side. The client is not trusted to have
    // picked a time inside working hours, outside a blackout, or ahead of the
    // notice period — this is the check that enforces all three.
    const dayKey = localDateKey(start);
    const offered = await generateSlots(db, service, dayKey, 1, Date.now());
    if (!offered.some(d => d.slots.includes(start))) {
      throw new HttpError(409, 'That time has just gone. Please pick another.');
    }

    const settings = await loadSettings(db);

    // Travel is priced here, never taken from the client. The booking page shows
    // the same figure, but this is the one that is charged.
    let travel = { pence: 0, miles: null, postcode: null };
    if (service.location === 'home') {
      const postcode = clean(body.postcode, LIMITS.postcode);
      if (!postcode) throw new HttpError(400, 'Please give the postcode for the visit');
      const q = await travelQuote(db, settings, postcode);
      if (!q.ok && q.reason === 'unknown_postcode') throw new HttpError(400, 'I could not find that postcode. Check it and try again.');
      if (!q.ok) throw new HttpError(400, `That is about ${q.miles} miles from me, which is further than I travel. Email hello@gliskmassage.co.uk and we will see what is possible.`);
      travel = { pence: q.pence, miles: q.miles, postcode: q.postcode };
    }
    const amount = service.price_pence + travel.pence;

    const end = start + service.duration_min * 60000;
    const id = crypto.randomUUID();
    const manageToken = token(16);
    const ref = bookingRef();
    const now = Date.now();

    // The slot is held from here. If payment is never completed the hold expires
    // and sweepExpired hands the time back.
    try {
      await db.batch([
        db.prepare(`INSERT INTO bookings
              (id, ref, service_id, start_utc, end_utc, name, email, phone, address, notes,
               status, payment_status, amount_pence, travel_pence, travel_miles, postcode,
               expires_utc, manage_token, created_utc)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'pending','unpaid',?11,?12,?13,?14,?15,?16,?17)`)
          .bind(id, ref, service.id, start, end, name, email, phone || null, address || null,
                notes || null, amount, travel.pence, travel.miles, travel.postcode,
                now + HOLD_MS, manageToken, now),
        ...blocksFor(start, end, settings.buffer_min).map(block =>
          db.prepare('INSERT INTO occupancy (block_utc, booking_id) VALUES (?1, ?2)').bind(block, id)),
      ]);
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        throw new HttpError(409, 'Someone booked that slot a moment before you. Please pick another.');
      }
      throw err;
    }

    const checkout = await createCheckout(env, {
      reference: id,
      kind: 'booking',
      description: `${service.name}, ${service.duration_min} min — ${formatLocal(start)}`
                   + (travel.pence ? ` (including ${travel.miles} mi travel)` : ''),
      amountPence: amount,
      email,
      origin: url.origin,
      successPath: `/book.html?manage=${manageToken}&paid=1`,
      cancelPath: `/book.html?manage=${manageToken}&cancelled=1`,
    });

    await db.prepare('UPDATE bookings SET stripe_session_id = ?2 WHERE id = ?1')
      .bind(id, checkout.sessionId).run();

    return json({
      ok: true, ref, manage_token: manageToken, checkout_url: checkout.url,
      simulated: Boolean(checkout.simulated), amount_pence: amount, travel_pence: travel.pence,
    }, 201);
  }

  // Payment confirmed. Shared by the Stripe webhook and, while Stripe is not
  // connected, by the simulated return from the payment page.
  async function settleBooking(id, how) {
    const b = await db.prepare(
      `SELECT b.*, s.requires_review, s.name AS service_name, s.duration_min
         FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ?1`).bind(id).first();
    if (!b) return null;
    if (b.payment_status !== 'unpaid') return b;      // webhooks can arrive twice

    const status = b.requires_review ? 'awaiting_review' : 'confirmed';
    await db.prepare(
      `UPDATE bookings SET status = ?2, payment_status = ?3, paid_utc = ?4, expires_utc = NULL
        WHERE id = ?1`).bind(id, status, how, Date.now()).run();

    const when = formatLocal(b.start_utc);
    const manageUrl = `${url.origin}/book.html?manage=${b.manage_token}`;
    const paid = `£${(b.amount_pence / 100).toFixed(2)}`;

    const forClient = b.requires_review
      ? `Hello ${b.name},\n\nThank you — that's ${paid} received for ${b.service_name} on ${when}, `
        + `at ${b.address}.\n\nOne more step: home visits are for women only, and I get in touch before `
        + `every one to check a few details. I'll message you shortly. If for any reason it turns out I `
        + `can't come, I refund you in full, straight away.\n\nYour reference: ${b.ref}\n`
        + `To cancel: ${manageUrl}\n\nFleur\nGlisk — Massage & Yoga\n`
      : `Hello ${b.name},\n\nYou're booked in for ${b.service_name}, ${when}, and that's ${paid} paid — `
        + `nothing to settle on the day.\n\n`
        + `Where: St Anne's House, St Anne's Road, Brislington, Bristol BS4 4AB\n`
        + `How long: ${b.duration_min} minutes\nYour reference: ${b.ref}\n\n`
        + `Need to move or cancel it? ${manageUrl}\n`
        + `Please give 24 hours' notice if you can, so the slot can go to someone else.\n\n`
        + `See you then.\nFleur\nGlisk — Massage & Yoga\n`;

    await Promise.all([
      sendMail(env, { to: b.email, subject: b.requires_review ? `Home visit request received — ${when}` : `Your massage is booked — ${when}`, text: forClient }),
      env.OWNER_EMAIL ? sendMail(env, {
        to: env.OWNER_EMAIL,
        subject: `${b.requires_review ? 'HOME VISIT to approve' : 'New booking'} — ${when} — ${b.name}`,
        text: `${b.service_name}\n${when}\n${paid} ${how === 'simulated' ? '(SIMULATED — no real money)' : 'paid'}\n\n`
            + `${b.name}\n${b.email}\n${b.phone || 'no phone given'}\n`
            + (b.address ? `\nAddress: ${b.address}\n` : '')
            + (b.travel_pence ? `Travel: ${b.travel_miles} mi, £${(b.travel_pence / 100).toFixed(2)} of the total\n` : '')
            + `\nNotes: ${b.notes || 'none'}\n\nRef ${b.ref}\n`
            + (b.requires_review ? `\nThis one needs your approval — open your diary to confirm or refund.\n` : ''),
      }) : Promise.resolve(),
    ]);
    return b;
  }

  async function settleVoucher(id, how) {
    const v = await db.prepare('SELECT * FROM vouchers WHERE id = ?1').bind(id).first();
    if (!v) return null;
    if (v.payment_status !== 'unpaid') return v;

    await db.prepare("UPDATE vouchers SET status = 'issued', payment_status = ?2, paid_utc = ?3 WHERE id = ?1")
      .bind(id, how, Date.now()).run();

    const amount = `£${(v.amount_pence / 100).toFixed(0)}`;
    await sendMail(env, {
      to: v.buyer_email,
      subject: `Your Glisk gift voucher — ${amount}`,
      text: `Hello ${v.buyer_name},\n\nHere is the voucher${v.recipient_name ? ' for ' + v.recipient_name : ''}:\n\n`
          + `    ${v.code}\n    ${amount}\n\n`
          + `It's valid for twelve months, and works for any treatment at St Anne's House or a home visit. `
          + `Whoever it's for just quotes the code when they book.\n\n`
          + (v.message ? `Your message: ${v.message}\n\n` : '')
          + `Thank you.\nFleur\nGlisk — Massage & Yoga\n`,
    });
    if (env.OWNER_EMAIL) {
      await sendMail(env, { to: env.OWNER_EMAIL, subject: `Voucher sold — ${amount}`,
        text: `${v.code}\n${amount} ${how === 'simulated' ? '(SIMULATED)' : 'paid'}\nBought by ${v.buyer_name}, ${v.buyer_email}\n` });
    }
    return v;
  }

  // ---- vouchers -------------------------------------------------------------

  if (request.method === 'POST' && pathname === '/api/vouchers') {
    const body = await request.json().catch(() => ({}));
    if (clean(body.website, 100)) return json({ ok: true, checkout_url: url.origin + '/gift-vouchers.html' });

    const amount = Math.round(Number(body.amount_pence));
    const buyerName = clean(body.buyer_name, LIMITS.name);
    const buyerEmail = clean(body.buyer_email, LIMITS.email);
    const recipient = clean(body.recipient_name, LIMITS.name);
    const message = clean(body.message, LIMITS.message);

    if (!Number.isFinite(amount) || amount < VOUCHER_MIN || amount > VOUCHER_MAX) {
      throw new HttpError(400, `Please choose an amount between £${VOUCHER_MIN / 100} and £${VOUCHER_MAX / 100}`);
    }
    if (buyerName.length < 2) throw new HttpError(400, 'Please give your name');
    if (!EMAIL_RE.test(buyerEmail)) throw new HttpError(400, 'That email address does not look right');

    const id = crypto.randomUUID();
    const code = voucherCode();
    await db.prepare(`INSERT INTO vouchers
        (id, code, amount_pence, buyer_name, buyer_email, recipient_name, message, created_utc)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
      .bind(id, code, amount, buyerName, buyerEmail, recipient || null, message || null, Date.now()).run();

    const checkout = await createCheckout(env, {
      reference: id,
      kind: 'voucher',
      description: `Glisk gift voucher — £${(amount / 100).toFixed(0)}`,
      amountPence: amount,
      email: buyerEmail,
      origin: url.origin,
      successPath: `/gift-vouchers.html?bought=${id}`,
      cancelPath: `/gift-vouchers.html?cancelled=1`,
    });
    await db.prepare('UPDATE vouchers SET stripe_session_id = ?2 WHERE id = ?1').bind(id, checkout.sessionId).run();

    return json({ ok: true, checkout_url: checkout.url, simulated: Boolean(checkout.simulated) }, 201);
  }

  // ---- Stripe webhook -------------------------------------------------------

  if (request.method === 'POST' && pathname === '/api/stripe/webhook') {
    const raw = await request.text();
    const ok = await verifyWebhook(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get('stripe-signature'));
    if (!ok) throw new HttpError(400, 'Bad signature');

    const event = JSON.parse(raw);
    if (event.type === 'checkout.session.completed') {
      const meta = event.data?.object?.metadata || {};
      const reference = meta.reference || event.data?.object?.client_reference_id;
      if (meta.kind === 'voucher') await settleVoucher(reference, 'paid');
      else await settleBooking(reference, 'paid');
    }
    return json({ received: true });
  }

  // ---- simulated payment, only while Stripe is not connected ----------------

  if (request.method === 'POST' && pathname === '/api/simulate-payment') {
    if (isLive(env)) throw new HttpError(404, 'Not found');
    const body = await request.json().catch(() => ({}));

    if (body.voucher_id) {
      const v = await settleVoucher(String(body.voucher_id), 'simulated');
      return json({ ok: Boolean(v), code: v?.code || null });
    }
    const row = await db.prepare('SELECT id FROM bookings WHERE manage_token = ?1')
      .bind(String(body.manage_token || '')).first();
    if (!row) throw new HttpError(404, 'Booking not found');
    const b = await settleBooking(row.id, 'simulated');
    return json({ ok: true, status: b?.requires_review ? 'awaiting_review' : 'confirmed' });
  }

  const manage = /^\/api\/manage\/([a-f0-9]{32})$/.exec(pathname);
  if (manage) {
    const row = await db.prepare(
      `SELECT b.id, b.ref, b.start_utc, b.end_utc, b.name, b.status, b.payment_status,
              b.amount_pence, b.stripe_session_id, s.name AS service_name, s.duration_min,
              s.requires_review
         FROM bookings b JOIN services s ON s.id = b.service_id
        WHERE b.manage_token = ?1`).bind(manage[1]).first();
    if (!row) throw new HttpError(404, 'Booking not found');

    if (request.method === 'GET') {
      const { id, stripe_session_id, ...safe } = row;   // never hand ids to the client
      return json({ booking: safe });
    }

    if (request.method === 'POST') {
      if (row.status === 'cancelled') return json({ ok: true, already: true });

      // Refund before releasing the slot, so a refund failure cannot leave money
      // taken for an hour that has already been given away.
      let refunded = false;
      if (row.payment_status === 'paid') {
        try { await refund(env, row.stripe_session_id); refunded = true; }
        catch (err) {
          console.error('refund failed', err);
          throw new HttpError(502, 'Your booking is still held — the refund could not be processed just now. Please email hello@gliskmassage.co.uk and I will sort it by hand.');
        }
      } else if (row.payment_status === 'simulated') {
        refunded = true;
      }

      await db.batch([
        db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_utc = ?2,
                      payment_status = CASE WHEN payment_status IN ('paid','simulated') THEN 'refunded' ELSE payment_status END
                    WHERE manage_token = ?1`).bind(manage[1], Date.now()),
        db.prepare('DELETE FROM occupancy WHERE booking_id = ?1').bind(row.id),
      ]);
      if (env.OWNER_EMAIL) {
        await sendMail(env, {
          to: env.OWNER_EMAIL,
          subject: `Cancelled — ${formatLocal(row.start_utc)} — ${row.name}`,
          text: `${row.name} cancelled ${row.service_name} on ${formatLocal(row.start_utc)}.\nRef ${row.ref}\nThe slot is free again.\n`,
        });
      }
      return json({ ok: true, refunded });
    }
  }

  if (pathname.startsWith('/api/admin/')) {
    requireAdmin(request, env);

    if (request.method === 'GET' && pathname === '/api/admin/bookings') {
      const from = Number(url.searchParams.get('from')) || Date.now() - 7 * 86400000;
      const { results } = await db.prepare(
        `SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id
          WHERE b.start_utc >= ?1 AND b.status != 'expired'
          ORDER BY b.start_utc LIMIT 500`).bind(from).all();
      return json({ bookings: results ?? [] });
    }

    const approve = /^\/api\/admin\/bookings\/([0-9a-f-]{36})\/approve$/.exec(pathname);
    if (request.method === 'POST' && approve) {
      const b = await db.prepare('SELECT * FROM bookings WHERE id = ?1').bind(approve[1]).first();
      if (!b) throw new HttpError(404, 'Booking not found');
      await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?1").bind(b.id).run();
      await sendMail(env, {
        to: b.email,
        subject: `Your home visit is confirmed — ${formatLocal(b.start_utc)}`,
        text: `Hello ${b.name},\n\nThat's confirmed — I'll see you on ${formatLocal(b.start_utc)} at ${b.address}.\n\n`
            + `Allow fifteen minutes either side for setting up and packing down, and a warm room if you can.\n\n`
            + `Reference ${b.ref}\n\nFleur\nGlisk — Massage & Yoga\n`,
      });
      return json({ ok: true });
    }

    const decline = /^\/api\/admin\/bookings\/([0-9a-f-]{36})\/refund$/.exec(pathname);
    if (request.method === 'POST' && decline) {
      const b = await db.prepare('SELECT * FROM bookings WHERE id = ?1').bind(decline[1]).first();
      if (!b) throw new HttpError(404, 'Booking not found');
      const reason = clean((await request.json().catch(() => ({}))).reason, 300);

      if (b.payment_status === 'paid') {
        try { await refund(env, b.stripe_session_id); }
        catch (err) { console.error('refund failed', err); throw new HttpError(502, 'Stripe would not process that refund. Try again, or refund it in the Stripe dashboard.'); }
      }
      await db.batch([
        db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_utc = ?2, payment_status = 'refunded' WHERE id = ?1")
          .bind(b.id, Date.now()),
        db.prepare('DELETE FROM occupancy WHERE booking_id = ?1').bind(b.id),
      ]);
      await sendMail(env, {
        to: b.email,
        subject: `About your booking on ${formatLocal(b.start_utc)}`,
        text: `Hello ${b.name},\n\nI'm sorry — I'm not able to take this one, and I've refunded you in full. `
            + `It can take a few days to land back on your card.\n\n`
            + (reason ? `${reason}\n\n` : '')
            + `Reference ${b.ref}\n\nFleur\nGlisk — Massage & Yoga\n`,
      });
      return json({ ok: true });
    }

    if (request.method === 'GET' && pathname === '/api/admin/vouchers') {
      const { results } = await db.prepare('SELECT * FROM vouchers ORDER BY created_utc DESC LIMIT 200').all();
      return json({ vouchers: results ?? [] });
    }

    if (request.method === 'GET' && pathname === '/api/admin/availability') {
      const { results } = await db.prepare('SELECT * FROM availability ORDER BY weekday, start_min').all();
      return json({ availability: results ?? [] });
    }

    if (request.method === 'PUT' && pathname === '/api/admin/availability') {
      const body = await request.json().catch(() => ({}));
      const rows = Array.isArray(body.availability) ? body.availability : null;
      if (!rows) throw new HttpError(400, 'Expected an availability array');

      const parsed = rows.map(r => {
        const weekday = Number(r.weekday), start_min = Number(r.start_min), end_min = Number(r.end_min);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Bad weekday');
        if (!Number.isInteger(start_min) || !Number.isInteger(end_min)
            || start_min < 0 || end_min > 1440 || end_min <= start_min) {
          throw new HttpError(400, 'Bad hours');
        }
        return { weekday, start_min, end_min };
      });

      // The admin screen always submits the whole week, so replacing wholesale
      // keeps the stored week identical to what Fleur sees on screen.
      await db.batch([
        db.prepare('DELETE FROM availability'),
        ...parsed.map(r => db.prepare(
          'INSERT INTO availability (weekday, start_min, end_min, active) VALUES (?1, ?2, ?3, 1)')
          .bind(r.weekday, r.start_min, r.end_min)),
      ]);
      return json({ ok: true, count: parsed.length });
    }

    if (request.method === 'GET' && pathname === '/api/admin/blackouts') {
      const { results } = await db.prepare('SELECT * FROM blackouts ORDER BY start_utc').all();
      return json({ blackouts: results ?? [] });
    }

    const delBlackout = /^\/api\/admin\/blackouts\/(\d+)$/.exec(pathname);
    if (request.method === 'DELETE' && delBlackout) {
      await db.prepare('DELETE FROM blackouts WHERE id = ?1').bind(Number(delBlackout[1])).run();
      return json({ ok: true });
    }

    if (request.method === 'POST' && pathname === '/api/admin/blackouts') {
      const b = await request.json();
      const start = Number(b.start_utc), end = Number(b.end_utc);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new HttpError(400, 'Bad dates');
      await db.prepare('INSERT INTO blackouts (start_utc, end_utc, reason) VALUES (?1, ?2, ?3)')
        .bind(start, end, clean(b.reason, 120) || null).run();
      return json({ ok: true }, 201);
    }
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong at our end. Please try again.' }, 500);
    }
  },
};

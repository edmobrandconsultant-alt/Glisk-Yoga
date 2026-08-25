import { generateSlots, blocksFor, loadSettings, HttpError } from './booking.js';
import { localDateKey, formatLocal, parseDateKey } from './time.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const LIMITS = { name: 80, email: 160, phone: 40, notes: 800 };

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
      .prepare('SELECT id, name, duration_min, price_pence, blurb FROM services WHERE active = 1 ORDER BY sort_order, name')
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

  if (request.method === 'POST' && pathname === '/api/bookings') {
    const body = await request.json().catch(() => ({}));

    // Honeypot: a real person never fills a hidden field.
    if (clean(body.website, 100)) return json({ ok: true, ref: bookingRef() });

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email);
    const phone = clean(body.phone, LIMITS.phone);
    const notes = clean(body.notes, LIMITS.notes);
    const start = Number(body.start);

    if (name.length < 2) throw new HttpError(400, 'Please give your name');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right');
    if (!Number.isFinite(start)) throw new HttpError(400, 'Pick a time');

    const service = await db.prepare('SELECT * FROM services WHERE id = ?1 AND active = 1').bind(body.service).first();
    if (!service) throw new HttpError(404, 'No such treatment');

    // Re-derive the offered slots server-side. The client is not trusted to
    // have picked a time inside working hours, outside a blackout, or ahead of
    // the notice period — this is the check that actually enforces all three.
    const dayKey = localDateKey(start);
    const offered = await generateSlots(db, service, dayKey, 1, Date.now());
    const isOffered = offered.some(d => d.slots.includes(start));
    if (!isOffered) throw new HttpError(409, 'That time has just gone. Please pick another.');

    const settings = await loadSettings(db);
    const end = start + service.duration_min * 60000;
    const id = crypto.randomUUID();
    const manageToken = token(16);
    const ref = bookingRef();

    const statements = [
      db.prepare(`INSERT INTO bookings
            (id, ref, service_id, start_utc, end_utc, name, email, phone, notes, manage_token, created_utc)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(id, ref, service.id, start, end, name, email, phone || null, notes || null, manageToken, Date.now()),
      ...blocksFor(start, end, settings.buffer_min).map(block =>
        db.prepare('INSERT INTO occupancy (block_utc, booking_id) VALUES (?1, ?2)').bind(block, id)),
    ];

    try {
      // One batch, one transaction. If any block is already taken the whole
      // thing rolls back, so a lost race leaves nothing behind.
      await db.batch(statements);
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        throw new HttpError(409, 'Someone booked that slot a moment before you. Please pick another.');
      }
      throw err;
    }

    const when = formatLocal(start);
    const manageUrl = `${url.origin}/book.html?manage=${manageToken}`;

    await Promise.all([
      sendMail(env, {
        to: email,
        subject: `Your massage is booked — ${when}`,
        text: `Hello ${name},\n\nYou're booked in for ${service.name}, ${when}.\n\n`
            + `Where: St Anne's House, St Anne's Road, Brislington, Bristol BS4 4AB\n`
            + `How long: ${service.duration_min} minutes\n`
            + `To pay: £${(service.price_pence / 100).toFixed(0)} on the day\n`
            + `Your reference: ${ref}\n\n`
            + `Need to move or cancel it? ${manageUrl}\n`
            + `Please give 24 hours' notice if you can, so the slot can go to someone else.\n\n`
            + `See you then.\nFleur\nGlisk — Massage & Yoga\n`,
      }),
      env.OWNER_EMAIL ? sendMail(env, {
        to: env.OWNER_EMAIL,
        subject: `New booking — ${when} — ${name}`,
        text: `${service.name}\n${when}\n\n${name}\n${email}\n${phone || 'no phone given'}\n\n`
            + `Notes: ${notes || 'none'}\n\nRef ${ref}\n`,
      }) : Promise.resolve(),
    ]);

    return json({ ok: true, ref, manage_token: manageToken, start, service: service.name }, 201);
  }

  const manage = /^\/api\/manage\/([a-f0-9]{32})$/.exec(pathname);
  if (manage) {
    const row = await db.prepare(
      `SELECT b.ref, b.start_utc, b.end_utc, b.name, b.status, s.name AS service_name, s.duration_min
         FROM bookings b JOIN services s ON s.id = b.service_id
        WHERE b.manage_token = ?1`).bind(manage[1]).first();
    if (!row) throw new HttpError(404, 'Booking not found');

    if (request.method === 'GET') return json({ booking: row });

    if (request.method === 'POST') {
      if (row.status === 'cancelled') return json({ ok: true, already: true });
      const id = await db.prepare('SELECT id FROM bookings WHERE manage_token = ?1').bind(manage[1]).first();
      await db.batch([
        db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_utc = ?2 WHERE manage_token = ?1")
          .bind(manage[1], Date.now()),
        db.prepare('DELETE FROM occupancy WHERE booking_id = ?1').bind(id.id),
      ]);
      if (env.OWNER_EMAIL) {
        await sendMail(env, {
          to: env.OWNER_EMAIL,
          subject: `Cancelled — ${formatLocal(row.start_utc)} — ${row.name}`,
          text: `${row.name} cancelled ${row.service_name} on ${formatLocal(row.start_utc)}.\nRef ${row.ref}\nThe slot is free again.\n`,
        });
      }
      return json({ ok: true });
    }
  }

  if (pathname.startsWith('/api/admin/')) {
    requireAdmin(request, env);

    if (request.method === 'GET' && pathname === '/api/admin/bookings') {
      const from = Number(url.searchParams.get('from')) || Date.now() - 7 * 86400000;
      const { results } = await db.prepare(
        `SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id
          WHERE b.start_utc >= ?1 ORDER BY b.start_utc LIMIT 500`).bind(from).all();
      return json({ bookings: results ?? [] });
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

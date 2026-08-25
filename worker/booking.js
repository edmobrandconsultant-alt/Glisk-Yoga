import { localParts, utcFromLocal, parseDateKey, localDateKey } from './time.js';

export const BLOCK_MS = 15 * 60 * 1000; // occupancy granularity

export const DEFAULTS = {
  buffer_min: 15,        // turnaround between treatments
  min_notice_hours: 12,  // no same-evening surprises
  max_advance_days: 60,
  grid_min: 15,          // slots offered on the quarter hour
};

export async function loadSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULTS };
  for (const row of results ?? []) {
    const n = Number(row.value);
    s[row.key] = Number.isFinite(n) ? n : row.value;
  }
  return s;
}

/**
 * Every epoch-aligned 15-minute block a booking occupies, treatment plus
 * turnaround. Alignment is to the epoch rather than to the working day, so the
 * same instant always maps to the same block no matter which code path asks —
 * which is what makes the occupancy PRIMARY KEY a reliable overlap guard.
 */
export function blocksFor(startUtc, endUtc, bufferMin) {
  const until = endUtc + bufferMin * 60000;
  const first = Math.floor(startUtc / BLOCK_MS) * BLOCK_MS;
  const blocks = [];
  for (let t = first; t < until; t += BLOCK_MS) blocks.push(t);
  return blocks;
}

/**
 * Bookable starts for one service across a date range.
 *
 * A candidate survives if it fits inside a working window, clears the notice
 * period, misses every blackout, and collides with no occupied block.
 */
/**
 * Release slots held by checkouts nobody completed.
 *
 * A booking holds its slot from the moment the payment page opens, otherwise two
 * people could pay for the same hour. Abandoned checkouts would hold it forever,
 * so anything still 'pending' past its expiry is swept before availability is
 * calculated or a new booking is taken.
 */
export async function sweepExpired(db, nowMs) {
  const { results } = await db
    .prepare("SELECT id FROM bookings WHERE status = 'pending' AND expires_utc IS NOT NULL AND expires_utc < ?1")
    .bind(nowMs).all();
  if (!results?.length) return 0;

  await db.batch([
    ...results.map(r => db.prepare('DELETE FROM occupancy WHERE booking_id = ?1').bind(r.id)),
    ...results.map(r => db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?1").bind(r.id)),
  ]);
  return results.length;
}

export async function generateSlots(db, service, fromKey, days, nowMs) {
  await sweepExpired(db, nowMs);
  const s = await loadSettings(db);
  const from = parseDateKey(fromKey);
  if (!from) throw new HttpError(400, 'Bad date');

  const rangeStart = utcFromLocal(from.year, from.month, from.day, 0);
  const rangeEnd = rangeStart + days * 86400000 + 86400000;
  const horizon = nowMs + s.max_advance_days * 86400000;
  const earliest = nowMs + s.min_notice_hours * 3600000;

  const [rules, blackouts, occupied] = await Promise.all([
    db.prepare('SELECT weekday, start_min, end_min FROM availability WHERE active = 1').all(),
    db.prepare('SELECT start_utc, end_utc FROM blackouts WHERE end_utc > ?1 AND start_utc < ?2')
      .bind(rangeStart, rangeEnd).all(),
    db.prepare('SELECT block_utc FROM occupancy WHERE block_utc >= ?1 AND block_utc < ?2')
      .bind(rangeStart - 4 * 3600000, rangeEnd).all(),
  ]);

  const taken = new Set((occupied.results ?? []).map(r => r.block_utc));
  const closed = blackouts.results ?? [];
  const byWeekday = new Map();
  for (const r of rules.results ?? []) {
    if (!byWeekday.has(r.weekday)) byWeekday.set(r.weekday, []);
    byWeekday.get(r.weekday).push(r);
  }

  const out = [];
  for (let i = 0; i < days; i++) {
    const dayStart = utcFromLocal(from.year, from.month, from.day + i, 0);
    const weekday = localParts(dayStart).weekday;
    const windows = byWeekday.get(weekday) ?? [];
    if (!windows.length) continue;

    const dayKey = localDateKey(dayStart);
    const times = [];

    for (const w of windows) {
      for (let m = w.start_min; m + service.duration_min <= w.end_min; m += s.grid_min) {
        // Rebuild from local minutes each step so the hour lost or repeated at
        // a DST switch lands correctly rather than drifting the rest of the day.
        const start = utcFromLocal(from.year, from.month, from.day + i, m);
        const end = start + service.duration_min * 60000;

        if (start < earliest || start > horizon) continue;
        if (closed.some(b => start < b.end_utc && end > b.start_utc)) continue;
        if (blocksFor(start, end, s.buffer_min).some(b => taken.has(b))) continue;

        times.push(start);
      }
    }

    if (times.length) {
      times.sort((a, b) => a - b);
      out.push({ date: dayKey, slots: [...new Set(times)] });
    }
  }
  return out;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

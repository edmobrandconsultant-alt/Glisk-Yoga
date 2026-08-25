// Europe/London wall-clock helpers.
//
// Slots are described the way Fleur thinks about them — "Tuesdays, 10:00 to
// 17:00" — but stored and compared as UTC instants. Everything in between has
// to survive the BST/GMT switch, including the two awkward days a year where a
// local time is ambiguous (clocks back) or does not exist at all (clocks
// forward). We never store an offset; we ask the clock each time.

export const TZ = 'Europe/London';

const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local calendar/clock fields for a UTC instant. */
export function localParts(utcMs) {
  const p = {};
  for (const part of FMT.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    year: +p.year, month: +p.month, day: +p.day,
    // 24:00 is how some engines render midnight; normalise it to 0.
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WEEKDAY[p.weekday],
    minutes: (+p.hour % 24) * 60 + +p.minute,
  };
}

/** Offset (ms) that Europe/London is ahead of UTC at a given instant. */
function offsetAt(utcMs) {
  const t = localParts(utcMs);
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - utcMs;
}

/**
 * UTC instant for a local wall-clock time.
 *
 * Two passes: guess with the offset at the naive instant, then re-resolve with
 * the offset actually in force at that result. That settles ordinary days in
 * one step and DST-transition days in two.
 */
export function utcFromLocal(year, month, day, minutes) {
  const naive = Date.UTC(year, month - 1, day) + minutes * 60000;
  let utc = naive - offsetAt(naive);
  utc = naive - offsetAt(utc);
  return utc;
}

/** Local YYYY-MM-DD for a UTC instant. */
export function localDateKey(utcMs) {
  const t = localParts(utcMs);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/** Parse YYYY-MM-DD into its numeric parts. Returns null if malformed. */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { year: y, month: mo, day: d };
}

/** "Tuesday 3 September, 2:30pm" — for emails and confirmation screens. */
export function formatLocal(utcMs) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(utcMs)).replace(/ /g, ' ');
}

/** "2:30pm" alone. */
export function formatTime(utcMs) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(utcMs)).replace(/ /g, ' ');
}

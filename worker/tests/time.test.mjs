import { localParts, utcFromLocal, formatLocal } from '../time.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${got}\n        want ${want}`);
};

// Ordinary GMT and BST days
eq('2026-01-15 10:00 GMT -> UTC',
   new Date(utcFromLocal(2026, 1, 15, 600)).toISOString(), '2026-01-15T10:00:00.000Z');
eq('2026-06-15 10:00 BST -> UTC',
   new Date(utcFromLocal(2026, 6, 15, 600)).toISOString(), '2026-06-15T09:00:00.000Z');

// Clocks forward: 2026-03-29, 01:00 UTC. 01:30 local does not exist.
eq('2026-03-29 00:30 (pre-jump, GMT)',
   new Date(utcFromLocal(2026, 3, 29, 30)).toISOString(), '2026-03-29T00:30:00.000Z');
eq('2026-03-29 10:00 (post-jump, BST)',
   new Date(utcFromLocal(2026, 3, 29, 600)).toISOString(), '2026-03-29T09:00:00.000Z');

// Clocks back: 2026-10-25, 01:00 UTC. 01:30 local happens twice.
eq('2026-10-25 00:30 (still BST)',
   new Date(utcFromLocal(2026, 10, 25, 30)).toISOString(), '2026-10-24T23:30:00.000Z');
eq('2026-10-25 10:00 (now GMT)',
   new Date(utcFromLocal(2026, 10, 25, 600)).toISOString(), '2026-10-25T10:00:00.000Z');

// Round trip across a full year at 09:00 local — the offset must always come
// back as exactly 0 or 60 minutes, never something in between.
let bad = 0;
for (let d = 0; d < 365; d++) {
  const base = Date.UTC(2026, 0, 1) + d * 86400000;
  const p0 = localParts(base);
  const utc = utcFromLocal(p0.year, p0.month, p0.day, 540);
  const back = localParts(utc);
  if (back.minutes !== 540) { bad++; if (bad < 4) console.log('   drift on', p0.year, p0.month, p0.day, '->', back.minutes); }
}
eq('365 days round-trip at 09:00 local', bad, 0);

// A working day must stay 8 hours of wall time even across the switch.
for (const [y, m, dd, label] of [[2026,3,29,'spring forward'], [2026,10,25,'autumn back']]) {
  const a = utcFromLocal(y, m, dd, 9 * 60);
  const b = utcFromLocal(y, m, dd, 17 * 60);
  console.log(`      ${label}: 09:00->17:00 spans ${(b - a) / 3600000}h real time  (${formatLocal(a)} .. ${formatLocal(b)})`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall time tests pass');
process.exit(fail ? 1 : 0);

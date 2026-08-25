import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.mjs';
import { generateSlots, blocksFor } from '../booking.js';
import { utcFromLocal, formatTime, localDateKey } from '../time.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const db = makeDb(schema);
db._sq.exec(`
  INSERT INTO services (id,name,duration_min,price_pence,sort_order) VALUES
    ('dt60','Deep Tissue Massage',60,6000,1),
    ('dt90','Deep Tissue Massage',90,8500,2);
  -- Tuesday and Thursday, 10:00 to 17:00
  INSERT INTO availability (weekday,start_min,end_min) VALUES (2,600,1020),(4,600,1020);
`);

const svc60 = { id: 'dt60', duration_min: 60 };
const svc90 = { id: 'dt90', duration_min: 90 };

// Anchor "now" well before the window so notice rules never interfere.
const NOW = utcFromLocal(2026, 8, 25, 9 * 60);  // a week ahead of the window

let days = await generateSlots(db, svc60, '2026-09-01', 7, NOW);
check('only working weekdays appear', days.length === 2, days.map(d => d.date).join(', '));

const tue = days.find(d => d.date === '2026-09-01');
check('first slot is 10:00', formatTime(tue.slots[0]) === '10:00 am', formatTime(tue.slots[0]));
check('last 60-min slot is 16:00', formatTime(tue.slots.at(-1)) === '4:00 pm', formatTime(tue.slots.at(-1)));
check('slots on the quarter hour', tue.slots.every((t, i) => i === 0 || t - tue.slots[i-1] === 15*60000));

// A 90-minute treatment must stop earlier in the day than a 60-minute one.
const tue90 = (await generateSlots(db, svc90, '2026-09-01', 1, NOW))[0];
check('last 90-min slot is 15:30', formatTime(tue90.slots.at(-1)) === '3:30 pm', formatTime(tue90.slots.at(-1)));

// --- book 11:00 and confirm the hole it leaves ------------------------------
const start = utcFromLocal(2026, 9, 1, 11 * 60);
const end = start + 60 * 60000;
await db.batch([
  db.prepare(`INSERT INTO bookings (id,ref,service_id,start_utc,end_utc,name,email,manage_token,created_utc)
              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
    .bind('b1','GL-TEST','dt60',start,end,'Test','t@example.com','tok',NOW),
  ...blocksFor(start, end, 15).map(b =>
    db.prepare('INSERT INTO occupancy (block_utc,booking_id) VALUES (?1,?2)').bind(b,'b1')),
]);

const after = (await generateSlots(db, svc60, '2026-09-01', 1, NOW))[0];
const times = after.slots.map(formatTime);
check('the booked 11:00 is gone', !times.includes('11:00 am'));
check('10:15 blocked (would overrun into it)', !times.includes('10:15 am'));
check('10:00 blocked — its turnaround would run into the 11:00', !times.includes('10:00 am'));
check('09:45 would be the latest fit, but is outside working hours', !times.includes('9:45 am'));
check('12:15 bookable again (after 15-min turnaround)', times.includes('12:15 pm'), times.slice(0,6).join(' '));
check('no offered slot overlaps the booking',
      after.slots.every(s => s + 60*60000 <= start || s >= end + 15*60000));

// --- the double-booking guard ----------------------------------------------
let raced = null;
try {
  await db.batch([
    db.prepare(`INSERT INTO bookings (id,ref,service_id,start_utc,end_utc,name,email,manage_token,created_utc)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind('b2','GL-RACE','dt60',start,end,'Racer','r@example.com','tok2',NOW),
    ...blocksFor(start, end, 15).map(b =>
      db.prepare('INSERT INTO occupancy (block_utc,booking_id) VALUES (?1,?2)').bind(b,'b2')),
  ]);
} catch (err) { raced = err; }
check('a colliding booking is rejected', raced !== null && /UNIQUE/i.test(String(raced)));
const orphan = db._sq.prepare("SELECT COUNT(*) c FROM bookings WHERE id='b2'").get();
check('the losing booking rolled back whole', orphan.c === 0, `found ${orphan.c} orphan row(s)`);

// A partially-overlapping 90-minute booking must also be refused.
let partial = null;
const near = utcFromLocal(2026, 9, 1, 10 * 60 + 30);
try {
  await db.batch([
    db.prepare(`INSERT INTO bookings (id,ref,service_id,start_utc,end_utc,name,email,manage_token,created_utc)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind('b3','GL-PART','dt90',near,near+90*60000,'P','p@example.com','tok3',NOW),
    ...blocksFor(near, near+90*60000, 15).map(b =>
      db.prepare('INSERT INTO occupancy (block_utc,booking_id) VALUES (?1,?2)').bind(b,'b3')),
  ]);
} catch (err) { partial = err; }
check('a partial overlap is rejected too', partial !== null);

// --- blackout ---------------------------------------------------------------
db._sq.exec(`INSERT INTO blackouts (start_utc,end_utc,reason) VALUES (
  ${utcFromLocal(2026,9,3,0)}, ${utcFromLocal(2026,9,4,0)}, 'Lost Village')`);
const withBlackout = await generateSlots(db, svc60, '2026-09-01', 7, NOW);
check('blacked-out Thursday disappears', !withBlackout.some(d => d.date === '2026-09-03'),
      withBlackout.map(d => d.date).join(', '));

// --- notice period ----------------------------------------------------------
const late = utcFromLocal(2026, 9, 1, 9 * 60 + 30); // 30 min before opening
const lateDays = await generateSlots(db, svc60, '2026-09-01', 1, late);
check('12-hour notice hides same-morning slots', (lateDays[0]?.slots.length ?? 0) === 0,
      `${lateDays[0]?.slots.length ?? 0} slots offered`);

// --- DST day ----------------------------------------------------------------
db._sq.exec('INSERT INTO availability (weekday,start_min,end_min) VALUES (0,600,1020)'); // Sundays
const dst = await generateSlots(db, svc60, '2026-10-25', 1, utcFromLocal(2026,10,20,600));
check('clocks-back Sunday still opens at 10:00 local',
      formatTime(dst[0].slots[0]) === '10:00 am', formatTime(dst[0].slots[0]));
check('clocks-back Sunday has no duplicated times',
      new Set(dst[0].slots.map(formatTime)).size === dst[0].slots.length);

console.log(fail ? `\n${fail} FAILURES` : '\nall booking tests pass');
process.exit(fail ? 1 : 0);

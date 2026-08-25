import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.mjs';
import worker from '../index.js';

const R = new URL('../', import.meta.url).pathname;
const db = makeDb(readFileSync(R + 'schema.sql', 'utf8'));
db._sq.exec(readFileSync(R + 'seed.sql', 'utf8'));

const env = { DB: db, ADMIN_TOKEN: 'sekrit-admin-token', ASSETS: { fetch: () => new Response('asset') } };

let fail = 0;
const check = (label, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); };
const call = (path, init) => worker.fetch(new Request('https://gliskmassage.co.uk' + path, init), env, {});
const jsonOf = async res => [res.status, await res.json()];

// services
let [st, body] = await jsonOf(await call('/api/services'));
check('GET /api/services', st === 200 && body.services.length === 4, `${st}, ${body.services?.length} services`);
const service = body.services[0];

// slots
[st, body] = await jsonOf(await call(`/api/slots?service=${service.id}&days=21`));
check('GET /api/slots returns days', st === 200 && body.days.length > 0, `${body.days?.length} day(s)`);
const slot = body.days[0].slots[0];

// bad input
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot, name: 'A', email: 'nope' }) }));
check('rejects a one-letter name', st === 400, `${st} ${body.error}`);
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot, name: 'Ada Lovelace', email: 'not-an-email' }) }));
check('rejects a bad email', st === 400, `${st} ${body.error}`);

// a time outside working hours must be refused even though the client asked nicely
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot + 90000, name: 'Ada Lovelace', email: 'ada@example.com' }) }));
check('refuses an off-grid time the server never offered', st === 409, `${st} ${body.error}`);

// honeypot
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot, name: 'Bot', email: 'bot@example.com', website: 'http://spam' }) }));
const botRows = db._sq.prepare("SELECT COUNT(*) c FROM bookings WHERE email='bot@example.com'").get().c;
check('honeypot silently drops the bot', st === 200 && botRows === 0, `${botRows} row(s) written`);

// the real booking
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot, name: 'Ada Lovelace', email: 'ada@example.com', phone: '07700 900000', notes: 'Sore left shoulder' }) }));
check('creates the booking', st === 201 && /^GL-/.test(body.ref || ''), `${st} ${body.ref}`);
const manageToken = body.manage_token;

// double-book
[st, body] = await jsonOf(await call('/api/bookings', { method: 'POST', body: JSON.stringify({ service: service.id, start: slot, name: 'Grace Hopper', email: 'grace@example.com' }) }));
check('second person cannot take the same slot', st === 409, `${st} ${body.error}`);

// the slot is gone from the calendar
[st, body] = await jsonOf(await call(`/api/slots?service=${service.id}&days=21`));
check('slot disappears from availability', !body.days[0].slots.includes(slot));

// manage + cancel
[st, body] = await jsonOf(await call('/api/manage/' + manageToken));
check('manage link shows the booking', st === 200 && body.booking.name === 'Ada Lovelace', `${st}`);
[st, body] = await jsonOf(await call('/api/manage/' + manageToken, { method: 'POST' }));
check('cancel succeeds', st === 200 && body.ok);
[st, body] = await jsonOf(await call(`/api/slots?service=${service.id}&days=21`));
check('cancelling frees the slot again', body.days[0].slots.includes(slot));
check('occupancy cleared on cancel', db._sq.prepare('SELECT COUNT(*) c FROM occupancy').get().c === 0);

// bad manage token
check('unknown manage token 404s', (await call('/api/manage/' + 'f'.repeat(32))).status === 404);

// admin auth
check('admin refuses no token', (await call('/api/admin/bookings')).status === 401);
check('admin refuses a wrong token', (await call('/api/admin/bookings', { headers: { authorization: 'Bearer nope' } })).status === 401);
const auth = { authorization: 'Bearer sekrit-admin-token' };
[st, body] = await jsonOf(await call('/api/admin/bookings', { headers: auth }));
check('admin lists bookings', st === 200 && body.bookings.length === 1, `${body.bookings?.length}`);

// admin sets hours
[st, body] = await jsonOf(await call('/api/admin/availability', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ availability: [{ weekday: 1, start_min: 540, end_min: 1080 }] }) }));
check('admin replaces the week', st === 200 && body.count === 1, `${st}`);
[st, body] = await jsonOf(await call('/api/admin/availability', { headers: auth }));
check('new hours stored', body.availability.length === 1 && body.availability[0].weekday === 1);
[st, body] = await jsonOf(await call('/api/admin/availability', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ availability: [{ weekday: 9, start_min: 540, end_min: 1080 }] }) }));
check('admin rejects a bad weekday', st === 400, `${st}`);

check('unknown api path 404s', (await call('/api/nothing')).status === 404);

console.log(fail ? `\n${fail} FAILURES` : '\nall API tests pass');
process.exit(fail ? 1 : 0);

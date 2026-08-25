import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.mjs';
import worker from '../index.js';
import { verifyWebhook } from '../payments.js';

const R = new URL('../', import.meta.url).pathname;
const db = makeDb(readFileSync(R + 'schema.sql', 'utf8'));
db._sq.exec(readFileSync(R + 'seed.sql', 'utf8'));

// No STRIPE_SECRET_KEY: the simulated path, which is how it runs until Stripe is connected.
const env = { DB: db, ADMIN_TOKEN: 'admin-tok', ASSETS: { fetch: () => new Response('', { status: 404 }) } };

// Keep the suite offline: stand in for postcodes.io. Nothing else reaches out —
// Stripe is unconfigured and mail is skipped without a provider.
const PLACES = { 'BS4 4AB': { latitude: 51.4406, longitude: -2.4939 } };
globalThis.fetch = async (url) => {
  const pc = decodeURIComponent(String(url).split('/').pop());
  if (PLACES[pc]) return new Response(JSON.stringify({ result: PLACES[pc] }), { status: 200 });
  return new Response('{}', { status: 404 });
};
const auth = { authorization: 'Bearer admin-tok' };

let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };
const call = (p, i) => worker.fetch(new Request('https://gliskmassage.co.uk' + p, i), env, {});
const j = async r => [r.status, await r.json()];

const services = (await (await call('/api/services')).json()).services;
const clinic = services.find(s => s.id === 'deep-60');
const home = services.find(s => s.id === 'home-60');
check('home visits are now bookable', Boolean(home), home ? `${home.name} £${home.price_pence/100}` : 'missing');
check('home visits are flagged for review', home.requires_review === 1 && home.needs_address === 1);
check('clinic treatments are not', clinic.requires_review === 0);

const slotsFor = async id => (await (await call(`/api/slots?service=${id}&days=21`)).json()).days[0].slots;

// ---- clinic: pay, confirm ---------------------------------------------------
let [st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: clinic.id, start: (await slotsFor(clinic.id))[0], name: 'Ada Lovelace', email: 'ada@example.com' }) }));
check('booking returns a checkout url', st === 201 && /simulated=1/.test(body.checkout_url), `${st}`);
check('flagged as simulated, not real money', body.simulated === true);
check('charged the listed price', body.amount_pence === 6000, `${body.amount_pence}`);
const clinicToken = body.manage_token;

let row = db._sq.prepare("SELECT status,payment_status FROM bookings WHERE manage_token=?").get(clinicToken);
check('starts as an unpaid hold', row.status === 'pending' && row.payment_status === 'unpaid', `${row.status}/${row.payment_status}`);
check('the hold already blocks the slot', db._sq.prepare('SELECT COUNT(*) c FROM occupancy').get().c > 0);

[st, body] = await j(await call('/api/simulate-payment', { method: 'POST', body: JSON.stringify({ manage_token: clinicToken }) }));
check('paying confirms a clinic booking', st === 200 && body.status === 'confirmed', `${body.status}`);
row = db._sq.prepare("SELECT status,payment_status FROM bookings WHERE manage_token=?").get(clinicToken);
check('recorded as simulated, never as paid', row.payment_status === 'simulated', row.payment_status);

// paying twice must not double-count
await call('/api/simulate-payment', { method: 'POST', body: JSON.stringify({ manage_token: clinicToken }) });
check('a repeated confirmation is ignored',
  db._sq.prepare("SELECT COUNT(*) c FROM bookings WHERE manage_token=?").get(clinicToken).c === 1);

// ---- home visit: pay, then await Fleur --------------------------------------
const homeSlots = await slotsFor(home.id);
[st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: home.id, start: homeSlots[0], name: 'Grace Hopper', email: 'grace@example.com' }) }));
check('home visit without an address is refused', st === 400, `${st} ${body.error}`);

[st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: home.id, start: homeSlots[0], name: 'Grace Hopper', email: 'grace@example.com',
  address: '12 Example Road, Bristol' }) }));
check('home visit without a postcode is refused', st === 400, `${st} ${body.error}`);

[st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: home.id, start: homeSlots[0], name: 'Grace Hopper', email: 'grace@example.com',
  address: '12 Example Road, Bristol', postcode: 'BS4 4AB' }) }));
check('home visit with an address and postcode is taken', st === 201, `${st} ${body.error || ''}`);
check('travel priced server-side into the charge',
  body.amount_pence === home.price_pence + body.travel_pence,
  `£${(body.amount_pence/100).toFixed(2)} total, £${(body.travel_pence/100).toFixed(2)} travel`);
const homeToken = body.manage_token;

[st, body] = await j(await call('/api/simulate-payment', { method: 'POST', body: JSON.stringify({ manage_token: homeToken }) }));
check('paid home visit awaits review, not confirmed', body.status === 'awaiting_review', body.status);

const homeId = db._sq.prepare('SELECT id FROM bookings WHERE manage_token=?').get(homeToken).id;
[st, body] = await j(await call(`/api/admin/bookings/${homeId}/approve`, { method: 'POST', headers: auth }));
check('Fleur can approve it', st === 200 && db._sq.prepare('SELECT status FROM bookings WHERE id=?').get(homeId).status === 'confirmed');

// ---- declining refunds and frees the slot -----------------------------------
const later = homeSlots[8];
[st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: home.id, start: later, name: 'Refund Me', email: 'r@example.com', address: '1 Somewhere', postcode: 'BS4 4AB' }) }));
const declineToken = body.manage_token;
await call('/api/simulate-payment', { method: 'POST', body: JSON.stringify({ manage_token: declineToken }) });
const declineId = db._sq.prepare('SELECT id FROM bookings WHERE manage_token=?').get(declineToken).id;
[st] = await j(await call(`/api/admin/bookings/${declineId}/refund`, { method: 'POST', headers: auth, body: JSON.stringify({ reason: 'Too far out of area.' }) }));
row = db._sq.prepare('SELECT status,payment_status FROM bookings WHERE id=?').get(declineId);
check('declining refunds and cancels', st === 200 && row.status === 'cancelled' && row.payment_status === 'refunded', `${row.status}/${row.payment_status}`);
check('the declined slot is bookable again', (await slotsFor(home.id)).includes(later));

// ---- client cancelling refunds too -----------------------------------------
[st, body] = await j(await call('/api/manage/' + clinicToken, { method: 'POST' }));
check('client cancel reports a refund', st === 200 && body.refunded === true);
check('marked refunded', db._sq.prepare('SELECT payment_status FROM bookings WHERE manage_token=?').get(clinicToken).payment_status === 'refunded');

// ---- abandoned checkouts release the slot ----------------------------------
const freeSlot = (await slotsFor(clinic.id))[3];
[st, body] = await j(await call('/api/bookings', { method: 'POST', body: JSON.stringify({
  service: clinic.id, start: freeSlot, name: 'Walks Away', email: 'w@example.com' }) }));
check('abandoned hold blocks the slot at first', !(await slotsFor(clinic.id)).includes(freeSlot));
db._sq.prepare("UPDATE bookings SET expires_utc = 1 WHERE manage_token = ?").run(body.manage_token);
check('and is released once it expires', (await slotsFor(clinic.id)).includes(freeSlot));
check('the abandoned booking is marked expired',
  db._sq.prepare('SELECT status FROM bookings WHERE manage_token=?').get(body.manage_token).status === 'expired');

// ---- vouchers ---------------------------------------------------------------
[st, body] = await j(await call('/api/vouchers', { method: 'POST', body: JSON.stringify({
  amount_pence: 8500, buyer_name: 'Ada Lovelace', buyer_email: 'ada@example.com', recipient_name: 'Mum' }) }));
check('voucher returns a checkout url', st === 201 && /bought=/.test(body.checkout_url), `${st}`);
const voucherId = new URL(body.checkout_url).searchParams.get('bought');
check('voucher starts unpaid', db._sq.prepare('SELECT status FROM vouchers WHERE id=?').get(voucherId).status === 'pending');
[st, body] = await j(await call('/api/simulate-payment', { method: 'POST', body: JSON.stringify({ voucher_id: voucherId }) }));
check('paying issues a voucher code', st === 200 && /^GLISK-/.test(body.code || ''), body.code);
[st, body] = await j(await call('/api/vouchers', { method: 'POST', body: JSON.stringify({
  amount_pence: 500, buyer_name: 'Ada', buyer_email: 'ada@example.com' }) }));
check('a silly voucher amount is refused', st === 400, `${st}`);

// ---- webhook ---------------------------------------------------------------
check('webhook rejects an unsigned request', (await call('/api/stripe/webhook', { method: 'POST', body: '{}' })).status === 400);
const secret = 'whsec_x', payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { reference: 'x', kind: 'booking' } } } });
const t = Math.floor(Date.now() / 1000);
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
check('webhook accepts a correctly signed request',
  (await worker.fetch(new Request('https://x/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }), { ...env, STRIPE_WEBHOOK_SECRET: secret }, {})).status === 200);
check('webhook signature helper rejects a forgery', (await verifyWebhook(secret, payload, `t=${t},v1=${'0'.repeat(64)}`)) === false);

// ---- the simulation door must close once Stripe is live ---------------------
const liveEnv = { ...env, STRIPE_SECRET_KEY: 'sk_test_x' };
const liveRes = await worker.fetch(new Request('https://x/api/simulate-payment', { method: 'POST', body: '{}' }), liveEnv, {});
check('simulate-payment disappears when Stripe is connected', liveRes.status === 404, `${liveRes.status}`);

console.log(fail ? `\n${fail} FAILURES` : '\nall payment tests pass');
process.exit(fail ? 1 : 0);

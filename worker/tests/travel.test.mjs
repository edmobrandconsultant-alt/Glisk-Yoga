import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.mjs';
import { milesBetween, normalisePostcode, travelCost, quote, geocode } from '../travel.js';

const R = new URL('../', import.meta.url).pathname;
const db = makeDb(readFileSync(R + 'schema.sql', 'utf8'));
db._sq.exec(readFileSync(R + 'seed.sql', 'utf8'));

let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`); };

const settings = { travel_free_miles: 5, travel_rate_pence: 45, travel_max_miles: 25,
                   travel_origin_lat: 51.4406, travel_origin_lon: -2.4939 };

// A stub instead of the real postcodes.io, so the tests never need a network.
const PLACES = {
  'BS15 3AB': { latitude: 51.4406, longitude: -2.4939 },  // Hanham itself
  'BS1 5TR':  { latitude: 51.4545, longitude: -2.5879 },  // Bristol centre
  'BA1 1LZ':  { latitude: 51.3811, longitude: -2.3590 },  // Bath
  'BS35 2AA': { latitude: 51.6100, longitude: -2.5250 },  // Thornbury
  'EH1 1YZ':  { latitude: 55.9533, longitude: -3.1883 },  // Edinburgh, far too far
};
let calls = 0;
const stubFetch = async url => {
  calls++;
  const pc = decodeURIComponent(String(url).split('/').pop());
  return PLACES[pc]
    ? { ok: true, json: async () => ({ result: PLACES[pc] }) }
    : { ok: false, json: async () => ({}) };
};

check('postcode tidying', normalisePostcode('bs153ab') === 'BS15 3AB' && normalisePostcode('  BA1  1LZ ') === 'BA1 1LZ');
check('nonsense postcode refused', normalisePostcode('xx') === null && normalisePostcode('') === null);

check('nothing charged inside the free radius', travelCost(4.9, settings).pence === 0, `${travelCost(4.9, settings).pence}p`);
check('exactly at the radius is still free', travelCost(5, settings).pence === 0);
check('only the miles beyond the radius are charged',
  travelCost(9, settings).chargeable_miles === 4 && travelCost(9, settings).pence === 180,
  `${travelCost(9, settings).chargeable_miles} mi, ${travelCost(9, settings).pence}p`);

// one-way only: 10 miles away is charged for 5, not 10
check('charged one way, not there and back', travelCost(10, settings).pence === 225, `${travelCost(10, settings).pence}p`);

let q = await quote(db, settings, 'BS15 3AB', stubFetch);
check('Fleur’s own postcode is free', q.ok && q.miles === 0 && q.pence === 0, `${q.miles} mi`);

q = await quote(db, settings, 'bs1 5tr', stubFetch);
check('Bristol centre is inside the free radius', q.ok && q.pence === 0, `${q.miles} mi, ${q.pence}p`);

q = await quote(db, settings, 'BA1 1LZ', stubFetch);
check('Bath carries a small charge', q.ok && q.pence > 0 && q.pence < 200, `${q.miles} mi, £${(q.pence/100).toFixed(2)}`);

q = await quote(db, settings, 'BS35 2AA', stubFetch);
check('Thornbury costs more than Bath', q.ok && q.pence > 250, `${q.miles} mi, £${(q.pence/100).toFixed(2)}`);

q = await quote(db, settings, 'EH1 1YZ', stubFetch);
check('Edinburgh is refused as too far', !q.ok && q.reason === 'too_far', `${q.miles} mi`);

q = await quote(db, settings, 'ZZ99 9ZZ', stubFetch);
check('an unknown postcode is refused', !q.ok && q.reason === 'unknown_postcode');

// caching
const before = calls;
await quote(db, settings, 'BA1 1LZ', stubFetch);
check('a repeated postcode is not fetched twice', calls === before, `${calls - before} extra call(s)`);
check('the lookup was cached in the database',
  db._sq.prepare("SELECT COUNT(*) c FROM postcodes WHERE postcode='BA1 1LZ'").get().c === 1);

// the settings really are the knobs
const generous = { ...settings, travel_free_miles: 10 };
check('widening the free radius removes the charge',
  travelCost(9, generous).pence === 0, `${travelCost(9, generous).pence}p`);
const dearer = { ...settings, travel_rate_pence: 60 };
check('changing the rate changes the charge',
  travelCost(9, dearer).pence === 240, `${travelCost(9, dearer).pence}p`);

check('distance is symmetric',
  Math.abs(milesBetween({lat:51.44,lon:-2.49},{lat:51.38,lon:-2.36}) - milesBetween({lat:51.38,lon:-2.36},{lat:51.44,lon:-2.49})) < 1e-9);

console.log(fail ? `\n${fail} FAILURES` : '\nall travel tests pass');
process.exit(fail ? 1 : 0);

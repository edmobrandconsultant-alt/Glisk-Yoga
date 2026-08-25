/* Travel cost for home visits.
 *
 * Fleur is in Hanham. Visits within the free radius cost nothing extra; beyond
 * it, the miles *past* that radius are charged at a flat rate, one way only.
 * Every number here is a row in `settings`, so the rule can be changed without
 * touching code:
 *
 *   travel_free_miles   miles included before anything is charged   (5)
 *   travel_rate_pence   pence per chargeable mile, one way          (45)
 *   travel_origin_lat / travel_origin_lon    where Fleur sets off
 *   travel_max_miles    beyond this she does not travel at all      (25)
 *
 * Distance is straight-line. Road miles run longer, so this errs in the
 * client's favour rather than overcharging on a number nobody can check.
 */

const R_MILES = 3958.8;

export function milesBetween(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normalisePostcode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 5 || s.length > 7) return null;
  return s.slice(0, -3) + ' ' + s.slice(-3);
}

/** Look up a postcode, caching the result so the same address is fetched once. */
export async function geocode(db, postcode, fetchImpl = fetch) {
  const pc = normalisePostcode(postcode);
  if (!pc) return null;

  const cached = await db.prepare('SELECT lat, lon FROM postcodes WHERE postcode = ?1').bind(pc).first();
  if (cached) return { lat: cached.lat, lon: cached.lon, postcode: pc, cached: true };

  // postcodes.io is free, needs no key, and is the Ordnance Survey data.
  const res = await fetchImpl('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc));
  if (!res.ok) return null;
  const body = await res.json();
  const lat = body?.result?.latitude, lon = body?.result?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  await db.prepare('INSERT OR REPLACE INTO postcodes (postcode, lat, lon, cached_utc) VALUES (?1,?2,?3,?4)')
    .bind(pc, lat, lon, Date.now()).run();
  return { lat, lon, postcode: pc, cached: false };
}

/**
 * What the travel adds, in pence. Chargeable miles are those beyond the free
 * radius, rounded to one decimal so the arithmetic is checkable by hand.
 */
export function travelCost(miles, settings) {
  const free = Number(settings.travel_free_miles ?? 5);
  const rate = Number(settings.travel_rate_pence ?? 45);
  const chargeable = Math.max(0, Math.round((miles - free) * 10) / 10);
  return { chargeable_miles: chargeable, pence: Math.round(chargeable * rate) };
}

export async function quote(db, settings, postcode, fetchImpl = fetch) {
  const place = await geocode(db, postcode, fetchImpl);
  if (!place) return { ok: false, reason: 'unknown_postcode' };

  const origin = {
    lat: Number(settings.travel_origin_lat ?? 51.4406),
    lon: Number(settings.travel_origin_lon ?? -2.4939),
  };
  const miles = Math.round(milesBetween(origin, place) * 10) / 10;
  const max = Number(settings.travel_max_miles ?? 25);
  if (miles > max) return { ok: false, reason: 'too_far', miles, max };

  const cost = travelCost(miles, settings);
  return { ok: true, postcode: place.postcode, miles, ...cost };
}

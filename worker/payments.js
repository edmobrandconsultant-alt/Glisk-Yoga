/* Stripe Checkout.
 *
 * The real calls are here and are what run as soon as STRIPE_SECRET_KEY is set.
 * Until then the same code path returns a simulated checkout so the whole flow —
 * hold the slot, take payment, confirm, email — can be walked end to end without
 * a Stripe account. Simulated payments are recorded as payment_status
 * 'simulated', never 'paid', so test bookings can never be mistaken for money.
 */

export const isLive = env => Boolean(env.STRIPE_SECRET_KEY);

/** Stripe's API is form-encoded, including nested keys like line_items[0][price_data][currency]. */
function form(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripe(env, path, params) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('stripe error', res.status, body?.error?.message);
    throw new Error(body?.error?.message || 'Payment could not be set up');
  }
  return body;
}

/**
 * A Checkout Session for one line item.
 * `reference` is our own id, echoed back on the webhook so we know what was paid.
 */
export async function createCheckout(env, { reference, kind, description, amountPence, email, origin, successPath, cancelPath }) {
  if (!isLive(env)) {
    return {
      simulated: true,
      sessionId: 'sim_' + reference,
      url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}simulated=1`,
    };
  }

  const session = await stripe(env, 'checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    client_reference_id: reference,
    metadata: { reference, kind },
    payment_intent_data: { metadata: { reference, kind } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: amountPence,
        product_data: { name: description },
      },
    }],
    success_url: `${origin}${successPath}`,
    cancel_url: `${origin}${cancelPath}`,
  });

  return { simulated: false, sessionId: session.id, url: session.url };
}

export async function refund(env, paymentIntentOrSession) {
  if (!isLive(env)) return { simulated: true };
  // Sessions carry the payment intent; refunds are issued against the intent.
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${paymentIntentOrSession}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  }).then(r => r.json());
  if (!session?.payment_intent) throw new Error('No payment to refund');
  return stripe(env, 'refunds', { payment_intent: session.payment_intent });
}

/**
 * Verify a Stripe webhook signature.
 *
 * Header looks like `t=1699,v1=abc...`. The signed payload is `${t}.${rawBody}`,
 * HMAC-SHA256 with the endpoint secret. The timestamp check stops a captured
 * request being replayed later, and the comparison is constant time.
 */
export async function verifyWebhook(secret, rawBody, signatureHeader, nowMs = Date.now(), toleranceSec = 300) {
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => p.split('=', 2)).filter(p => p.length === 2)
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  const supplied = parts.v1 || '';
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

/** Human-readable voucher code, e.g. GLISK-7K4M-2QXA. */
export function voucherCode() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY349';
  const pick = n => [...crypto.getRandomValues(new Uint8Array(n))]
    .map(b => alphabet[b % alphabet.length]).join('');
  return `GLISK-${pick(4)}-${pick(4)}`;
}

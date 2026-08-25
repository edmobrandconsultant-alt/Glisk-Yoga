# The booking system

Bookings for treatments at St Anne's House. Runs as a Cloudflare Worker in front
of the static site, with the diary in D1 (Cloudflare's SQLite).

Everything that can be paid for is paid for up front: clinic treatments, home
visits, and gift vouchers.

Home visits are bookable and charged like anything else, but they are flagged
`requires_review`, so a paid home visit lands as **awaiting_review** rather than
confirmed. Fleur reads the details in her diary and either confirms it or
refunds it in full with one button. That keeps payment frictionless without
pretending the women-only policy on `home-visits.html` has stopped applying —
and the booking page says all of this before anyone pays.

Yoga and Bath treatments stay enquiry-only: the availability isn't fixed enough
to publish.

## How it fits together

```
gliskmassage.co.uk/           static HTML, served straight from the asset store
gliskmassage.co.uk/book.html  the booking page  (assets/js/book.js)
gliskmassage.co.uk/admin.html Fleur's diary     (assets/js/admin.js)
gliskmassage.co.uk/api/*      the Worker        (worker/index.js)
```

Only `/api/*` reaches the Worker. Everything else is a plain file, exactly as
before — the site keeps its no-build-step, no-framework character, and the two
JavaScript files are vanilla and dependency-free.

## Why bookings can't collide

SQLite has no exclusion constraint, so the diary is kept honest with an
`occupancy` table: one row per fifteen-minute block that a booking covers,
treatment plus turnaround, with `block_utc` as the PRIMARY KEY. A booking and
all of its blocks are written in a single D1 batch, which runs as one
transaction. Two people confirming the same slot at the same moment collide on
that key, and the loser's whole transaction rolls back — so there is never a
booking row with partial occupancy, and never two people in the same hour.

Blocks are aligned to the epoch rather than to the working day, so the same
instant always maps to the same block no matter which code path computes it.

## Money

Payment is Stripe Checkout, so no card details ever touch this code or this
domain. The flow is:

1. The slot is held the moment someone reaches the payment page, so two people
   cannot pay for the same hour.
2. If they never pay, the hold expires after twenty minutes and `sweepExpired`
   hands the time back. Abandoned checkouts cannot silently block the diary.
3. The Stripe webhook — not the browser redirect — is what confirms a booking.
   A redirect only means the customer came back; the webhook means the money
   arrived.
4. Cancelling refunds in full, and only then releases the slot. If the refund
   fails the booking stays put, so the money and the hour never get out of step.

**Until `STRIPE_SECRET_KEY` is set**, exactly the same flow runs against a
simulated checkout, so all of it can be walked end to end without a Stripe
account. Simulated payments are recorded as `payment_status = 'simulated'`,
never `'paid'`, so test bookings can never be mistaken for money — and
`/api/simulate-payment` returns 404 as soon as a real key exists.

To go live: create the Stripe account, add the two secrets, and add a webhook
endpoint pointing at `https://gliskmassage.co.uk/api/stripe/webhook` for the
`checkout.session.completed` event. Nothing in the code changes.

## Travel for home visits

Fleur sets off from Hanham. The first few miles are included; beyond that, the
miles *past* that radius are charged one way at a flat rate. The postcode is
geocoded through [postcodes.io](https://postcodes.io) (free, no key, Ordnance
Survey data) and cached, and the distance is straight-line — road miles run
longer, so this errs in the client's favour rather than overcharging on a figure
nobody can check.

Every number is a row in `settings`, so the rule changes without touching code:

| setting | default | what it does |
|---|---|---|
| `travel_free_miles` | `5` | miles included before anything is charged |
| `travel_rate_pence` | `45` | pence per chargeable mile, one way |
| `travel_max_miles` | `25` | beyond this, she doesn't travel |
| `travel_origin_lat` / `_lon` | Hanham | where she sets off from |

The price shown on the booking page is only a preview; the charge is always
recomputed on the server when the booking is taken.

## Times

Fleur sets her hours in local wall time ("Tuesdays, 10:00 to 17:00"). They are
stored as minutes from local midnight and resolved against `Europe/London` when
slots are generated, so BST and GMT are handled by the clock rather than by a
stored offset. `worker/tests/time.test.mjs` covers both switchover days,
including the hour that does not exist in March and the one that happens twice
in October.

## Setting it up

```bash
npx wrangler d1 create glisk-bookings          # put the printed id in wrangler.toml
npx wrangler d1 execute glisk-bookings --remote --file=worker/schema.sql
npx wrangler d1 execute glisk-bookings --remote --file=worker/seed.sql

npx wrangler secret put ADMIN_TOKEN            # long random string; this is Fleur's password
npx wrangler secret put RESEND_API_KEY         # optional — without it, no emails are sent

npx wrangler deploy
```

`MAIL_FROM` and `OWNER_EMAIL` are plain vars in `wrangler.toml`; change them
there. Email goes through [Resend](https://resend.com) — the free tier is 100
messages a day, which is far more than this needs. Sending is deliberately
fail-soft: if the mail provider is having a bad minute the booking is still
saved, and the failure is logged rather than shown to the client.

## Running the tests

No install, no dependencies:

```bash
node worker/tests/run.mjs
```

They run the real Worker handlers against real SQLite via `node:sqlite`, so the
schema, the collision guard and the API contract are all genuinely exercised
rather than mocked.

## Things to know before this is really live

- **`ADMIN_TOKEN` is a single shared password.** Fine for one person, but if you
  want it properly locked down, put Cloudflare Access in front of `/admin.html`
  and `/api/admin/*` — it's free for up to 50 users and takes about ten minutes.
- **The booking form collects health information.** See the note on `book.html`.
  A privacy notice and a retention period are needed before launch.
- **`book.html` carries a `noindex` tag** so the half-finished version doesn't
  get indexed. Remove it when you go live.
- **No deposit is taken for clinic bookings**, matching how Fleur already works.
  If that changes, Stripe Checkout slots into the booking POST handler — the
  booking would move to a `pending` status until the webhook confirms payment.

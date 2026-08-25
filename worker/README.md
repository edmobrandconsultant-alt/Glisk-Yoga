# The booking system

Bookings for treatments at St Anne's House. Runs as a Cloudflare Worker in front
of the static site, with the diary in D1 (Cloudflare's SQLite).

Home visits are deliberately **not** bookable here. They need the conversation
and the deposit described on `home-visits.html`, and putting them behind an
instant-booking button would quietly bypass Fleur's own safeguarding process.
Yoga and Bath treatments are enquiry-only for the same sort of reason — the
availability isn't fixed enough to publish.

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

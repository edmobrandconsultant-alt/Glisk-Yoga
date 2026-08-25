# Glisk — site conventions

Website for Glisk, a one-person massage and yoga business in Bristol and Bath.
Owner: Fleur. Plain static HTML — no build step, no framework, no npm.

## What this is

Hand-written HTML pages sharing one stylesheet, plus a small booking system.
Deployed to Cloudflare by pushing to `main`. There is no build command and no
`package.json`, and it should stay that way unless there's a real reason.

```
index.html          home
treatments.html     treatments and prices
home-visits.html    mobile massage + the women-only policy
guest-spots.html    festivals, pop-ups, and event/corporate massage
gift-vouchers.html  voucher sales
about.html          about Fleur
book.html           the booking calendar
admin.html          Fleur's private diary (noindex, not in the sitemap)
assets/css/style.css   the only stylesheet
assets/js/             book.js, admin.js, voucher.js, posts.js — vanilla, no deps
assets/img/            photos, og images
worker/                the booking API, D1 schema, and its tests
robots.txt  sitemap.xml  _headers  wrangler.toml
```

## Rules

**No dependencies.** No CDN links, no Google Fonts, no jQuery, no analytics scripts
that set cookies. The site loads its own CSS and nothing else. This is deliberate:
it keeps the site fast, private, and free of a cookie banner under PECR.

**No JavaScript unless there is no alternative.** The FAQ accordions are `<details>`
elements, not scripts. Don't add JS to do what HTML already does.

There are four scripts, all vanilla and all unavoidable: `book.js` (live
availability and payment), `admin.js` (Fleur's diary), `voucher.js` (voucher
purchase) and `posts.js` (twelve lines that hold the video controls back until
someone presses play). `book.html` degrades to a `<noscript>` block pointing at
email and phone, and the posts fall back to native controls. If you find yourself
adding a fifth, question it hard.

**There is no Instagram feed on the site.** The home page links to the profile and
stops there. A previous version played the posts in click-to-load embeds; it was
taken out on 25 Aug 2026 while the real stills were still missing — see the
commit "Take the Instagram posts off the home page" if it ever comes back.

Note what it cost, because it is the reason the site has no cookie banner: Meta's
`embed.js`, or an `instagram.com/.../embed/` iframe placed straight into the
markup, contacts Meta on page load and obliges a consent banner site-wide under
PECR. Only load either one in response to a click, or self-host the videos in
`assets/video/` behind a native `<video poster>`, which contacts nobody at all.

**Design tokens live in `:root`** at the top of `style.css`. Change colours and fonts
there, never inline. If you find yourself writing a hex code outside `:root`, stop.

**The nav and footer are duplicated across every page.** That's the cost of having
no build step. If you change one, change them all — check with:
`grep -c 'nav-links' *.html`, which should return 1 per page. `admin.html` is the
one exception: it is private and carries no nav.

**Guest spots expire by themselves.** A `.place` card on `guest-spots.html` with
`data-until="YYYY-MM-DD"` disappears from "Coming up" on the morning after that
date. The Worker does it on the way out (`worker/guestspots.js`), not the
browser — so there is no fifth script, no card jumping about after load, and
crawlers see the same page as everyone else. It only ever removes; writing the
spot up in "Where I've been" is a person's job, because those entries carry a
photograph. If anything about the markup is unexpected the page is served
untouched, so the worst case is a stale entry rather than a broken page.

**Editing prices means editing four places:** the page itself, the JSON-LD block in
`index.html`, `worker/seed.sql`, and any mention on other pages. Search for the
number before you change it.

## House style for copy

Fleur's voice is warm, plain and unhurried. Some rules that matter:

- British English. "Massage therapist", not "masseuse" — she is quoted using
  "masseuse" in an old listing, but the profession prefers "therapist".
- No exclamation marks. No "pamper", "indulge", "me time", "treat yourself",
  "unwind and rejuvenate", or any spa-brochure vocabulary.
- Short sentences are fine. Fragments are fine.
- Never invent credentials, years of experience, testimonials or review counts.
  If a fact isn't confirmed, leave a `.note` block asking Fleur for it.
- Prices are written `£60`, durations `60 min` or `sixty minutes` in prose.

## The `.note` blocks

Amber dashed boxes marked "Draft note for Fleur". They are questions for the owner —
missing photos, unconfirmed credentials, payment links not yet wired up.

**They must all be removed before the site goes live.** Check with:
`grep -rn 'class="note"' *.html`

## Accessibility

Keep the skip link, keep `aria-current="page"` on the active nav item, keep heading
order sane (one `h1` per page, no skipping levels). Body text must stay at contrast
ratio 4.5:1 or better — this is why there are two accent colours: `--gleam` for
decoration and borders, `--gleam-deep` for anything that is text on a light background.

## SEO — the non-negotiables

- Every page needs a unique `<title>` and `<meta name="description">`.
- The business name should never appear without a descriptor. It is always
  "Glisk — Massage & Yoga, Bristol" or similar, never bare "Glisk". Nobody
  searches for "glisk"; they search for "massage bristol".
- `index.html` carries a `DaySpa` JSON-LD block (the schema.org type Google
  recommends for this category — there is no massage-specific type).
  `home-visits.html` carries a `Service` block, `gift-vouchers.html` a `Product` block.
  Validate at https://validator.schema.org/ after editing.
- New page ⇒ add it to `sitemap.xml`.

## Booking

Bookings run through a Cloudflare Worker with the diary in D1. The full picture is
in `worker/README.md`; the parts that matter when editing the site:

- **Everything is paid for up front** — clinic treatments, home visits and gift
  vouchers, all through Stripe Checkout. No card details touch this domain.
- **Home visits are bookable, but land as `awaiting_review`.** The money is taken;
  Fleur then confirms or refunds in full from her diary. The women-only policy on
  `home-visits.html` still applies and is stated before anyone pays.
- **Home visits carry a travel charge** worked out from the client's postcode. All
  the numbers live in the `settings` table, not in code — see `worker/README.md`.
- **Service names, durations and prices live in `worker/seed.sql` as well.** That is
  a fourth place a price appears. Change it there too, or the booking page and the
  treatments page will disagree.
- **Until Stripe keys are set the flow runs simulated**, recording
  `payment_status = 'simulated'` so test bookings can never look like real money.
- **Run the tests after touching anything in `worker/`:** `node worker/tests/run.mjs`.
  No install needed — they use `node:sqlite` and the real Worker handlers.

## Deploying

Push to `main`. Cloudflare builds and deploys automatically. The Worker serves the
static files and handles `/api/*`; everything else is a plain file as before.
See `README.md` and `worker/README.md` for first-time setup.

## Things deliberately not here

No contact form (mailto: links instead — one less thing to break and no spam handling).
No blog. No cookie banner, because there are no cookies. Keep it that way if you can.

## Images

See `IMAGES.md` for the full spec. Short version:

- Every slot in `assets/img/` already has a correctly-sized file, so the site is
  never broken by a missing photo. Three are placeholders awaiting real photography.
- To swap one in: `./scripts/process-photo.sh <source> <slot-name>` — keep the
  filename, the HTML already points at it.
- Every `<img>` needs `width`, `height` and real descriptive `alt`. Below the fold,
  add `loading="lazy"`.
- Under 300KB per image. Nothing resizes automatically — there's no build step.
- The two `og.jpg` social cards are generated, not photographed:
  `python3 scripts/make-brand-images.py`. Re-run if brand colours change.

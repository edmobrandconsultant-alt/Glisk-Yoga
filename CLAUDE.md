# Glisk — site conventions

Website for Glisk, a one-person massage and yoga business in Bristol and Bath.
Owner: Fleur. Plain static HTML — no build step, no framework, no npm.

## What this is

Five hand-written HTML pages sharing one stylesheet. Deployed to Cloudflare Pages
by pushing to `main`. There is no build command and no `package.json`, and it should
stay that way unless there's a real reason.

```
index.html          home
treatments.html     treatments and prices
home-visits.html    mobile massage + the women-only policy
gift-vouchers.html  voucher sales
about.html          about Fleur
assets/css/style.css   the only stylesheet
assets/img/            photos, og images
robots.txt  sitemap.xml  _headers
```

## Rules

**No dependencies.** No CDN links, no Google Fonts, no jQuery, no analytics scripts
that set cookies. The site loads its own CSS and nothing else. This is deliberate:
it keeps the site fast, private, and free of a cookie banner under PECR.

**No JavaScript unless there is no alternative.** Everything currently works without it —
the FAQ accordions are `<details>` elements. Don't add JS to do what HTML already does.

**Design tokens live in `:root`** at the top of `style.css`. Change colours and fonts
there, never inline. If you find yourself writing a hex code outside `:root`, stop.

**The nav and footer are duplicated across all five pages.** That's the cost of having
no build step. If you change one, change all five — check with:
`grep -c 'nav-links' *.html` should return 1 per page.

**Editing prices means editing three places:** the page itself, the JSON-LD block in
`index.html`, and any mention on other pages. Search for the number before you change it.

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

## Deploying

Push to `main`. Cloudflare Pages builds and deploys automatically — build command
empty, output directory `/`. See `README.md` for first-time setup.

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

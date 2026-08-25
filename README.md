# Glisk website — setup and handover

Static site for Glisk (Fleur's massage and yoga business, Bristol & Bath).
Plain HTML and CSS. No build step.

---

## Before anything else: who owns what

This is the part that goes wrong. Sites built by a friend don't die because the code
rots — static HTML on a CDN will serve happily for a decade. They die because the
domain was registered on the friend's card, the friend's card expired, and nobody
else could log in to fix it.

**Every account below must be created by Fleur, on her email, with her card.**
Ed gets added as a collaborator. Not the other way round.

| Account | Who owns it | Cost |
|---|---|---|
| Domain (Krystal or Namecheap) | Fleur | ~£8/yr |
| Cloudflare (Pages hosting + DNS) | Fleur | £0 |
| GitHub (the code) | Fleur, Ed invited as collaborator | £0 |
| Booking system (Booksy / Acuity / Setmore) | Fleur | varies |
| Square (gift vouchers) | Fleur | £0 + 1.4% |

Put all five in a password manager and print the list. Genuinely — print it.

---

## First-time setup

### 1. Domain

Register **gliskmassage.co.uk** at [Krystal](https://krystal.io/domains) (£7.99/yr,
UK company, flat renewals, real phone support) or
[Namecheap](https://www.namecheap.com) (£7.43 renewal).

Avoid 123-reg (£4.99 first year then £12.99) and Gandi (£19+ renewals).
Cloudflare Registrar is cheapest at ~£4.20 but .co.uk transfers use Nominet's IPS tag
system and are fiddly — not worth the £3 saving here.

### 2. Repo

```bash
cd glisk-site
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin git@github.com:FLEUR-USERNAME/glisk-site.git
git push -u origin main
```

### 3. Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pick the repo
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
4. Deploy. You get a `*.pages.dev` URL immediately.
5. **Custom domains** → add `gliskmassage.co.uk` and `www.gliskmassage.co.uk`
6. Point the domain's nameservers at Cloudflare (the dashboard walks you through it)

HTTPS is automatic and auto-renews. Bandwidth is unlimited and unmetered on the free plan.

**Why Cloudflare Pages and not the others:**

- **Vercel** — the Hobby plan [prohibits commercial use](https://vercel.com/docs/limits/fair-use-guidelines),
  explicitly including "advertising the sale of a product or service". This site would need Pro at $20/mo.
- **Netlify** — the free plan now runs on credits (300/month, a deploy costs 15).
  Exceed them and **your site is paused until the next billing cycle.** Unacceptable for a business.
- **GitHub Pages** — [not allowed](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
  "to run your online business". Grey area for a brochure site, but why risk it.

### 4. Email address

Cloudflare **Email Routing** (free) forwards `hello@gliskmassage.co.uk` → Fleur's Gmail.
Dashboard → Email → Email Routing → add the address. Takes two minutes.

Note it's forwarding only — replies come *from* the Gmail address. If she wants to
send as `hello@`, that needs Google Workspace at ~£6/month.

### 5. Search Console

Add the site at [Google Search Console](https://search.google.com/search-console),
verify with a DNS TXT record (one click if DNS is on Cloudflare), submit
`https://gliskmassage.co.uk/sitemap.xml`. Do the same at
[Bing Webmaster Tools](https://www.bing.com/webmasters) — it feeds Copilot and ChatGPT search.

### 6. Analytics

**Cloudflare Web Analytics** — free, in the dashboard, one line of setup, no cookies.
No cookie banner needed, which is a real advantage: GA4 would require one under
PECR because Google uses the data for its own purposes.

Limits worth knowing: 6 months retention, no custom events, no UTM tracking.
If she ever wants "how many people clicked Book", move to Plausible ($9/mo).

---

## Making changes

### Locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Edit the HTML, refresh, commit, push. Cloudflare redeploys in about 30 seconds.

### Where this is up to

Working on this locally: `git clone`, then run Claude Code in the folder. The
conventions are in `CLAUDE.md`, the booking system in `worker/README.md`, and the
image spec in `IMAGES.md` — all three are read automatically.

Done and working:

- Seven pages, one stylesheet, no build step. Deploys as a Cloudflare Worker.
- Booking with payment up front — clinic treatments, home visits and gift
  vouchers, all through Stripe Checkout. `node worker/tests/run.mjs` covers it.
- Home visits land as `awaiting_review` so Fleur confirms or refunds; travel is
  priced from her postcode.
- `admin.html` is her diary: bookings, working hours, days away.

Waiting on files or answers from Fleur:

- [ ] `assets/video/post-1.mp4` and `post-2.mp4` — the two Instagram videos. The
      cards on the home page are built and are showing placeholder stills.
- [ ] Real stills for those posts, plus a line of copy for each. All three
      currently read "One line about what this one is."
- [ ] Photos for the Gather Round and Campwell Woods entries on `guest-spots.html`.
- [ ] Dates and locations for the guest spots.
- [ ] A day rate and half-day rate for event work, for `guest-spots.html`.
- [ ] A privacy notice and a retention period for the health information the
      booking form collects. This one is a legal requirement, not a nicety.
- [ ] Stripe keys. Until they are set the booking flow runs simulated end to end,
      recording `payment_status = 'simulated'` so nothing looks like real money.

Every one of these has a `.note` block on the page it belongs to:
`grep -rn 'class="note"' *.html`

### The before-launch checklist

- [ ] Remove every `.note` block — `grep -rn 'class="note"' *.html`
- [ ] Set up the booking system — `worker/README.md` has the run-through
- [ ] Write a privacy notice and pick a retention period for the health notes
      the booking form collects (see the note on `book.html`)
- [ ] Remove the `noindex` tag from `book.html`
- [ ] Put Cloudflare Access in front of `/admin.html` if you want it properly locked
- [ ] Cancel the Booksy subscription once bookings are coming through the site
- [ ] Add a real photo of Fleur, replacing both `.portrait` divs
- [ ] Add `assets/img/og.jpg` (1200×630) or link previews will be blank
- [ ] Confirm qualifications on `about.html`
- [ ] Wire up the three Square voucher links on `gift-vouchers.html`
- [ ] Confirm prices are current on **every** page and in the JSON-LD in `index.html`
- [ ] Set up `hello@gliskmassage.co.uk` — it's used in six places
- [ ] Check every page on an actual phone
- [ ] Run the homepage through [validator.schema.org](https://validator.schema.org/)
- [ ] Make the NAP (name, address, phone) match her Google Business Profile **exactly**

### Images

There's no build pipeline, so nothing resizes images automatically. Before adding a photo:

```bash
# resize and compress — needs imagemagick
magick photo.jpg -resize 1600x -quality 82 assets/img/fleur.jpg
```

A 4MB phone photo dropped in unprocessed will undo the site's main performance advantage.

---

## When Fleur needs to change something herself

Right now she can't — she'd have to edit HTML. That's fine for the first year while
Ed is around, but it is the thing that eventually kills sites like this.

**When it starts to chafe, add [Sveltia CMS](https://sveltiacms.app).** It's free,
actively developed (releases most weeks), works properly on a phone, and gives her an
admin page where she can edit prices and hours without seeing any code. It's a single
HTML file plus a config file — an afternoon's work.

Don't use Decap CMS. It's still maintained, but its login system depends on Netlify
Identity, which is deprecated, and the maintainers have
[said so themselves](https://github.com/decaporg/decap-cms/discussions/7419).

**Set a date.** Something like: *"I'll look after this until August 2027, and before
then we either renew that or move her to Squarespace."* Naming the expiry in advance
is what stops this becoming the classic abandoned-site story.

---

## Cost

| | Per year |
|---|---|
| Domain | £8 |
| Cloudflare Pages | £0 |
| Cloudflare Web Analytics | £0 |
| Email forwarding | £0 |
| **Total** | **£8** |

Booking software is separate and is the real running cost — from £0 (Setmore free)
to ~£168/yr (Acuity) to ~£576/yr (Booksy, her current one).

For comparison, Squarespace Core + Scheduling is about £412/year.

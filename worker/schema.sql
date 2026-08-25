-- Glisk booking system — D1 schema
--
-- Times: every *_utc column is epoch milliseconds, UTC. Wall-clock times that
-- Fleur sets (her working hours) are stored as minutes from local midnight and
-- resolved against Europe/London at slot-generation time, so BST and GMT are
-- handled by the clock rather than by stored offsets.

PRAGMA foreign_keys = ON;

-- What can be booked online.
--
-- Home visits are bookable and paid for up front like everything else. They are
-- flagged requires_review, which means the booking lands as 'awaiting_review'
-- rather than 'confirmed': the money is taken, Fleur reads the details, and she
-- confirms or refunds. That keeps payment frictionless without pretending the
-- women-only policy on home-visits.html has stopped applying.
CREATE TABLE IF NOT EXISTS services (
  id             TEXT PRIMARY KEY,
  name           TEXT    NOT NULL,
  duration_min   INTEGER NOT NULL,
  price_pence    INTEGER NOT NULL,
  blurb          TEXT,
  location       TEXT    NOT NULL DEFAULT 'clinic',  -- clinic | home
  requires_review INTEGER NOT NULL DEFAULT 0,
  needs_address  INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- Recurring weekly working hours, in local wall time.
CREATE TABLE IF NOT EXISTS availability (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_min  INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min    INTEGER NOT NULL CHECK (end_min   BETWEEN 0 AND 1440),
  active     INTEGER NOT NULL DEFAULT 1,
  CHECK (end_min > start_min)
);

-- One-off closures: holidays, festivals, guest spots.
CREATE TABLE IF NOT EXISTS blackouts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  start_utc INTEGER NOT NULL,
  end_utc   INTEGER NOT NULL,
  reason    TEXT,
  CHECK (end_utc > start_utc)
);

-- status
--   pending         slot held while the payment page is open; expires by itself
--   awaiting_review paid, but Fleur has not yet approved it (home visits)
--   confirmed       paid and going ahead
--   cancelled       cancelled by client or by Fleur
--   expired         payment never completed; the slot was released
CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,
  service_id   TEXT NOT NULL REFERENCES services(id),
  start_utc    INTEGER NOT NULL,
  end_utc      INTEGER NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','awaiting_review','confirmed','cancelled','expired')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
               CHECK (payment_status IN ('unpaid','paid','refunded','simulated')),
  amount_pence INTEGER NOT NULL DEFAULT 0,   -- treatment + travel, what was charged
  travel_pence INTEGER NOT NULL DEFAULT 0,
  travel_miles REAL,
  postcode     TEXT,
  stripe_session_id TEXT,
  paid_utc     INTEGER,
  expires_utc  INTEGER,
  manage_token TEXT NOT NULL,
  created_utc  INTEGER NOT NULL,
  cancelled_utc INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_utc);
CREATE INDEX IF NOT EXISTS idx_bookings_token ON bookings(manage_token);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_expiry ON bookings(expires_utc);

-- Double-booking prevention.
--
-- SQLite has no exclusion constraint, so occupancy is modelled as one row per
-- 15-minute block that a booking covers (treatment plus turnaround buffer).
-- block_utc is the PRIMARY KEY, so two bookings that overlap by even one block
-- collide on insert. The booking and all its blocks go in as a single D1 batch,
-- which runs as one transaction — so a losing race rolls back whole, and never
-- leaves a booking with partial occupancy.
CREATE TABLE IF NOT EXISTS occupancy (
  block_utc  INTEGER PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_occupancy_booking ON occupancy(booking_id);

-- Gift vouchers. Bought outright, no slot, so they never touch occupancy.
CREATE TABLE IF NOT EXISTS vouchers (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  amount_pence   INTEGER NOT NULL,
  buyer_name     TEXT NOT NULL,
  buyer_email    TEXT NOT NULL,
  recipient_name TEXT,
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','issued','redeemed','expired','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
                 CHECK (payment_status IN ('unpaid','paid','refunded','simulated')),
  stripe_session_id TEXT,
  created_utc    INTEGER NOT NULL,
  paid_utc       INTEGER,
  redeemed_utc   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vouchers_session ON vouchers(stripe_session_id);

-- Cached postcode lookups, so the same address is geocoded once.
CREATE TABLE IF NOT EXISTS postcodes (
  postcode   TEXT PRIMARY KEY,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  cached_utc INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

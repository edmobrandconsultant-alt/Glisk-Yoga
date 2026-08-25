-- Glisk booking system — D1 schema
--
-- Times: every *_utc column is epoch milliseconds, UTC. Wall-clock times that
-- Fleur sets (her working hours) are stored as minutes from local midnight and
-- resolved against Europe/London at slot-generation time, so BST and GMT are
-- handled by the clock rather than by stored offsets.

PRAGMA foreign_keys = ON;

-- What can be booked online. Home visits are deliberately absent: they need the
-- conversation and deposit described on home-visits.html, so they stay enquiry-only.
CREATE TABLE IF NOT EXISTS services (
  id            TEXT PRIMARY KEY,
  name          TEXT    NOT NULL,
  duration_min  INTEGER NOT NULL,
  price_pence   INTEGER NOT NULL,
  blurb         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,
  service_id   TEXT NOT NULL REFERENCES services(id),
  start_utc    INTEGER NOT NULL,
  end_utc      INTEGER NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  manage_token TEXT NOT NULL,
  created_utc  INTEGER NOT NULL,
  cancelled_utc INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_utc);
CREATE INDEX IF NOT EXISTS idx_bookings_token ON bookings(manage_token);

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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

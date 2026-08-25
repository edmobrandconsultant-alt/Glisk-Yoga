-- Starting data. Prices and durations match treatments.html — if you change
-- one, change both, plus the JSON-LD block in index.html.

INSERT OR REPLACE INTO services
  (id, name, duration_min, price_pence, blurb, location, requires_review, needs_address, active, sort_order) VALUES
  ('deep-60',  'Deep Tissue Massage',            60, 6000,
   'Firm, slow work into the places that have been holding on. Good for necks, shoulders and lower backs.',
   'clinic', 0, 0, 1, 1),
  ('deep-90',  'Deep Tissue Massage',            90, 8500,
   'The same work with room to be thorough, rather than picking one area and running out of time.',
   'clinic', 0, 0, 1, 2),
  ('relax-60', 'Relaxation & Wellbeing Massage', 60, 6000,
   'Lighter, slower, and continuous. For when the goal is to stop thinking for an hour.',
   'clinic', 0, 0, 1, 3),
  ('relax-90', 'Relaxation & Wellbeing Massage', 90, 8500,
   'Ninety minutes of the same. Most people fall asleep somewhere in the middle.',
   'clinic', 0, 0, 1, 4),

  -- Home visits. Paid for up front like everything else, but flagged for review:
  -- the booking lands as 'awaiting_review' so Fleur reads the details and either
  -- confirms or refunds in full. Women only, as set out on home-visits.html.
  ('home-60',  'Massage at your home',           60, 7500,
   'I bring the couch, the towels and the oils. Bristol and Bath. Women only.',
   'home', 1, 1, 1, 5),
  ('home-90',  'Massage at your home',           90, 10000,
   'The one I would recommend — once I have travelled and set up, the extra half hour is the cheapest part.',
   'home', 1, 1, 1, 6);

-- Placeholder hours: Tuesday, Wednesday and Thursday, 10:00 to 17:00.
-- Fleur sets her real hours on /admin.html; this is only so the calendar has
-- something to show on day one.
DELETE FROM availability;
INSERT INTO availability (weekday, start_min, end_min) VALUES
  (2, 600, 1020),
  (3, 600, 1020),
  (4, 600, 1020);

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('buffer_min',       '15'),
  ('min_notice_hours', '12'),
  ('max_advance_days', '60'),
  ('grid_min',         '15'),

  -- Travel for home visits. Fleur sets off from Hanham. The first
  -- travel_free_miles are included; miles beyond that are charged one way at
  -- travel_rate_pence each. Beyond travel_max_miles she does not travel.
  ('travel_free_miles',  '5'),
  ('travel_rate_pence',  '45'),
  ('travel_max_miles',   '25'),
  ('travel_origin_lat',  '51.4406'),
  ('travel_origin_lon',  '-2.4939');

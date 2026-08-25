-- Starting data. Prices and durations match treatments.html — if you change
-- one, change both, plus the JSON-LD block in index.html.

INSERT OR REPLACE INTO services (id, name, duration_min, price_pence, blurb, active, sort_order) VALUES
  ('deep-60',  'Deep Tissue Massage',            60, 6000,
   'Firm, slow work into the places that have been holding on. Good for necks, shoulders and lower backs.', 1, 1),
  ('deep-90',  'Deep Tissue Massage',            90, 8500,
   'The same work with room to be thorough, rather than picking one area and running out of time.', 1, 2),
  ('relax-60', 'Relaxation & Wellbeing Massage', 60, 6000,
   'Lighter, slower, and continuous. For when the goal is to stop thinking for an hour.', 1, 3),
  ('relax-90', 'Relaxation & Wellbeing Massage', 90, 8500,
   'Ninety minutes of the same. Most people fall asleep somewhere in the middle.', 1, 4);

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
  ('grid_min',         '15');

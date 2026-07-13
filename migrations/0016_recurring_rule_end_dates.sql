PRAGMA foreign_keys = ON;

ALTER TABLE recurring_rules
ADD COLUMN schedule_ends_on TEXT CHECK(
  schedule_ends_on IS NULL
  OR (
    schedule_ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(schedule_ends_on) IS NOT NULL
    AND date(schedule_ends_on) = schedule_ends_on
    AND schedule_ends_on >= schedule_starts_on
  )
);

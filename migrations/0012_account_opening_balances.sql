PRAGMA foreign_keys = ON;

-- A dated opening balance anchors an account immediately before the given date.
-- Null values preserve the existing behaviour: derive the balance from all
-- recorded ledger history without inventing a starting amount.
ALTER TABLE accounts ADD COLUMN opening_balance_minor INTEGER
  CHECK(
    opening_balance_minor IS NULL
    OR opening_balance_minor BETWEEN -9007199254740991 AND 9007199254740991
  );

ALTER TABLE accounts ADD COLUMN opening_balance_on TEXT
  CHECK(
    opening_balance_on IS NULL
    OR (
      opening_balance_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(opening_balance_on) IS NOT NULL
      AND date(opening_balance_on) = opening_balance_on
    )
  );

CREATE TRIGGER accounts_opening_balance_insert_guard
BEFORE INSERT ON accounts
WHEN (NEW.opening_balance_minor IS NULL) <> (NEW.opening_balance_on IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'opening balance and date must both be present or null');
END;

CREATE TRIGGER accounts_opening_balance_update_guard
BEFORE UPDATE OF opening_balance_minor, opening_balance_on ON accounts
WHEN (NEW.opening_balance_minor IS NULL) <> (NEW.opening_balance_on IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'opening balance and date must both be present or null');
END;

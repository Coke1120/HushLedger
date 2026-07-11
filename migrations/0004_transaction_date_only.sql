PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_transactions_occurred_at;
DROP INDEX IF EXISTS idx_transactions_type_occurred_at;
DROP INDEX IF EXISTS idx_transactions_account_occurred_at;
DROP INDEX IF EXISTS idx_transactions_category_occurred_at;

ALTER TABLE transactions RENAME TO transactions_with_time;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY CHECK(
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency = 'HKD'),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK(
    occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(occurred_on) IS NOT NULL
    AND date(occurred_on) = occurred_on
  ),
  payee TEXT NOT NULL DEFAULT '' CHECK(length(payee) <= 80),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO transactions(
  id,
  type,
  amount_minor,
  currency,
  account_id,
  category_id,
  occurred_on,
  payee,
  note,
  created_at,
  updated_at
)
SELECT
  id,
  type,
  amount_minor,
  currency,
  account_id,
  category_id,
  strftime('%Y-%m-%d', occurred_at, '+8 hours'),
  payee,
  note,
  created_at,
  updated_at
FROM transactions_with_time;

DROP TABLE transactions_with_time;

CREATE INDEX idx_transactions_occurred_on
  ON transactions(occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_type_occurred_on
  ON transactions(type, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_account_occurred_on
  ON transactions(account_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_category_occurred_on
  ON transactions(category_id, occurred_on DESC, created_at DESC, id DESC);

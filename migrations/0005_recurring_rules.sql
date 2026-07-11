PRAGMA foreign_keys = ON;

CREATE TABLE recurring_rules (
  id TEXT PRIMARY KEY CHECK(
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency = 'HKD'),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly')),
  schedule_starts_on TEXT NOT NULL CHECK(
    schedule_starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(schedule_starts_on) IS NOT NULL
    AND date(schedule_starts_on) = schedule_starts_on
  ),
  next_occurrence_on TEXT NOT NULL CHECK(
    next_occurrence_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(next_occurrence_on) IS NOT NULL
    AND date(next_occurrence_on) = next_occurrence_on
  ),
  last_occurrence_on TEXT CHECK(
    last_occurrence_on IS NULL
    OR (
      last_occurrence_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(last_occurrence_on) IS NOT NULL
      AND date(last_occurrence_on) = last_occurrence_on
    )
  ),
  anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  payee TEXT NOT NULL DEFAULT '' CHECK(length(payee) <= 80),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK(generated_count >= 0),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64),
  last_error_at TEXT CHECK(last_error_at IS NULL OR substr(last_error_at, -1) = 'Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  cursor_version INTEGER NOT NULL DEFAULT 1 CHECK(cursor_version > 0),
  deleted_at TEXT CHECK(deleted_at IS NULL OR substr(deleted_at, -1) = 'Z'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

DROP INDEX IF EXISTS idx_transactions_occurred_on;
DROP INDEX IF EXISTS idx_transactions_type_occurred_on;
DROP INDEX IF EXISTS idx_transactions_account_occurred_on;
DROP INDEX IF EXISTS idx_transactions_category_occurred_on;

ALTER TABLE transactions RENAME TO transactions_before_recurring;

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
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  recurring_rule_name TEXT CHECK(recurring_rule_name IS NULL OR length(recurring_rule_name) BETWEEN 1 AND 80),
  recurrence_due_on TEXT CHECK(
    recurrence_due_on IS NULL
    OR (
      recurrence_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(recurrence_due_on) IS NOT NULL
      AND date(recurrence_due_on) = recurrence_due_on
    )
  ),
  recurring_occurrence_key TEXT UNIQUE CHECK(
    recurring_occurrence_key IS NULL
    OR recurring_occurrence_key = recurring_rule_id || ':' || recurrence_due_on
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK(
    (
      recurring_rule_id IS NULL
      AND recurring_rule_name IS NULL
      AND recurrence_due_on IS NULL
      AND recurring_occurrence_key IS NULL
    )
    OR (
      recurring_rule_id IS NOT NULL
      AND recurring_rule_name IS NOT NULL
      AND recurrence_due_on IS NOT NULL
      AND recurring_occurrence_key IS NOT NULL
    )
  )
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
  occurred_on,
  payee,
  note,
  created_at,
  updated_at
FROM transactions_before_recurring;

DROP TABLE transactions_before_recurring;

CREATE INDEX idx_recurring_rules_due
  ON recurring_rules(is_active, next_occurrence_on, id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_recurring_rules_account
  ON recurring_rules(account_id, deleted_at, id);
CREATE INDEX idx_recurring_rules_category
  ON recurring_rules(category_id, deleted_at, id);

CREATE INDEX idx_transactions_occurred_on
  ON transactions(occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_type_occurred_on
  ON transactions(type, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_account_occurred_on
  ON transactions(account_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_category_occurred_on
  ON transactions(category_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_recurring_rule
  ON transactions(recurring_rule_id, recurrence_due_on DESC)
  WHERE recurring_rule_id IS NOT NULL;

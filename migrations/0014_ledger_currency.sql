PRAGMA foreign_keys = ON;

-- One ledger has one currency. Currency changes relabel an otherwise-pristine
-- ledger; they never convert recorded amounts or apply exchange rates.
CREATE TABLE ledger_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  currency TEXT NOT NULL UNIQUE CHECK(currency IN (
    'AED', 'AUD', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
    'ILS', 'INR', 'MOP', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'QAR',
    'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'USD', 'ZAR'
  )),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO ledger_settings(id, currency)
VALUES (1, 'HKD');

-- Stage dependent rows without foreign keys so accounts can be rebuilt while
-- foreign-key enforcement remains enabled in D1.
CREATE TABLE _currency_migration_accounts AS
SELECT * FROM accounts;

CREATE TABLE _currency_migration_recurring_rules AS
SELECT * FROM recurring_rules;

CREATE TABLE _currency_migration_transactions AS
SELECT * FROM transactions;

CREATE TABLE _currency_migration_account_transfers AS
SELECT * FROM account_transfers;

CREATE TABLE _currency_migration_emergency_fund_goals AS
SELECT * FROM emergency_fund_goals;

DROP TABLE transactions;
DROP TABLE account_transfers;
DROP TABLE recurring_rules;
DROP TABLE emergency_fund_goals;
DROP TABLE accounts;

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK(type IN ('cash', 'bank', 'credit_card', 'wallet')),
  currency TEXT NOT NULL DEFAULT 'HKD'
    REFERENCES ledger_settings(currency) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  localization_key TEXT CHECK(
    localization_key IS NULL
    OR (
      length(localization_key) BETWEEN 3 AND 64
      AND localization_key = lower(localization_key)
      AND localization_key GLOB 'account.[a-z_]*'
    )
  ),
  opening_balance_minor INTEGER CHECK(
    opening_balance_minor IS NULL
    OR opening_balance_minor BETWEEN -9007199254740991 AND 9007199254740991
  ),
  opening_balance_on TEXT CHECK(
    opening_balance_on IS NULL
    OR (
      opening_balance_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(opening_balance_on) IS NOT NULL
      AND date(opening_balance_on) = opening_balance_on
    )
  )
);

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
  currency TEXT NOT NULL DEFAULT 'HKD'
    REFERENCES ledger_settings(currency) ON UPDATE CASCADE ON DELETE RESTRICT,
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
  currency TEXT NOT NULL DEFAULT 'HKD'
    REFERENCES ledger_settings(currency) ON UPDATE CASCADE ON DELETE RESTRICT,
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
  cleared INTEGER NOT NULL DEFAULT 1 CHECK(cleared IN (0, 1)),
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

CREATE TABLE account_transfers (
  id TEXT PRIMARY KEY CHECK(
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'HKD'
    REFERENCES ledger_settings(currency) ON UPDATE CASCADE ON DELETE RESTRICT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  to_account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK(
    occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(occurred_on) IS NOT NULL
    AND date(occurred_on) = occurred_on
  ),
  from_cleared INTEGER NOT NULL DEFAULT 0 CHECK(from_cleared IN (0, 1)),
  to_cleared INTEGER NOT NULL DEFAULT 0 CHECK(to_cleared IN (0, 1)),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK(from_account_id <> to_account_id)
);

CREATE TABLE emergency_fund_goals (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  target_minor INTEGER NOT NULL CHECK(target_minor BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO accounts(
  id, name, type, currency, is_active, sort_order, created_at, updated_at,
  localization_key, opening_balance_minor, opening_balance_on
)
SELECT
  id, name, type, currency, is_active, sort_order, created_at, updated_at,
  localization_key, opening_balance_minor, opening_balance_on
FROM _currency_migration_accounts;

INSERT INTO recurring_rules(
  id, name, type, amount_minor, currency, account_id, category_id, frequency,
  schedule_starts_on, next_occurrence_on, last_occurrence_on, anchor_day,
  is_active, payee, note, generated_count, last_error_code, last_error_at,
  revision, cursor_version, deleted_at, created_at, updated_at
)
SELECT
  id, name, type, amount_minor, currency, account_id, category_id, frequency,
  schedule_starts_on, next_occurrence_on, last_occurrence_on, anchor_day,
  is_active, payee, note, generated_count, last_error_code, last_error_at,
  revision, cursor_version, deleted_at, created_at, updated_at
FROM _currency_migration_recurring_rules;

INSERT INTO transactions(
  id, type, amount_minor, currency, account_id, category_id, occurred_on,
  payee, note, recurring_rule_id, recurring_rule_name, recurrence_due_on,
  recurring_occurrence_key, created_at, updated_at, cleared
)
SELECT
  id, type, amount_minor, currency, account_id, category_id, occurred_on,
  payee, note, recurring_rule_id, recurring_rule_name, recurrence_due_on,
  recurring_occurrence_key, created_at, updated_at, cleared
FROM _currency_migration_transactions;

INSERT INTO account_transfers(
  id, amount_minor, currency, from_account_id, to_account_id, occurred_on,
  from_cleared, to_cleared, note, created_at, updated_at
)
SELECT
  id, amount_minor, currency, from_account_id, to_account_id, occurred_on,
  from_cleared, to_cleared, note, created_at, updated_at
FROM _currency_migration_account_transfers;

INSERT INTO emergency_fund_goals(id, account_id, target_minor, created_at, updated_at)
SELECT id, account_id, target_minor, created_at, updated_at
FROM _currency_migration_emergency_fund_goals;

DROP TABLE _currency_migration_transactions;
DROP TABLE _currency_migration_account_transfers;
DROP TABLE _currency_migration_recurring_rules;
DROP TABLE _currency_migration_emergency_fund_goals;
DROP TABLE _currency_migration_accounts;

CREATE INDEX idx_accounts_active_sort
  ON accounts(is_active, sort_order, id);
CREATE UNIQUE INDEX idx_accounts_localization_key
  ON accounts(localization_key)
  WHERE localization_key IS NOT NULL;

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
CREATE INDEX idx_transactions_cleared_occurred_on
  ON transactions(cleared, occurred_on DESC, id DESC);

CREATE INDEX idx_account_transfers_occurred_on
  ON account_transfers(occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_account_transfers_from_account
  ON account_transfers(from_account_id, occurred_on DESC, id DESC);
CREATE INDEX idx_account_transfers_to_account
  ON account_transfers(to_account_id, occurred_on DESC, id DESC);

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

CREATE TRIGGER ledger_currency_update_guard
BEFORE UPDATE OF currency ON ledger_settings
WHEN NEW.currency <> OLD.currency
AND (
  EXISTS (SELECT 1 FROM transactions)
  OR EXISTS (SELECT 1 FROM account_transfers)
  OR EXISTS (SELECT 1 FROM recurring_rules)
  OR EXISTS (SELECT 1 FROM transaction_import_keys)
  OR EXISTS (SELECT 1 FROM accounts WHERE opening_balance_minor IS NOT NULL)
  OR EXISTS (SELECT 1 FROM categories WHERE monthly_plan_minor IS NOT NULL)
  OR EXISTS (SELECT 1 FROM emergency_fund_goals)
)
BEGIN
  SELECT RAISE(ABORT, 'ledger currency is locked by monetary history');
END;

CREATE TRIGGER ledger_revision_ledger_settings_insert
AFTER INSERT ON ledger_settings
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_ledger_settings_update
AFTER UPDATE ON ledger_settings
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_ledger_settings_delete
AFTER DELETE ON ledger_settings
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_accounts_insert
AFTER INSERT ON accounts
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_accounts_update
AFTER UPDATE ON accounts
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_accounts_delete
AFTER DELETE ON accounts
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_recurring_rules_insert
AFTER INSERT ON recurring_rules
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_recurring_rules_update
AFTER UPDATE ON recurring_rules
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_recurring_rules_delete
AFTER DELETE ON recurring_rules
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_transactions_insert
AFTER INSERT ON transactions
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_transactions_update
AFTER UPDATE ON transactions
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_transactions_delete
AFTER DELETE ON transactions
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_account_transfers_insert
AFTER INSERT ON account_transfers
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_account_transfers_update
AFTER UPDATE ON account_transfers
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_account_transfers_delete
AFTER DELETE ON account_transfers
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_emergency_fund_goals_insert
AFTER INSERT ON emergency_fund_goals
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_emergency_fund_goals_update
AFTER UPDATE ON emergency_fund_goals
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_emergency_fund_goals_delete
AFTER DELETE ON emergency_fund_goals
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

PRAGMA foreign_keys = ON;

-- Scheduled internal movements remain native transfers, so they never inflate
-- income or expense reporting and retain one atomic two-account identity.
CREATE TABLE recurring_transfer_rules (
  id TEXT PRIMARY KEY CHECK(
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'HKD'
    REFERENCES ledger_settings(currency) ON UPDATE CASCADE ON DELETE RESTRICT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  to_account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  schedule_starts_on TEXT NOT NULL CHECK(
    schedule_starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(schedule_starts_on) IS NOT NULL
    AND date(schedule_starts_on) = schedule_starts_on
  ),
  schedule_ends_on TEXT CHECK(
    schedule_ends_on IS NULL
    OR (
      schedule_ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(schedule_ends_on) IS NOT NULL
      AND date(schedule_ends_on) = schedule_ends_on
      AND schedule_ends_on >= schedule_starts_on
    )
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
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK(generated_count >= 0),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64),
  last_error_at TEXT CHECK(last_error_at IS NULL OR substr(last_error_at, -1) = 'Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  cursor_version INTEGER NOT NULL DEFAULT 1 CHECK(cursor_version > 0),
  deleted_at TEXT CHECK(deleted_at IS NULL OR substr(deleted_at, -1) = 'Z'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK(from_account_id <> to_account_id),
  CHECK(next_occurrence_on >= schedule_starts_on),
  CHECK(last_occurrence_on IS NULL OR last_occurrence_on < next_occurrence_on),
  CHECK(schedule_ends_on IS NULL OR is_active = 0 OR next_occurrence_on <= schedule_ends_on)
);

-- Stage the unreferenced transfer table so provenance can be added without
-- weakening foreign-key enforcement during the D1 migration.
CREATE TABLE _recurring_transfer_migration_account_transfers AS
SELECT * FROM account_transfers;

DROP TRIGGER ledger_currency_update_guard;
DROP TABLE account_transfers;

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
  recurring_transfer_rule_id TEXT
    REFERENCES recurring_transfer_rules(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  recurring_transfer_rule_name TEXT CHECK(
    recurring_transfer_rule_name IS NULL
    OR length(recurring_transfer_rule_name) BETWEEN 1 AND 80
  ),
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
    OR recurring_occurrence_key = recurring_transfer_rule_id || ':' || recurrence_due_on
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK(from_account_id <> to_account_id),
  CHECK(
    (
      recurring_transfer_rule_id IS NULL
      AND recurring_transfer_rule_name IS NULL
      AND recurrence_due_on IS NULL
      AND recurring_occurrence_key IS NULL
    )
    OR (
      recurring_transfer_rule_id IS NOT NULL
      AND recurring_transfer_rule_name IS NOT NULL
      AND recurrence_due_on IS NOT NULL
      AND recurring_occurrence_key IS NOT NULL
    )
  )
);

INSERT INTO account_transfers(
  id, amount_minor, currency, from_account_id, to_account_id, occurred_on,
  from_cleared, to_cleared, note, created_at, updated_at
)
SELECT
  id, amount_minor, currency, from_account_id, to_account_id, occurred_on,
  from_cleared, to_cleared, note, created_at, updated_at
FROM _recurring_transfer_migration_account_transfers;

DROP TABLE _recurring_transfer_migration_account_transfers;

CREATE INDEX idx_recurring_transfer_rules_due
  ON recurring_transfer_rules(is_active, next_occurrence_on, id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_recurring_transfer_rules_from_account
  ON recurring_transfer_rules(from_account_id, deleted_at, id);
CREATE INDEX idx_recurring_transfer_rules_to_account
  ON recurring_transfer_rules(to_account_id, deleted_at, id);

CREATE INDEX idx_account_transfers_occurred_on
  ON account_transfers(occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_account_transfers_from_account
  ON account_transfers(from_account_id, occurred_on DESC, id DESC);
CREATE INDEX idx_account_transfers_to_account
  ON account_transfers(to_account_id, occurred_on DESC, id DESC);
CREATE INDEX idx_account_transfers_recurring_transfer_rule
  ON account_transfers(recurring_transfer_rule_id, recurrence_due_on DESC)
  WHERE recurring_transfer_rule_id IS NOT NULL;

CREATE TRIGGER account_transfers_recurring_provenance_update_guard
BEFORE UPDATE OF
  recurring_transfer_rule_id,
  recurring_transfer_rule_name,
  recurrence_due_on,
  recurring_occurrence_key
ON account_transfers
WHEN NOT (
  NEW.recurring_transfer_rule_id IS OLD.recurring_transfer_rule_id
  AND NEW.recurring_transfer_rule_name IS OLD.recurring_transfer_rule_name
  AND NEW.recurrence_due_on IS OLD.recurrence_due_on
  AND NEW.recurring_occurrence_key IS OLD.recurring_occurrence_key
)
BEGIN
  SELECT RAISE(ABORT, 'recurring transfer provenance is immutable');
END;

CREATE TRIGGER ledger_currency_update_guard
BEFORE UPDATE OF currency ON ledger_settings
WHEN NEW.currency <> OLD.currency
AND (
  EXISTS (SELECT 1 FROM transactions)
  OR EXISTS (SELECT 1 FROM account_transfers)
  OR EXISTS (SELECT 1 FROM recurring_rules)
  OR EXISTS (SELECT 1 FROM recurring_transfer_rules)
  OR EXISTS (SELECT 1 FROM transaction_import_keys)
  OR EXISTS (SELECT 1 FROM accounts WHERE opening_balance_minor IS NOT NULL)
  OR EXISTS (SELECT 1 FROM categories WHERE monthly_plan_minor IS NOT NULL)
  OR EXISTS (SELECT 1 FROM emergency_fund_goals)
)
BEGIN
  SELECT RAISE(ABORT, 'ledger currency is locked by monetary history');
END;

CREATE TRIGGER ledger_revision_recurring_transfer_rules_insert
AFTER INSERT ON recurring_transfer_rules
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_recurring_transfer_rules_update
AFTER UPDATE ON recurring_transfer_rules
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_recurring_transfer_rules_delete
AFTER DELETE ON recurring_transfer_rules
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

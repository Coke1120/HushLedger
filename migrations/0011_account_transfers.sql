PRAGMA foreign_keys = ON;

-- Transfers are one atomic movement between two accounts. Keeping them outside
-- income/expense transactions prevents internal money movement from inflating
-- monthly reports while preserving both bank-posting review states.
CREATE TABLE account_transfers (
  id TEXT PRIMARY KEY CHECK(
    length(id) = 36
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
  ),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency = 'HKD'),
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

CREATE INDEX idx_account_transfers_occurred_on
  ON account_transfers(occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_account_transfers_from_account
  ON account_transfers(from_account_id, occurred_on DESC, id DESC);
CREATE INDEX idx_account_transfers_to_account
  ON account_transfers(to_account_id, occurred_on DESC, id DESC);

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

PRAGMA foreign_keys = ON;

-- One optional checkpoint compares a user-chosen target with the recorded
-- balance of one account. It does not reserve funds or automate transfers.
CREATE TABLE emergency_fund_goals (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  target_minor INTEGER NOT NULL CHECK(target_minor BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

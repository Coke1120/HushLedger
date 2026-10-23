PRAGMA foreign_keys = ON;

-- Operational receipts contain identifiers/versions only, never pasted text or secrets.
-- Receipts survive undo/deletion so retries cannot recreate transactions.
CREATE TABLE paste_operations (
  id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'approved' CHECK(state IN ('approved', 'undone', 'invalidated')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  undone_at TEXT
);
CREATE TABLE paste_operation_items (
  operation_id TEXT NOT NULL REFERENCES paste_operations(id),
  transaction_id TEXT NOT NULL,
  approved_version TEXT NOT NULL,
  PRIMARY KEY(operation_id, transaction_id)
);
CREATE TABLE transaction_approvals (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  approved_version TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Only explicitly reviewed legacy imports qualify; manual/unreviewed rows do not.
INSERT INTO transaction_approvals(transaction_id, approved_version)
SELECT id, updated_at FROM transactions WHERE import_review_status = 'reviewed';

CREATE TRIGGER invalidate_transaction_approval AFTER UPDATE ON transactions
BEGIN
  DELETE FROM transaction_approvals WHERE transaction_id = NEW.id;
END;
CREATE TRIGGER ledger_revision_transaction_approvals_insert
AFTER INSERT ON transaction_approvals
BEGIN
  UPDATE ledger_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER ledger_revision_transaction_approvals_delete
AFTER DELETE ON transaction_approvals
BEGIN
  UPDATE ledger_state SET revision = revision + 1 WHERE id = 1;
END;

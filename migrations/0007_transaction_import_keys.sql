PRAGMA foreign_keys = ON;

CREATE TABLE transaction_import_keys (
  import_key TEXT PRIMARY KEY CHECK(length(import_key) BETWEEN 20 AND 160),
  transaction_id TEXT NOT NULL CHECK(
    length(transaction_id) = 36
    AND substr(transaction_id, 9, 1) = '-'
    AND substr(transaction_id, 14, 1) = '-'
    AND substr(transaction_id, 19, 1) = '-'
    AND substr(transaction_id, 24, 1) = '-'
  ),
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Deliberately no foreign key: an import key is a tombstone and must survive
-- deletion of the transaction so the same source row is not silently restored.
CREATE INDEX idx_transaction_import_keys_transaction
  ON transaction_import_keys(transaction_id, imported_at);

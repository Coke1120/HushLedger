PRAGMA foreign_keys = ON;

ALTER TABLE transactions ADD COLUMN import_review_status TEXT CHECK(
  import_review_status IS NULL
  OR import_review_status IN ('unreviewed', 'reviewed', 'needs_follow_up')
);

UPDATE transactions
SET import_review_status = 'unreviewed'
WHERE EXISTS (
  SELECT 1
  FROM transaction_import_keys
  WHERE transaction_import_keys.transaction_id = transactions.id
);

CREATE INDEX idx_transactions_import_review_status
  ON transactions(import_review_status, occurred_on DESC, created_at DESC, id DESC)
  WHERE import_review_status IS NOT NULL;

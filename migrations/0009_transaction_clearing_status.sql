PRAGMA foreign_keys = ON;

-- Existing ledgers predate clearing status. Preserve their trusted history as
-- cleared, while application-created transactions explicitly choose a state.
ALTER TABLE transactions
ADD COLUMN cleared INTEGER NOT NULL DEFAULT 1 CHECK(cleared IN (0, 1));

CREATE INDEX idx_transactions_cleared_occurred_on
ON transactions(cleared, occurred_on DESC, id DESC);

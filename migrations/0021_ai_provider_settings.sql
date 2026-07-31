PRAGMA foreign_keys = ON;

-- AI provider connection settings persisted in D1 so they survive page refresh.
-- Deliberately single-row (id = 1) and deliberately excluded from ledger backup/restore.
-- The API key is encrypted with an operator-managed Worker secret before it reaches D1.
-- No ledger_revision trigger because this is configuration, not ledger data.
CREATE TABLE ai_provider_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
  api_key_ciphertext BLOB NOT NULL CHECK(length(api_key_ciphertext) > 16),
  api_key_iv BLOB NOT NULL CHECK(length(api_key_iv) = 12),
  encryption_key_version INTEGER NOT NULL CHECK(encryption_key_version = 1),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

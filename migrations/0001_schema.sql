PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('expense','income')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(name,type));
CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('expense','income')), amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), account_id INTEGER NOT NULL REFERENCES accounts(id), category_id INTEGER NOT NULL REFERENCES categories(id), occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);

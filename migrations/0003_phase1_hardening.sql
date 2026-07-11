PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_transactions_occurred_at;

ALTER TABLE transactions RENAME TO transactions_legacy;
ALTER TABLE accounts RENAME TO accounts_legacy;
ALTER TABLE categories RENAME TO categories_legacy;

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK(type IN ('cash', 'bank', 'credit_card', 'wallet')),
  currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency = 'HKD'),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  icon TEXT NOT NULL DEFAULT 'circle-ellipsis' CHECK(length(trim(icon)) BETWEEN 1 AND 48),
  color TEXT NOT NULL DEFAULT '#64748B' CHECK(length(color) = 7 AND substr(color, 1, 1) = '#'),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(name, type)
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
  currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency = 'HKD'),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL CHECK(
    length(occurred_at) = 24
    AND substr(occurred_at, 5, 1) = '-'
    AND substr(occurred_at, 8, 1) = '-'
    AND substr(occurred_at, 11, 1) = 'T'
    AND substr(occurred_at, 14, 1) = ':'
    AND substr(occurred_at, 17, 1) = ':'
    AND substr(occurred_at, 20, 1) = '.'
    AND substr(occurred_at, 24, 1) = 'Z'
  ),
  payee TEXT NOT NULL DEFAULT '' CHECK(length(payee) <= 80),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO accounts(id, name, type, currency, is_active, sort_order, created_at, updated_at)
SELECT
  id,
  name,
  CASE name
    WHEN '現金' THEN 'cash'
    WHEN '信用卡' THEN 'credit_card'
    ELSE 'bank'
  END,
  'HKD',
  1,
  id * 10,
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM accounts_legacy;

INSERT INTO categories(id, name, type, icon, color, is_active, sort_order, created_at, updated_at)
SELECT
  id,
  name,
  type,
  CASE name
    WHEN '薪資' THEN 'banknote'
    WHEN '其他收入' THEN 'circle-dollar-sign'
    WHEN '餐飲' THEN 'utensils'
    WHEN '交通' THEN 'train'
    WHEN '生活' THEN 'shopping-bag'
    WHEN '娛樂' THEN 'gamepad-2'
    ELSE 'circle-ellipsis'
  END,
  CASE name
    WHEN '薪資' THEN '#2F766D'
    WHEN '其他收入' THEN '#5B7C6F'
    WHEN '餐飲' THEN '#C16B4B'
    WHEN '交通' THEN '#4C72A4'
    WHEN '生活' THEN '#9A6AA6'
    WHEN '娛樂' THEN '#B07A3E'
    ELSE '#64748B'
  END,
  1,
  id * 10,
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM categories_legacy;

INSERT INTO transactions(
  id,
  type,
  amount_minor,
  currency,
  account_id,
  category_id,
  occurred_at,
  payee,
  note,
  created_at,
  updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-'
    || lower(hex(randomblob(2))) || '-4'
    || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', (random() & 3) + 1, 1)
    || substr(lower(hex(randomblob(2))), 2) || '-'
    || lower(hex(randomblob(6))),
  type,
  amount_minor,
  'HKD',
  account_id,
  category_id,
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  '',
  note,
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM transactions_legacy;

DROP TABLE transactions_legacy;
DROP TABLE categories_legacy;
DROP TABLE accounts_legacy;

INSERT OR IGNORE INTO accounts(name, type, currency, is_active, sort_order)
VALUES ('八達通', 'wallet', 'HKD', 1, 40);

INSERT OR IGNORE INTO categories(name, type, icon, color, is_active, sort_order)
VALUES
  ('購物', 'expense', 'shopping-bag', '#9A6AA6', 1, 50),
  ('住屋', 'expense', 'house', '#627D56', 1, 60),
  ('帳單', 'expense', 'receipt-text', '#6D718C', 1, 70),
  ('醫療', 'expense', 'heart-pulse', '#A65F68', 1, 80),
  ('其他支出', 'expense', 'circle-ellipsis', '#64748B', 1, 90);

CREATE INDEX idx_accounts_active_sort ON accounts(is_active, sort_order, id);
CREATE INDEX idx_categories_type_active_sort ON categories(type, is_active, sort_order, id);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at DESC, id DESC);
CREATE INDEX idx_transactions_type_occurred_at ON transactions(type, occurred_at DESC, id DESC);
CREATE INDEX idx_transactions_account_occurred_at ON transactions(account_id, occurred_at DESC);
CREATE INDEX idx_transactions_category_occurred_at ON transactions(category_id, occurred_at DESC);

PRAGMA foreign_keys = ON;

ALTER TABLE accounts ADD COLUMN localization_key TEXT CHECK(
  localization_key IS NULL
  OR (
    length(localization_key) BETWEEN 3 AND 64
    AND localization_key = lower(localization_key)
    AND localization_key GLOB 'account.[a-z_]*'
  )
);

ALTER TABLE categories ADD COLUMN localization_key TEXT CHECK(
  localization_key IS NULL
  OR (
    length(localization_key) BETWEEN 3 AND 64
    AND localization_key = lower(localization_key)
    AND localization_key GLOB 'category.[a-z_]*'
  )
);

UPDATE accounts
SET localization_key = CASE name
  WHEN '日常帳戶' THEN 'account.bank'
  WHEN '現金' THEN 'account.cash'
  WHEN '信用卡' THEN 'account.credit_card'
  WHEN '八達通' THEN 'account.wallet'
END
WHERE name IN ('日常帳戶', '現金', '信用卡', '八達通');

UPDATE categories
SET localization_key = CASE name
  WHEN '薪資' THEN 'category.salary'
  WHEN '其他收入' THEN 'category.other_income'
  WHEN '餐飲' THEN 'category.food'
  WHEN '交通' THEN 'category.transport'
  WHEN '生活' THEN 'category.living'
  WHEN '娛樂' THEN 'category.entertainment'
  WHEN '購物' THEN 'category.shopping'
  WHEN '住屋' THEN 'category.housing'
  WHEN '帳單' THEN 'category.bills'
  WHEN '醫療' THEN 'category.healthcare'
  WHEN '其他支出' THEN 'category.other_expense'
END
WHERE type = CASE name
  WHEN '薪資' THEN 'income'
  WHEN '其他收入' THEN 'income'
  ELSE 'expense'
END
AND name IN (
  '薪資',
  '其他收入',
  '餐飲',
  '交通',
  '生活',
  '娛樂',
  '購物',
  '住屋',
  '帳單',
  '醫療',
  '其他支出'
);

CREATE UNIQUE INDEX idx_accounts_localization_key
  ON accounts(localization_key)
  WHERE localization_key IS NOT NULL;

CREATE UNIQUE INDEX idx_categories_localization_key
  ON categories(localization_key)
  WHERE localization_key IS NOT NULL;

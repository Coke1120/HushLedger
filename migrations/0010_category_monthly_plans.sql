PRAGMA foreign_keys = ON;

-- A plan is an optional monthly spending guardrail, not reserved cash. Income
-- categories cannot carry one, and existing ledgers remain unplanned.
ALTER TABLE categories
ADD COLUMN monthly_plan_minor INTEGER
CHECK(
  monthly_plan_minor IS NULL
  OR (
    type = 'expense'
    AND monthly_plan_minor > 0
    AND monthly_plan_minor <= 9007199254740991
  )
);

CREATE INDEX idx_categories_active_monthly_plan
ON categories(is_active, type, sort_order, id)
WHERE monthly_plan_minor IS NOT NULL;

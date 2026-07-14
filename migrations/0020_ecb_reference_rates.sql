-- Explicitly fetched ECB reference data is deliberately separate from money.
-- A row records an immutable EUR-base observation; it never relabels or converts
-- ledger amounts, and a duplicate observation cannot silently overwrite history.
CREATE TABLE ecb_reference_rates (
  source TEXT NOT NULL DEFAULT 'ecb' CHECK(source = 'ecb'),
  base_currency TEXT NOT NULL DEFAULT 'EUR' CHECK(base_currency = 'EUR'),
  quote_currency TEXT NOT NULL CHECK(quote_currency IN (
    'AED', 'AUD', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'ILS',
    'INR', 'MOP', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'QAR', 'SAR',
    'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'USD', 'ZAR'
  )),
  observed_on TEXT NOT NULL CHECK(
    observed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(observed_on) IS NOT NULL
    AND date(observed_on) = observed_on
  ),
  rate TEXT NOT NULL CHECK(
    rate GLOB '[0-9]*'
    AND rate NOT GLOB '*[^0-9.]*'
    AND rate NOT GLOB '.*'
    AND rate NOT GLOB '*.*.*'
    AND rate NOT GLOB '*.'
    AND CAST(rate AS REAL) > 0
  ),
  fetched_at TEXT NOT NULL CHECK(substr(fetched_at, -1) = 'Z'),
  PRIMARY KEY(source, quote_currency, observed_on)
);

CREATE INDEX idx_ecb_reference_rates_observed_on
  ON ecb_reference_rates(observed_on DESC, quote_currency ASC);

-- ECB observations participate in backup digests, so each mutation must make
-- any already-previewed restore stale before it can replace the snapshot.
CREATE TRIGGER ledger_revision_ecb_reference_rates_insert
AFTER INSERT ON ecb_reference_rates
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_ecb_reference_rates_update
AFTER UPDATE ON ecb_reference_rates
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

CREATE TRIGGER ledger_revision_ecb_reference_rates_delete
AFTER DELETE ON ecb_reference_rates
BEGIN
  UPDATE ledger_state
  SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 1;
END;

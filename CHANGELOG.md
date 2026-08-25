# Changelog

Notable changes and required deployment steps are recorded here. Release tags
remain the source of truth for published artifacts.

## Unreleased

### Added

- Native currencies for individual accounts without mixing them into reporting-currency totals.
- Opt-in ECB reference-rate observations for future display-only reporting features.
- Encrypted, persisted AI provider settings with conflict-safe updates.
- Pasted-statement preview, reconciliation, transfer recognition, and durable import deduplication.

### Changed

- Reworked transaction-import entry points and dense desktop review workflows.
- Kept failed or offline ledger snapshots read-only instead of enabling demo mutations.
- Restored the complete CI verification and dependency-audit gate.

### Upgrade notes

- Back up the ledger before upgrading.
- Apply D1 migrations `0019_multi_currency_accounts.sql`,
  `0020_ecb_reference_rates.sql`, and `0021_ai_provider_settings.sql` in order.
- Configure `AI_SETTINGS_ENCRYPTION_KEY_V1` before storing an AI provider API key.

## [0.1.0-beta.2] - 2026-07-14

- Established the verified beta milestone and repeatable release artifacts.
- Includes D1 migrations through `0018_import_review_status.sql`.
- See the [beta.2 release notes](https://github.com/Coke1120/HushLedger/releases/tag/v0.1.0-beta.2).

## [0.1.0-beta.1] - 2026-07-12

- First public beta, including the Cloudflare Workers/D1 deployment path and
  local single-user workflow.
- See the [beta.1 release notes](https://github.com/Coke1120/HushLedger/releases/tag/v0.1.0-beta.1).

[0.1.0-beta.2]: https://github.com/Coke1120/HushLedger/compare/v0.1.0-beta.1...v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/Coke1120/HushLedger/releases/tag/v0.1.0-beta.1

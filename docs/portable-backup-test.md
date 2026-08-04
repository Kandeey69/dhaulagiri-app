# Portable Backup Test

Date: 2026-08-03

## Scope

This validates portable company backup and restore by code inspection. Browser/Tauri file picker flows were not manually executed.

## Current Design

- Portable backups are JSON files with `kind: "easysolution-company-backup"`.
- Current export writes `version: 2`.
- Version 2 includes company, accounts, purchase, and stock sections.
- Version 1 restore remains accepted for backups without stock data.
- Version 2 restore rejects a backup missing the stock section.
- Stock restore validates duplicate item codes, invalid item records, duplicate purchase source identities, duplicate sales identities, and invalid line records before replacement.

## Code Paths Inspected

- `downloadPortableCompanyBackup` exports accounts, purchase, and company-scoped stock data.
- `importPortableCompanyBackup` validates version and restores company-scoped data.
- `replaceStockBackupDataForCompany` validates and replaces stock data inside the target company stock database.
- `docs/stock-backup-strategy.md` documents why raw SQLite file copying is intentionally not the supported backup method.

## Result

Code inspection passed for v2 stock inclusion and v1 compatibility behavior.

Live export/import through the desktop window was not executed in this environment.

## Manual Follow-Up Required

- Export a backup from a company with stock data.
- Restore that file into a fresh app profile.
- Verify sales, purchase, ledger, payment allocation, and stock values after restore.
- Restore a legacy v1 backup and verify it imports without stock.
- Attempt a malformed v2 backup without stock and confirm the UI reports a clear error.

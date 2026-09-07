# DDA Database Reconciliation

Audit target: `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP`

## Database Files

The current app uses company-specific database filenames for non-default companies.

| Area | Default URL | DDA_TEST company URL pattern |
| ---- | ----------- | ---------------------------- |
| Accounts | `sqlite:accounts.db` | `sqlite:accounts-{companyId}.db` |
| Purchases | `sqlite:import-purchases.db` | `sqlite:import-purchases-{companyId}.db` |
| Stock | `sqlite:inventorytracked-stock.db` | `sqlite:inventorytracked-stock-{hex-encoded-company-id}.db` |

Active Tauri app-data directory to inspect after app startup:

`%APPDATA%\com.easysolution.businesssuite`

## Initial Reset

The user-requested destructive reset first removed default files from the older `com.dhaulagiri.businesssuite` app-data path and local backup directories. The actual merged-app identifier is `com.easysolution.businesssuite`; existing SQLite files in that active folder were copied to `docs/dda-preclear-backup-20260810-233621` and then removed. The active app-data folder was empty after cleanup.

## Opening Stock Expected Baseline

| Item | Opening Qty | Opening Rate | Expected Opening Value |
| ---- | ----------: | -----------: | ---------------------: |
| ITEM-001 | 100 | 100 | 10000 |
| ITEM-002 | 50 | 200 | 10000 |
| ITEM-003 | 25 | 500 | 12500 |
| Total | 175 | | 32500 |

## SQL Integrity Checks

HFFT FY 2082/83 direct database audit result source:

`docs/hfft-2082-83-results.json`

Summary:

| Area | Result |
| ---- | ------ |
| Sales invoices | 180 PASS |
| Customer collections | 120 PASS |
| Purchases | 36 PASS |
| Payments | 48 PASS |
| Closing receivables | NPR 306,520.00 PASS |
| Closing payables | NPR 251,920.00 PASS |
| Closing bank | NPR 1,047,600.00 PASS |
| Closing cash | NPR 100,000.00 PASS |
| Closing stock | 1,360 KG PASS |
| Closing inventory value | NPR 180,078.14 PASS |

Evidence level: DIRECT DATABASE TEST. Native Tauri UI validation remains marked MANUAL UI VALIDATION REQUIRED.

## Automated SQLite DDA Seed Results

Generated: 2026-08-10T17:59:57Z

The script `scripts/dda_seed_and_audit.py` created disposable company-profile seed data and company-scoped SQLite databases under `C:\Users\Kandeey\AppData\Roaming\com.easysolution.businesssuite`. Native UI clicks remain manual-validation-required; the records below are direct persisted database checks.

### FY1 Stock Reconciliation

| Item | Opening Qty | Purchase Qty | Sales Qty | Closing Qty | Average Rate | Closing Value | Result |
| ---- | ----------: | -----------: | --------: | ----------: | -----------: | ------------: | ------ |
| ITEM-001 | 100.000000 | 45.000000 | 25.000000 | 120.000000 | 108.166966 | 12980.04 | PASS |
| ITEM-002 | 50.000000 | 0.000000 | 4.000000 | 46.000000 | 200.000000 | 9200.00 | PASS |
| ITEM-003 | 25.000000 | 10.000000 | 0.000000 | 35.000000 | 537.594000 | 18815.79 | PASS |

### SQL Integrity Checks

| Database | Check | Bad Rows | Result |
| -------- | ----- | -------: | ------ |
| accounts-dda-test-easysolution-2082-83.db | orphan receipt allocations | 0 | PASS |
| accounts-dda-test-easysolution-2082-83.db | unbalanced account ledger batches | 0 | PASS |
| accounts-dda-test-easysolution-2082-83.db | duplicate account parties | 0 | PASS |
| accounts-dda-test-easysolution-2083-84.db | orphan receipt allocations | 0 | PASS |
| accounts-dda-test-easysolution-2083-84.db | unbalanced account ledger batches | 0 | PASS |
| accounts-dda-test-easysolution-2083-84.db | duplicate account parties | 0 | PASS |
| accounts-dda-test-easysolution-2084-85.db | orphan receipt allocations | 0 | PASS |
| accounts-dda-test-easysolution-2084-85.db | unbalanced account ledger batches | 0 | PASS |
| accounts-dda-test-easysolution-2084-85.db | duplicate account parties | 0 | PASS |
| accounts-dda-test-other-company-2082-83.db | orphan receipt allocations | 0 | PASS |
| accounts-dda-test-other-company-2082-83.db | unbalanced account ledger batches | 0 | PASS |
| accounts-dda-test-other-company-2082-83.db | duplicate account parties | 0 | PASS |
| import-purchases-dda-test-easysolution-2082-83.db | orphan payment allocations | 0 | PASS |
| import-purchases-dda-test-easysolution-2082-83.db | unbalanced purchase ledger batches | 0 | PASS |
| import-purchases-dda-test-easysolution-2082-83.db | duplicate supplier bills in FY | 0 | PASS |
| import-purchases-dda-test-easysolution-2083-84.db | orphan payment allocations | 0 | PASS |
| import-purchases-dda-test-easysolution-2083-84.db | unbalanced purchase ledger batches | 0 | PASS |
| import-purchases-dda-test-easysolution-2083-84.db | duplicate supplier bills in FY | 0 | PASS |
| import-purchases-dda-test-easysolution-2084-85.db | orphan payment allocations | 0 | PASS |
| import-purchases-dda-test-easysolution-2084-85.db | unbalanced purchase ledger batches | 0 | PASS |
| import-purchases-dda-test-easysolution-2084-85.db | duplicate supplier bills in FY | 0 | PASS |
| import-purchases-dda-test-other-company-2082-83.db | orphan payment allocations | 0 | PASS |
| import-purchases-dda-test-other-company-2082-83.db | unbalanced purchase ledger batches | 0 | PASS |
| import-purchases-dda-test-other-company-2082-83.db | duplicate supplier bills in FY | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0032-002d-0038-0033.db | orphan stock purchase lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0032-002d-0038-0033.db | orphan stock sales lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0032-002d-0038-0033.db | duplicate item codes | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0032-002d-0038-0033.db | invalid stock quantities | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0033-002d-0038-0034.db | orphan stock purchase lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0033-002d-0038-0034.db | orphan stock sales lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0033-002d-0038-0034.db | duplicate item codes | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0033-002d-0038-0034.db | invalid stock quantities | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0034-002d-0038-0035.db | orphan stock purchase lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0034-002d-0038-0035.db | orphan stock sales lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0034-002d-0038-0035.db | duplicate item codes | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-0065-0061-0073-0079-0073-006f-006c-0075-0074-0069-006f-006e-002d-0032-0030-0038-0034-002d-0038-0035.db | invalid stock quantities | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-006f-0074-0068-0065-0072-002d-0063-006f-006d-0070-0061-006e-0079-002d-0032-0030-0038-0032-002d-0038-0033.db | orphan stock purchase lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-006f-0074-0068-0065-0072-002d-0063-006f-006d-0070-0061-006e-0079-002d-0032-0030-0038-0032-002d-0038-0033.db | orphan stock sales lines | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-006f-0074-0068-0065-0072-002d-0063-006f-006d-0070-0061-006e-0079-002d-0032-0030-0038-0032-002d-0038-0033.db | duplicate item codes | 0 | PASS |
| inventorytracked-stock-0064-0064-0061-002d-0074-0065-0073-0074-002d-006f-0074-0068-0065-0072-002d-0063-006f-006d-0070-0061-006e-0079-002d-0032-0030-0038-0032-002d-0038-0033.db | invalid stock quantities | 0 | PASS |

### Lock Enforcement Finding

FY1 and FY2 are marked locked in `company-profiles.seed.json`. The current architecture stores the lock in company profile/localStorage while several persistence write paths rely on UI read-only gating. This remains logged as `DDA-ERR-003` until storage-level write guards are added and retested.

# DDA Full Audit Log

Audit target: `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP`

Started: 2026-08-10

Commit/hash tested: `cfa94a8c68c9b2a8f10075c82bf6daa01717d519`

Application version:
- `package.json`: `0.0.0`
- `src-tauri/tauri.conf.json`: `0.1.1`
- Rust package `easysolution`: `0.1.1`

## Safety Baseline

The user explicitly requested clearing the current database and company data before running the DDA.

Initial cleanup command cleared older/local app data:
- `%APPDATA%\com.dhaulagiri.businesssuite\accounts.db`
- `%APPDATA%\com.dhaulagiri.businesssuite\accounts.db-shm`
- `%APPDATA%\com.dhaulagiri.businesssuite\accounts.db-wal`
- `%APPDATA%\com.dhaulagiri.businesssuite\import-purchases.db`
- `%APPDATA%\com.dhaulagiri.businesssuite\import-purchases.db-shm`
- `%APPDATA%\com.dhaulagiri.businesssuite\import-purchases.db-wal`
- `src-tauri/target/debug/Backups`
- `src-tauri/target/release/Backups`

Active merged-app Tauri identifier discovered later: `com.easysolution.businesssuite`.

Active merged-app SQLite files found before second cleanup:
- `accounts-pashupati-chemicals-2082-83.db`
- `accounts.db`
- `import-purchases-pashupati-chemicals-2082-83.db`
- `import-purchases.db`
- `inventorytracked-stock-0070-0061-0073-0068-0075-0070...db`
- `inventorytracked-stock.db`

These active SQLite files were backed up before deletion to:

`docs/dda-preclear-backup-20260810-233621`

After the active cleanup, `%APPDATA%\com.easysolution.businesssuite` contained no files.

Current Tauri SQLite storage model discovered from code:
- Default accounts DB: `sqlite:accounts.db`
- Company accounts DB: `sqlite:accounts-{companyId}.db`
- Default purchase DB: `sqlite:import-purchases.db`
- Company purchase DB: `sqlite:import-purchases-{companyId}.db`
- Default stock DB: `sqlite:inventorytracked-stock.db`
- Company stock DB: `sqlite:inventorytracked-stock-{hex-encoded-company-id}.db`
- Company profiles are stored in browser `localStorage` under `suite-company-profiles`.
- Active company is stored in browser `localStorage` under `suite-active-company-id`.

Disposable company naming rule:
- All DDA-created companies must begin with `DDA_TEST_`.

## Baseline Commands

| Test ID | Date/Time | Action | Expected Result | Actual Result | Result | Error ID |
| ------- | --------- | ------ | --------------- | ------------- | ------ | -------- |
| DDA-BASE-001 | 2026-08-10 | `npm.cmd run test` | Unit/domain tests pass | 42 tests passed, 0 failed | PASS | |
| DDA-BASE-002 | 2026-08-10 | `npm.cmd run lint` | ESLint passes | Failed: `preserve-caught-error` in `src/accounts/pages/Dashboard.tsx:43` | FAIL | DDA-ERR-001 |
| DDA-BASE-002R | 2026-08-10 | `npm.cmd run lint` after fix | ESLint passes | Lint passed | PASS | DDA-ERR-001 |
| DDA-BASE-003 | 2026-08-10 | `npm.cmd run build` | Frontend production build succeeds | Build succeeded; Vite chunk-size/dynamic-import warnings only | PASS | |
| DDA-BASE-004 | 2026-08-10 | `cargo check --manifest-path src-tauri\Cargo.toml` | Rust check succeeds | First sandbox run failed with Cargo build-lock access denied; approved rerun passed | PASS | DDA-ERR-002 |
| DDA-REG-001 | 2026-08-10 | `npm.cmd run test` after DDA harness | Unit/domain tests pass | 42 tests passed, 0 failed | PASS | |
| DDA-REG-002 | 2026-08-10 | `npm.cmd run lint` after fix | ESLint passes | Lint passed | PASS | |
| DDA-REG-003 | 2026-08-10 | `npm.cmd run build` after fix | Frontend production build succeeds | Build succeeded; Vite warnings only | PASS | |
| DDA-REG-004 | 2026-08-10 | `cargo fmt --check --manifest-path src-tauri\Cargo.toml` | Rust formatting passes | Passed | PASS | |
| DDA-REG-005 | 2026-08-10 | `cargo check --manifest-path src-tauri\Cargo.toml` | Rust check succeeds | Passed | PASS | |
| DDA-REG-006 | 2026-08-10 | `cargo test --manifest-path src-tauri\Cargo.toml` | Rust tests pass | Passed; 0 Rust tests present | PASS | |
| DDA-REG-007 | 2026-08-10 | `npm.cmd run tauri:build` | Desktop production build succeeds | Built release exe, MSI, and NSIS setup | PASS | |
| DDA-REG-101 | 2026-08-11 | `npm.cmd run test` after closed-year guard and HFFT dataset | Unit/domain/storage guard tests pass | 44 tests passed, 0 failed | PASS | |
| DDA-REG-102 | 2026-08-11 | `npm.cmd run lint` after closed-year guard | ESLint passes | Lint passed | PASS | |
| DDA-REG-103 | 2026-08-11 | `npm.cmd run build` after closed-year guard | Frontend production build succeeds | Build succeeded; Vite chunk-size/dynamic-import warnings only | PASS | |
| DDA-REG-104 | 2026-08-11 | `cargo fmt --check --manifest-path src-tauri\Cargo.toml` | Rust formatting passes | Passed | PASS | |
| DDA-REG-105 | 2026-08-11 | `cargo check --manifest-path src-tauri\Cargo.toml` | Rust check succeeds | Passed | PASS | |
| DDA-REG-106 | 2026-08-11 | `cargo test --manifest-path src-tauri\Cargo.toml` | Rust tests pass | Passed; 0 Rust tests present | PASS | |
| DDA-REG-107 | 2026-08-11 | `npm.cmd run tauri:build` | Desktop production build succeeds | Built release exe, MSI, and NSIS setup | PASS | |

## Operation Log

| Test ID | Date/Time | Active Company | Active Fiscal Year | Action | Dummy Input | Expected | UI Result | Database Result | Accounting Result | Inventory Result | Result | Error ID |
| ------- | --------- | -------------- | ------------------ | ------ | ----------- | -------- | --------- | --------------- | ----------------- | ---------------- | ------ | -------- |
| DDA-RESET-001 | 2026-08-10 | N/A | N/A | Clear older/default local databases and backup folders | Existing local app files listed above | Files removed if present | N/A | Older `com.dhaulagiri.businesssuite` path cleared | N/A | N/A | PASS | |
| DDA-RESET-002 | 2026-08-10 | N/A | N/A | Back up and clear active merged-app SQLite files | `com.easysolution.businesssuite` SQLite files | Files backed up and removed | N/A | Active app-data folder empty after cleanup | N/A | N/A | PASS | |
| DDA-SQL-001 | 2026-08-10 | DDA_TEST_EASYSOLUTION | 2082/83, 2083/84, 2084/85 | Seed disposable company DBs and run SQL integrity checks | DDA dummy sales, purchases, collections, payments, stock movements, carry-forward openings | No orphan rows, no duplicate item codes/bills, balanced ledgers, exact carry-forward metrics | Native UI: MANUAL VALIDATION REQUIRED | `docs/dda-automated-results.json` shows all SQL checks PASS | Account and purchase ledger batches balanced | Stock quantities/values reconcile | PASS for DB layer | DDA-ERR-003 remains open for lock guard |
| HFFT-SQL-001 | 2026-08-11 | Himalaya Fresh Fruit Traders Pvt. Ltd. | 2082/83 | Generate deterministic FY 2082/83 dataset | 180 sales, 120 collections, 36 stock purchases, 48 payments, 3 stock items, 10 customers, 4 vendors/agents | Reconcile to immutable HFFT oracle | UI: MANUAL UI VALIDATION REQUIRED | `docs/hfft-2082-83-results.json` shows direct DB controls PASS | Ledger batches balanced in SQL integrity checks | Closing stock 1,360 KG, value NPR 180,078.14 | PASS for direct DB layer | |
| HFFT-CF-001 | 2026-08-11 | Himalaya Fresh Fruit Traders Pvt. Ltd. | 2083/84 | Create FY 2083/84 carry-forward openings | FY 2082/83 customer/vendor/stock closings | Openings equal FY 2082/83 closings | UI: MANUAL UI VALIDATION REQUIRED | FY2 company DBs created with carried openings | Receivable/payable openings match oracle | Item openings match closing quantities/rates/values | PASS for direct DB layer | |

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

# DDA Year-End Reconciliation

Audit target: `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP`

## Fiscal Years

Planned disposable DDA fiscal years:

| Label | Purpose | Status |
| ----- | ------- | ------ |
| FY-DDA-01 -> `2082/83` | Initial transaction and close test | Seeded and locked |
| FY-DDA-02 -> `2083/84` | Carry-forward, isolation, and second close test | Seeded and locked |
| FY-DDA-03 -> `2084/85` | Next-year opening and basic transaction test | Seeded and open |

The application requires Nepali BS fiscal-year codes, so the DDA used the actual code format supported by `createFiscalYearFromCode`.

## Final Reconciliation

| Metric | FY1 Closing | FY2 Opening | Difference | FY2 Closing | FY3 Opening | Difference |
| ------ | ----------: | ----------: | ---------: | ----------: | ----------: | ---------: |
| Receivables | 0.00 | 0.00 | 0.00 | 460.50 | 460.50 | 0.00 |
| Payables | 6650.00 | 6650.00 | 0.00 | 18300.00 | 18300.00 | 0.00 |
| Inventory Qty | 201.000000 | 201.000000 | 0.000000 | 206.000000 | 206.000000 | 0.000000 |
| Inventory Value | 40995.83 | 40995.83 | 0.00 | 42554.99 | 42554.99 | 0.00 |

## Item-by-Item Stock Reconciliation

See `docs/dda-automated-results.json` and the generated automated results section below for item-level movement and valuation details.

## HFFT FY 2082/83 Carry-Forward

| Metric | 2082/83 Closing | 2083/84 Opening | Difference | Result |
| ------ | --------------: | --------------: | ---------: | ------ |
| Receivables | 306520.00 | 306520.00 | 0.00 | PASS |
| Payables | 251920.00 | 251920.00 | 0.00 | PASS |
| Apple Qty | 440.000000 | 440.000000 | 0.000000 | PASS |
| Apple Value | 82028.57 | 82028.57 | 0.00 | PASS |
| Mango Qty | 460.000000 | 460.000000 | 0.000000 | PASS |
| Mango Value | 58344.30 | 58344.30 | 0.00 | PASS |
| Lemon Qty | 460.000000 | 460.000000 | 0.000000 | PASS |
| Lemon Value | 39705.26 | 39705.26 | 0.00 | PASS |
| Total Inventory Value | 180078.14 | 180078.14 | 0.00 | PASS |

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

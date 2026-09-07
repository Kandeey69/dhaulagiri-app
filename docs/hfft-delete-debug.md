# HFFT Delete Debug

Updated: 2026-08-11

Scope: `HFFT-UI-ERR-005` only. No reseed, no FY2082/83 oracle mutation, no backup/workbook/installer work.

## Pre-Fix Baseline

| Item | Value |
|---|---|
| Accounts DB URL | `sqlite:accounts-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |
| Accounts DB path | `C:\Users\Kandeey\AppData\Roaming\com.easysolution.businesssuite\accounts-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |
| Purchase DB path | `C:\Users\Kandeey\AppData\Roaming\com.easysolution.businesssuite\import-purchases-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |
| Stock DB URL | `sqlite:inventorytracked-stock-himalaya-fresh-fruit-traders-pvt-defc9179629d84d5.db` |
| Stock DB path | `C:\Users\Kandeey\AppData\Roaming\com.easysolution.businesssuite\inventorytracked-stock-himalaya-fresh-fruit-traders-pvt-defc9179629d84d5.db` |
| FY2083/84 sales | 0 |
| FY2083/84 collections | 0 |
| FY2083/84 accounts ledger entries | 0 |
| FY2083/84 receivables | NPR 306,520 |
| FY2083/84 import purchases | 0 |
| FY2083/84 local purchases | 0 |
| FY2083/84 payments | 0 |
| FY2083/84 payables | NPR 251,920 |
| FY2083/84 Apple | 440 KG, avg NPR 186.428571, value NPR 82,028.57 |
| FY2083/84 Mango | 460 KG, avg NPR 126.835443, value NPR 58,344.30 |
| FY2083/84 Lemon | 460 KG, avg NPR 86.315789, value NPR 39,705.26 |
| FY2083/84 stock sales bills/lines | 0 / 0 |

Existing failure evidence preserved in `docs/hfft-ui-error-log.md` as `HFFT-UI-ERR-005`.

## Observed Failure From Prior Live Run

| Step | Result |
|---|---:|
| Create FY2083/84 temporary sale bill `900001` | PASS |
| Add Apple stock allocation 5 KG | PASS |
| Edit sale to NPR 1,820 | PASS |
| Edit stock line to Apple 7 KG | PASS |
| Delete sale through Sales UI | FAIL |
| Confirmation accepted | YES |
| Row disappeared | NO |
| Accounts DB unlocked while Tauri remained open | NO |
| Direct SQL cleanup needed | YES, after stopping Tauri |
| Final FY2082/83 oracle after cleanup | PASS |

## Delete Call Graph

Actual code path:

1. `src/accounts/pages/Sales.tsx` row Delete button calls `handleDeleteSale(sale)`.
2. `handleDeleteSale` checks `canManage`.
3. Browser confirmation is shown and accepted.
4. `handleDeleteSale` awaits `deleteSale(sale.id)` from `src/accounts/data/storage.ts`.
5. `deleteSale` runs `assertActiveCompanyWritable()` before opening a transaction.
6. `deleteSale` resolves the active accounts DB via `getDb()` -> `getActiveAccountsDatabaseUrl()`.
7. `deleteSale` calls `runDbTransaction(db, work)`.
8. Accounts transaction work deletes `receipt_allocations` by `sale_id`, deletes `ledger_entries` where source is `SALE`, then deletes the `sales` row.
9. After the transaction returns, `deleteSale` writes best-effort activity log via `logActivity`.
10. `handleDeleteSale` optimistically filters the sale from React state and stock bill state.
11. If inventory tracking is enabled, `handleDeleteSale` calls `deleteStockSalesLinesForDocument(sale.id)`.
12. Stock cleanup calls `setStockSalesLinesForDocument` with empty line items.
13. Stock cleanup resolves active stock DB via `getActiveStockDatabaseUrl()`.
14. Stock cleanup reads existing stock sales snapshot, starts `runStockDbTransaction`, deletes stock sales lines for the bill, deletes the stock sales bill, commits, and returns.
15. `handleDeleteSale` calls `loadData()` to refresh parties, sales, stock items, and stock sales bills.

## Transaction Findings Before Fix

Inspection focus:

| Area | Finding |
|---|---|
| Accounts and stock DBs | Separate SQLite databases; no single atomic cross-DB transaction is possible. |
| Write guard | `assertActiveCompanyWritable()` is synchronous and occurs before `getDb()` and before transaction begin. |
| Accounts delete order | Receipt allocations -> ledger rows -> sale header. This matches local foreign-key/business dependency direction. |
| Stock cleanup order | Stock sales lines -> stock sales bill. This matches stock foreign-key dependency direction. |
| Accounts/stock transaction queue | Both helpers use a pending promise as an in-process queue token and release it in `finally`. |
| Error surfacing | UI reports errors through `window.alert` and a status message, but the prior hang produced no visible error because the awaited delete did not resolve/reject promptly. |

## Reproduction Attempts

| Attempt | Build | Steps | Actual | Result |
|---|---|---|---|---:|
| Prior live run | Pre-fix | Created/edited sale and stock allocation, accepted Delete confirmation | Sale remained; accounts DB locked until process stop; temp rows required direct cleanup | FAIL |

## Closure Update

Final status on 2026-08-11: `HFFT-UI-ERR-005` is fixed and live-retested.

Root cause: the live sale delete path used frontend `tauri-plugin-sql` transaction calls. In the Tauri SQL plugin, separate `execute("BEGIN")`, delete statements, and `execute("COMMIT")` are not guaranteed to run on the same pooled SQLite connection. This produced the observed locked/hung delete behavior and, in one intermediate attempt, `cannot commit - no transaction is active`.

Implemented fix:

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Added direct `sqlx` dependency for Rust-side SQLite transactions. |
| `src-tauri/src/lib.rs` | Added `delete_sale_with_stock_cleanup` command using one Rust SQLite transaction for accounts rows and one Rust SQLite transaction for linked stock rows. |
| `src/accounts/data/storage.ts` | Tauri runtime `deleteSale` now invokes the Rust command; non-Tauri fallback remains. |
| `src/accounts/pages/Sales.tsx` | Delete UI now uses the atomic sale delete call and tracks delete loading state. |

Live fixed retest:

| Temp Ref | Action | Result |
|---|---|---:|
| `900301` | Create sale, allocate Apple 5 KG, edit to Apple 7 KG / NPR 1,820, delete | PASS |
| `900302` | Immediate second create/delete after prior delete | PASS |

Database verification after fixed retest:

| Check | Actual | Result |
|---|---:|---:|
| FY2083/84 temp sales | 0 | PASS |
| FY2083/84 sale ledger rows for temp bills | 0 | PASS |
| FY2083/84 temp stock sales bills/lines | 0 | PASS |
| Everest receivable | 44,952 | PASS |
| Apple closing quantity | 440 KG | PASS |

Related finding discovered during this continuation: collection create/update/delete had the same pooled-transaction defect and is tracked separately as `HFFT-UI-ERR-006`. It was fixed with Rust `write_collection_transaction` and live-retested with receipt `910302`.

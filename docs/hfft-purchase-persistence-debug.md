# HFFT Purchase Persistence Debug

Status: FIXED AND LIVE-RETESTED  
Scope: HFFT-UI-ERR-007 only  
Rule: FY2082/83 oracle must not be reseeded or altered.

## Frozen Baseline

Recorded before code changes on 2026-08-11.

| Item | Value |
|---|---|
| Active FY2083/84 company profile ID | `himalaya-fresh-fruit-traders-pvt-ltd-208-2` |
| Company | Himalaya Fresh Fruit Traders Pvt. Ltd. |
| Fiscal year | 2083/84 |
| Resolved purchase DB URL | `sqlite:import-purchases-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |
| Actual SQLite filename | `import-purchases-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |
| Database file path | `C:\Users\Kandeey\AppData\Roaming\com.easysolution.businesssuite\import-purchases-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db` |

Table counts:

| Table | Count |
|---|---:|
| `fiscal_years` | 3 |
| `app_settings` | 1 |
| `parties` | 4 |
| `import_purchases` | 0 |
| `local_expenses` | 0 |
| `payments` | 0 |
| `payment_allocations` | 0 |
| `ledger_entries` | 0 |
| `activity_logs` | 2 |

Active fiscal-year row:

| Field | Value |
|---|---|
| `id` | `himalaya-fresh-fruit-traders-pvt-ltd-208-2-2083-84` |
| `companyId` | `himalaya-fresh-fruit-traders-pvt-ltd-208-2` |
| `code` | `2083/84` |
| `startBs` | `2083/04/01` |
| `endBs` | `2084/03/32` |
| `status` | `OPEN` |

Temporary probe rows before the fix:

| Probe | Count |
|---|---:|
| Import purchases with `HFFT-%` bill/reference | 0 |
| Local purchases with `HFFT-%` bill/reference | 0 |
| Ledger rows with `HFFT-%` source/narration | 0 |

## Call Graph

Import purchase save:

UI form submit `savePurchase`
-> validate fiscal year/editability/date/domain
-> confirm review dialog
-> `withNewPurchase` or `withUpdatedPurchase`
-> `postPurchase` ledger entries for created import purchases
-> `persistDataWithLog`
-> `repository.saveData`
-> `createSqliteRepository.saveSnapshotWithRetry`
-> `saveSnapshot`
-> `BEGIN IMMEDIATE TRANSACTION`
-> delete/reinsert snapshot tables
-> insert `import_purchases`
-> insert `ledger_entries`
-> insert `activity_logs`
-> `COMMIT`
-> `repository.loadData`
-> read-after-write confirms import purchase ID exists
-> React state is updated from the reloaded repository data
-> form is cleared.

Local purchase save:

UI form submit `saveLocalExpense`
-> validate fiscal year/editability/date/required fields
-> `withNewLocalExpense` or `withUpdatedLocalExpense`
-> `postLocalExpense` ledger entries for created local purchases
-> `persistDataWithLog`
-> `repository.saveData`
-> `createSqliteRepository.saveSnapshotWithRetry`
-> `saveSnapshot`
-> `BEGIN IMMEDIATE TRANSACTION`
-> delete/reinsert snapshot tables
-> insert `local_expenses`
-> insert `ledger_entries`
-> insert `activity_logs`
-> `COMMIT`
-> `repository.loadData`
-> read-after-write confirms local purchase ID exists
-> React state is updated from the reloaded repository data
-> form is cleared.

Delete paths:

Import/local delete now call `persistDataWithLog` and require read-after-write absence before the UI row is removed. Linked stock cleanup remains application-level cleanup after the purchase DB delete has persisted.

## Findings

| Finding | Evidence | Result |
|---|---|---|
| Wrong DB target | URL helper resolves FY2083/84 HFFT to the same file audited manually: `sqlite:import-purchases-himalaya-fresh-fruit-traders-pvt-ltd-208-2.db`. | Not the primary cause found. |
| Optimistic UI state | Import/local handlers previously called `setDataWithLog` immediately. Persistence happened later in a 600 ms effect. | Confirmed contributor. |
| Commit placement | `saveSnapshot` placed `COMMIT` under the activity-log loop region, leaving transaction behavior dependent on log rows. | Confirmed contributor. |
| Autosave masking | Save failures were caught in the delayed effect after UI rows had already appeared. | Confirmed contributor. |
| Pooled frontend SQL transaction | After the optimistic UI path was blocked, live save returned `database is locked` from the frontend SQL snapshot transaction. | Confirmed root cause. |
| Repository cache | `createDataRepository` is initialized once per Purchase app mount. No wrong FY2082/83 DB was proven in this phase. | Watch item for later company-switch retest. |

## Fix

Files changed:

| File | Change |
|---|---|
| `src/purchase/repository.ts` | Moved purchase snapshot `COMMIT` outside the activity-log loop so every save transaction commits even when activity logs are empty. |
| `src-tauri/src/lib.rs` | Added targeted single-document Rust transactions for import and local purchase upsert/delete. These use one `sqlx` connection and do not rewrite unrelated purchase tables. |
| `src/purchase/App.tsx` | Added `persistDataWithLog` for import/local purchase save/delete. UI state is updated only after targeted native persistence and `repository.loadData` confirm the expected row exists or is absent. |
| `tests/domain.test.ts` | Added a regression guard for the activity-log-loop commit placement. |

## Live Retest

| Test | Expected | Result |
|---|---|---|
| `HFFT-PERSIST-IMP-RETEST-001` import save | UI row, DB row, ledger row, restart persistence | PASS |
| Second immediate import write `HFFT-PERSIST-IMP-RETEST-002` | DB remains writable without restart | PASS |
| Import delete through app | DB row removed, no direct SQL cleanup | PASS |
| `HFFT-PERSIST-LOC-RETEST-001` local save | UI row, DB row, ledger row, restart persistence | PASS |
| Second immediate local write `HFFT-PERSIST-LOC-RETEST-002` | DB remains writable without restart | PASS |
| Local delete through app | DB row removed, no direct SQL cleanup | PASS |
| Same visible bill import/local collision `HFFT-LIVE-DUP-BILL-001` | Both source types persist independently | PASS |
| FY2082/83 oracle | Original oracle remains unchanged | PASS |

DB evidence after cleanup:

| Check | Result |
|---|---:|
| FY2083/84 import purchases with `HFFT-%` | 0 |
| FY2083/84 local purchases with `HFFT-%` | 0 |
| FY2083/84 temp ledger rows with `HFFT-%` | 0 |

FY2082/83 direct reconciliation after cleanup:

| Control | Actual |
|---|---:|
| Sales invoices | 180 |
| Sales revenue | 1,182,600 |
| Collections | 120 |
| Collection total | 946,080 |
| Closing receivables | 306,520 |
| Closing payables | 251,920 |
| Closing bank | 1,047,600 |
| Closing stock | 1,360 KG |
| Closing stock value | 180,078.14 |

Regression:

| Command | Result |
|---|---|
| `npm.cmd run test` | PASS, 54 tests |
| `npm.cmd run lint` | PASS |
| `npm.cmd run build` | PASS with existing Vite chunk/dynamic-import warnings |
| `cargo fmt --check --manifest-path src-tauri\Cargo.toml` | PASS |
| `cargo check --manifest-path src-tauri\Cargo.toml` | PASS |
| `cargo test --manifest-path src-tauri\Cargo.toml` | PASS, 0 Rust tests |

## Current Verdict

HFFT-UI-ERR-007 is fixed and live-retested. Final release sign-off remains separate and must not resume automatically from this phase.

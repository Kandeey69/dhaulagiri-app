# HFFT Loading / Unloading Posting Debug

Updated: 2026-08-11

Scope: `HFFT-UI-ERR-008` only. No reseed was performed. FY2082/83 oracle data was not modified. Temporary live records were created only in HFFT FY2083/84 and removed through the UI.

## Root Cause

Before the fix, `loadingUnloadingChargeNPR` was included in `landedCostNPR` but omitted from the offsetting customs/logistics payable. A valid import purchase with loading/unloading therefore debited Inventory / Landed Cost for the loading charge without any matching credit.

## Pre-Fix Controlled Reproduction

The app only exposes INR/USD supplier entry in the current HFFT settings, so the controlled NPR example was represented with exact INR conversions at the fixed `1.6000` rate.

| Field | Value |
|---|---:|
| Bill | `HFFT-LU-DEBUG-001` |
| Supplier entry | INR 12,500 = NPR 20,000 |
| Freight entry | INR 625 = NPR 1,000 |
| Import duty | NPR 500 |
| Loading/unloading | 100 KG x NPR 3 = NPR 300 |
| Expected landed cost | NPR 21,800 |

Pre-fix calculated totals:

| Component | Amount |
|---|---:|
| Supplier payable | 20,000 |
| Customs/logistics payable | 1,500 |
| Loading/unloading liability | 0 |
| Landed-cost debit | 21,800 |
| Credit total | 21,500 |
| Difference | 300 |

Generated journal before fix:

| Account | Name | Debit | Credit |
|---|---|---:|---:|
| 1200 | Inventory / Landed Cost | 21,800 | 0 |
| 2000 | Indian Supplier Payable | 0 | 20,000 |
| 2100 | Customs Agent Payable | 0 | 1,500 |

Result: `Posting batch is unbalanced: debit 21800, credit 21500.`

## Intended Policy

The seeded FY2082/83 Apple import confirms the intended accounting treatment:

| Component | Amount |
|---|---:|
| Supplier invoice | 21,120 |
| Customs/duty | 900 |
| Freight/logistics | 600 |
| Loading/unloading | 180 |
| Additional landed cost | 1,680 |
| Stock acquisition value | 22,800 |

Read-only seeded ledger evidence:

| Account | Name | Debit | Credit |
|---|---|---:|---:|
| 1200 | Inventory / Landed Cost | 22,800 | 0 |
| 2000 | Indian Supplier Payable | 0 | 21,120 |
| 2100 | Customs Agent Payable | 0 | 1,680 |

Policy: stock-bearing import purchases debit landed cost for supplier plus landed additions. Supplier invoice remains payable to the supplier. Customs/freight/loading additions paid through the logistics agent are credited to Customs Agent Payable. Direct transporter freight remains credited to Indian Transport Payable.

## Component Trace

| Component | Included in Supplier Amount | Included in Landed Cost | Separate Liability | Ledger Debit | Ledger Credit |
|---|---:|---:|---:|---:|---:|
| Supplier invoice | YES | YES | Supplier payable | 1200 | 2000 |
| Freight paid by custom agent | NO | YES | Customs agent payable | 1200 | 2100 |
| Freight payable by us | NO | YES | Transporter payable | 1200 | 2200 |
| Customs / duty | NO | YES | Customs agent payable | 1200 | 2100 |
| Terminal non-VAT cost | NO | YES | Customs agent payable | 1200 | 2100 |
| Recoverable import / terminal / service VAT | NO | NO | Customs agent payable | 1300 | 2100 |
| Agent service before VAT | NO | YES | Customs agent payable | 1200 | 2100 |
| Loading / unloading | NO | YES | Customs agent payable | 1200 | 2100 |
| Other import costs | NO | YES | Customs agent payable | 1200 | 2100 |

## Fix

Files changed:

| File | Change |
|---|---|
| `src/domain/accountingPolicy.ts` | Added authoritative `calculateImportLandedCostBreakdown`; loading/unloading is included in customs-agent payable and landed cost. |
| `src/purchase/calculations.ts` | Purchase UI totals now use the shared breakdown; custom agent is required when loading/unloading is entered. |
| `src/purchase/App.tsx` | Existing import purchase edits rebuild and replace the purchase ledger batch before native Rust upsert. |
| `src/stock/services/stockCalculations.ts` | Import stock status accepts source-currency entry totals while validating landed NPR valuation separately. |
| `tests/domain.test.ts` | Added loading/unloading, HFFT reference, decimal rounding, Rust payload, edit-ledger, and stock-status regressions. |

## Live Retest Evidence

| Test | Expected | Actual | Result |
|---|---|---|---:|
| Controlled save `HFFT-LU-RETEST-001` | Landed 21,800, supplier 20,000, agent 1,800 | UI saved; SQLite purchase persisted `loadingUnloadingChargeNPR=300`, `landedCostNPR=21800`; ledger debit/credit both 21,800. | PASS |
| Stock allocation for controlled save | Stock valuation uses landed cost | UI stock line saved Apple 100 KG; SQLite stock line `rate=218`, `amount=21800`, with entry INR preserved at `125 x 100 = 12500`; refreshed status `Entered`. | PASS |
| HFFT-style save `HFFT-LU-HFFT-RETEST-001` | Supplier 21,120, additions 1,680, landed 22,800 | UI summary and SQLite ledger matched; supplier credit remained 21,120 and agent credit 1,680. | PASS |
| Edit loading 180 -> 240 | Landed +60; no duplicate old batch | UI showed landed 22,860; SQLite purchase `loadingUnloadingChargeNPR=240`, agent payable 1,740; exactly 3 ledger rows, balanced. | PASS |
| Delete temporary imports | Rows, ledger, stock removed through UI | UI list returned to no records; SQLite found zero `HFFT-LU-*` purchases, ledger rows, stock bills, or stock lines. | PASS |
| Writability proof | DB remains writable after delete | UI created and deleted `HFFT-LU-WRITABLE-001`; final SQLite temp row count zero. | PASS |

## Final Reconciliation

| Check | Result |
|---|---:|
| FY2082/83 sales invoices = 180 | PASS |
| FY2082/83 sales revenue = 1,182,600 | PASS |
| FY2082/83 collections = 946,080 | PASS |
| FY2082/83 receivables = 306,520 | PASS |
| FY2082/83 payables = 251,920 | PASS |
| FY2082/83 stock qty = 1,360 KG | PASS |
| FY2082/83 stock value ~= 180,078.14 | PASS |
| FY2083/84 `HFFT-LU-*` temp purchases/ledger/stock rows = 0 | PASS |
| Unbalanced purchase ledger batches = 0 | PASS |

## Regression

| Command | Result |
|---|---:|
| `npm.cmd run test` | PASS, 61 tests |
| `npm.cmd run lint` | PASS |
| `npm.cmd run build` | PASS with existing Vite dynamic-import/chunk-size warnings |
| `cargo fmt --check --manifest-path src-tauri\Cargo.toml` | PASS |
| `cargo check --manifest-path src-tauri\Cargo.toml` | PASS after elevated rerun for Windows Cargo build-lock access |
| `cargo test --manifest-path src-tauri\Cargo.toml` | PASS after elevated rerun for Windows Cargo build-lock access; 0 Rust tests |
| Tauri live logs | PASS, no `database is locked`, `SQLITE_BUSY`, constraint, panic, migration, rollback, or unhandled errors observed. |

Status: `HFFT-UI-ERR-008` FIXED and LIVE-RETESTED.

# HFFT Live Tauri UI Validation

Updated: 2026-08-11

Scope: live Tauri desktop UI acceptance and UI-to-database reconciliation for Himalaya Fresh Fruit Traders Pvt. Ltd. FY 2082/83 and FY 2083/84 carry-forward. No reseed or oracle mutation was performed.

## Evidence Boundary

| Evidence Level | Status | Notes |
|---|---:|---|
| AUTOMATED TEST PASS | PASS | 61 tests pass after loading/unloading accounting fixes. |
| SERVICE/STORAGE TEST PASS | PASS | Closed-year storage/service guards remain enforced. |
| DATABASE RECONCILIATION PASS | PASS | FY2082/83 oracle unchanged; FY2083/84 returned to clean opening state after temporary UI transactions. |
| LIVE UI CORE CRUD | PASS | Purchase persistence retest passed for import/local save, restart persistence, same-bill collision, and UI cleanup. |
| MANUAL VALIDATION REQUIRED | YES | Backup/restore, workbook export inspection, print/export dialogs, and installed-app validation were not resumed in this phase. |

## Startup / Runtime

| Check | Actual | Result |
|---|---|---:|
| Tauri dev launch | `npm.cmd run tauri:dev` launched the desktop app on `http://localhost:5173/`; CDP endpoint reachable on port 9222. | PASS |
| HFFT FY 2082/83 status | Company selector showed HFFT FY 2082/83 as locked/closed. | PASS |
| HFFT FY 2083/84 status | Company selector showed HFFT FY 2083/84 as open/writable. | PASS |
| SQL plugin errors | No stock DB `code:14` or `unable to open database` observed in retested flows. | PASS |
| Runtime errors | Pre-fix sale and collection transaction errors reproduced and recorded; post-fix retests did not reproduce them. | PASS |

## Test Matrix

| Test ID | UI Area | Action | Expected | Actual | Result | Error ID |
|---|---|---|---|---|---:|---|
| HFFT-UI-001 | Startup | Launch Tauri dev app | App starts | Desktop app started; WebView reachable. | PASS |  |
| HFFT-UI-002 | Company discovery | Start with stale profile state | HFFT profiles visible without clearing localStorage | Pashupati remained; HFFT FY2082/83 and FY2083/84 appeared. | PASS | HFFT-UI-ERR-001 |
| HFFT-UI-003 | Company context | Open HFFT FY2082/83 | Correct company, closed FY, Inventory visible | UI showed HFFT FY2082/83 Closed and Inventory module. | PASS |  |
| HFFT-UI-004 | Accounts UI | Verify FY2082/83 receivables | 306,520 | UI/DB evidence matched all customer balances. | PASS |  |
| HFFT-UI-005 | Purchase UI | Verify FY2082/83 payable dashboard | 251,920 total | UI/DB evidence matched vendor/agent totals. | PASS | HFFT-UI-ERR-003 |
| HFFT-UI-006 | Purchase landed-cost report | Open Landed Cost report | Apple import supplier 21,120, additions 1,680, landed 22,800 | UI report showed required values for all 12 Apple imports. | PASS | HFFT-UI-ERR-003 |
| HFFT-UI-007 | Inventory dashboard | Open FY2082/83 Inventory | No DB open error; value 180,078.14 | UI showed closing stock value NPR 1,80,078.14; inventory review 0. | PASS | HFFT-UI-ERR-002 |
| HFFT-UI-008 | FY switching | Switch FY2083/84 -> FY2082/83 -> FY2083/84 | No snapback | Active company remained stable. | PASS | HFFT-UI-ERR-004 |
| HFFT-UI-009 | Temporary FY2 sale CRUD | Create/edit/delete sale and linked stock | Fully reversible through UI | Bills `900301` and `900302` were created/deleted; DB returned to zero temp sales/stock rows. | PASS | HFFT-UI-ERR-005 |
| HFFT-UI-010 | Temporary FY2 collection CRUD | Create/edit/delete receipt | Fully reversible through UI | Receipt `910302` saved 1,000, updated 1,500, deleted; DB returned to zero temp receipts/ledger. | PASS | HFFT-UI-ERR-006 |
| HFFT-UI-011 | Temporary FY2 payment CRUD | Create/edit/delete supplier payment | Fully reversible through UI | `HFFT-UI-TEMP-PAYMENT-002` saved 1,000, updated 1,500, deleted; DB clean. | PASS |  |
| HFFT-UI-012 | Temporary FY2 local purchase CRUD | Create/edit/delete local stock purchase | Fully reversible through UI | `HFFT-UI-TEMP-PURCHASE-003` saved 1,300, updated 1,950, deleted; DB clean. | PASS |  |
| HFFT-UI-013 | Closed-year broad write guard | Try every locked FY action | All writes blocked | Storage/service tests pass; broad live per-button audit not repeated in this pass. | MANUAL VALIDATION REQUIRED | UX-NOTE-002 |
| HFFT-UI-014 | Same bill number collision | Create import/local with same visible bill no. | Both persist as independent source documents | `HFFT-LIVE-DUP-BILL-001` persisted as one import row and one local row with distinct source types and balanced ledger rows; both were deleted through UI. | PASS | HFFT-UI-ERR-007 |
| HFFT-UI-015 | Purchase persistence | Create imports/locals, restart, cleanup | Rows persist, survive restart, and clean up through UI | `HFFT-PERSIST-IMP-RETEST-001/002` and `HFFT-PERSIST-LOC-RETEST-001/002` persisted to SQLite, reappeared after restart, then cleanup returned temp rows/ledger to zero. | PASS | HFFT-UI-ERR-007 |
| HFFT-UI-019 | Import loading/unloading accounting | Create, stock-allocate, edit, delete imports with nonzero loading/unloading | Landed cost and credits balance; stock uses landed valuation; cleanup leaves no temp rows | `HFFT-LU-RETEST-001` saved with landed 21,800 and balanced ledger; Apple stock line valued at 21,800. `HFFT-LU-HFFT-RETEST-001` saved at 22,800, edited to 22,860, ledger replaced with 3 balanced rows, then all `HFFT-LU-*` data was deleted through UI. | PASS | HFFT-UI-ERR-008 |
| HFFT-UI-016 | Backup export/restore | Export and restore backup | Version 2 stock section and counts match | Not executed in this phase per stop condition. | MANUAL VALIDATION REQUIRED |  |
| HFFT-UI-017 | Workbook export | Export workbook and inspect sheets | Accounting and stock sheets match | Not executed in this phase per stop condition. | MANUAL VALIDATION REQUIRED |  |
| HFFT-UI-018 | Installed app | Install MSI/NSIS and launch | Installed app works | Not executed in this phase per stop condition. | MANUAL VALIDATION REQUIRED |  |

## Final Reconciliation

| Metric | Expected | Actual | Result |
|---|---:|---:|---:|
| FY2082/83 sales invoices | 180 | 180 | PASS |
| FY2082/83 sales revenue | 1,182,600 | 1,182,600 | PASS |
| FY2082/83 collections | 120 | 120 | PASS |
| FY2082/83 collections amount | 946,080 | 946,080 | PASS |
| FY2082/83 receivables | 306,520 | 306,520 | PASS |
| FY2082/83 payables | 251,920 | 251,920 | PASS |
| FY2082/83 stock qty | 1,360 KG | 1,360 KG | PASS |
| FY2082/83 stock value | 180,078.14 approx | 180,078.14 | PASS |
| FY2083/84 sales/collections/purchases/payments after cleanup | 0 | 0 | PASS |
| FY2083/84 opening stock value | 180,078.14 approx | 180,078.14 | PASS |

## Notes

Pre-fix receipt `910301` intentionally remains in evidence as a failed collection transaction reproduction. It was removed through the repaired UI before the clean `910302` retest.

The collection page register refreshed correctly after delete, but the top net-receivable metric displayed a stale value until a broader refresh. Database reconciliation and the register were correct; this is tracked as `UX-NOTE-001`.

---

## Final Sign-Off Update

Updated: 2026-08-11 09:45 NPT

| Test ID | UI Area | Action | Expected | Actual | Result | Error ID |
|---|---|---|---|---|---:|---|
| HFFT-UI-020 | Same bill number collision | Re-ran final FY2083/84 import/local collision with `HFFT-FINAL-DUP-001` | Same visible bill remains isolated by source type and source ID | Import and local rows persisted independently; deleting import preserved local; final delete returned temp rows/orphans to zero | PASS |  |
| HFFT-UI-021 | Backup export | Export HFFT FY2082/83 V2 portable backup | Version 2 with stock and lifecycle data | Exported 692,016 byte V2 JSON with stock section and Track inventory true | PASS |  |
| HFFT-UI-022 | Backup restore | Restore exported locked V2 backup into disposable target | Restore succeeds without overwriting HFFT and preserves closed FY | Initial restore exposed ERR-009/010; after fixes, locked V2 restore reconciled all counts and IDs | PASS | HFFT-UI-ERR-009, HFFT-UI-ERR-010 |
| HFFT-UI-023 | V1 compatibility | Restore labelled synthetic V1 backup | Missing stock accepted; no fabricated stock | Financial data restored; no stock DB created | PASS |  |
| HFFT-UI-024 | Workbook export | Export and inspect full HFFT workbook | Accounting/stock sheets and oracle totals match | Initial workbook gap exposed ERR-011; after fix, 20-sheet workbook reconciled sales, receivables, payables, stock | PASS | HFFT-UI-ERR-011 |
| HFFT-UI-025 | Restart persistence | Close/restart Tauri dev app after export/restore | Profiles and HFFT DBs persist; logs clean | Restart succeeded; requested SQL/panic/migration strings all zero in logs | PASS |  |
| HFFT-UI-026 | Installed app | MSI/NSIS runtime and uninstall/data retention | Disposable installed-app validation | Not available in this environment | MANUAL VALIDATION REQUIRED |  |

Current application-level verdict: `APPLICATION PRODUCTION READY / INSTALLER SIGN-OFF REQUIRED`.

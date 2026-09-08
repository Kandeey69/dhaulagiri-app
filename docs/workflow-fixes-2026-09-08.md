# Workflow integrity implementation report

Implementation follows checkpoint `22fef2c`. That checkpoint includes the original application work and audit. These fixes remain uncommitted for review; nothing was pushed. No business databases were opened or changed during development/testing.

## 1. FIXES COMPLETED

All 13 original findings have code changes and regression coverage. Automated verification covers the domain, actual storage functions on in-memory SQLite, native transaction execution, and extracted application orchestration with isolated adapters. This is not a claim that the installed desktop application's entire UI has been exercised.

| Issue | Root cause | Implementation and principal files | Regression evidence |
| --- | --- | --- | --- |
| 1 — self-carry/invalid year | Closing accepted arbitrary target years and later overwrote the source lock. | Strict parsing, exact successor and graph validation; validate before business writes; commit final profile links together. `src/domain/fiscalYear.ts`, `src/App.tsx`. | Invalid/same/skipped years and cycles; actual close handler rejects self-carry without mutation and successful close leaves source locked. |
| 2 — active-company race | Background operations temporarily changed global selection across awaits. | Immutable explicit database context, scoped settings, explicit repository and accounts APIs; removed navigation-triggered background refresh. `src/companyContext.ts`, `src/App.tsx`, accounts/purchase storage. | Pause background work, inspect foreground context, switch selection, resume; selection remains the user's choice. Three-year carry never changes active company. |
| 3 — delayed saves lost on navigation | Explicit actions depended on a cancelled 600 ms autosave timer. | Explicit purchase/payment/party actions await persistence and readback. Shared pending-write barrier covers module/company changes, logout, backup and year end; stock/accounts writes participate. `src/application/persistence.ts`, `src/purchase/App.tsx`, storage modules, `src/App.tsx`. | Deferred save blocks immediate navigation; failed save blocks leaving; actual SQLite contains saved records when the barrier resolves. |
| 4 — valuation disagreement | Summary averaged historical inward stock while register used chronology. | Summary derives closing state from the register engine; exports and carry use the same functions. `src/stock/services/stockLedger.ts`, `src/stock/storage.ts`, stock carry service. | Required depletion, partial depletion, normal average, repeated purchases, zero reset and same-day ordering cases; register/summary/export entry point/carry agree. |
| 5 — incomplete inventory closed successfully | Missing/mismatched lines and invalid closing stock were silently excluded. | Readiness checks source lines, missing source/item references, drafts, numeric validity, dates, conflicts and historical negative stock. Closing, including closing without carry, is blocked until ready. `src/stock/services/stockCarryForward.ts`, `src/App.tsx`. | Missing lines and negative stock fail; missing-line carry invokes zero opening writes. |
| 6 — partial financial writes | Transactions, allocations, journals and activity logs were separate commits. | Stage writes and recheck validation reads inside a native SQL transaction. Collection commands keep atomic writes and verify allocation invariants before commit. Sale/stock deletion combines attached writes with durable recovery. Native connections use FULL synchronous commits. `src/application/atomicSql.ts`, accounts/stock storage, purchase repository, `src-tauri/src/lib.rs`. | Actual SQLite sale/collection/credit-note/activity failures roll back; sale deletion removes its allocations/journals atomically. Native tests prove rollback, subsequent writability and stale-read rejection. |
| 7 — destructive operations restored only profiles | Failure between stores left cleared data behind. | Durable recovery snapshot before company creation/deletion, replacement, closing, and linked purchase/sale deletion. Restore all affected stores, profiles, selection and scoped settings; retain journal and block writes if recovery fails. Startup requires recovery before normal use. `src/application/recovery.ts`, `src/App.tsx`, purchase/accounts entry points, Rust journal commands. | Inject second-store failure and verify full compensation; inject compensation failure and verify retained snapshot and blocked writes; actual SQLite replacement failure preserves original tables. |
| 8 — silent fallback database | SQLite initialization failure opened an unrelated localStorage store. | Desktop initialization fails clearly; browser storage remains an intentional separate mode. Explicit context also applies to legacy row normalization. `src/purchase/repository.ts`, `src/purchase/storage.ts`. | Extracted production repository factory receives injected SQLite failure; local fallback called zero times. |
| 9 — incomplete accounting backup | Journals and lifecycle metadata were omitted; replacement retained old journals. | Version 3 exports complete raw accounting tables and scoped settings. Atomic replacement includes fiscal years, journals, allocations and lifecycle fields; validates columns/references/batches and remaps company/year identity. Legacy posted records rebuild journals and preserve available metadata; legacy non-posted history without journals is rejected. `src/application/backupValidation.ts`, accounts storage, `src/App.tsx`. | Raw tables round-trip exactly into populated and empty isolated databases. Failed replacement rolls back. Legacy reversed history without complete journals is rejected before writes. |
| 10 — invalid sale allocation edits | Sale amount/customer changed without considering allocated receipts. | Reject a reduction below allocated amount or customer change inconsistent with receipt ownership before updating the sale. Validation is rechecked in the native transaction. Accounts storage and Rust collection command. | Actual SQLite sale allocated NPR 800 rejects reduction to NPR 500 and changing customer; original transaction, allocations and journals remain. |
| 11 — obsolete carried openings | Omitted/deleted source masters were never reconciled in the target. | Retain provenance for receivable/payable IDs and source-to-target stock identity; explicitly clear obsolete derived openings while retaining target activity and masters. Include inactive zero stock. `src/application/openingReconciliation.ts`, `src/App.tsx`, stock carry service. | Three-year application carry test deletes source parties/items, then verifies target derived openings clear while target sales, expenses and stock history survive. |
| 12 — overwritten manual openings/masters | Visiting the source implicitly rewrote next-year data. | Refresh only during explicit closing/reconciliation. Preserve target master fields and detected manual overrides. Existing openings without carry history require an explicit first-reconciliation choice: keep manual figures or recalculate all openings. `src/application/openingReconciliation.ts`, `src/App.tsx`, accounts carry upsert. | Three-year test preserves renamed target party and manual opening. Legacy target NPR 1,500 blocks without an ownership choice, recalculates to NPR 2,000 when selected, or remains NPR 1,500 when explicitly confirmed manual. |
| 13 — deleted seeds returned | Every startup reimported seeds and overwrote preferences. | One-time seed bootstrap marker; persisted profiles/settings win. Default-company deletion also removes legacy scoped settings. `src/companyContext.ts`, `src/App.tsx`. | Seed initial creation, deletion, repeated startup and an explicit inventory setting all verified. |

Additional consistency corrections: stored fiscal-year status changes with closing/reopening, so imported closed years can be reopened; reversed/void records cannot be edited/deleted through operational corrections; receivable and payable closing calculations exclude unposted/reversed/void activity and use the selected fiscal year.

## 2. INVENTORY VALUATION

**Perpetual moving weighted-average cost is authoritative, updated on each purchase.** Issues consume the average immediately before that issue. Purchases use the remaining inventory value plus the authoritative stored purchase-line value.

- Order: normalized effective date, persisted stock-document creation timestamp, document ID, line ID. Array/database return order does not determine cost.
- Precision: full JavaScript numeric precision for internal values/rates; quantity normalized to nine decimal places; money is displayed to two decimals and rates up to six. Average cost is not rounded to cents after each movement.
- Zero quantity resets inventory value to zero. A subsequent purchase establishes a new average.
- Negative inventory remains deterministic but provisional. Any historical negative balance blocks closing until chronology/entries are corrected; it is not treated as valid finished valuation.
- Consumers: stock register, summary, existing storage exports, workbook stock export and year-end carry use the shared ledger calculation.
- Confirmed example: 10 @ 100, sell 10, buy 10 @ 200 → quantity 10, average 200, value **NPR 2,000**. Selling only 5 and buying 5 @ 200 instead → quantity 10, average 150, value **NPR 1,500**.

## 3. ARCHITECTURAL CHANGES

`CompanyDatabaseContext` captures company/year/database URLs for scoped work. `flushPendingWrites` waits for explicit saves before navigation or balance-dependent operations. `stageSqlTransaction` gathers writes and validation reads; native SQL rechecks those reads and executes the batch on one transaction/connection.

Cross-store workflows use compensation with a durable original snapshot, not a claim of globally atomic independent commits. Attached sale/stock writes roll back together on ordinary SQL errors; the recovery journal covers interrupted cross-store activation. If rollback cannot finish, the snapshot remains and further business writes are blocked pending recovery.

Opening provenance separates source-derived values from manual target overrides. Legacy openings without provenance require an explicit ownership decision before reconciliation. Account and purchase party masters remain separate domains; carry identity uses their existing IDs rather than merging those domains.

Reopening policy: reopen dependent years from newest to oldest. A locked descendant blocks source changes. Reconcile and close from oldest to newest; a successor cannot close while its predecessor remains open. Reopening does not silently refresh successors.

Posted-edit policy: operational corrections of draft/posted records remain allowed in an OPEN year, with allocation checks, journal replacement and activity history. Reversed/void history remains immutable. Ordinary lifecycle posting/reversal functions retain their stricter transition rules.

## 4. TESTS RUN

Commands run from `E:/Coding by Kandeey/Dhaulagiri App/MERGED APP`:

| Command | Result |
| --- | --- |
| `npm test` | 81 passed, 0 failed. Includes actual accounts storage on `node:sqlite` in-memory databases. |
| `node scripts/audit-workflows.mjs` | 16 corrected acceptance scenarios passed; also runs the regression suite. |
| `node node_modules/typescript/bin/tsc -p tsconfig.app.json --incremental false` | Passed. |
| `node node_modules/typescript/bin/tsc -p tsconfig.node.json --incremental false` | Passed. |
| `npm run lint` | Passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 2 passed, 0 failed; native SQL transaction tests on in-memory SQLite. |
| `git diff --check` | Passed. |

Safe production bundle command, also passed:

```powershell
$workflowBuildOutput = Join-Path $env:TEMP 'dhaulagiri-workflow-fixed-build'
node node_modules/vite/bin/vite.js build --configLoader native --outDir $workflowBuildOutput
```

The bundle retains existing chunk-size and ineffective dynamic-import warnings. The existing distribution directory was not cleared or replaced.

## 5. FILES CHANGED

| File | Reason |
| --- | --- |
| `src/App.tsx` | Scoped orchestration, preflight, durable recovery, backup v3, opening ownership/reconciliation, seed bootstrap, navigation barriers and consistent year status. |
| `src/companyContext.ts` | Immutable context, dependency/recovery write guards, explicit scoped settings and one-time seed application. |
| `src/domain/fiscalYear.ts` | Strict canonical year and successor/graph validation. |
| `src/domain/lifecycle.ts` | Explicit operational posted-correction policy. |
| `src/application/persistence.ts` | Pending-write tracking and navigation/protected-operation barrier. |
| `src/application/atomicSql.ts` | Stage and commit transaction writes with rechecked reads. |
| `src/application/recovery.ts` | Durable journal, compensation, recovery coordinator and fail-closed state. |
| `src/application/backupValidation.ts` | Complete-table, reference, allocation and journal validation. |
| `src/application/openingReconciliation.ts` | Derived/manual opening ownership and successor dependency checks. |
| `src/application/purchaseCarryForward.ts` | Scope payable closing to posted activity in the selected year. |
| `src/accounts/data/storage.ts` | Explicit context, transactional financial writes, allocation/lifecycle checks, complete backups, scoped balances and protected deletion. |
| `src/purchase/App.tsx` | Await explicit actions, eliminate financial delayed autosave, readback and recoverable linked deletions. |
| `src/purchase/repository.ts` | Explicit database identity, atomic snapshots and no desktop fallback. |
| `src/purchase/storage.ts` | Scoped browser storage and explicit legacy normalization context; surface corrupt data. |
| `src/stock/services/stockLedger.ts` | Single chronological moving-average engine for closing valuation. |
| `src/stock/services/stockCarryForward.ts` | Readiness blockers and explicit zero/inactive carry entries. |
| `src/stock/storage.ts` | Shared valuation exports, native transaction staging, validation and tracked writes. |
| `src-tauri/src/lib.rs` | Native batch/recovery commands, durable connection settings, attached deletion, collection checks and native regression tests. |
| `scripts/run-tests.mjs` | Compile new modules/tests and provide isolated SQLite injection. |
| `scripts/audit-workflows.mjs` | Convert original reproductions into corrected acceptance checks; add actual three-year carry and legacy ownership coverage. |
| `tests/domain.test.ts` | Updated invariant expectations and staging/barrier/fiscal regressions. |
| `tests/workflows.test.ts` | Moving-average cases, real SQLite rollback/restore, dependency, lifecycle and seed regressions. |
| `docs/workflow-fixes-2026-09-08.md` | This engineering report and manual acceptance checklist. |
| `docs/workflow-fixes-2026-09-08-results.json` | Recorded final audit acceptance results. |

## 6. REMAINING RISKS

- The installed Tauri UI, installer packaging, live database upgrade, forced process termination and physical power-loss recovery were not exercised. Native transaction tests and isolated compensation tests do not replace those release checks.
- Existing records are not silently rewritten. Old next-year openings need the first-reconciliation ownership choice. Inspect any manual figures before choosing **Recalculate all openings**.
- A legacy backup containing non-posted lifecycle history without full journals is deliberately blocked; export a version 3 backup from a compatible copy of the original company instead.
- Same-day chronology uses the persisted stock-entry timestamp and stable IDs available in this schema. It cannot recover a business sequence that was never recorded.
- Existing corrupt references, invalid chronology or incomplete stock entry must be corrected before affected close/restore operations proceed; this change does not invent missing business history.
- Verification used isolated adapters and in-memory databases. The three-year application test uses the actual carry function with controlled persistence adapters; financial storage and the native SQL batch are tested separately.

## 7. MANUAL UI ACCEPTANCE CHECKLIST

Use a disposable test company or a separate test installation.

1. Create FY 2082/83; confirm malformed and same-year successors are rejected. Save a party/payment and immediately switch modules, company and logout; reopen and verify persistence.
2. Enable inventory. Enter opening 10 @ 100, sell 10, then purchase 10 @ 200. Verify register, summary, export and next-year opening all show NPR 2,000. Repeat partial depletion and verify NPR 1,500.
3. Leave stock lines missing/mismatched or create negative stock; verify year end is blocked. Correct the entries and close FY1 → FY2 → FY3.
4. Try reopening FY1 with FY2 locked; verify it is blocked. Reopen newest to oldest, correct FY1, then reconcile/close oldest to newest.
5. Edit target-year party details/openings and add target activity. Reconcile the source and verify manual values/activity survive. For old openings without carry history, verify both ownership choices on disposable data.
6. Allocate a receipt to a sale. Reject changing its customer or reducing it below allocated amount. Verify a valid edit keeps transaction/journal/balance consistent.
7. Backup and restore an empty test target; replace a populated test group; compare balances, allocations, stock and activity. Verify imported closed years can be reopened.
8. In a controlled test build, inject a cross-store write/recovery failure, restart and use **Recover interrupted operation**. Verify original data returns before entries are enabled.
9. Delete a seeded test company and restart; verify it stays deleted and inventory preferences remain unchanged.

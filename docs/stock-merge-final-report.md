# Stock Merge Final Report

Date: 2026-08-03

## Scope

Final validation and release-hardening only. No new functional scope was added during this pass.

## Files Copied

No files were copied during this final validation phase.

## Files Adapted

No code files were adapted during this final validation phase.

## Files Rewritten

No code files were rewritten during this final validation phase.

## Files Intentionally Not Copied

No donor files were copied in this phase. The Phase 2-13 worktree remains focused on the merged stock module and does not copy donor accounts, purchase, Tauri, or migration files wholesale.

## Database Design Validation

- Stock database URL resolution is company-scoped through `getActiveStockDatabaseUrl`.
- `sqlite:inventorytracked-stock.db` appears only as a legacy fallback/exported constant and Tauri SQL preload entry.
- Company stock database filenames are derived from active company IDs with collision-resistant sanitization.
- Stock item codes remain unique within each company-specific stock database.
- Purchase stock lines use source document type plus source document id to avoid global bill-number collisions.
- Stock purchase and sales replacement paths use transactional execution.
- Delete paths are constrained by source document identity and type.
- Tauri SQL preload still includes `sqlite:inventorytracked-stock.db` for runtime compatibility.

Required search evidence:

```text
rg -n "sqlite:inventorytracked-stock\.db" src src-tauri
src-tauri\tauri.conf.json:45
src\companyContext.ts:203
```

```text
rg -n "sourceType|source_type|sourceDocumentId|source_document_id" src/stock src/accounts src/purchase
Stock source identity hits are present in src/stock/storage.ts, src/stock/services/stockCalculations.ts, src/purchase/App.tsx, and ledger storage/repository files.
```

## Settings Migration Validation

- `Track inventory` uses company-scoped helpers.
- The legacy key `suite-track-inventory` remains only as the migration source key.
- A company-specific legacy migration marker prevents repeated legacy overwrite.
- Tests verify legacy migration happens once and does not overwrite a company-specific later choice.

Required search evidence:

```text
rg -n "suite-track-inventory|accounts-company-name|accounts-fiscal-year|suite-company-name|suite-fiscal-year" src
src\stock\settings.ts:8
src\stock\settings.ts:9
src\stock\settings.ts:13
src\stock\settings.ts:17
src\stock\settings.ts:21
```

## Tests Added By The Merge

The active test suite includes stock-specific tests for:

- Company-scoped stock database URL resolution and filename collision prevention.
- Company-scoped inventory setting reads/writes.
- One-time migration from the legacy global inventory setting.
- Stock rows and stock register calculations.
- Fiscal-year/lifecycle stock document eligibility.
- Source document type/id identity for purchase stock.
- Landed-cost allocation for import stock lines.
- Stock carry-forward correctness and idempotency.
- Transaction rollback for stock document replacement failure.

## Exact Final Verification Results

```text
npm.cmd run test
pass: 31
fail: 0
duration_ms: 197.2728
```

```text
npm.cmd run lint
exit: 0
```

```text
npm.cmd run build
exit: 0
vite built in 443ms
warnings: ineffective dynamic SQL import; one chunk larger than 500 kB
```

```text
cargo fmt --check --manifest-path src-tauri\Cargo.toml
exit: 0
```

```text
cargo check --manifest-path src-tauri\Cargo.toml
first sandbox attempt: failed on Windows .cargo-build-lock access denied
unsandboxed rerun: exit 0, finished in 2.08s
```

```text
cargo test --manifest-path src-tauri\Cargo.toml
first sandbox attempt: failed on Windows .cargo-build-lock access denied
unsandboxed rerun: exit 0, Rust tests 0 passed / 0 failed
```

```text
npm.cmd run tauri:build
first sandbox attempt: failed writing node_modules\.tmp tsbuildinfo files
unsandboxed rerun: exit 0
release build: finished in 4m 38s
bundles:
E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\src-tauri\target\release\bundle\msi\Easysolution_0.1.1_x64_en-US.msi
E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\src-tauri\target\release\bundle\nsis\Easysolution_0.1.1_x64-setup.exe
```

## Live Tauri Validation

`npm.cmd run tauri:dev` started successfully. Vite served on port 5173, Tauri compiled, and `target\debug\easysolution.exe` launched.

Detailed business workflows were not live-clicked in the Tauri window because this validation environment does not provide a reliable Tauri WebView interaction connector.

## Remaining Risks

- Full purchase/sales stock-line lifecycle reconciliation still needs a manual desktop pass.
- Portable backup restore and workbook export need live file validation.
- Closed-year UI behavior needs manual confirmation from the Tauri shell.
- `sql:allow-execute` is broad and should be kept under review.
- Bundle size warning is non-blocking but should be addressed before a polished public release.

## Release Readiness

The codebase is build-ready and package-ready.

It should not yet be called production-ready for user release until the pending manual Tauri workflow checks in `docs/release-readiness.md` pass.

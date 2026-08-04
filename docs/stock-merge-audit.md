# Stock Merge Phase 1 Audit

Date: 2026-08-03

Scope: audit only. No source code was modified in this phase.

## Executive Summary

`MERGED APP` is the authoritative application and already contains the newer company, fiscal-year, lifecycle, ledger, allocation, validation, autosave, landed-cost, backup, export, and Tauri identity work. `Inventorytracked apk` contains a complete stock UI and stock persistence module, but its application shell, purchase module, account module, database selection, settings, migrations, and Rust integration are older.

The stock module can be ported, but it must be adapted before runtime use. The donor stock database is global (`sqlite:inventorytracked-stock.db`), the inventory setting is global (`suite-track-inventory`), stock line replacement is delete-then-insert without a transaction, purchase and sales bill numbers are globally unique in stock tables, and donor stock UI has no locked-year read-only model.

## Repository and Structure Comparison

- `MERGED APP` contains newer `src/application`, `src/domain`, `src/components`, `scripts`, `tests`, company context, fiscal-year context, and migrations `008` through `010`.
- `Inventorytracked apk` contains `src/stock` and stock touchpoints in older `src/App.tsx`, `src/accounts/pages/Sales.tsx`, `src/purchase/App.tsx`, `src-tauri/src/lib.rs`, and `src-tauri/tauri.conf.json`.
- `MERGED APP/src/stock` does not currently exist, so Phase 2 can create it without overwriting an existing stock module.
- `MERGED APP/docs` was created for this audit artifact.
- `Final App` was not used.

## Config Comparison

- `package.json` dependencies are effectively aligned: React 19, Vite 8, TypeScript 6, Tauri 2, SQL plugin 2.
- `MERGED APP/package.json` has `npm run test`; donor does not.
- `vite.config.ts` and `tsconfig.app.json` hashes match between apps.
- `eslint.config.js` differs and should remain from `MERGED APP`.
- Lockfiles differ, mostly because project package metadata differs. Do not replace `MERGED APP/package-lock.json` unless dependencies actually change.

## Tauri and Rust Comparison

- Keep `MERGED APP/src-tauri/tauri.conf.json` identity:
  - `productName`: `Easysolution`
  - `identifier`: `com.easysolution.businesssuite`
- Donor Tauri config has old branding and adds only `sqlite:inventorytracked-stock.db` to SQL preload.
- Keep `MERGED APP/src-tauri/src/lib.rs`; it registers `read_company_seed` and migrations `001` through `010`.
- Donor `lib.rs` has automatic open/close backup code but lacks `read_company_seed` and lacks migrations `008`, `009`, and `010`.
- Any stock preload must be additive and must not force all companies to use the legacy global stock database.

## Migration Chain

Leave untouched:

- `MERGED APP/src-tauri/migrations/008_accounting_model.sql`
- `MERGED APP/src-tauri/migrations/009_lifecycle_ledger.sql`
- `MERGED APP/src-tauri/migrations/010_purchase_loading_unloading.sql`

Donor migrations stop at `007` and do not include fiscal years, payment allocations, ledger entries, lifecycle fields, or loading/unloading fields. They must not replace the merged migration chain.

Stock schema is currently created imperatively in donor `src/stock/storage.ts`, not through Tauri migrations. If schema changes are required for stock, add forward-only migrations or guarded runtime schema initialization without editing released migrations.

## Company Context and Database Selection

`MERGED APP/src/companyContext.ts` already provides:

- `CompanyProfile`
- active company selection
- `companyStorageKey`
- `getCompanySetting`
- `setCompanySetting`
- `getActiveAccountsDatabaseUrl`
- `getActivePurchaseDatabaseUrl`

Missing:

- `getActiveStockDatabaseUrl`

Risk:

- Donor stock storage uses one cached global `Database.load("sqlite:inventorytracked-stock.db")`, so multiple companies would share stock data.
- The stock database helper must derive from active company identity and safely encode the ID.
- The helper must reset the stock DB cache when the active company changes, mirroring accounts storage behavior.

## Files to Port Unchanged

Likely reusable with little or no functional change, after import paths are checked:

- `Inventorytracked apk/src/stock/components/MetricCard.tsx`
- `Inventorytracked apk/src/stock/components/ReadOnlyField.tsx`
- `Inventorytracked apk/src/stock/components/StatusBadge.tsx`
- `Inventorytracked apk/src/stock/components/StockTable.tsx`
- `Inventorytracked apk/src/stock/services/stockValidation.ts`

These are mostly presentational or pure validation helpers.

## Files to Adapt

Adapt these into `MERGED APP/src/stock`:

- `src/stock/App.tsx`: needs Easysolution shell terminology, company/fiscal-year context, locked-year behavior, and module navigation integration.
- `src/stock/App.css`: usable as starting CSS, but should be checked against merged app styles.
- `src/stock/types.ts`: add fiscal-year/company/read-only context where needed.
- `src/stock/storage.ts`: must become company-scoped and transactional.
- `src/stock/settings.ts`: must become company-scoped.
- `src/stock/LineItemPreviewModal.tsx` and `.css`: adapt company/fiscal-year source to merged context.
- `src/stock/hooks/useStockData.ts`: filter source documents by active fiscal year and company.
- `src/stock/hooks/useDocumentAllocation.ts`: enforce closed-year view-only behavior.
- `src/stock/hooks/useStockDerivedData.ts`: likely reusable, but must respect valid active source docs.
- `src/stock/pages/*`: adapt actions to read-only rules and merged UX.
- `src/stock/components/Allocation*`, `PendingDocuments.tsx`, `Sidebar.tsx`: adapt branding, disabled states, and read-only labels.
- Donor `src/accounts/pages/Sales.tsx`: port only stock status, preview, and open-stock-entry actions.
- Donor `src/purchase/App.tsx`: port only stock status, preview, and open-stock-entry actions for import and local purchase.

## Files to Rewrite

Rewrite rather than copy:

- Stock database selection in `MERGED APP/src/companyContext.ts`.
- Company-scoped inventory settings in `MERGED APP/src/stock/settings.ts`.
- Transaction wrappers in `MERGED APP/src/stock/storage.ts`.
- Stock backup/restore integration in `MERGED APP/src/App.tsx`.
- Stock workbook export integration in `MERGED APP/src/App.tsx`.
- Stock carry-forward integration in `MERGED APP/src/App.tsx` / year-end flow.
- Any Rust backup addition in `MERGED APP/src-tauri/src/lib.rs`.
- Any migration needed to relax bill-number uniqueness or add source metadata.

## Files to Leave Untouched

Do not replace these from donor:

- `MERGED APP/src/App.tsx`
- `MERGED APP/src/accounts/App.tsx`
- `MERGED APP/src/accounts/pages/Sales.tsx`
- `MERGED APP/src/accounts/data/storage.ts`
- `MERGED APP/src/purchase/App.tsx`
- `MERGED APP/src/purchase/domain.ts`
- `MERGED APP/src/purchase/repository.ts`
- `MERGED APP/src/purchase/db/schema.sql`
- `MERGED APP/src-tauri/src/lib.rs`
- `MERGED APP/src-tauri/tauri.conf.json`
- all existing `MERGED APP/src-tauri/migrations/*.sql`
- `MERGED APP/package-lock.json`, unless a real dependency changes

These files can be edited later with targeted changes only.

## Conflicting Database Behavior

- Donor stock storage uses one global DB URL.
- Donor stock storage caches the DB promise without tracking active company.
- Donor stock schema uses global `UNIQUE` constraints on `stock_items.code`, `stock_purchase_bills.bill_no`, and `stock_sales_bills.bill_no`.
- Donor stock line replacement deletes existing lines before insert and does not use a transaction.
- Donor stock `DELETE` filters only by `bill_id`, with no explicit source document type column.
- Donor storage uses guarded `ALTER TABLE` calls for some stock columns, but no migration chain.
- `MERGED APP` account and purchase storage already use company-scoped DB URLs and should be the model.

## Conflicting Application-Shell Behavior

- Donor app shell has `stock` module but no `yearEnd` module.
- Donor app shell uses global `localStorage` settings and no company profiles.
- Donor first-run setup writes global settings only.
- Donor module picker shows Inventory based on global setting.
- `MERGED APP` has company profile selection, `YearEndManager`, portable backups, `read_company_seed`, locked company read-only routing, and must remain the shell.

## Conflicting Purchase Logic

- Donor purchase module predates fiscal-year filtering, lifecycle statuses, payment allocations, ledger postings, validation summary, autosave, and loading/unloading fields.
- Donor purchase deletion calls stock cleanup in `.catch(...)` after primary deletion, so cleanup failure is reported but not coordinated.
- Donor stock source docs for import purchases use `landedCostNpr`, which is useful, but the donor purchase module must not be copied over merged purchase logic.
- Merged purchase has `fiscalYearId`, `lifecycleStatus`, `paymentAllocations`, `ledgerEntries`, `totalKg`, `loadingUnloadingChargePerKg`, `loadingUnloadingChargeNPR`, `calculationVersion`, `calculatedAt`, validation, autosave, and status-aware actions.

## Conflicting Accounts/Sales Logic

- Donor sales page has stock status, preview, and stock cleanup after sale deletion.
- Donor sales preview reads company and fiscal year from raw global `localStorage`.
- Donor accounts app passes `onOpenStockLineEntry`, but does not have merged closed-year `isReadOnly` handling.
- Merged sales currently has company-scoped cancelled bill numbers and read-only props from `AccountsApp`.
- Merged account storage has fiscal years, lifecycle fields, receipt allocations, and ledger posting; donor sales logic must not replace it.

## Global Settings to Make Company-Scoped

- `suite-track-inventory` from donor `src/stock/settings.ts`.
- Any preview/company/fiscal-year reads from:
  - `accounts-company-name`
  - `accounts-fiscal-year`
  - `suite-company-name`
  - `suite-fiscal-year`

Use:

- `companyStorageKey`
- `getCompanySetting`
- `setCompanySetting`
- active company profile
- active fiscal year context

## Global Stock Database References to Make Company-Scoped

Current donor references:

- `Inventorytracked apk/src/stock/storage.ts`: `sqlite:inventorytracked-stock.db`
- `Inventorytracked apk/src-tauri/tauri.conf.json`: SQL preload for `sqlite:inventorytracked-stock.db`

Normal runtime should use `getActiveStockDatabaseUrl`. The legacy URL may remain only for documented preload or one-time compatibility migration.

## Risks of Inventory Duplication

- Running future year-end carry-forward multiple times could add opening stock repeatedly unless stock opening rows are upserted or replaced idempotently.
- Portable restore could duplicate stock rows if it inserts blindly into an existing company-scoped stock DB.
- Donor bill tables use source document ID as bill ID, which helps idempotency, but bill-number unique constraints can break valid collisions.
- Opening stock stored directly on `stock_items` makes carry-forward updates destructive unless source and target years are separated by company/year scoped stock DBs or explicit opening metadata.

## Risks of Partial Delete and Insert

- `setStockPurchaseLinesForDocument` deletes existing stock purchase lines before validating and inserting all replacement lines.
- `setStockSalesLinesForDocument` deletes existing stock sales lines before validating and inserting all replacement lines.
- If insert fails after delete, previous inventory lines are lost.
- Delete and cleanup functions filter only by bill/document ID; adding source document type would make cleanup safer.
- Purchase cleanup currently can fail after primary deletion, leaving orphaned stock lines.

## Risks Affecting Year-End Carry-Forward

- Stock has no fiscal-year field and no carry-forward integration yet.
- `buildStockRows` supports an `asOnDate`, but source docs must be filtered by fiscal year and company.
- Opening stock lives on item master, so target-year carry-forward must be idempotent and must not mutate source-year stock.
- Current `carryForwardOpenings` carries receivables/payables only and marks company lock success after that. Stock failure handling must be integrated before marking carry-forward successful.

## Risks Affecting Closed-Year Locking

- Donor stock module has no `isReadOnly` prop or fiscal-year lock model.
- Donor stock allocation UI allows add/edit/remove/save based on stock UI state only.
- Sales and purchase stock actions must become view-only when `activeCompany.isLocked` or active fiscal year is closed.
- Existing stock lines should remain previewable in closed years.

## Risks Affecting Backup and Restore

- Merged portable backup version is `1` and includes accounts plus purchase only.
- Donor automatic backup copies only `accounts.db` and `import-purchases.db`; it does not discover company-scoped DBs and does not include stock DBs.
- Future stock backup must include stock tables, company-scoped stock settings, and format versioning.
- Restore must target the restored company's stock DB, not the active or legacy global DB.

## Risks Affecting Workbook Export

- Merged workbook export includes company, accounts, sales, collections, credit notes, outstanding, purchase parties, import purchases, local purchases, payments, and activity logs.
- No stock sheets exist yet.
- Stock sheets must be appended without renaming or removing existing sheets.

## Tests and Verification

Baseline command results:

- `npm run test`: failed under PowerShell because `npm.ps1` is blocked by execution policy.
- `npm.cmd run test`: passed, 22 tests, 22 pass, 0 fail.

Existing tests are domain-focused and do not cover:

- stock calculations
- company-scoped stock DB resolution
- stock DB cache reset on company switch
- company-scoped inventory setting
- stock line replacement transactions
- stock landed-cost preservation vs allocation
- stock carry-forward idempotency
- closed-year inventory restrictions

## Phase 2 Readiness

Proceed to implementation only after confirming this audit. Recommended next step is to create `MERGED APP/src/stock` from the donor stock module, then immediately adapt storage and settings before wiring the module into the app shell. Do not expose the Inventory module until company-scoped settings and stock database selection are in place.

# Stock Reconciliation Report

Date: 2026-08-03

## Scope

This pass validates stock reconciliation by automated helper tests and code inspection. Full end-to-end document entry in the Tauri UI was not executed.

## Automated Coverage

Passed helper tests cover:

- Stock summary and register rows from opening, purchase, and sales movements.
- Weighted average issue rate for sales.
- Fiscal-year and lifecycle eligibility for stock documents.
- Source identity using document type plus source document id, not bill number alone.
- Import stock allocation to landed cost while preserving entered purchase amounts.
- Carry-forward planning and idempotent target opening updates.
- Transaction rollback wrapper for failed stock document replacement.

Representative result from `npm.cmd run test`:

```text
tests 31
pass 31
fail 0
duration_ms 197.2728
```

## Reconciliation Findings

- Purchase and sales stock identities are keyed by source document type and source id in stock services.
- Duplicate bill numbers do not globally collide in stock status calculations.
- Import purchase stock values use landed cost allocation through `prepareStockPurchaseLinesForDocument`.
- Void and reversed documents are excluded from eligible stock status and carry-forward calculations.
- Sales issue rate is calculated from the stock ledger average rate.

## Not Live-Executed

- Creating purchase stock lines from the purchase UI.
- Creating sales stock lines from the sales UI.
- Editing a source document and verifying transactional stock-line replacement against the live SQLite database.
- Deleting a source document and verifying only that document's stock lines are removed.

## Remaining Risk

The pure calculations and storage transaction wrapper are covered, but live reconciliation still needs a manual Tauri pass against real company data before calling the merge production-ready.

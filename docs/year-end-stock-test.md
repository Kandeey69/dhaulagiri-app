# Year-End Stock Test

Date: 2026-08-03

## Scope

This validates the stock side of year-end carry-forward through automated service tests and code inspection. The Year End Manager workflow was not clicked through in the live Tauri window.

## Verified By Tests

The test `plans stock carry-forward from eligible closing stock into target openings idempotently` verifies:

- Closing quantities and values are calculated as of the source fiscal-year end date.
- Purchases after the fiscal-year end date are excluded.
- Void purchase documents are excluded.
- Inactive zero-quantity items are skipped.
- Existing target items are updated rather than duplicated.
- Repeating the plan is idempotent at the item-code level.

## Code Paths Inspected

- `src/App.tsx` includes `carryForwardOpenings` and `YearEndManager`.
- `src/stock/services/stockCarryForward.ts` builds stock opening carry-forward plans and writes them through storage.
- `src/stock/storage.ts` exposes `getStockBackupDataForCompany` and `upsertStockOpeningItemsForCompany`.

## Result

Code-level and automated service validation passed.

Live Year End Manager validation remains pending because Tauri UI interaction was not available in this validation environment.

## Manual Follow-Up Required

- Close or soft-close a source fiscal year.
- Create the next fiscal year/company profile through the Year End Manager.
- Confirm stock openings are created once.
- Re-run carry-forward and confirm openings update idempotently instead of duplicating.
- Confirm closed-year documents cannot be financially modified from the UI.

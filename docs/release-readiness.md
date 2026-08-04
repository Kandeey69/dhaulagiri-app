# Release Readiness

Date: 2026-08-03

## Verdict

Build-ready: yes.

Production-ready for user release: not yet. The app starts and packages successfully, and automated tests pass, but the required business workflows were not fully live-executed inside the Tauri UI in this environment.

## Release Gates

| Area | Status | Notes |
| --- | --- | --- |
| Company stock isolation | Automated/code-inspected pass | Company stock DB URLs are per active company and collision-resistant. |
| Fiscal-year isolation | Automated/code-inspected pass | Fiscal-year IDs remain threaded through accounts, purchase, and stock calculations. |
| Closed-year write blocking | Automated pass | Lifecycle/fiscal-year tests cover blocked financial edits and closed-year posting restrictions. |
| Purchase stock integration | Code-inspected, manual pending | Purchase UI has stock preview/entry paths; live creation/edit/delete not executed. |
| Sales stock integration | Code-inspected, manual pending | Sales stock line path exists; live creation/edit/delete not executed. |
| Landed-cost valuation | Automated pass | Import stock line allocation uses landed cost and preserves entered values. |
| Source identity collision prevention | Automated/code-inspected pass | Purchase stock identity uses source document type plus source id. |
| Carry-forward correctness | Automated/code-inspected pass | Closing quantity/value and exclusions are covered by tests. |
| Carry-forward idempotency | Automated pass | Re-run updates target openings instead of duplicating them. |
| Failure recovery | Automated partial pass | Transaction wrapper rollback is tested; full SQLite replacement failure needs live/integration test coverage. |
| Portable backup | Code-inspected, manual pending | v2 includes stock; live export/restore not executed. |
| v1 restore compatibility | Code-inspected, manual pending | v1 accepted without stock; needs manual sample restore. |
| Workbook export | Code-inspected, manual pending | Sheets include stock data; file open/totals check not executed. |
| Runtime SQL preload | Code-inspected pass | Legacy stock preload remains in Tauri config for compatibility. |
| Tauri desktop startup | Startup pass | `npm.cmd run tauri:dev` launched `target\debug\easysolution.exe`. |
| Production Tauri build | Pass | MSI and NSIS bundles produced successfully. |

## Security And Integrity

- Tauri capabilities currently include `core:default`, `sql:default`, and `sql:allow-execute`.
- No file-system, dialog, or shell capability broadening was found in `src-tauri/capabilities/default.json`.
- `sql:allow-execute` is broad but expected for current local SQLite schema/PRAGMA execution. It should be revisited if the app later accepts user-authored SQL.

## Performance Notes

- Vite reports one JavaScript chunk above 500 kB.
- The SQL plugin is both statically and dynamically imported, so the dynamic import does not split it into a separate chunk.
- These are non-blocking build warnings, but they are worth revisiting before a polished public release.

## Required Manual Release Pass

- Run the app from the installed MSI or NSIS build.
- Execute clean company, purchase, sales, stock, year-end, backup/restore, and workbook workflows.
- Reopen the app after each critical workflow and confirm data persists in the expected company context.

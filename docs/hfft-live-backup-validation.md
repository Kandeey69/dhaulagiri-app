# HFFT Live Backup Validation

Updated: 2026-08-11

## Status

PASS

The portable backup was exported from the actual Tauri UI for `Himalaya Fresh Fruit Traders Pvt. Ltd.` FY `2082/83` while the year was locked/closed. The generated file was inspected directly and then restored through the actual UI into disposable recovery profiles.

## Export Evidence

| Field | Value |
|---|---:|
| Path | `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\docs\Himalaya-Fresh-Fruit-Traders-Pvt.-Ltd.-2082-83-backup.easysolution-backup.json` |
| Size | 692,016 bytes |
| Kind | `easysolution-company-backup` |
| Version | 2 |
| Company | Himalaya Fresh Fruit Traders Pvt. Ltd. |
| Fiscal year | 2082/83 |
| Locked | true |
| Stock section | present |
| Track inventory | true |

## Export Reconciliation

| Entity | Count / Total | Result |
|---|---:|---:|
| Customers | 10 | PASS |
| Sales | 180 | PASS |
| Sales revenue | NPR 1,182,600 | PASS |
| Collections | 120 | PASS |
| Collection total | NPR 946,080 | PASS |
| Vendors/agents | 4 | PASS |
| Import purchases | 12 | PASS |
| Local purchases | 24 | PASS |
| Payments | 48 | PASS |
| Purchase ledger rows | 180 | PASS |
| Stock items | 3 | PASS |
| Stock purchase bills | 36 | PASS |
| Stock sales bills | 180 | PASS |

The V2 backup includes company/profile metadata, settings, lifecycle fields, receipt allocations, payment allocations, purchase ledger data, stock items, opening stock, stock purchase/sales bills and lines, source type, source document IDs, landed-cost values, and loading/unloading values.

## Restore Evidence

Initial locked-backup restore exposed `HFFT-UI-ERR-009` and `HFFT-UI-ERR-010`; both were fixed and retested.

Final V2 restore target:

| Field | Value |
|---|---:|
| Company | HFFT Restore Validation Locked Final |
| Profile ID | `hfft-restore-validation-locked-final-208` |
| UI status | Fiscal Year 2082/83 - Closed |
| Accounts DB | `accounts-hfft-restore-validation-locked-final-208.db` |
| Purchase DB | `import-purchases-hfft-restore-validation-locked-final-208.db` |
| Stock DB | `inventorytracked-stock-hfft-restore-validation-locked-f-c08c18f28cc29205.db` |

| Entity | Source | Restored | Difference | Result |
|---|---:|---:|---:|---:|
| Customers | 10 | 10 | 0 | PASS |
| Vendors/agents | 4 | 4 | 0 | PASS |
| Sales | 180 | 180 | 0 | PASS |
| Collections | 120 | 120 | 0 | PASS |
| Receipt allocations | 240 | 240 | 0 | PASS |
| Import purchases | 12 | 12 | 0 | PASS |
| Local purchases | 24 | 24 | 0 | PASS |
| Payments | 48 | 48 | 0 | PASS |
| Payment allocations | 12 | 12 | 0 | PASS |
| Stock items | 3 | 3 | 0 | PASS |
| Stock purchase bills | 36 | 36 | 0 | PASS |
| Stock purchase lines | 36 | 36 | 0 | PASS |
| Stock sales bills | 180 | 180 | 0 | PASS |
| Stock sales lines | 540 | 540 | 0 | PASS |

| Total | Source | Restored | Result |
|---|---:|---:|---:|
| Sales | 1,182,600 | 1,182,600 | PASS |
| Collections | 946,080 | 946,080 | PASS |
| Import landed cost | 273,600 | 273,600 | PASS |
| Local purchase total | 388,800 | 388,800 | PASS |
| Payments | 498,480 | 498,480 | PASS |
| Stock purchase qty | 4,800 KG | 4,800 KG | PASS |
| Stock sales qty | 5,940 KG | 5,940 KG | PASS |

Fiscal-year IDs were remapped to the restored profile in both accounts and purchase DBs. Both account and purchase fiscal-year rows are `CLOSED`. Stock source types remain split between `Import Purchase` and `Local Purchase`; no orphan stock purchase/sales lines were found. SQLite integrity checks returned `ok` for accounts, purchase, and stock.

## Synthetic V1 Compatibility Test

SYNTHETIC V1 COMPATIBILITY TEST

A labelled V1 fixture was created from the exported HFFT backup by setting `version = 1`, removing the `stock` section, and changing only the company name to `HFFT Synthetic V1 Compatibility`.

| Check | Actual | Result |
|---|---|---:|
| Restore through UI | Imported backup as HFFT Synthetic V1 Compatibility FY 2082/83 | PASS |
| Missing stock section | Accepted for version 1 | PASS |
| Financial data | 10 customers, 180 sales, 120 collections, 4 vendors, 12 imports, 24 locals, 48 payments | PASS |
| Stock fabrication | No stock DB created | PASS |
| Locked status | Restored as closed | PASS |
| Integrity | Accounts and purchase `pragma integrity_check = ok` | PASS |

This is synthetic compatibility evidence only; no real historical V1 customer backup was available in the workspace.

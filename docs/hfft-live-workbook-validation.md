# HFFT Live Workbook Validation

Updated: 2026-08-11

## Status

PASS

The full HFFT workbook was exported through the actual Tauri UI from `Himalaya Fresh Fruit Traders Pvt. Ltd.` FY `2082/83` after workbook export was fixed to include payables and landed-cost component fields.

## Export Evidence

| Field | Value |
|---|---:|
| Path | `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\docs\Himalaya-Fresh-Fruit-Traders-Pvt.-Ltd.-2082-83-complete-data.xls` |
| Size | 916,198 bytes |
| Format | Excel XML workbook (`.xls`) |
| UI message | Exported workbook for Himalaya Fresh Fruit Traders Pvt. Ltd. FY 2082/83. |

## Workbook Structure

| Sheet | Data rows | Result |
|---|---:|---:|
| Company | 8 | PASS |
| Account Parties | 10 | PASS |
| Sales | 180 | PASS |
| Collections | 120 | PASS |
| Credit Notes | 0 | PASS |
| Receivable Outstanding | 10 | PASS |
| Purchase Parties | 4 | PASS |
| Payable Outstanding | 4 | PASS |
| Import Purchases | 12 | PASS |
| Local Purchases | 24 | PASS |
| Payments | 48 | PASS |
| Account Activity Logs | 1 | PASS |
| Purchase Activity Logs | 1 | PASS |
| Stock Item Master | 3 | PASS |
| Stock Purchase Lines | 36 | PASS |
| Stock Sales Lines | 540 | PASS |
| Stock Summary | 3 | PASS |
| Stock Register | 579 | PASS |
| Inventory Valuation | 3 | PASS |
| Opening Stock | 3 | PASS |

## Oracle Reconciliation

| Total | Workbook | Oracle | Result |
|---|---:|---:|---:|
| Sales revenue | 1,182,600 | 1,182,600 | PASS |
| Collections | 946,080 | 946,080 | PASS |
| Receivables | 306,520 | 306,520 | PASS |
| Payables | 251,920 | 251,920 | PASS |
| Apple closing qty | 440 KG | 440 KG | PASS |
| Mango closing qty | 460 KG | 460 KG | PASS |
| Lemon closing qty | 460 KG | 460 KG | PASS |
| Total stock qty | 1,360 KG | 1,360 KG | PASS |
| Inventory value | 180,078.1383839345 | approx. 180,078.14 | PASS |

## Landed-Cost Fields

The `Import Purchases` sheet includes `sourceDocumentId`, `totalKg`, `loadingUnloadingChargePerKg`, `loadingUnloadingChargeNPR`, `debitNoteTotalNPR`, `totalAgentPayableNPR`, and `landedCostNPR`.

Sample Apple import rows show quantity `120 KG`, supplier NPR `21,120`, loading/unloading `180`, debit-note total `1,680`, total agent payable `1,680`, and landed cost `22,800`.

The `Stock Purchase Lines` sheet preserves source document IDs and source types for both `Import Purchase` and `Local Purchase`. Fiscal-year and company labels are present on stock sheets.

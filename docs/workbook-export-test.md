# Workbook Export Test

Date: 2026-08-03

## Scope

This validates workbook export by code inspection and production build. The generated workbook file was not opened in Excel during this pass.

## Current Design

`exportSelectedCompanyWorkbook` builds an Excel XML workbook from the selected company context. The workbook includes separate sheets for company profile, parties, sales, collections, credit notes, purchase parties, import purchases, local expenses, supplier payments, payment allocations, ledger entries, stock items, stock purchase bills, stock purchase lines, stock sales bills, and stock sales lines.

Stock data is loaded through `getStockBackupDataForCompany(company.id)`, so the workbook uses the selected company's stock database rather than the legacy default database.

## Result

Code inspection and build passed.

Live download/open validation remains pending.

## Manual Follow-Up Required

- Export a workbook from the desktop app.
- Open it in Excel or LibreOffice.
- Verify each sheet is present.
- Check totals against the in-app reports for the same company and fiscal year.
- Confirm a second company exports different stock rows when its stock database differs.

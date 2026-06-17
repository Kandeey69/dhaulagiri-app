import { useState } from "react";
import {
  getParties,
  logActivity,
  saveCollection,
  saveParty,
  saveSale,
} from "../data/storage";
import { downloadXlsx, readXlsxRows } from "../utils/xlsx";

type ImportResult = {
  importedCount: number;
  skippedRows: string[];
};

type ImportCardProps = {
  canManage: boolean;
  title: string;
  description: string;
  sampleFilename: string;
  sampleRows: (string | number)[][];
  onImport: (rows: string[][]) => Promise<ImportResult>;
};

const PARTY_SAMPLE_ROWS = [
  ["Party Name", "Phone", "PAN/VAT No.", "Opening Balance", "Address"],
  ["ABC Traders", "9800000000", "600000001", 25000, "Kathmandu"],
  ["Himal Suppliers", "9811111111", "600000002", 0, "Pokhara"],
];

const SALES_SAMPLE_ROWS = [
  ["Bill No.", "Date BS", "Party Name", "Sales Amount", "Remarks"],
  [1, "2081/04/01", "ABC Traders", 10000, "Opening sale"],
  [2, "2081/04/02", "Himal Suppliers", 15000, ""],
];

const COLLECTION_SAMPLE_ROWS = [
  ["Date BS", "Party Name", "Bank/Cash", "Receipt No.", "Amount", "Remarks"],
  ["2081/04/05", "ABC Traders", "Cash", 1, 5000, "First receipt"],
  ["2081/04/06", "Himal Suppliers", "Nabil Bank", 2, 7500, ""],
];

type ImportsProps = {
  canManage: boolean;
};

export default function Imports({ canManage }: ImportsProps) {
  return (
    <>
      <h1>Import Data</h1>
      <p className="muted import-intro">
        Import is available only in Master mode. Sales and collections use Party Name,
        so import parties first.
      </p>

      {!canManage && (
        <p className="status-message">
          Account users cannot import data. Unlock Master access in Settings to use imports.
        </p>
      )}

      <div className="import-grid">
        <ImportCard
          canManage={canManage}
          title="Import Parties"
          description="Party Name is required. Phone, PAN/VAT, opening balance, and address are optional."
          sampleFilename="party-import-sample.xlsx"
          sampleRows={PARTY_SAMPLE_ROWS}
          onImport={importParties}
        />

        <ImportCard
          canManage={canManage}
          title="Import Sales"
          description="Bill No., Date BS, Party Name, and Sales Amount are required."
          sampleFilename="sales-import-sample.xlsx"
          sampleRows={SALES_SAMPLE_ROWS}
          onImport={importSales}
        />

        <ImportCard
          canManage={canManage}
          title="Import Collections"
          description="Date BS, Party Name, Bank/Cash, Receipt No., and Amount are required."
          sampleFilename="collections-import-sample.xlsx"
          sampleRows={COLLECTION_SAMPLE_ROWS}
          onImport={importCollections}
        />
      </div>
    </>
  );
}

function ImportCard({
  canManage,
  title,
  description,
  sampleFilename,
  sampleRows,
  onImport,
}: ImportCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState("");

  async function handleImport() {
    setMessage("");

    if (!canManage) {
      setMessage("Master access is required to import data.");
      return;
    }

    if (!file) {
      setMessage("Please choose an Excel file to import.");
      return;
    }

    setIsImporting(true);

    try {
      const rows = await readXlsxRows(file);
      const dataRows = rows
        .slice(1)
        .filter((row) => row.some((cell) => String(cell ?? "").trim()));
      const result = await onImport(dataRows);
      await logActivity(
        "Data Imported",
        `${title}: imported ${result.importedCount}, skipped ${result.skippedRows.length}.`
      );
      setFile(null);

      if (result.skippedRows.length > 0) {
        setMessage(
          `Imported ${result.importedCount}. Skipped ${result.skippedRows.join("; ")}.`
        );
      } else {
        setMessage(`Imported ${result.importedCount} successfully.`);
      }
    } catch (error) {
      console.error(`${title} error:`, error);
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to import file.")
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="card import-card">
      <div>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>

      <div className="action-buttons import-actions">
        <button
          className="primary"
          disabled={!canManage}
          onClick={() => downloadXlsx(sampleFilename, title, sampleRows)}
        >
          Save Sample Excel
        </button>

        <label className="file-button">
          Choose Excel File
          <input
            accept=".xlsx"
            disabled={!canManage}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <button
          className="secondary"
          disabled={isImporting || !canManage}
          onClick={handleImport}
        >
          {isImporting ? "Importing..." : "Import"}
        </button>
      </div>

      {file && <p className="muted selected-file">Selected: {file.name}</p>}
      {message && <p className="status-message import-message">{message}</p>}
    </div>
  );
}

async function importParties(rows: string[][]): Promise<ImportResult> {
  let importedCount = 0;
  const skippedRows: string[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const partyName = cell(row, 0);
    const openingBalance = numberCell(row, 3, 0);

    if (!partyName) {
      skippedRows.push(`row ${rowNumber}: party name is required`);
      continue;
    }

    if (openingBalance === null) {
      skippedRows.push(`row ${rowNumber}: opening balance must be a number`);
      continue;
    }

    try {
      await saveParty({
        name: partyName,
        phone: cell(row, 1),
        panNo: cell(row, 2),
        openingBalance,
        address: cell(row, 4),
        isActive: true,
      });
      importedCount += 1;
    } catch (error) {
      skippedRows.push(rowError(rowNumber, error));
    }
  }

  return { importedCount, skippedRows };
}

async function importSales(rows: string[][]): Promise<ImportResult> {
  const parties = await getParties();
  let importedCount = 0;
  const skippedRows: string[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const billNo = cell(row, 0);
    const dateBs = dateCell(row, 1);
    const partyName = cell(row, 2);
    const salesAmount = numberCell(row, 3);
    const party = findPartyByName(parties, partyName);

    if (!billNo || !/^\d+$/.test(billNo)) {
      skippedRows.push(`row ${rowNumber}: bill number must be a whole number`);
      continue;
    }

    if (!dateBs) {
      skippedRows.push(`row ${rowNumber}: Date BS is required`);
      continue;
    }

    if (!party) {
      skippedRows.push(`row ${rowNumber}: party "${partyName || "blank"}" was not found`);
      continue;
    }

    if (salesAmount === null || salesAmount <= 0) {
      skippedRows.push(`row ${rowNumber}: sales amount must be greater than zero`);
      continue;
    }

    try {
      const vatAmount = Number((salesAmount * 0.13).toFixed(2));
      const totalAmount = Number((salesAmount + vatAmount).toFixed(2));

      await saveSale({
        billNo,
        dateBs,
        partyId: party.id,
        salesAmount,
        vatAmount,
        totalAmount,
        remarks: cell(row, 4),
      });
      importedCount += 1;
    } catch (error) {
      skippedRows.push(rowError(rowNumber, error));
    }
  }

  return { importedCount, skippedRows };
}

async function importCollections(rows: string[][]): Promise<ImportResult> {
  const parties = await getParties();
  let importedCount = 0;
  const skippedRows: string[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const dateBs = dateCell(row, 0);
    const partyName = cell(row, 1);
    const bankName = cell(row, 2);
    const receiptNo = cell(row, 3);
    const amount = numberCell(row, 4);
    const party = findPartyByName(parties, partyName);

    if (!dateBs) {
      skippedRows.push(`row ${rowNumber}: Date BS is required`);
      continue;
    }

    if (!party) {
      skippedRows.push(`row ${rowNumber}: party "${partyName || "blank"}" was not found`);
      continue;
    }

    if (!bankName) {
      skippedRows.push(`row ${rowNumber}: Bank/Cash is required`);
      continue;
    }

    if (!receiptNo || !/^\d+$/.test(receiptNo)) {
      skippedRows.push(`row ${rowNumber}: receipt number must be a whole number`);
      continue;
    }

    if (amount === null || amount <= 0) {
      skippedRows.push(`row ${rowNumber}: amount must be greater than zero`);
      continue;
    }

    try {
      await saveCollection({
        dateBs,
        partyId: party.id,
        bankName,
        amount,
        receiptNo,
        remarks: cell(row, 5),
      });
      importedCount += 1;
    } catch (error) {
      skippedRows.push(rowError(rowNumber, error));
    }
  }

  return { importedCount, skippedRows };
}

function cell(row: string[], index: number) {
  return String(row[index] ?? "").trim();
}

function dateCell(row: string[], index: number) {
  const value = cell(row, index);
  const serial = Number(value);

  if (/^\d+(\.\d+)?$/.test(value) && serial >= 20000 && serial <= 100000) {
    return excelSerialDate(serial);
  }

  return value;
}

function excelSerialDate(serial: number) {
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + Math.round(serial) * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function numberCell(row: string[], index: number, fallback?: number) {
  const value = cell(row, index);

  if (!value && fallback !== undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function findPartyByName(parties: Awaited<ReturnType<typeof getParties>>, name: string) {
  const target = name.trim().toLowerCase();
  return parties.find((party) => party.name.trim().toLowerCase() === target);
}

function rowError(rowNumber: number, error: unknown) {
  return `row ${rowNumber}: ${
    error instanceof Error ? error.message : String(error || "failed to import")
  }`;
}

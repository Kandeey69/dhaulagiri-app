import { useState } from "react";
import {
  getParties,
  logActivity,
  saveCollection,
  saveParty,
  saveSale,
} from "../data/storage";
import { saveBlob } from "../utils/fileSave";

type ImportDetail = {
  status: "Imported" | "Skipped";
  line: number;
  module: string;
  primary: string;
  secondary: string;
  amount: number | null;
  remarks: string;
};

type ImportResult = {
  importedCount: number;
  skippedRows: string[];
  details: ImportDetail[];
};

type ImportPanelProps = {
  canManage: boolean;
  title: string;
  description: string;
  fileLabel: string;
  templateButton: string;
  importButton: string;
  templateFilename: string;
  templateRows: string[][];
  onImport: (rows: string[][]) => Promise<ImportResult>;
  onImportComplete: (title: string, result: ImportResult) => void;
};

const PARTY_SAMPLE_ROWS = [
  ["Party Name", "Phone", "PAN/VAT No.", "Opening Balance", "Address"],
  ["ABC Traders", "9800000000", "600000001", "25000", "Kathmandu"],
  ["Himal Suppliers", "9811111111", "600000002", "0", "Pokhara"],
];

const SALES_SAMPLE_ROWS = [
  ["Bill No.", "Date BS", "Party Name", "Sales Amount", "Remarks"],
  ["1", "2081/04/01", "ABC Traders", "10000", "Opening sale"],
  ["2", "2081/04/02", "Himal Suppliers", "15000", ""],
];

const COLLECTION_SAMPLE_ROWS = [
  ["Date BS", "Party Name", "Bank/Cash", "Receipt No.", "Amount", "Remarks"],
  ["2081/04/05", "ABC Traders", "Cash", "1", "5000", "First receipt"],
  ["2081/04/06", "Himal Suppliers", "Nabil Bank", "2", "7500", ""],
];

type ImportsProps = {
  canManage: boolean;
};

export default function Imports({ canManage }: ImportsProps) {
  const [importMessage, setImportMessage] = useState("");
  const [importResults, setImportResults] = useState<ImportDetail[]>([]);

  function handleImportComplete(title: string, result: ImportResult) {
    setImportResults(result.details);
    setImportMessage(
      `${title}: imported ${result.importedCount}, skipped ${result.skippedRows.length}.`,
    );
  }

  return (
    <div className="stack">
      <h1>Import Data</h1>
      <p className="muted import-intro">
        Import is available only in Master mode. Sales and collections use Party Name,
        so import parties first.
      </p>

      {!canManage && (
        <p className="status-message">
          Account users cannot import data. Unlock Master access to use imports.
        </p>
      )}

      <ImportPanel
        canManage={canManage}
        title="Party Master Import"
        description="Party Name is required. Phone, PAN/VAT, opening balance, and address are optional."
        fileLabel="Select party CSV file"
        templateButton="Download party template"
        importButton="Import party master"
        templateFilename={`party-master-template_${todayForFileName()}.csv`}
        templateRows={PARTY_SAMPLE_ROWS}
        onImport={importParties}
        onImportComplete={handleImportComplete}
      />

      <ImportPanel
        canManage={canManage}
        title="Sales Entry Import"
        description="Bill No., Date BS, Party Name, and Sales Amount are required."
        fileLabel="Select sales CSV file"
        templateButton="Download sales template"
        importButton="Import sales"
        templateFilename={`sales-entry-template_${todayForFileName()}.csv`}
        templateRows={SALES_SAMPLE_ROWS}
        onImport={importSales}
        onImportComplete={handleImportComplete}
      />

      <ImportPanel
        canManage={canManage}
        title="Collection Entry Import"
        description="Date BS, Party Name, Bank/Cash, Receipt No., and Amount are required."
        fileLabel="Select collection CSV file"
        templateButton="Download collection template"
        importButton="Import collections"
        templateFilename={`collection-entry-template_${todayForFileName()}.csv`}
        templateRows={COLLECTION_SAMPLE_ROWS}
        onImport={importCollections}
        onImportComplete={handleImportComplete}
      />

      {importMessage && (
        <div className="card import-result-card">
          <h3>Import Result</h3>
          <p>{importMessage}</p>
          <ResultTable
            headers={["Status", "Line", "Module", "Primary", "Details", "Amount", "Remarks"]}
            rows={importResults.map((row) => [
              row.status,
              row.line.toString(),
              row.module,
              row.primary,
              row.secondary,
              row.amount === null ? "-" : money(row.amount),
              row.remarks,
            ])}
          />
        </div>
      )}
    </div>
  );
}

function ImportPanel({
  canManage,
  title,
  description,
  fileLabel,
  templateButton,
  importButton,
  templateFilename,
  templateRows,
  onImport,
  onImportComplete,
}: ImportPanelProps) {
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
      setMessage(`${fileLabel} first.`);
      return;
    }

    if (!isCsvFile(file)) {
      setMessage("Only CSV files can be imported.");
      return;
    }

    setIsImporting(true);

    try {
      const rows = parseCsvRows(await file.text());
      const dataRows = rows
        .slice(1)
        .filter((row) => row.some((value) => String(value ?? "").trim()));
      const result = await onImport(dataRows);

      await logActivity(
        "Data Imported",
        `${title}: imported ${result.importedCount}, skipped ${result.skippedRows.length}.`,
      );

      setFile(null);
      setMessage("");
      onImportComplete(title, result);
    } catch (error) {
      console.error(`${title} error:`, error);
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to import CSV file."),
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="card import-panel">
      <div>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>

      <div className="import-form-grid">
        <label className="readonly">
          <span>Template format</span>
          <strong>CSV file</strong>
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="primary"
            disabled={!canManage}
            onClick={() => downloadCsv(templateFilename, templateRows)}
          >
            {templateButton}
          </button>
        </div>

        <label>
          {fileLabel}
          <input
            accept=".csv"
            disabled={!canManage}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={isImporting || !canManage}
            onClick={handleImport}
          >
            {isImporting ? "Importing..." : importButton}
          </button>
        </div>
      </div>

      {file && <p className="muted selected-file">Selected: {file.name}</p>}
      {message && <p className="status-message import-message">{message}</p>}
    </div>
  );
}

async function importParties(rows: string[][]): Promise<ImportResult> {
  let importedCount = 0;
  const skippedRows: string[] = [];
  const details: ImportDetail[] = [];

  for (const [index, rawRow] of rows.entries()) {
    const line = index + 2;
    const row = normalizeRowLength(rawRow, 5, [3]);
    const partyName = cell(row, 0);
    const openingBalance = numberCell(row, 3, 0);

    if (!partyName) {
      addSkipped(details, skippedRows, line, "Party Master", "-", "-", null, "party name is required");
      continue;
    }

    if (openingBalance === null) {
      addSkipped(details, skippedRows, line, "Party Master", partyName, "-", null, "opening balance must be a number");
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
      details.push({
        status: "Imported",
        line,
        module: "Party Master",
        primary: partyName,
        secondary: `${cell(row, 1) || "-"} / PAN ${cell(row, 2) || "-"}`,
        amount: openingBalance,
        remarks: cell(row, 4) || "Imported",
      });
    } catch (error) {
      addSkipped(details, skippedRows, line, "Party Master", partyName, "-", openingBalance, errorText(error));
    }
  }

  return { importedCount, skippedRows, details };
}

async function importSales(rows: string[][]): Promise<ImportResult> {
  const parties = await getParties();
  let importedCount = 0;
  const skippedRows: string[] = [];
  const details: ImportDetail[] = [];

  for (const [index, rawRow] of rows.entries()) {
    const line = index + 2;
    const row = normalizeRowLength(rawRow, 5, [3]);
    const billNo = wholeNumberCell(row, 0);
    const dateBs = normalizeImportDate(cell(row, 1));
    const partyName = cell(row, 2);
    const salesAmount = numberCell(row, 3);
    const party = findPartyByName(parties, partyName);
    const primary = billNo ? `Bill ${billNo}` : "-";
    const secondary = `${partyName || "-"} / ${dateBs || "-"}`;

    if (!billNo) {
      addSkipped(details, skippedRows, line, "Sales Entry", primary, secondary, salesAmount, "bill number must be a whole number");
      continue;
    }

    if (!dateBs) {
      addSkipped(details, skippedRows, line, "Sales Entry", primary, secondary, salesAmount, "Date BS is required");
      continue;
    }

    if (!isBsDate(dateBs)) {
      addSkipped(
        details,
        skippedRows,
        line,
        "Sales Entry",
        primary,
        secondary,
        salesAmount,
        "Date BS must be column 2 in YYYY/MM/DD or YYYY-MM-DD format. Expected columns: Bill No., Date BS, Party Name, Sales Amount, Remarks",
      );
      continue;
    }

    if (!party) {
      addSkipped(details, skippedRows, line, "Sales Entry", primary, secondary, salesAmount, `party "${partyName || "blank"}" was not found`);
      continue;
    }

    if (salesAmount === null || salesAmount < 0) {
      addSkipped(details, skippedRows, line, "Sales Entry", primary, secondary, salesAmount, "sales amount must be zero or greater");
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
      details.push({
        status: "Imported",
        line,
        module: "Sales Entry",
        primary,
        secondary,
        amount: totalAmount,
        remarks: cell(row, 4) || "Imported",
      });
    } catch (error) {
      addSkipped(details, skippedRows, line, "Sales Entry", primary, secondary, salesAmount, errorText(error));
    }
  }

  return { importedCount, skippedRows, details };
}

async function importCollections(rows: string[][]): Promise<ImportResult> {
  const parties = await getParties();
  let importedCount = 0;
  const skippedRows: string[] = [];
  const details: ImportDetail[] = [];

  for (const [index, rawRow] of rows.entries()) {
    const line = index + 2;
    const row = normalizeRowLength(rawRow, 6, [4]);
    const dateBs = normalizeImportDate(cell(row, 0));
    const partyName = cell(row, 1);
    const bankName = cell(row, 2);
    const receiptNo = wholeNumberCell(row, 3);
    const amount = numberCell(row, 4);
    const party = findPartyByName(parties, partyName);
    const primary = receiptNo ? `Receipt ${receiptNo}` : "-";
    const secondary = `${partyName || "-"} / ${dateBs || "-"} / ${bankName || "-"}`;

    if (!dateBs) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, "Date BS is required");
      continue;
    }

    if (!isBsDate(dateBs)) {
      addSkipped(
        details,
        skippedRows,
        line,
        "Collection Entry",
        primary,
        secondary,
        amount,
        "Date BS must be column 1 in YYYY/MM/DD or YYYY-MM-DD format. Expected columns: Date BS, Party Name, Bank/Cash, Receipt No., Amount, Remarks",
      );
      continue;
    }

    if (!party) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, `party "${partyName || "blank"}" was not found`);
      continue;
    }

    if (!bankName) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, "Bank/Cash is required");
      continue;
    }

    if (!receiptNo) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, "receipt number must be a whole number");
      continue;
    }

    if (amount === null || amount < 0) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, "amount must be zero or greater");
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
      details.push({
        status: "Imported",
        line,
        module: "Collection Entry",
        primary,
        secondary,
        amount,
        remarks: cell(row, 5) || "Imported",
      });
    } catch (error) {
      addSkipped(details, skippedRows, line, "Collection Entry", primary, secondary, amount, errorText(error));
    }
  }

  return { importedCount, skippedRows, details };
}

function addSkipped(
  details: ImportDetail[],
  skippedRows: string[],
  line: number,
  module: string,
  primary: string,
  secondary: string,
  amount: number | null,
  remarks: string,
) {
  skippedRows.push(`line ${line}: ${remarks}`);
  details.push({
    status: "Skipped",
    line,
    module,
    primary,
    secondary,
    amount,
    remarks,
  });
}

function cell(row: string[], index: number) {
  return String(row[index] ?? "").trim();
}

function numberCell(row: string[], index: number, fallback?: number) {
  const value = cell(row, index);

  if (!value && fallback !== undefined) {
    return fallback;
  }

  const parsed = parseNumber(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function wholeNumberCell(row: string[], index: number) {
  const parsed = parseNumber(cell(row, index));

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "";
  }

  return String(parsed);
}

function normalizeImportDate(value: string) {
  const raw = value.trim();
  const serial = parseNumber(raw);

  if (!Number.isNaN(serial) && serial >= 20000 && serial <= 100000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + Math.round(serial) * 86400000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  return normalizeDateParts(raw) || raw;
}

function isBsDate(value: string) {
  return Boolean(normalizeDateParts(value));
}

function normalizeDateParts(value: string) {
  const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);

  if (!match) {
    return "";
  }

  const [, year, monthText, dayText] = match;
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > 32) {
    return "";
  }

  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function parseNumber(value: string) {
  let normalized = value
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/,/g, "")
    .replace(/(?:rs\.?|npr|रु\.?)/gi, "");
  let multiplier = 1;

  if (!normalized || /^-+$/.test(normalized)) {
    return 0;
  }

  if (/^\(.+\)$/.test(normalized)) {
    multiplier = -1;
    normalized = normalized.slice(1, -1).trim();
  }

  if (/\b(cr|credit)\b/i.test(normalized)) {
    multiplier = -1;
  }

  normalized = normalized
    .replace(/\b(dr|debit|cr|credit)\b/gi, "")
    .replace(/\s+/g, "");

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  return Number(normalized) * multiplier;
}

function normalizeRowLength(row: string[], expectedLength: number, numericColumns: number[]) {
  const nextRow = [...row];

  for (const column of numericColumns) {
    while (
      nextRow.length > expectedLength &&
      canMergeNumericFragments(nextRow[column], nextRow[column + 1])
    ) {
      nextRow[column] = `${nextRow[column]},${nextRow[column + 1]}`;
      nextRow.splice(column + 1, 1);
    }
  }

  return nextRow;
}

function canMergeNumericFragments(left: string | undefined, right: string | undefined) {
  const merged = `${String(left ?? "").trim()},${String(right ?? "").trim()}`;
  return !Number.isNaN(parseNumber(merged));
}

function findPartyByName(parties: Awaited<ReturnType<typeof getParties>>, name: string) {
  const target = name.trim().toLowerCase();
  return parties.find((party) => party.name.trim().toLowerCase() === target);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "failed to import");
}

function isCsvFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv");
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cellValue = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      cellValue += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cellValue.trim());
      cellValue = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(cellValue.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cellValue = "";
    } else {
      cellValue += char;
    }
  }

  row.push(cellValue.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

async function downloadCsv(fileName: string, rows: string[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  await saveBlob(fileName, blob, {
    description: "CSV File",
    mimeType: "text/csv",
    extensions: [".csv"],
  });
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const todayForFileName = () => new Date().toISOString().slice(0, 10);

function money(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ResultTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{value || "-"}</td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="empty" colSpan={headers.length}>
                No import rows to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

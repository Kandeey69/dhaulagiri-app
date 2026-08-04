import { useMemo } from "react";
import StockTable from "./StockTable";
import StatusBadge from "./StatusBadge";
import { docKey, documentAmount, money } from "../services/stockCalculations";
import type { StockDocumentStatus } from "../types";

type PendingDocumentsProps = {
  onEdit: (row: StockDocumentStatus) => void;
  rows: StockDocumentStatus[];
  selectedKey?: string;
};

export default function PendingDocuments({ onEdit, rows, selectedKey = "" }: PendingDocumentsProps) {
  const tableRows = useMemo(
    () => rows.map((row) => [
      row.type,
      row.date || "-",
      row.billNo,
      row.partyName,
      documentAmount(row),
      <StatusBadge isSelected={docKey(row) === selectedKey} status={row.status} />,
      String(row.lineCount),
      money(row.lineValue),
      <div className="stock-row-actions">
        <button type="button" onClick={() => onEdit(row)}>
          {row.status === "Entered" ? "Edit" : "Enter"}
        </button>
      </div>,
    ]),
    [onEdit, rows, selectedKey],
  );

  return (
    <StockTable
      headers={["Type", "Date", "Bill", "Party", "Bill Amount", "Status", "Lines", "Line Value", "Actions"]}
      rows={tableRows}
    />
  );
}

import { useMemo } from "react";
import StatusBadge from "./StatusBadge";
import StockTable from "./StockTable";
import {
  docKey,
  documentAmount,
  money,
} from "../services/stockCalculations";
import type { StockDocumentStatus } from "../types";

type AllocationRegisterProps = {
  counterpartyLabel: string;
  emptyText: string;
  onEditDocument: (row: StockDocumentStatus) => void;
  rows: StockDocumentStatus[];
  selectedKey: string;
  title: string;
};

export default function AllocationRegister({
  counterpartyLabel,
  emptyText,
  onEditDocument,
  rows,
  selectedKey,
  title,
}: AllocationRegisterProps) {
  const enteredRows = useMemo(
    () => rows.filter((row) => row.status === "Entered"),
    [rows],
  );
  const tableRows = useMemo(
    () => enteredRows.map((row) => {
      const isSelected = docKey(row) === selectedKey;
      return [
        row.date || "-",
        row.billNo,
        row.partyName,
        documentAmount(row),
        String(row.lineCount),
        money(row.lineValue),
        <StatusBadge isSelected={isSelected} status={row.status} />,
        <div className="stock-row-actions">
          <button type="button" onClick={() => onEditDocument(row)}>
            Edit
          </button>
        </div>,
      ];
    }),
    [enteredRows, onEditDocument, selectedKey],
  );

  return (
    <section className="stock-panel stock-allocation-register">
      <div className="stock-section-heading">
        <div>
          <p className="eyebrow">Entered Inventory Lines</p>
          <h3>{title}</h3>
        </div>
        <span className="stock-master-count">{enteredRows.length}</span>
      </div>
      <StockTable
        emptyText={emptyText}
        headers={["Date", "Bill", counterpartyLabel, "Bill Amount", "Lines", "Line Value", "Status", "Action"]}
        rows={tableRows}
      />
    </section>
  );
}

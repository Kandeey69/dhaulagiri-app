import { useMemo, useState } from "react";
import StatusBadge from "./StatusBadge";
import StockTable from "./StockTable";
import {
  docKey,
  documentAmount,
  money,
} from "../services/stockCalculations";
import type { StockDocumentStatus } from "../types";

type AllocationRegisterSortKey = "date" | "billNo" | "partyName" | "amount" | "lineCount" | "lineValue" | "status";
type SortDirection = "asc" | "desc";

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
  const [sort, setSort] = useState<{ key: AllocationRegisterSortKey; direction: SortDirection }>({
    key: "date",
    direction: "desc",
  });
  const enteredRows = useMemo(
    () => rows.filter((row) => row.status === "Entered"),
    [rows],
  );
  const sortedRows = useMemo(
    () => [...enteredRows].sort((left, right) => compareRegisterRows(left, right, sort.key, sort.direction)),
    [enteredRows, sort.direction, sort.key],
  );
  const tableRows = useMemo(
    () => sortedRows.map((row) => {
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
    [onEditDocument, selectedKey, sortedRows],
  );
  const headers = useMemo(
    () => [
      sortableHeader("date", "Date", sort, setSort),
      sortableHeader("billNo", "Bill", sort, setSort),
      sortableHeader("partyName", counterpartyLabel, sort, setSort),
      sortableHeader("amount", "Bill Amount", sort, setSort),
      sortableHeader("lineCount", "Lines", sort, setSort),
      sortableHeader("lineValue", "Line Value", sort, setSort),
      sortableHeader("status", "Status", sort, setSort),
      "Action",
    ],
    [counterpartyLabel, sort],
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
        headers={headers}
        rows={tableRows}
      />
    </section>
  );
}

function sortableHeader(
  key: AllocationRegisterSortKey,
  label: string,
  sort: { key: AllocationRegisterSortKey; direction: SortDirection },
  setSort: (value: { key: AllocationRegisterSortKey; direction: SortDirection }) => void,
) {
  const isActive = sort.key === key;
  const direction = isActive ? sort.direction : "asc";
  return {
    ariaSort: isActive ? (sort.direction === "asc" ? "ascending" as const : "descending" as const) : "none" as const,
    content: (
      <button
        type="button"
        className="sortable-table-header"
        onClick={() => setSort({
          key,
          direction: isActive && sort.direction === "asc" ? "desc" : "asc",
        })}
      >
        {label}
        <span aria-hidden="true">{isActive ? (direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
        <span className="sr-only">
          {isActive ? ` sorted ${direction === "asc" ? "ascending" : "descending"}` : " sort column"}
        </span>
      </button>
    ),
    key,
  };
}

function compareRegisterRows(
  left: StockDocumentStatus,
  right: StockDocumentStatus,
  key: AllocationRegisterSortKey,
  direction: SortDirection,
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const numericKeys = new Set<AllocationRegisterSortKey>(["billNo", "amount", "lineCount", "lineValue"]);

  if (numericKeys.has(key)) {
    const leftValue = registerNumericValue(left, key);
    const rightValue = registerNumericValue(right, key);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
      const numericCompare = leftValue - rightValue;
      if (numericCompare !== 0) return numericCompare * directionMultiplier;
    } else {
      const textCompare = registerTextValue(left, key).localeCompare(registerTextValue(right, key));
      if (textCompare !== 0) return textCompare * directionMultiplier;
    }
  } else {
    const textCompare = registerTextValue(left, key).localeCompare(registerTextValue(right, key));
    if (textCompare !== 0) return textCompare * directionMultiplier;
  }

  return (left.date || "").localeCompare(right.date || "")
    || Number(left.billNo || 0) - Number(right.billNo || 0)
    || docKey(left).localeCompare(docKey(right));
}

function registerNumericValue(row: StockDocumentStatus, key: AllocationRegisterSortKey) {
  if (key === "billNo") return Number(row.billNo || 0);
  if (key === "amount") return Number(row.amountNpr ?? row.amount ?? 0);
  if (key === "lineCount") return Number(row.lineCount || 0);
  if (key === "lineValue") return Number(row.lineValue || 0);
  return 0;
}

function registerTextValue(row: StockDocumentStatus, key: AllocationRegisterSortKey) {
  if (key === "date") return row.date || "";
  if (key === "billNo") return row.billNo || "";
  if (key === "partyName") return row.partyName || "";
  if (key === "status") return row.status || "";
  return "";
}

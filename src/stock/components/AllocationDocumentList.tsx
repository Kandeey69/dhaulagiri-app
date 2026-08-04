import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import StatusBadge from "./StatusBadge";
import { docKey } from "../services/stockCalculations";
import type { StockDocumentStatus } from "../types";

type AllocationDocumentListProps = {
  emptyText: string;
  eyebrow: string;
  onSelectDocument: (row: StockDocumentStatus) => void;
  placeholder: string;
  rows: StockDocumentStatus[];
  searchLabel?: string;
  selectedKey: string;
  title: string;
};

export default function AllocationDocumentList({
  emptyText,
  eyebrow,
  onSelectDocument,
  placeholder,
  rows,
  searchLabel = "Search",
  selectedKey,
  title,
}: AllocationDocumentListProps) {
  const [documentSearch, setDocumentSearch] = useState("");
  const query = useMemo(() => documentSearch.trim().toLowerCase(), [documentSearch]);
  const pendingCount = useMemo(
    () => rows.filter((doc) => doc.status !== "Entered").length,
    [rows],
  );
  const filteredDocs = useMemo(
    () => rows.filter((doc) => {
      const isVisibleStatus = doc.status !== "Entered" || docKey(doc) === selectedKey;
      const matchesSearch = !query || `${doc.billNo} ${doc.partyName} ${doc.date}`.toLowerCase().includes(query);
      return isVisibleStatus && matchesSearch;
    }),
    [query, rows, selectedKey],
  );
  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDocumentSearch(event.target.value);
  }, []);

  return (
    <aside className="stock-allocation-master stock-panel">
      <div className="stock-allocation-master-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <span className="stock-master-count">{pendingCount}</span>
      </div>
      <label className="stock-allocation-search">
        {searchLabel}
        <input
          placeholder={placeholder}
          value={documentSearch}
          onChange={handleSearchChange}
        />
      </label>
      <div className="stock-allocation-doc-list">
        {filteredDocs.map((doc) => {
          const isSelected = docKey(doc) === selectedKey;
          return (
            <button
              key={docKey(doc)}
              type="button"
              className={isSelected ? "stock-allocation-doc active" : "stock-allocation-doc"}
              onClick={() => onSelectDocument(doc)}
            >
              <span>
                <strong>{doc.billNo}</strong>
                <small>{doc.partyName}</small>
              </span>
              <span>
                <small>{doc.date || "-"}</small>
                <StatusBadge isSelected={isSelected} status={doc.status} />
              </span>
            </button>
          );
        })}
        {!filteredDocs.length && (
          <div className="stock-allocation-empty">
            <strong>No pending documents</strong>
            <span>{emptyText}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

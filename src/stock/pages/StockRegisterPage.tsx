import { useMemo, useState } from "react";
import { formatRate, qty } from "../services/stockCalculations";
import type { StockItem, StockRegisterRow } from "../types";

type StockRegisterPageProps = {
  items: StockItem[];
  registerRows: StockRegisterRow[];
};

export default function StockRegisterPage({ items, registerRows }: StockRegisterPageProps) {
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const searchText = itemSearch.trim().toLowerCase();
  const itemsWithMovements = useMemo(() => {
    const movementItemIds = new Set(registerRows.map((row) => row.itemId));
    return items.filter((item) => movementItemIds.has(item.id) || item.openingQty || item.openingRate);
  }, [items, registerRows]);
  const filteredItems = useMemo(
    () => itemsWithMovements.filter((item) => (
      !searchText || `${item.code} ${item.name} ${item.unit}`.toLowerCase().includes(searchText)
    )),
    [itemsWithMovements, searchText],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? itemsWithMovements[0] ?? null,
    [filteredItems, items, itemsWithMovements, selectedItemId],
  );
  const selectedRows = useMemo(
    () => registerRows
      .filter((row) => row.itemId === selectedItem?.id)
      .sort(compareRegisterRowsByDate),
    [registerRows, selectedItem?.id],
  );

  return (
    <div className="stock-stack stock-register-page">
      <section className="stock-panel">
        <div className="stock-register-toolbar">
          <label>
            Search Stock
            <input
              placeholder="Code or stock name"
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
            />
          </label>
          <label>
            Select Stock
            <select
              value={selectedItem?.id ?? ""}
              onChange={(event) => setSelectedItemId(event.target.value)}
            >
              {!filteredItems.length && <option value="">No stock items</option>}
              {filteredItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} - {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="stock-panel stock-register-sheet">
        <div className="stock-register-title">
          <span>Name of stock</span>
          <strong>{selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : "-"}</strong>
        </div>
        <div className="stock-table-wrap">
          <table className="stock-table stock-register-table">
            <thead>
              <tr>
                <th colSpan={2}></th>
                <th colSpan={2}>Quantity Received</th>
                <th colSpan={2}>Quantity Sent</th>
                <th colSpan={2}>Balance</th>
              </tr>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Qty</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((row) => {
                const isOpening = row.id.startsWith("opening-");
                return (
                  <tr key={row.id}>
                    <td>{isOpening ? "NA" : row.date || "-"}</td>
                    <td>{isOpening ? "Opening" : row.particulars}</td>
                    <td>{!isOpening && row.receivedQty ? `${qty(row.receivedQty)} ${row.unit}` : "-"}</td>
                    <td>{!isOpening && row.receivedQty ? formatRate(row.receivedRate) : "-"}</td>
                    <td>{row.issuedQty ? `${qty(row.issuedQty)} ${row.unit}` : "-"}</td>
                    <td>{row.issuedQty ? formatRate(row.issuedRate) : "-"}</td>
                    <td className={row.balanceQty < 0 ? "stock-low" : ""}>{`${qty(row.balanceQty)} ${row.unit}`}</td>
                    <td className={row.balanceAmount < 0 ? "stock-low" : ""}>{formatRate(row.balanceRate)}</td>
                  </tr>
                );
              })}
              {!selectedRows.length && (
                <tr>
                  <td className="stock-empty-state" colSpan={8}>
                    Select a stock item with opening, purchase, or sales movement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function compareRegisterRowsByDate(left: StockRegisterRow, right: StockRegisterRow) {
  return registerDateKey(left).localeCompare(registerDateKey(right))
    || registerMovementGroup(left) - registerMovementGroup(right)
    || left.particulars.localeCompare(right.particulars);
}

function registerDateKey(row: StockRegisterRow) {
  return row.id.startsWith("opening-") ? "" : String(row.date || "").replaceAll("-", "/");
}

function registerMovementGroup(row: StockRegisterRow) {
  if (row.id.startsWith("opening-")) return 0;
  if (row.receivedQty) return 1;
  return 2;
}

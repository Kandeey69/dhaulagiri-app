import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import AllocationTable from "./AllocationTable";
import { formatCurrency, n, qty } from "../services/stockCalculations";
import type { EntryCurrency, StockItem, StockLineInput } from "../types";

type AllocationEditorProps = {
  availableQtyByItemId?: Record<string, number>;
  canSave?: boolean;
  currency: EntryCurrency;
  editingLineIndex: number | null;
  exchangeRate: number;
  items: StockItem[];
  lineItemId: string;
  lineQty: string;
  lineRate: string;
  lines: StockLineInput[];
  notice?: string;
  onAddLine: () => void;
  onCancelLineEdit: () => void;
  onEditLine: (index: number, exchangeRate: number) => void;
  onLineItemIdChange: (value: string) => void;
  onLineQtyChange: (value: string) => void;
  onLineRateChange: (value: string) => void;
  onRemoveLine: (index: number) => void;
  onSave: () => void;
  readOnly?: boolean;
  saveBlockedReason?: string;
  saving?: boolean;
  selectedItem?: StockItem;
  useSearchableItemInput?: boolean;
};

export default function AllocationEditor({
  availableQtyByItemId = {},
  canSave = true,
  currency,
  editingLineIndex,
  exchangeRate,
  items,
  lineItemId,
  lineQty,
  lineRate,
  lines,
  notice = "",
  onAddLine,
  onCancelLineEdit,
  onEditLine,
  onLineItemIdChange,
  onLineQtyChange,
  onLineRateChange,
  onRemoveLine,
  onSave,
  readOnly = false,
  saveBlockedReason = "",
  saving = false,
  selectedItem,
  useSearchableItemInput = false,
}: AllocationEditorProps) {
  const itemListId = useId();
  const [itemSearch, setItemSearch] = useState("");
  const currentLineTotal = n(lineQty) * n(lineRate);
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items]);
  const showAvailableQty = useMemo(
    () => Object.keys(availableQtyByItemId).length > 0,
    [availableQtyByItemId],
  );
  const saveDisabled = readOnly || saving || !canSave;

  const itemLabel = useCallback((item: StockItem) => {
    const availableQty = availableQtyByItemId[item.id] ?? 0;
    return showAvailableQty
      ? `${item.code} - ${item.name} | ${item.unit} | Available ${qty(availableQty)}`
      : `${item.code} - ${item.name} | ${item.unit}`;
  }, [availableQtyByItemId, showAvailableQty]);

  useEffect(() => {
    if (!useSearchableItemInput) return;
    setItemSearch(selectedItem ? itemLabel(selectedItem) : "");
  }, [itemLabel, selectedItem, useSearchableItemInput]);

  const handleItemSearchChange = useCallback((value: string) => {
    setItemSearch(value);
    const normalized = value.trim().toLowerCase();
    const matchedItem = activeItems.find((item) => {
      return (
        itemLabel(item).toLowerCase() === normalized ||
        item.code.toLowerCase() === normalized ||
        item.name.toLowerCase() === normalized
      );
    });
    onLineItemIdChange(matchedItem?.id ?? "");
  }, [activeItems, itemLabel, onLineItemIdChange]);
  const blockArrowNumberStep = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
    }
  }, []);

  return (
    <div className="stock-stack stock-bill-editor">
      <div className="stock-bill-line-entry">
        <div className="stock-bill-line-entry-header">
          <span>Line entry</span>
          <strong>{editingLineIndex === null ? "New item" : `Editing line ${editingLineIndex + 1}`}</strong>
        </div>
      <div className="stock-form-grid stock-bill-form-grid">
        <label>
          Stock Item
          {useSearchableItemInput ? (
            <>
              <input
                list={itemListId}
                placeholder="Search item code or name"
                disabled={readOnly || saving}
                value={itemSearch}
                onChange={(event) => handleItemSearchChange(event.target.value)}
              />
              <datalist id={itemListId}>
                {activeItems.map((item) => (
                  <option key={item.id} value={itemLabel(item)} />
                ))}
              </datalist>
            </>
          ) : (
            <select disabled={readOnly || saving} value={lineItemId} onChange={(event) => onLineItemIdChange(event.target.value)}>
              <option value="">Select item</option>
              {activeItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} - {item.name} ({item.unit})
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          Quantity
          <input disabled={readOnly || saving} type="number" min="0" step="0.001" value={lineQty} onKeyDown={blockArrowNumberStep} onChange={(event) => onLineQtyChange(event.target.value)} />
        </label>
        <label className="stock-field readonly"><span>Unit</span><strong>{selectedItem?.unit ?? "-"}</strong></label>
        <label>
          Rate Exclusive of VAT ({currency})
          <input disabled={readOnly || saving} type="number" min="0" step="0.000001" value={lineRate} onKeyDown={blockArrowNumberStep} onChange={(event) => onLineRateChange(event.target.value)} />
        </label>
        <label className="stock-field readonly"><span>Current Line Total</span><strong>{formatCurrency(currentLineTotal, currency)}</strong></label>
      </div>
      </div>
      {useSearchableItemInput && selectedItem && (
        <div className="stock-combobox-details">
          <span><strong>Code</strong>{selectedItem.code}</span>
          <span><strong>Item</strong>{selectedItem.name}</span>
          <span><strong>Unit</strong>{selectedItem.unit}</span>
          {showAvailableQty && (
            <span className={(availableQtyByItemId[selectedItem.id] ?? 0) < n(lineQty) ? "stock-warning-text" : ""}>
              <strong>Available</strong>{qty(availableQtyByItemId[selectedItem.id] ?? 0)}
            </span>
          )}
        </div>
      )}
      {notice && <div className="stock-allocation-notice" role="status">{notice}</div>}
      {readOnly && <div className="stock-allocation-notice" role="status">Closed fiscal year: inventory lines are preview only.</div>}
      {!readOnly && !canSave && saveBlockedReason && (
        <div className="stock-allocation-notice stock-save-hint" role="status">{saveBlockedReason}</div>
      )}
      <div className="stock-actions">
        <button type="button" disabled={readOnly || saving} onClick={onAddLine}>{editingLineIndex === null ? "Add Line" : "Update Line"}</button>
        {editingLineIndex !== null && <button type="button" className="ghost" disabled={readOnly || saving} onClick={onCancelLineEdit}>Cancel Line Edit</button>}
        <button type="button" disabled={saveDisabled} onClick={onSave}>{saving ? "Saving..." : "Save Line Items"}</button>
      </div>
      <AllocationTable
        currency={currency}
        exchangeRate={exchangeRate}
        items={items}
        lines={lines}
        onEdit={(indexToEdit) => onEditLine(indexToEdit, exchangeRate)}
        onRemove={onRemoveLine}
        readOnly={readOnly}
      />
    </div>
  );
}

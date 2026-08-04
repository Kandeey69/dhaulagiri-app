import type { FormEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import StockTable from "../components/StockTable";
import { formatRate, n, qty } from "../services/stockCalculations";
import type { StockItem, StockItemForm } from "../types";

const stockUnitOptions = ["MT", "KG", "Number"];

type ItemMasterPageProps = {
  canManage: boolean;
  itemForm: StockItemForm;
  itemHasOpeningFigure: boolean;
  items: StockItem[];
  onEditItem: (item: StockItem) => void;
  onItemFormChange: (updater: (current: StockItemForm) => StockItemForm) => void;
  onItemHasOpeningFigureChange: (value: boolean) => void;
  onRemoveItem: (item: StockItem) => void;
  onSaveItem: (event: FormEvent<HTMLFormElement>) => void;
  readOnly?: boolean;
  resetItemForm: () => void;
};

export default function ItemMasterPage({
  canManage,
  itemForm,
  itemHasOpeningFigure,
  items,
  onEditItem,
  onItemFormChange,
  onItemHasOpeningFigureChange,
  onRemoveItem,
  onSaveItem,
  readOnly = false,
  resetItemForm,
}: ItemMasterPageProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");
  const [unitFilter, setUnitFilter] = useState("All");
  const [openingFilter, setOpeningFilter] = useState<"All" | "With Opening" | "No Opening">("All");

  const unitOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.unit).filter(Boolean))).sort(),
    [items],
  );
  const query = useMemo(() => searchText.trim().toLowerCase(), [searchText]);
  const visibleItems = useMemo(
    () => items.filter((item) => {
      const matchesSearch = !query || `${item.code} ${item.name} ${item.unit}`.toLowerCase().includes(query);
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Active" && item.isActive) ||
        (statusFilter === "Inactive" && !item.isActive);
      const matchesUnit = unitFilter === "All" || item.unit === unitFilter;
      const hasOpening = item.openingQty > 0 || item.openingRate > 0;
      const matchesOpening =
        openingFilter === "All" ||
        (openingFilter === "With Opening" && hasOpening) ||
        (openingFilter === "No Opening" && !hasOpening);
      return matchesSearch && matchesStatus && matchesUnit && matchesOpening;
    }),
    [items, openingFilter, query, statusFilter, unitFilter],
  );

  const openNewItemForm = useCallback(() => {
    resetItemForm();
    setIsFormOpen(true);
  }, [resetItemForm]);

  const openEditItemForm = useCallback((item: StockItem) => {
    onEditItem(item);
    setIsFormOpen(true);
  }, [onEditItem]);

  const closeForm = useCallback(() => {
    resetItemForm();
    setIsFormOpen(false);
  }, [resetItemForm]);

  const itemRows = useMemo(
    () => visibleItems.map((item) => [
      item.code,
      item.name,
      item.unit,
      qty(item.openingQty),
      formatRate(item.openingRate, "NPR"),
      qty(item.reorderLevel),
      item.isActive ? "Active" : "Inactive",
      <div className="stock-row-actions">
        <button type="button" disabled={readOnly} onClick={() => openEditItemForm(item)}>{readOnly ? "View only" : "Edit"}</button>
        {canManage && <button type="button" className="danger" disabled={readOnly} onClick={() => onRemoveItem(item)}>Delete</button>}
      </div>,
    ]),
    [canManage, onRemoveItem, openEditItemForm, readOnly, visibleItems],
  );

  return (
    <div className="stock-stack stock-item-master">
      <section className="stock-panel stock-item-master-panel">
        <div className="stock-item-toolbar">
          <div>
            <p className="eyebrow">Item Master</p>
            <h3>Inventory Items</h3>
          </div>
          <button type="button" disabled={readOnly} onClick={openNewItemForm}>New Item</button>
        </div>
        {readOnly && <p className="stock-muted">Closed fiscal year: item master is view only.</p>}

        <div className="stock-item-filters">
          <label>
            Search
            <input
              placeholder="Code, item name, unit"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option>All</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
          <label>
            Unit
            <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
              <option>All</option>
              {unitOptions.map((unit) => <option key={unit}>{unit}</option>)}
            </select>
          </label>
          <label>
            Opening
            <select value={openingFilter} onChange={(event) => setOpeningFilter(event.target.value as typeof openingFilter)}>
              <option>All</option>
              <option>With Opening</option>
              <option>No Opening</option>
            </select>
          </label>
        </div>

        <StockTable
          emptyText="No stock items match the current filters."
          headers={["Code", "Name", "Unit", "Opening Qty", "Opening Rate", "Reorder", "Status", "Actions"]}
          rows={itemRows}
        />
      </section>

      {isFormOpen && (
        <form className="stock-panel stock-item-form-panel" onSubmit={onSaveItem}>
          <div className="stock-item-form-header">
            <div>
              <p className="eyebrow">{itemForm.id ? "Edit Item" : "New Item"}</p>
              <h3>{itemForm.id ? "Edit Trading Stock Item" : "New Trading Stock Item"}</h3>
            </div>
            <button type="button" className="ghost" onClick={closeForm}>Close</button>
          </div>

          <p className="stock-validation-note">Item code and item name are required. Opening stock values are optional and saved only when the opening section is expanded.</p>

          <div className="stock-form-grid">
            <label>Item Code<input disabled={readOnly} value={itemForm.code} onChange={(event) => onItemFormChange((current) => ({ ...current, code: event.target.value }))} /></label>
            <label>Item Name<input disabled={readOnly} value={itemForm.name} onChange={(event) => onItemFormChange((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>
              Unit
              <select disabled={readOnly} value={itemForm.unit} onChange={(event) => onItemFormChange((current) => ({ ...current, unit: event.target.value }))}>
                {stockUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                {itemForm.unit && !stockUnitOptions.includes(itemForm.unit) && (
                  <option value={itemForm.unit}>{itemForm.unit}</option>
                )}
              </select>
            </label>
            <label>Reorder Level<input disabled={readOnly} type="number" min="0" step="0.001" value={String(itemForm.reorderLevel || "")} onChange={(event) => onItemFormChange((current) => ({ ...current, reorderLevel: n(event.target.value) }))} /></label>
            <label className="stock-checkbox"><input disabled={readOnly} checked={itemForm.isActive} type="checkbox" onChange={(event) => onItemFormChange((current) => ({ ...current, isActive: event.target.checked }))} />Active item</label>
          </div>

          <details
            className="stock-opening-section"
            open={itemHasOpeningFigure}
            onToggle={(event) => onItemHasOpeningFigureChange(event.currentTarget.open)}
          >
            <summary>Opening Stock</summary>
            <div className="stock-form-grid">
              <label>Opening Qty<input disabled={readOnly} type="number" min="0" step="0.001" value={String(itemForm.openingQty || "")} onChange={(event) => onItemFormChange((current) => ({ ...current, openingQty: n(event.target.value) }))} /></label>
              <label>Opening Rate Excl. VAT<input disabled={readOnly} type="number" min="0" step="0.000001" value={String(itemForm.openingRate || "")} onChange={(event) => onItemFormChange((current) => ({ ...current, openingRate: n(event.target.value) }))} /></label>
            </div>
          </details>

          <div className="stock-actions">
            <button type="submit" disabled={readOnly}>{itemForm.id ? "Update Item" : "Save Item"}</button>
            {itemForm.id && <button type="button" className="ghost" onClick={closeForm}>Cancel Edit</button>}
          </div>
        </form>
      )}
    </div>
  );
}

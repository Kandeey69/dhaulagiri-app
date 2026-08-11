import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Party, Sale } from "../data/types";
import {
  deleteSale,
  getParties,
  getSales,
  saveSale,
  updateSale,
} from "../data/storage";
import { companyStorageKey, getActiveCompanyProfile } from "../../companyContext";
import { createFiscalYearFromCode } from "../../domain/fiscalYear";
import { calculateVatAmount, getSuiteVatRatePercent } from "../utils/settings";
import LineItemPreviewModal from "../../stock/LineItemPreviewModal";
import { scrollToPageTop } from "../../scroll";
import { buildStockEntryTarget } from "../../stock/services/stockDocuments";
import { buildStatuses } from "../../stock/services/stockCalculations";
import { isInventoryTrackingEnabled } from "../../stock/settings";
import {
  getStockItems,
  getStockSalesBills,
} from "../../stock/storage";
import type { StockDocumentStatus, StockEntryTarget, StockItem, StockSalesBill } from "../../stock/types";

function normalizeWholeNumber(value: string) {
  const onlyDigits = value.replace(/\D/g, "");

  if (!onlyDigits) return "";

  const normalized = String(Number(onlyDigits));
  return normalized === "0" ? "" : normalized;
}

function normalizeBsDate(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);

  if (!match) return raw;

  const [, year, monthText, dayText] = match;
  const month = Number(monthText);
  const day = Number(dayText);

  if (month < 1 || month > 12 || day < 1 || day > 32) return raw;

  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

type SalesProps = {
  canManage: boolean;
  canEdit?: boolean;
  isReadOnly?: boolean;
  onOpenStockLineEntry?: (target: StockEntryTarget) => void;
};

type SalesSortKey = "billNo" | "dateBs" | "party" | "salesAmount" | "vatAmount" | "totalAmount" | "remarks" | "inventory";
type SortDirection = "asc" | "desc";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : String(error || fallback);
}

export default function Sales({
  canManage,
  canEdit = canManage,
  isReadOnly = false,
  onOpenStockLineEntry,
}: SalesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockSalesBills, setStockSalesBills] = useState<StockSalesBill[]>([]);
  const [previewSaleId, setPreviewSaleId] = useState("");
  const [editingSaleId, setEditingSaleId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [salesAmount, setSalesAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [deletingSaleId, setDeletingSaleId] = useState("");
  const [registerSearch, setRegisterSearch] = useState("");
  const [salesSort, setSalesSort] = useState<{ key: SalesSortKey | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [billToCancel, setBillToCancel] = useState("");
  const [cancelledBillNumbersText, setCancelledBillNumbersText] = useState(() =>
    localStorage.getItem(companyStorageKey("accounts-cancelled-bill-numbers")) ?? ""
  );

  const numericSalesAmount = Number(salesAmount || 0);
  const vatRatePercent = getSuiteVatRatePercent();
  const inventoryEnabled = isInventoryTrackingEnabled();
  const activeCompany = getActiveCompanyProfile();
  const activeFiscalYear = activeCompany
    ? createFiscalYearFromCode(activeCompany.id, activeCompany.fiscalYear || "")
    : null;
  const vatAmount = calculateVatAmount(numericSalesAmount);
  const totalAmount = Number((numericSalesAmount + vatAmount).toFixed(2));
  const totalSalesBeforeVat = sales.reduce((sum, sale) => sum + sale.salesAmount, 0);
  const totalVat = sales.reduce((sum, sale) => sum + sale.vatAmount, 0);
  const totalSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const cancelledBillNumbers = parseNumberList(cancelledBillNumbersText);
  const allMissingBillNumbers = findMissingNumbers(sales.map((sale) => sale.billNo));
  const missingBillNumbers = allMissingBillNumbers.filter(
    (billNumber) => !cancelledBillNumbers.includes(billNumber)
  );
  const registerSearchText = registerSearch.trim().toLowerCase();
  const filteredSales = sales.filter((sale) => {
    if (!registerSearchText) return true;

    const party = parties.find((item) => item.id === sale.partyId);
    return (party?.name ?? "").toLowerCase().includes(registerSearchText);
  });

  const loadData = useCallback(async () => {
    const [loadedParties, loadedSales] = await Promise.all([getParties(), getSales()]);
    setParties(loadedParties);
    setSales(loadedSales);

    if (!inventoryEnabled) {
      setStockItems([]);
      setStockSalesBills([]);
      return;
    }

    const [loadedStockItems, loadedStockSalesBills] = await Promise.all([
      getStockItems(),
      getStockSalesBills(),
    ]);
    setStockItems(loadedStockItems);
    setStockSalesBills(loadedStockSalesBills);
  }, [inventoryEnabled]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    localStorage.setItem(companyStorageKey("accounts-cancelled-bill-numbers"), cancelledBillNumbersText);
  }, [cancelledBillNumbersText]);

  function clearForm() {
    setEditingSaleId("");
    setBillNo("");
    setDateBs("");
    setPartyId("");
    setSalesAmount("");
    setRemarks("");
  }

  function markBillCancelled(billNumber: number) {
    const nextNumbers = Array.from(new Set([...cancelledBillNumbers, billNumber])).sort(
      (left, right) => left - right
    );
    setCancelledBillNumbersText(nextNumbers.join(", "));
    setBillToCancel("");
  }

  function restoreBillNumber(billNumber: number) {
    setCancelledBillNumbersText(
      cancelledBillNumbers.filter((number) => number !== billNumber).join(", ")
    );
  }

  function handleEditSale(sale: Sale) {
    if (!canEdit) {
      setMessage("Edit access is required to edit sales.");
      return;
    }

    setMessage("");
    setEditingSaleId(sale.id);
    setBillNo(sale.billNo);
    setDateBs(sale.dateBs);
    setPartyId(sale.partyId);
    setSalesAmount(String(sale.salesAmount));
    setRemarks(sale.remarks ?? "");
    scrollToPageTop("smooth");
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage("");

    if (!billNo.trim()) {
      setMessage("Bill number is required.");
      return;
    }

    if (!/^\d+$/.test(billNo)) {
      setMessage("Bill number must be a whole number only.");
      return;
    }

    if (!dateBs.trim()) {
      setMessage("Date BS is required.");
      return;
    }

    if (!partyId) {
      setMessage("Party is required.");
      return;
    }

    if (numericSalesAmount <= 0) {
      setMessage("Sales amount must be greater than zero.");
      return;
    }

    try {
      if (editingSaleId) {
        if (!canEdit) {
          setMessage("Edit access is required to update sales.");
          return;
        }

        await updateSale({
          id: editingSaleId,
          billNo,
          dateBs,
          partyId,
          salesAmount: numericSalesAmount,
          vatAmount,
          totalAmount,
          remarks,
        });
        setMessage("Sale updated successfully.");
      } else {
        await saveSale({
          billNo,
          dateBs,
          partyId,
          salesAmount: numericSalesAmount,
          vatAmount,
          totalAmount,
          remarks,
        });
        setMessage("Sale saved successfully.");
      }

      clearForm();
      await loadData();
    } catch (error) {
      reportError(error, "Failed to save sale.");
    }
  }

  async function handleDeleteSale(sale: Sale) {
    if (!canManage) {
      setMessage("Master access is required to delete sales.");
      return;
    }

    const confirmed = window.confirm(
      `Delete sale bill no. ${sale.billNo}?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingSaleId(sale.id);
    setMessage(`Deleting sale bill no. ${sale.billNo}...`);

    try {
      await deleteSale(sale.id, { deleteLinkedStock: inventoryEnabled });
      setSales((currentSales) => currentSales.filter((item) => item.id !== sale.id));
      setStockSalesBills((currentBills) => currentBills.filter((bill) => bill.id !== sale.id));

      let cleanupMessage = "";

      if (editingSaleId === sale.id) {
        clearForm();
      }

      try {
        await loadData();
      } catch (error) {
        console.error("Could not refresh sales register after delete.", error);
        cleanupMessage += " Register refresh hit a temporary database lock; reopen Sales if totals look stale.";
      }

      setMessage(`Sale bill no. ${sale.billNo} deleted successfully.${cleanupMessage}`);
    } catch (error) {
      console.error("Failed to delete sale.", error);
      reportError(error, "Failed to delete sale.");
    } finally {
      setDeletingSaleId("");
    }
  }

  function openStockEntryForSale(sale: Sale) {
    if (!onOpenStockLineEntry || !activeCompany || !activeFiscalYear) {
      setMessage("Inventory module is not available for this company.");
      return;
    }

    const party = parties.find((item) => item.id === sale.partyId);
    onOpenStockLineEntry(buildStockEntryTarget({
      amount: sale.salesAmount,
      amountCurrency: "NPR",
      amountNpr: sale.salesAmount,
      billNo: sale.billNo,
      companyId: activeCompany.id,
      date: sale.dateBs,
      documentId: sale.id,
      exchangeRate: 1,
      fiscalYear: activeCompany.fiscalYear,
      fiscalYearId: sale.fiscalYearId || activeFiscalYear.id,
      grandTotal: sale.totalAmount,
      lifecycleStatus: sale.lifecycleStatus,
      partyName: party?.name || "Unknown",
      readOnly: isReadOnly,
      remarks: sale.remarks ?? "",
      type: "Sale",
      vatAmount: sale.vatAmount,
    }));
  }

  const stockSalesBillById = new Map(stockSalesBills.map((bill) => [bill.id, bill]));
  const stockStatusBySaleId = useMemo(() => {
    const statusRows = buildStatuses(
      sales.map((sale) => {
        const party = parties.find((item) => item.id === sale.partyId);
        return {
          amount: sale.salesAmount,
          amountCurrency: "NPR" as const,
          amountNpr: sale.salesAmount,
          billNo: sale.billNo,
          date: sale.dateBs,
          documentId: sale.id,
          fiscalYearId: sale.fiscalYearId,
          grandTotal: sale.totalAmount,
          lifecycleStatus: sale.lifecycleStatus,
          partyName: party?.name || "Unknown",
          type: "Sale" as const,
          vatAmount: sale.vatAmount,
        };
      }),
      [],
      stockSalesBills,
    );
    return new Map(statusRows.map((status) => [status.documentId, status] as const));
  }, [parties, sales, stockSalesBills]);
  const sortedSales = useMemo(
    () => salesSort.key
      ? [...filteredSales].sort((left, right) => compareSales(
        left,
        right,
        salesSort.key as SalesSortKey,
        salesSort.direction,
        parties,
        stockStatusBySaleId,
      ))
      : filteredSales,
    [filteredSales, parties, salesSort.direction, salesSort.key, stockStatusBySaleId],
  );
  const previewSale = sales.find((sale) => sale.id === previewSaleId) ?? null;
  const previewStockBill = previewSale ? stockSalesBillById.get(previewSale.id) : null;
  const previewParty = previewSale ? parties.find((party) => party.id === previewSale.partyId) : null;

  function reportError(error: unknown, fallback: string) {
    const messageText = errorMessage(error, fallback);
    window.alert(messageText);
    setMessage(messageText);
  }

  function toggleSalesSort(key: SalesSortKey) {
    setSalesSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortableHeader(key: SalesSortKey, label: string) {
    const isActive = salesSort.key === key;
    return (
      <th aria-sort={isActive ? (salesSort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="sortable-table-header"
          onClick={() => toggleSalesSort(key)}
        >
          {label}
          <span aria-hidden="true">{isActive ? (salesSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
          <span className="sr-only">
            {isActive ? ` sorted ${salesSort.direction === "asc" ? "ascending" : "descending"}` : " sort column"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="stack">
      {previewSale && previewStockBill && (
        <LineItemPreviewModal
          billAmount={previewSale.salesAmount}
          billNumber={previewSale.billNo}
          companyName={activeCompany?.name || "Company"}
          counterpartyLabel="Customer"
          counterpartyName={previewParty?.name || previewStockBill.customerName}
          currency="NPR"
          date={previewSale.dateBs || previewStockBill.dateBs}
          documentKind="sales"
          fiscalYear={activeCompany?.fiscalYear || ""}
          grandTotal={previewSale.totalAmount}
          items={stockItems}
          lines={previewStockBill.items}
          onClose={() => setPreviewSaleId("")}
          panNumber={previewParty?.panNo}
          title="Sales Inventory Lines"
          vatAmount={previewSale.vatAmount}
        />
      )}
      {message && <p className="status-message">{message}</p>}

      <form className="stack" onSubmit={handleSave}>
        <div className="card">
          <h3>{editingSaleId ? "Edit Sale Entry" : "New Sale Entry"}</h3>

          <div className="form-grid">
            <label>
              Bill No. <span className="required">*</span>
              <input
                inputMode="numeric"
                placeholder="Whole number only"
                value={billNo}
                onChange={(event) => setBillNo(normalizeWholeNumber(event.target.value))}
              />
            </label>

            <label>
              Date BS <span className="required">*</span>
              <input
                placeholder="YYYY/MM/DD or YYYY-MM-DD"
                value={dateBs}
                onChange={(event) => setDateBs(event.target.value)}
                onBlur={(event) => setDateBs(normalizeBsDate(event.target.value))}
              />
            </label>

            <label>
              Party <span className="required">*</span>
              <select value={partyId} onChange={(event) => setPartyId(event.target.value)}>
                <option value="">Select party</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sales Amount <span className="required">*</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={salesAmount}
                onChange={(event) => setSalesAmount(event.target.value)}
              />
            </label>

            <label>
              VAT {vatRatePercent}%
              <input readOnly value={formatMoney(vatAmount)} />
            </label>

            <label>
              Total Amount
              <input readOnly value={formatMoney(totalAmount)} />
            </label>

            <label className="full-width-field">
              Remarks
              <input value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit">
            {editingSaleId ? "Update sale" : "Save sale"}
          </button>
          {editingSaleId && (
            <button type="button" className="ghost" onClick={clearForm}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="metric-grid">
        <MetricCard label="Sales count" value={String(sales.length)} />
        <MetricCard label="Sales before VAT" value={formatMoney(totalSalesBeforeVat)} />
        <MetricCard label={`VAT ${vatRatePercent}%`} value={formatMoney(totalVat)} />
        <MetricCard label="Total sales" value={formatMoney(totalSales)} />
      </div>

      <div className="card">
        <h3>Sales Register</h3>
        <div className="toolbar">
          <label className="search-field">
            Search party
            <input
              placeholder="Party name"
              value={registerSearch}
              onChange={(event) => setRegisterSearch(event.target.value)}
            />
          </label>

        </div>
        {missingBillNumbers.length > 0 && (
          <div className="missing-number-list">
            <p className="muted">
              Missing bill numbers in sequence: {missingBillNumbers.join(", ")}
            </p>
            <select value={billToCancel} onChange={(event) => setBillToCancel(event.target.value)}>
              <option value="">Select missing bill number</option>
              {missingBillNumbers.map((billNumber) => (
                <option key={billNumber} value={billNumber}>
                  Bill {billNumber}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost small"
              disabled={!billToCancel}
              onClick={() => markBillCancelled(Number(billToCancel))}
            >
              Mark selected bill cancelled
            </button>
          </div>
        )}
        {cancelledBillNumbers.length > 0 && (
          <div className="missing-number-list">
            <p className="muted">Cancelled bill numbers:</p>
            {cancelledBillNumbers.map((billNumber) => (
              <button
                key={billNumber}
                type="button"
                className="ghost small"
                onClick={() => restoreBillNumber(billNumber)}
              >
                Restore bill {billNumber}
              </button>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {renderSortableHeader("billNo", "Bill No.")}
                {renderSortableHeader("dateBs", "Date BS")}
                {renderSortableHeader("party", "Party")}
                {renderSortableHeader("salesAmount", "Sales Amount")}
                {renderSortableHeader("vatAmount", `VAT ${vatRatePercent}%`)}
                {renderSortableHeader("totalAmount", "Total Amount")}
                {renderSortableHeader("remarks", "Remarks")}
                {inventoryEnabled && renderSortableHeader("inventory", "Inventory")}
                {(canEdit || canManage) && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {sortedSales.map((sale) => {
                const party = parties.find((item) => item.id === sale.partyId);
                const stockBill = stockSalesBillById.get(sale.id);
                const stockStatus = stockStatusBySaleId.get(sale.id);

                return (
                  <tr key={sale.id}>
                    <td>{sale.billNo}</td>
                    <td>{sale.dateBs}</td>
                    <td>{party?.name || "Unknown"}</td>
                    <td>{formatMoney(sale.salesAmount)}</td>
                    <td>{formatMoney(sale.vatAmount)}</td>
                    <td>
                      <strong>{formatMoney(sale.totalAmount)}</strong>
                    </td>
                    <td>{sale.remarks || "-"}</td>
                    {inventoryEnabled && (
                      <td>
                        <InventoryRegisterCell
                          isReadOnly={isReadOnly}
                          onAdd={() => openStockEntryForSale(sale)}
                          onPreview={() => setPreviewSaleId(sale.id)}
                          status={stockStatus}
                          stockBill={stockBill}
                        />
                      </td>
                    )}
                    {(canEdit || canManage) && (
                      <td className="row-actions">
                        {canEdit && (
                          <button
                            className="small"
                            type="button"
                            onClick={() => handleEditSale(sale)}
                          >
                            Edit
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="danger small"
                            disabled={deletingSaleId === sale.id}
                            type="button"
                            onClick={() => handleDeleteSale(sale)}
                          >
                            {deletingSaleId === sale.id ? "Deleting..." : "Delete"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {sortedSales.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7 + (inventoryEnabled ? 1 : 0) + (canEdit || canManage ? 1 : 0)}>
                    {sales.length === 0 ? "No sales yet." : "No sales match the party search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InventoryRegisterCell({
  isReadOnly,
  onAdd,
  onPreview,
  status,
  stockBill,
}: {
  isReadOnly: boolean;
  onAdd: () => void;
  onPreview: () => void;
  status?: StockDocumentStatus;
  stockBill?: StockSalesBill;
}) {
  if (status?.status === "Mismatch") {
    return (
      <div className="inventory-register-cell">
        <span className="inventory-mismatch" title={status.statusReason || "Inventory lines need review."}>
          Mismatch
        </span>
        {!isReadOnly && (
          <button className="danger small" type="button" onClick={onAdd}>
            Fix
          </button>
        )}
      </div>
    );
  }

  if (stockBill) {
    return (
      <div className="inventory-register-cell">
        <button className="small" type="button" onClick={onPreview}>
          Preview
        </button>
      </div>
    );
  }

  return (
    <div className="inventory-register-cell">
      <span>Pending</span>
      {isReadOnly ? (
        <span className="muted">No inventory</span>
      ) : (
        <button className="danger small" type="button" onClick={onAdd}>
          Add
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function findMissingNumbers(values: string[]) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);

  if (numbers.length < 2) {
    return [];
  }

  const existing = new Set(numbers);
  const missing: number[] = [];

  for (let current = numbers[0]; current <= numbers[numbers.length - 1]; current += 1) {
    if (!existing.has(current)) {
      missing.push(current);
    }
  }

  return missing;
}

function parseNumberList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((a, b) => a - b);
}

function compareSales(
  left: Sale,
  right: Sale,
  key: SalesSortKey,
  direction: SortDirection,
  parties: Party[],
  stockStatusBySaleId: Map<string, StockDocumentStatus>,
) {
  const partyName = (sale: Sale) => parties.find((party) => party.id === sale.partyId)?.name ?? "";
  const inventoryStatus = (sale: Sale) => stockStatusBySaleId.get(sale.id)?.status ?? "Pending";
  const directionMultiplier = direction === "asc" ? 1 : -1;

  if (key === "billNo" || key === "salesAmount" || key === "vatAmount" || key === "totalAmount") {
    const leftValue = salesNumericSortValue(left, key);
    const rightValue = salesNumericSortValue(right, key);
    const numericCompare = leftValue - rightValue;
    if (numericCompare !== 0) return numericCompare * directionMultiplier;
  } else {
    const leftValue = salesTextSortValue(left, key, partyName, inventoryStatus);
    const rightValue = salesTextSortValue(right, key, partyName, inventoryStatus);
    const textCompare = leftValue.localeCompare(rightValue);
    if (textCompare !== 0) return textCompare * directionMultiplier;
  }

  return Number(left.billNo || 0) - Number(right.billNo || 0) || left.createdAt.localeCompare(right.createdAt);
}

function salesNumericSortValue(sale: Sale, key: "billNo" | "salesAmount" | "vatAmount" | "totalAmount") {
  if (key === "billNo") return Number(sale.billNo || 0);
  return Number(sale[key] || 0);
}

function salesTextSortValue(
  sale: Sale,
  key: "dateBs" | "party" | "remarks" | "inventory",
  partyName: (sale: Sale) => string,
  inventoryStatus: (sale: Sale) => string,
) {
  if (key === "party") return partyName(sale);
  if (key === "inventory") return inventoryStatus(sale);
  return String(sale[key] ?? "");
}

function formatMoney(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

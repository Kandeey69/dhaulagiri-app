import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Party, Sale } from "../data/types";
import {
  deleteSale,
  getParties,
  getSales,
  saveSale,
  updateSale,
} from "../data/storage";

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
};

export default function Sales({ canManage, canEdit = canManage }: SalesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [editingSaleId, setEditingSaleId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [salesAmount, setSalesAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [registerSearch, setRegisterSearch] = useState("");
  const [billToCancel, setBillToCancel] = useState("");
  const [cancelledBillNumbersText, setCancelledBillNumbersText] = useState(() =>
    localStorage.getItem("accounts-cancelled-bill-numbers") ?? ""
  );

  const numericSalesAmount = Number(salesAmount || 0);
  const vatAmount = Number((numericSalesAmount * 0.13).toFixed(2));
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

  async function loadData() {
    const [loadedParties, loadedSales] = await Promise.all([getParties(), getSales()]);
    setParties(loadedParties);
    setSales(loadedSales);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    localStorage.setItem("accounts-cancelled-bill-numbers", cancelledBillNumbersText);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to save sale.")
      );
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

    try {
      await deleteSale(sale.id);

      if (editingSaleId === sale.id) {
        clearForm();
      }

      await loadData();
      setMessage(`Sale bill no. ${sale.billNo} deleted successfully.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to delete sale.")
      );
    }
  }

  return (
    <div className="stack">
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
              VAT 13%
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
        <MetricCard label="VAT 13%" value={formatMoney(totalVat)} />
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
                <th>Bill No.</th>
                <th>Date BS</th>
                <th>Party</th>
                <th>Sales Amount</th>
                <th>VAT 13%</th>
                <th>Total Amount</th>
                <th>Remarks</th>
                {(canEdit || canManage) && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {filteredSales.map((sale) => {
                const party = parties.find((item) => item.id === sale.partyId);

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
                            type="button"
                            onClick={() => handleDeleteSale(sale)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredSales.length === 0 && (
                <tr>
                  <td className="empty" colSpan={canEdit || canManage ? 8 : 7}>
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

function formatMoney(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

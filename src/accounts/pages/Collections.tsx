import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Collection, Party } from "../data/types";
import {
  deleteCollection,
  getCollections,
  getParties,
  saveCollection,
  updateCollection,
} from "../data/storage";

const bankSuggestions = [
  "Cash",
  "Nabil Bank",
  "Kamana Sewa Bank",
  "Everest Bank",
];

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

type CollectionsProps = {
  canManage: boolean;
  canEdit?: boolean;
};

export default function Collections({ canManage, canEdit = canManage }: CollectionsProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [registerSearch, setRegisterSearch] = useState("");
  const [receiptToCancel, setReceiptToCancel] = useState("");
  const [cancelledReceiptNumbersText, setCancelledReceiptNumbersText] = useState(() =>
    localStorage.getItem("accounts-cancelled-receipt-numbers") ?? ""
  );

  const numericAmount = Number(amount || 0);
  const totalCollections = collections.reduce(
    (sum, collection) => sum + collection.amount,
    0
  );
  const bankCount = new Set(
    collections.map((collection) => collection.bankName).filter(Boolean)
  ).size;
  const cancelledReceiptNumbers = parseNumberList(cancelledReceiptNumbersText);
  const allMissingReceiptNumbers = findMissingNumbers(
    collections.map((collection) => collection.receiptNo ?? "")
  );
  const missingReceiptNumbers = allMissingReceiptNumbers.filter(
    (receiptNumber) => !cancelledReceiptNumbers.includes(receiptNumber)
  );
  const registerSearchText = registerSearch.trim().toLowerCase();
  const filteredCollections = collections.filter((collection) => {
    if (!registerSearchText) return true;

    const party = parties.find((item) => item.id === collection.partyId);
    return (party?.name ?? "").toLowerCase().includes(registerSearchText);
  });

  async function loadData() {
    const [loadedParties, loadedCollections] = await Promise.all([
      getParties(),
      getCollections(),
    ]);
    setParties(loadedParties);
    setCollections(loadedCollections);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    localStorage.setItem("accounts-cancelled-receipt-numbers", cancelledReceiptNumbersText);
  }, [cancelledReceiptNumbersText]);

  function clearForm() {
    setEditingCollectionId("");
    setDateBs("");
    setPartyId("");
    setBankName("");
    setAmount("");
    setReceiptNo("");
    setRemarks("");
  }

  function markReceiptCancelled(receiptNumber: number) {
    const nextNumbers = Array.from(new Set([...cancelledReceiptNumbers, receiptNumber])).sort(
      (left, right) => left - right
    );
    setCancelledReceiptNumbersText(nextNumbers.join(", "));
    setReceiptToCancel("");
  }

  function restoreReceiptNumber(receiptNumber: number) {
    setCancelledReceiptNumbersText(
      cancelledReceiptNumbers.filter((number) => number !== receiptNumber).join(", ")
    );
  }

  function handleEditCollection(collection: Collection) {
    if (!canEdit) {
      setMessage("Edit access is required to edit collections.");
      return;
    }

    setMessage("");
    setEditingCollectionId(collection.id);
    setDateBs(collection.dateBs);
    setPartyId(collection.partyId);
    setBankName(collection.bankName ?? "");
    setAmount(String(collection.amount));
    setReceiptNo(collection.receiptNo ?? "");
    setRemarks(collection.remarks ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage("");

    if (!dateBs.trim()) {
      setMessage("Date BS is required.");
      return;
    }

    if (!partyId) {
      setMessage("Party is required.");
      return;
    }

    if (!bankName.trim()) {
      setMessage("Bank / Cash is required.");
      return;
    }

    if (!receiptNo.trim()) {
      setMessage("Receipt number is required.");
      return;
    }

    if (!/^\d+$/.test(receiptNo)) {
      setMessage("Receipt number must be a whole number only.");
      return;
    }

    if (numericAmount <= 0) {
      setMessage("Amount must be greater than zero.");
      return;
    }

    try {
      if (editingCollectionId) {
        if (!canEdit) {
          setMessage("Edit access is required to update collections.");
          return;
        }

        await updateCollection({
          id: editingCollectionId,
          dateBs,
          partyId,
          bankName,
          amount: numericAmount,
          receiptNo,
          remarks,
        });
        setMessage("Collection updated successfully.");
      } else {
        await saveCollection({
          dateBs,
          partyId,
          bankName,
          amount: numericAmount,
          receiptNo,
          remarks,
        });
        setMessage("Collection saved successfully.");
      }

      clearForm();
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to save collection.")
      );
    }
  }

  async function handleDeleteCollection(collection: Collection) {
    if (!canManage) {
      setMessage("Master access is required to delete collections.");
      return;
    }

    const confirmed = window.confirm(
      `Delete collection receipt no. ${collection.receiptNo}?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteCollection(collection.id);

      if (editingCollectionId === collection.id) {
        clearForm();
      }

      await loadData();
      setMessage(`Collection receipt no. ${collection.receiptNo} deleted successfully.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to delete collection.")
      );
    }
  }

  return (
    <div className="stack">
      {message && <p className="status-message">{message}</p>}

      <form className="stack" onSubmit={handleSave}>
        <div className="card">
          <h3>{editingCollectionId ? "Edit Collection Entry" : "New Collection Entry"}</h3>

          <div className="form-grid">
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
              Bank / Cash <span className="required">*</span>
              <select value={bankName} onChange={(event) => setBankName(event.target.value)}>
                <option value="">Select bank / cash</option>
                {bankSuggestions.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Receipt No. <span className="required">*</span>
              <input
                inputMode="numeric"
                placeholder="Whole number only"
                value={receiptNo}
                onChange={(event) => setReceiptNo(normalizeWholeNumber(event.target.value))}
              />
            </label>

            <label>
              Amount <span className="required">*</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>

            <label>
              Amount NPR
              <input readOnly value={formatMoney(numericAmount)} />
            </label>

            <label className="full-width-field">
              Remarks
              <input value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit">
            {editingCollectionId ? "Update collection" : "Save collection"}
          </button>
          {editingCollectionId && (
            <button type="button" className="ghost" onClick={clearForm}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="metric-grid">
        <MetricCard label="Collections count" value={String(collections.length)} />
        <MetricCard label="Banks / cash modes" value={String(bankCount)} />
        <MetricCard label="Total collections" value={formatMoney(totalCollections)} />
      </div>

      <div className="card">
        <h3>Collection Register</h3>
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
        {missingReceiptNumbers.length > 0 && (
          <div className="missing-number-list">
            <p className="muted">
              Missing receipt numbers in sequence: {missingReceiptNumbers.join(", ")}
            </p>
            <select value={receiptToCancel} onChange={(event) => setReceiptToCancel(event.target.value)}>
              <option value="">Select missing receipt number</option>
              {missingReceiptNumbers.map((receiptNumber) => (
                <option key={receiptNumber} value={receiptNumber}>
                  Receipt {receiptNumber}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost small"
              disabled={!receiptToCancel}
              onClick={() => markReceiptCancelled(Number(receiptToCancel))}
            >
              Mark selected receipt cancelled
            </button>
          </div>
        )}
        {cancelledReceiptNumbers.length > 0 && (
          <div className="missing-number-list">
            <p className="muted">Cancelled receipt numbers:</p>
            {cancelledReceiptNumbers.map((receiptNumber) => (
              <button
                key={receiptNumber}
                type="button"
                className="ghost small"
                onClick={() => restoreReceiptNumber(receiptNumber)}
              >
                Restore receipt {receiptNumber}
              </button>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date BS</th>
                <th>Party</th>
                <th>Bank / Cash</th>
                <th>Receipt No.</th>
                <th>Amount</th>
                <th>Remarks</th>
                {(canEdit || canManage) && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {filteredCollections.map((collection) => {
                const party = parties.find((item) => item.id === collection.partyId);

                return (
                  <tr key={collection.id}>
                    <td>{collection.dateBs}</td>
                    <td>{party?.name || "Unknown"}</td>
                    <td>{collection.bankName || "-"}</td>
                    <td>{collection.receiptNo || "-"}</td>
                    <td>
                      <strong>{formatMoney(collection.amount)}</strong>
                    </td>
                    <td>{collection.remarks || "-"}</td>
                    {(canEdit || canManage) && (
                      <td className="row-actions">
                        {canEdit && (
                          <button
                            className="small"
                            type="button"
                            onClick={() => handleEditCollection(collection)}
                          >
                            Edit
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="danger small"
                            type="button"
                            onClick={() => handleDeleteCollection(collection)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredCollections.length === 0 && (
                <tr>
                  <td className="empty" colSpan={canEdit || canManage ? 7 : 6}>
                    {collections.length === 0
                      ? "No collections yet."
                      : "No collections match the party search."}
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

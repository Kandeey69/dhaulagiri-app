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
import { companyStorageKey } from "../../companyContext";
import { scrollToPageTop } from "../../scroll";
import { confirmAction, notifyError, notifyToast } from "../../components/notificationService";

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
  isReadOnly?: boolean;
};

type CollectionSortKey = "dateBs" | "party" | "bankName" | "receiptNo" | "amount" | "remarks";
type SortDirection = "asc" | "desc";

export default function Collections({ canManage, canEdit = canManage, isReadOnly = false }: CollectionsProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registerSearch, setRegisterSearch] = useState("");
  const [collectionSort, setCollectionSort] = useState<{ key: CollectionSortKey | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [receiptToCancel, setReceiptToCancel] = useState("");
  const [cancelledReceiptNumbersText, setCancelledReceiptNumbersText] = useState(() =>
    localStorage.getItem(companyStorageKey("accounts-cancelled-receipt-numbers")) ?? ""
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
  const sortedCollections = collectionSort.key
    ? [...filteredCollections].sort((left, right) => compareCollections(left, right, collectionSort.key as CollectionSortKey, collectionSort.direction, parties))
    : filteredCollections;

  function toggleCollectionSort(key: CollectionSortKey) {
    setCollectionSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortableHeader(key: CollectionSortKey, label: string) {
    const isActive = collectionSort.key === key;
    return (
      <th aria-sort={isActive ? (collectionSort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sortable-table-header" onClick={() => toggleCollectionSort(key)}>
          {label}
          <span aria-hidden="true">{isActive ? (collectionSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
          <span className="sr-only">
            {isActive ? ` sorted ${collectionSort.direction === "asc" ? "ascending" : "descending"}` : " sort column"}
          </span>
        </button>
      </th>
    );
  }

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
    localStorage.setItem(companyStorageKey("accounts-cancelled-receipt-numbers"), cancelledReceiptNumbersText);
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
      notifyError("Edit access is required to edit collections.", "Edit not allowed");
      return;
    }

    setEditingCollectionId(collection.id);
    setDateBs(collection.dateBs);
    setPartyId(collection.partyId);
    setBankName(collection.bankName ?? "");
    setAmount(String(collection.amount));
    setReceiptNo(collection.receiptNo ?? "");
    setRemarks(collection.remarks ?? "");
    scrollToPageTop("smooth");
  }

  async function handleSave(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setFieldErrors({});

    const rejectField = (field: string, messageText: string) => {
      setFieldErrors({ [field]: messageText });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus());
    };

    if (!dateBs.trim()) {
      rejectField("dateBs", "Date BS is required.");
      return;
    }

    if (!partyId) {
      rejectField("partyId", "Party is required.");
      return;
    }

    if (!bankName.trim()) {
      rejectField("bankName", "Bank / Cash is required.");
      return;
    }

    if (!receiptNo.trim()) {
      rejectField("receiptNo", "Receipt number is required.");
      return;
    }

    if (!/^\d+$/.test(receiptNo)) {
      rejectField("receiptNo", "Receipt number must be a whole number only.");
      return;
    }

    if (numericAmount <= 0) {
      rejectField("amount", "Amount must be greater than zero.");
      return;
    }

    try {
      if (editingCollectionId) {
        if (!canEdit) {
          notifyError("Edit access is required to update collections.", "Edit not allowed");
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
        notifyToast("Collection updated successfully.");
      } else {
        await saveCollection({
          dateBs,
          partyId,
          bankName,
          amount: numericAmount,
          receiptNo,
          remarks,
        });
        notifyToast("Collection saved successfully.");
      }

      clearForm();
      await loadData();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error || "Failed to save collection."), "Collection could not be saved");
    }
  }

  async function handleDeleteCollection(collection: Collection) {
    if (!canManage) {
      notifyError("Master access is required to delete collections.", "Delete not allowed");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete collection?",
      message: `Receipt: ${collection.receiptNo}\nDate: ${collection.dateBs}\nParty: ${parties.find((item) => item.id === collection.partyId)?.name || "Unknown"}\nAmount: ${formatMoney(collection.amount)}\n\nThis cannot be undone.`,
      confirmLabel: "Delete collection",
      destructive: true,
    });

    if (!confirmed) return;

    try {
      await deleteCollection(collection.id);

      if (editingCollectionId === collection.id) {
        clearForm();
      }

      await loadData();
      notifyToast(`Collection receipt no. ${collection.receiptNo} deleted successfully.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error || "Failed to delete collection."), "Collection could not be deleted");
    }
  }

  return (
    <div className="stack">
      {!isReadOnly && <form className="stack" onSubmit={handleSave}>
        <div className="card">
          <h3>{editingCollectionId ? "Edit Collection Entry" : "New Collection Entry"}</h3>

          <div className="form-grid">
            <label>
              Date BS <span className="required">*</span>
              <input
                name="dateBs"
                placeholder="YYYY/MM/DD or YYYY-MM-DD"
                value={dateBs}
                aria-invalid={Boolean(fieldErrors.dateBs)}
                onChange={(event) => {
                  setDateBs(event.target.value);
                  setFieldErrors((current) => ({ ...current, dateBs: "" }));
                }}
                onBlur={(event) => setDateBs(normalizeBsDate(event.target.value))}
              />
              {fieldErrors.dateBs && <span className="field-error" role="alert">{fieldErrors.dateBs}</span>}
            </label>

            <label>
              Party <span className="required">*</span>
              <select name="partyId" value={partyId} aria-invalid={Boolean(fieldErrors.partyId)} onChange={(event) => {
                setPartyId(event.target.value);
                setFieldErrors((current) => ({ ...current, partyId: "" }));
              }}>
                <option value="">Select party</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
              {fieldErrors.partyId && <span className="field-error" role="alert">{fieldErrors.partyId}</span>}
            </label>

            <label>
              Bank / Cash <span className="required">*</span>
              <select name="bankName" value={bankName} aria-invalid={Boolean(fieldErrors.bankName)} onChange={(event) => {
                setBankName(event.target.value);
                setFieldErrors((current) => ({ ...current, bankName: "" }));
              }}>
                <option value="">Select bank / cash</option>
                {bankSuggestions.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
              {fieldErrors.bankName && <span className="field-error" role="alert">{fieldErrors.bankName}</span>}
            </label>

            <label>
              Receipt No. <span className="required">*</span>
              <input
                name="receiptNo"
                inputMode="numeric"
                placeholder="Whole number only"
                value={receiptNo}
                aria-invalid={Boolean(fieldErrors.receiptNo)}
                onChange={(event) => {
                  setReceiptNo(normalizeWholeNumber(event.target.value));
                  setFieldErrors((current) => ({ ...current, receiptNo: "" }));
                }}
              />
              {fieldErrors.receiptNo && <span className="field-error" role="alert">{fieldErrors.receiptNo}</span>}
            </label>

            <label>
              Amount <span className="required">*</span>
              <input
                name="amount"
                min="0"
                step="0.01"
                type="number"
                value={amount}
                aria-invalid={Boolean(fieldErrors.amount)}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setFieldErrors((current) => ({ ...current, amount: "" }));
                }}
              />
              {fieldErrors.amount && <span className="field-error" role="alert">{fieldErrors.amount}</span>}
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
      </form>}

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
        {!isReadOnly && missingReceiptNumbers.length > 0 && (
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
        {!isReadOnly && cancelledReceiptNumbers.length > 0 && (
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
                {renderSortableHeader("dateBs", "Date BS")}
                {renderSortableHeader("party", "Party")}
                {renderSortableHeader("bankName", "Bank / Cash")}
                {renderSortableHeader("receiptNo", "Receipt No.")}
                {renderSortableHeader("amount", "Amount")}
                {renderSortableHeader("remarks", "Remarks")}
                {(canEdit || canManage) && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {sortedCollections.map((collection) => {
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
              {sortedCollections.length === 0 && (
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

function compareCollections(
  left: Collection,
  right: Collection,
  key: CollectionSortKey,
  direction: SortDirection,
  parties: Party[],
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const partyName = (collection: Collection) => parties.find((party) => party.id === collection.partyId)?.name ?? "";

  if (key === "amount" || key === "receiptNo") {
    const leftValue = key === "amount" ? left.amount : Number(left.receiptNo || 0);
    const rightValue = key === "amount" ? right.amount : Number(right.receiptNo || 0);
    const compare = leftValue - rightValue;
    if (compare !== 0) return compare * directionMultiplier;
  } else {
    const leftValue = key === "party" ? partyName(left) : String(left[key] ?? "");
    const rightValue = key === "party" ? partyName(right) : String(right[key] ?? "");
    const compare = leftValue.localeCompare(rightValue);
    if (compare !== 0) return compare * directionMultiplier;
  }

  return Number(left.receiptNo || 0) - Number(right.receiptNo || 0) || left.createdAt.localeCompare(right.createdAt);
}

function formatMoney(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

import { useEffect, useState } from "react";
import type { CreditNote, Party } from "../data/types";
import {
  deleteCreditNote,
  getCreditNotes,
  getParties,
  saveCreditNote,
  updateCreditNote,
} from "../data/storage";
import { scrollToPageTop } from "../../scroll";
import { calculateVatAmount, getSuiteVatRatePercent } from "../utils/settings";
import { confirmAction, notifyError, notifyToast } from "../../components/notificationService";

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

type CreditNotesProps = {
  canManage: boolean;
  isReadOnly?: boolean;
};

type CreditNoteSortKey = "creditNoteNo" | "dateBs" | "party" | "amount" | "vatAmount" | "totalAmount" | "remarks";
type SortDirection = "asc" | "desc";

export default function CreditNotes({ canManage, isReadOnly = false }: CreditNotesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [editingCreditNoteId, setEditingCreditNoteId] = useState("");
  const [creditNoteNo, setCreditNoteNo] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creditNoteSort, setCreditNoteSort] = useState<{ key: CreditNoteSortKey | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });

  const numericAmount = Number(amount || 0);
  const vatRatePercent = getSuiteVatRatePercent();
  const numericVatAmount = calculateVatAmount(numericAmount);
  const totalAmount = Number((numericAmount + numericVatAmount).toFixed(2));

  async function loadData() {
    setParties(await getParties());
    setCreditNotes(await getCreditNotes());
  }

  useEffect(() => {
    loadData();
  }, []);

  function clearForm() {
    setEditingCreditNoteId("");
    setCreditNoteNo("");
    setDateBs("");
    setPartyId("");
    setAmount("");
    setRemarks("");
  }

  function handleEditCreditNote(creditNote: CreditNote) {
    if (!canManage) {
      notifyError("Master access is required to edit credit notes.", "Edit not allowed");
      return;
    }

    setEditingCreditNoteId(creditNote.id);
    setCreditNoteNo(creditNote.creditNoteNo);
    setDateBs(creditNote.dateBs);
    setPartyId(creditNote.partyId);
    setAmount(String(creditNote.amount));
    setRemarks(creditNote.remarks ?? "");
    scrollToPageTop("smooth");
  }

  async function handleSave() {
    setFieldErrors({});

    const rejectField = (field: string, messageText: string) => {
      setFieldErrors({ [field]: messageText });
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus());
    };

    if (!creditNoteNo.trim()) {
      rejectField("creditNoteNo", "Credit note number is required.");
      return;
    }

    if (!dateBs.trim()) {
      rejectField("dateBs", "Date BS is required.");
      return;
    }

    if (!partyId) {
      rejectField("partyId", "Party is required.");
      return;
    }

    if (numericAmount <= 0) {
      rejectField("amount", "Amount must be greater than zero.");
      return;
    }

    if (numericVatAmount < 0) {
      rejectField("amount", "VAT must not be negative.");
      return;
    }

    try {
      if (editingCreditNoteId) {
        if (!canManage) {
          notifyError("Master access is required to update credit notes.", "Edit not allowed");
          return;
        }

        await updateCreditNote({
          id: editingCreditNoteId,
          creditNoteNo,
          dateBs,
          partyId,
          amount: numericAmount,
          vatAmount: numericVatAmount,
          totalAmount,
          remarks,
        });
        notifyToast("Credit note adjustment updated successfully.");
      } else {
        await saveCreditNote({
          creditNoteNo,
          dateBs,
          partyId,
          amount: numericAmount,
          vatAmount: numericVatAmount,
          totalAmount,
          remarks,
        });
        notifyToast("Credit note adjustment saved successfully.");
      }

      clearForm();
      await loadData();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error || "Failed to save credit note."), "Adjustment could not be saved");
    }
  }

  async function handleDeleteCreditNote(creditNote: CreditNote) {
    if (!canManage) {
      notifyError("Master access is required to delete credit notes.", "Delete not allowed");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete adjustment?",
      message: `Credit note: ${creditNote.creditNoteNo}\nDate: ${creditNote.dateBs}\nParty: ${parties.find((item) => item.id === creditNote.partyId)?.name || "Unknown"}\nAmount: ${formatMoney(creditNote.totalAmount)}\n\nThis cannot be undone.`,
      confirmLabel: "Delete adjustment",
      destructive: true,
    });

    if (!confirmed) return;

    try {
      await deleteCreditNote(creditNote.id);

      if (editingCreditNoteId === creditNote.id) {
        clearForm();
      }

      await loadData();
      notifyToast(`Credit note no. ${creditNote.creditNoteNo} deleted successfully.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error || "Failed to delete credit note."), "Adjustment could not be deleted");
    }
  }

  const totalAdjustments = creditNotes.reduce(
    (sum, creditNote) => sum + creditNote.totalAmount,
    0
  );
  const totalVatAdjustment = creditNotes.reduce(
    (sum, creditNote) => sum + creditNote.vatAmount,
    0
  );
  const sortedCreditNotes = creditNoteSort.key
    ? [...creditNotes].sort((left, right) => compareCreditNotes(left, right, creditNoteSort.key as CreditNoteSortKey, creditNoteSort.direction, parties))
    : creditNotes;

  function toggleCreditNoteSort(key: CreditNoteSortKey) {
    setCreditNoteSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortableHeader(key: CreditNoteSortKey, label: string) {
    const isActive = creditNoteSort.key === key;
    return (
      <th aria-sort={isActive ? (creditNoteSort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sortable-table-header" onClick={() => toggleCreditNoteSort(key)}>
          {label}
          <span aria-hidden="true">{isActive ? (creditNoteSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
          <span className="sr-only">
            {isActive ? ` sorted ${creditNoteSort.direction === "asc" ? "ascending" : "descending"}` : " sort column"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <>
      <h1>Credit Note Adjustments</h1>

      {!isReadOnly && <div className="card">
        <h3>{editingCreditNoteId ? "Edit Credit Note" : "Add Credit Note"}</h3>

        <div className="form-grid">
            <label>
              Credit Note No. <span className="required">*</span>
              <input
                name="creditNoteNo"
                inputMode="numeric"
                value={creditNoteNo}
                aria-invalid={Boolean(fieldErrors.creditNoteNo)}
                onChange={(e) => {
                  setCreditNoteNo(normalizeWholeNumber(e.target.value));
                  setFieldErrors((current) => ({ ...current, creditNoteNo: "" }));
                }}
              />
              {fieldErrors.creditNoteNo && <span className="field-error" role="alert">{fieldErrors.creditNoteNo}</span>}
            </label>

            <label>
              Date BS <span className="required">*</span>
              <input
                name="dateBs"
                placeholder="YYYY/MM/DD or YYYY-MM-DD"
                value={dateBs}
                aria-invalid={Boolean(fieldErrors.dateBs)}
                onChange={(e) => {
                  setDateBs(e.target.value);
                  setFieldErrors((current) => ({ ...current, dateBs: "" }));
                }}
                onBlur={(e) => setDateBs(normalizeBsDate(e.target.value))}
              />
              {fieldErrors.dateBs && <span className="field-error" role="alert">{fieldErrors.dateBs}</span>}
            </label>

            <label>
              Party <span className="required">*</span>
              <select name="partyId" value={partyId} aria-invalid={Boolean(fieldErrors.partyId)} onChange={(e) => {
                setPartyId(e.target.value);
                setFieldErrors((current) => ({ ...current, partyId: "" }));
              }}>
                <option value="">Select Party</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
              {fieldErrors.partyId && <span className="field-error" role="alert">{fieldErrors.partyId}</span>}
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
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFieldErrors((current) => ({ ...current, amount: "" }));
                }}
              />
              {fieldErrors.amount && <span className="field-error" role="alert">{fieldErrors.amount}</span>}
            </label>

            <label>
              VAT {vatRatePercent}%
              <input readOnly value={formatMoney(numericVatAmount)} />
            </label>

            <label>
              Total Adjustment
              <input disabled value={totalAmount.toLocaleString()} />
            </label>

            <label className="full-width-field">
              Remarks
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
        </div>

        <br />
        <div className="action-buttons">
          <button className="primary" onClick={handleSave}>
            {editingCreditNoteId ? "Update Adjustment" : "Save Adjustment"}
          </button>

          {editingCreditNoteId && (
            <button className="secondary" onClick={clearForm}>
              Cancel Edit
            </button>
          )}
        </div>
      </div>}


      <div className="metric-grid">
        <div className="metric-card orange">
          <span>Total Adjustments</span>
          <strong>{formatMoney(totalAdjustments)}</strong>
        </div>
        <div className="metric-card purple">
          <span>VAT Adjustment</span>
          <strong>{formatMoney(totalVatAdjustment)}</strong>
        </div>
      </div>

      <div className="card">
        <h3>Adjustment Register</h3>

        <table>
          <thead>
            <tr>
              {renderSortableHeader("creditNoteNo", "Credit Note No.")}
              {renderSortableHeader("dateBs", "Date BS")}
              {renderSortableHeader("party", "Party")}
              {renderSortableHeader("amount", "Amount")}
              {renderSortableHeader("vatAmount", "VAT")}
              {renderSortableHeader("totalAmount", "Total Adjustment")}
              {renderSortableHeader("remarks", "Remarks")}
              {canManage && <th>Action</th>}
            </tr>
          </thead>

          <tbody>
            {sortedCreditNotes.map((creditNote) => {
              const party = parties.find((item) => item.id === creditNote.partyId);

              return (
                <tr key={creditNote.id}>
                  <td>{creditNote.creditNoteNo}</td>
                  <td>{creditNote.dateBs}</td>
                  <td>{party?.name || "Unknown"}</td>
                  <td>{formatMoney(creditNote.amount)}</td>
                  <td>{formatMoney(creditNote.vatAmount)}</td>
                  <td>
                    <strong>{formatMoney(creditNote.totalAmount)}</strong>
                  </td>
                  <td>{creditNote.remarks}</td>
                  {canManage && (
                    <td>
                      <div className="action-buttons">
                        <button
                          className="secondary small"
                          onClick={() => handleEditCreditNote(creditNote)}
                        >
                          Edit
                        </button>
                        <button
                          className="danger small"
                          onClick={() => handleDeleteCreditNote(creditNote)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function compareCreditNotes(
  left: CreditNote,
  right: CreditNote,
  key: CreditNoteSortKey,
  direction: SortDirection,
  parties: Party[],
) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  const partyName = (creditNote: CreditNote) => parties.find((party) => party.id === creditNote.partyId)?.name ?? "";

  if (key === "creditNoteNo" || key === "amount" || key === "vatAmount" || key === "totalAmount") {
    const leftValue = key === "creditNoteNo" ? Number(left.creditNoteNo || 0) : Number(left[key] || 0);
    const rightValue = key === "creditNoteNo" ? Number(right.creditNoteNo || 0) : Number(right[key] || 0);
    const compare = leftValue - rightValue;
    if (compare !== 0) return compare * directionMultiplier;
  } else {
    const leftValue = key === "party" ? partyName(left) : String(left[key] ?? "");
    const rightValue = key === "party" ? partyName(right) : String(right[key] ?? "");
    const compare = leftValue.localeCompare(rightValue);
    if (compare !== 0) return compare * directionMultiplier;
  }

  return Number(left.creditNoteNo || 0) - Number(right.creditNoteNo || 0) || left.createdAt.localeCompare(right.createdAt);
}

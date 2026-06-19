import { useEffect, useState } from "react";
import type { CreditNote, Party } from "../data/types";
import {
  deleteCreditNote,
  getCreditNotes,
  getParties,
  saveCreditNote,
  updateCreditNote,
} from "../data/storage";
import { calculateVatAmount, getSuiteVatRatePercent } from "../utils/settings";

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
};

export default function CreditNotes({ canManage }: CreditNotesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [editingCreditNoteId, setEditingCreditNoteId] = useState("");
  const [creditNoteNo, setCreditNoteNo] = useState("");
  const [dateBs, setDateBs] = useState("");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState("");

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
      setMessage("Master access is required to edit credit notes.");
      return;
    }

    setMessage("");
    setEditingCreditNoteId(creditNote.id);
    setCreditNoteNo(creditNote.creditNoteNo);
    setDateBs(creditNote.dateBs);
    setPartyId(creditNote.partyId);
    setAmount(String(creditNote.amount));
    setRemarks(creditNote.remarks ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    setMessage("");

    if (!creditNoteNo.trim()) {
      setMessage("Credit note number is required.");
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

    if (numericAmount <= 0) {
      setMessage("Amount must be greater than zero.");
      return;
    }

    if (numericVatAmount < 0) {
      setMessage("VAT must not be negative.");
      return;
    }

    try {
      if (editingCreditNoteId) {
        if (!canManage) {
          setMessage("Master access is required to update credit notes.");
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
        setMessage("Credit note adjustment updated successfully.");
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
        setMessage("Credit note adjustment saved successfully.");
      }

      clearForm();
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to save credit note.")
      );
    }
  }

  async function handleDeleteCreditNote(creditNote: CreditNote) {
    if (!canManage) {
      setMessage("Master access is required to delete credit notes.");
      return;
    }

    const confirmed = window.confirm(
      `Delete credit note no. ${creditNote.creditNoteNo}?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteCreditNote(creditNote.id);

      if (editingCreditNoteId === creditNote.id) {
        clearForm();
      }

      await loadData();
      setMessage(`Credit note no. ${creditNote.creditNoteNo} deleted successfully.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to delete credit note.")
      );
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

  return (
    <>
      <h1>Credit Note Adjustments</h1>

      <div className="card">
        <h3>{editingCreditNoteId ? "Edit Credit Note" : "Add Credit Note"}</h3>

        {message && <p className="status-message">{message}</p>}

        <div className="form-grid">
            <label>
              Credit Note No. <span className="required">*</span>
              <input
                inputMode="numeric"
                value={creditNoteNo}
                onChange={(e) => setCreditNoteNo(normalizeWholeNumber(e.target.value))}
              />
            </label>

            <label>
              Date BS <span className="required">*</span>
              <input
                placeholder="YYYY/MM/DD or YYYY-MM-DD"
                value={dateBs}
                onChange={(e) => setDateBs(e.target.value)}
                onBlur={(e) => setDateBs(normalizeBsDate(e.target.value))}
              />
            </label>

            <label>
              Party <span className="required">*</span>
              <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">Select Party</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Amount <span className="required">*</span>
              <input
                min="0"
                step="0.01"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
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
      </div>


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
              <th>Credit Note No.</th>
              <th>Date BS</th>
              <th>Party</th>
              <th>Amount</th>
              <th>VAT</th>
              <th>Total Adjustment</th>
              <th>Remarks</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>

          <tbody>
            {creditNotes.map((creditNote) => {
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

import { useEffect, useState } from "react";
import type { LedgerRow, OutstandingRow, Party } from "../data/types";
import { getOutstanding, getParties, getPartyLedger } from "../data/storage";
import { saveLedgerPdf } from "../utils/pdf";
import OutputVatReport from "./Maskebari";

type ReportView = "Party Ledger" | "Outstanding Balance" | "Output VAT";

export default function Reports() {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [reportView, setReportView] = useState<ReportView>("Party Ledger");
  const [message, setMessage] = useState("");

  async function loadReport() {
    setRows(await getOutstanding());
    setParties(await getParties());
  }

  async function loadLedger(partyId: string) {
    setSelectedPartyId(partyId);

    if (!partyId) {
      setLedgerRows([]);
      return;
    }

    setLedgerRows(await getPartyLedger(partyId));
  }

  useEffect(() => {
    loadReport();
  }, []);

  const selectedParty = parties.find((party) => party.id === selectedPartyId);

  async function handleDownloadLedgerPdf() {
    setMessage("");

    if (!selectedParty) {
      setMessage("Please select a party before downloading the ledger PDF.");
      return;
    }

    try {
      await saveLedgerPdf(selectedParty, ledgerRows);
      setMessage(`Ledger PDF generated for ${selectedParty.name}.`);
    } catch (error) {
      console.error("ledger pdf error:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to generate ledger PDF.")
      );
    }
  }

  return (
    <>
      <h1>Reports</h1>
      {message && <p className="status-message">{message}</p>}

      <div className="tabs">
        {(["Party Ledger", "Outstanding Balance", "Output VAT"] as ReportView[]).map((item) => (
          <button
            key={item}
            className={reportView === item ? "active" : ""}
            type="button"
            onClick={() => setReportView(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {reportView === "Party Ledger" && (
        <div className="card">
          <div className="card-header report-header">
            <h3>Party Ledger</h3>

            <button
              className="primary"
              disabled={!selectedParty}
              onClick={handleDownloadLedgerPdf}
            >
              Download Ledger PDF
            </button>
          </div>

          <div className="toolbar">
            <label>
              Select Party
              <select
                value={selectedPartyId}
                onChange={(e) => loadLedger(e.target.value)}
              >
                <option value="">Select Party</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date BS</th>
                  <th>Type</th>
                  <th>Bill / Receipt No</th>
                  <th>Debit / Sales</th>
                  <th>Credit / Collection</th>
                  <th>Running Balance</th>
                </tr>
              </thead>

              <tbody>
                {ledgerRows.map((row, index) => (
                  <tr key={`${row.type}-${row.reference}-${index}`}>
                    <td>{row.dateBs || "-"}</td>
                    <td>{row.type}</td>
                    <td>{row.reference || "-"}</td>
                    <td>{row.debit ? row.debit.toLocaleString() : ""}</td>
                    <td>{row.credit ? row.credit.toLocaleString() : ""}</td>
                    <td>
                      <strong>{row.balance.toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
                {ledgerRows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      Select a party to view ledger rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportView === "Outstanding Balance" && (
        <div className="card">
          <div className="card-header report-header">
            <h3>Outstanding Balance</h3>

            <button className="secondary" onClick={loadReport}>
              Refresh Report
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Opening Balance</th>
                  <th>Total Sales</th>
                  <th>Total Collections</th>
                  <th>Adjustments</th>
                  <th>Outstanding</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr key={row.partyId}>
                    <td>{row.partyName}</td>
                    <td>{row.openingBalance.toLocaleString()}</td>
                    <td>{row.totalSales.toLocaleString()}</td>
                    <td>{row.totalCollections.toLocaleString()}</td>
                    <td>{row.totalAdjustments.toLocaleString()}</td>
                    <td>
                      <strong>{row.outstanding.toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      No outstanding records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportView === "Output VAT" && <OutputVatReport />}
    </>
  );
}

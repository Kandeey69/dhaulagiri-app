import { useCallback, useEffect, useState } from "react";
import type { LedgerRow, OutstandingRow, Party, Sale } from "../data/types";
import { getOutstanding, getParties, getPartyLedger, getSales } from "../data/storage";
import { saveLedgerPdf } from "../utils/pdf";
import OutputVatReport from "./Maskebari";
import { companyStorageKey } from "../../companyContext";
import ThirdPartyConfirmation from "./ThirdPartyConfirmation";

type ReportView = "Party Ledger" | "Outstanding Balance" | "Output VAT" | "3rd Party Confirmation";

export default function Reports() {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [reportView, setReportView] = useState<ReportView>(() => {
    const saved = localStorage.getItem(companyStorageKey("accounts-report-view")) as ReportView | null;
    return saved === "Output VAT" ||
      saved === "Outstanding Balance" ||
      saved === "Party Ledger" ||
      saved === "3rd Party Confirmation"
      ? saved
      : "Party Ledger";
  });
  const [outputVatMonth, setOutputVatMonth] = useState(
    () => localStorage.getItem(companyStorageKey("accounts-output-vat-month")) || "1"
  );
  const [reportSearch, setReportSearch] = useState("");
  const [message, setMessage] = useState("");

  const loadLedger = useCallback(async (partyId: string) => {
    setSelectedPartyId(partyId);

    if (!partyId) {
      setLedgerRows([]);
      return;
    }

    setLedgerRows(await getPartyLedger(partyId));
  }, []);

  const loadReport = useCallback(async () => {
    const [loadedRows, loadedParties, loadedSales] = await Promise.all([getOutstanding(), getParties(), getSales()]);
    setRows(loadedRows);
    setParties(loadedParties);
    setSales(loadedSales);

    const dashboardPartyId = localStorage.getItem(companyStorageKey("accounts-report-party-id")) || "";
    if (dashboardPartyId) {
      await loadLedger(dashboardPartyId);
      localStorage.removeItem(companyStorageKey("accounts-report-party-id"));
    }

    const dashboardMonth = localStorage.getItem(companyStorageKey("accounts-output-vat-month"));
    if (dashboardMonth) {
      setOutputVatMonth(dashboardMonth);
    }
  }, [loadLedger]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const selectedParty = parties.find((party) => party.id === selectedPartyId);
  const reportSearchText = reportSearch.trim().toLowerCase();
  const filteredParties = reportSearchText
    ? parties.filter((party) =>
        [party.name, party.panNo, party.address, party.phone]
          .some((value) => String(value || "").toLowerCase().includes(reportSearchText))
      )
    : parties;
  const filteredLedgerRows = reportSearchText
    ? ledgerRows.filter((row) =>
        [
          row.dateBs,
          row.type,
          row.reference,
          row.remarks,
          row.debit,
          row.credit,
          row.balance,
        ]
          .some((value) => String(value || "").toLowerCase().includes(reportSearchText))
      )
    : ledgerRows;
  const filteredOutstandingRows = reportSearchText
    ? rows.filter((row) =>
        [
          row.partyName,
          row.openingBalance,
          row.totalSales,
          row.totalCollections,
          row.totalAdjustments,
          row.outstanding,
        ]
          .some((value) => String(value || "").toLowerCase().includes(reportSearchText))
      )
    : rows;

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
        {(["Party Ledger", "Outstanding Balance", "Output VAT", "3rd Party Confirmation"] as ReportView[]).map((item) => (
          <button
            key={item}
            className={reportView === item ? "active" : ""}
            type="button"
            onClick={() => {
              setReportView(item);
              localStorage.setItem(companyStorageKey("accounts-report-view"), item);
            }}
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
            <label className="search-field">
              Search report
              <input
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
                placeholder="Party, bill, receipt, amount"
              />
            </label>
            <label>
              Select Party
              <select
                value={selectedPartyId}
                onChange={(e) => loadLedger(e.target.value)}
              >
                <option value="">Select Party</option>
                {filteredParties.map((party) => (
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
                {filteredLedgerRows.map((row, index) => (
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
                {filteredLedgerRows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      {ledgerRows.length ? "No ledger rows match the search." : "Select a party to view ledger rows."}
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

          <div className="toolbar">
            <label className="search-field">
              Search outstanding
              <input
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
                placeholder="Party or amount"
              />
            </label>
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
                {filteredOutstandingRows.map((row) => (
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
                {filteredOutstandingRows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      {rows.length ? "No outstanding records match the search." : "No outstanding records yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportView === "Output VAT" && <OutputVatReport initialMonth={outputVatMonth} />}

      {reportView === "3rd Party Confirmation" && (
        <ThirdPartyConfirmation outstandingRows={rows} parties={parties} sales={sales} />
      )}
    </>
  );
}

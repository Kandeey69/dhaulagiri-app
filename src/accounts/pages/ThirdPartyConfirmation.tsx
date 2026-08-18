import { useMemo, useState } from "react";
import { getActiveCompanyProfile, getCompanySetting } from "../../companyContext";
import type { OutstandingRow, Party, Sale } from "../data/types";
import { readLetterheadSettings } from "../utils/letterheadSettings";
import {
  saveThirdPartyConfirmationPdf,
  type ThirdPartyConfirmationData,
  type ThirdPartyConfirmationSummary,
} from "../utils/thirdPartyConfirmationPdf";

type ThirdPartyConfirmationProps = {
  outstandingRows: OutstandingRow[];
  parties: Party[];
  sales: Sale[];
};

export default function ThirdPartyConfirmation({
  outstandingRows,
  parties,
  sales,
}: ThirdPartyConfirmationProps) {
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [message, setMessage] = useState("");
  const activeCompany = getActiveCompanyProfile();
  const letterhead = readLetterheadSettings();
  const selectedParty = parties.find((party) => party.id === selectedPartyId) ?? null;
  const outstandingRow = outstandingRows.find((row) => row.partyId === selectedPartyId) ?? null;
  const fiscalYear = getCompanySetting("accounts-fiscal-year", activeCompany?.fiscalYear || "");
  const companyName = getCompanySetting("accounts-company-name", activeCompany?.name || "Company");
  const companyAddress = getCompanySetting("suite-address", "");
  const companyPanVatNo = getCompanySetting("suite-pan-vat-no", "");
  const companyPhoneNumbers = getCompanySetting("suite-phone", "");

  const summary = useMemo(
    () => buildConfirmationSummary(selectedParty, outstandingRow, sales),
    [outstandingRow, sales, selectedParty],
  );
  const confirmationData = selectedParty && summary
    ? {
        companyAddress,
        companyName,
        companyPanVatNo,
        companyPhoneNumbers,
        fiscalYear,
        letterhead,
        partyAddress: selectedParty.address || "",
        partyName: selectedParty.name,
        partyPanVatNo: selectedParty.panNo || "",
        summary,
      }
    : null;

  async function downloadPdf() {
    setMessage("");

    if (!confirmationData) {
      setMessage("Please select a party before downloading the confirmation PDF.");
      return;
    }

    try {
      await saveThirdPartyConfirmationPdf(confirmationData);
      setMessage(`3rd Party Confirmation PDF generated for ${confirmationData.partyName}.`);
    } catch (error) {
      console.error("third party confirmation pdf error:", error);
      setMessage(error instanceof Error ? error.message : String(error || "Failed to generate confirmation PDF."));
    }
  }

  return (
    <div className="card">
      <div className="card-header report-header">
        <h3>3rd Party Confirmation</h3>
        <button className="primary" disabled={!confirmationData} type="button" onClick={downloadPdf}>
          Download PDF
        </button>
      </div>

      {message && <p className="status-message">{message}</p>}

      <div className="toolbar">
        <label>
          Select Party
          <select value={selectedPartyId} onChange={(event) => setSelectedPartyId(event.target.value)}>
            <option value="">Select Party</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Fiscal Year
          <input readOnly value={fiscalYear || "-"} />
        </label>
      </div>

      <div className="confirmation-preview-shell">
        {confirmationData ? (
          <ConfirmationPreview data={confirmationData} />
        ) : (
          <p className="empty">Select a party to preview the confirmation letter.</p>
        )}
      </div>
    </div>
  );
}

function ConfirmationPreview({ data }: { data: ThirdPartyConfirmationData }) {
  const tableRows = [
    ["Previous FY closing/opening balance", data.summary.openingBalance],
    ["Total sale of the year", data.summary.totalSale],
    ["Taxable sale", data.summary.taxableSale],
    ["VAT amount", data.summary.vatAmount],
    ["Less: collection received", -Math.abs(data.summary.collectionReceived)],
  ];

  if (Math.abs(data.summary.adjustmentTotal) > 0) {
    tableRows.push(["Less: credit notes/adjustments", -Math.abs(data.summary.adjustmentTotal)]);
  }

  tableRows.push(["Closing balance", data.summary.closingBalance]);

  return (
    <div className="confirmation-page-preview">
      <div className="confirmation-fallback-letterhead">
        <div>
          <strong>{data.companyPanVatNo ? `VAT/PAN: ${data.companyPanVatNo}` : ""}</strong>
          <strong>{data.companyPhoneNumbers ? `Mob. No. ${data.companyPhoneNumbers}` : ""}</strong>
        </div>
        {data.letterhead.nepaliCompanyName && <h3>{data.letterhead.nepaliCompanyName}</h3>}
        <h2>{data.companyName}</h2>
        {data.companyAddress && <p>{data.companyAddress}</p>}
        <div>
          <span>Ref No.:</span>
          <span>Date: ....................</span>
        </div>
      </div>

      <section className="confirmation-body">
        <div className="confirmation-to">
          <p>To,</p>
          <p>{data.partyName}</p>
          {data.partyAddress && <p>{data.partyAddress}</p>}
          {data.partyPanVatNo && <p>VAT/PAN: {data.partyPanVatNo}</p>}
        </div>

        <h4>Subject: Confirmation of transaction and balance of F.Y. {data.fiscalYear || "-"}</h4>

        <p>Dear Sir,</p>
        <p className="confirmation-indent">
          We are including following transaction value and balances in our Annual {data.fiscalYear || "-"}. Please send
          us your acknowledgement to inform us for variations if any or else we regard your acceptance for the same.
        </p>

        <table className="confirmation-summary-table">
          <thead>
            <tr>
              <th>Particulars</th>
              <th>Amount (NPR)</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(([label, amount], index) => (
              <tr key={label} className={index === tableRows.length - 1 ? "total-row" : ""}>
                <td>{label}</td>
                <td>{formatMoney(Number(amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p>{confirmationContactLine(data)}</p>

        <div className="confirmation-signature-grid">
          <div>
            <p>Thanks you</p>
            <p>For,</p>
            <div className="confirmation-signature-space" />
            <strong>{data.companyName}</strong>
            {data.companyAddress && <p>{data.companyAddress}</p>}
            {data.companyPanVatNo && <p>VAT/PAN: {data.companyPanVatNo}</p>}
          </div>
          <strong>Acknowledged By</strong>
        </div>
      </section>
    </div>
  );
}

function buildConfirmationSummary(
  party: Party | null,
  outstandingRow: OutstandingRow | null,
  sales: Sale[],
): ThirdPartyConfirmationSummary | null {
  if (!party) {
    return null;
  }

  const partySales = sales.filter((sale) => sale.partyId === party.id);
  const taxableSale = sum(partySales.map((sale) => sale.salesAmount));
  const vatAmount = sum(partySales.map((sale) => sale.vatAmount));
  const totalSale = outstandingRow?.totalSales ?? sum(partySales.map((sale) => sale.totalAmount || sale.salesAmount + sale.vatAmount));
  const openingBalance = outstandingRow?.openingBalance ?? party.openingBalance;
  const collectionReceived = outstandingRow?.totalCollections ?? 0;
  const adjustmentTotal = outstandingRow?.totalAdjustments ?? 0;
  const closingBalance =
    outstandingRow?.outstanding ??
    openingBalance + totalSale - collectionReceived - adjustmentTotal;

  return {
    adjustmentTotal,
    closingBalance,
    collectionReceived,
    openingBalance,
    taxableSale,
    totalSale,
    vatAmount,
  };
}

function confirmationContactLine(data: ThirdPartyConfirmationData) {
  const saved = data.letterhead.contactLine.trim();

  if (saved) {
    return saved;
  }

  return data.companyPhoneNumbers
    ? `Should you have any queries please feel free to contact us at ${data.companyPhoneNumbers}.`
    : "Should you have any queries please feel free to contact us.";
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

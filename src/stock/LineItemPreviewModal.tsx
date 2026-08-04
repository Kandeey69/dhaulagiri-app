import { useMemo } from "react";
import "./LineItemPreviewModal.css";
import { formatCurrency, formatRate } from "./services/stockCalculations";
import type { StockItem, StockPurchaseLine, StockSalesLine } from "./types";

type PreviewLine = StockPurchaseLine | StockSalesLine;

type LineItemPreviewModalProps = {
  billAmount: number;
  billNumber: string;
  companyName: string;
  counterpartyLabel: string;
  counterpartyName: string;
  documentKind: "sales" | "purchase";
  date: string;
  currency: "NPR" | "INR" | "USD";
  exchangeRate?: number;
  fiscalYear: string;
  grandTotal?: number;
  items: StockItem[];
  lines: PreviewLine[];
  onClose: () => void;
  panNumber?: string;
  title: string;
  vatAmount?: number;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export default function LineItemPreviewModal({
  billAmount,
  billNumber,
  companyName,
  counterpartyLabel,
  counterpartyName,
  documentKind,
  date,
  currency,
  exchangeRate = 1,
  fiscalYear,
  grandTotal,
  items,
  lines,
  onClose,
  panNumber,
  title,
  vatAmount = 0,
}: LineItemPreviewModalProps) {
  const safeExchangeRate = exchangeRate > 0 ? exchangeRate : 1;
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );
  const hasVatAmount = Math.abs(vatAmount) > 0.01;
  const resolvedGrandTotal = grandTotal ?? billAmount + vatAmount;
  const previewHeading = documentKind === "sales" ? "For Sales" : "For Purchase";
  const billNumberLabel = "Bill No.";
  const totalLabel = hasVatAmount ? "Total" : "Grand Total";

  return (
    <div className="stock-preview-backdrop" role="presentation">
      <section
        aria-modal="true"
        className="stock-preview-modal"
        role="dialog"
        aria-labelledby="stock-preview-title"
      >
        <header className="stock-preview-header">
          <h2 id="stock-preview-title">{previewHeading}</h2>
          <button type="button" className="stock-preview-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="stock-preview-sheet-meta">
          <div className="stock-preview-party">
            <span>{counterpartyLabel} Name:</span>
            <strong className="stock-preview-party-name">{counterpartyName || "-"}</strong>
          </div>
          {documentKind === "sales" && (
            <div>
              <span>PAN Number:</span>
              <strong>{panNumber || "-"}</strong>
            </div>
          )}
          {documentKind === "purchase" && (
            <div>
              <span>Currency:</span>
              <strong>{currency}</strong>
            </div>
          )}
          <div>
            <span>Date:</span>
            <strong>{date || "-"}</strong>
          </div>
          <div>
            <span>{billNumberLabel}:</span>
            <strong>{billNumber || "-"}</strong>
          </div>
        </div>

        <div className="stock-preview-table-wrap">
          <table className="stock-preview-table">
            <thead>
              <tr>
                <th>SN</th>
                <th>Particulars</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const item = itemById.get(line.itemId);
                const entryRate = "entryRate" in line ? line.entryRate ?? line.rate : line.rate;
                const entryAmount = "entryAmount" in line ? line.entryAmount ?? line.quantity * entryRate : line.quantity * entryRate;
                const displayRate = currency === "NPR" ? entryRate : entryRate / safeExchangeRate;
                const displayAmount = currency === "NPR" ? entryAmount : entryAmount / safeExchangeRate;

                return (
                  <tr key={line.id}>
                    <td>{index + 1}</td>
                    <td>{item ? `${item.code} - ${item.name}` : "Unknown item"}</td>
                    <td>{item?.unit || "MT"}</td>
                    <td>{formatNumber(line.quantity)}</td>
                    <td>{formatRate(displayRate, currency)}</td>
                    <td>{formatCurrency(displayAmount, currency)}</td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6}>No inventory line item has been entered.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="stock-preview-total-blank" colSpan={4} />
                <th>{totalLabel}</th>
                <td>{formatCurrency(billAmount, currency)}</td>
              </tr>
              {hasVatAmount && (
                <>
                  <tr>
                    <td className="stock-preview-total-blank" colSpan={4} />
                    <th>Add: VAT</th>
                    <td>{formatCurrency(vatAmount, currency)}</td>
                  </tr>
                  <tr className="stock-preview-grand-total">
                    <td className="stock-preview-total-blank" colSpan={4} />
                    <th>Grand Total</th>
                    <td>{formatCurrency(resolvedGrandTotal, currency)}</td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>

        <div className="stock-preview-footer">
          <p>{companyName || "Company"} | {title} | {fiscalYear || "Fiscal Year"}</p>
        </div>
      </section>
    </div>
  );
}

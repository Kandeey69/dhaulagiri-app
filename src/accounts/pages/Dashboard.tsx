import { useEffect, useState } from "react";
import type { Collection, CreditNote, OutstandingRow, Party, Sale } from "../data/types";
import {
  getCollections,
  getCreditNotes,
  getOutstanding,
  getParties,
  getSales,
} from "../data/storage";

type DashboardTarget = "sales" | "collections" | "creditNotes" | "reports";

type DashboardProps = {
  onNavigate: (page: DashboardTarget) => void;
};

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);

  useEffect(() => {
    async function load() {
      const [
        loadedParties,
        loadedSales,
        loadedCollections,
        loadedCreditNotes,
        loadedOutstanding,
      ] = await Promise.all([
        getParties(),
        getSales(),
        getCollections(),
        getCreditNotes(),
        getOutstanding(),
      ]);

      setParties(loadedParties);
      setSales(loadedSales);
      setCollections(loadedCollections);
      setCreditNotes(loadedCreditNotes);
      setOutstanding(loadedOutstanding);
    }

    load();
  }, []);

  const salesBeforeVat = sales.reduce((sum, sale) => sum + sale.salesAmount, 0);
  const salesVat = sales.reduce((sum, sale) => sum + sale.vatAmount, 0);
  const totalSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const totalCollections = collections.reduce(
    (sum, collection) => sum + collection.amount,
    0
  );
  const totalAdjustments = creditNotes.reduce(
    (sum, creditNote) => sum + creditNote.totalAmount,
    0
  );
  const totalOutstanding = outstanding.reduce((sum, row) => sum + row.outstanding, 0);
  const openingBalance = outstanding.reduce(
    (sum, row) => sum + row.openingBalance,
    0
  );
  const totalReceivable = openingBalance + totalSales;
  const totalSettled = totalCollections + totalAdjustments;
  const collectionRate =
    totalReceivable > 0
      ? Math.min(100, Math.round((totalSettled / totalReceivable) * 100))
      : 0;
  const recentSales = [...sales].slice(-5).reverse();
  const recentCollections = [...collections].slice(-5).reverse();
  const topOutstanding = [...outstanding]
    .sort((left, right) => right.outstanding - left.outstanding)
    .slice(0, 5);

  return (
    <div className="stack">
      <div className="card">
        <h3>New Entry</h3>
        <div className="quick-actions">
          <button type="button" onClick={() => onNavigate("sales")}>
            New sale
          </button>
          <button type="button" onClick={() => onNavigate("collections")}>
            New collection
          </button>
          <button type="button" onClick={() => onNavigate("creditNotes")}>
            New credit note / adjustment
          </button>
          <button type="button" className="ghost" onClick={() => onNavigate("reports")}>
            Open reports
          </button>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Parties" value={String(parties.length)} />
        <MetricCard label="Sales before VAT" value={formatMoney(salesBeforeVat)} />
        <MetricCard label="Sales VAT" value={formatMoney(salesVat)} />
        <MetricCard label="Collections" value={formatMoney(totalCollections)} />
        <MetricCard label="Net receivable" value={formatMoney(totalOutstanding)} />
      </div>

      <div className="two-column">
        <div className="card">
          <div className="card-header report-header">
            <h3>Collection Progress</h3>
            <strong>{collectionRate}%</strong>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${collectionRate}%` }} />
          </div>
          <div className="split-stats">
            <span>Opening + Bills: {formatMoney(totalReceivable)}</span>
            <span>Collected + Adjusted: {formatMoney(totalSettled)}</span>
          </div>
        </div>

        <div className="card">
          <h3>Top Outstanding Parties</h3>
          <div className="rank-list">
            {topOutstanding.map((row) => (
              <div key={row.partyId} className="rank-row">
                <span>{row.partyName}</span>
                <strong>{formatMoney(row.outstanding)}</strong>
              </div>
            ))}
            {topOutstanding.length === 0 && <p className="muted">No outstanding data yet.</p>}
          </div>
        </div>
      </div>

      <div className="two-column">
        <div className="card">
          <h3>Recent Sales</h3>
          <SimpleTable
            emptyText="No sales yet."
            headers={["Date BS", "Party", "Bill", "Total"]}
            rows={recentSales.map((sale) => [
              sale.dateBs || "-",
              partyName(parties, sale.partyId),
              sale.billNo,
              formatMoney(sale.totalAmount),
            ])}
          />
        </div>

        <div className="card">
          <h3>Recent Collections</h3>
          <SimpleTable
            emptyText="No collections yet."
            headers={["Date BS", "Party", "Receipt", "Amount"]}
            rows={recentCollections.map((collection) => [
              collection.dateBs || "-",
              partyName(parties, collection.partyId),
              collection.receiptNo || "-",
              formatMoney(collection.amount),
            ])}
          />
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

function SimpleTable({
  emptyText,
  headers,
  rows,
}: {
  emptyText: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell || "-"}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={headers.length}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function partyName(parties: Party[], partyId: string) {
  return parties.find((party) => party.id === partyId)?.name || "Unknown party";
}

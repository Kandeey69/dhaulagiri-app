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
  const monthlySales = makeMonthlyRows(
    sales.map((sale) => ({ date: sale.dateBs, amount: sale.totalAmount }))
  );
  const salesByParty = makePartySlices(
    sales.map((sale) => ({
      name: partyName(parties, sale.partyId),
      amount: sale.totalAmount,
    }))
  );

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

      <div className="card">
        <h3>Sales by Month</h3>
        <BarChart rows={monthlySales} emptyText="No sales data for monthly chart." />
      </div>

      <div className="card">
        <h3>Sales by Major Party</h3>
        <PieChart slices={salesByParty} emptyText="No party sales data yet." />
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

function BarChart({
  emptyText,
  rows,
}: {
  emptyText: string;
  rows: { label: string; amount: number }[];
}) {
  const maxAmount = Math.max(...rows.map((row) => row.amount), 0);

  if (!rows.length || maxAmount <= 0) {
    return <p className="muted">{emptyText}</p>;
  }

  return (
    <div className="vertical-bar-chart">
      {rows.map((row) => (
        <div key={row.label} className="vertical-bar-item">
          <div className="vertical-bar-value">{formatMoney(row.amount)}</div>
          <div className="vertical-bar-track">
            <div className="vertical-bar-fill" style={{ height: `${Math.max(4, (row.amount / maxAmount) * 100)}%` }} />
          </div>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function PieChart({
  emptyText,
  slices,
}: {
  emptyText: string;
  slices: { name: string; amount: number; color: string }[];
}) {
  const [activeSliceName, setActiveSliceName] = useState(slices[0]?.name ?? "");
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);

  if (!slices.length || total <= 0) {
    return <p className="muted">{emptyText}</p>;
  }

  const activeSlice =
    slices.find((slice) => slice.name === activeSliceName) ?? slices[0];
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="pie-layout">
      <svg
        className="pie-chart"
        viewBox="0 0 100 100"
        role="img"
        aria-label="Sales by major party"
        onMouseLeave={() => setActiveSliceName(slices[0]?.name ?? "")}
      >
        <circle className="pie-chart-base" cx="50" cy="50" r={radius} />
        {slices.map((slice) => {
          const length = (slice.amount / total) * circumference;
          const dashOffset = -offset;
          offset += length;

          return (
            <circle
              key={slice.name}
              className={slice.name === activeSlice.name ? "pie-chart-segment active" : "pie-chart-segment"}
              cx="50"
              cy="50"
              r={radius}
              stroke={slice.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
              onMouseEnter={() => setActiveSliceName(slice.name)}
            />
          );
        })}
        <text x="50" y="48" textAnchor="middle" className="pie-total-label">
          Total
        </text>
        <text x="50" y="60" textAnchor="middle" className="pie-total-value">
          {formatCompact(total)}
        </text>
      </svg>
      <div className="pie-legend">
        {slices.map((slice) => (
          <button
            key={slice.name}
            type="button"
            className={slice.name === activeSlice.name ? "pie-legend-row active" : "pie-legend-row"}
            onMouseEnter={() => setActiveSliceName(slice.name)}
            onFocus={() => setActiveSliceName(slice.name)}
          >
            <span style={{ background: slice.color }} />
            <strong>{slice.name}</strong>
            <em>{formatMoney(slice.amount)}</em>
          </button>
        ))}
        <div className="pie-detail">
          <strong>{activeSlice.name}</strong>
          <span>{formatMoney(activeSlice.amount)}</span>
          <em>{((activeSlice.amount / total) * 100).toFixed(1)}% of total</em>
        </div>
      </div>
    </div>
  );
}

function formatMoney(value: number) {
  return `NPR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompact(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
    notation: "compact",
  });
}

function partyName(parties: Party[], partyId: string) {
  return parties.find((party) => party.id === partyId)?.name || "Unknown party";
}

function makeMonthlyRows(items: { date: string; amount: number }[]) {
  const buckets = new Map<string, { label: string; amount: number }>();

  for (const item of items) {
    const month = monthBucket(item.date);

    if (!month) {
      continue;
    }

    const existing = buckets.get(month.key);
    buckets.set(month.key, {
      label: month.label,
      amount: (existing?.amount ?? 0) + item.amount,
    });
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([, row]) => row);
}

function monthBucket(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{4})[/-](\d{1,2})/);

  if (!match) {
    return null;
  }

  const year = match[1];
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${bsMonthName(month)} ${year}`,
  };
}

function bsMonthName(month: number) {
  const names = [
    "Baisakh",
    "Jestha",
    "Ashadh",
    "Shrawan",
    "Bhadra",
    "Ashwin",
    "Kartik",
    "Mangsir",
    "Poush",
    "Magh",
    "Falgun",
    "Chaitra",
  ];

  return names[month - 1] ?? "";
}

function makePartySlices(items: { name: string; amount: number }[]) {
  const colors = ["#245477", "#16a34a", "#f97316", "#7c3aed", "#0891b2", "#64748b"];
  const buckets = new Map<string, number>();

  for (const item of items) {
    if (item.amount <= 0) {
      continue;
    }

    buckets.set(item.name, (buckets.get(item.name) ?? 0) + item.amount);
  }

  const sorted = Array.from(buckets.entries()).sort((left, right) => right[1] - left[1]);
  const top = sorted.slice(0, 5);
  const otherAmount = sorted.slice(5).reduce((sum, [, amount]) => sum + amount, 0);
  const rows = otherAmount > 0 ? [...top, ["Other", otherAmount] as [string, number]] : top;

  return rows.map(([name, amount], index) => ({
    name,
    amount,
    color: colors[index % colors.length],
  }));
}

import { useEffect, useState } from "react";
import type { CreditNote, Party, Sale } from "../data/types";
import { getCreditNotes, getParties, getSales } from "../data/storage";

const months = [
  "Baishak",
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

type PartyMonthRow = {
  partyId: string;
  partyName: string;
  salesAmount: number;
  vatAmount: number;
  totalAmount: number;
  adjustmentAmount: number;
  vatAdjustment: number;
  netVatPayable: number;
};

export default function OutputVatReport() {
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [month, setMonth] = useState("1");

  useEffect(() => {
    async function load() {
      setParties(await getParties());
      setSales(await getSales());
      setCreditNotes(await getCreditNotes());
    }

    load();
  }, []);

  const selectedMonth = Number(month);
  const rows = buildMonthRows(parties, sales, creditNotes, selectedMonth);
  const totalSales = rows.reduce((sum, row) => sum + row.salesAmount, 0);
  const totalVat = rows.reduce((sum, row) => sum + row.vatAmount, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const totalAdjustments = rows.reduce((sum, row) => sum + row.adjustmentAmount, 0);
  const totalVatAdjustment = rows.reduce((sum, row) => sum + row.vatAdjustment, 0);
  const netVatPayable = totalVat - totalVatAdjustment;

  return (
    <>
      <h1>Output VAT</h1>

      <div className="card">
        <div className="card-header report-header">
          <div>
            <h3>Output VAT Report</h3>
            <p className="muted">Select Nepali month from 1 Baishak to 12 Chaitra.</p>
          </div>

          <label className="month-selector">
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {index + 1}. {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="metric-grid">
          <div className="metric-card green">
            <span>Sales</span>
            <strong>{formatMoney(totalSales)}</strong>
          </div>
          <div className="metric-card purple">
            <span>Sales VAT</span>
            <strong>{formatMoney(totalVat)}</strong>
          </div>
          <div className="metric-card teal">
            <span>VAT Adjustment</span>
            <strong>{formatMoney(totalVatAdjustment)}</strong>
          </div>
          <div className="metric-card orange">
            <span>VAT Payable</span>
            <strong>{formatMoney(netVatPayable)}</strong>
          </div>
          <div className="metric-card blue">
            <span>Sales Total</span>
            <strong>{formatMoney(totalAmount)}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Party Name</th>
                <th>Sales</th>
                <th>VAT</th>
                <th>Adjustment</th>
                <th>VAT Adjustment</th>
                <th>VAT Payable</th>
                <th>Sales Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.partyId}>
                  <td>{row.partyName}</td>
                  <td>{formatMoney(row.salesAmount)}</td>
                  <td>{formatMoney(row.vatAmount)}</td>
                  <td>{formatMoney(row.adjustmentAmount)}</td>
                  <td>{formatMoney(row.vatAdjustment)}</td>
                  <td>{formatMoney(row.netVatPayable)}</td>
                  <td>
                    <strong>{formatMoney(row.totalAmount)}</strong>
                  </td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>
                    No sales or adjustments found for {months[selectedMonth - 1]}.
                  </td>
                </tr>
              )}

              {rows.length > 0 && (
                <tr className="total-row">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(totalSales)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(totalVat)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(totalAdjustments)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(totalVatAdjustment)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(netVatPayable)}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(totalAmount)}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function buildMonthRows(
  parties: Party[],
  sales: Sale[],
  creditNotes: CreditNote[],
  month: number
) {
  const rows = new Map<string, PartyMonthRow>();

  for (const sale of sales) {
    if (dateMonth(sale.dateBs) !== month) {
      continue;
    }

    const party = parties.find((item) => item.id === sale.partyId);
    const existing = rows.get(sale.partyId) ?? {
      partyId: sale.partyId,
      partyName: party?.name || "Unknown",
      salesAmount: 0,
      vatAmount: 0,
      totalAmount: 0,
      adjustmentAmount: 0,
      vatAdjustment: 0,
      netVatPayable: 0,
    };

    existing.salesAmount += sale.salesAmount;
    existing.vatAmount += sale.vatAmount;
    existing.totalAmount += sale.totalAmount;
    existing.netVatPayable = existing.vatAmount - existing.vatAdjustment;
    rows.set(sale.partyId, existing);
  }

  for (const creditNote of creditNotes) {
    if (dateMonth(creditNote.dateBs) !== month) {
      continue;
    }

    const party = parties.find((item) => item.id === creditNote.partyId);
    const existing = rows.get(creditNote.partyId) ?? {
      partyId: creditNote.partyId,
      partyName: party?.name || "Unknown",
      salesAmount: 0,
      vatAmount: 0,
      totalAmount: 0,
      adjustmentAmount: 0,
      vatAdjustment: 0,
      netVatPayable: 0,
    };

    existing.adjustmentAmount += creditNote.totalAmount;
    existing.vatAdjustment += creditNote.vatAmount;
    existing.netVatPayable = existing.vatAmount - existing.vatAdjustment;
    rows.set(creditNote.partyId, existing);
  }

  return Array.from(rows.values()).sort((a, b) =>
    a.partyName.localeCompare(b.partyName)
  );
}

function dateMonth(value: string) {
  const parts = value.trim().split(/[/-]/);

  if (parts.length < 2) {
    return 0;
  }

  return Number(parts[1]);
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

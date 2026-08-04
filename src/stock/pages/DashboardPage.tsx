import { useMemo } from "react";
import MetricCard from "../components/MetricCard";
import PendingDocuments from "../components/PendingDocuments";
import StockTable from "../components/StockTable";
import { formatRate, money, qty } from "../services/stockCalculations";
import type {
  StockDashboardTotals,
  StockDocumentStatus,
  StockRow,
} from "../types";

type DashboardPageProps = {
  dashboardTotals: StockDashboardTotals;
  itemCount: number;
  negativeRows: StockRow[];
  onOpenDocument: (row: StockDocumentStatus) => void;
  statuses: StockDocumentStatus[];
};

export default function DashboardPage({
  dashboardTotals,
  itemCount,
  negativeRows,
  onOpenDocument,
  statuses,
}: DashboardPageProps) {
  const actionDocs = useMemo(
    () => statuses.filter((row) => row.status !== "Entered"),
    [statuses],
  );
  const negativeStockRows = useMemo(
    () => negativeRows.map((row) => [
      row.code,
      row.name,
      row.unit,
      <span className="stock-low">{qty(row.closingQty)}</span>,
      formatRate(row.averageRate, "NPR"),
      money(row.closingValue),
    ]),
    [negativeRows],
  );

  return (
    <div className="stock-stack stock-dashboard">
      <section className="stock-dashboard-kpis">
        <div className="stock-primary-kpis">
          <MetricCard className="stock-metric-primary" label="Closing Stock Value" value={money(dashboardTotals.closingValue)} />
          <MetricCard className="stock-metric-primary" label="Gross Profit" value={money(dashboardTotals.grossProfit)} />
          <MetricCard className="stock-metric-primary stock-metric-pending" label="Inventory Review" value={String(actionDocs.length)} />
        </div>
        <div className="stock-secondary-kpis">
          <MetricCard label="Stock Items" value={String(itemCount)} />
          <MetricCard className="stock-metric-warning" label="Negative Stock" value={String(negativeRows.length)} />
          <MetricCard label="Low Stock" value="-" />
        </div>
      </section>

      <section className="stock-panel stock-dashboard-pending">
        <h3>Inventory Review</h3>
        <PendingDocuments rows={actionDocs.slice(0, 20)} onEdit={onOpenDocument} />
      </section>

      <section className="stock-panel stock-dashboard-negative">
        <h3>Negative Stock</h3>
        <StockTable
          emptyText="No negative stock."
          headers={["Code", "Item", "Unit", "Closing Qty", "Weighted Avg Rate", "Closing Value"]}
          rows={negativeStockRows}
        />
      </section>
    </div>
  );
}

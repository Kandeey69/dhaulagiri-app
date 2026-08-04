import { useMemo } from "react";
import StockTable from "./StockTable";
import { formatCurrency, formatRate, money, qty } from "../services/stockCalculations";
import type { EntryCurrency, StockItem, StockLineInput } from "../types";

type AllocationTableProps = {
  currency: EntryCurrency;
  exchangeRate: number;
  items: StockItem[];
  lines: StockLineInput[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  readOnly?: boolean;
};

export default function AllocationTable({
  currency,
  exchangeRate,
  items,
  lines,
  onEdit,
  onRemove,
  readOnly = false,
}: AllocationTableProps) {
  const showNpr = currency !== "NPR";
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );
  const headers = useMemo(
    () => showNpr
      ? ["Item", "Unit", "Qty", `Rate ${currency}`, `Amount ${currency}`, "Amount NPR", "Actions"]
      : ["Item", "Unit", "Qty", "Rate NPR", "Amount NPR", "Actions"],
    [currency, showNpr],
  );
  const rows = useMemo(
    () => lines.map((line, index) => {
      const item = itemById.get(line.itemId);
      const rateInCurrency = line.entryRate ?? line.rate / exchangeRate;
      const amountNpr = line.amount ?? line.quantity * line.rate;
      const amountInCurrency = line.entryAmount ?? amountNpr / exchangeRate;
      const base = [
        item ? `${item.code} - ${item.name}` : "Unknown item",
        item?.unit ?? "-",
        qty(line.quantity),
        formatRate(rateInCurrency, currency),
        formatCurrency(amountInCurrency, currency),
      ];
      return [
        ...base,
        ...(showNpr ? [money(amountNpr)] : []),
        <div className="stock-row-actions">
          <button type="button" disabled={readOnly} onClick={() => onEdit(index)}>
            {readOnly ? "View only" : "Edit"}
          </button>
          <button type="button" className="danger" disabled={readOnly} onClick={() => onRemove(index)}>Remove line</button>
        </div>,
      ];
    }),
    [currency, exchangeRate, itemById, lines, onEdit, onRemove, readOnly, showNpr],
  );

  return (
    <StockTable
      headers={headers}
      rows={rows}
    />
  );
}

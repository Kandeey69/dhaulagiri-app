import { memo } from "react";
import { formatCurrency } from "../services/stockCalculations";
import { AMOUNT_MATCH_TOLERANCE } from "../services/stockValidation";
import type { EntryCurrency } from "../types";

type AllocationSummaryProps = {
  currency?: EntryCurrency;
  difference: number;
  grandTotal: number;
  total: number;
  vat: number;
};

function AllocationSummary({
  currency = "NPR",
  difference,
  grandTotal,
  total,
  vat,
}: AllocationSummaryProps) {
  return (
    <div className="stock-voucher-totals">
      <span>Total</span>
      <strong>{formatCurrency(total, currency)}</strong>
      <span>Add: VAT</span>
      <strong>{formatCurrency(vat, currency)}</strong>
      <span>Grand Total</span>
      <strong>{formatCurrency(grandTotal, currency)}</strong>
      <span>Difference</span>
      <strong className={Math.abs(difference) <= AMOUNT_MATCH_TOLERANCE ? "stock-balanced" : "stock-low"}>
        {formatCurrency(difference, currency)}
      </strong>
    </div>
  );
}

export default memo(AllocationSummary);

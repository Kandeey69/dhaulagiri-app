import { memo } from "react";
import type { StockDocumentStatus } from "../types";

type StatusBadgeProps = {
  isSelected?: boolean;
  status: StockDocumentStatus["status"];
};

function StatusBadge({ isSelected = false, status }: StatusBadgeProps) {
  return (
    <span className={`stock-badge stock-badge-${status.toLowerCase()}`}>
      {isSelected ? <strong>{status}</strong> : status}
    </span>
  );
}

export default memo(StatusBadge);

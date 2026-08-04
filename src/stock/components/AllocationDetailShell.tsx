import type { ReactNode } from "react";
import type { StockDocumentStatus } from "../types";

type AllocationDetailShellProps = {
  children: ReactNode;
  companyName: string;
  document?: StockDocumentStatus;
  fiscalYear: string;
  selectTitle: string;
  summary?: ReactNode;
};

export default function AllocationDetailShell({
  children,
  companyName,
  document,
  fiscalYear,
  selectTitle,
  summary,
}: AllocationDetailShellProps) {
  return (
    <section className="stock-allocation-detail stock-panel stock-voucher">
      <div className="stock-allocation-detail-header">
        <div>
          <p className="eyebrow">{companyName}</p>
          <h3>{document ? `Bill ${document.billNo}` : selectTitle}</h3>
          <p className="stock-muted">{fiscalYear}</p>
        </div>
        {document && (
          <div className={document.status === "Entered" ? "stock-bill-status entered" : "stock-bill-status pending"}>
            <span>{document.type}</span>
            <strong>{document.status}</strong>
          </div>
        )}
      </div>
      {children}
      {summary && <footer className="stock-allocation-summary-footer">{summary}</footer>}
    </section>
  );
}

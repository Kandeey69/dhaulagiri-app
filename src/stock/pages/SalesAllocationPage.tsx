import { useCallback, useMemo } from "react";
import AllocationDetailShell from "../components/AllocationDetailShell";
import AllocationDocumentList from "../components/AllocationDocumentList";
import AllocationEditor from "../components/AllocationEditor";
import AllocationRegister from "../components/AllocationRegister";
import AllocationSummary from "../components/AllocationSummary";
import ReadOnlyField from "../components/ReadOnlyField";
import { billTotal, docKey, money } from "../services/stockCalculations";
import { amountMatches } from "../services/stockValidation";
import type {
  StockCompanyInfo,
  StockDocumentStatus,
  StockItem,
  StockLineInput,
  StockRow,
} from "../types";

type SalesAllocationPageProps = {
  allocationMessage: string;
  companyInfo: StockCompanyInfo;
  currentRows: StockRow[];
  draftLines: StockLineInput[];
  editingLineIndex: number | null;
  items: StockItem[];
  lineItemId: string;
  lineQty: string;
  lineRate: string;
  liveLinesForEntry: (exchangeRate: number) => StockLineInput[];
  onAddLine: () => void;
  onCancelLineEdit: () => void;
  onEditDocument: (row: StockDocumentStatus) => void;
  onEditLine: (index: number, exchangeRate: number) => void;
  onLineItemIdChange: (value: string) => void;
  onLineQtyChange: (value: string) => void;
  onLineRateChange: (value: string) => void;
  onRemoveLine: (index: number) => void;
  onSaveLines: () => void;
  readOnly?: boolean;
  salesDocs: StockDocumentStatus[];
  saving?: boolean;
  selectedDoc?: StockDocumentStatus;
  selectedItem?: StockItem;
  selectedKey: string;
  setSelectedKey: (value: string) => void;
};

export default function SalesAllocationPage({
  allocationMessage,
  companyInfo,
  currentRows,
  draftLines,
  editingLineIndex,
  items,
  lineItemId,
  lineQty,
  lineRate,
  liveLinesForEntry,
  onAddLine,
  onCancelLineEdit,
  onEditDocument,
  onEditLine,
  onLineItemIdChange,
  onLineQtyChange,
  onLineRateChange,
  onRemoveLine,
  onSaveLines,
  readOnly = false,
  salesDocs,
  saving = false,
  selectedDoc,
  selectedItem,
  selectedKey,
  setSelectedKey,
}: SalesAllocationPageProps) {
  const salesDoc = useMemo(
    () => selectedDoc?.type === "Sale" ? selectedDoc : undefined,
    [selectedDoc],
  );
  const liveLines = useMemo(
    () => salesDoc ? liveLinesForEntry(1) : [],
    [liveLinesForEntry, salesDoc],
  );
  const liveLineTotal = useMemo(
    () => salesDoc ? billTotal(liveLines) : 0,
    [liveLines, salesDoc],
  );
  const savedLineTotal = useMemo(
    () => salesDoc ? billTotal(draftLines) : 0,
    [draftLines, salesDoc],
  );
  const billVatAmount = salesDoc?.vatAmount ?? 0;
  const billGrandTotal = salesDoc
    ? salesDoc.grandTotal ?? liveLineTotal + billVatAmount
    : 0;
  const difference = salesDoc ? salesDoc.amount - liveLineTotal : 0;
  const savedDifference = salesDoc ? salesDoc.amount - savedLineTotal : 0;
  const canSaveLines = Boolean(salesDoc && draftLines.length > 0 && amountMatches(savedLineTotal, salesDoc.amount));
  const saveBlockedReason = salesDoc
    ? draftLines.length === 0
      ? "Add bill line items before saving."
      : `Save unlocks when saved line total matches bill amount. Difference: ${money(savedDifference)}.`
    : "Select a bill before saving.";
  const availableQtyByItemId = useMemo(
    () => Object.fromEntries(currentRows.map((row) => [row.itemId, row.closingQty])),
    [currentRows],
  );
  const selectDocument = useCallback((doc: StockDocumentStatus) => {
    setSelectedKey(docKey(doc));
    onEditDocument(doc);
  }, [onEditDocument, setSelectedKey]);
  const selectDocumentByKey = useCallback((key: string) => {
    if (!key) {
      setSelectedKey("");
      return;
    }
    const doc = salesDocs.find((row) => docKey(row) === key);
    if (doc) setSelectedKey(docKey(doc));
  }, [salesDocs, setSelectedKey]);

  return (
    <div className="stock-stack">
      <div className="stock-allocation-layout">
        <AllocationDocumentList
          emptyText="Matching sales bills will appear here."
          eyebrow="Sales Allocation"
          onSelectDocument={selectDocument}
          placeholder="Bill, customer, date"
          rows={salesDocs}
          selectedKey={selectedKey}
          title="Pending Documents"
        />

        <AllocationDetailShell
          companyName={companyInfo.companyName}
          document={salesDoc}
          fiscalYear={companyInfo.fiscalYear}
          selectTitle="Select a sales bill"
          summary={salesDoc ? <AllocationSummary total={liveLineTotal} vat={billVatAmount} grandTotal={billGrandTotal} difference={difference} /> : undefined}
        >
          <div className="stock-voucher-meta stock-allocation-bill-meta">
            <label>
              Selected Bill
              <select
                value={salesDoc ? selectedKey : ""}
                onChange={(event) => selectDocumentByKey(event.target.value)}
              >
                <option value="">Select sales bill</option>
                {salesDocs.map((doc) => (
                  <option key={docKey(doc)} value={docKey(doc)}>
                    {doc.billNo} - {doc.partyName} ({doc.status})
                  </option>
                ))}
              </select>
            </label>
            <ReadOnlyField label="Customer" value={salesDoc?.partyName ?? "-"} />
            <ReadOnlyField label="Date" value={salesDoc?.date ?? "-"} />
            <ReadOnlyField label="Bill Amount" value={salesDoc ? money(salesDoc.amount) : "-"} />
            <ReadOnlyField label="Currency" value="NPR" />
            <ReadOnlyField label="Status" value={salesDoc?.status ?? "-"} />
          </div>

          <div className="stock-form-grid stock-allocation-total-strip">
            <ReadOnlyField label="Saved Line Total" value={salesDoc ? money(savedLineTotal) : "-"} />
            <ReadOnlyField label="Live Line Total" value={salesDoc ? money(liveLineTotal) : "-"} />
            <ReadOnlyField label="Difference" value={salesDoc ? money(difference) : "-"} />
          </div>

          {salesDoc ? (
            <AllocationEditor
              availableQtyByItemId={availableQtyByItemId}
              currency="NPR"
              editingLineIndex={editingLineIndex}
              exchangeRate={1}
              items={items}
              lineItemId={lineItemId}
              lineQty={lineQty}
              lineRate={lineRate}
              lines={draftLines}
              notice={allocationMessage}
              onAddLine={onAddLine}
              onCancelLineEdit={onCancelLineEdit}
              onEditLine={onEditLine}
              onLineItemIdChange={onLineItemIdChange}
              onLineQtyChange={onLineQtyChange}
              onLineRateChange={onLineRateChange}
              onRemoveLine={onRemoveLine}
              onSave={onSaveLines}
              canSave={canSaveLines}
              readOnly={readOnly}
              saveBlockedReason={saveBlockedReason}
              saving={saving}
              selectedItem={selectedItem}
              useSearchableItemInput
            />
          ) : (
            <p className="stock-muted">Choose a sales bill to enter stock lines.</p>
          )}
        </AllocationDetailShell>
      </div>
      <AllocationRegister
        counterpartyLabel="Customer"
        emptyText="No sales inventory lines have been entered yet."
        onEditDocument={selectDocument}
        rows={salesDocs}
        selectedKey={selectedKey}
        title="Sales Register"
      />
    </div>
  );
}

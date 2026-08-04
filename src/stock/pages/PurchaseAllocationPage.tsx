import { useCallback, useMemo } from "react";
import AllocationDetailShell from "../components/AllocationDetailShell";
import AllocationDocumentList from "../components/AllocationDocumentList";
import AllocationEditor from "../components/AllocationEditor";
import AllocationRegister from "../components/AllocationRegister";
import AllocationSummary from "../components/AllocationSummary";
import ReadOnlyField from "../components/ReadOnlyField";
import { billEntryTotal, billTotal, docKey, formatCurrency } from "../services/stockCalculations";
import { amountMatches } from "../services/stockValidation";
import type {
  EntryCurrency,
  PurchaseEntryType,
  StockCompanyInfo,
  StockDocumentStatus,
  StockItem,
  StockLineInput,
} from "../types";

type PurchaseAllocationPageProps = {
  allocationMessage: string;
  companyInfo: StockCompanyInfo;
  draftLines: StockLineInput[];
  editingLineIndex: number | null;
  exchangeRate: number;
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
  onPurchaseEntryCurrencyChange: (value: EntryCurrency) => void;
  onPurchaseEntryTypeChange: (value: PurchaseEntryType) => void;
  onRemoveLine: (index: number) => void;
  onSaveLines: () => void;
  purchaseDocs: StockDocumentStatus[];
  purchaseEntryCurrency: EntryCurrency;
  purchaseEntryType: PurchaseEntryType;
  readOnly?: boolean;
  saving?: boolean;
  selectedCurrencyOptions: EntryCurrency[];
  selectedDoc?: StockDocumentStatus;
  selectedItem?: StockItem;
  selectedKey: string;
  setDraftLines: (lines: StockLineInput[]) => void;
  setSelectedKey: (value: string) => void;
};

export default function PurchaseAllocationPage({
  allocationMessage,
  companyInfo,
  draftLines,
  editingLineIndex,
  exchangeRate,
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
  onPurchaseEntryCurrencyChange,
  onPurchaseEntryTypeChange,
  onRemoveLine,
  onSaveLines,
  purchaseDocs,
  purchaseEntryCurrency,
  purchaseEntryType,
  readOnly = false,
  saving = false,
  selectedCurrencyOptions,
  selectedDoc,
  selectedItem,
  selectedKey,
  setDraftLines,
  setSelectedKey,
}: PurchaseAllocationPageProps) {
  const purchaseDoc = useMemo(
    () => selectedDoc?.type === purchaseEntryType ? selectedDoc : undefined,
    [purchaseEntryType, selectedDoc],
  );
  const liveLines = useMemo(
    () => purchaseDoc ? liveLinesForEntry(exchangeRate) : [],
    [exchangeRate, liveLinesForEntry, purchaseDoc],
  );
  const liveLineTotalNpr = useMemo(
    () => purchaseDoc ? billTotal(liveLines) : 0,
    [liveLines, purchaseDoc],
  );
  const savedLineTotalNpr = useMemo(
    () => purchaseDoc ? billTotal(draftLines) : 0,
    [draftLines, purchaseDoc],
  );
  const liveLineTotalInCurrency = purchaseDoc
    ? purchaseEntryCurrency === "NPR" ? liveLineTotalNpr : billEntryTotal(liveLines)
    : 0;
  const savedLineTotalInCurrency = purchaseDoc
    ? purchaseEntryCurrency === "NPR" ? savedLineTotalNpr : billEntryTotal(draftLines)
    : 0;
  const targetTotal = purchaseDoc
    ? purchaseEntryCurrency === "NPR"
      ? purchaseDoc.amountNpr ?? purchaseDoc.amount
      : purchaseDoc.amount
    : 0;
  const billVatAmount = purchaseEntryCurrency === "NPR" ? purchaseDoc?.vatAmount ?? 0 : 0;
  const billGrandTotal = purchaseEntryCurrency === "NPR"
    ? purchaseDoc?.grandTotal ?? liveLineTotalInCurrency + billVatAmount
    : liveLineTotalInCurrency;
  const difference = targetTotal - liveLineTotalInCurrency;
  const savedDifference = targetTotal - savedLineTotalInCurrency;
  const canSaveLines = Boolean(purchaseDoc && draftLines.length > 0 && amountMatches(savedLineTotalInCurrency, targetTotal));
  const saveBlockedReason = purchaseDoc
    ? draftLines.length === 0
      ? "Add bill line items before saving."
      : `Save unlocks when saved line total matches bill amount. Difference: ${formatCurrency(savedDifference, purchaseEntryCurrency)}.`
    : "Select a bill before saving.";
  const selectDocument = useCallback((doc: StockDocumentStatus) => {
    setSelectedKey(docKey(doc));
    onEditDocument(doc);
  }, [onEditDocument, setSelectedKey]);
  const selectDocumentByKey = useCallback((key: string) => {
    if (!key) {
      setSelectedKey("");
      setDraftLines([]);
      return;
    }
    const doc = purchaseDocs.find((row) => docKey(row) === key);
    if (doc) setSelectedKey(docKey(doc));
  }, [purchaseDocs, setDraftLines, setSelectedKey]);
  const selectPurchaseEntryType = useCallback((type: PurchaseEntryType) => {
    onPurchaseEntryTypeChange(type);
    setSelectedKey("");
    setDraftLines([]);
  }, [onPurchaseEntryTypeChange, setDraftLines, setSelectedKey]);

  return (
    <div className="stock-stack">
      <div className="stock-allocation-layout">
        <AllocationDocumentList
          emptyText="Matching purchase bills will appear here."
          eyebrow="Purchase Allocation"
          onSelectDocument={selectDocument}
          placeholder="Bill, supplier, date"
          rows={purchaseDocs}
          selectedKey={selectedKey}
          title={`${purchaseEntryType} Pending`}
        />

        <AllocationDetailShell
          companyName={purchaseDoc?.partyName ?? "Supplier"}
          document={purchaseDoc}
          fiscalYear={companyInfo.fiscalYear}
          selectTitle="Select a purchase bill"
          summary={purchaseDoc ? (
            <AllocationSummary
              total={liveLineTotalInCurrency}
              vat={billVatAmount}
              grandTotal={billGrandTotal}
              difference={difference}
              currency={purchaseEntryCurrency}
            />
          ) : undefined}
        >
          <div className="stock-tabs">
            {(["Import Purchase", "Local Purchase"] as PurchaseEntryType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={purchaseEntryType === type ? "active" : ""}
                onClick={() => selectPurchaseEntryType(type)}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="stock-voucher-meta stock-allocation-bill-meta">
            <label>
              Selected Bill
              <select
                value={purchaseDoc ? selectedKey : ""}
                onChange={(event) => selectDocumentByKey(event.target.value)}
              >
                <option value="">Select purchase bill</option>
                {purchaseDocs.map((doc) => (
                  <option key={docKey(doc)} value={docKey(doc)}>
                    {doc.billNo} - {doc.partyName} ({doc.status})
                  </option>
                ))}
              </select>
            </label>
            <ReadOnlyField label="Supplier" value={purchaseDoc?.partyName ?? "-"} />
            <ReadOnlyField label="Date" value={purchaseDoc?.date ?? "-"} />
            <ReadOnlyField label="Bill Amount" value={purchaseDoc ? formatCurrency(targetTotal, purchaseEntryCurrency) : "-"} />
            <label>
              Currency
              <select
                value={purchaseEntryCurrency}
                disabled={readOnly || !purchaseDoc || selectedCurrencyOptions.length === 1}
                onChange={(event) => onPurchaseEntryCurrencyChange(event.target.value as EntryCurrency)}
              >
                {selectedCurrencyOptions.map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <ReadOnlyField label="Exchange Rate" value={purchaseDoc ? String(exchangeRate || 1) : "-"} />
          </div>

          <div className="stock-form-grid stock-allocation-total-strip">
            <ReadOnlyField label="Saved Line Total" value={purchaseDoc ? formatCurrency(savedLineTotalInCurrency, purchaseEntryCurrency) : "-"} />
            <ReadOnlyField label="Live Line Total" value={purchaseDoc ? formatCurrency(liveLineTotalInCurrency, purchaseEntryCurrency) : "-"} />
            <ReadOnlyField label="Difference" value={purchaseDoc ? formatCurrency(difference, purchaseEntryCurrency) : "-"} />
            <ReadOnlyField label="Status" value={purchaseDoc?.status ?? "-"} />
          </div>

          {purchaseDoc ? (
            <AllocationEditor
              currency={purchaseEntryCurrency}
              editingLineIndex={editingLineIndex}
              exchangeRate={exchangeRate}
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
            <p className="stock-muted">Choose a purchase bill to enter stock lines.</p>
          )}
        </AllocationDetailShell>
      </div>
      <AllocationRegister
        counterpartyLabel="Supplier"
        emptyText={`No ${purchaseEntryType.toLowerCase()} inventory lines have been entered yet.`}
        onEditDocument={selectDocument}
        rows={purchaseDocs}
        selectedKey={selectedKey}
        title={`${purchaseEntryType} Register`}
      />
    </div>
  );
}

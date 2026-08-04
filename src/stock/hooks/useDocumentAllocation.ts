import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  billTotal,
  billEntryTotal,
  defaultPurchaseCurrency,
  docKey,
  formatCurrency,
  linesForDoc,
  money,
  n,
  purchaseCurrencyOptions,
} from "../services/stockCalculations";
import { amountMatches, errorMessage } from "../services/stockValidation";
import {
  setStockPurchaseLinesForDocument,
  setStockSalesLinesForDocument,
} from "../storage";
import { scrollToPageTop } from "../../scroll";
import type {
  EntryCurrency,
  PurchaseEntryType,
  StockDocumentStatus,
  StockEntryTarget,
  StockLineInput,
  StockPurchaseBill,
  StockSalesBill,
  StockView,
} from "../types";

type UseDocumentAllocationInput = {
  getAvailableQuantity?: (itemId: string) => number;
  initialTarget?: StockEntryTarget | null;
  isReadOnly?: boolean;
  onTargetHandled?: () => void;
  purchaseBills: StockPurchaseBill[];
  refreshStock: (text?: string, showMessage?: boolean) => Promise<void>;
  salesBills: StockSalesBill[];
  setView: Dispatch<SetStateAction<StockView>>;
  statuses: StockDocumentStatus[];
};

export function useDocumentAllocation({
  getAvailableQuantity,
  initialTarget,
  isReadOnly = false,
  onTargetHandled,
  purchaseBills,
  refreshStock,
  salesBills,
  setView,
  statuses,
}: UseDocumentAllocationInput) {
  const [purchaseEntryType, setPurchaseEntryType] = useState<PurchaseEntryType>(
    initialTarget?.type === "Local Purchase" ? "Local Purchase" : "Import Purchase",
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [draftLines, setDraftLines] = useState<StockLineInput[]>([]);
  const [lineItemId, setLineItemId] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineRate, setLineRate] = useState("");
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [allocationMessage, setAllocationMessage] = useState("");
  const [purchaseEntryCurrency, setPurchaseEntryCurrency] = useState<EntryCurrency>("NPR");
  const [isSavingLines, setIsSavingLines] = useState(false);
  const isSavingLinesRef = useRef(false);

  const selectedDoc = useMemo(
    () => statuses.find((doc) => docKey(doc) === selectedKey),
    [selectedKey, statuses],
  );
  const salesDocs = useMemo(
    () => statuses.filter((row) => row.type === "Sale"),
    [statuses],
  );
  const purchaseDocs = useMemo(
    () => statuses.filter((row) => row.type === purchaseEntryType),
    [purchaseEntryType, statuses],
  );
  const selectedPurchaseCurrencyOptions = useMemo(
    () => purchaseCurrencyOptions(selectedDoc),
    [selectedDoc],
  );
  const selectedPurchaseExchangeRate = useMemo(
    () => purchaseEntryCurrency === "NPR" ? 1 : Number(selectedDoc?.exchangeRate || 0),
    [purchaseEntryCurrency, selectedDoc],
  );

  useEffect(() => {
    if (!initialTarget) return;
    setSelectedKey(docKey(initialTarget));
    setAllocationMessage("");
    if (initialTarget.type === "Sale") {
      setView("Line Item Entry (For Sales)");
    } else {
      setPurchaseEntryType(initialTarget.type);
      setView("Line Item Entry (For Purchase)");
    }
    onTargetHandled?.();
  }, [initialTarget, onTargetHandled, setView]);

  useEffect(() => {
    if (!selectedDoc) {
      setDraftLines([]);
      setEditingLineIndex(null);
      return;
    }
    setDraftLines(linesForDoc(selectedDoc, purchaseBills, salesBills));
    setEditingLineIndex(null);
    setLineItemId("");
    setLineQty("");
    setLineRate("");
    setAllocationMessage("");
    if (selectedDoc.type !== "Sale") {
      setPurchaseEntryCurrency(defaultPurchaseCurrency(selectedDoc));
    }
  }, [purchaseBills, salesBills, selectedDoc]);

  const openDoc = useCallback((doc: StockDocumentStatus) => {
    setSelectedKey(docKey(doc));
    setAllocationMessage("");
    setView(doc.type === "Sale" ? "Line Item Entry (For Sales)" : "Line Item Entry (For Purchase)");
    if (doc.type !== "Sale") {
      setPurchaseEntryType(doc.type);
      setPurchaseEntryCurrency(defaultPurchaseCurrency(doc));
    }
    scrollToPageTop("smooth");
  }, [setView]);

  const addLine = useCallback(() => {
    if (isReadOnly) {
      setAllocationMessage("This fiscal year is read-only. Inventory lines can be viewed but not changed.");
      return;
    }
    const quantity = n(lineQty);
    const enteredRate = n(lineRate);
    if (!selectedDoc) {
      setAllocationMessage("Select a bill first.");
      return;
    }
    if (!lineItemId) {
      setAllocationMessage("Select a stock item first.");
      return;
    }
    if (quantity <= 0) {
      setAllocationMessage("Quantity must be greater than zero.");
      return;
    }
    if (enteredRate < 0) {
      setAllocationMessage("Rate exclusive of VAT must not be negative.");
      return;
    }
    if (selectedDoc.type !== "Sale" && purchaseEntryCurrency !== "NPR" && selectedPurchaseExchangeRate <= 0) {
      setAllocationMessage("Exchange rate must be greater than zero for foreign currency purchase entry.");
      return;
    }
    if (selectedDoc.type === "Sale" && getAvailableQuantity) {
      const existingQty = draftLines.reduce((sum, line, index) => {
        if (index === editingLineIndex || line.itemId !== lineItemId) return sum;
        return sum + line.quantity;
      }, 0);
      const projectedQty = existingQty + quantity;
      const availableQty = getAvailableQuantity(lineItemId);
      if (
        projectedQty > availableQty &&
        !window.confirm(
          `This allocation will make stock negative for the selected item. Available: ${availableQty}. Sale quantity: ${projectedQty}. Continue?`,
        )
      ) {
        return;
      }
    }
    const rate = selectedDoc.type === "Sale"
      ? enteredRate
      : Number((enteredRate * selectedPurchaseExchangeRate).toFixed(6));
    const entryAmount = Number((quantity * enteredRate).toFixed(2));
    setDraftLines((current) => {
      const line = selectedDoc.type === "Sale"
        ? { itemId: lineItemId, quantity, rate }
        : {
          amount: Number((quantity * rate).toFixed(2)),
          entryAmount,
          entryRate: enteredRate,
          itemId: lineItemId,
          quantity,
          rate,
        };
      if (editingLineIndex === null) return [...current, line];
      return current.map((currentLine, index) => index === editingLineIndex ? line : currentLine);
    });
    setEditingLineIndex(null);
    setLineItemId("");
    setLineQty("");
    setLineRate("");
    setAllocationMessage("Line item added. Save line items to post it to stock.");
  }, [
    draftLines,
    editingLineIndex,
    getAvailableQuantity,
    lineItemId,
    lineQty,
    lineRate,
    purchaseEntryCurrency,
    selectedDoc,
    selectedPurchaseExchangeRate,
    isReadOnly,
  ]);

  const editDraftLine = useCallback((index: number, exchangeRate: number) => {
    if (isReadOnly) {
      setAllocationMessage("This fiscal year is read-only. Inventory lines can be viewed but not changed.");
      return;
    }
    const line = draftLines[index];
    if (!line) return;
    setEditingLineIndex(index);
    setLineItemId(line.itemId);
    setLineQty(String(line.quantity));
    setLineRate(String(selectedDoc?.type === "Sale"
      ? line.rate
      : line.entryRate ?? Number((line.rate / exchangeRate).toFixed(6))));
    setAllocationMessage("Editing selected line item.");
  }, [draftLines, isReadOnly, selectedDoc]);

  const cancelDraftLineEdit = useCallback(() => {
    setEditingLineIndex(null);
    setLineItemId("");
    setLineQty("");
    setLineRate("");
    setAllocationMessage("");
  }, []);

  const removeDraftLine = useCallback((indexToRemove: number) => {
    if (isReadOnly) {
      setAllocationMessage("This fiscal year is read-only. Inventory lines can be viewed but not changed.");
      return;
    }
    setDraftLines((current) => current.filter((_, index) => index !== indexToRemove));
    if (editingLineIndex === indexToRemove) {
      cancelDraftLineEdit();
    } else if (editingLineIndex !== null && editingLineIndex > indexToRemove) {
      setEditingLineIndex(editingLineIndex - 1);
    }
  }, [cancelDraftLineEdit, editingLineIndex, isReadOnly]);

  const liveLinesForEntry = useCallback((exchangeRate: number) => {
    const quantity = n(lineQty);
    const enteredRate = n(lineRate);
    if (!lineItemId || quantity <= 0 || enteredRate < 0) return draftLines;
    const rate = selectedDoc?.type === "Sale"
      ? enteredRate
      : Number((enteredRate * exchangeRate).toFixed(6));
    const nextLine = selectedDoc?.type === "Sale"
      ? { itemId: lineItemId, quantity, rate }
      : {
        amount: Number((quantity * rate).toFixed(2)),
        entryAmount: Number((quantity * enteredRate).toFixed(2)),
        entryRate: enteredRate,
        itemId: lineItemId,
        quantity,
        rate,
      };
    if (editingLineIndex === null) return [...draftLines, nextLine];
    return draftLines.map((line, index) => index === editingLineIndex ? nextLine : line);
  }, [draftLines, editingLineIndex, lineItemId, lineQty, lineRate, selectedDoc]);

  const moveDocument = useCallback((rows: StockDocumentStatus[], direction: -1 | 1) => {
    if (!rows.length) return;
    const currentIndex = selectedDoc ? rows.findIndex((row) => docKey(row) === docKey(selectedDoc)) : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, currentIndex + direction));
    openDoc(rows[nextIndex]);
  }, [openDoc, selectedDoc]);

  const saveSalesLines = useCallback(async () => {
    if (isSavingLinesRef.current) {
      setAllocationMessage("Line items are already being saved. Please wait.");
      return;
    }
    if (isReadOnly) {
      setAllocationMessage("This fiscal year is read-only. Inventory lines can be viewed but not changed.");
      return;
    }
    if (!selectedDoc || selectedDoc.type !== "Sale") {
      setAllocationMessage("Select a sales bill first.");
      return;
    }
    if (!draftLines.length) {
      setAllocationMessage("Add at least one sales line item.");
      return;
    }
    const lineTotal = billTotal(draftLines);
    if (!amountMatches(lineTotal, selectedDoc.amount)) {
      setAllocationMessage(
        `Sales line total ${money(lineTotal)} must match sales amount without VAT ${money(selectedDoc.amount)}.`,
      );
      return;
    }
    if (!window.confirm(`Save sales line items for bill ${selectedDoc.billNo}?`)) return;
    const nextPendingDoc = salesDocs.find((doc) => doc.status === "Pending" && docKey(doc) !== docKey(selectedDoc));
    isSavingLinesRef.current = true;
    setIsSavingLines(true);
    setAllocationMessage("Saving sales line items...");
    try {
      await setStockSalesLinesForDocument({
        billNo: selectedDoc.billNo,
        date: selectedDoc.date,
        documentId: selectedDoc.documentId,
        items: draftLines,
        partyName: selectedDoc.partyName,
        remarks: selectedDoc.remarks ?? "",
        sourceSnapshot: {
          sourceAmount: selectedDoc.amount,
          sourceAmountNpr: selectedDoc.amountNpr,
          sourceCurrency: selectedDoc.amountCurrency,
          sourceExchangeRate: selectedDoc.exchangeRate,
          sourceFiscalYearId: selectedDoc.fiscalYearId,
          sourceGrandTotal: selectedDoc.grandTotal,
          sourceLandedCostNpr: selectedDoc.landedCostNpr,
          sourceLifecycleStatus: selectedDoc.lifecycleStatus,
        },
      });
      await refreshStock("", false);
      const savedMessage = `Sales line items saved for bill ${selectedDoc.billNo}.`;
      if (nextPendingDoc) {
        openDoc(nextPendingDoc);
      }
      setAllocationMessage(savedMessage);
    } catch (error) {
      setAllocationMessage(errorMessage(error, "Failed to save sales line items."));
    } finally {
      isSavingLinesRef.current = false;
      setIsSavingLines(false);
    }
  }, [draftLines, isReadOnly, openDoc, refreshStock, salesDocs, selectedDoc]);

  const savePurchaseLines = useCallback(async () => {
    if (isSavingLinesRef.current) {
      setAllocationMessage("Line items are already being saved. Please wait.");
      return;
    }
    if (isReadOnly) {
      setAllocationMessage("This fiscal year is read-only. Inventory lines can be viewed but not changed.");
      return;
    }
    if (!selectedDoc || selectedDoc.type === "Sale") {
      setAllocationMessage("Select a purchase bill first.");
      return;
    }
    if (!draftLines.length) {
      setAllocationMessage("Add at least one purchase line item.");
      return;
    }
    if (purchaseEntryCurrency !== "NPR" && selectedPurchaseExchangeRate <= 0) {
      setAllocationMessage("Exchange rate must be greater than zero for foreign currency purchase entry.");
      return;
    }
    const lineTotalNpr = billTotal(draftLines);
    const lineTotalInEntryCurrency = purchaseEntryCurrency === "NPR"
      ? lineTotalNpr
      : billEntryTotal(draftLines);
    const targetTotal = purchaseEntryCurrency === "NPR"
      ? selectedDoc.amountNpr ?? selectedDoc.amount
      : selectedDoc.amount;

    if (!amountMatches(lineTotalInEntryCurrency, targetTotal)) {
      setAllocationMessage(
        `Purchase line total ${formatCurrency(lineTotalInEntryCurrency, purchaseEntryCurrency)} must match bill amount ${formatCurrency(targetTotal, purchaseEntryCurrency)}.`,
      );
      return;
    }
    if (!window.confirm(`Save purchase line items for bill ${selectedDoc.billNo}?`)) return;
    const nextPendingDoc = purchaseDocs.find((doc) => doc.status === "Pending" && docKey(doc) !== docKey(selectedDoc));
    isSavingLinesRef.current = true;
    setIsSavingLines(true);
    setAllocationMessage("Saving purchase line items...");
    try {
      await setStockPurchaseLinesForDocument({
        billNo: selectedDoc.billNo,
        date: selectedDoc.date,
        documentId: selectedDoc.documentId,
        items: draftLines,
        landedCostNpr: selectedDoc.landedCostNpr,
        partyName: selectedDoc.partyName,
        referenceNo: selectedDoc.referenceNo ?? "",
        remarks: selectedDoc.remarks ?? "",
        source: selectedDoc.source ?? "Local Purchase",
        sourceDocumentType: selectedDoc.type,
        sourceSnapshot: {
          sourceAmount: selectedDoc.amount,
          sourceAmountNpr: selectedDoc.amountNpr,
          sourceCurrency: selectedDoc.amountCurrency,
          sourceExchangeRate: selectedDoc.exchangeRate,
          sourceFiscalYearId: selectedDoc.fiscalYearId,
          sourceGrandTotal: selectedDoc.grandTotal,
          sourceLandedCostNpr: selectedDoc.landedCostNpr,
          sourceLifecycleStatus: selectedDoc.lifecycleStatus,
        },
      });
      await refreshStock("", false);
      const savedMessage = `Purchase line items saved for bill ${selectedDoc.billNo}.`;
      if (nextPendingDoc) {
        openDoc(nextPendingDoc);
      }
      setAllocationMessage(savedMessage);
    } catch (error) {
      setAllocationMessage(errorMessage(error, "Failed to save purchase line items."));
    } finally {
      isSavingLinesRef.current = false;
      setIsSavingLines(false);
    }
  }, [
    draftLines,
    openDoc,
    purchaseDocs,
    purchaseEntryCurrency,
    refreshStock,
    selectedDoc,
    selectedPurchaseExchangeRate,
    isReadOnly,
  ]);

  return {
    addLine,
    allocationMessage,
    cancelDraftLineEdit,
    draftLines,
    editingLineIndex,
    editDraftLine,
    lineItemId,
    lineQty,
    lineRate,
    liveLinesForEntry,
    moveDocument,
    openDoc,
    isSavingLines,
    purchaseDocs,
    purchaseEntryCurrency,
    purchaseEntryType,
    removeDraftLine,
    salesDocs,
    selectedDoc,
    selectedKey,
    selectedPurchaseCurrencyOptions,
    selectedPurchaseExchangeRate,
    savePurchaseLines,
    saveSalesLines,
    setDraftLines,
    setLineItemId,
    setLineQty,
    setLineRate,
    setPurchaseEntryCurrency,
    setPurchaseEntryType,
    setSelectedKey,
  };
}

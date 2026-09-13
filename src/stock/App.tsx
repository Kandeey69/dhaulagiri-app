import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./pages/DashboardPage";
import ImportPage from "./pages/ImportPage";
import ItemMasterPage from "./pages/ItemMasterPage";
import PurchaseAllocationPage from "./pages/PurchaseAllocationPage";
import SalesAllocationPage from "./pages/SalesAllocationPage";
import StockRegisterPage from "./pages/StockRegisterPage";
import {
  deleteStockItem,
  saveStockItem,
  updateStockItem,
  upsertOpeningStockItem,
} from "./storage";
import { useStockData } from "./hooks/useStockData";
import { useStockDerivedData } from "./hooks/useStockDerivedData";
import { docKey, readStockCompanyInfo } from "./services/stockCalculations";
import { errorMessage, parseOpeningRows } from "./services/stockValidation";
import { scrollToPageTop } from "../scroll";
import type {
  StockAppProps,
  StockDocumentReference,
  StockItem,
  StockItemForm,
  StockView,
} from "./types";
import { useDocumentAllocation } from "./hooks/useDocumentAllocation";
import { confirmAction, notifyError, notifyToast } from "../components/notificationService";

const emptyItem: StockItemForm = {
  id: "",
  code: "",
  name: "",
  unit: "MT",
  openingQty: 0,
  openingRate: 0,
  reorderLevel: 0,
  isActive: true,
};

const views: StockView[] = [
  "Dashboard",
  "Line Item Entry (For Sales)",
  "Line Item Entry (For Purchase)",
  "Stock Register",
  "Item Master",
  "Data Importation",
];

const accountViews: StockView[] = [
  "Dashboard",
  "Line Item Entry (For Sales)",
  "Line Item Entry (For Purchase)",
  "Stock Register",
];

function sourceDocFromTarget(target?: StockAppProps["initialTarget"]): StockDocumentReference | null {
  if (!target?.documentId) {
    return null;
  }

  return {
    amount: target.amount ?? target.amountNpr ?? 0,
    amountCurrency: target.amountCurrency ?? "NPR",
    amountNpr: target.amountNpr ?? target.amount ?? 0,
    billNo: target.billNo ?? "",
    calculatedAt: target.calculatedAt,
    calculationVersion: target.calculationVersion,
    companyId: target.companyId,
    date: target.date ?? "",
    documentId: target.documentId,
    exchangeRate: target.exchangeRate ?? 1,
    fiscalYearId: target.fiscalYearId,
    grandTotal: target.grandTotal,
    landedCostNpr: target.landedCostNpr,
    lifecycleStatus: target.lifecycleStatus,
    partyName: target.partyName ?? "Unknown",
    referenceNo: target.referenceNo,
    remarks: target.remarks ?? "",
    source: target.source ?? (target.type === "Import Purchase" ? "Importation" : target.type === "Local Purchase" ? "Local Purchase" : undefined),
    type: target.type,
    vatAmount: target.vatAmount,
  };
}

export default function StockApp({
  activeCompanyId = "",
  activeFiscalYearId = "",
  companyInfo: providedCompanyInfo,
  initialUserRole = "Account",
  initialTarget,
  isReadOnly = false,
  onBackToModules,
  onLogout,
  onTargetHandled,
}: StockAppProps) {
  const initialView: StockView = initialTarget?.type === "Sale"
    ? "Line Item Entry (For Sales)"
    : initialTarget
      ? "Line Item Entry (For Purchase)"
      : "Dashboard";
  const [view, setView] = useState<StockView>(initialView);
  const [handoffSourceDoc, setHandoffSourceDoc] = useState<StockDocumentReference | null>(() =>
    sourceDocFromTarget(initialTarget),
  );
  const availableViews = useMemo(
    () => initialUserRole === "Master" ? views : accountViews,
    [initialUserRole],
  );
  const {
    isLoading,
    hasLoaded,
    items,
    purchaseBills,
    refreshStock,
    salesBills,
    sourceDocs,
  } = useStockData({ activeCompanyId, activeFiscalYearId });
  const [itemForm, setItemForm] = useState<StockItemForm>(emptyItem);
  const [itemFieldErrors, setItemFieldErrors] = useState<Record<string, string>>({});
  const [itemHasOpeningFigure, setItemHasOpeningFigure] = useState(false);
  const [openingFile, setOpeningFile] = useState<File | null>(null);
  const [openingFileError, setOpeningFileError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("easysolution:stock-sidebar-collapsed") === "yes",
  );

  useEffect(() => {
    scrollToPageTop();
  }, [view]);

  useEffect(() => {
    localStorage.setItem("easysolution:stock-sidebar-collapsed", sidebarCollapsed ? "yes" : "no");
  }, [sidebarCollapsed]);

  useEffect(() => {
    const nextDoc = sourceDocFromTarget(initialTarget);
    if (nextDoc) {
      setHandoffSourceDoc(nextDoc);
    }
  }, [initialTarget]);

  useEffect(() => {
    if (!availableViews.includes(view)) {
      setView("Dashboard");
    }
  }, [availableViews, view]);

  const navigateToView = useCallback((nextView: StockView) => {
    setView(nextView);
    scrollToPageTop();
  }, []);

  const canManage = initialUserRole === "Master" && !isReadOnly;
  const effectiveSourceDocs = useMemo(() => {
    if (!handoffSourceDoc) {
      return sourceDocs;
    }
    return sourceDocs.some((doc) => docKey(doc) === docKey(handoffSourceDoc))
      ? sourceDocs
      : [handoffSourceDoc, ...sourceDocs];
  }, [handoffSourceDoc, sourceDocs]);
  const {
    currentRows,
    dashboardTotals,
    negativeRows,
    stockRegisterRows,
    statuses,
  } = useStockDerivedData({
    items,
    purchaseBills,
    salesBills,
    sourceDocs: effectiveSourceDocs,
  });
  const availableQtyByItemId = useMemo(
    () => new Map(currentRows.map((row) => [row.itemId, row.closingQty] as const)),
    [currentRows],
  );
  const getAvailableQuantity = useCallback(
    (itemId: string) => availableQtyByItemId.get(itemId) ?? 0,
    [availableQtyByItemId],
  );
  const {
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
    isSavingLines,
    openDoc,
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
  } = useDocumentAllocation({
    getAvailableQuantity,
    initialTarget,
    isReadOnly: isReadOnly || Boolean(initialTarget?.readOnly),
    onTargetHandled,
    purchaseBills,
    refreshStock,
    salesBills,
    setView,
    statuses,
  });
  const selectedItem = useMemo(
    () => items.find((item) => item.id === lineItemId),
    [items, lineItemId],
  );
  const companyInfo = useMemo(
    () => providedCompanyInfo ?? readStockCompanyInfo(),
    [providedCompanyInfo],
  );
  const refreshStockNow = useCallback(() => {
    void refreshStock();
  }, [refreshStock]);
  const resetItemForm = useCallback(() => {
    setItemForm(emptyItem);
    setItemFieldErrors({});
    setItemHasOpeningFigure(false);
  }, []);

  const saveItem = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReadOnly) {
      notifyError("Closed fiscal year: stock items cannot be changed.", "Read-only fiscal year");
      return;
    }
    const nextItemErrors: Record<string, string> = {};
    if (!itemForm.code.trim()) nextItemErrors.code = "Item code is required.";
    if (!itemForm.name.trim()) nextItemErrors.name = "Item name is required.";
    if (Object.keys(nextItemErrors).length) {
      setItemFieldErrors(nextItemErrors);
      const firstField = nextItemErrors.code ? "stockItemCode" : "stockItemName";
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus());
      return;
    }
    const actionText = itemForm.id ? "update" : "save";
    if (!await confirmAction({
      title: itemForm.id ? "Update stock item?" : "Create stock item?",
      message: `Do you want to ${actionText} this stock item?`,
      confirmLabel: itemForm.id ? "Update item" : "Create item",
    })) return;
    const input = {
      ...itemForm,
      openingQty: itemHasOpeningFigure ? itemForm.openingQty : 0,
      openingRate: itemHasOpeningFigure ? itemForm.openingRate : 0,
    };
    try {
      if (itemForm.id) await updateStockItem(input);
      else await saveStockItem(input);
      resetItemForm();
      await refreshStock("", false);
      notifyToast("Stock item saved.");
    } catch (error) {
      notifyError(errorMessage(error, "Failed to save stock item."), "Stock item could not be saved");
    }
  }, [isReadOnly, itemForm, itemHasOpeningFigure, refreshStock, resetItemForm]);

  const removeItem = useCallback(async (item: StockItem) => {
    if (!canManage) {
      notifyError("Master access is required to delete stock items.", "Delete not allowed");
      return;
    }
    if (isReadOnly) {
      notifyError("Closed fiscal year: stock items cannot be changed.", "Read-only fiscal year");
      return;
    }
    if (!await confirmAction({
      title: "Delete stock item?",
      message: `Delete stock item ${item.name}? This cannot be undone.`,
      confirmLabel: "Delete item",
      destructive: true,
    })) return;
    try {
      await deleteStockItem(item.id);
      await refreshStock("", false);
      notifyToast("Stock item deleted.");
    } catch (error) {
      notifyError(errorMessage(error, "Failed to delete stock item."), "Stock item could not be deleted");
    }
  }, [canManage, isReadOnly, refreshStock]);

  const importOpening = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReadOnly) {
      notifyError("Closed fiscal year: opening stock cannot be imported.", "Read-only fiscal year");
      return;
    }
    if (!openingFile) {
      setOpeningFileError("Choose an opening stock CSV file first.");
      return;
    }
    const rows = parseOpeningRows(await openingFile.text());
    if (!rows.length) {
      setOpeningFileError("No opening stock rows were found in the CSV file.");
      return;
    }
    if (!await confirmAction({
      title: "Import opening stock?",
      message: `Import ${rows.length} opening stock item(s) from this CSV file?`,
      confirmLabel: "Import stock",
    })) return;
    try {
      for (const row of rows) await upsertOpeningStockItem(row);
      setOpeningFile(null);
      setOpeningFileError("");
      setFileInputKey((current) => current + 1);
      await refreshStock("", false);
      notifyToast(`Imported ${rows.length} opening stock item(s).`);
    } catch (error) {
      notifyError(errorMessage(error, "Failed to import opening stock."), "Opening stock could not be imported");
    }
  }, [isReadOnly, openingFile, refreshStock]);

  const downloadOpeningTemplate = useCallback(() => {
    const csv = [
      "code,name,unit,openingQty,openingRate,reorderLevel",
      "IRON-01,Iron Rod,MT,10,85000,2",
      "PIPE-01,GI Pipe,Number,25,950,5",
      "CEMENT-01,Cement,KG,500,18,100",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stock-opening-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const editItem = useCallback((item: StockItem) => {
    setItemForm({ ...item });
    setItemHasOpeningFigure(item.openingQty > 0 || item.openingRate > 0);
    scrollToPageTop("smooth");
  }, []);
  const showInitialLoading = isLoading && !hasLoaded;

  return (
    <div className={sidebarCollapsed ? "stock-shell stock-sidebar-collapsed" : "stock-shell"}>
      <Sidebar
        collapsed={sidebarCollapsed}
        companyName={companyInfo.companyName}
        onBackToModules={onBackToModules}
        onLogout={onLogout}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onViewChange={navigateToView}
        userRole={initialUserRole}
        view={view}
        views={availableViews}
      />
      <main className="stock-main">
        <header className="stock-header">
          <div>
            <p className="eyebrow">Inventory Tracked APK</p>
            <h2>{view}</h2>
            <p>
              Inventory lines are entered here after sales and purchase bills are saved in their normal modules.
              {isReadOnly ? " Closed fiscal year: preview only." : ""}
            </p>
          </div>
          <div className="stock-header-actions">
            <button type="button" onClick={refreshStockNow}>Refresh Stock</button>
          </div>
        </header>
        {isReadOnly && <p className="stock-status">Closed fiscal year: inventory can be viewed but not changed.</p>}
        {view === "Dashboard" && showInitialLoading && <p className="stock-muted">Loading stock data...</p>}
        {view === "Dashboard" && (
          <DashboardPage
            currentRows={currentRows}
            dashboardTotals={dashboardTotals}
            itemCount={items.length}
            negativeRows={negativeRows}
            onOpenDocument={openDoc}
            statuses={statuses}
          />
        )}
        {view === "Stock Register" && (
          <StockRegisterPage
            items={items}
            registerRows={stockRegisterRows}
          />
        )}
        {view === "Line Item Entry (For Sales)" && (
          <SalesAllocationPage
            allocationMessage={allocationMessage}
            companyInfo={companyInfo}
            currentRows={currentRows}
            draftLines={draftLines}
            editingLineIndex={editingLineIndex}
            items={items}
            lineItemId={lineItemId}
            lineQty={lineQty}
            lineRate={lineRate}
            liveLinesForEntry={liveLinesForEntry}
            onAddLine={addLine}
            onCancelLineEdit={cancelDraftLineEdit}
            onEditDocument={openDoc}
            onEditLine={editDraftLine}
            onLineItemIdChange={setLineItemId}
            onLineQtyChange={setLineQty}
            onLineRateChange={setLineRate}
            onRemoveLine={removeDraftLine}
            onSaveLines={saveSalesLines}
            readOnly={isReadOnly}
            salesDocs={salesDocs}
            selectedDoc={selectedDoc}
            selectedItem={selectedItem}
            selectedKey={selectedKey}
            saving={isSavingLines}
            setSelectedKey={setSelectedKey}
          />
        )}
        {view === "Line Item Entry (For Purchase)" && (
          <PurchaseAllocationPage
            allocationMessage={allocationMessage}
            companyInfo={companyInfo}
            draftLines={draftLines}
            editingLineIndex={editingLineIndex}
            exchangeRate={purchaseEntryCurrency === "NPR" ? 1 : selectedPurchaseExchangeRate}
            items={items}
            lineItemId={lineItemId}
            lineQty={lineQty}
            lineRate={lineRate}
            liveLinesForEntry={liveLinesForEntry}
            onAddLine={addLine}
            onCancelLineEdit={cancelDraftLineEdit}
            onEditDocument={openDoc}
            onEditLine={editDraftLine}
            onLineItemIdChange={setLineItemId}
            onLineQtyChange={setLineQty}
            onLineRateChange={setLineRate}
            onPurchaseEntryCurrencyChange={setPurchaseEntryCurrency}
            onPurchaseEntryTypeChange={setPurchaseEntryType}
            onRemoveLine={removeDraftLine}
            onSaveLines={savePurchaseLines}
            purchaseDocs={purchaseDocs}
            purchaseEntryCurrency={purchaseEntryCurrency}
            purchaseEntryType={purchaseEntryType}
            readOnly={isReadOnly}
            saving={isSavingLines}
            selectedCurrencyOptions={selectedPurchaseCurrencyOptions}
            selectedDoc={selectedDoc}
            selectedItem={selectedItem}
            selectedKey={selectedKey}
            setDraftLines={setDraftLines}
            setSelectedKey={setSelectedKey}
          />
        )}
        {canManage && view === "Item Master" && (
          <ItemMasterPage
            canManage={canManage}
            itemForm={itemForm}
            fieldErrors={itemFieldErrors}
            itemHasOpeningFigure={itemHasOpeningFigure}
            items={items}
            onEditItem={editItem}
            onItemFormChange={(updater) => {
              setItemForm(updater);
              setItemFieldErrors({});
            }}
            onItemHasOpeningFigureChange={setItemHasOpeningFigure}
            onRemoveItem={removeItem}
            onSaveItem={saveItem}
            readOnly={isReadOnly}
            resetItemForm={resetItemForm}
          />
        )}
        {canManage && view === "Data Importation" && (
          <ImportPage
            fileInputKey={fileInputKey}
            fileError={openingFileError}
            isReadOnly={isReadOnly}
            onDownloadOpeningTemplate={downloadOpeningTemplate}
            onImportOpening={importOpening}
            onOpeningFileChange={(file) => {
              setOpeningFile(file);
              setOpeningFileError("");
            }}
          />
        )}
      </main>
    </div>
  );
}

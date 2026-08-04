import { useCallback, useEffect, useRef, useState } from "react";
import { getParties as getAccountParties, getSales } from "../../accounts/data/storage";
import { createDataRepository } from "../../purchase/repository";
import {
  getStockItems,
  getStockPurchaseBills,
  getStockSalesBills,
} from "../storage";
import { buildSourceDocs } from "../services/stockCalculations";
import { errorMessage } from "../services/stockValidation";
import type {
  StockDocumentReference,
  StockItem,
  StockPurchaseBill,
  StockSalesBill,
} from "../types";

type UseStockDataInput = {
  activeCompanyId?: string;
  activeFiscalYearId?: string;
};

export function useStockData({
  activeCompanyId = "",
  activeFiscalYearId = "",
}: UseStockDataInput = {}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [purchaseBills, setPurchaseBills] = useState<StockPurchaseBill[]>([]);
  const [salesBills, setSalesBills] = useState<StockSalesBill[]>([]);
  const [sourceDocs, setSourceDocs] = useState<StockDocumentReference[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoading(true);
    const [
      sales,
      accountParties,
      purchaseData,
      stockItems,
      stockPurchases,
      stockSales,
    ] = await Promise.all([
      getSales(),
      getAccountParties(),
      createDataRepository().then((repo) => repo.loadData()),
      getStockItems(),
      getStockPurchaseBills(),
      getStockSalesBills(),
    ]);
    if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
    setItems(stockItems);
    setPurchaseBills(stockPurchases);
    setSalesBills(stockSales);
    setSourceDocs(
      buildSourceDocs({
        accountParties,
        companyId: activeCompanyId,
        fiscalYearId: activeFiscalYearId,
        localExpenses: purchaseData.localExpenses,
        purchaseParties: purchaseData.parties,
        purchases: purchaseData.purchases,
        sales,
      }),
    );
    setHasLoaded(true);
    setIsLoading(false);
  }, [activeCompanyId, activeFiscalYearId]);

  const refreshStock = useCallback(async (
    text = "Stock refreshed from saved bills and line items.",
    showMessage = true,
  ) => {
    setMessage("");
    try {
      await loadData();
      if (isMountedRef.current && showMessage) setMessage(text);
    } catch (error) {
      if (isMountedRef.current) {
        setHasLoaded(true);
        setIsLoading(false);
        setMessage(errorMessage(error, "Failed to refresh stock."));
      }
    }
  }, [loadData]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadData().catch((error) => {
      console.error("Stock load failed:", error);
      if (!isMountedRef.current) return;
      setHasLoaded(true);
      setMessage("Could not load stock data. Please reopen the app and try again.");
      setIsLoading(false);
    });
  }, [loadData]);

  return {
    isLoading,
    hasLoaded,
    items,
    loadData,
    message,
    purchaseBills,
    refreshStock,
    salesBills,
    setMessage,
    sourceDocs,
  };
}

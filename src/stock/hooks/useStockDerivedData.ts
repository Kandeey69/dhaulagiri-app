import { useMemo } from "react";
import { buildStockRegisterRows, buildStockRows } from "../storage";
import {
  calculateDashboardTotals,
  validStockBillsForSourceDocs,
} from "../services/stockCalculations";
import type {
  StockDocumentReference,
  StockItem,
  StockPurchaseBill,
  StockSalesBill,
} from "../types";

type UseStockDerivedDataInput = {
  items: StockItem[];
  purchaseBills: StockPurchaseBill[];
  salesBills: StockSalesBill[];
  sourceDocs: StockDocumentReference[];
};

export function useStockDerivedData({
  items,
  purchaseBills,
  salesBills,
  sourceDocs,
}: UseStockDerivedDataInput) {
  const validStockData = useMemo(
    () => validStockBillsForSourceDocs(sourceDocs, purchaseBills, salesBills),
    [purchaseBills, salesBills, sourceDocs],
  );

  const currentRows = useMemo(
    () => buildStockRows(items, validStockData.purchaseBills, validStockData.salesBills),
    [items, validStockData.purchaseBills, validStockData.salesBills],
  );

  const stockRegisterRows = useMemo(
    () => buildStockRegisterRows(items, validStockData.purchaseBills, validStockData.salesBills),
    [items, validStockData.purchaseBills, validStockData.salesBills],
  );

  const negativeRows = useMemo(
    () => currentRows.filter((row) => row.closingQty < 0),
    [currentRows],
  );

  const dashboardTotals = useMemo(
    () => calculateDashboardTotals(currentRows),
    [currentRows],
  );

  return {
    currentRows,
    dashboardTotals,
    negativeRows,
    statuses: validStockData.statuses,
    stockRegisterRows,
  };
}

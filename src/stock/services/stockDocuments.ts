import type { TransactionLifecycleStatus } from "../../domain/lifecycle";
import type { StockDocumentReference, StockDocumentType, StockEntryTarget, StockSource } from "../types";

const excludedLifecycleStatuses = new Set<TransactionLifecycleStatus>(["VOID", "REVERSED"]);

export function isStockDocumentLifecycleEligible(status?: TransactionLifecycleStatus) {
  return !status || !excludedLifecycleStatuses.has(status);
}

export function isStockDocumentInFiscalYear<T extends { fiscalYearId?: string }>(
  document: T,
  fiscalYearId = "",
) {
  return !fiscalYearId || document.fiscalYearId === fiscalYearId;
}

export function isStockDocumentEligible(
  document: Pick<StockDocumentReference, "fiscalYearId" | "lifecycleStatus">,
  fiscalYearId = "",
) {
  return (
    isStockDocumentInFiscalYear(document, fiscalYearId) &&
    isStockDocumentLifecycleEligible(document.lifecycleStatus)
  );
}

export function buildStockEntryTarget(input: {
  amount?: number;
  amountCurrency?: "NPR" | "INR" | "USD";
  amountNpr?: number;
  billNo?: string;
  calculatedAt?: string;
  calculationVersion?: string;
  companyId: string;
  date?: string;
  documentId: string;
  exchangeRate?: number;
  fiscalYear?: string;
  fiscalYearId: string;
  grandTotal?: number;
  landedCostNpr?: number;
  lifecycleStatus?: TransactionLifecycleStatus;
  partyName?: string;
  readOnly?: boolean;
  referenceNo?: string;
  remarks?: string;
  source?: StockSource;
  type: StockDocumentType;
  vatAmount?: number;
}): StockEntryTarget {
  return {
    companyId: input.companyId,
    documentId: input.documentId,
    fiscalYear: input.fiscalYear,
    fiscalYearId: input.fiscalYearId,
    readOnly: Boolean(input.readOnly),
    type: input.type,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.amountCurrency !== undefined ? { amountCurrency: input.amountCurrency } : {}),
    ...(input.amountNpr !== undefined ? { amountNpr: input.amountNpr } : {}),
    ...(input.billNo !== undefined ? { billNo: input.billNo } : {}),
    ...(input.calculatedAt !== undefined ? { calculatedAt: input.calculatedAt } : {}),
    ...(input.calculationVersion !== undefined ? { calculationVersion: input.calculationVersion } : {}),
    ...(input.date !== undefined ? { date: input.date } : {}),
    ...(input.exchangeRate !== undefined ? { exchangeRate: input.exchangeRate } : {}),
    ...(input.grandTotal !== undefined ? { grandTotal: input.grandTotal } : {}),
    ...(input.landedCostNpr !== undefined ? { landedCostNpr: input.landedCostNpr } : {}),
    ...(input.lifecycleStatus !== undefined ? { lifecycleStatus: input.lifecycleStatus } : {}),
    ...(input.partyName !== undefined ? { partyName: input.partyName } : {}),
    ...(input.referenceNo !== undefined ? { referenceNo: input.referenceNo } : {}),
    ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.vatAmount !== undefined ? { vatAmount: input.vatAmount } : {}),
  };
}

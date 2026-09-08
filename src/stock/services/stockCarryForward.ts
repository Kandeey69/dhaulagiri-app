import type { StockBackupData, StockOpeningCarryForwardWriteSummary } from "../storage";
import type { StockDocumentReference, StockItem, StockPurchaseBill, StockSalesBill } from "../types";
import { validStockBillsForSourceDocs } from "./stockCalculations";
import { buildStockRows, buildStockRegisterRows } from "./stockLedger";
import { isStockDocumentEligible } from "./stockDocuments";

export type StockCarryForwardPlanItem = {
  code: string;
  isActive: boolean;
  name: string;
  openingQty: number;
  openingRate: number;
  reorderLevel: number;
  sourceClosingValue: number;
  sourceItemId: string;
  unit: string;
};

export type StockCarryForwardPlan = {
  conflicts: string[];
  created: number;
  eligibleItemCount: number;
  items: StockCarryForwardPlanItem[];
  skippedInactiveZero: number;
  skippedInvalid: number;
  skippedNegative: number;
  totalClosingQty: number;
  totalClosingValue: number;
  updated: number;
  warnings: string[];
};

export type BuildStockCarryForwardPlanInput = {
  asOnDate: string;
  sourceDocs: StockDocumentReference[];
  sourceFiscalYearId: string;
  sourceStock: StockBackupData;
  targetItems?: StockItem[];
};

function normalizeCode(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function materialConflict(source: StockCarryForwardPlanItem, target: StockItem) {
  const conflicts: string[] = [];
  if (source.name.trim() !== target.name.trim()) {
    conflicts.push(`name differs (${target.name} -> ${source.name})`);
  }
  if (source.unit.trim() !== target.unit.trim()) {
    conflicts.push(`unit differs (${target.unit} -> ${source.unit})`);
  }
  return conflicts;
}

function stockRate(row: { averageRate: number; closingQty: number; closingValue: number }) {
  if (Number(row.averageRate || 0) > 0) {
    return Number(row.averageRate || 0);
  }

  if (Number(row.closingQty || 0) !== 0) {
    return Number((Number(row.closingValue || 0) / Number(row.closingQty || 0)).toFixed(6));
  }

  return 0;
}

function eligibleStockBills(
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
  sourceDocs: StockDocumentReference[],
  sourceFiscalYearId: string,
) {
  return validStockBillsForSourceDocs(
    sourceDocs.filter((doc) => isStockDocumentEligible(doc, sourceFiscalYearId)),
    purchaseBills,
    salesBills,
  );
}

export function buildStockCarryForwardPlan({
  asOnDate,
  sourceDocs,
  sourceFiscalYearId,
  sourceStock,
  targetItems = [],
}: BuildStockCarryForwardPlanInput): StockCarryForwardPlan {
  const { purchaseBills, salesBills } = eligibleStockBills(
    sourceStock.purchaseBills,
    sourceStock.salesBills,
    sourceDocs,
    sourceFiscalYearId,
  );
  const mismatchedDocumentCount = validStockBillsForSourceDocs(
    sourceDocs.filter((doc) => isStockDocumentEligible(doc, sourceFiscalYearId)),
    sourceStock.purchaseBills,
    sourceStock.salesBills,
  ).statuses.filter((status) => status.status === "Mismatch").length;
  const rows = buildStockRows(sourceStock.items, purchaseBills, salesBills, asOnDate);
  const itemById = new Map(sourceStock.items.map((item) => [item.id, item] as const));
  const targetByCode = new Map(targetItems.map((item) => [normalizeCode(item.code), item] as const));
  const warnings: string[] = [];
  const conflicts: string[] = [];
  let skippedInactiveZero = 0;
  let skippedInvalid = 0;
  let skippedNegative = 0;

  const items = rows.flatMap((row): StockCarryForwardPlanItem[] => {
    const sourceItem = itemById.get(row.itemId);
    const code = normalizeCode(row.code);
    const name = String(row.name ?? "").trim();

    if (!sourceItem || !code || !name) {
      skippedInvalid += 1;
      return [];
    }

    if (row.closingQty < 0) {
      skippedNegative += 1;
      warnings.push(`Skipped ${code} because closing quantity is negative (${row.closingQty}).`);
      return [];
    }

    if (!sourceItem.isActive && row.closingQty === 0) skippedInactiveZero += 1;

    const openingRate = stockRate(row);
    const planItem: StockCarryForwardPlanItem = {
      code,
      isActive: sourceItem.isActive,
      name,
      openingQty: Number(row.closingQty || 0),
      openingRate,
      reorderLevel: Number(row.reorderLevel || sourceItem.reorderLevel || 0),
      sourceClosingValue: Number(row.closingValue || 0),
      sourceItemId: sourceItem.id,
      unit: sourceItem.unit || row.unit || "MT",
    };
    const targetItem = targetByCode.get(code);

    if (targetItem) {
      const itemConflicts = materialConflict(planItem, targetItem);
      if (itemConflicts.length) {
        conflicts.push(`${code}: ${itemConflicts.join("; ")}`);
      }
    }

    return [planItem];
  });

  const targetCodes = new Set(targetItems.map((item) => normalizeCode(item.code)));
  const created = items.filter((item) => !targetCodes.has(item.code)).length;
  const updated = items.length - created;

  if (mismatchedDocumentCount > 0) {
    warnings.unshift(`${mismatchedDocumentCount} inventory document(s) were excluded because saved lines no longer match their source documents.`);
  }

  return {
    conflicts,
    created,
    eligibleItemCount: items.length,
    items,
    skippedInactiveZero,
    skippedInvalid,
    skippedNegative,
    totalClosingQty: Number(items.reduce((sum, item) => sum + item.openingQty, 0).toFixed(6)),
    totalClosingValue: Number(items.reduce((sum, item) => sum + item.sourceClosingValue, 0).toFixed(2)),
    updated,
    warnings,
  };
}

export async function carryForwardStockOpenings(input: {
  asOnDate: string;
  sourceDocs: StockDocumentReference[];
  sourceFiscalYearId: string;
  sourceStock: StockBackupData;
  targetStock: StockBackupData;
  writeOpenings: (items: StockCarryForwardPlanItem[]) => Promise<StockOpeningCarryForwardWriteSummary>;
}) {
  const plan = buildStockCarryForwardPlan({
    asOnDate: input.asOnDate,
    sourceDocs: input.sourceDocs,
    sourceFiscalYearId: input.sourceFiscalYearId,
    sourceStock: input.sourceStock,
    targetItems: input.targetStock.items,
  });
  const readiness = assessYearEndReadiness(input, plan);
  if (!readiness.ready) throw new Error("Year-end inventory is not ready:\n" + readiness.blockingIssues.join("\n"));
  const writeSummary = await input.writeOpenings(plan.items);

  return {
    ...plan,
    created: writeSummary.created,
    updated: writeSummary.updated,
    status: "completed" as const,
  };
}

export function assessYearEndReadiness(input: BuildStockCarryForwardPlanInput, plan = buildStockCarryForwardPlan(input)) {
  const validation = validStockBillsForSourceDocs(
    input.sourceDocs.filter(doc => isStockDocumentEligible(doc, input.sourceFiscalYearId)),
    input.sourceStock.purchaseBills, input.sourceStock.salesBills,
  );
  const blockingIssues = validation.statuses.filter(row => row.status !== "Entered")
    .map(row => `${row.type} ${row.billNo || row.documentId}: ${row.status}`);
  for (const doc of input.sourceDocs) if (doc.lifecycleStatus === "DRAFT") blockingIssues.push(`Document ${doc.billNo}: draft must be posted or removed before closing`);
  const sourceKeys = new Set(input.sourceDocs.map(doc => doc.type + ":" + doc.documentId));
  for (const bill of input.sourceStock.purchaseBills) {
    const type = bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase");
    if (bill.items.length && !sourceKeys.has(type + ":" + bill.id)) blockingIssues.push(`Inventory bill ${bill.billNo}: source document is missing`);
  }
  for (const bill of input.sourceStock.salesBills) if (bill.items.length && !sourceKeys.has("Sale:" + bill.id)) blockingIssues.push(`Inventory bill ${bill.billNo}: source sale is missing`);
  const ids = new Set(input.sourceStock.items.map(item => item.id));
  for (const item of input.sourceStock.items) if (![item.openingQty, item.openingRate].every(value => Number.isFinite(value) && value >= 0)) blockingIssues.push(`${item.code}: invalid opening stock`);
  for (const doc of input.sourceDocs.filter(doc => isStockDocumentEligible(doc, input.sourceFiscalYearId))) if (doc.date > input.asOnDate) blockingIssues.push(`Document ${doc.billNo}: date exceeds fiscal-year closing date`);
  for (const bill of [...input.sourceStock.purchaseBills, ...input.sourceStock.salesBills]) {
    for (const line of bill.items) {
      if (!ids.has(line.itemId)) blockingIssues.push(`Document ${bill.billNo}: missing item ${line.itemId}`);
      if (![line.quantity, line.rate, line.amount].every(value => Number.isFinite(value) && value >= 0)) blockingIssues.push(`Document ${bill.billNo}: invalid stock line value`);
    }
  }
  for (const row of buildStockRegisterRows(input.sourceStock.items, validation.purchaseBills, validation.salesBills)) {
    if (row.balanceQty < 0) blockingIssues.push(`${row.code}: negative stock at ${row.date}`);
    if (![row.balanceAmount, row.balanceQty, row.balanceRate].every(Number.isFinite)) blockingIssues.push(`${row.code}: invalid valuation`);
  }
  blockingIssues.push(...plan.conflicts, ...plan.warnings);
  if (plan.skippedInvalid) blockingIssues.push(`${plan.skippedInvalid} invalid stock item(s)`);
  return { ready: blockingIssues.length === 0, blockingIssues };
}

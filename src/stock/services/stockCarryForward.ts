import type { StockBackupData, StockOpeningCarryForwardWriteSummary } from "../storage";
import type { StockDocumentReference, StockItem, StockPurchaseBill, StockSalesBill } from "../types";
import { validStockBillsForSourceDocs } from "./stockCalculations";
import { buildStockRows } from "./stockLedger";
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

    if (!sourceItem.isActive && row.closingQty === 0) {
      skippedInactiveZero += 1;
      return [];
    }

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
  const writeSummary = await input.writeOpenings(plan.items);

  return {
    ...plan,
    created: writeSummary.created,
    updated: writeSummary.updated,
    status: "completed" as const,
  };
}

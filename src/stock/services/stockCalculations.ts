import type { Party as AccountParty, Sale } from "../../accounts/data/types";
import type {
  ImportPurchase,
  LocalPurchaseExpense,
  Party as PurchaseParty,
} from "../../purchase/domain";
import {
  getActiveCompanyProfile,
  getCompanySetting,
} from "../../companyContext";
import { isStockDocumentEligible } from "./stockDocuments";
import type {
  EntryCurrency,
  StockDocumentReference,
  StockDocumentStatus,
  StockDashboardTotals,
  StockCompanyInfo,
  StockPurchaseBill,
  StockPurchaseLine,
  StockRow,
  StockSourceSnapshot,
  StockSalesBill,
  StockSalesLine,
} from "../types";

const ACCOUNTS_COMPANY_KEY = "accounts-company-name";
const ACCOUNTS_FISCAL_YEAR_KEY = "accounts-fiscal-year";
const SUITE_COMPANY_KEY = "suite-company-name";
const SUITE_FISCAL_YEAR_KEY = "suite-fiscal-year";

export const n = (value: unknown) => {
  const parsed = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const qty = (value: number) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

export const money = (value: number) => formatCurrency(value, "NPR");

export const docKey = (doc: Pick<StockDocumentReference, "documentId" | "type">) =>
  `${doc.type}:${doc.documentId}`;

export function normalizeDate(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return raw;
  const [, year, monthText, dayText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 32) return raw;
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function buildSourceDocs({
  accountParties,
  companyId = "",
  fiscalYearId = "",
  localExpenses,
  purchaseParties,
  purchases,
  sales,
}: {
  accountParties: AccountParty[];
  companyId?: string;
  fiscalYearId?: string;
  localExpenses: LocalPurchaseExpense[];
  purchaseParties: PurchaseParty[];
  purchases: ImportPurchase[];
  sales: Sale[];
}): StockDocumentReference[] {
  const accountPartyById = new Map(accountParties.map((party) => [party.id, party] as const));
  const purchasePartyById = new Map(purchaseParties.map((party) => [party.id, party] as const));
  return [
    ...sales.map((sale) => ({
      amount: sale.salesAmount,
      amountCurrency: "NPR" as const,
      amountNpr: sale.salesAmount,
      billNo: sale.billNo,
      date: sale.dateBs,
      documentId: sale.id,
      exchangeRate: 1,
      companyId,
      fiscalYearId: sale.fiscalYearId,
      grandTotal: sale.totalAmount,
      lifecycleStatus: sale.lifecycleStatus,
      partyName: accountPartyById.get(sale.partyId)?.name ?? "Unknown",
      remarks: sale.remarks ?? "",
      type: "Sale" as const,
      vatAmount: sale.vatAmount,
    })),
    ...purchases.map((purchase) => ({
      amount: purchase.amountIC,
      amountCurrency: purchase.supplierCurrency,
      amountNpr: purchase.supplierAmountNPR,
      billNo: purchase.vendorBillNumber,
      date: purchase.debitNoteDate || purchase.billDate,
      documentId: purchase.id,
      exchangeRate: purchase.supplierExchangeRate,
      companyId,
      fiscalYearId: purchase.fiscalYearId,
      grandTotal: purchase.amountIC,
      landedCostNpr: purchase.landedCostNPR,
      calculationVersion: purchase.calculationVersion,
      calculatedAt: purchase.calculatedAt,
      lifecycleStatus: purchase.lifecycleStatus,
      partyName: purchasePartyById.get(purchase.vendorPartyId)?.name ?? "Unknown",
      referenceNo: purchase.debitNoteNumber,
      remarks: purchase.remarks,
      source: "Importation" as const,
      type: "Import Purchase" as const,
      vatAmount: 0,
    })),
    ...localExpenses
      .filter((localExpense) => localExpense.expenseType === "Stock")
      .map((localExpense) => ({
        amount: localExpense.amountBeforeVatNPR,
        amountCurrency: "NPR" as const,
        amountNpr: localExpense.amountBeforeVatNPR,
        billNo: localExpense.billNumber,
        date: localExpense.billDate,
        documentId: localExpense.id,
        exchangeRate: 1,
        companyId,
        fiscalYearId: localExpense.fiscalYearId,
        grandTotal: localExpense.totalAmountNPR,
        landedCostNpr: localExpense.amountBeforeVatNPR,
        lifecycleStatus: localExpense.lifecycleStatus,
        partyName: purchasePartyById.get(localExpense.partyId)?.name ?? "Unknown",
        referenceNo: localExpense.expenseHead,
        remarks: localExpense.remarks,
        source: "Local Purchase" as const,
        type: "Local Purchase" as const,
        vatAmount: localExpense.vatNPR,
      })),
  ]
    .filter((doc) => isStockDocumentEligible(doc, fiscalYearId))
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}

export function buildStatuses(
  sourceDocs: StockDocumentReference[],
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
): StockDocumentStatus[] {
  const purchaseByKey = new Map(purchaseBills.map((bill) => [
    `${bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase")}:${bill.id}`,
    bill,
  ] as const));
  const salesById = new Map(salesBills.map((bill) => [bill.id, bill] as const));
  return sourceDocs.map((doc) => {
    const stored = doc.type === "Sale"
      ? salesById.get(doc.documentId)
      : purchaseByKey.get(`${doc.type}:${doc.documentId}`);
    const storedLines = stored?.items ?? [];
    const lineCount = storedLines.length;
    const validation = validateStoredStockDocument(doc, stored, storedLines);
    return {
      ...doc,
      isFinal: validation.isFinal,
      lineCount,
      lineValue: validation.lineValue,
      status: validation.status,
      statusReason: validation.statusReason,
      valuationValue: validation.valuationValue,
    };
  });
}

export function validStockBillsForSourceDocs(
  sourceDocs: StockDocumentReference[],
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
) {
  const statuses = buildStatuses(sourceDocs, purchaseBills, salesBills);
  const finalKeys = new Set(statuses.filter((status) => status.isFinal).map(docKey));
  const docByKey = new Map(sourceDocs.map((doc) => [docKey(doc), doc] as const));
  const purchaseDocs = purchaseBills
    .filter((bill) => {
      const sourceType = bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase");
      return finalKeys.has(`${sourceType}:${bill.id}`);
    })
    .map((bill) => {
      const sourceType = bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase");
      const doc = docByKey.get(`${sourceType}:${bill.id}`);
      if (!doc) return bill;
      return {
        ...bill,
        billNo: doc.billNo,
        dateBs: doc.date,
        referenceNo: doc.referenceNo ?? bill.referenceNo,
        remarks: doc.remarks ?? bill.remarks,
        source: doc.source ?? bill.source,
        supplierName: doc.partyName,
      };
    });
  const salesDocs = salesBills
    .filter((bill) => finalKeys.has(`Sale:${bill.id}`))
    .map((bill) => {
      const doc = docByKey.get(`Sale:${bill.id}`);
      if (!doc) return bill;
      return {
        ...bill,
        billNo: doc.billNo,
        customerName: doc.partyName,
        dateBs: doc.date,
        remarks: doc.remarks ?? bill.remarks,
      };
    });

  return { purchaseBills: purchaseDocs, salesBills: salesDocs, statuses };
}

export function linesForDoc(
  doc: StockDocumentStatus,
  purchaseBills: StockPurchaseBill[],
  salesBills: StockSalesBill[],
) {
  const stored = doc.type === "Sale"
    ? salesBills.find((bill) => bill.id === doc.documentId)
    : purchaseBills.find((bill) =>
      bill.id === doc.documentId &&
      (bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase")) === doc.type
    );
  return (stored?.items ?? []).map((line) => {
    const draftLine = {
      itemId: line.itemId,
      quantity: line.quantity,
      rate: line.rate,
    } as {
      amount?: number;
      entryAmount?: number;
      entryRate?: number;
      itemId: string;
      quantity: number;
      rate: number;
    };
    const calculatedAmount = Number((line.quantity * line.rate).toFixed(2));
    if (Math.abs(Number(line.amount || 0) - calculatedAmount) > 0.005) {
      draftLine.amount = line.amount;
    }
    if ("entryRate" in line && typeof line.entryRate === "number") {
      draftLine.entryRate = line.entryRate;
    }
    if ("entryAmount" in line && typeof line.entryAmount === "number") {
      draftLine.entryAmount = line.entryAmount;
    }
    return draftLine;
  });
}

export function defaultPurchaseCurrency(doc?: StockDocumentReference): EntryCurrency {
  if (!doc || doc.type === "Local Purchase") return "NPR";
  return (doc.amountCurrency ?? "NPR") as EntryCurrency;
}

export function purchaseCurrencyOptions(doc?: StockDocumentReference): EntryCurrency[] {
  if (!doc || doc.type === "Local Purchase") return ["NPR"];
  return Array.from(new Set(["NPR", defaultPurchaseCurrency(doc)]));
}

export function calculateDashboardTotals(rows: StockRow[]): StockDashboardTotals {
  const totals = rows.reduce(
    (current, row) => ({
      closingValue: current.closingValue + row.closingValue,
      openingValue: current.openingValue + row.openingValue,
      purchaseValue: current.purchaseValue + row.localPurchaseValue + row.importationValue,
      salesValue: current.salesValue + row.salesValue,
    }),
    {
      closingValue: 0,
      openingValue: 0,
      purchaseValue: 0,
      salesValue: 0,
    },
  );
  const { closingValue, openingValue, purchaseValue, salesValue } = totals;
  const costOfGoodsSold = openingValue + purchaseValue - closingValue;
  return {
    closingValue,
    costOfGoodsSold,
    grossProfit: salesValue - costOfGoodsSold,
    openingValue,
    purchaseValue,
    salesValue,
  };
}

export function billTotal(lines: Array<{ quantity: number; rate: number; amount?: number }>) {
  return lines.reduce((sum, line) => sum + Number(line.amount ?? line.quantity * line.rate), 0);
}

export function billEntryTotal(
  lines: Array<{ quantity: number; rate: number; amount?: number; entryRate?: number; entryAmount?: number }>,
) {
  return lines.reduce(
    (sum, line) => sum + Number(line.entryAmount ?? line.amount ?? line.quantity * (line.entryRate ?? line.rate)),
    0,
  );
}

function comparableText(value: unknown) {
  return String(value ?? "").trim();
}

function comparableDate(value: unknown) {
  return normalizeDate(comparableText(value));
}

function amountMatchesNumber(left: number, right: number, tolerance = 0.5) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= tolerance;
}

function optionalAmountMatches(snapshotValue: number | undefined, currentValue: number | undefined, tolerance = 0.5) {
  return snapshotValue === undefined || amountMatchesNumber(snapshotValue, Number(currentValue || 0), tolerance);
}

function optionalTextMatches(snapshotValue: string | undefined, currentValue: string | undefined) {
  return snapshotValue === undefined || comparableText(snapshotValue) === comparableText(currentValue);
}

function snapshotFromDoc(doc: StockDocumentReference): StockSourceSnapshot {
  return {
    sourceAmount: doc.amount,
    sourceAmountNpr: doc.amountNpr,
    sourceCurrency: doc.amountCurrency,
    sourceExchangeRate: doc.exchangeRate,
    sourceFiscalYearId: doc.fiscalYearId,
    sourceGrandTotal: doc.grandTotal,
    sourceLandedCostNpr: doc.landedCostNpr,
    sourceLifecycleStatus: doc.lifecycleStatus,
  };
}

function hasStoredSnapshot(snapshot: StockSourceSnapshot | undefined) {
  if (!snapshot) return false;
  return Object.values(snapshot).some((value) => value !== undefined && value !== null && value !== "");
}

function snapshotMatches(doc: StockDocumentReference, snapshot: StockSourceSnapshot | undefined) {
  if (!hasStoredSnapshot(snapshot)) {
    return { matches: true, reason: "" };
  }

  const current = snapshotFromDoc(doc);
  const checks = [
    optionalAmountMatches(snapshot?.sourceAmount, current.sourceAmount),
    optionalAmountMatches(snapshot?.sourceAmountNpr, current.sourceAmountNpr),
    optionalAmountMatches(snapshot?.sourceGrandTotal, current.sourceGrandTotal),
    optionalAmountMatches(snapshot?.sourceLandedCostNpr, current.sourceLandedCostNpr),
    optionalAmountMatches(snapshot?.sourceExchangeRate, current.sourceExchangeRate, 0.000001),
    optionalTextMatches(snapshot?.sourceCurrency, current.sourceCurrency),
    optionalTextMatches(snapshot?.sourceFiscalYearId, current.sourceFiscalYearId),
    optionalTextMatches(snapshot?.sourceLifecycleStatus, current.sourceLifecycleStatus),
  ];

  return checks.every(Boolean)
    ? { matches: true, reason: "" }
    : { matches: false, reason: "Source document values changed after inventory lines were saved." };
}

function metadataMatches(
  doc: StockDocumentReference,
  stored: StockPurchaseBill | StockSalesBill | undefined,
) {
  if (!stored) return { matches: false, reason: "Inventory lines are missing." };
  const storedBillNo = "billNo" in stored ? stored.billNo : "";
  const storedDate = "dateBs" in stored ? stored.dateBs : "";
  const storedParty = "customerName" in stored ? stored.customerName : stored.supplierName;

  if (comparableText(storedBillNo) !== comparableText(doc.billNo)) {
    return { matches: false, reason: "Bill number changed after inventory lines were saved." };
  }
  if (comparableDate(storedDate) !== comparableDate(doc.date)) {
    return { matches: false, reason: "Document date changed after inventory lines were saved." };
  }
  if (comparableText(storedParty) !== comparableText(doc.partyName)) {
    return { matches: false, reason: "Party changed after inventory lines were saved." };
  }

  return snapshotMatches(doc, stored.sourceSnapshot);
}

function validateStoredStockDocument(
  doc: StockDocumentReference,
  stored: StockPurchaseBill | StockSalesBill | undefined,
  storedLines: Array<StockPurchaseLine | StockSalesLine>,
) {
  const lineCount = storedLines.length;
  const lineValue = doc.type === "Sale" ? billTotal(storedLines) : billEntryTotal(storedLines);
  const valuationValue = billTotal(storedLines);

  if (!lineCount) {
    return {
      isFinal: false,
      lineValue,
      status: "Pending" as const,
      statusReason: "Inventory lines have not been entered.",
      valuationValue,
    };
  }

  const metadata = metadataMatches(doc, stored);
  if (!metadata.matches) {
    return {
      isFinal: false,
      lineValue,
      status: "Mismatch" as const,
      statusReason: metadata.reason,
      valuationValue,
    };
  }

  const entryTarget = doc.type === "Sale" ? doc.amount : doc.amount;
  if (!amountMatchesNumber(lineValue, entryTarget)) {
    return {
      isFinal: false,
      lineValue,
      status: "Mismatch" as const,
      statusReason: "Inventory line total does not match the current source document amount.",
      valuationValue,
    };
  }

  const valuationTarget = doc.type === "Sale"
    ? doc.amount
    : doc.landedCostNpr ?? doc.amountNpr ?? doc.amount;
  if (!amountMatchesNumber(valuationValue, valuationTarget)) {
    return {
      isFinal: false,
      lineValue,
      status: "Mismatch" as const,
      statusReason: "Inventory valuation total does not match the current landed/source amount.",
      valuationValue,
    };
  }

  return {
    isFinal: true,
    lineValue,
    status: "Entered" as const,
    statusReason: "",
    valuationValue,
  };
}

export function documentAmount(doc: StockDocumentReference) {
  if (doc.type === "Sale" || doc.type === "Local Purchase") return money(doc.amountNpr ?? doc.amount);
  return `${formatCurrency(doc.amount, doc.amountCurrency ?? "NPR")} / ${money(doc.amountNpr ?? 0)}`;
}

export function formatCurrency(value: number, currency: EntryCurrency) {
  return `${currency} ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRate(value: number, currency?: EntryCurrency) {
  const formatted = Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

  return currency ? `${currency} ${formatted}` : formatted;
}

export function readStockCompanyInfo(): StockCompanyInfo {
  const activeCompany = getActiveCompanyProfile();

  return {
    companyName:
      activeCompany?.name ||
      getCompanySetting(ACCOUNTS_COMPANY_KEY) ||
      getCompanySetting(SUITE_COMPANY_KEY) ||
      "Company",
    fiscalYear:
      activeCompany?.fiscalYear ||
      getCompanySetting(ACCOUNTS_FISCAL_YEAR_KEY) ||
      getCompanySetting(SUITE_FISCAL_YEAR_KEY) ||
      "-",
  };
}

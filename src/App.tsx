import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import AccountsApp from "./accounts/App";
import {
  getAccountsBackupData,
  getActivityLogs as getAccountActivityLogs,
  getCollections,
  getCreditNotes,
  getOutstanding as getAccountOutstanding,
  getParties,
  getSales,
  restoreAccountsBackupData,
  upsertPartiesForCarryForward,
  type AccountsBackupData,
} from "./accounts/data/storage";
import type { Collection, CreditNote, Party as AccountParty, Sale } from "./accounts/data/types";
import { saveBlob } from "./accounts/utils/fileSave";
import {
  LETTERHEAD_SETTING_KEY_LIST,
  readLetterheadSettings,
  writeLetterheadSettings,
} from "./accounts/utils/letterheadSettings";
import {
  defaultSettings,
  normalizeSupplierCurrency,
  type AppData,
  type AppSettings,
  type SupplierCurrency,
} from "./purchase/domain";
import { createDataRepository, getEmptyData } from "./purchase/repository";
import { createFiscalYearFromCode } from "./domain/fiscalYear";
import PurchaseApp from "./purchase/App";
import StockApp from "./stock/App";
import {
  isInventoryTrackingEnabled,
  isInventoryTrackingEnabledForCompany,
  writeInventoryTrackingSetting,
  writeInventoryTrackingSettingForCompany,
} from "./stock/settings";
import { buildSourceDocs, validStockBillsForSourceDocs } from "./stock/services/stockCalculations";
import { carryForwardStockOpenings } from "./stock/services/stockCarryForward";
import {
  buildStockRegisterRows as buildStockRegisterExportRows,
  buildStockRows as buildStockExportRows,
} from "./stock/services/stockLedger";
import {
  getStockBackupDataForCompany,
  replaceStockBackupDataForCompany,
  upsertStockOpeningItemsForCompany,
  type StockBackupData,
} from "./stock/storage";
import type { StockDocumentReference, StockEntryTarget } from "./stock/types";
import { purchaseClosingParties } from "./application/purchaseCarryForward";
import {
  createCompanyYearId,
  copyCompanySettings,
  getActiveCompanyId,
  getActiveCompanyProfile,
  getCompanyProfile,
  getCompanyProfiles,
  getCompanySetting,
  mergeCompanyProfiles,
  parseCompanyProfiles,
  removeCompanyProfile,
  removeCompanyScopedSettings,
  resolveActiveCompanyId,
  saveCompanyProfiles,
  setActiveCompanyId,
  setCompanySetting,
  upsertCompanyProfile,
  type CompanyProfile,
} from "./companyContext";
import { scrollToPageTop } from "./scroll";
import "./App.css";

type UserRole = "account" | "master";
type ModuleKey = "accounts" | "purchase" | "stock" | "settings" | "maskebari" | "yearEnd";

const MASTER_PASSWORD = "KANCHAN";
const YEAR_END_PASSWORD = "DAHAL";
const ACCOUNTS_COMPANY_KEY = "accounts-company-name";
const ACCOUNTS_FISCAL_YEAR_KEY = "accounts-fiscal-year";
const COMPANY_SETUP_KEY = "suite-company-setup-complete";
const SUITE_SETTING_KEYS = {
  companyName: "suite-company-name",
  fiscalYear: "suite-fiscal-year",
  panVatNo: "suite-pan-vat-no",
  address: "suite-address",
  phone: "suite-phone",
  defaultExchangeRate: "suite-default-exchange-rate",
  supplierPurchaseCurrency: "suite-supplier-purchase-currency",
  agentServiceVatRate: "suite-agent-service-vat-rate",
};
const legacyDefaultCompanyNames = new Set(["Dhaulagiri", "Dhaulagiri Accounts"]);

function storageNumber(key: string, fallback: number) {
  const value = Number(getCompanySetting(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function legacySetting(key: string) {
  return localStorage.getItem(key) ?? "";
}

function readSuiteSettings(settings: AppSettings = defaultSettings): AppSettings {
  return {
    ...settings,
    companyName:
      getCompanySetting(ACCOUNTS_COMPANY_KEY) ||
      getCompanySetting(SUITE_SETTING_KEYS.companyName) ||
      settings.companyName,
    fiscalYear:
      getCompanySetting(ACCOUNTS_FISCAL_YEAR_KEY) ||
      getCompanySetting(SUITE_SETTING_KEYS.fiscalYear) ||
      settings.fiscalYear,
    panVatNo: getCompanySetting(SUITE_SETTING_KEYS.panVatNo) || settings.panVatNo,
    address: getCompanySetting(SUITE_SETTING_KEYS.address) || settings.address,
    phone: getCompanySetting(SUITE_SETTING_KEYS.phone) || settings.phone,
    defaultExchangeRate: storageNumber(
      SUITE_SETTING_KEYS.defaultExchangeRate,
      settings.defaultExchangeRate,
    ),
    supplierPurchaseCurrency: normalizeSupplierCurrency(
      getCompanySetting(SUITE_SETTING_KEYS.supplierPurchaseCurrency) ||
        settings.supplierPurchaseCurrency,
    ),
    agentServiceVatRate: storageNumber(
      SUITE_SETTING_KEYS.agentServiceVatRate,
      settings.agentServiceVatRate,
    ),
  };
}

function writeSuiteSettings(settings: AppSettings) {
  setCompanySetting(ACCOUNTS_COMPANY_KEY, settings.companyName);
  setCompanySetting(ACCOUNTS_FISCAL_YEAR_KEY, settings.fiscalYear);
  setCompanySetting(SUITE_SETTING_KEYS.companyName, settings.companyName);
  setCompanySetting(SUITE_SETTING_KEYS.fiscalYear, settings.fiscalYear);
  setCompanySetting(SUITE_SETTING_KEYS.panVatNo, settings.panVatNo);
  setCompanySetting(SUITE_SETTING_KEYS.address, settings.address);
  setCompanySetting(SUITE_SETTING_KEYS.phone, settings.phone);
  setCompanySetting(
    SUITE_SETTING_KEYS.defaultExchangeRate,
    String(settings.defaultExchangeRate),
  );
  setCompanySetting(
    SUITE_SETTING_KEYS.supplierPurchaseCurrency,
    settings.supplierPurchaseCurrency,
  );
  setCompanySetting(
    SUITE_SETTING_KEYS.agentServiceVatRate,
    String(settings.agentServiceVatRate),
  );

  const activeCompany = getActiveCompanyProfile();
  if (activeCompany) {
    upsertCompanyProfile({
      ...activeCompany,
      fiscalYear: settings.fiscalYear,
      name: settings.companyName,
    });
  }
}

function ensureInitialCompanyProfiles() {
  const profiles = getCompanyProfiles();

  if (profiles.length > 0) {
    if (!getActiveCompanyId()) {
      setActiveCompanyId(profiles[0].id);
    }
    return profiles;
  }

  const legacyCompanyName = (
    legacySetting(ACCOUNTS_COMPANY_KEY) ||
    legacySetting(SUITE_SETTING_KEYS.companyName) ||
    ""
  ).trim();

  if (!legacyCompanyName || legacyDefaultCompanyNames.has(legacyCompanyName)) {
    return [];
  }

  const profile = upsertCompanyProfile({
    id: "default",
    name: legacyCompanyName,
    fiscalYear: legacySetting(ACCOUNTS_FISCAL_YEAR_KEY) || legacySetting(SUITE_SETTING_KEYS.fiscalYear),
  });
  setActiveCompanyId(profile.id);
  return [profile];
}

function nextFiscalYear(fiscalYear: string) {
  const match = fiscalYear.trim().match(/^(\d{4})\s*\/\s*(\d{2})$/);

  if (!match) {
    return "";
  }

  const startYear = Number(match[1]) + 1;
  const endYear = (Number(match[2]) + 1) % 100;
  return `${startYear}/${String(endYear).padStart(2, "0")}`;
}

async function carryForwardOpenings(sourceCompany: CompanyProfile, targetCompany: CompanyProfile) {
  const previousActiveCompanyId = getActiveCompanyId();
  const sourceFiscalYear = createFiscalYearFromCode(sourceCompany.id, sourceCompany.fiscalYear);

  try {
    setActiveCompanyId(sourceCompany.id);
    const [accountParties, accountOutstandingRows, sourceSales, sourcePurchaseRepository] = await Promise.all([
      getParties(),
      getAccountOutstanding(),
      getSales(),
      createDataRepository(),
    ]);
    const sourcePurchaseData = await sourcePurchaseRepository.loadData();
    const outstandingByPartyId = new Map(
      accountOutstandingRows.map((row) => [row.partyId, row.outstanding]),
    );
    const carriedAccountParties = accountParties.map((party) => ({
      ...party,
      openingBalance: outstandingByPartyId.get(party.id) ?? party.openingBalance,
    }));
    const carriedPurchaseParties = purchaseClosingParties(sourcePurchaseData);

    setActiveCompanyId(targetCompany.id);
    const targetAccountsBefore = await getAccountsBackupData();
    const targetPurchaseRepository = await createDataRepository();
    const targetPurchaseData = await targetPurchaseRepository.loadData();
    const targetPurchaseBefore: AppData = JSON.parse(JSON.stringify(targetPurchaseData)) as AppData;
    let inventory = {
      conflicts: [] as string[],
      created: 0,
      eligibleItemCount: 0,
      skippedInactiveZero: 0,
      skippedInvalid: 0,
      skippedNegative: 0,
      status: "skipped" as "completed" | "skipped",
      totalClosingQty: 0,
      totalClosingValue: 0,
      updated: 0,
      warnings: ["Track inventory is disabled for the source company."],
    };

    try {
      await upsertPartiesForCarryForward(carriedAccountParties);

      const targetPartyMap = new Map(targetPurchaseData.parties.map((party) => [party.id, party]));
      const nextParties = [...targetPurchaseData.parties];

      carriedPurchaseParties.forEach((party) => {
        const existing = targetPartyMap.get(party.id);
        const nextParty = {
          ...(existing ?? party),
          ...party,
          openingPayable: party.openingPayable,
          updatedAt: new Date().toISOString(),
        };

        if (existing) {
          nextParties[nextParties.findIndex((item) => item.id === party.id)] = nextParty;
        } else {
          nextParties.unshift(nextParty);
        }
      });

      const targetSettings = {
        ...targetPurchaseData.settings,
        companyName: targetCompany.name,
        fiscalYear: targetCompany.fiscalYear,
      };
      writeSuiteSettings(targetSettings);
      await targetPurchaseRepository.saveData({
        ...targetPurchaseData,
        settings: targetSettings,
        parties: nextParties,
        activityLogs: [
          {
            id: crypto.randomUUID(),
            action: "Opening Balances Refreshed",
            details: `Refreshed opening balances from ${sourceCompany.fiscalYear || sourceCompany.name}.`,
            userName: "Master",
            oldValue: sourceCompany.id,
            newValue: targetCompany.id,
            createdAt: new Date().toISOString(),
          },
          ...targetPurchaseData.activityLogs,
        ],
      });

      if (isInventoryTrackingEnabledForCompany(sourceCompany.id)) {
        const sourceDocs: StockDocumentReference[] = buildSourceDocs({
          accountParties,
          companyId: sourceCompany.id,
          fiscalYearId: sourceFiscalYear.id,
          localExpenses: sourcePurchaseData.localExpenses,
          purchaseParties: sourcePurchaseData.parties,
          purchases: sourcePurchaseData.purchases,
          sales: sourceSales,
        });
        const [sourceStock, targetStock] = await Promise.all([
          getStockBackupDataForCompany(sourceCompany.id),
          getStockBackupDataForCompany(targetCompany.id),
        ]);

        inventory = await carryForwardStockOpenings({
          asOnDate: sourceFiscalYear.endBs,
          sourceDocs,
          sourceFiscalYearId: sourceFiscalYear.id,
          sourceStock,
          targetStock,
          writeOpenings: (items) => upsertStockOpeningItemsForCompany(targetCompany.id, items),
        });
        writeInventoryTrackingSettingForCompany(targetCompany.id, true);
      }

      copyCompanySettings(sourceCompany.id, targetCompany.id, LETTERHEAD_SETTING_KEY_LIST);
    } catch (error) {
      setActiveCompanyId(targetCompany.id);
      await restoreAccountsBackupData(targetAccountsBefore).catch((restoreError) => {
        console.error("Account opening rollback failed:", restoreError);
      });
      await targetPurchaseRepository.saveData(targetPurchaseBefore).catch((restoreError) => {
        console.error("Purchase opening rollback failed:", restoreError);
      });
      writeSuiteSettings(targetPurchaseBefore.settings);
      throw new Error(
        `Carry-forward failed before the target company was refreshed. ` +
        `${error instanceof Error ? error.message : String(error || "Unknown carry-forward error.")}`,
        { cause: error },
      );
    }

    return {
      accountParties: carriedAccountParties.length,
      inventory,
      purchaseParties: carriedPurchaseParties.length,
    };
  } finally {
    setActiveCompanyId(previousActiveCompanyId);
  }
}

async function withActiveCompany<T>(companyId: string, operation: () => Promise<T>) {
  const previousActiveCompanyId = getActiveCompanyId();
  setActiveCompanyId(companyId);

  try {
    return await operation();
  } finally {
    setActiveCompanyId(previousActiveCompanyId);
  }
}

type WorkbookSheet = {
  name: string;
  rows: Array<Array<string | number | boolean>>;
};

async function downloadCompanyWorkbook(company: CompanyProfile) {
  await withActiveCompany(company.id, async () => {
  const [
    accountParties,
    sales,
    collections,
    creditNotes,
    outstandingRows,
    accountActivityLogs,
    purchaseRepository,
    stockData,
  ] = await Promise.all([
    getParties(),
    getSales(),
    getCollections(),
    getCreditNotes(),
    getAccountOutstanding(),
    getAccountActivityLogs(100000),
    createDataRepository(),
    getStockBackupDataForCompany(company.id),
  ]);
  const purchaseData = await purchaseRepository.loadData();
  const settings = readSuiteSettings(purchaseData.settings);
  const accountPartyName = new Map(accountParties.map((party) => [party.id, party.name]));
  const purchasePartyName = new Map(purchaseData.parties.map((party) => [party.id, party.name]));
  const payableOutstandingRows = purchaseClosingParties(purchaseData);
  const fiscalYear = createFiscalYearFromCode(company.id, company.fiscalYear);
  const stockSourceDocs = buildSourceDocs({
    accountParties,
    companyId: company.id,
    fiscalYearId: fiscalYear.id,
    localExpenses: purchaseData.localExpenses,
    purchaseParties: purchaseData.parties,
    purchases: purchaseData.purchases,
    sales,
  });
  const {
    purchaseBills: stockPurchaseBills,
    salesBills: stockSalesBills,
  } = validStockBillsForSourceDocs(stockSourceDocs, stockData.purchaseBills, stockData.salesBills);
  const stockRows = buildStockExportRows(stockData.items, stockPurchaseBills, stockSalesBills, fiscalYear.endBs);
  const stockRegisterRows = buildStockRegisterExportRows(stockData.items, stockPurchaseBills, stockSalesBills)
    .filter((row) => row.date === "Opening" || row.date <= fiscalYear.endBs);
  const stockItemById = new Map(stockData.items.map((item) => [item.id, item] as const));
  const sheets: WorkbookSheet[] = [
    {
      name: "Company",
      rows: [
        ["Company Name", company.name],
        ["Fiscal Year", company.fiscalYear],
        ["Status", company.isLocked ? "Closed" : "Open"],
        ["PAN/VAT No.", settings.panVatNo],
        ["Address", settings.address],
        ["Phone", settings.phone],
        ["Default INR Rate", settings.defaultExchangeRate],
        ["Supplier Currency Mode", settings.supplierPurchaseCurrency],
        ["Exported At", new Date().toISOString()],
      ],
    },
    {
      name: "Account Parties",
      rows: [
        ["name", "address", "phone", "panNo", "openingBalance", "isActive", "createdAt"],
        ...accountParties.map((party) => [
          party.name,
          party.address ?? "",
          party.phone ?? "",
          party.panNo ?? "",
          party.openingBalance,
          party.isActive ? "yes" : "no",
          party.createdAt,
        ]),
      ],
    },
    {
      name: "Sales",
      rows: [
        ["billNo", "dateBs", "dateAd", "partyName", "partyId", "salesAmount", "vatAmount", "totalAmount", "remarks", "createdAt"],
        ...sales.map((sale) => [
          sale.billNo,
          sale.dateBs,
          sale.dateAd ?? "",
          accountPartyName.get(sale.partyId) ?? "",
          sale.partyId,
          sale.salesAmount,
          sale.vatAmount,
          sale.totalAmount,
          sale.remarks ?? "",
          sale.createdAt,
        ]),
      ],
    },
    {
      name: "Collections",
      rows: [
        ["receiptNo", "dateBs", "dateAd", "partyName", "partyId", "bankName", "amount", "remarks", "createdAt"],
        ...collections.map((collection) => [
          collection.receiptNo ?? "",
          collection.dateBs,
          collection.dateAd ?? "",
          accountPartyName.get(collection.partyId) ?? "",
          collection.partyId,
          collection.bankName ?? "",
          collection.amount,
          collection.remarks ?? "",
          collection.createdAt,
        ]),
      ],
    },
    {
      name: "Credit Notes",
      rows: [
        ["creditNoteNo", "dateBs", "dateAd", "partyName", "partyId", "amount", "vatAmount", "totalAmount", "remarks", "createdAt"],
        ...creditNotes.map((creditNote) => [
          creditNote.creditNoteNo,
          creditNote.dateBs,
          creditNote.dateAd ?? "",
          accountPartyName.get(creditNote.partyId) ?? "",
          creditNote.partyId,
          creditNote.amount,
          creditNote.vatAmount,
          creditNote.totalAmount,
          creditNote.remarks ?? "",
          creditNote.createdAt,
        ]),
      ],
    },
    {
      name: "Receivable Outstanding",
      rows: [
        ["partyName", "openingBalance", "totalSales", "totalCollections", "totalAdjustments", "outstanding"],
        ...outstandingRows.map((row) => [
          row.partyName,
          row.openingBalance,
          row.totalSales,
          row.totalCollections,
          row.totalAdjustments,
          row.outstanding,
        ]),
      ],
    },
    {
      name: "Purchase Parties",
      rows: [
        ["name", "address", "phone", "panVatNo", "country", "category", "openingPayable", "isActive", "createdAt", "updatedAt"],
        ...purchaseData.parties.map((party) => [
          party.name,
          party.address,
          party.phone,
          party.panVatNo,
          party.country,
          party.category,
          party.openingPayable,
          party.isActive ? "yes" : "no",
          party.createdAt,
          party.updatedAt,
        ]),
      ],
    },
    {
      name: "Payable Outstanding",
      rows: [
        ["partyName", "category", "country", "openingPayable", "outstandingPayable"],
        ...payableOutstandingRows.map((party) => [
          party.name,
          party.category,
          party.country,
          party.openingPayable,
          party.openingPayable,
        ]),
      ],
    },
    {
      name: "Import Purchases",
      rows: [
        [
          "sourceDocumentId",
          "vendorName",
          "vendorBillNumber",
          "billDateAD",
          "supplierCurrency",
          "supplierExchangeRate",
          "amountIC",
          "supplierAmountNPR",
          "totalKg",
          "loadingUnloadingChargePerKg",
          "loadingUnloadingChargeNPR",
          "customAgentName",
          "pragapanpatraNumber",
          "pragapanpatraDateBS",
          "importDutyNPR",
          "customServiceNPR",
          "importVatNPR",
          "terminalChargeWithoutVatNPR",
          "terminalVatNPR",
          "freightIndiaStatus",
          "freightIndiaPartyName",
          "freightIndiaAmountIC",
          "freightIndiaAmountNPR",
          "otherChargesNPR",
          "agentServiceBillNumber",
          "agentServiceBillDateBS",
          "agentServiceAmountBeforeVatNPR",
          "agentServiceVatNPR",
          "debitNoteTotalNPR",
          "totalAgentPayableNPR",
          "landedCostNPR",
          "remarks",
          "createdAt",
          "updatedAt",
        ],
        ...purchaseData.purchases.map((purchase) => [
          purchase.id,
          purchasePartyName.get(purchase.vendorPartyId) ?? "",
          purchase.vendorBillNumber,
          purchase.billDate,
          purchase.supplierCurrency,
          purchase.supplierExchangeRate,
          purchase.amountIC,
          purchase.supplierAmountNPR,
          purchase.totalKg,
          purchase.loadingUnloadingChargePerKg,
          purchase.loadingUnloadingChargeNPR,
          purchasePartyName.get(purchase.customAgentPartyId) ?? "",
          purchase.debitNoteNumber,
          purchase.debitNoteDate,
          purchase.importDutyNPR,
          purchase.customServiceNPR,
          purchase.importVatNPR,
          purchase.terminalChargeWithoutVatNPR,
          purchase.terminalVatNPR,
          purchase.freightIndiaStatus,
          purchasePartyName.get(purchase.freightIndiaPartyId) ?? "",
          purchase.freightIndiaAmountIC,
          purchase.freightIndiaAmountNPR,
          purchase.otherChargesNPR,
          purchase.agentServiceBillNumber,
          purchase.agentServiceBillDate,
          purchase.agentServiceAmountBeforeVatNPR,
          purchase.agentServiceVatNPR,
          purchase.debitNoteTotalNPR,
          purchase.totalAgentPayableNPR,
          purchase.landedCostNPR,
          purchase.remarks,
          purchase.createdAt,
          purchase.updatedAt,
        ]),
      ],
    },
    {
      name: "Local Purchases",
      rows: [
        ["partyName", "billNumber", "billDate", "expenseType", "expenseHead", "amountBeforeVatNPR", "vatNPR", "totalAmountNPR", "remarks", "createdAt", "updatedAt"],
        ...purchaseData.localExpenses.map((expense) => [
          purchasePartyName.get(expense.partyId) ?? "",
          expense.billNumber,
          expense.billDate,
          expense.expenseType,
          expense.expenseHead,
          expense.amountBeforeVatNPR,
          expense.vatNPR,
          expense.totalAmountNPR,
          expense.remarks,
          expense.createdAt,
          expense.updatedAt,
        ]),
      ],
    },
    {
      name: "Payments",
      rows: [
        ["partyName", "paymentDate", "paymentType", "currency", "amount", "exchangeRate", "amountNPR", "paymentMethod", "referenceNumber", "remarks", "createdAt", "updatedAt"],
        ...purchaseData.payments.map((payment) => [
          purchasePartyName.get(payment.partyId) ?? "",
          payment.paymentDate,
          payment.paymentType,
          payment.currency,
          payment.amount,
          payment.exchangeRate,
          payment.amountNPR,
          payment.paymentMethod,
          payment.referenceNumber,
          payment.remarks,
          payment.createdAt,
          payment.updatedAt,
        ]),
      ],
    },
    {
      name: "Account Activity Logs",
      rows: [
        ["action", "detail", "createdAt"],
        ...accountActivityLogs.map((log) => [log.action, log.detail, log.createdAt]),
      ],
    },
    {
      name: "Purchase Activity Logs",
      rows: [
        ["action", "details", "userName", "oldValue", "newValue", "createdAt"],
        ...purchaseData.activityLogs.map((log) => [
          log.action,
          log.details,
          log.userName,
          log.oldValue,
          log.newValue,
          log.createdAt,
        ]),
      ],
    },
    {
      name: "Stock Item Master",
      rows: [
        ["Item code", "Item name", "Unit", "Reorder level", "Active status", "Opening quantity", "Opening rate", "Opening value"],
        ...stockData.items.map((item) => [
          item.code,
          item.name,
          item.unit,
          item.reorderLevel,
          item.isActive ? "Active" : "Inactive",
          item.openingQty,
          item.openingRate,
          Number((item.openingQty * item.openingRate).toFixed(2)),
        ]),
      ],
    },
    {
      name: "Stock Purchase Lines",
      rows: [
        ["Source type", "Source document ID", "Bill number", "Transaction date", "Item code", "Item name", "Quantity", "Entry amount", "Stock valuation amount", "Rate", "Fiscal year", "Company"],
        ...stockPurchaseBills.flatMap((bill) =>
          bill.items.map((line) => {
            const item = stockItemById.get(line.itemId);
            return [
              bill.sourceType ?? (bill.source === "Importation" ? "Import Purchase" : "Local Purchase"),
              bill.id,
              bill.billNo,
              bill.dateBs,
              item?.code ?? "",
              item?.name ?? "",
              line.quantity,
              line.entryAmount ?? line.amount,
              line.amount,
              line.rate,
              company.fiscalYear,
              company.name,
            ];
          }),
        ),
      ],
    },
    {
      name: "Stock Sales Lines",
      rows: [
        ["Source type", "Source document ID", "Bill number", "Transaction date", "Item code", "Item name", "Quantity", "Rate", "Value", "Fiscal year", "Company"],
        ...stockSalesBills.flatMap((bill) =>
          bill.items.map((line) => {
            const item = stockItemById.get(line.itemId);
            return [
              "Sale",
              bill.id,
              bill.billNo,
              bill.dateBs,
              item?.code ?? "",
              item?.name ?? "",
              line.quantity,
              line.rate,
              line.amount,
              company.fiscalYear,
              company.name,
            ];
          }),
        ),
      ],
    },
    {
      name: "Stock Summary",
      rows: [
        ["Item code", "Item name", "Opening quantity", "Purchase quantity", "Sales quantity", "Closing quantity", "Average rate", "Closing value", "Reorder status"],
        ...stockRows.map((row) => [
          row.code,
          row.name,
          row.openingQty,
          row.localPurchaseQty + row.importationQty,
          row.salesQty,
          row.closingQty,
          row.averageRate,
          row.closingValue,
          row.closingQty <= row.reorderLevel ? "Below reorder" : "OK",
        ]),
      ],
    },
    {
      name: "Stock Register",
      rows: [
        ["Date", "Source type", "Source document", "Item code", "Item name", "Quantity in", "Quantity out", "Running quantity", "Rate", "Value"],
        ...stockRegisterRows.map((row) => [
          row.date,
          row.receivedQty ? "Purchase/Opening" : "Sale",
          row.particulars,
          row.code,
          row.itemName,
          row.receivedQty,
          row.issuedQty,
          row.balanceQty,
          row.receivedQty ? row.receivedRate : row.issuedRate,
          row.receivedQty ? row.receivedAmount : row.issuedAmount,
        ]),
      ],
    },
    {
      name: "Inventory Valuation",
      rows: [
        ["Item code", "Item name", "Closing quantity", "Valuation rate", "Closing value"],
        ...stockRows.map((row) => [
          row.code,
          row.name,
          row.closingQty,
          row.averageRate,
          row.closingValue,
        ]),
      ],
    },
    {
      name: "Opening Stock",
      rows: [
        ["Item code", "Item name", "Unit", "Opening quantity", "Opening rate", "Opening value", "Fiscal year", "Company"],
        ...stockData.items.map((item) => [
          item.code,
          item.name,
          item.unit,
          item.openingQty,
          item.openingRate,
          Number((item.openingQty * item.openingRate).toFixed(2)),
          company.fiscalYear,
          company.name,
        ]),
      ],
    },
  ];
  const filename = `${safePdfFilename(`${company.name}-${company.fiscalYear || "fy"}-complete-data`)}.xls`;
  await saveBlob(filename, new Blob([buildExcelXml(sheets)], { type: "application/vnd.ms-excel;charset=utf-8" }), {
    description: "Excel Workbook",
    mimeType: "application/vnd.ms-excel",
    extensions: [".xls"],
  });
  });
}

function buildExcelXml(sheets: WorkbookSheet[]) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
</Styles>
${sheets.map(buildExcelSheet).join("")}
</Workbook>`;
}

function buildExcelSheet(sheet: WorkbookSheet) {
  return `<Worksheet ss:Name="${excelXml(sheet.name.slice(0, 31))}"><Table>
${sheet.rows
  .map((row, rowIndex) => `<Row>${row.map((cell) => excelCell(cell, rowIndex === 0)).join("")}</Row>`)
  .join("")}
</Table></Worksheet>`;
}

function excelCell(value: string | number | boolean, isHeader: boolean) {
  const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
  return `<Cell${isHeader ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${type}">${excelXml(value)}</Data></Cell>`;
}

function excelXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type PortableCompanyBackup = {
  accounts: AccountsBackupData;
  company: CompanyProfile;
  exportedAt: string;
  kind: "easysolution-company-backup";
  purchase: AppData;
  stock?: {
    data: StockBackupData;
    trackInventory: boolean;
  };
  version: 1 | 2;
};

type PortableCompanyGroupBackup = {
  companies: PortableCompanyBackup[];
  exportedAt: string;
  kind: "easysolution-company-group-backup";
  version: 1;
};

async function buildPortableCompanyBackup(company: CompanyProfile): Promise<PortableCompanyBackup> {
  return withActiveCompany(company.id, async () => {
    const [accounts, purchaseRepository, stockData] = await Promise.all([
      getAccountsBackupData(),
      createDataRepository(),
      getStockBackupDataForCompany(company.id),
    ]);
    const purchase = await purchaseRepository.loadData();
    const backup: PortableCompanyBackup = {
      accounts,
      company,
      exportedAt: new Date().toISOString(),
      kind: "easysolution-company-backup",
      purchase: {
        ...purchase,
        settings: {
          ...purchase.settings,
          companyName: company.name,
          fiscalYear: company.fiscalYear,
        },
      },
      stock: {
        data: stockData,
        trackInventory: isInventoryTrackingEnabledForCompany(company.id),
      },
      version: 2,
    };

    return backup;
  });
}

async function downloadPortableCompanyBackup(company: CompanyProfile) {
  const backup = await buildPortableCompanyBackup(company);

  await withActiveCompany(company.id, async () => {
    const filename = `${safePdfFilename(`${company.name}-${company.fiscalYear || "fy"}-backup`)}.easysolution-backup.json`;
    await saveBlob(filename, new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), {
      description: "Easysolution Backup",
      mimeType: "application/json",
      extensions: [".json"],
    });
  });
}

async function downloadPortableCompanyGroupBackup(company: CompanyProfile) {
  const companies = getLinkedCompanyGroup(company)
    .sort((left, right) => fiscalYearSortValue(left.fiscalYear) - fiscalYearSortValue(right.fiscalYear));
  const backups: PortableCompanyBackup[] = [];

  for (const linkedCompany of companies) {
    backups.push(await buildPortableCompanyBackup(linkedCompany));
  }

  const backup: PortableCompanyGroupBackup = {
    companies: backups,
    exportedAt: new Date().toISOString(),
    kind: "easysolution-company-group-backup",
    version: 1,
  };
  const filename = `${safePdfFilename(`${company.name}-full-company-backup`)}.easysolution-company-backup.json`;
  await saveBlob(filename, new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), {
    description: "Easysolution Full Company Backup",
    mimeType: "application/json",
    extensions: [".json"],
  });
}

function isPortableCompanyBackup(value: unknown): value is PortableCompanyBackup {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<PortableCompanyBackup>;
  return row.kind === "easysolution-company-backup" && Boolean(row.company) && Boolean(row.accounts) && Boolean(row.purchase);
}

function isPortableCompanyGroupBackup(value: unknown): value is PortableCompanyGroupBackup {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<PortableCompanyGroupBackup>;
  return row.kind === "easysolution-company-group-backup" && Array.isArray(row.companies);
}

function remapAccountsBackupFiscalYears(
  data: AccountsBackupData,
  remapFiscalYearId: (fiscalYearId: string) => string,
): AccountsBackupData {
  const remapSale = (sale: Sale): Sale => ({
    ...sale,
    fiscalYearId: sale.fiscalYearId ? remapFiscalYearId(sale.fiscalYearId) : sale.fiscalYearId,
  });
  const remapCollection = (collection: Collection): Collection => ({
    ...collection,
    fiscalYearId: collection.fiscalYearId ? remapFiscalYearId(collection.fiscalYearId) : collection.fiscalYearId,
  });
  const remapCreditNote = (creditNote: CreditNote): CreditNote => ({
    ...creditNote,
    fiscalYearId: creditNote.fiscalYearId ? remapFiscalYearId(creditNote.fiscalYearId) : creditNote.fiscalYearId,
  });

  return {
    ...data,
    collections: data.collections.map(remapCollection),
    creditNotes: data.creditNotes.map(remapCreditNote),
    sales: data.sales.map(remapSale),
  };
}

type ImportCompanyBackupOptions = {
  linkAdjacent?: boolean;
  preserveIdentity?: boolean;
};

async function importPortableCompanyBackupData(
  parsed: PortableCompanyBackup,
  options: ImportCompanyBackupOptions = {},
) {
  const backupVersion = Number(parsed.version || 1);
  if (!Number.isFinite(backupVersion) || backupVersion < 1 || backupVersion > 2) {
    throw new Error(`Unsupported Easysolution backup version ${parsed.version}.`);
  }

  if (backupVersion >= 2 && !parsed.stock) {
    throw new Error("This backup version requires a stock section, but none was found.");
  }

  const sourceCompany = parsed.company;
  const shouldRestoreLocked = Boolean(sourceCompany.isLocked);
  const settings = {
    ...defaultSettings,
    ...parsed.purchase.settings,
    companyName: sourceCompany.name,
    fiscalYear: sourceCompany.fiscalYear,
  };
  const companyId = options.preserveIdentity ? sourceCompany.id : createCompanyYearId(sourceCompany.name, sourceCompany.fiscalYear);
  const existingProfile = getCompanyProfiles().find((company) => company.id === companyId);
  const previousActiveCompanyId = getActiveCompanyId();
  const adjacentLink = options.linkAdjacent
    ? resolveAdjacentFiscalYearLink(sourceCompany, companyId)
    : { accepted: false, companyGroupId: options.preserveIdentity ? sourceCompany.companyGroupId : companyId, nextCompanyId: "", previousCompanyId: "" };
  const companyGroupId = options.preserveIdentity
    ? sourceCompany.companyGroupId || companyId
    : adjacentLink.companyGroupId || companyId;
  const profile = upsertCompanyProfile({
    companyGroupId,
    createdAt: sourceCompany.createdAt,
    fiscalYear: sourceCompany.fiscalYear,
    id: companyId,
    isLocked: false,
    lastCarryForwardAt: "",
    lockedAt: "",
    name: sourceCompany.name,
    nextCompanyId: options.preserveIdentity ? sourceCompany.nextCompanyId : adjacentLink.nextCompanyId,
    previousCompanyId: options.preserveIdentity ? sourceCompany.previousCompanyId : adjacentLink.previousCompanyId,
  });

  const emptyPurchaseData = getEmptyData();
  const importedFiscalYears = parsed.purchase.fiscalYears ?? [];
  const fallbackFiscalYear = createFiscalYearFromCode(
    profile.id,
    settings.fiscalYear,
    shouldRestoreLocked ? "CLOSED" : "OPEN",
  );
  const fiscalYearIdMap = new Map<string, string>();
  const fiscalYears = importedFiscalYears.length
    ? importedFiscalYears.map((fiscalYear) => {
        const status =
          fiscalYear.status === "CLOSED" || fiscalYear.status === "SOFT_CLOSED" || fiscalYear.status === "OPEN"
            ? fiscalYear.status
            : profile.isLocked
              ? "CLOSED"
              : "OPEN";
        const nextFiscalYear = {
          ...createFiscalYearFromCode(profile.id, fiscalYear.code || settings.fiscalYear, status),
          startBs: fiscalYear.startBs || fallbackFiscalYear.startBs,
          endBs: fiscalYear.endBs || fallbackFiscalYear.endBs,
          startAd: fiscalYear.startAd,
          endAd: fiscalYear.endAd,
          createdAt: fiscalYear.createdAt || fallbackFiscalYear.createdAt,
          updatedAt: new Date().toISOString(),
        };
        fiscalYearIdMap.set(fiscalYear.id, nextFiscalYear.id);
        return nextFiscalYear;
      })
    : [fallbackFiscalYear];
  const defaultFiscalYearId = fiscalYears[0]?.id ?? fallbackFiscalYear.id;
  const remapFiscalYearId = (fiscalYearId: string) =>
    fiscalYearIdMap.get(fiscalYearId) ?? defaultFiscalYearId;
  const restoredAccountsData = remapAccountsBackupFiscalYears(parsed.accounts, remapFiscalYearId);

  try {
    setActiveCompanyId(profile.id);
    writeSuiteSettings(settings);
    localStorage.setItem(COMPANY_SETUP_KEY, "yes");
    await restoreAccountsBackupData(restoredAccountsData, { fiscalYears });

    const purchaseRepository = await createDataRepository();
    const restoredPurchaseData: AppData = {
      ...emptyPurchaseData,
      ...parsed.purchase,
      settings,
      parties: parsed.purchase.parties ?? [],
      fiscalYears,
      purchases: (parsed.purchase.purchases ?? []).map((purchase) => ({
        ...purchase,
        fiscalYearId: remapFiscalYearId(purchase.fiscalYearId),
      })),
      localExpenses: (parsed.purchase.localExpenses ?? []).map((localExpense) => ({
        ...localExpense,
        fiscalYearId: remapFiscalYearId(localExpense.fiscalYearId),
      })),
      payments: (parsed.purchase.payments ?? []).map((payment) => ({
        ...payment,
        fiscalYearId: remapFiscalYearId(payment.fiscalYearId),
      })),
      paymentAllocations: parsed.purchase.paymentAllocations ?? [],
      ledgerEntries: (parsed.purchase.ledgerEntries ?? []).map((entry) => ({
        ...entry,
        companyId: profile.id,
        fiscalYearId: remapFiscalYearId(entry.fiscalYearId),
      })),
      activityLogs: [
        {
          id: crypto.randomUUID(),
          action: "Backup Imported",
          details: `Imported portable backup from ${parsed.exportedAt || "unknown date"}.`,
          userName: "Master",
          oldValue: sourceCompany.id,
          newValue: profile.id,
          createdAt: new Date().toISOString(),
        },
        ...(parsed.purchase.activityLogs ?? []),
      ],
    };
    await purchaseRepository.saveData(restoredPurchaseData);

    if (parsed.stock) {
      await replaceStockBackupDataForCompany(profile.id, parsed.stock.data);
      writeInventoryTrackingSettingForCompany(profile.id, parsed.stock.trackInventory);
    }

    if (!options.preserveIdentity && adjacentLink.accepted) {
      linkAdjacentProfiles(profile, adjacentLink);
    }
  } catch (error) {
    if (existingProfile) {
      upsertCompanyProfile(existingProfile);
    } else {
      removeCompanyProfile(companyId);
    }
    setActiveCompanyId(previousActiveCompanyId);
    throw error;
  }

  if (shouldRestoreLocked) {
    return upsertCompanyProfile({
      ...profile,
      isLocked: true,
      lockedAt: sourceCompany.lockedAt || new Date().toISOString(),
    });
  }

  return profile;
}

async function importPortableCompanyGroupBackup(parsed: PortableCompanyGroupBackup) {
  const backups = parsed.companies.filter(isPortableCompanyBackup);

  if (!backups.length) {
    throw new Error("This full company backup does not contain any fiscal-year backups.");
  }

  const existingIds = new Set(getCompanyProfiles().map((company) => company.id));
  const conflictingIds = backups.map((backup) => backup.company.id).filter((id) => existingIds.has(id));

  if (conflictingIds.length > 0 && !window.confirm(
    `This full company backup will replace ${conflictingIds.length} existing fiscal year(s) with the same identity.\n\nContinue?`
  )) {
    throw new Error("Full company import cancelled.");
  }

  let firstImported: CompanyProfile | null = null;

  for (const backup of backups) {
    const imported = await importPortableCompanyBackupData(backup, { preserveIdentity: true });
    firstImported = firstImported ?? imported;
  }

  backups.forEach((backup) => {
    const company = backup.company;
    upsertCompanyProfile({
      ...company,
      companyGroupId: company.companyGroupId || firstImported?.companyGroupId || company.id,
    });
  });

  return firstImported ?? getCompanyProfiles()[0];
}

async function importPortableBackupFile(file: File) {
  const parsed = JSON.parse(await file.text()) as unknown;

  if (isPortableCompanyGroupBackup(parsed)) {
    return importPortableCompanyGroupBackup(parsed);
  }

  if (isPortableCompanyBackup(parsed)) {
    return importPortableCompanyBackupData(parsed, { linkAdjacent: true });
  }

  throw new Error("This is not a valid Easysolution backup file.");
}

type AdjacentFiscalYearLink = {
  accepted: boolean;
  companyGroupId: string;
  nextCompanyId: string;
  previousCompanyId: string;
};

function fiscalYearSortValue(fiscalYear: string) {
  const match = fiscalYear.trim().match(/^(\d{4})\s*\/\s*(\d{2})$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function fiscalYearCodeOffset(fiscalYear: string, offset: number) {
  const match = fiscalYear.trim().match(/^(\d{4})\s*\/\s*(\d{2})$/);

  if (!match) {
    return "";
  }

  const startYear = Number(match[1]) + offset;
  const endYear = (Number(match[2]) + offset + 100) % 100;
  return `${startYear}/${String(endYear).padStart(2, "0")}`;
}

function getLinkedCompanyGroup(company: CompanyProfile) {
  const profiles = getCompanyProfiles();
  const groupId = company.companyGroupId || company.id;
  const linkedIds = new Set<string>([company.id]);
  let changed = true;

  while (changed) {
    changed = false;
    profiles.forEach((profile) => {
      const directlyLinked =
        profile.companyGroupId === groupId ||
        linkedIds.has(profile.id) ||
        linkedIds.has(profile.previousCompanyId) ||
        linkedIds.has(profile.nextCompanyId);

      if (directlyLinked && !linkedIds.has(profile.id)) {
        linkedIds.add(profile.id);
        changed = true;
      }
    });
  }

  return profiles.filter((profile) => linkedIds.has(profile.id));
}

function resolveAdjacentFiscalYearLink(sourceCompany: CompanyProfile, importCompanyId: string): AdjacentFiscalYearLink {
  const profiles = getCompanyProfiles().filter((profile) => profile.id !== importCompanyId);
  const previousFiscalYear = fiscalYearCodeOffset(sourceCompany.fiscalYear, -1);
  const nextFiscalYear = fiscalYearCodeOffset(sourceCompany.fiscalYear, 1);
  const sameCompanyName = (profile: CompanyProfile) =>
    profile.name.trim().toLowerCase() === sourceCompany.name.trim().toLowerCase();
  const previousCompany = profiles.find((profile) => sameCompanyName(profile) && profile.fiscalYear === previousFiscalYear);
  const nextCompany = profiles.find((profile) => sameCompanyName(profile) && profile.fiscalYear === nextFiscalYear);

  if (!previousCompany && !nextCompany) {
    return {
      accepted: false,
      companyGroupId: importCompanyId,
      nextCompanyId: "",
      previousCompanyId: "",
    };
  }

  const linkTargets = [
    previousCompany ? `previous FY ${previousCompany.fiscalYear}` : "",
    nextCompany ? `next FY ${nextCompany.fiscalYear}` : "",
  ].filter(Boolean).join(" and ");
  const accepted = window.confirm(
    `This backup looks adjacent to ${linkTargets} for ${sourceCompany.name}.\n\nLink the fiscal years after import?`
  );

  if (!accepted) {
    return {
      accepted: false,
      companyGroupId: importCompanyId,
      nextCompanyId: "",
      previousCompanyId: "",
    };
  }

  return {
    accepted: true,
    companyGroupId: previousCompany?.companyGroupId || nextCompany?.companyGroupId || importCompanyId,
    nextCompanyId: nextCompany?.id ?? "",
    previousCompanyId: previousCompany?.id ?? "",
  };
}

function linkAdjacentProfiles(importedProfile: CompanyProfile, link: AdjacentFiscalYearLink) {
  const profiles = getCompanyProfiles();
  const previousCompany = profiles.find((profile) => profile.id === link.previousCompanyId);
  const nextCompany = profiles.find((profile) => profile.id === link.nextCompanyId);

  if (previousCompany) {
    upsertCompanyProfile({
      ...previousCompany,
      companyGroupId: link.companyGroupId,
      nextCompanyId: importedProfile.id,
    });
  }

  if (nextCompany) {
    upsertCompanyProfile({
      ...nextCompany,
      companyGroupId: link.companyGroupId,
      previousCompanyId: importedProfile.id,
    });
  }
}

type CompanyDeleteScope = "fiscal-year" | "company-group";

const emptyAccountsBackupData: AccountsBackupData = {
  activityLogs: [],
  collections: [],
  creditNotes: [],
  parties: [],
  receiptAllocations: [],
  sales: [],
};

const emptyStockBackupData: StockBackupData = {
  items: [],
  purchaseBills: [],
  salesBills: [],
};

async function clearCompanyData(company: CompanyProfile) {
  const originalProfile = getCompanyProfile(company.id) ?? company;

  upsertCompanyProfile({
    ...originalProfile,
    isLocked: false,
    lockedAt: "",
  });

  try {
    await withActiveCompany(company.id, async () => {
      await restoreAccountsBackupData(emptyAccountsBackupData, { fiscalYears: [] });
      const repository = await createDataRepository();
      await repository.saveData(getEmptyData());
      await replaceStockBackupDataForCompany(company.id, emptyStockBackupData);
      writeInventoryTrackingSettingForCompany(company.id, false);
    });
  } catch (error) {
    upsertCompanyProfile(originalProfile);
    throw error;
  }
}

async function deleteCompanyProfiles(company: CompanyProfile, scope: CompanyDeleteScope) {
  const targetCompanies = scope === "company-group" ? getLinkedCompanyGroup(company) : [company];
  const targetIds = new Set(targetCompanies.map((profile) => profile.id));

  for (const targetCompany of targetCompanies) {
    await clearCompanyData(targetCompany);
    removeCompanyScopedSettings(targetCompany.id);
  }

  const remainingProfiles = getCompanyProfiles()
    .filter((profile) => !targetIds.has(profile.id))
    .map((profile) => ({
      ...profile,
      nextCompanyId: targetIds.has(profile.nextCompanyId) ? "" : profile.nextCompanyId,
      previousCompanyId: targetIds.has(profile.previousCompanyId) ? "" : profile.previousCompanyId,
    }));

  saveCompanyProfiles(remainingProfiles);
  setActiveCompanyId(resolveActiveCompanyId(remainingProfiles, getActiveCompanyId()));
  return targetCompanies;
}

export default function App() {
  const [companies, setCompanies] = useState<CompanyProfile[]>(() => ensureInitialCompanyProfiles());
  const [activeCompanyIdState, setActiveCompanyIdState] = useState(() => getActiveCompanyId());
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleKey | null>(null);
  const [stockEntryTarget, setStockEntryTarget] = useState<StockEntryTarget | null>(null);
  const [trackInventory, setTrackInventory] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const suiteSettings = readSuiteSettings();
  const activeCompany = companies.find((company) => company.id === activeCompanyIdState) ?? null;
  const companyDisplayName = activeCompany?.name || suiteSettings.companyName || "Easysolution";
  const companyFiscalYear = activeCompany?.fiscalYear || suiteSettings.fiscalYear || "";
  const activeFiscalYear = activeCompany
    ? createFiscalYearFromCode(activeCompany.id, activeCompany.fiscalYear || suiteSettings.fiscalYear || "")
    : null;

  useEffect(() => {
    setStockEntryTarget(null);
    setTrackInventory(Boolean(activeCompanyIdState) && isInventoryTrackingEnabled());
  }, [activeCompanyIdState, companyFiscalYear]);

  useEffect(() => {
    if (activeCompanyIdState && getActiveCompanyId() !== activeCompanyIdState) {
      setActiveCompanyId(activeCompanyIdState);
    }
  }, [activeCompanyIdState]);

  useEffect(() => {
    scrollToPageTop();
  }, [activeCompanyIdState, isAddingCompany, selectedModule, userRole]);

  function navigateToModule(nextModule: ModuleKey | null) {
    setSelectedModule(nextModule);
    scrollToPageTop();
  }

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let active = true;

    invoke<string>("read_company_seed")
      .then((seedText) => {
        if (!active) {
          return;
        }

        const parsedSeed = JSON.parse(seedText || "[]") as unknown;
        const rawSeedProfiles = Array.isArray(parsedSeed) ? parsedSeed : [];
        const seededProfiles = parseCompanyProfiles(seedText || "[]");
        if (seededProfiles.length === 0) {
          return;
        }

        const persistedProfiles = getCompanyProfiles();
        const mergedProfiles = mergeCompanyProfiles(persistedProfiles, seededProfiles);
        saveCompanyProfiles(mergedProfiles);
        rawSeedProfiles.forEach((profile) => {
          if (
            profile &&
            typeof profile === "object" &&
            (profile as Partial<CompanyProfile> & { trackInventory?: unknown }).id &&
            (profile as Partial<CompanyProfile> & { trackInventory?: unknown }).trackInventory
          ) {
            writeInventoryTrackingSettingForCompany(String((profile as Partial<CompanyProfile>).id), true);
          }
        });

        const resolvedActiveCompanyId = resolveActiveCompanyId(
          mergedProfiles,
          window.localStorage.getItem("suite-active-company-id") ?? "",
        );
        setActiveCompanyId(resolvedActiveCompanyId);
        setActiveCompanyIdState(resolvedActiveCompanyId);
        setCompanies(mergedProfiles);
      })
      .catch((error) => {
        console.error("Company seed load error:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  function refreshCompanies() {
    const profiles = getCompanyProfiles();
    setCompanies(profiles);
    setActiveCompanyIdState((currentCompanyId) => {
      if (currentCompanyId && profiles.some((company) => company.id === currentCompanyId)) {
        return currentCompanyId;
      }

      return getActiveCompanyId() || profiles[0]?.id || "";
    });
  }

  function activateCompany(companyId: string) {
    setActiveCompanyId(companyId);
    setActiveCompanyIdState(companyId);
    navigateToModule(null);
    setStockEntryTarget(null);
    setMasterPassword("");
    setLoginError("");
    setIsAddingCompany(false);
  }

  function openCompanySelection() {
    refreshCompanies();
    setActiveCompanyId("");
    setActiveCompanyIdState("");
    navigateToModule(null);
    setStockEntryTarget(null);
    setExportMessage("");
    setIsAddingCompany(false);
  }

  async function exportSelectedCompanyWorkbook() {
    if (!activeCompany || userRole !== "master") {
      return;
    }

    setIsExporting(true);
    setExportMessage("");

    try {
      await downloadCompanyWorkbook(activeCompany);
      setExportMessage(`Exported workbook for ${activeCompany.name}${activeCompany.fiscalYear ? ` FY ${activeCompany.fiscalYear}` : ""}.`);
    } catch (error) {
      console.error("Company export error:", error);
      setExportMessage(error instanceof Error ? error.message : String(error || "Could not export workbook."));
    } finally {
      setIsExporting(false);
    }
  }

  async function backupSelectedCompany() {
    if (!activeCompany || userRole !== "master") {
      return;
    }

    setIsBackingUp(true);
    setExportMessage("");

    try {
      await downloadPortableCompanyBackup(activeCompany);
      setExportMessage(`Backup file created for ${activeCompany.name}${activeCompany.fiscalYear ? ` FY ${activeCompany.fiscalYear}` : ""}.`);
    } catch (error) {
      console.error("Manual backup error:", error);
      setExportMessage(error instanceof Error ? error.message : String(error || "Could not create backup."));
    } finally {
      setIsBackingUp(false);
    }
  }

  async function backupSelectedCompanyGroup() {
    if (!activeCompany || userRole !== "master") {
      return;
    }

    setIsBackingUp(true);
    setExportMessage("");

    try {
      await downloadPortableCompanyGroupBackup(activeCompany);
      setExportMessage(`Full company backup created for ${activeCompany.name}.`);
    } catch (error) {
      console.error("Full company backup error:", error);
      setExportMessage(error instanceof Error ? error.message : String(error || "Could not create full company backup."));
    } finally {
      setIsBackingUp(false);
    }
  }

  async function importBackupFile(file: File) {
    setExportMessage("");

    try {
      const profile = await importPortableBackupFile(file);
      refreshCompanies();
      activateCompany(profile.id);
      setExportMessage(`Imported backup as ${profile.name}${profile.fiscalYear ? ` FY ${profile.fiscalYear}` : ""}.`);
    } catch (error) {
      console.error("Portable backup import error:", error);
      setExportMessage(error instanceof Error ? error.message : String(error || "Could not import backup."));
    }
  }

  async function deleteActiveCompany(scope: CompanyDeleteScope) {
    if (!activeCompany || userRole !== "master") {
      return;
    }

    const deletedCompanies = await deleteCompanyProfiles(activeCompany, scope);
    const profiles = getCompanyProfiles();
    const nextActiveCompanyId = getActiveCompanyId() || profiles[0]?.id || "";

    setCompanies(profiles);
    setActiveCompanyIdState(nextActiveCompanyId);
    setTrackInventory(Boolean(nextActiveCompanyId) && isInventoryTrackingEnabled());
    setStockEntryTarget(null);
    navigateToModule(null);
    setExportMessage(
      scope === "company-group"
        ? `Deleted ${deletedCompanies.length} linked fiscal year(s) for ${activeCompany.name}.`
        : `Deleted ${activeCompany.name}${activeCompany.fiscalYear ? ` FY ${activeCompany.fiscalYear}` : ""}.`
    );
  }

  async function syncLinkedOpeningIfNeeded(company: CompanyProfile | null) {
    if (!company?.nextCompanyId) {
      return;
    }

    const profiles = getCompanyProfiles();
    const targetCompany = profiles.find((profile) => profile.id === company.nextCompanyId);

    if (!targetCompany) {
      return;
    }

    try {
      const activeCompanyIdBeforeSync = getActiveCompanyId();
      await carryForwardOpenings(company, targetCompany);
      upsertCompanyProfile({
        ...company,
        lastCarryForwardAt: new Date().toISOString(),
      });
      const profiles = getCompanyProfiles();
      setCompanies(profiles);
      setActiveCompanyId(resolveActiveCompanyId(profiles, activeCompanyIdBeforeSync));
      setActiveCompanyIdState(resolveActiveCompanyId(profiles, activeCompanyIdBeforeSync));
      setExportMessage(`Linked opening balances updated in FY ${targetCompany.fiscalYear}.`);
    } catch (error) {
      console.error("Linked opening sync error:", error);
      setExportMessage(error instanceof Error ? error.message : String(error || "Could not update linked opening balances."));
    }
  }

  function backToModulesAfterWork() {
    const company = activeCompany;
    navigateToModule(null);
    void syncLinkedOpeningIfNeeded(company);
  }

  function logoutAfterWork() {
    const company = activeCompany;
    logout();
    void syncLinkedOpeningIfNeeded(company);
  }

  async function createCompany(settings: AppSettings, nextTrackInventory = false) {
    const companyId = createCompanyYearId(settings.companyName, settings.fiscalYear);
    const profile = upsertCompanyProfile({
      companyGroupId: companyId,
      id: companyId,
      name: settings.companyName,
      fiscalYear: settings.fiscalYear,
    });
    setActiveCompanyId(companyId);
    setActiveCompanyIdState(companyId);
    writeSuiteSettings(settings);
    writeInventoryTrackingSetting(nextTrackInventory);
    setTrackInventory(nextTrackInventory);
    localStorage.setItem(COMPANY_SETUP_KEY, "yes");

    try {
      const repository = await createDataRepository();
      const currentData = await repository.loadData();
      await repository.saveData({ ...currentData, settings });
    } catch (error) {
      console.error("Initial company setup save error:", error);
    }

    setCompanies(getCompanyProfiles());
    setIsAddingCompany(false);
    navigateToModule(null);
    setStockEntryTarget(null);
    return profile;
  }

  function loginAsAccount() {
    setLoginError("");
    setMasterPassword("");
    refreshCompanies();
    setUserRole("account");
    setActiveCompanyId("");
    setActiveCompanyIdState("");
    navigateToModule(null);
    setStockEntryTarget(null);
  }

  function loginAsMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    if (masterPassword !== MASTER_PASSWORD) {
      setLoginError("Master password is incorrect.");
      return;
    }

    setMasterPassword("");
    refreshCompanies();
    setUserRole("master");
    setActiveCompanyId("");
    setActiveCompanyIdState("");
    navigateToModule(null);
    setStockEntryTarget(null);
  }

  function logout() {
    setUserRole(null);
    navigateToModule(null);
    setActiveCompanyId("");
    setActiveCompanyIdState("");
    setStockEntryTarget(null);
    setMasterPassword("");
    setLoginError("");
  }

  function openStockLineEntry(target: StockEntryTarget) {
    if (!activeCompany || !activeFiscalYear || !trackInventory) {
      return;
    }

    if (target.companyId && target.companyId !== activeCompany.id) {
      setExportMessage("Inventory entry belongs to another company and was not opened.");
      return;
    }

    if (target.fiscalYearId && target.fiscalYearId !== activeFiscalYear.id) {
      setExportMessage("Inventory entry belongs to another fiscal year and was not opened.");
      return;
    }

    setExportMessage("");
    setStockEntryTarget({
      ...target,
      companyId: activeCompany.id,
      fiscalYear: target.fiscalYear || activeCompany.fiscalYear,
      fiscalYearId: activeFiscalYear.id,
      readOnly: Boolean(target.readOnly || activeCompany.isLocked),
    });
    navigateToModule("stock");
  }

  if (!userRole) {
    return (
      <main className="merged-login-page">
        <section className="merged-login-brand">
          <p className="company-name-display">Easysolution</p>
          <h1>Easysolution</h1>
          <p>
            One login for sales and receivables, import purchases, payments,
            payables, VAT, ledgers, and activity logs.
          </p>
          <p className="login-credit">Vibecoded by Kanchan Dahal</p>
        </section>

        <section className="merged-login-card">
          <p className="eyebrow">Secure access</p>
          <h2>Select user</h2>
          <p className="login-note">
            Continue as Account for daily entries, or unlock Master for imports,
            edits, deletes, settings, and audit logs.
          </p>

          {loginError && <p className="status-message">{loginError}</p>}

          <div className="login-actions">
            <button type="button" onClick={loginAsAccount}>
              Continue as Account
            </button>

            <form className="login-form" onSubmit={loginAsMaster}>
              <label>
                Master Password
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                />
              </label>
              <button type="submit">Unlock Master</button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (isAddingCompany && userRole === "master") {
    return (
      <CompanySetup
        existingCompanyNames={companies.map((company) => `${company.name.toLowerCase()}|${company.fiscalYear}`)}
        onBack={() => setIsAddingCompany(false)}
        onComplete={createCompany}
      />
    );
  }

  if (!activeCompany) {
    return (
      <CompanySelector
        companies={companies}
        message={exportMessage}
        userRole={userRole}
        onAddCompany={() => setIsAddingCompany(true)}
        onImportBackup={importBackupFile}
        onSelectCompany={activateCompany}
      />
    );
  }

  if (!selectedModule) {
    return (
      <main className={activeCompany.isLocked ? "module-picker-page closed-year-page" : "module-picker-page"}>
        <header className="module-picker-header">
          <div>
            <p className="company-name-display">{companyDisplayName}</p>
            <p className="fiscal-year-display">
              {companyFiscalYear ? `Fiscal Year ${companyFiscalYear}` : "Fiscal year not set"}
              {activeCompany.isLocked ? " - Closed" : " - Open"}
            </p>
            <h1>Select Module</h1>
            <p>
              Logged in as {userRole === "master" ? "Master" : "Account"}.
              {activeCompany.isLocked ? " This fiscal year is locked and opens in view-only mode." : ""}
            </p>
          </div>
          <div className="module-header-actions">
            <button type="button" className="ghost" onClick={openCompanySelection}>
              Switch Company
            </button>
            {userRole === "master" && (
              <>
                <button type="button" className="ghost" onClick={() => setIsAddingCompany(true)}>
                  Add Company
                </button>
                {!activeCompany.isLocked && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => navigateToModule("settings")}
                  >
                    Settings
                  </button>
                )}
              </>
            )}
            <button type="button" className="ghost" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <section className="module-grid">
          <button
            type="button"
            className="module-card"
            onClick={() => navigateToModule("accounts")}
          >
            <span>Sales & Receivables</span>
            <strong>Sales and Collection Module</strong>
            <small>
              Parties, sales entry, collection entry, credit notes, output VAT,
              ledgers, and outstanding reports.
            </small>
          </button>

          <button
            type="button"
            className="module-card"
            onClick={() => navigateToModule("purchase")}
          >
            <span>Purchase & Payables</span>
            <strong>Purchase and Payment Module</strong>
            <small>
              Import purchases, supplier payments, custom agent payments, local
              purchase expenses, input VAT, payables, and landed cost.
            </small>
          </button>

          {trackInventory && (
            <button
              type="button"
              className="module-card"
              onClick={() => navigateToModule("stock")}
            >
              <span>Inventory</span>
              <strong>Stock Module</strong>
              <small>
                Item master, stock line entry, register, and stock summary for this company fiscal year.
              </small>
            </button>
          )}

          <button
            type="button"
            className="module-card"
            onClick={() => navigateToModule("maskebari")}
          >
            <span>VAT Summary</span>
            <strong>Generate Maskebari</strong>
            <small>
              Select a month and prepare Maskebari, Output VAT, and Input VAT
              PDF reports from existing sales and purchase data.
            </small>
          </button>

          {userRole === "master" && (
            <>
              <button
                type="button"
                className="module-card"
                onClick={backupSelectedCompany}
                disabled={isBackingUp}
              >
                <span>Current FY Backup</span>
                <strong>{isBackingUp ? "Creating Backup..." : "Download Fiscal Year"}</strong>
                <small>
                  Create a portable backup file for this company and fiscal year.
                  Use it on another PC from the company selection screen.
                </small>
              </button>

              <button
                type="button"
                className="module-card"
                onClick={backupSelectedCompanyGroup}
                disabled={isBackingUp}
              >
                <span>Full Company Backup</span>
                <strong>{isBackingUp ? "Creating Backup..." : "Download All Fiscal Years"}</strong>
                <small>
                  Create one backup containing every linked fiscal year for this company.
                </small>
              </button>

              <button
                type="button"
                className="module-card"
                onClick={exportSelectedCompanyWorkbook}
                disabled={isExporting}
              >
                <span>Excel Export</span>
                <strong>{isExporting ? "Exporting..." : "Export Company Workbook"}</strong>
                <small>
                  Download one Excel file with separate sheets for sales,
                  collections, credit notes, import purchases, local purchases,
                  payments, parties, settings, and activity logs.
                </small>
              </button>

              <button
                type="button"
                className="module-card"
                onClick={() => navigateToModule("yearEnd")}
              >
                <span>Fiscal Year</span>
                <strong>Year End Lock</strong>
                <small>
                  Lock, unlock, create the next linked fiscal year, and refresh carried opening balances.
                </small>
              </button>

            </>
          )}
        </section>
        {exportMessage && <p className="module-status-message">{exportMessage}</p>}
      </main>
    );
  }

  if (selectedModule === "accounts") {
    return (
      <AccountsApp
        initialUserRole={userRole}
        isReadOnly={activeCompany.isLocked}
        onOpenStockLineEntry={openStockLineEntry}
        onBackToModules={backToModulesAfterWork}
        onLogout={logoutAfterWork}
      />
    );
  }

  if (selectedModule === "stock" && trackInventory && activeFiscalYear) {
    return (
      <StockApp
        activeCompanyId={activeCompany.id}
        activeFiscalYearId={activeFiscalYear.id}
        companyInfo={{
          companyId: activeCompany.id,
          companyName: activeCompany.name,
          fiscalYear: activeCompany.fiscalYear,
          fiscalYearId: activeFiscalYear.id,
        }}
        initialTarget={stockEntryTarget ?? undefined}
        initialUserRole={userRole === "master" ? "Master" : "Account"}
        isReadOnly={activeCompany.isLocked || Boolean(stockEntryTarget?.readOnly)}
        onBackToModules={backToModulesAfterWork}
        onLogout={logoutAfterWork}
        onTargetHandled={() => setStockEntryTarget(null)}
      />
    );
  }

  if (selectedModule === "settings") {
    return (
      <SuiteSettings
        activeCompany={activeCompany}
        companies={companies}
        onDeleteCompany={deleteActiveCompany}
        onBack={() => navigateToModule(null)}
        onCompanySaved={refreshCompanies}
        onInventorySettingChanged={setTrackInventory}
        onLogout={logout}
      />
    );
  }

  if (selectedModule === "maskebari") {
    return <MaskebariGenerator onBack={() => navigateToModule(null)} onLogout={logout} />;
  }

  if (selectedModule === "yearEnd" && userRole === "master") {
    return (
      <YearEndManager
        company={activeCompany}
        companies={companies}
        onBack={() => navigateToModule(null)}
        onCompaniesChanged={(nextActiveCompanyId) => {
          refreshCompanies();
          if (nextActiveCompanyId) {
            activateCompany(nextActiveCompanyId);
          }
        }}
        onLogout={logout}
      />
    );
  }

  return (
    <PurchaseApp
      initialUserRole={userRole === "master" ? "Master" : "Account"}
      isReadOnly={activeCompany.isLocked}
      onOpenStockLineEntry={openStockLineEntry}
      onBackToModules={backToModulesAfterWork}
      onLogout={logoutAfterWork}
    />
  );
}

type MaskebariGeneratorProps = {
  onBack: () => void;
  onLogout: () => void;
};

type PdfTableRow = string[];

const nepaliMonths = [
  { value: "1", label: "1. Baisakh" },
  { value: "2", label: "2. Jestha" },
  { value: "3", label: "3. Ashadh" },
  { value: "4", label: "4. Shrawan" },
  { value: "5", label: "5. Bhadra" },
  { value: "6", label: "6. Ashwin" },
  { value: "7", label: "7. Kartik" },
  { value: "8", label: "8. Mangsir" },
  { value: "9", label: "9. Poush" },
  { value: "10", label: "10. Magh" },
  { value: "11", label: "11. Falgun" },
  { value: "12", label: "12. Chaitra" },
];

function MaskebariGenerator({ onBack, onLogout }: MaskebariGeneratorProps) {
  const [month, setMonth] = useState("1");
  const [visibleReport, setVisibleReport] = useState<"input" | "output" | "">("");
  const [sales, setSales] = useState<Sale[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [accountParties, setAccountParties] = useState<AccountParty[]>([]);
  const [purchaseData, setPurchaseData] = useState<AppData | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      setMessage("");

      try {
        const [loadedSales, loadedCreditNotes, loadedAccountParties, repository] =
          await Promise.all([getSales(), getCreditNotes(), getParties(), createDataRepository()]);
        const loadedPurchaseData = await repository.loadData();

        if (!active) {
          return;
        }

        setSales(loadedSales);
        setCreditNotes(loadedCreditNotes);
        setAccountParties(loadedAccountParties);
        setPurchaseData(loadedPurchaseData);
      } catch (error) {
        console.error("Maskebari load error:", error);
        if (active) {
          setMessage("Could not load all VAT data. Please reopen the app and try again.");
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const selectedMonth = Number(month);
  const selectedMonthLabel = nepaliMonths[selectedMonth - 1]?.label.replace(/^\d+\.\s*/, "") ?? "-";
  const summary = buildMaskebariSummary({
    accountParties,
    creditNotes,
    month: selectedMonth,
    purchaseData,
    sales,
  });

  const companyDisplayName = readSuiteSettings(purchaseData?.settings).companyName || "Easysolution";

  return (
    <main className="maskebari-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="company-name-display compact">{companyDisplayName}</p>
          <h1>Generate Maskebari</h1>
          <p>Prepare Maskebari, Output VAT, and Input VAT reports from saved data.</p>
        </div>
        <div className="module-header-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Back to Modules
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="maskebari-panel">
        <div className="maskebari-form">
          <label>
            Month
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {nepaliMonths.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="maskebari-actions">
            <button
              type="button"
              onClick={() =>
                downloadCombinedVatExcel(`maskebari-vat-${selectedMonthLabel}.xls`, selectedMonthLabel, summary)
              }
            >
              Download Excel
            </button>
            <button
              type="button"
              onClick={() =>
                downloadCombinedVatPdf(`maskebari-vat-${selectedMonthLabel}.pdf`, selectedMonthLabel, summary)
              }
            >
              Download VAT PDF
            </button>
          </div>
        </div>

        <div className="maskebari-summary">
          <div className="card-header">
            <h3>Maskebari Summary - {selectedMonthLabel}</h3>
          </div>
          {message && <p className="status-message">{message}</p>}

          <div className="table-wrap">
            <table className="maskebari-table">
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th>Turnover / Purchase Value</th>
                  <th>Input VAT Credit</th>
                  <th>Output VAT Debit</th>
                </tr>
              </thead>
              <tbody>
                <tr className="section-row"><td colSpan={4}>1. Sales</td></tr>
                <tr><td>1.1 Taxable sales</td><td>{money(summary.taxableSales)}</td><td>-</td><td>{money(summary.salesVatDebit)}</td></tr>
                <tr><td>1.2 Export</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr><td>1.3 Exempt sales</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr className="section-row"><td colSpan={4}>2. Purchase / Import</td></tr>
                <tr><td>2.1 Taxable purchase</td><td>{money(summary.taxablePurchase)}</td><td>{money(summary.purchaseVatCredit)}</td><td>-</td></tr>
                <tr><td>2.2 Taxable import purchase</td><td>{money(summary.taxableImport)}</td><td>{money(summary.importVatCredit)}</td><td>-</td></tr>
                <tr><td>2.3 Exempt purchase</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr><td>2.4 Exempt import</td><td>{money(0)}</td><td>-</td><td>-</td></tr>
                <tr className="section-row"><td colSpan={4}>3. Other</td></tr>
                <tr><td>3.1 Other adjustments</td><td>-</td><td>{money(summary.otherCredit)}</td><td>{money(0)}</td></tr>
                <tr className="total-row"><td>Total</td><td>-</td><td>{money(summary.totalCredit)}</td><td>{money(summary.totalDebit)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="maskebari-totals">
            <div><span>Net payable / receivable</span><strong>{money(summary.netPayableReceivable)}</strong></div>
          </div>

          <div className="maskebari-report-actions">
            <button
              type="button"
              className={visibleReport === "input" ? "" : "ghost"}
              onClick={() => setVisibleReport((current) => (current === "input" ? "" : "input"))}
            >
              View Input VAT Report
            </button>
            <button
              type="button"
              className={visibleReport === "output" ? "" : "ghost"}
              onClick={() => setVisibleReport((current) => (current === "output" ? "" : "output"))}
            >
              View Output VAT Report
            </button>
          </div>

          {visibleReport === "input" && (
            <ReportPreview
              title="Input VAT Report"
              headers={["Date", "Source", "Party", "PAN/VAT No.", "Reference", "Taxable Value", "VAT Credit"]}
              rows={summary.inputVatRows}
            />
          )}

          {visibleReport === "output" && (
            <ReportPreview
              title="Output VAT Report"
              headers={["Date", "Party", "PAN/VAT No.", "Bill / CN", "Taxable Sales", "VAT Debit", "Remarks"]}
              rows={summary.outputVatRows}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function ReportPreview({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: PdfTableRow[];
  title: string;
}) {
  return (
    <div className="maskebari-report-preview">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="maskebari-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((_, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`}>{row[cellIndex] || "-"}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length}>No records found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function money(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function buildMaskebariSummary({
  accountParties,
  creditNotes,
  month,
  purchaseData,
  sales,
}: {
  accountParties: AccountParty[];
  creditNotes: CreditNote[];
  month: number;
  purchaseData: AppData | null;
  sales: Sale[];
}) {
  const purchaseParties = new Map(
    (purchaseData?.parties ?? []).map((party) => [party.id, { name: party.name, panVatNo: party.panVatNo }]),
  );
  const accountPartyMap = new Map(
    accountParties.map((party) => [party.id, { name: party.name, panNo: party.panNo ?? "" }]),
  );
  const purchaseVatRate = Math.max(0, Number(purchaseData?.settings.agentServiceVatRate ?? defaultSettings.agentServiceVatRate)) / 100;
  const taxableValueFromVat = (vatAmount: number) =>
    purchaseVatRate > 0 ? vatAmount / purchaseVatRate : 0;
  const monthSales = sales.filter((sale) => dateMonth(sale.dateBs) === month);
  const monthCreditNotes = creditNotes.filter((creditNote) => dateMonth(creditNote.dateBs) === month);
  const grossTaxableSales = monthSales.reduce((sum, sale) => sum + sale.salesAmount, 0);
  const grossSalesVatDebit = monthSales.reduce((sum, sale) => sum + sale.vatAmount, 0);
  const creditNoteTaxableAdjustment = monthCreditNotes.reduce((sum, creditNote) => sum + creditNote.amount, 0);
  const creditNoteVatAdjustment = monthCreditNotes.reduce((sum, creditNote) => sum + creditNote.vatAmount, 0);
  const taxableSales = grossTaxableSales - creditNoteTaxableAdjustment;
  const salesVatDebit = grossSalesVatDebit - creditNoteVatAdjustment;
  let taxablePurchase = 0;
  let purchaseVatCredit = 0;
  let taxableImport = 0;
  let importVatCredit = 0;
  const inputVatRows: PdfTableRow[] = [];
  const outputVatRows: PdfTableRow[] = monthSales.map((sale) => [
    sale.dateBs || "-",
    accountPartyMap.get(sale.partyId)?.name ?? "Unknown party",
    accountPartyMap.get(sale.partyId)?.panNo ?? "-",
    sale.billNo,
    money(sale.salesAmount),
    money(sale.vatAmount),
    sale.remarks || "-",
  ]);

  monthCreditNotes.forEach((creditNote) => {
    outputVatRows.push([
      creditNote.dateBs || "-",
      accountPartyMap.get(creditNote.partyId)?.name ?? "Unknown party",
      accountPartyMap.get(creditNote.partyId)?.panNo ?? "-",
      creditNote.creditNoteNo,
      money(-creditNote.amount),
      money(-creditNote.vatAmount),
      creditNote.remarks || "Credit note adjustment",
    ]);
  });

  (purchaseData?.purchases ?? []).forEach((purchase) => {
    const pragapanpatraDate = purchase.debitNoteDate || purchase.billDate;
    const terminalVat = purchase.terminalVatNPR || purchase.terminalChargeWithoutVatNPR * purchaseVatRate;

    if (dateMonth(pragapanpatraDate) === month) {
      if (terminalVat > 0 || purchase.terminalChargeWithoutVatNPR > 0) {
        taxablePurchase += purchase.terminalChargeWithoutVatNPR;
        purchaseVatCredit += terminalVat;
        inputVatRows.push([
          pragapanpatraDate || "-",
          "Terminal VAT",
          purchaseParties.get(purchase.customAgentPartyId)?.name ?? "-",
          purchaseParties.get(purchase.customAgentPartyId)?.panVatNo ?? "-",
          purchase.debitNoteNumber || purchase.vendorBillNumber,
          money(purchase.terminalChargeWithoutVatNPR),
          money(terminalVat),
        ]);
      }

      if (purchase.importVatNPR > 0) {
        const importTaxableValue = taxableValueFromVat(purchase.importVatNPR);
        taxableImport += importTaxableValue;
        importVatCredit += purchase.importVatNPR;
        inputVatRows.push([
          pragapanpatraDate || "-",
          "Import VAT",
          purchaseParties.get(purchase.vendorPartyId)?.name ?? "-",
          purchaseParties.get(purchase.vendorPartyId)?.panVatNo ?? "-",
          purchase.debitNoteNumber || purchase.vendorBillNumber,
          money(importTaxableValue),
          money(purchase.importVatNPR),
        ]);
      }
    }

    if (dateMonth(purchase.agentServiceBillDate) === month) {
      taxablePurchase += purchase.agentServiceAmountBeforeVatNPR;
      purchaseVatCredit += purchase.agentServiceVatNPR;
      inputVatRows.push([
        purchase.agentServiceBillDate || "-",
        "Custom agent service VAT",
        purchaseParties.get(purchase.customAgentPartyId)?.name ?? "-",
        purchaseParties.get(purchase.customAgentPartyId)?.panVatNo ?? "-",
        purchase.agentServiceBillNumber || purchase.debitNoteNumber || "-",
        money(purchase.agentServiceAmountBeforeVatNPR),
        money(purchase.agentServiceVatNPR),
      ]);
    }
  });

  (purchaseData?.localExpenses ?? []).forEach((localExpense) => {
    if (dateMonth(localExpense.billDate) !== month) {
      return;
    }

    taxablePurchase += localExpense.amountBeforeVatNPR;
    purchaseVatCredit += localExpense.vatNPR;
    inputVatRows.push([
      localExpense.billDate || "-",
      "Local supplier VAT",
      purchaseParties.get(localExpense.partyId)?.name ?? "-",
      purchaseParties.get(localExpense.partyId)?.panVatNo ?? "-",
      localExpense.billNumber,
      money(localExpense.amountBeforeVatNPR),
      money(localExpense.vatNPR),
    ]);
  });

  const otherCredit = 0;

  const totalCredit = purchaseVatCredit + importVatCredit;
  const totalDebit = salesVatDebit;
  const netPayableReceivable = totalDebit - totalCredit;
  const maskebariRows: PdfTableRow[] = [
    ["1. Sales", "", "", ""],
    ["1.1 Taxable sales", money(taxableSales), "-", money(salesVatDebit)],
    ["1.2 Export", money(0), "-", "-"],
    ["1.3 Exempt sales", money(0), "-", "-"],
    ["2. Purchase / Import", "", "", ""],
    ["2.1 Taxable purchase", money(taxablePurchase), money(purchaseVatCredit), "-"],
    ["2.2 Taxable import purchase", money(taxableImport), money(importVatCredit), "-"],
    ["2.3 Exempt purchase", money(0), "-", "-"],
    ["2.4 Exempt import", money(0), "-", "-"],
    ["3. Other", "", "", ""],
    ["3.1 Other adjustments", "-", money(otherCredit), money(0)],
    ["Total", "-", money(totalCredit), money(totalDebit)],
    ["Net payable / receivable", "-", "-", money(netPayableReceivable)],
  ];

  outputVatRows.push(["Total", "-", "-", "-", money(taxableSales), money(salesVatDebit), "-"]);
  inputVatRows.push(["Total", "-", "-", "-", "-", money(taxablePurchase + taxableImport), money(totalCredit)]);

  return {
    importVatCredit,
    inputVatRows,
    maskebariRows,
    netPayableReceivable,
    otherCredit,
    outputVatRows,
    purchaseVatCredit,
    salesVatDebit,
    taxableImport,
    taxablePurchase,
    taxableSales,
    totalCredit,
    totalDebit,
  };
}

function dateMonth(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{4})[/-](\d{1,2})/);

  if (!match) {
    return 0;
  }

  const year = Number(match[1]);

  if (year < 2070 || year > 2099) {
    return 0;
  }

  return Number(match[2]);
}

async function downloadCombinedVatPdf(
  filename: string,
  monthLabel: string,
  summary: ReturnType<typeof buildMaskebariSummary>,
) {
  const blob = new Blob(
    [
      buildMultiTablePdf([
        {
          title: `Maskebari Summary - ${monthLabel}`,
          headers: ["Particulars", "Turnover / Purchase", "Input VAT Credit", "Output VAT Debit"],
          rows: summary.maskebariRows,
        },
        {
          title: `Output VAT Report - ${monthLabel}`,
          headers: ["Date", "Party", "PAN/VAT No.", "Bill / CN", "Taxable Sales", "VAT Debit", "Remarks"],
          rows: summary.outputVatRows,
        },
        {
          title: `Input VAT Report - ${monthLabel}`,
          headers: ["Date", "Source", "Party", "PAN/VAT No.", "Reference", "Taxable Value", "VAT Credit"],
          rows: summary.inputVatRows,
        },
      ]),
    ],
    { type: "application/pdf" },
  );
  await saveBlob(safePdfFilename(filename), blob, {
    description: "PDF Document",
    mimeType: "application/pdf",
    extensions: [".pdf"],
  });
}

async function downloadCombinedVatExcel(
  filename: string,
  monthLabel: string,
  summary: ReturnType<typeof buildMaskebariSummary>,
) {
  const sheets: WorkbookSheet[] = [
    {
      name: "Maskebari",
      rows: [
        [`Maskebari Summary - ${monthLabel}`, "", "", ""],
        ["Particulars", "Turnover / Purchase", "Input VAT Credit", "Output VAT Debit"],
        ...summary.maskebariRows,
      ],
    },
    {
      name: "Output VAT",
      rows: [
        [`Output VAT Report - ${monthLabel}`, "", "", "", "", "", ""],
        ["Date", "Party", "PAN/VAT No.", "Bill / CN", "Taxable Sales", "VAT Debit", "Remarks"],
        ...summary.outputVatRows,
      ],
    },
    {
      name: "Input VAT",
      rows: [
        [`Input VAT Report - ${monthLabel}`, "", "", "", "", "", ""],
        ["Date", "Source", "Party", "PAN/VAT No.", "Reference", "Taxable Value", "VAT Credit"],
        ...summary.inputVatRows,
      ],
    },
  ];

  await saveBlob(safePdfFilename(filename), new Blob([buildExcelXml(sheets)], { type: "application/vnd.ms-excel;charset=utf-8" }), {
    description: "Excel Workbook",
    mimeType: "application/vnd.ms-excel",
    extensions: [".xls"],
  });
}

function buildMultiTablePdf(
  sections: { title: string; headers: string[]; rows: PdfTableRow[] }[],
) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  const rowHeight = 20;
  const rowsPerPage = 22;
  const tableWidth = pageWidth - margin * 2;
  const pages = sections.flatMap((section) => {
    const headers = Array.isArray(section.headers) && section.headers.length ? section.headers : ["Details"];
    const rows = Array.isArray(section.rows) ? section.rows : [];
    const rowChunks = chunkRows(rows.length ? rows : [["No records found"]], rowsPerPage);
    const columnWidth = tableWidth / headers.length;

    return rowChunks.map((pageRows, sectionPageIndex) => {
      let y = pageHeight - margin;
      const ops: string[] = [
        "0.2 w",
        centeredPdfText(
          sectionPageIndex === 0
            ? section.title
            : `${section.title} (continued)`,
          pageWidth / 2,
          y,
          16,
          "F2",
        ),
      ];
      y -= 34;

      headers.forEach((header, index) => {
        const x = margin + index * columnWidth;
        ops.push(pdfRect(x, y - rowHeight + 5, columnWidth, rowHeight));
        ops.push(pdfText(fitPdfText(header, 22), x + 4, y - 9, 8, "F2"));
      });
      y -= rowHeight;

      pageRows.forEach((row) => {
        const isSummaryRow =
          /^Total/i.test(row[0] ?? '') ||
          /^Net payable/i.test(row[0] ?? '') ||
          /^\d+\./.test(row[0] ?? '') === false && row.slice(1).every((value) => !value)
        headers.forEach((_, index) => {
          const x = margin + index * columnWidth;
          const value = row[index] ?? "";
          ops.push(pdfRect(x, y - rowHeight + 5, columnWidth, rowHeight));
          ops.push(pdfText(fitPdfText(value, 24), x + 4, y - 9, 8, isSummaryRow ? "F2" : "F1"));
        });
        y -= rowHeight;
      });

      return ops.join("\n");
    });
  });

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((content, pageIndex) => {
    const pageObjectNumber = 5 + pageIndex * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    objects[pageObjectNumber - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber - 1] =
      `<< /Length ${content.length} >>\nstream\n${content}\n${pdfText(`Page ${pageIndex + 1} of ${pages.length}`, pageWidth - 105, 24, 8)}\nendstream`;
  });

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`;

  return writePdf(objects);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function pdfText(text: string, x: number, y: number, size = 9, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`;
}

function centeredPdfText(text: string, x: number, y: number, size = 16, font = "F2") {
  const width = text.length * size * 0.28;
  return pdfText(text, x - width / 2, y, size, font);
}

function pdfRect(x: number, y: number, width: number, height: number) {
  return `${x} ${y} ${width} ${height} re S`;
}

function pdfSafe(value: string) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fitPdfText(value: string, maxLength: number) {
  const text = String(value || "-");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function writePdf(objects: string[]) {
  const offsets = [0];
  let pdf = "%PDF-1.4\n";

  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function safePdfFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-") || "report.pdf";
}

type SuiteSettingsProps = {
  activeCompany: CompanyProfile;
  companies: CompanyProfile[];
  onDeleteCompany: (scope: CompanyDeleteScope) => Promise<void>;
  onBack: () => void;
  onCompanySaved: () => void;
  onInventorySettingChanged: (enabled: boolean) => void;
  onLogout: () => void;
};

type CompanySetupProps = {
  existingCompanyNames: string[];
  onBack?: () => void;
  onComplete: (settings: AppSettings, trackInventory: boolean) => Promise<CompanyProfile>;
};

type CompanySelectorProps = {
  companies: CompanyProfile[];
  message: string;
  userRole: UserRole;
  onAddCompany: () => void;
  onImportBackup: (file: File) => Promise<void>;
  onSelectCompany: (companyId: string) => void;
};

function CompanySelector({ companies, message, onAddCompany, onImportBackup, onSelectCompany, userRole }: CompanySelectorProps) {
  const isMaster = userRole === "master";
  const [isImportingBackup, setIsImportingBackup] = useState(false);

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsImportingBackup(true);

    try {
      await onImportBackup(file);
    } finally {
      setIsImportingBackup(false);
    }
  }

  return (
    <main className="module-picker-page">
      <header className="module-picker-header">
        <div>
          <p className="eyebrow">Company books</p>
          <h1>Select Company</h1>
          <p>Open one company at a time. Each company keeps separate sales, collection, purchase, payment, VAT, and ledger data.</p>
        </div>
        <div className="module-header-actions">
          {isMaster && (
            <>
              <label className="file-action-button">
                {isImportingBackup ? "Importing..." : "Import Backup"}
                <input
                  type="file"
                  accept=".json,.easysolution-backup.json,application/json"
                  onChange={importBackup}
                  disabled={isImportingBackup}
                />
              </label>
              <button type="button" onClick={onAddCompany}>
                Add Company
              </button>
            </>
          )}
        </div>
      </header>
      {message && <p className="module-status-message">{message}</p>}

      <section className="module-grid company-grid">
        {companies.map((company) => (
          <button
            key={company.id}
            type="button"
            className={company.isLocked ? "module-card company-card locked-company-card" : "module-card company-card"}
            onClick={() => onSelectCompany(company.id)}
          >
            <span>{company.isLocked ? "Locked Fiscal Year" : "Open Fiscal Year"}</span>
            <strong>{company.name}</strong>
            <small>
              {company.fiscalYear ? `Fiscal Year ${company.fiscalYear}` : "No fiscal year set"}
              {company.isLocked ? " - Closed" : " - Open"}
            </small>
          </button>
        ))}
        {!companies.length && isMaster && (
          <button type="button" className="module-card company-card" onClick={onAddCompany}>
            <span>Company</span>
            <strong>Add first company</strong>
            <small>Create company details before entering transactions.</small>
          </button>
        )}
        {!companies.length && !isMaster && (
          <section className="suite-settings-panel">
            <p className="status-message">
              No company has been set up yet. Please ask a Master user to log in and add the first company.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}

function YearEndManager({
  companies,
  company,
  onBack,
  onCompaniesChanged,
  onLogout,
}: {
  companies: CompanyProfile[];
  company: CompanyProfile;
  onBack: () => void;
  onCompaniesChanged: (nextActiveCompanyId?: string) => void;
  onLogout: () => void;
}) {
  const linkedNextCompany = companies.find((item) => item.id === company.nextCompanyId) ?? null;
  const [carryForward, setCarryForward] = useState(true);
  const [nextYear, setNextYear] = useState(() => nextFiscalYear(company.fiscalYear));
  const [lockPassword, setLockPassword] = useState("");
  const [unlockMasterPassword, setUnlockMasterPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function lockCompany() {
    setMessage("");

    if (lockPassword !== YEAR_END_PASSWORD) {
      setMessage("Additional year-end password is incorrect.");
      return;
    }

    const nextFiscalYearValue = nextYear.trim();
    if (carryForward && !nextFiscalYearValue) {
      setMessage("Enter the next fiscal year before carrying closing figures.");
      return;
    }

    setIsBusy(true);

    try {
      const now = new Date().toISOString();
      let nextCompany: CompanyProfile | null = linkedNextCompany;

      if (carryForward) {
        if (!nextCompany) {
          const companyGroupId = company.companyGroupId || company.id;
          nextCompany =
            companies.find(
              (item) =>
                item.fiscalYear === nextFiscalYearValue &&
                (item.companyGroupId === companyGroupId ||
                  item.name.toLowerCase() === company.name.toLowerCase()),
            ) ?? null;

          if (!nextCompany) {
            const nextCompanyId = createCompanyYearId(company.name, nextFiscalYearValue);
            nextCompany = upsertCompanyProfile({
              companyGroupId,
              fiscalYear: nextFiscalYearValue,
              id: nextCompanyId,
              name: company.name,
              previousCompanyId: company.id,
            });
          }
        }

        const targetSettings: AppSettings = {
          ...readSuiteSettings(),
          companyName: nextCompany.name,
          fiscalYear: nextCompany.fiscalYear,
        };
        const previousActiveCompanyId = getActiveCompanyId();
        setActiveCompanyId(nextCompany.id);
        writeSuiteSettings(targetSettings);
        setActiveCompanyId(previousActiveCompanyId);

        const carryForwardResult = await carryForwardOpenings(company, nextCompany);
        const inventoryMessage = carryForwardResult.inventory.status === "completed"
          ? ` Inventory: ${carryForwardResult.inventory.eligibleItemCount} item(s), ` +
            `${carryForwardResult.inventory.created} created, ${carryForwardResult.inventory.updated} updated, ` +
            `closing qty ${carryForwardResult.inventory.totalClosingQty.toLocaleString("en-IN")}, ` +
            `value NPR ${carryForwardResult.inventory.totalClosingValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : ` Inventory: skipped (${carryForwardResult.inventory.warnings.join("; ")}).`;
        setMessage(
          `Opening balances refreshed. Receivables: ${carryForwardResult.accountParties} parties. ` +
          `Payables: ${carryForwardResult.purchaseParties} parties.${inventoryMessage}`,
        );
      }

      upsertCompanyProfile({
        ...company,
        isLocked: true,
        lastCarryForwardAt: carryForward ? now : company.lastCarryForwardAt,
        lockedAt: now,
        nextCompanyId: nextCompany?.id ?? company.nextCompanyId,
      });

      if (nextCompany) {
        upsertCompanyProfile({
          ...nextCompany,
          companyGroupId: company.companyGroupId || company.id,
          previousCompanyId: company.id,
        });
      }

      setLockPassword("");
      onCompaniesChanged(nextCompany?.id);
      if (!carryForward || !nextCompany) {
        setMessage("Fiscal year locked in view-only mode.");
      }
    } catch (error) {
      console.error("Year-end lock error:", error);
      setMessage(error instanceof Error ? error.message : String(error || "Could not complete year end."));
    } finally {
      setIsBusy(false);
    }
  }

  function unlockCompany() {
    setMessage("");

    if (unlockMasterPassword !== MASTER_PASSWORD || unlockPassword !== YEAR_END_PASSWORD) {
      setMessage("Master password or additional year-end password is incorrect.");
      return;
    }

    upsertCompanyProfile({
      ...company,
      isLocked: false,
      lockedAt: "",
    });
    setUnlockMasterPassword("");
    setUnlockPassword("");
    onCompaniesChanged();
    setMessage("Fiscal year unlocked. Make the adjustment; linked next-year openings update automatically when you return to modules.");
  }

  return (
    <main className="suite-settings-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="company-name-display compact">{company.name}</p>
          <h1>Year End Lock</h1>
          <p>
            Fiscal year {company.fiscalYear || "-"} is {company.isLocked ? "locked" : "open"}.
            {linkedNextCompany ? ` Linked next year: ${linkedNextCompany.fiscalYear}.` : ""}
          </p>
        </div>
        <div className="module-header-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Back to Modules
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="suite-settings-panel">
        {message && <p className="status-message">{message}</p>}

        <div className="suite-settings-grid">
          <label>
            Current Fiscal Year
            <input value={company.fiscalYear || ""} readOnly />
          </label>
          <label>
            Next Fiscal Year
            <input
              value={nextYear}
              onChange={(event) => setNextYear(event.target.value)}
              placeholder="2083/84"
              disabled={Boolean(linkedNextCompany)}
            />
          </label>
          <label className="suite-settings-wide checkbox-row">
            <input
              type="checkbox"
              checked={carryForward}
              onChange={(event) => setCarryForward(event.target.checked)}
            />
            Carry sales receivable, purchase payable, and inventory closing figures as next year opening figures
          </label>
          <label>
            Additional Password
            <input
              type="password"
              value={lockPassword}
              onChange={(event) => setLockPassword(event.target.value)}
            />
          </label>
        </div>

        <div className="suite-settings-actions">
          <button type="button" disabled={isBusy || company.isLocked} onClick={lockCompany}>
            {isBusy ? "Working..." : "Lock Fiscal Year"}
          </button>
        </div>
      </section>

      <section className="suite-settings-panel">
        <h2>Unlock for Adjustment</h2>
        <p className="muted">
          After you adjust this fiscal year and return from Sales or Purchase module, the linked next-year opening balances update without deleting next-year entries.
        </p>
        <div className="suite-settings-grid">
          <label>
            Master Password
            <input
              type="password"
              value={unlockMasterPassword}
              onChange={(event) => setUnlockMasterPassword(event.target.value)}
            />
          </label>
          <label>
            Additional Password
            <input
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
            />
          </label>
        </div>
        <div className="suite-settings-actions">
          <button type="button" disabled={isBusy || !company.isLocked} onClick={unlockCompany}>
            Unlock Fiscal Year
          </button>
        </div>
      </section>
    </main>
  );
}

function CompanySetup({ existingCompanyNames, onBack, onComplete }: CompanySetupProps) {
  const [settingsForm, setSettingsForm] = useState<AppSettings>(() => ({
    ...defaultSettings,
    companyName: "",
  }));
  const [trackInventory, setTrackInventory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  function updateTextField(
    field: "companyName" | "fiscalYear" | "panVatNo" | "address" | "phone",
    value: string,
  ) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
  }

  function updateNumberField(field: "defaultExchangeRate" | "agentServiceVatRate", value: string) {
    setSettingsForm((current) => ({
      ...current,
      [field]: Number(value) || 0,
    }));
  }

  function updateSupplierCurrency(value: string) {
    setSettingsForm((current) => ({
      ...current,
      supplierPurchaseCurrency: normalizeSupplierCurrency(value),
    }));
  }

  async function saveInitialSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const companyName = settingsForm.companyName.trim();

    if (!companyName) {
      setMessage("Company name is required.");
      return;
    }

    const fiscalYear = settingsForm.fiscalYear.trim();
    if (existingCompanyNames.includes(`${companyName.toLowerCase()}|${fiscalYear}`)) {
      setMessage("This company and fiscal year already exists. Choose that company or use a different fiscal year.");
      return;
    }

    setIsSaving(true);

    const nextSettings: AppSettings = {
      ...settingsForm,
      companyName,
      fiscalYear,
      panVatNo: settingsForm.panVatNo.trim(),
      address: settingsForm.address.trim(),
      phone: settingsForm.phone.trim(),
      defaultExchangeRate:
        settingsForm.defaultExchangeRate > 0
          ? settingsForm.defaultExchangeRate
          : defaultSettings.defaultExchangeRate,
      supplierPurchaseCurrency: normalizeSupplierCurrency(settingsForm.supplierPurchaseCurrency),
      agentServiceVatRate:
        settingsForm.agentServiceVatRate >= 0
          ? settingsForm.agentServiceVatRate
          : defaultSettings.agentServiceVatRate,
    };

    try {
      await onComplete(nextSettings, trackInventory);
    } catch (error) {
      console.error("Initial company setup save error:", error);
      setMessage("Company was created locally, but storage could not be initialized. Reopen the app and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="suite-settings-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="eyebrow">First run setup</p>
          <h1>Set Up Company</h1>
          <p>Enter the client company details before starting the sales and purchase modules.</p>
        </div>
        {onBack && (
          <div className="module-header-actions">
            <button type="button" className="ghost" onClick={onBack}>
              Back to Companies
            </button>
          </div>
        )}
      </header>

      <form className="suite-settings-panel" onSubmit={saveInitialSettings}>
        {message && <p className="status-message">{message}</p>}

        <section className="suite-settings-grid">
          <label>
            Company Name
            <input
              autoFocus
              required
              value={settingsForm.companyName}
              onChange={(event) => updateTextField("companyName", event.target.value)}
            />
          </label>

          <label>
            Fiscal Year
            <input
              value={settingsForm.fiscalYear}
              onChange={(event) => updateTextField("fiscalYear", event.target.value)}
              placeholder="2082/83"
            />
          </label>

          <label>
            PAN/VAT No.
            <input
              value={settingsForm.panVatNo}
              onChange={(event) => updateTextField("panVatNo", event.target.value)}
            />
          </label>

          <label>
            Phone
            <input
              value={settingsForm.phone}
              onChange={(event) => updateTextField("phone", event.target.value)}
            />
          </label>

          <label className="suite-settings-wide">
            Address
            <input
              value={settingsForm.address}
              onChange={(event) => updateTextField("address", event.target.value)}
            />
          </label>

          <label>
            Default INR Exchange Rate
            <input
              min="0"
              step="0.0001"
              type="number"
              value={settingsForm.defaultExchangeRate}
              onChange={(event) => updateNumberField("defaultExchangeRate", event.target.value)}
            />
          </label>

          <label>
            Supplier Purchase Currency Mode
            <select
              value={settingsForm.supplierPurchaseCurrency}
              onChange={(event) => updateSupplierCurrency(event.target.value)}
            >
              <option value="INR">INR only</option>
              <option value="USD">INR and USD</option>
            </select>
          </label>

          <label>
            VAT Rate %
            <input
              min="0"
              step="0.01"
              type="number"
              value={settingsForm.agentServiceVatRate}
              onChange={(event) => updateNumberField("agentServiceVatRate", event.target.value)}
            />
          </label>

          <label className="suite-settings-wide checkbox-row">
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(event) => setTrackInventory(event.target.checked)}
            />
            Track inventory for this company
          </label>
        </section>

        <div className="suite-settings-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save and Continue"}
          </button>
        </div>
      </form>
    </main>
  );
}

function SuiteSettings({
  activeCompany,
  companies,
  onBack,
  onCompanySaved,
  onDeleteCompany,
  onInventorySettingChanged,
  onLogout,
}: SuiteSettingsProps) {
  const [settingsForm, setSettingsForm] = useState<AppSettings>(() => readSuiteSettings());
  const [letterheadSettings, setLetterheadSettings] = useState(readLetterheadSettings);
  const [trackInventory, setTrackInventory] = useState(() => isInventoryTrackingEnabled());
  const [purchaseData, setPurchaseData] = useState<AppData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingCompany, setIsDeletingCompany] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const linkedCompanyCount = useMemo(() => {
    const linkedIds = new Set(getLinkedCompanyGroup(activeCompany).map((company) => company.id));
    return companies.filter((company) => linkedIds.has(company.id)).length;
  }, [activeCompany, companies]);

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      setIsLoading(true);
      setMessage("");

      try {
        const repository = await createDataRepository();
        const data = await repository.loadData();

        if (!active) {
          return;
        }

        setPurchaseData(data);
        setSettingsForm(readSuiteSettings(data.settings));
        setLetterheadSettings(readLetterheadSettings());
        setTrackInventory(isInventoryTrackingEnabled());
      } catch (error) {
        console.error("Settings load error:", error);
        if (active) {
          setMessage("Using local settings. Purchase settings will sync when storage is available.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      active = false;
    };
  }, []);

  function updateTextField(
    field: "companyName" | "fiscalYear" | "panVatNo" | "address" | "phone",
    value: string,
  ) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
  }

  function updateNumberField(field: "defaultExchangeRate" | "agentServiceVatRate", value: string) {
    setSettingsForm((current) => ({
      ...current,
      [field]: Number(value) || 0,
    }));
  }

  function updateSupplierCurrency(value: SupplierCurrency) {
    setSettingsForm((current) => ({
      ...current,
      supplierPurchaseCurrency: value,
    }));
  }

  function updateLetterheadField(field: keyof typeof letterheadSettings, value: string) {
    setLetterheadSettings((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");

    const nextSettings: AppSettings = {
      ...settingsForm,
      companyName: settingsForm.companyName.trim() || defaultSettings.companyName,
      fiscalYear: settingsForm.fiscalYear.trim(),
      panVatNo: settingsForm.panVatNo.trim(),
      address: settingsForm.address.trim(),
      phone: settingsForm.phone.trim(),
      defaultExchangeRate:
        settingsForm.defaultExchangeRate > 0
          ? settingsForm.defaultExchangeRate
          : defaultSettings.defaultExchangeRate,
      supplierPurchaseCurrency: normalizeSupplierCurrency(settingsForm.supplierPurchaseCurrency),
      agentServiceVatRate:
        settingsForm.agentServiceVatRate >= 0
          ? settingsForm.agentServiceVatRate
          : defaultSettings.agentServiceVatRate,
    };

    writeSuiteSettings(nextSettings);
    writeLetterheadSettings(letterheadSettings);
    writeInventoryTrackingSetting(trackInventory);
    onInventorySettingChanged(trackInventory);

    try {
      const repository = await createDataRepository();
      const currentData = purchaseData ?? (await repository.loadData());
      const updatedData = { ...currentData, settings: nextSettings };

      await repository.saveData(updatedData);
      setPurchaseData(updatedData);
      setSettingsForm(nextSettings);
      onCompanySaved();
      setMessage("Settings saved for Sales/Collection and Purchase/Payment modules.");
    } catch (error) {
      console.error("Settings save error:", error);
      setSettingsForm(nextSettings);
      onCompanySaved();
      setMessage("Settings saved locally. Purchase database settings could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCompany(scope: CompanyDeleteScope) {
    if (deleteConfirmation.trim() !== "DELETE") {
      setMessage("Type DELETE before deleting company data.");
      return;
    }

    const confirmed = window.confirm(
      scope === "company-group"
        ? `Delete all linked fiscal years for ${activeCompany.name}?\n\nThis clears account, purchase, and stock data for ${linkedCompanyCount} fiscal year(s).`
        : `Delete ${activeCompany.name}${activeCompany.fiscalYear ? ` FY ${activeCompany.fiscalYear}` : ""}?\n\nThis clears account, purchase, and stock data for this fiscal year.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingCompany(true);
    setMessage("");

    try {
      await onDeleteCompany(scope);
    } catch (error) {
      console.error("Company delete error:", error);
      setMessage(error instanceof Error ? error.message : String(error || "Could not delete company data."));
    } finally {
      setIsDeletingCompany(false);
    }
  }

  return (
    <main className="suite-settings-page">
      <header className="module-picker-header suite-settings-header">
        <div>
          <p className="company-name-display compact">{settingsForm.companyName || "Easysolution"}</p>
          <h1>Settings</h1>
          <p>Shared company and transaction defaults for both modules.</p>
        </div>
        <div className="module-header-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Back to Modules
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <form className="suite-settings-panel" onSubmit={saveSettings}>
        {message && <p className="status-message">{message}</p>}
        {isLoading && <p className="muted">Loading current settings...</p>}

        <section className="suite-settings-grid">
          <label>
            Company Name
            <input
              value={settingsForm.companyName}
              onChange={(event) => updateTextField("companyName", event.target.value)}
            />
          </label>

          <label>
            Fiscal Year
            <input
              value={settingsForm.fiscalYear}
              onChange={(event) => updateTextField("fiscalYear", event.target.value)}
              placeholder="2082/83"
            />
          </label>

          <label>
            PAN/VAT No.
            <input
              value={settingsForm.panVatNo}
              onChange={(event) => updateTextField("panVatNo", event.target.value)}
            />
          </label>

          <label>
            Phone
            <input
              value={settingsForm.phone}
              onChange={(event) => updateTextField("phone", event.target.value)}
            />
          </label>

          <label className="suite-settings-wide">
            Address
            <input
              value={settingsForm.address}
              onChange={(event) => updateTextField("address", event.target.value)}
            />
          </label>

          <label>
            Default INR Exchange Rate
            <input
              min="0"
              step="0.0001"
              type="number"
              value={settingsForm.defaultExchangeRate}
              onChange={(event) => updateNumberField("defaultExchangeRate", event.target.value)}
            />
          </label>

          <label>
            Supplier Purchase Currency Mode
            <select
              value={settingsForm.supplierPurchaseCurrency}
              onChange={(event) => updateSupplierCurrency(event.target.value as SupplierCurrency)}
            >
              <option value="INR">INR only</option>
              <option value="USD">INR and USD</option>
            </select>
          </label>

          <label>
            VAT Rate %
            <input
              min="0"
              step="0.01"
              type="number"
              value={settingsForm.agentServiceVatRate}
              onChange={(event) => updateNumberField("agentServiceVatRate", event.target.value)}
            />
          </label>

          <label className="suite-settings-wide checkbox-row">
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(event) => setTrackInventory(event.target.checked)}
            />
            Track inventory for this company
          </label>
        </section>

        <section className="suite-settings-section">
          <h2>Letterhead Settings</h2>
          <p className="muted">Phone, VAT/PAN, and address come from the normal company settings above.</p>

          <div className="suite-settings-grid">
            <label className="suite-settings-wide">
              Company Name in Nepali
              <input
                value={letterheadSettings.nepaliCompanyName}
                onChange={(event) => updateLetterheadField("nepaliCompanyName", event.target.value)}
                placeholder="Enter Nepali company name"
              />
            </label>

            <label className="suite-settings-wide">
              Default Contact Line
              <textarea
                value={letterheadSettings.contactLine}
                onChange={(event) => updateLetterheadField("contactLine", event.target.value)}
                placeholder="Leave blank to use phone number from normal settings"
              />
            </label>
          </div>
        </section>

        <section className="suite-settings-section suite-danger-zone">
          <h2>Company Management</h2>
          <p className="muted">
            Delete clears account, purchase, and stock data, then removes the company profile from selection.
          </p>

          <div className="suite-settings-grid">
            <label className="suite-settings-wide">
              Confirmation
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder="Type DELETE"
              />
              <span>Current linked fiscal years: {linkedCompanyCount}</span>
            </label>
          </div>

          <div className="suite-settings-actions">
            <button
              type="button"
              className="danger"
              disabled={isDeletingCompany || deleteConfirmation.trim() !== "DELETE"}
              onClick={() => deleteCompany("fiscal-year")}
            >
              Delete Current Fiscal Year
            </button>
            <button
              type="button"
              className="danger"
              disabled={isDeletingCompany || deleteConfirmation.trim() !== "DELETE" || linkedCompanyCount <= 1}
              onClick={() => deleteCompany("company-group")}
            >
              Delete Full Company
            </button>
          </div>
        </section>

        <div className="suite-settings-actions">
          <button type="button" className="ghost" onClick={onBack}>
            Cancel
          </button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </main>
  );
}

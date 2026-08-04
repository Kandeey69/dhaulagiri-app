import {
  defaultSettings,
  normalizeFreightIndiaStatus,
  normalizePartyCategory,
  normalizePaymentMethod,
  normalizeSupplierCurrency,
  type ActivityLog,
  type AppData,
  type ImportPurchase,
  type LocalPurchaseExpense,
  type Party,
  type Payment,
  type PaymentAllocation,
} from './domain'
import { companyStorageKey, getActiveCompanyId, getActiveCompanyProfile } from '../companyContext'
import { findFiscalYearByBsDate, getOrCreateMigrationFiscalYear } from '../domain/fiscalYear'

const storageKey = 'easysolution-import-purchase-app-v1'
const activeStorageKey = () => companyStorageKey(storageKey)

const emptyData: AppData = {
  settings: defaultSettings,
  parties: [],
  fiscalYears: [],
  purchases: [],
  localExpenses: [],
  payments: [],
  paymentAllocations: [],
  ledgerEntries: [],
  activityLogs: [],
}

const id = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const now = () => new Date().toISOString()

export function createId() {
  return id()
}

export function activeFiscalYear(data: Pick<AppData, 'fiscalYears' | 'settings'>) {
  const companyId = getActiveCompanyId() || 'default'
  const code = getActiveCompanyProfile()?.fiscalYear || data.settings.fiscalYear || defaultSettings.fiscalYear
  return getOrCreateMigrationFiscalYear(companyId, data.fiscalYears, code)
}

const fiscalYearForDate = (date: string, data: Pick<AppData, 'fiscalYears' | 'settings'>) =>
  (date ? findFiscalYearByBsDate(date, data.fiscalYears) : undefined) ?? activeFiscalYear(data)

const importPurchaseFiscalYearId = (
  purchase: Pick<ImportPurchase, 'debitNoteDate' | 'agentServiceBillDate'>,
  data: Pick<AppData, 'fiscalYears' | 'settings'>,
) => fiscalYearForDate(purchase.debitNoteDate || purchase.agentServiceBillDate, data).id

export function normalizeAppData(data: AppData): AppData {
  const fiscalYear = activeFiscalYear(data)
  const fiscalYears = data.fiscalYears.some((item) => item.id === fiscalYear.id)
    ? data.fiscalYears
    : [fiscalYear, ...data.fiscalYears]

  return {
    ...data,
    fiscalYears,
    purchases: data.purchases.map((purchase) => ({
      ...purchase,
      fiscalYearId: purchase.fiscalYearId || importPurchaseFiscalYearId(purchase, { ...data, fiscalYears }),
      lifecycleStatus: purchase.lifecycleStatus ?? 'POSTED',
      supplierCurrency: normalizeSupplierCurrency(purchase.supplierCurrency),
      freightIndiaStatus: normalizeFreightIndiaStatus(purchase.freightIndiaStatus),
      freightIndiaPartyId: purchase.freightIndiaPartyId ?? '',
      totalKg: Number(purchase.totalKg ?? 0),
      loadingUnloadingChargePerKg: Number(purchase.loadingUnloadingChargePerKg ?? 0),
      loadingUnloadingChargeNPR: Number(purchase.loadingUnloadingChargeNPR ?? 0),
      appliedVatRate: Number(purchase.appliedVatRate ?? data.settings.agentServiceVatRate),
      appliedExchangeRate: Number(purchase.appliedExchangeRate ?? purchase.supplierExchangeRate ?? data.settings.defaultExchangeRate),
      calculationVersion: purchase.calculationVersion || 'legacy-migrated-v1',
      calculatedAt: purchase.calculatedAt || purchase.updatedAt || purchase.createdAt || new Date().toISOString(),
      postedAt: purchase.postedAt ?? purchase.createdAt ?? '',
      postedBy: purchase.postedBy ?? '',
      voidedAt: purchase.voidedAt ?? '',
      reversedAt: purchase.reversedAt ?? '',
      reversalReason: purchase.reversalReason ?? '',
      replacementTransactionId: purchase.replacementTransactionId ?? '',
    })),
    payments: data.payments.map((payment) => ({
      ...payment,
      fiscalYearId: payment.fiscalYearId || fiscalYearForDate(payment.paymentDate, { ...data, fiscalYears }).id,
      lifecycleStatus: payment.lifecycleStatus ?? 'POSTED',
      paymentMethod: normalizePaymentMethod(payment.paymentMethod),
      postedAt: payment.postedAt ?? payment.createdAt ?? '',
      postedBy: payment.postedBy ?? '',
      voidedAt: payment.voidedAt ?? '',
      reversedAt: payment.reversedAt ?? '',
      reversalReason: payment.reversalReason ?? '',
      replacementTransactionId: payment.replacementTransactionId ?? '',
    })),
    localExpenses: data.localExpenses.map((localExpense) => ({
      ...localExpense,
      fiscalYearId: localExpense.fiscalYearId || fiscalYearForDate(localExpense.billDate, { ...data, fiscalYears }).id,
      lifecycleStatus: localExpense.lifecycleStatus ?? 'POSTED',
      expenseType: localExpense.expenseType ?? 'Expense',
      postedAt: localExpense.postedAt ?? localExpense.createdAt ?? '',
      postedBy: localExpense.postedBy ?? '',
      voidedAt: localExpense.voidedAt ?? '',
      reversedAt: localExpense.reversedAt ?? '',
      reversalReason: localExpense.reversalReason ?? '',
      replacementTransactionId: localExpense.replacementTransactionId ?? '',
    })),
    paymentAllocations: data.paymentAllocations ?? [],
    ledgerEntries: data.ledgerEntries ?? [],
  }
}

export function loadData(): AppData {
    const saved = localStorage.getItem(activeStorageKey())

  if (!saved) {
    return emptyData
  }

  try {
    const parsed = JSON.parse(saved) as Partial<AppData>
    return normalizeAppData({
      ...emptyData,
      ...parsed,
      settings: {
        ...defaultSettings,
        ...parsed.settings,
        supplierPurchaseCurrency: normalizeSupplierCurrency(
          parsed.settings?.supplierPurchaseCurrency,
        ),
      },
      parties: (parsed.parties ?? []).map((party) => ({
        ...party,
        category: normalizePartyCategory(party.category),
      })),
      activityLogs: (parsed.activityLogs ?? []).map((log) => ({
        ...log,
        userName: log.userName ?? 'Unknown',
        oldValue: log.oldValue ?? '',
        newValue: log.newValue ?? '',
      })),
    } as AppData)
  } catch {
    return emptyData
  }
}

export function saveData(data: AppData) {
  localStorage.setItem(activeStorageKey(), JSON.stringify(data))
}

export function createActivity(
  action: string,
  details: string,
  userName: string,
  oldValue = '',
  newValue = '',
): ActivityLog {
  return {
    id: id(),
    action,
    details,
    userName,
    oldValue,
    newValue,
    createdAt: now(),
  }
}

export function withNewParty(
  party: Omit<Party, 'id' | 'createdAt' | 'updatedAt'>,
): Party {
  const createdAt = now()

  return {
    ...party,
    category: normalizePartyCategory(party.category),
    id: id(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function withUpdatedParty(party: Party): Party {
  return {
    ...party,
    category: normalizePartyCategory(party.category),
    updatedAt: now(),
  }
}

export function withNewPurchase(
  purchase: Omit<ImportPurchase, 'id' | 'createdAt' | 'updatedAt'>,
): ImportPurchase {
  const createdAt = now()

  return {
    ...purchase,
    supplierCurrency: normalizeSupplierCurrency(purchase.supplierCurrency),
    freightIndiaStatus: normalizeFreightIndiaStatus(purchase.freightIndiaStatus),
    freightIndiaPartyId: purchase.freightIndiaPartyId ?? '',
    totalKg: Number(purchase.totalKg ?? 0),
    loadingUnloadingChargePerKg: Number(purchase.loadingUnloadingChargePerKg ?? 0),
    loadingUnloadingChargeNPR: Number(purchase.loadingUnloadingChargeNPR ?? 0),
    appliedVatRate: Number(purchase.appliedVatRate ?? defaultSettings.agentServiceVatRate),
    appliedExchangeRate: Number(purchase.appliedExchangeRate ?? purchase.supplierExchangeRate ?? defaultSettings.defaultExchangeRate),
    calculationVersion: purchase.calculationVersion || 'legacy-migrated-v1',
    calculatedAt: purchase.calculatedAt || createdAt,
    lifecycleStatus: purchase.lifecycleStatus ?? 'POSTED',
    postedAt: purchase.postedAt ?? createdAt,
    postedBy: purchase.postedBy ?? '',
    voidedAt: purchase.voidedAt ?? '',
    reversedAt: purchase.reversedAt ?? '',
    reversalReason: purchase.reversalReason ?? '',
    replacementTransactionId: purchase.replacementTransactionId ?? '',
    id: id(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function withUpdatedPurchase(purchase: ImportPurchase): ImportPurchase {
  return {
    ...purchase,
    supplierCurrency: normalizeSupplierCurrency(purchase.supplierCurrency),
    freightIndiaStatus: normalizeFreightIndiaStatus(purchase.freightIndiaStatus),
    freightIndiaPartyId: purchase.freightIndiaPartyId ?? '',
    totalKg: Number(purchase.totalKg ?? 0),
    loadingUnloadingChargePerKg: Number(purchase.loadingUnloadingChargePerKg ?? 0),
    loadingUnloadingChargeNPR: Number(purchase.loadingUnloadingChargeNPR ?? 0),
    appliedVatRate: Number(purchase.appliedVatRate ?? defaultSettings.agentServiceVatRate),
    appliedExchangeRate: Number(purchase.appliedExchangeRate ?? purchase.supplierExchangeRate ?? defaultSettings.defaultExchangeRate),
    calculationVersion: purchase.calculationVersion || 'legacy-migrated-v1',
    calculatedAt: purchase.calculatedAt || purchase.updatedAt || now(),
    updatedAt: now(),
  }
}

export function withNewLocalExpense(
  localExpense: Omit<LocalPurchaseExpense, 'id' | 'createdAt' | 'updatedAt'>,
): LocalPurchaseExpense {
  const createdAt = now()

  return {
    ...localExpense,
    lifecycleStatus: localExpense.lifecycleStatus ?? 'POSTED',
    postedAt: localExpense.postedAt ?? createdAt,
    postedBy: localExpense.postedBy ?? '',
    voidedAt: localExpense.voidedAt ?? '',
    reversedAt: localExpense.reversedAt ?? '',
    reversalReason: localExpense.reversalReason ?? '',
    replacementTransactionId: localExpense.replacementTransactionId ?? '',
    id: id(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function withUpdatedLocalExpense(localExpense: LocalPurchaseExpense): LocalPurchaseExpense {
  return {
    ...localExpense,
    updatedAt: now(),
  }
}

export function withNewPayment(
  payment: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>,
): Payment {
  const createdAt = now()

  return {
    ...payment,
    paymentMethod: normalizePaymentMethod(payment.paymentMethod),
    lifecycleStatus: payment.lifecycleStatus ?? 'POSTED',
    postedAt: payment.postedAt ?? createdAt,
    postedBy: payment.postedBy ?? '',
    voidedAt: payment.voidedAt ?? '',
    reversedAt: payment.reversedAt ?? '',
    reversalReason: payment.reversalReason ?? '',
    replacementTransactionId: payment.replacementTransactionId ?? '',
    id: id(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function createPaymentAllocation(
  allocation: Omit<PaymentAllocation, 'id' | 'createdAt' | 'updatedAt'>,
): PaymentAllocation {
  const createdAt = now()

  return {
    ...allocation,
    id: id(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function withUpdatedPayment(payment: Payment): Payment {
  return {
    ...payment,
    paymentMethod: normalizePaymentMethod(payment.paymentMethod),
    updatedAt: now(),
  }
}

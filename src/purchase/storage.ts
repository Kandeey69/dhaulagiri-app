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
} from './domain'
import { companyStorageKey } from '../companyContext'

const storageKey = 'easysolution-import-purchase-app-v1'
const activeStorageKey = () => companyStorageKey(storageKey)

const emptyData: AppData = {
  settings: defaultSettings,
  parties: [],
  purchases: [],
  localExpenses: [],
  payments: [],
  activityLogs: [],
}

const id = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const now = () => new Date().toISOString()

export function createId() {
  return id()
}

export function loadData(): AppData {
    const saved = localStorage.getItem(activeStorageKey())

  if (!saved) {
    return emptyData
  }

  try {
    const parsed = JSON.parse(saved) as Partial<AppData>
    return {
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
      purchases: (parsed.purchases ?? []).map((purchase) => ({
        ...purchase,
        supplierCurrency: normalizeSupplierCurrency(purchase.supplierCurrency),
        freightIndiaStatus: normalizeFreightIndiaStatus(purchase.freightIndiaStatus),
        freightIndiaPartyId: purchase.freightIndiaPartyId ?? '',
      })),
      payments: (parsed.payments ?? []).map((payment) => ({
        ...payment,
        paymentMethod: normalizePaymentMethod(payment.paymentMethod),
      })),
      localExpenses: (parsed.localExpenses ?? []).map((localExpense) => ({
        ...localExpense,
        expenseType: localExpense.expenseType ?? 'Expense',
      })),
      activityLogs: (parsed.activityLogs ?? []).map((log) => ({
        ...log,
        userName: log.userName ?? 'Unknown',
        oldValue: log.oldValue ?? '',
        newValue: log.newValue ?? '',
      })),
    }
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
    updatedAt: now(),
  }
}

export function withNewLocalExpense(
  localExpense: Omit<LocalPurchaseExpense, 'id' | 'createdAt' | 'updatedAt'>,
): LocalPurchaseExpense {
  const createdAt = now()

  return {
    ...localExpense,
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

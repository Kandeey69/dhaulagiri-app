export type PartyCategory =
  | 'Indian Suppliers'
  | 'Custom Agent'
  | 'Indian Transport'
  | 'Local Suppliers'
  | 'Other'

export type FreightIndiaStatus =
  | 'Paid by custom agent'
  | 'To be paid by us'

export type PaymentType =
  | 'Indian Supplier Payment'
  | 'Custom Agent Payment'
  | 'Freight Payment'
  | 'Other Supplier Payment'

export type PaymentMethod = 'Nabil Bank' | 'Kamana Sewa Bank' | 'Everest Bank'
export type SupplierCurrency = 'INR' | 'USD'
export type Currency = 'NPR' | 'INR' | 'USD' | 'INR/IC'
export type LocalExpenseType = 'Fixed Asset' | 'Expense'
export type TransactionLifecycleStatus = import('../domain/lifecycle').TransactionLifecycleStatus

export type Party = {
  id: string
  name: string
  address: string
  phone: string
  panVatNo: string
  country: string
  category: PartyCategory
  openingPayable: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ImportPurchase = {
  id: string
  fiscalYearId: string
  lifecycleStatus?: TransactionLifecycleStatus
  vendorPartyId: string
  vendorBillNumber: string
  billDate: string
  supplierCurrency: SupplierCurrency
  amountIC: number
  supplierExchangeRate: number
  supplierAmountNPR: number
  customAgentPartyId: string
  debitNoteNumber: string
  debitNoteDate: string
  importDutyNPR: number
  customServiceNPR: number
  importVatNPR: number
  terminalChargeWithoutVatNPR: number
  terminalVatNPR: number
  totalTerminalChargeNPR: number
  freightIndiaStatus: FreightIndiaStatus
  freightIndiaPartyId: string
  freightIndiaAmountIC: number
  freightIndiaExchangeRate: number
  freightIndiaAmountNPR: number
  totalKg: number
  loadingUnloadingChargePerKg: number
  loadingUnloadingChargeNPR: number
  otherChargesNPR: number
  debitNoteTotalNPR: number
  agentServiceBillNumber: string
  agentServiceBillDate: string
  agentServiceAmountBeforeVatNPR: number
  agentServiceVatNPR: number
  agentServiceTotalNPR: number
  totalAgentPayableNPR: number
  totalInputVatNPR: number
  landedCostNPR: number
  appliedVatRate: number
  appliedExchangeRate: number
  calculationVersion: string
  calculatedAt: string
  postedAt?: string
  postedBy?: string
  voidedAt?: string
  reversedAt?: string
  reversalReason?: string
  replacementTransactionId?: string
  remarks: string
  createdAt: string
  updatedAt: string
}

export type Payment = {
  id: string
  fiscalYearId: string
  lifecycleStatus?: TransactionLifecycleStatus
  partyId: string
  paymentDate: string
  paymentType: PaymentType
  currency: Currency
  amount: number
  exchangeRate: number
  amountNPR: number
  paymentMethod: PaymentMethod
  referenceNumber: string
  remarks: string
  postedAt?: string
  postedBy?: string
  voidedAt?: string
  reversedAt?: string
  reversalReason?: string
  replacementTransactionId?: string
  createdAt: string
  updatedAt: string
}

export type PaymentAllocation = {
  id: string
  paymentId: string
  purchaseId: string
  amountNPR: number
  createdAt: string
  updatedAt: string
}

export type LocalPurchaseExpense = {
  id: string
  fiscalYearId: string
  lifecycleStatus?: TransactionLifecycleStatus
  partyId: string
  billNumber: string
  billDate: string
  expenseType: LocalExpenseType
  expenseHead: string
  amountBeforeVatNPR: number
  vatNPR: number
  totalAmountNPR: number
  remarks: string
  postedAt?: string
  postedBy?: string
  voidedAt?: string
  reversedAt?: string
  reversalReason?: string
  replacementTransactionId?: string
  createdAt: string
  updatedAt: string
}

export type ActivityLog = {
  id: string
  action: string
  details: string
  userName: string
  oldValue: string
  newValue: string
  createdAt: string
  metadata?: string
}

export type AppSettings = {
  companyName: string
  fiscalYear: string
  defaultExchangeRate: number
  supplierPurchaseCurrency: SupplierCurrency
  panVatNo: string
  address: string
  phone: string
  agentServiceVatRate: number
}

export type AppData = {
  settings: AppSettings
  parties: Party[]
  fiscalYears: import('../domain/fiscalYear').FiscalYear[]
  purchases: ImportPurchase[]
  localExpenses: LocalPurchaseExpense[]
  payments: Payment[]
  paymentAllocations: PaymentAllocation[]
  ledgerEntries: import('../domain/ledger').LedgerEntry[]
  activityLogs: ActivityLog[]
}

export const defaultSettings: AppSettings = {
  companyName: '',
  fiscalYear: '2082/83',
  defaultExchangeRate: 1.6015,
  supplierPurchaseCurrency: 'INR',
  panVatNo: '',
  address: '',
  phone: '',
  agentServiceVatRate: 13,
}

export const partyCategories: PartyCategory[] = [
  'Indian Suppliers',
  'Custom Agent',
  'Indian Transport',
  'Local Suppliers',
]

export const countries = ['Nepal', 'India']

export const freightIndiaStatuses: FreightIndiaStatus[] = [
  'Paid by custom agent',
  'To be paid by us',
]

export const paymentTypes: PaymentType[] = [
  'Indian Supplier Payment',
  'Custom Agent Payment',
  'Freight Payment',
  'Other Supplier Payment',
]

export const paymentMethods: PaymentMethod[] = ['Nabil Bank', 'Kamana Sewa Bank', 'Everest Bank']
export const supplierCurrencies: SupplierCurrency[] = ['INR', 'USD']

export const currencies: Currency[] = ['NPR', 'INR/IC']
export const localExpenseTypes: LocalExpenseType[] = ['Fixed Asset', 'Expense']

export function normalizePartyCategory(value: unknown): PartyCategory {
  const category = String(value ?? '').trim()

  if (category === 'Indian Supplier' || category === 'Indian Suppliers') {
    return 'Indian Suppliers'
  }

  if (category === 'Local Supplier' || category === 'Local Suppliers') {
    return 'Local Suppliers'
  }

  if (category === 'Custom Agent') {
    return 'Custom Agent'
  }

  if (category === 'Freight Vendor' || category === 'Indian Transport') {
    return 'Indian Transport'
  }

  return 'Other'
}

export function normalizeFreightIndiaStatus(value: unknown): FreightIndiaStatus {
  const status = String(value ?? '').trim()

  if (status === 'To be paid by us' || status === 'Paid directly by us') {
    return 'To be paid by us'
  }

  return 'Paid by custom agent'
}

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  const method = String(value ?? '').trim()

  if (method.toUpperCase() === 'NABIL BANK') {
    return 'Nabil Bank'
  }

  if (method === 'Kamana Sewa Bank' || method === 'Everest Bank') {
    return method
  }

  return 'Nabil Bank'
}

export function normalizeSupplierCurrency(value: unknown): SupplierCurrency {
  return String(value ?? '').trim().toUpperCase() === 'USD' ? 'USD' : 'INR'
}

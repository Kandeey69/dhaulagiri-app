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
export type Currency = 'NPR' | 'INR/IC'
export type LocalExpenseType = 'Fixed Asset' | 'Expense'

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
  vendorPartyId: string
  vendorBillNumber: string
  billDate: string
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
  freightIndiaAmountIC: number
  freightIndiaExchangeRate: number
  freightIndiaAmountNPR: number
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
  remarks: string
  createdAt: string
  updatedAt: string
}

export type Payment = {
  id: string
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
  createdAt: string
  updatedAt: string
}

export type LocalPurchaseExpense = {
  id: string
  partyId: string
  billNumber: string
  billDate: string
  expenseType: LocalExpenseType
  expenseHead: string
  amountBeforeVatNPR: number
  vatNPR: number
  totalAmountNPR: number
  remarks: string
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
}

export type AppSettings = {
  companyName: string
  fiscalYear: string
  defaultExchangeRate: number
  panVatNo: string
  address: string
  phone: string
  agentServiceVatRate: number
}

export type AppData = {
  settings: AppSettings
  parties: Party[]
  purchases: ImportPurchase[]
  localExpenses: LocalPurchaseExpense[]
  payments: Payment[]
  activityLogs: ActivityLog[]
}

export const defaultSettings: AppSettings = {
  companyName: 'Dhaulagiri',
  fiscalYear: '2082/83',
  defaultExchangeRate: 1.6,
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

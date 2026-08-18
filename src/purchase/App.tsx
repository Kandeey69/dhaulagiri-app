import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import './App.css'
import {
  calculatePurchaseComputedTotals,
  hasAgentValues,
  isAgentPayment,
  isSupplierPayment,
} from './calculations'
import {
  createPurchaseCalculationPolicy,
  freightCreatesTransporterPayable,
} from '../domain/accountingPolicy'
import {
  createFiscalYearFromCode,
  ensureFiscalYearEditable,
  isBsDateInFiscalYear,
  validateDateInFiscalYear,
} from '../domain/fiscalYear'
import { validatePaymentDomain, type FieldError } from '../domain/validation'
import {
  postLocalExpense,
  postPurchase,
  postSupplierPayment,
  type LedgerEntry,
} from '../domain/ledger'
import { createDraftKey } from '../application/draftAutosave'
import { validatePurchaseFormForUi, validationMessagesByField } from '../application/purchaseFormValidation'
import { availableTransactionActions } from '../application/transactionActions'
import { AppContextBar } from '../components/AppContextBar'
import { TransactionStatusBadge } from '../components/StatusBadge'
import { ValidationSummary } from '../components/ValidationSummary'
import { FreightTreatmentExplanation } from '../features/purchases/FreightTreatmentExplanation'
import { PurchaseCalculationSummary } from '../features/purchases/PurchaseCalculationSummary'
import { useDraftAutosave } from '../hooks/useDraftAutosave'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { scrollToPageTop } from '../scroll'
import {
  countries,
  defaultSettings,
  freightIndiaStatuses,
  localExpenseTypes,
  normalizeFreightIndiaStatus,
  normalizePartyCategory,
  normalizeSupplierCurrency,
  partyCategories,
  paymentMethods,
  supplierCurrencies,
  type AppData,
  type AppSettings,
  type FreightIndiaStatus,
  type ImportPurchase,
  type LocalPurchaseExpense,
  type Party,
  type PartyCategory,
  type Payment,
  type PaymentMethod,
  type SupplierCurrency,
} from './domain'
import {
  createDataRepository,
  getEmptyData,
  type DataRepository,
} from './repository'
import {
  createActivity,
  createId,
  withNewLocalExpense,
  withNewParty,
  withNewPayment,
  withNewPurchase,
  withUpdatedLocalExpense,
  withUpdatedParty,
  withUpdatedPayment,
  withUpdatedPurchase,
} from './storage'
import { getActiveCompanyId, getActiveCompanyProfile, getActivePurchaseDatabaseUrl } from '../companyContext'
import LineItemPreviewModal from '../stock/LineItemPreviewModal'
import { buildStatuses } from '../stock/services/stockCalculations'
import { buildStockEntryTarget } from '../stock/services/stockDocuments'
import { isInventoryTrackingEnabled } from '../stock/settings'
import {
  deleteStockPurchaseLinesForDocument,
  getStockItems,
  getStockPurchaseBills,
} from '../stock/storage'
import type { StockDocumentStatus, StockEntryTarget, StockItem, StockPurchaseBill } from '../stock/types'

type View =
  | 'Dashboard'
  | 'Party Master'
  | 'Import Purchase Entry'
  | 'Payment Entry'
  | 'Local Purchase / Expense'
  | 'Data Importation'
  | 'Reports'
  | 'Settings'
  | 'Activity Logs'

type UserRole = 'Account' | 'Master'

type ReportView =
  | 'Import Purchase Summary'
  | 'Payables'
  | 'Party Ledger'
  | 'Input VAT'
  | 'Landed Cost'

type SortDirection = 'asc' | 'desc'
type SortState<T extends string> = { key: T | null; direction: SortDirection }
type PurchasePartySortKey = 'name' | 'category' | 'country' | 'phone' | 'panVatNo' | 'openingPayable' | 'status'
type ImportPurchaseSortKey = 'vendor' | 'bill' | 'supplierAmount' | 'pragapanpatra' | 'inputVat' | 'landedCost' | 'status' | 'inventory'
type PaymentSortKey = 'date' | 'party' | 'currency' | 'amount' | 'amountNpr' | 'bank' | 'reference' | 'status'
type LocalExpenseSortKey = 'date' | 'supplier' | 'bill' | 'heading' | 'kind' | 'beforeVat' | 'vat' | 'total' | 'inventory'

type PartyForm = Omit<Party, 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

type PartyImportResult = {
  action: 'Imported' | 'Updated'
  name: string
  category: string
  country: string
  openingPayable: number
  status: string
}

type PurchaseImportResult = {
  status: 'Imported' | 'Skipped'
  line: number
  vendor: string
  billNumber: string
  billDate: string
  supplierAmountNPR: number
  customAgent: string
  indianTransport: string
  pragapanpatraNumber: string
  debitNoteTotalNPR: number
  agentServiceTotalNPR: number
  totalInputVatNPR: number
  landedCostNPR: number
  remarks: string
}

type PaymentImportResult = {
  status: 'Imported' | 'Skipped'
  line: number
  mode: string
  party: string
  paymentDate: string
  paymentType: Payment['paymentType'] | '-'
  currency: Payment['currency'] | '-'
  amount: number
  amountNPR: number
  paymentMethod: string
  referenceNumber: string
  remarks: string
}

type QuickLocalSupplierForm = {
  name: string
  phone: string
  panVatNo: string
  openingPayable: number
}

const emptyParty: PartyForm = {
  id: '',
  name: '',
  address: '',
  phone: '',
  panVatNo: '',
  country: 'India',
  category: 'Indian Suppliers',
  openingPayable: 0,
  isActive: true,
}

const emptyQuickLocalSupplier: QuickLocalSupplierForm = {
  name: '',
  phone: '',
  panVatNo: '',
  openingPayable: 0,
}

const createEmptyPurchase = (settings: AppSettings = defaultSettings): ImportPurchase => ({
  id: '',
  fiscalYearId: '',
  lifecycleStatus: 'DRAFT',
  vendorPartyId: '',
  vendorBillNumber: '',
  billDate: '',
  supplierCurrency: settings.supplierPurchaseCurrency,
  amountIC: 0,
  supplierExchangeRate:
    settings.supplierPurchaseCurrency === 'USD' ? 0 : settings.defaultExchangeRate,
  supplierAmountNPR: 0,
  customAgentPartyId: '',
  debitNoteNumber: '',
  debitNoteDate: '',
  importDutyNPR: 0,
  customServiceNPR: 0,
  importVatNPR: 0,
  terminalChargeWithoutVatNPR: 0,
  terminalVatNPR: 0,
  totalTerminalChargeNPR: 0,
  freightIndiaStatus: 'Paid by custom agent',
  freightIndiaPartyId: '',
  freightIndiaAmountIC: 0,
  freightIndiaExchangeRate: settings.defaultExchangeRate,
  freightIndiaAmountNPR: 0,
  totalKg: 0,
  loadingUnloadingChargePerKg: 0,
  loadingUnloadingChargeNPR: 0,
  otherChargesNPR: 0,
  debitNoteTotalNPR: 0,
  agentServiceBillNumber: '',
  agentServiceBillDate: '',
  agentServiceAmountBeforeVatNPR: 0,
  agentServiceVatNPR: 0,
  agentServiceTotalNPR: 0,
  totalAgentPayableNPR: 0,
  totalInputVatNPR: 0,
  landedCostNPR: 0,
  appliedVatRate: settings.agentServiceVatRate,
  appliedExchangeRate: settings.defaultExchangeRate,
  calculationVersion: 'purchase-policy-v1',
  calculatedAt: '',
  postedAt: '',
  postedBy: '',
  voidedAt: '',
  reversedAt: '',
  reversalReason: '',
  replacementTransactionId: '',
  remarks: '',
  createdAt: '',
  updatedAt: '',
})

const createEmptyPayment = (): Payment => ({
  id: '',
  fiscalYearId: '',
  lifecycleStatus: 'DRAFT',
  partyId: '',
  paymentDate: '',
  paymentType: 'Indian Supplier Payment',
  currency: 'NPR',
  amount: 0,
  exchangeRate: 1,
  amountNPR: 0,
  paymentMethod: 'Nabil Bank',
  referenceNumber: '',
  remarks: '',
  postedAt: '',
  postedBy: '',
  voidedAt: '',
  reversedAt: '',
  reversalReason: '',
  replacementTransactionId: '',
  createdAt: '',
  updatedAt: '',
})

const createEmptyLocalExpense = (): LocalPurchaseExpense => ({
  id: '',
  fiscalYearId: '',
  lifecycleStatus: 'DRAFT',
  partyId: '',
  billNumber: '',
  billDate: '',
  expenseType: 'Expense',
  expenseHead: '',
  amountBeforeVatNPR: 0,
  vatNPR: 0,
  totalAmountNPR: 0,
  remarks: '',
  postedAt: '',
  postedBy: '',
  voidedAt: '',
  reversedAt: '',
  reversalReason: '',
  replacementTransactionId: '',
  createdAt: '',
  updatedAt: '',
})

const viewItems: View[] = [
  'Dashboard',
  'Import Purchase Entry',
  'Payment Entry',
  'Local Purchase / Expense',
  'Data Importation',
  'Reports',
  'Party Master',
  'Activity Logs',
]

const accountViewItems: View[] = [
  'Dashboard',
  'Import Purchase Entry',
  'Payment Entry',
  'Local Purchase / Expense',
  'Reports',
  'Party Master',
]

const reportItems: ReportView[] = [
  'Party Ledger',
  'Input VAT',
  'Payables',
  'Import Purchase Summary',
  'Landed Cost',
]

const n = (value: unknown) => {
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
  return Number.isFinite(parsed) ? parsed : 0
}

const fmt = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)

const rateFmt = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value || 0)

const npr = (value: number) => `NPR ${fmt(value)}`
const ic = (value: number) => `IC ${fmt(value)}`
const supplierMoney = (value: number, currency: SupplierCurrency) => `${currency} ${fmt(value)}`
const vatRateDecimal = (settings: AppSettings) => Math.max(0, n(settings.agentServiceVatRate)) / 100
const vatRateLabel = (settings: AppSettings) =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(n(settings.agentServiceVatRate))
const formatCompact = (value: number) =>
  Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 0,
    notation: 'compact',
  })
const dateText = (value: string) => value || '-'
const auditValue = (value: unknown) => {
  const text = JSON.stringify(value ?? '', null, 0)
  return text.length > 900 ? `${text.slice(0, 897)}...` : text
}
const sqliteFilenameFromUrl = (databaseUrl: string) => databaseUrl.replace(/^sqlite:/, '')
const normalizeBsDate = (value: string, keepHyphen = false) => {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)

  if (!match) {
    return raw
  }

  const [, year, monthText, dayText] = match
  const month = Number(monthText)
  const day = Number(dayText)

  if (month < 1 || month > 12 || day < 1 || day > 32) {
    return raw
  }

  const separator = keepHyphen ? '-' : '/'
  return `${year}${separator}${String(month).padStart(2, '0')}${separator}${String(day).padStart(2, '0')}`
}
const normalizeImportedDate = (value: string, keepHyphen = false) => {
  return normalizeBsDate(value, keepHyphen)
}
const latestDateFirst = (left: string, right: string) =>
  (right || '0000/00/00').localeCompare(left || '0000/00/00')
const oldestDateFirst = (left: string, right: string) =>
  (left || '0000/00/00').localeCompare(right || '0000/00/00')
const importPurchaseSortDate = (purchase: ImportPurchase) =>
  purchase.debitNoteDate || purchase.billDate
const latestImportPurchaseFirst = (left: ImportPurchase, right: ImportPurchase) =>
  latestDateFirst(importPurchaseSortDate(left), importPurchaseSortDate(right))
const sortFactor = (direction: SortDirection) => (direction === 'asc' ? 1 : -1)
const compareText = (left: unknown, right: unknown, direction: SortDirection) =>
  String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  }) * sortFactor(direction)
const compareNumber = (left: unknown, right: unknown, direction: SortDirection) =>
  (n(left) - n(right)) * sortFactor(direction)
const comparePurchaseParties = (
  left: Party,
  right: Party,
  key: PurchasePartySortKey,
  direction: SortDirection,
) => {
  switch (key) {
    case 'name':
      return compareText(left.name, right.name, direction)
    case 'category':
      return compareText(left.category, right.category, direction)
    case 'country':
      return compareText(left.country, right.country, direction)
    case 'phone':
      return compareText(left.phone, right.phone, direction)
    case 'panVatNo':
      return compareText(left.panVatNo, right.panVatNo, direction)
    case 'openingPayable':
      return compareNumber(left.openingPayable, right.openingPayable, direction)
    case 'status':
      return compareText(left.isActive ? 'Active' : 'Inactive', right.isActive ? 'Active' : 'Inactive', direction)
    default:
      return 0
  }
}
const compareImportPurchases = (
  left: ImportPurchase,
  right: ImportPurchase,
  key: ImportPurchaseSortKey,
  direction: SortDirection,
  partyName: (id: string) => string,
  stockStatuses: Map<string, StockDocumentStatus>,
  stockKey: (documentId: string, sourceType: 'Import Purchase' | 'Local Purchase') => string,
) => {
  switch (key) {
    case 'vendor':
      return compareText(partyName(left.vendorPartyId), partyName(right.vendorPartyId), direction)
    case 'bill':
      return compareText(left.vendorBillNumber, right.vendorBillNumber, direction)
    case 'supplierAmount':
      return compareNumber(left.amountIC, right.amountIC, direction)
    case 'pragapanpatra':
      return compareText(left.debitNoteNumber, right.debitNoteNumber, direction)
    case 'inputVat':
      return compareNumber(left.totalInputVatNPR, right.totalInputVatNPR, direction)
    case 'landedCost':
      return compareNumber(left.landedCostNPR, right.landedCostNPR, direction)
    case 'status':
      return compareText(left.lifecycleStatus ?? 'POSTED', right.lifecycleStatus ?? 'POSTED', direction)
    case 'inventory':
      return compareText(
        stockStatuses.get(stockKey(left.id, 'Import Purchase'))?.status ?? 'Pending',
        stockStatuses.get(stockKey(right.id, 'Import Purchase'))?.status ?? 'Pending',
        direction,
      )
    default:
      return 0
  }
}
const comparePayments = (
  left: Payment,
  right: Payment,
  key: PaymentSortKey,
  direction: SortDirection,
  partyName: (id: string) => string,
) => {
  switch (key) {
    case 'date':
      return compareText(left.paymentDate, right.paymentDate, direction)
    case 'party':
      return compareText(partyName(left.partyId), partyName(right.partyId), direction)
    case 'currency':
      return compareText(left.currency, right.currency, direction)
    case 'amount':
      return compareNumber(left.amount, right.amount, direction)
    case 'amountNpr':
      return compareNumber(left.amountNPR, right.amountNPR, direction)
    case 'bank':
      return compareText(left.paymentMethod, right.paymentMethod, direction)
    case 'reference':
      return compareText(left.referenceNumber, right.referenceNumber, direction)
    case 'status':
      return compareText(left.lifecycleStatus ?? 'POSTED', right.lifecycleStatus ?? 'POSTED', direction)
    default:
      return 0
  }
}
const compareLocalExpenses = (
  left: LocalPurchaseExpense,
  right: LocalPurchaseExpense,
  key: LocalExpenseSortKey,
  direction: SortDirection,
  partyName: (id: string) => string,
  stockStatuses: Map<string, StockDocumentStatus>,
  stockKey: (documentId: string, sourceType: 'Import Purchase' | 'Local Purchase') => string,
) => {
  switch (key) {
    case 'date':
      return compareText(left.billDate, right.billDate, direction)
    case 'supplier':
      return compareText(partyName(left.partyId), partyName(right.partyId), direction)
    case 'bill':
      return compareText(left.billNumber, right.billNumber, direction)
    case 'heading':
      return compareText(left.expenseType ?? 'Expense', right.expenseType ?? 'Expense', direction)
    case 'kind':
      return compareText(left.expenseHead, right.expenseHead, direction)
    case 'beforeVat':
      return compareNumber(left.amountBeforeVatNPR, right.amountBeforeVatNPR, direction)
    case 'vat':
      return compareNumber(left.vatNPR, right.vatNPR, direction)
    case 'total':
      return compareNumber(left.totalAmountNPR, right.totalAmountNPR, direction)
    case 'inventory':
      return compareText(
        stockStatuses.get(stockKey(left.id, 'Local Purchase'))?.status ?? 'Pending',
        stockStatuses.get(stockKey(right.id, 'Local Purchase'))?.status ?? 'Pending',
        direction,
      )
    default:
      return 0
  }
}

const isLocalPurchaseStock = (localExpense: LocalPurchaseExpense) => localExpense.expenseType === 'Stock'

const ledgerDateFirst = (
  left: { date: string; type: string },
  right: { date: string; type: string },
) => {
  if (left.type === 'Opening Balance') return -1
  if (right.type === 'Opening Balance') return 1
  return oldestDateFirst(left.date, right.date)
}

const bsMonths = [
  { value: '', label: 'All months' },
  { value: '01', label: '1 - Baishak' },
  { value: '02', label: '2 - Jestha' },
  { value: '03', label: '3 - Ashadh' },
  { value: '04', label: '4 - Shrawan' },
  { value: '05', label: '5 - Bhadra' },
  { value: '06', label: '6 - Ashwin' },
  { value: '07', label: '7 - Kartik' },
  { value: '08', label: '8 - Mangsir' },
  { value: '09', label: '9 - Poush' },
  { value: '10', label: '10 - Magh' },
  { value: '11', label: '11 - Falgun' },
  { value: '12', label: '12 - Chaitra' },
]

const bsMonthFromDate = (date: string) => {
  const [year = '', month = ''] = String(date ?? '').split(/[/-]/)

  if (Number(year) < 2070 || Number(year) > 2099) {
    return ''
  }

  return month.padStart(2, '0')
}

const bsMonthLabel = (date: string) => {
  const month = bsMonthFromDate(date)
  return bsMonths.find((item) => item.value === month)?.label ?? '-'
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isIndianSupplierCategory = (party: Party) =>
  party.category === 'Indian Suppliers'

const isCustomAgentCategory = (party: Party) => party.category === 'Custom Agent'
const isIndianTransportCategory = (party: Party) => party.category === 'Indian Transport'
const paymentTypeForNonSupplierParty = (party: Party | undefined): Payment['paymentType'] => {
  if (!party) {
    return 'Other Supplier Payment'
  }

  if (isCustomAgentCategory(party)) {
    return 'Custom Agent Payment'
  }

  if (isIndianTransportCategory(party)) {
    return 'Freight Payment'
  }

  return 'Other Supplier Payment'
}

const shouldCreditIndianTransport = (status: FreightIndiaStatus) =>
  freightCreatesTransporterPayable(status)

const includeSelectedParty = (parties: Party[], selectedPartyId: string, partyById: Map<string, Party>) => {
  const selectedParty = partyById.get(selectedPartyId)
  return selectedParty && !parties.some((party) => party.id === selectedParty.id)
    ? [...parties, selectedParty]
    : parties
}

const moveEnterToNextField = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Enter') {
    return
  }

  const target = event.target

  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return
  }

  event.preventDefault()

  const container = target.closest('form') ?? target.closest('.app-shell') ?? document
  const fields = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])',
    ),
  ).filter((field) => field.offsetParent !== null)
  const currentIndex = fields.indexOf(target)
  const nextField = currentIndex >= 0 ? fields[currentIndex + 1] : undefined

  nextField?.focus()
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (blob: Blob) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

const sanitizeFileName = (value: string) =>
  value.replace(/[<>:"/\\|?*]+/g, '').trim() || 'export'

const todayForFileName = () => new Date().toISOString().slice(0, 10)

async function saveBlobWithPicker(fileName: string, blob: Blob, description: string) {
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker

  if (savePicker) {
    const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : ''
    const mimeType = blob.type.split(';')[0] || 'application/octet-stream'
    const handle = await savePicker({
      suggestedName: fileName,
      types: [
        {
          description,
          accept: { [mimeType]: [extension] },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const csvEscape = (value: unknown) => {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const toCsv = (rows: string[][]) => rows.map((row) => row.map(csvEscape).join(',')).join('\n')

const parseCsv = (text: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell.trim())
      if (row.some(Boolean)) {
        rows.push(row)
      }
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell.trim())
  if (row.some(Boolean)) {
    rows.push(row)
  }

  return rows
}

const rowsToObjects = (rows: string[][]) => {
  const [headers = [], ...records] = rows
  const normalizedHeaders = headers.map((header) => normalizeCsvHeader(header))

  return records.map((record) =>
    Object.fromEntries(
      normalizedHeaders.map((header, index) => [header, record[index]?.trim() ?? '']),
    ),
  )
}

const parseBoolean = (value: string) =>
  !value || ['yes', 'true', '1', 'active'].includes(value.trim().toLowerCase())

const normalizeKey = (value: string) => value.trim().toLowerCase()
const normalizeCsvHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
const paymentMethodLookup = new Map(
  paymentMethods.map((method) => [normalizeKey(method), method] as const),
)
const resolvePaymentMethod = (value: string) => {
  if (!value.trim()) {
    return undefined
  }

  const directMatch = paymentMethodLookup.get(normalizeKey(value))

  if (directMatch) {
    return directMatch
  }

  return value.trim().toUpperCase() === 'NABIL BANK' ? 'Nabil Bank' : undefined
}
const freightStatusLookup = new Map(
  freightIndiaStatuses.map((status) => [normalizeKey(status), status] as const),
)
const resolveFreightStatus = (value: string) => {
  if (!value.trim()) {
    return undefined
  }

  return freightStatusLookup.get(normalizeKey(value)) ?? normalizeFreightIndiaStatus(value)
}

const getCsvValue = (row: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[normalizeCsvHeader(key)]

    if (value !== undefined) {
      return value.trim()
    }
  }

  return ''
}

const pdfSafe = (value: string) =>
  value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

type LedgerPdfRow = {
  date: string
  particulars: string
  debit: string
  credit: string
  balance: string
}

const fitPdfText = (value: string, maxLength: number) => {
  const text = value || '-'
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text
}

const pdfText = (text: string, x: number, y: number, size = 9, font = 'F1') =>
  `BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`

const pdfLine = (x1: number, y1: number, x2: number, y2: number) =>
  `${x1} ${y1} m ${x2} ${y2} l S`

const centeredPdfText = (text: string, y: number, size = 16, font = 'F2') => {
  const width = text.length * size * 0.28
  return pdfText(text, Math.max(40, 297 - width), y, size, font)
}

function makeLedgerPdf({
  companyName,
  fiscalYear,
  partyName,
  category,
  generatedDate,
  rows,
}: {
  companyName: string
  fiscalYear: string
  partyName: string
  category: string
  generatedDate: string
  rows: LedgerPdfRow[]
}) {
  const pageWidth = 595
  const pageHeight = 842
  const left = 36
  const top = 790
  const rowHeight = 18
const columns = [
    { label: 'Date', x: left, width: 62, max: 12 },
    { label: 'Particulars', x: left + 62, width: 191, max: 34 },
    { label: 'Debit (NPR)', x: left + 253, width: 84, max: 18, align: 'right' },
    { label: 'Credit (NPR)', x: left + 337, width: 84, max: 18, align: 'right' },
    { label: 'Net Balance (NPR)', x: left + 421, width: 102, max: 20, align: 'right' },
  ]
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0)
  const firstPageRows = 27
  const nextPageRows = 34
  const chunks: LedgerPdfRow[][] = []
  let remaining = rows.length ? [...rows] : []
  chunks.push(remaining.slice(0, firstPageRows))
  remaining = remaining.slice(firstPageRows)
  while (remaining.length) {
    chunks.push(remaining.slice(0, nextPageRows))
    remaining = remaining.slice(nextPageRows)
  }

  const pages = chunks.map((pageRows, pageIndex) => {
    const isFirstPage = pageIndex === 0
    const ops: string[] = [
      '0.2 w',
      centeredPdfText(companyName || 'Company', top, 18, 'F2'),
      centeredPdfText('Party Ledger', top - 22, 12, 'F2'),
    ]
    let y = top - 54

    if (isFirstPage) {
      ops.push(
        pdfText(`Fiscal Year: ${fiscalYear || '-'}`, left, y, 9),
        pdfText(`Party: ${partyName}`, left, y - 16, 9),
        pdfText(`Category: ${category}`, left + 270, y - 16, 9),
        pdfText(`Generated: ${generatedDate}`, left + 270, y, 9),
      )
      y -= 48
    }

    ops.push(pdfLine(left, y + 8, left + tableWidth, y + 8))
    columns.forEach((column) => {
      ops.push(pdfText(column.label, column.x + 4, y - 4, 8, 'F2'))
    })
    ops.push(pdfLine(left, y - 12, left + tableWidth, y - 12))
    y -= 28

    pageRows.forEach((row) => {
      const values = [
        fitPdfText(row.date || '-', columns[0].max),
        fitPdfText(row.particulars, columns[1].max),
        fitPdfText(row.debit, columns[2].max),
        fitPdfText(row.credit, columns[3].max),
        fitPdfText(row.balance, columns[4].max),
      ]
      values.forEach((value, index) => {
        const column = columns[index]
        const textWidth = value.length * 3.8
        const x = column.align === 'right'
          ? column.x + column.width - 4 - textWidth
          : column.x + 4
        ops.push(pdfText(value, Math.max(column.x + 4, x), y, 8))
      })
      ops.push(pdfLine(left, y - 7, left + tableWidth, y - 7))
      y -= rowHeight
    })

    columns.reduce((x, column) => {
      ops.push(pdfLine(x, isFirstPage ? top - 94 : top - 66, x, y + rowHeight - 7))
      return x + column.width
    }, left)
    ops.push(pdfLine(left + tableWidth, isFirstPage ? top - 94 : top - 66, left + tableWidth, y + rowHeight - 7))
    ops.push(pdfText(`Page ${pageIndex + 1} of ${chunks.length}`, pageWidth - 90, 28, 8))
    return ops.join('\n')
  })

  const objects: string[] = []
  const pageObjectNumbers: number[] = []
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = ''
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  pages.forEach((content, pageIndex) => {
    const pageObjectNumber = 5 + pageIndex * 2
    const contentObjectNumber = pageObjectNumber + 1
    pageObjectNumbers.push(pageObjectNumber)
    objects[pageObjectNumber - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    objects[contentObjectNumber - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })

  objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`

  const offsets = [0]
  let pdf = '%PDF-1.4\n'
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

type PurchaseAppProps = {
  initialUserRole?: UserRole;
  isReadOnly?: boolean;
  onOpenStockLineEntry?: (target: StockEntryTarget) => void;
  onBackToModules?: () => void;
  onLogout?: () => void;
};

function App({
  initialUserRole,
  isReadOnly = false,
  onOpenStockLineEntry,
  onBackToModules,
  onLogout,
}: PurchaseAppProps = {}) {
  const [data, setData] = useState<AppData>(() => getEmptyData())
  const [repository, setRepository] = useState<DataRepository | null>(null)
  const [isStorageReady, setIsStorageReady] = useState(false)
  const [userRole, setUserRole] = useState<UserRole | null>(() => initialUserRole ?? null)
  const [masterPassword, setMasterPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [view, setView] = useState<View>('Dashboard')
  const [reportView, setReportView] = useState<ReportView>('Party Ledger')
  const [globalSearch, setGlobalSearch] = useState('')
  const [dashboardEntryMessage, setDashboardEntryMessage] = useState('')
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [stockPurchaseBills, setStockPurchaseBills] = useState<StockPurchaseBill[]>([])
  const [partySort, setPartySort] = useState<SortState<PurchasePartySortKey>>({ key: null, direction: 'asc' })
  const [importPurchaseSort, setImportPurchaseSort] = useState<SortState<ImportPurchaseSortKey>>({ key: null, direction: 'asc' })
  const [paymentSort, setPaymentSort] = useState<SortState<PaymentSortKey>>({ key: null, direction: 'asc' })
  const [localExpenseSort, setLocalExpenseSort] = useState<SortState<LocalExpenseSortKey>>({ key: null, direction: 'asc' })
  const [previewStockPurchase, setPreviewStockPurchase] = useState<{
    documentId: string
    sourceType: 'Import Purchase' | 'Local Purchase'
  } | null>(null)
  const [partyForm, setPartyForm] = useState<PartyForm>(emptyParty)
  const [partySearch, setPartySearch] = useState('')
  const [partyCategoryFilter, setPartyCategoryFilter] = useState<'All' | PartyCategory>('All')
  const [purchaseForm, setPurchaseForm] = useState<ImportPurchase>(() => createEmptyPurchase())
  const [purchaseValidationErrors, setPurchaseValidationErrors] = useState<FieldError[]>([])
  const [purchaseValidationWarnings, setPurchaseValidationWarnings] = useState<FieldError[]>([])
  const [paymentForm, setPaymentForm] = useState<Payment>(() => createEmptyPayment())
  const [paymentValidationErrors, setPaymentValidationErrors] = useState<FieldError[]>([])
  const [paymentBillYear, setPaymentBillYear] = useState<'Current' | 'Last year'>('Current')
  const [paymentMode, setPaymentMode] = useState<'Indian Supplier' | 'Other Party'>('Indian Supplier')
  const [supplierPaymentCurrency, setSupplierPaymentCurrency] = useState<SupplierCurrency>('INR')
  const [supplierPaymentExchangeRate, setSupplierPaymentExchangeRate] = useState(defaultSettings.defaultExchangeRate)
  const [bankOutflowNPR, setBankOutflowNPR] = useState(0)
  const [localExpenseForm, setLocalExpenseForm] = useState<LocalPurchaseExpense>(() => createEmptyLocalExpense())
  const [quickLocalSupplierForm, setQuickLocalSupplierForm] = useState<QuickLocalSupplierForm>(emptyQuickLocalSupplier)
  const [settingsForm, setSettingsForm] = useState<AppSettings>(defaultSettings)
  const [partyImportFile, setPartyImportFile] = useState<File | null>(null)
  const [purchaseImportFile, setPurchaseImportFile] = useState<File | null>(null)
  const [indianSupplierPaymentImportFile, setIndianSupplierPaymentImportFile] = useState<File | null>(null)
  const [otherPaymentImportFile, setOtherPaymentImportFile] = useState<File | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const [partyImportResults, setPartyImportResults] = useState<PartyImportResult[]>([])
  const [purchaseImportResults, setPurchaseImportResults] = useState<PurchaseImportResult[]>([])
  const [paymentImportResults, setPaymentImportResults] = useState<PaymentImportResult[]>([])
  const [summaryFilters, setSummaryFilters] = useState({
    from: '',
    to: '',
    vendorPartyId: '',
    customAgentPartyId: '',
    billNumber: '',
    debitNoteNumber: '',
  })
  const [ledgerPartyId, setLedgerPartyId] = useState('')
  const [vatFilters, setVatFilters] = useState({ month: '' })
  const activeCompanyId = getActiveCompanyId() || 'default'
  const purchaseFiscalYearStorageKey = `purchase-selected-fiscal-year:${activeCompanyId}`
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState(() =>
    window.localStorage.getItem(purchaseFiscalYearStorageKey) ?? '',
  )
  const lastSavedSnapshotRef = useRef('')

  useEffect(() => {
    if (initialUserRole) {
      setUserRole(initialUserRole)
    }
  }, [initialUserRole])

  useEffect(() => {
    setSelectedFiscalYearId(window.localStorage.getItem(purchaseFiscalYearStorageKey) ?? '')
  }, [purchaseFiscalYearStorageKey])

  useEffect(() => {
    scrollToPageTop()
  }, [view])

  function navigateToView(nextView: View) {
    setView(nextView)
    scrollToPageTop()
  }

  useEffect(() => {
    let cancelled = false

    createDataRepository()
      .then(async (nextRepository) => {
        const loadedData = await nextRepository.loadData()

        if (!cancelled) {
          lastSavedSnapshotRef.current = JSON.stringify(loadedData)
          setRepository(nextRepository)
          setData(loadedData)
          setSettingsForm(loadedData.settings)
          setPurchaseForm(createEmptyPurchase(loadedData.settings))
          setIsStorageReady(true)
        }
      })
      .catch((error) => {
        console.error('Storage failed to initialize.', error)
        setIsStorageReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!repository || !isStorageReady) {
      return
    }

    const saveTimer = window.setTimeout(() => {
      const nextSnapshot = JSON.stringify(data)
      if (nextSnapshot === lastSavedSnapshotRef.current) {
        return
      }

      repository.saveData(data).then(() => {
        lastSavedSnapshotRef.current = nextSnapshot
      }).catch((error) => {
        console.error('Could not save app data.', error)
        window.alert(`Could not save data: ${errorMessage(error)}`)
      })
    }, 600)

    return () => window.clearTimeout(saveTimer)
  }, [data, isStorageReady, repository])

  const activeParties = data.parties.filter((party) => party.isActive)
  const indianSuppliers = activeParties.filter(isIndianSupplierCategory)
  const customAgents = activeParties.filter(isCustomAgentCategory)
  const indianTransportParties = activeParties.filter(isIndianTransportCategory)
  const indianSupplierPaymentParties = [...indianSuppliers, ...indianTransportParties]
  const localSuppliers = activeParties.filter((party) => party.category === 'Local Suppliers')
  const otherPaymentParties = activeParties.filter((party) => !isIndianSupplierCategory(party))
  const fiscalYearOptions = useMemo(() => {
    const profile = getActiveCompanyProfile()
    const code = profile?.fiscalYear || data.settings.fiscalYear || defaultSettings.fiscalYear
    const companyYears = data.fiscalYears.filter((fiscalYear) => fiscalYear.companyId === activeCompanyId)
    const candidate =
      companyYears.find((fiscalYear) => fiscalYear.code === code) ??
      companyYears.find((fiscalYear) => fiscalYear.id === data.purchases[0]?.fiscalYearId) ??
      createFiscalYearFromCode(activeCompanyId, code, isReadOnly ? 'CLOSED' : 'OPEN')

    return companyYears.some((fiscalYear) => fiscalYear.id === candidate.id)
      ? companyYears
      : [candidate, ...companyYears]
  }, [activeCompanyId, data.fiscalYears, data.purchases, data.settings.fiscalYear, isReadOnly])
  const activeFiscalYear = useMemo(() => {
    const selected =
      fiscalYearOptions.find((fiscalYear) => fiscalYear.id === selectedFiscalYearId) ??
      fiscalYearOptions.find((fiscalYear) => fiscalYear.status === 'OPEN') ??
      fiscalYearOptions[0]

    return isReadOnly ? { ...selected, status: 'CLOSED' as const } : selected
  }, [fiscalYearOptions, isReadOnly, selectedFiscalYearId])
  const isClosedFiscalYear = activeFiscalYear.status === 'CLOSED'
  const canEditOrDelete = userRole === 'Master' && !isReadOnly && !isClosedFiscalYear
  const canEditPurchase = !isReadOnly && !isClosedFiscalYear && (userRole === 'Master' || userRole === 'Account')
  const importPurchaseFiscalDate = useCallback((purchase: ImportPurchase) =>
    normalizeBsDate(purchase.debitNoteDate) || normalizeBsDate(purchase.agentServiceBillDate), [])
  const purchaseBelongsToActiveBsFiscalYear = useCallback((purchase: ImportPurchase) => {
    const fiscalDate = importPurchaseFiscalDate(purchase)
    return fiscalDate
      ? isBsDateInFiscalYear(fiscalDate, activeFiscalYear)
      : purchase.fiscalYearId === activeFiscalYear.id
  }, [activeFiscalYear, importPurchaseFiscalDate])
  const paymentBelongsToActiveBsFiscalYear = useCallback(
    (payment: Payment) => isBsDateInFiscalYear(payment.paymentDate, activeFiscalYear),
    [activeFiscalYear],
  )
  const localExpenseBelongsToActiveBsFiscalYear = useCallback(
    (localExpense: LocalPurchaseExpense) => isBsDateInFiscalYear(localExpense.billDate, activeFiscalYear),
    [activeFiscalYear],
  )

  useEffect(() => {
    if (!activeFiscalYear.id) {
      return
    }
    if (selectedFiscalYearId !== activeFiscalYear.id) {
      setSelectedFiscalYearId(activeFiscalYear.id)
    }
    window.localStorage.setItem(purchaseFiscalYearStorageKey, activeFiscalYear.id)
  }, [activeFiscalYear.id, purchaseFiscalYearStorageKey, selectedFiscalYearId])
  const isUsdSupplierMode = data.settings.supplierPurchaseCurrency === 'USD'
  const selectedSupplierCurrency: SupplierCurrency = isUsdSupplierMode
    ? normalizeSupplierCurrency(purchaseForm.supplierCurrency)
    : 'INR'
  const supplierExchangeRate = selectedSupplierCurrency === 'USD'
    ? purchaseForm.supplierExchangeRate
    : data.settings.defaultExchangeRate
  const effectivePurchaseForm = {
    ...purchaseForm,
    supplierCurrency: selectedSupplierCurrency,
    supplierExchangeRate,
    freightIndiaExchangeRate: data.settings.defaultExchangeRate,
  }
  const configuredVatRate = vatRateDecimal(data.settings)
  const purchasePolicy = createPurchaseCalculationPolicy(data.settings)
  const purchaseTotals = calculatePurchaseComputedTotals(effectivePurchaseForm, purchasePolicy)
  const isUsdSupplierPaymentMode = data.settings.supplierPurchaseCurrency === 'USD'
  const selectedSupplierPaymentCurrency: SupplierCurrency = isUsdSupplierPaymentMode
    ? supplierPaymentCurrency
    : 'INR'
  const selectedSupplierPaymentExchangeRate = selectedSupplierPaymentCurrency === 'USD'
    ? supplierPaymentExchangeRate
    : data.settings.defaultExchangeRate
  const indianSupplierPaymentNPR = paymentForm.amount * selectedSupplierPaymentExchangeRate
  const commissionExpenseNPR = Math.max(0, bankOutflowNPR - indianSupplierPaymentNPR)
  const localExpenseVatNPR = n(localExpenseForm.amountBeforeVatNPR * configuredVatRate)
  const localExpenseTotalNPR = localExpenseForm.amountBeforeVatNPR + localExpenseVatNPR
  const purchaseErrorMessages = validationMessagesByField(purchaseValidationErrors)
  const purchaseWarningMessages = validationMessagesByField(purchaseValidationWarnings)
  const paymentErrorMessages = validationMessagesByField(paymentValidationErrors)
  const purchaseDraftKey = createDraftKey([
    'purchase-entry',
    activeCompanyId,
    activeFiscalYear.id,
    userRole ?? 'guest',
  ])
  const purchaseAutosave = useDraftAutosave({
    enabled: Boolean(userRole && !purchaseForm.id && !isClosedFiscalYear),
    keyName: purchaseDraftKey,
    value: purchaseForm,
    version: `purchase-v1-${activeFiscalYear.id}`,
  })

  useKeyboardShortcuts({
    onSaveDraft: () => setDashboardEntryMessage('Draft saved automatically.'),
    onReviewOrPost: () => document.querySelector<HTMLButtonElement>('[data-primary-submit="true"]')?.click(),
    onEscape: () => setGlobalSearch(''),
  })

  useEffect(() => {
    if (
      !purchaseAutosave.recovered ||
      purchaseForm.id ||
      purchaseForm.vendorPartyId ||
      purchaseForm.vendorBillNumber ||
      purchaseForm.debitNoteNumber
    ) {
      return
    }

    setPurchaseForm(purchaseAutosave.recovered)
  }, [purchaseAutosave.recovered, purchaseForm.debitNoteNumber, purchaseForm.id, purchaseForm.vendorBillNumber, purchaseForm.vendorPartyId])

  const partyById = useMemo(() => {
    const map = new Map<string, Party>()
    data.parties.forEach((party) => map.set(party.id, party))
    return map
  }, [data.parties])

  const partyName = useCallback((id: string) => partyById.get(id)?.name ?? '-', [partyById])
  const localExpenseDescription = useCallback((localExpense: LocalPurchaseExpense) =>
    [
      localExpense.expenseType ?? 'Expense',
      localExpense.expenseHead || 'Local purchase/expense bill',
    ].join(' - '), [])
  const inventoryEnabled = isInventoryTrackingEnabled()
  const activeCompanyProfile = getActiveCompanyProfile()
  const stockPurchaseKey = useCallback(
    (documentId: string, sourceType: 'Import Purchase' | 'Local Purchase') => `${sourceType}:${documentId}`,
    [],
  )
  const stockPurchaseBillByKey = useMemo(() => {
    const map = new Map<string, StockPurchaseBill>()
    stockPurchaseBills.forEach((bill) => {
      map.set(stockPurchaseKey(bill.id, bill.sourceType ?? (bill.source === 'Importation' ? 'Import Purchase' : 'Local Purchase')), bill)
    })
    return map
  }, [stockPurchaseBills, stockPurchaseKey])
  const stockPurchaseStatusByKey = useMemo(() => {
    const sourceDocs = [
      ...data.purchases.map((purchase) => ({
        amount: purchase.amountIC,
        amountCurrency: purchase.supplierCurrency,
        amountNpr: purchase.supplierAmountNPR,
        billNo: purchase.vendorBillNumber,
        date: purchase.debitNoteDate || purchase.billDate,
        documentId: purchase.id,
        exchangeRate: purchase.supplierExchangeRate,
        fiscalYearId: purchase.fiscalYearId,
        grandTotal: purchase.landedCostNPR,
        landedCostNpr: purchase.landedCostNPR,
        lifecycleStatus: purchase.lifecycleStatus,
        partyName: partyName(purchase.vendorPartyId),
        type: 'Import Purchase' as const,
      })),
      ...data.localExpenses
        .filter(isLocalPurchaseStock)
        .map((localExpense) => ({
          amount: localExpense.amountBeforeVatNPR,
          amountCurrency: 'NPR' as const,
          amountNpr: localExpense.amountBeforeVatNPR,
          billNo: localExpense.billNumber,
          date: localExpense.billDate,
          documentId: localExpense.id,
          exchangeRate: 1,
          fiscalYearId: localExpense.fiscalYearId,
          grandTotal: localExpense.totalAmountNPR,
          landedCostNpr: localExpense.amountBeforeVatNPR,
          lifecycleStatus: localExpense.lifecycleStatus,
          partyName: partyName(localExpense.partyId),
          type: 'Local Purchase' as const,
        })),
    ]
    const statuses = buildStatuses(sourceDocs, stockPurchaseBills, [])
    return new Map(statuses.map((status) => [stockPurchaseKey(status.documentId, status.type as 'Import Purchase' | 'Local Purchase'), status] as const))
  }, [data.localExpenses, data.purchases, partyName, stockPurchaseBills, stockPurchaseKey])
  const sortedPurchases = useMemo(
    () =>
      data.purchases
        .filter(purchaseBelongsToActiveBsFiscalYear)
        .sort(latestImportPurchaseFirst),
    [data.purchases, purchaseBelongsToActiveBsFiscalYear],
  )
  const sortedPayments = useMemo(
    () =>
      data.payments
        .filter(paymentBelongsToActiveBsFiscalYear)
        .sort((left, right) => latestDateFirst(left.paymentDate, right.paymentDate)),
    [data.payments, paymentBelongsToActiveBsFiscalYear],
  )
  const filteredPayments = useMemo(
    () =>
      sortedPayments.filter((payment) =>
        paymentMode === 'Indian Supplier' ? isSupplierPayment(payment) : !isSupplierPayment(payment),
      ),
    [paymentMode, sortedPayments],
  )
  const sortedLocalExpenses = useMemo(
    () =>
      data.localExpenses
        .filter(localExpenseBelongsToActiveBsFiscalYear)
        .sort((left, right) => latestDateFirst(left.billDate, right.billDate)),
    [data.localExpenses, localExpenseBelongsToActiveBsFiscalYear],
  )
  const displayedPurchases = useMemo(() => {
    if (!importPurchaseSort.key) {
      return sortedPurchases
    }

    return [...sortedPurchases].sort((left, right) =>
      compareImportPurchases(
        left,
        right,
        importPurchaseSort.key as ImportPurchaseSortKey,
        importPurchaseSort.direction,
        partyName,
        stockPurchaseStatusByKey,
        stockPurchaseKey,
      ) || latestImportPurchaseFirst(left, right),
    )
  }, [importPurchaseSort.direction, importPurchaseSort.key, partyName, sortedPurchases, stockPurchaseKey, stockPurchaseStatusByKey])
  const displayedPayments = useMemo(() => {
    if (!paymentSort.key) {
      return filteredPayments
    }

    return [...filteredPayments].sort((left, right) =>
      comparePayments(left, right, paymentSort.key as PaymentSortKey, paymentSort.direction, partyName) ||
      latestDateFirst(left.paymentDate, right.paymentDate),
    )
  }, [filteredPayments, partyName, paymentSort.direction, paymentSort.key])
  const displayedLocalExpenses = useMemo(() => {
    if (!localExpenseSort.key) {
      return sortedLocalExpenses
    }

    return [...sortedLocalExpenses].sort((left, right) =>
      compareLocalExpenses(
        left,
        right,
        localExpenseSort.key as LocalExpenseSortKey,
        localExpenseSort.direction,
        partyName,
        stockPurchaseStatusByKey,
        stockPurchaseKey,
      ) || latestDateFirst(left.billDate, right.billDate),
    )
  }, [localExpenseSort.direction, localExpenseSort.key, partyName, sortedLocalExpenses, stockPurchaseKey, stockPurchaseStatusByKey])
  const refreshPurchaseStock = useCallback(async () => {
    if (!inventoryEnabled) {
      setStockItems([])
      setStockPurchaseBills([])
      setPreviewStockPurchase(null)
      return
    }

    try {
      const [loadedItems, loadedBills] = await Promise.all([
        getStockItems(),
        getStockPurchaseBills(),
      ])
      setStockItems(loadedItems)
      setStockPurchaseBills(loadedBills)
    } catch (error) {
      console.error('Could not load purchase stock lines.', error)
      setDashboardEntryMessage('Inventory lines could not be loaded. Purchase data is still available.')
    }
  }, [inventoryEnabled])

  useEffect(() => {
    void refreshPurchaseStock()
  }, [refreshPurchaseStock, activeCompanyId, activeFiscalYear.id])
  const vendorOptions = includeSelectedParty(indianSuppliers, purchaseForm.vendorPartyId, partyById)
  const agentOptions = includeSelectedParty(customAgents, purchaseForm.customAgentPartyId, partyById)
  const transportOptions = includeSelectedParty(indianTransportParties, purchaseForm.freightIndiaPartyId, partyById)
  const indianSupplierPaymentPartyOptions = includeSelectedParty(indianSupplierPaymentParties, paymentForm.partyId, partyById)
  const otherPaymentPartyOptions = includeSelectedParty(otherPaymentParties, paymentForm.partyId, partyById)
  const localSupplierOptions = includeSelectedParty(localSuppliers, localExpenseForm.partyId, partyById)
  const globalSearchResults = useMemo(() => {
    const query = globalSearch.trim().toLowerCase()

    if (!query) {
      return []
    }

    const results: Array<{
      id: string
      type: 'Party' | 'Purchase' | 'Payment'
      primary: string
      secondary: string
      amount: string
    }> = []

    data.parties.forEach((party) => {
      const haystack = [party.name, party.panVatNo, party.phone, party.category, party.country]
        .join(' ')
        .toLowerCase()

      if (haystack.includes(query)) {
        results.push({
          id: party.id,
          type: 'Party',
          primary: party.name,
          secondary: [party.category, party.panVatNo ? `PAN/VAT ${party.panVatNo}` : ''].filter(Boolean).join(' - '),
          amount: npr(party.openingPayable),
        })
      }
    })

    sortedPurchases.forEach((purchase) => {
      const haystack = [
        partyName(purchase.vendorPartyId),
        partyName(purchase.customAgentPartyId),
        purchase.vendorBillNumber,
        purchase.debitNoteNumber,
        purchase.agentServiceBillNumber,
      ]
        .join(' ')
        .toLowerCase()

      if (haystack.includes(query)) {
        results.push({
          id: purchase.id,
          type: 'Purchase',
          primary: purchase.vendorBillNumber || '-',
          secondary: `${partyName(purchase.vendorPartyId)} / Debit note ${purchase.debitNoteNumber || '-'}`,
          amount: npr(purchase.landedCostNPR),
        })
      }
    })

    sortedPayments.forEach((payment) => {
      const haystack = [
        partyName(payment.partyId),
        payment.referenceNumber,
        payment.paymentType,
        payment.paymentMethod,
      ]
        .join(' ')
        .toLowerCase()

      if (haystack.includes(query)) {
        results.push({
          id: payment.id,
          type: 'Payment',
          primary: payment.referenceNumber || payment.paymentType,
          secondary: `${partyName(payment.partyId)} / ${payment.paymentMethod}`,
          amount: npr(payment.amountNPR),
        })
      }
    })

    return results.slice(0, 15)
  }, [data.parties, globalSearch, partyName, sortedPayments, sortedPurchases])

  const setDataWithLog = (
    next: AppData,
    action: string,
    details: string,
    oldValue = '',
    newValue = '',
  ) => {
    setData(buildDataWithLog(next, action, details, oldValue, newValue))
  }

  const buildDataWithLog = (
    next: AppData,
    action: string,
    details: string,
    oldValue = '',
    newValue = '',
  ) => {
    const fiscalYears = next.fiscalYears.some((fiscalYear) => fiscalYear.id === activeFiscalYear.id)
      ? next.fiscalYears
      : [activeFiscalYear, ...next.fiscalYears]

    return {
      ...next,
      fiscalYears,
      activityLogs: [createActivity(action, details, userRole ?? 'Unknown', oldValue, newValue), ...next.activityLogs],
    }
  }

  const persistDataWithLog = async (
    next: AppData,
    action: string,
    details: string,
    options: {
      operationId?: string
      oldValue?: string
      newValue?: string
      importPurchaseId?: string
      deletedImportPurchaseId?: string
      localExpenseId?: string
      deletedLocalExpenseId?: string
    } = {},
  ) => {
    if (!repository) {
      window.alert('Storage is still loading. Please try again.')
      return false
    }

    const persisted = buildDataWithLog(next, action, details, options.oldValue ?? '', options.newValue ?? '')
    const importPurchaseId = options.importPurchaseId ?? options.deletedImportPurchaseId ?? ''
    const localExpenseId = options.localExpenseId ?? options.deletedLocalExpenseId ?? ''
    const canUseNativePurchaseWrite = repository.kind === 'sqlite' && (importPurchaseId || localExpenseId)

    try {
      console.info('[purchase-persistence]', {
        operationId: options.operationId ?? 'PURCHASE-SAVE',
        action: 'save-start',
        companyId: getActiveCompanyId() || 'default',
        databaseUrl: getActivePurchaseDatabaseUrl(),
        importPurchaseId: options.importPurchaseId,
        deletedImportPurchaseId: options.deletedImportPurchaseId,
        localExpenseId: options.localExpenseId,
        deletedLocalExpenseId: options.deletedLocalExpenseId,
      })

      if (canUseNativePurchaseWrite) {
        const { invoke } = await import('@tauri-apps/api/core')
        const purchaseFilename = sqliteFilenameFromUrl(getActivePurchaseDatabaseUrl())
        const activityLog = persisted.activityLogs[0]

        if (importPurchaseId) {
          await invoke('write_import_purchase_transaction', {
            purchaseFilename,
            mode: options.deletedImportPurchaseId ? 'delete' : 'upsert',
            purchaseId: importPurchaseId,
            purchase: persisted.purchases.find((item) => item.id === importPurchaseId) ?? null,
            ledgerEntries: persisted.ledgerEntries.filter(
              (entry) => entry.sourceType === 'PURCHASE' && entry.sourceId === importPurchaseId,
            ),
            activityLog,
          })
        } else {
          await invoke('write_local_purchase_transaction', {
            purchaseFilename,
            mode: options.deletedLocalExpenseId ? 'delete' : 'upsert',
            localExpenseId,
            localExpense: persisted.localExpenses.find((item) => item.id === localExpenseId) ?? null,
            ledgerEntries: persisted.ledgerEntries.filter(
              (entry) => entry.sourceType === 'LOCAL_EXPENSE' && entry.sourceId === localExpenseId,
            ),
            activityLog,
          })
        }
      } else {
        await repository.saveData(persisted)
      }

      const reloaded = await repository.loadData()

      if (options.importPurchaseId && !reloaded.purchases.some((item) => item.id === options.importPurchaseId)) {
        throw new Error(`Saved import purchase ${options.importPurchaseId} was not found after reload.`)
      }

      if (options.deletedImportPurchaseId && reloaded.purchases.some((item) => item.id === options.deletedImportPurchaseId)) {
        throw new Error(`Deleted import purchase ${options.deletedImportPurchaseId} was still present after reload.`)
      }

      if (options.localExpenseId && !reloaded.localExpenses.some((item) => item.id === options.localExpenseId)) {
        throw new Error(`Saved local purchase ${options.localExpenseId} was not found after reload.`)
      }

      if (options.deletedLocalExpenseId && reloaded.localExpenses.some((item) => item.id === options.deletedLocalExpenseId)) {
        throw new Error(`Deleted local purchase ${options.deletedLocalExpenseId} was still present after reload.`)
      }

      lastSavedSnapshotRef.current = JSON.stringify(reloaded)
      setData(reloaded)
      console.info('[purchase-persistence]', {
        operationId: options.operationId,
        action: 'save-readback-ok',
        importPurchases: reloaded.purchases.length,
        localExpenses: reloaded.localExpenses.length,
        ledgerEntries: reloaded.ledgerEntries.length,
      })
      return true
    } catch (error) {
      console.error('Purchase data persistence failed.', error)
      window.alert(`Could not save purchase data: ${errorMessage(error)}`)
      return false
    }
  }

  const postingContext = (fiscalYearId: string) => ({
    companyId: getActiveCompanyId() || 'default',
    fiscalYearId,
    fiscalYear: {
      ...activeFiscalYear,
      id: fiscalYearId,
    },
    idFactory: createId,
    timestamp: new Date().toISOString(),
    userName: userRole ?? 'Unknown',
  })

  const appendLedgerEntries = (entries: LedgerEntry[]) =>
    [...data.ledgerEntries, ...entries]

  const replaceLedgerEntriesForSource = (
    sourceType: LedgerEntry['sourceType'],
    sourceId: string,
    entries: LedgerEntry[],
  ) => [
    ...data.ledgerEntries.filter((entry) => entry.sourceType !== sourceType || entry.sourceId !== sourceId),
    ...entries,
  ]

  const buildImportPurchaseLedgerEntries = (purchase: ImportPurchase) =>
    postPurchase({
      id: purchase.id,
      lifecycleStatus: 'DRAFT',
      fiscalYearId: purchase.fiscalYearId,
      date: normalizeBsDate(purchase.debitNoteDate) || normalizeBsDate(purchase.agentServiceBillDate) || activeFiscalYear.startBs,
      vendorPartyId: purchase.vendorPartyId,
      customAgentPartyId: purchase.customAgentPartyId,
      freightIndiaPartyId: purchase.freightIndiaPartyId,
      freightIndiaStatus: purchase.freightIndiaStatus,
      supplierAmountNPR: purchase.supplierAmountNPR,
      totalAgentPayableNPR: purchase.totalAgentPayableNPR,
      freightIndiaAmountNPR: purchase.freightIndiaAmountNPR,
      landedCostAdjustmentNPR: purchase.loadingUnloadingChargeNPR,
      landedCostNPR: purchase.landedCostNPR,
      totalInputVatNPR: purchase.totalInputVatNPR,
      reference: purchase.vendorBillNumber,
    }, postingContext(purchase.fiscalYearId))

  const loginAsAccount = () => {
    setUserRole('Account')
    setLoginError('')
    navigateToView('Dashboard')
  }

  const loginAsMaster = (event: FormEvent) => {
    event.preventDefault()

    if (masterPassword !== 'KANCHAN') {
      setLoginError('Master password is incorrect.')
      return
    }

    setUserRole('Master')
    setMasterPassword('')
    setLoginError('')
    navigateToView('Dashboard')
  }

  const logout = () => {
    if (onLogout) {
      onLogout()
      return
    }

    setUserRole(null)
    setMasterPassword('')
    setLoginError('')
    navigateToView('Dashboard')
  }

  const openNewPurchaseEntry = () => {
    if (isClosedFiscalYear) {
      setDashboardEntryMessage(`${data.settings.companyName || 'This company'} FY ${activeFiscalYear.code} is closed. Entries cannot be added in a closed fiscal year.`)
      return
    }

    setDashboardEntryMessage('')
    setPurchaseForm(createEmptyPurchase(data.settings))
    navigateToView('Import Purchase Entry')
  }

  const openNewPaymentEntry = () => {
    if (isClosedFiscalYear) {
      setDashboardEntryMessage(`${data.settings.companyName || 'This company'} FY ${activeFiscalYear.code} is closed. Entries cannot be added in a closed fiscal year.`)
      return
    }

    setDashboardEntryMessage('')
    setPaymentForm(createEmptyPayment())
    setPaymentMode('Indian Supplier')
    setPaymentBillYear('Current')
    resetSupplierPaymentCurrency()
    setBankOutflowNPR(0)
    navigateToView('Payment Entry')
  }

  const openNewLocalExpenseEntry = () => {
    if (isClosedFiscalYear) {
      setDashboardEntryMessage(`${data.settings.companyName || 'This company'} FY ${activeFiscalYear.code} is closed. Entries cannot be added in a closed fiscal year.`)
      return
    }

    setDashboardEntryMessage('')
    setLocalExpenseForm(createEmptyLocalExpense())
    navigateToView('Local Purchase / Expense')
  }

  const dashboard = useMemo(() => {
    const currentPurchases = sortedPurchases
    const currentPayments = sortedPayments
    const supplierOpening = data.parties
      .filter(isIndianSupplierCategory)
      .reduce((sum, party) => sum + party.openingPayable, 0)
    const agentOpening = data.parties
      .filter(isCustomAgentCategory)
      .reduce((sum, party) => sum + party.openingPayable, 0)
    const supplierPartyIds = new Set(
      data.parties.filter(isIndianSupplierCategory).map((party) => party.id),
    )
    const agentPartyIds = new Set(
      data.parties.filter(isCustomAgentCategory).map((party) => party.id),
    )
    const localSupplierParties = data.parties.filter((party) => party.category === 'Local Suppliers')
    const localSupplierPartyIds = new Set(localSupplierParties.map((party) => party.id))
    const localSupplierOpening = localSupplierParties.reduce(
      (sum, party) => sum + party.openingPayable,
      0,
    )
    const supplierBills = currentPurchases.reduce(
      (sum, purchase) => sum + purchase.supplierAmountNPR,
      0,
    )
    const agentBills = currentPurchases.reduce(
      (sum, purchase) => sum + purchase.totalAgentPayableNPR,
      0,
    )
    const supplierPayments = currentPayments
      .filter((payment) => isSupplierPayment(payment) && supplierPartyIds.has(payment.partyId))
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const agentPayments = currentPayments
      .filter((payment) => isAgentPayment(payment) && agentPartyIds.has(payment.partyId))
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const transportParties = data.parties.filter(isIndianTransportCategory)
    const transportPartyIds = new Set(transportParties.map((party) => party.id))
    const transportOpening = transportParties.reduce(
      (sum, party) => sum + party.openingPayable,
      0,
    )
    const transportCredits = currentPurchases
      .filter((purchase) => shouldCreditIndianTransport(purchase.freightIndiaStatus))
      .reduce((sum, purchase) => sum + purchase.freightIndiaAmountNPR, 0)
    const transportPayments = currentPayments
      .filter(
        (payment) =>
          payment.paymentType === 'Freight Payment' || transportPartyIds.has(payment.partyId),
      )
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const localSupplierBills = sortedLocalExpenses.reduce(
      (sum, localExpense) => sum + localExpense.totalAmountNPR,
      0,
    )
    const localSupplierPayments = currentPayments
      .filter(
        (payment) =>
          payment.paymentType === 'Other Supplier Payment' &&
          localSupplierPartyIds.has(payment.partyId),
      )
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const supplierPayable = supplierOpening + supplierBills - supplierPayments
    const agentPayable = agentOpening + agentBills - agentPayments
    const transportPayable = transportOpening + transportCredits - transportPayments
    const localSupplierPayable = localSupplierOpening + localSupplierBills - localSupplierPayments

    return {
      totalPayable: supplierPayable + agentPayable + transportPayable + localSupplierPayable,
      supplierPayable,
      agentPayable,
      transportPayable,
      localSupplierPayable,
      inputVat: currentPurchases.reduce((sum, purchase) => sum + purchase.totalInputVatNPR, 0),
      landedCost: currentPurchases.reduce((sum, purchase) => sum + purchase.landedCostNPR, 0),
      recentPurchases: sortedPurchases.slice(0, 5),
      recentPayments: sortedPayments.slice(0, 5),
    }
  }, [data.parties, sortedLocalExpenses, sortedPayments, sortedPurchases])

  const monthlyLandedCost = useMemo(
    () =>
      makeMonthlyRows(
        sortedPurchases.map((purchase) => ({
          date: purchase.agentServiceBillDate,
          amount: purchase.landedCostNPR,
        })),
      ),
    [sortedPurchases],
  )
  const purchaseBySupplier = useMemo(
    () =>
      makePartySlices(
        sortedPurchases.map((purchase) => ({
          id: purchase.vendorPartyId,
          name: partyName(purchase.vendorPartyId),
          amount: purchase.supplierAmountNPR,
        })),
      ),
    [partyName, sortedPurchases],
  )

  const filteredPurchases = useMemo(() => {
    return sortedPurchases.filter((purchase) => {
      const sortDate = importPurchaseSortDate(purchase)
      const matchesFrom = !summaryFilters.from || sortDate >= summaryFilters.from
      const matchesTo = !summaryFilters.to || sortDate <= summaryFilters.to
      const matchesVendor =
        !summaryFilters.vendorPartyId || purchase.vendorPartyId === summaryFilters.vendorPartyId
      const matchesAgent =
        !summaryFilters.customAgentPartyId ||
        purchase.customAgentPartyId === summaryFilters.customAgentPartyId
      const matchesBill =
        !summaryFilters.billNumber ||
        purchase.vendorBillNumber
          .toLowerCase()
          .includes(summaryFilters.billNumber.toLowerCase())
      const matchesDebit =
        !summaryFilters.debitNoteNumber ||
        purchase.debitNoteNumber
          .toLowerCase()
          .includes(summaryFilters.debitNoteNumber.toLowerCase())

      return (
        matchesFrom && matchesTo && matchesVendor && matchesAgent && matchesBill && matchesDebit
      )
    })
  }, [sortedPurchases, summaryFilters])
  const purchaseSummaryTotals = useMemo(
    () => ({
      supplierAmountNPR: filteredPurchases.reduce((sum, purchase) => sum + purchase.supplierAmountNPR, 0),
      inputVatNPR: filteredPurchases.reduce((sum, purchase) => sum + purchase.totalInputVatNPR, 0),
      landedCostNPR: filteredPurchases.reduce((sum, purchase) => sum + purchase.landedCostNPR, 0),
      outstandingRows: filteredPurchases.length,
    }),
    [filteredPurchases],
  )

  const supplierPayables = useMemo(() => {
    return data.parties
      .filter(isIndianSupplierCategory)
      .map((party) => {
        const totalBills = sortedPurchases
          .filter((purchase) => purchase.vendorPartyId === party.id)
          .reduce((sum, purchase) => sum + purchase.supplierAmountNPR, 0)
        const totalPayments = sortedPayments
          .filter((payment) => payment.partyId === party.id && isSupplierPayment(payment))
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          party,
          totalBills,
          totalPayments,
          outstanding: party.openingPayable + totalBills - totalPayments,
        }
      })
  }, [data.parties, sortedPayments, sortedPurchases])

  const agentPayables = useMemo(() => {
    return data.parties
      .filter(isCustomAgentCategory)
      .map((party) => {
        const agentPurchases = sortedPurchases.filter(
          (purchase) => purchase.customAgentPartyId === party.id,
        )
        const totalDebitNotes = agentPurchases.reduce(
          (sum, purchase) => sum + purchase.debitNoteTotalNPR,
          0,
        )
        const totalServiceBills = agentPurchases.reduce(
          (sum, purchase) => sum + purchase.agentServiceTotalNPR,
          0,
        )
        const totalAgentPayable = agentPurchases.reduce(
          (sum, purchase) => sum + purchase.totalAgentPayableNPR,
          0,
        )
        const totalPayments = sortedPayments
          .filter((payment) => payment.partyId === party.id && isAgentPayment(payment))
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          party,
          totalDebitNotes,
          totalServiceBills,
          totalAgentPayable,
          totalPayments,
          outstanding:
            party.openingPayable + totalAgentPayable - totalPayments,
        }
      })
  }, [data.parties, sortedPayments, sortedPurchases])

  const indianTransportReport = useMemo(() => {
    const transportParties = data.parties.filter(isIndianTransportCategory)
    const openingPayable = transportParties.reduce(
      (sum, party) => sum + party.openingPayable,
      0,
    )
    const transportPartyIds = new Set(transportParties.map((party) => party.id))
    const creditedPurchases = sortedPurchases.filter(
      (purchase) =>
        shouldCreditIndianTransport(purchase.freightIndiaStatus) &&
        purchase.freightIndiaAmountNPR > 0 &&
        !purchase.freightIndiaPartyId,
    )
    const freightCredits = creditedPurchases.reduce(
      (sum, purchase) => sum + purchase.freightIndiaAmountNPR,
      0,
    )
    const transportPayments = sortedPayments.filter(
      (payment) =>
        payment.paymentType === 'Freight Payment' || transportPartyIds.has(payment.partyId),
    )
    const totalPayments = transportPayments.reduce(
      (sum, payment) => sum + payment.amountNPR,
      0,
    )

    const rows = [
      ...transportParties.map((party) => ({
        date: '',
        type: 'Opening Balance',
        reference: '',
        description: `${party.name} opening payable`,
        increase: party.openingPayable,
        payment: 0,
        remarks: '',
      })),
      ...creditedPurchases.map((purchase) => ({
        date: purchase.debitNoteDate || purchase.billDate,
        type: 'Freight credited',
        reference: purchase.debitNoteNumber || purchase.vendorBillNumber,
        description: `${partyName(purchase.vendorPartyId)} - bill ${purchase.vendorBillNumber}`,
        increase: purchase.freightIndiaAmountNPR,
        payment: 0,
        remarks: purchase.remarks,
      })),
      ...transportPayments.map((payment) => ({
        date: payment.paymentDate,
        type: 'Payment',
        reference: payment.referenceNumber,
        description: `${partyName(payment.partyId)} - ${payment.paymentMethod}`,
        increase: 0,
        payment: payment.amountNPR,
        remarks: payment.remarks,
      })),
    ]

    const ledger = rows
      .sort(ledgerDateFirst)
      .reduce(
        (result, row) => {
          const running = result.running + row.increase - row.payment
          return {
            running,
            rows: [
              ...result.rows,
              {
                ...row,
                running,
              },
            ],
          }
        },
        {
          running: 0,
          rows: [] as Array<(typeof rows)[number] & { running: number }>,
        },
      ).rows

    return {
      openingPayable,
      freightCredits,
      totalPayments,
      outstanding: openingPayable + freightCredits - totalPayments,
      ledger,
    }
  }, [data.parties, partyName, sortedPayments, sortedPurchases])

  const payableRows = useMemo(() => {
    const supplierRows = supplierPayables.map((row) => ({
      partyName: row.party.name,
      category: 'Indian Suppliers',
      openingPayable: row.party.openingPayable,
      purchaseOrBillTotal: row.totalBills,
      debitNoteTotal: 0,
      serviceBillTotal: 0,
      freightTotal: 0,
      payments: row.totalPayments,
      outstanding: row.outstanding,
    }))

    const agentRows = agentPayables.map((row) => ({
      partyName: row.party.name,
      category: 'Custom Agent',
      openingPayable: row.party.openingPayable,
      purchaseOrBillTotal: 0,
      debitNoteTotal: row.totalDebitNotes,
      serviceBillTotal: row.totalServiceBills,
      freightTotal: 0,
      payments: row.totalPayments,
      outstanding: row.outstanding,
    }))

    const localSupplierRows = data.parties
      .filter((party) => party.category === 'Local Suppliers')
      .map((party) => {
        const totalBills = sortedLocalExpenses
          .filter((localExpense) => localExpense.partyId === party.id)
          .reduce((sum, localExpense) => sum + localExpense.totalAmountNPR, 0)
        const totalPayments = sortedPayments
          .filter((payment) => payment.partyId === party.id && payment.paymentType === 'Other Supplier Payment')
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          partyName: party.name,
          category: 'Local Suppliers',
          openingPayable: party.openingPayable,
          purchaseOrBillTotal: totalBills,
          debitNoteTotal: 0,
          serviceBillTotal: 0,
          freightTotal: 0,
          payments: totalPayments,
          outstanding: party.openingPayable + totalBills - totalPayments,
        }
      })

    const transportRows = data.parties
      .filter(isIndianTransportCategory)
      .map((party) => {
        const freightTotal = sortedPurchases
          .filter(
            (purchase) =>
              purchase.freightIndiaPartyId === party.id &&
              shouldCreditIndianTransport(purchase.freightIndiaStatus),
          )
          .reduce((sum, purchase) => sum + purchase.freightIndiaAmountNPR, 0)
        const payments = sortedPayments
          .filter(
            (payment) =>
              payment.partyId === party.id &&
              (payment.paymentType === 'Freight Payment' || isSupplierPayment(payment)),
          )
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          partyName: party.name,
          category: 'Indian Transport',
          openingPayable: party.openingPayable,
          purchaseOrBillTotal: 0,
          debitNoteTotal: 0,
          serviceBillTotal: 0,
          freightTotal,
          payments,
          outstanding: party.openingPayable + freightTotal - payments,
        }
      })

    const unassignedTransportRow = {
      partyName: 'Indian Transport (unassigned)',
      category: 'Indian Transport',
      openingPayable: 0,
      purchaseOrBillTotal: 0,
      debitNoteTotal: 0,
      serviceBillTotal: 0,
      freightTotal: indianTransportReport.freightCredits,
      payments: 0,
      outstanding: indianTransportReport.freightCredits,
    }

    return [...supplierRows, ...agentRows, ...transportRows, unassignedTransportRow, ...localSupplierRows].filter(
      (row) =>
        row.openingPayable ||
        row.purchaseOrBillTotal ||
        row.debitNoteTotal ||
        row.serviceBillTotal ||
        row.freightTotal ||
        row.payments ||
        row.outstanding,
    )
  }, [agentPayables, data.parties, indianTransportReport, sortedLocalExpenses, sortedPayments, sortedPurchases, supplierPayables])

  const selectedLedgerParty = partyById.get(ledgerPartyId)
  const ledgerRows = useMemo(() => {
    if (!selectedLedgerParty) {
      return []
    }

    const rows = [
      {
        date: '',
        type: 'Opening Balance',
        reference: '',
        description: 'Opening payable',
        increase: selectedLedgerParty.openingPayable,
        payment: 0,
        remarks: '',
      },
    ]

    if (isIndianSupplierCategory(selectedLedgerParty)) {
      sortedPurchases
        .filter((purchase) => purchase.vendorPartyId === selectedLedgerParty.id)
        .forEach((purchase) => {
          rows.push({
            date: importPurchaseSortDate(purchase),
            type: 'Supplier Bill',
            reference: purchase.vendorBillNumber,
            description: `Indian supplier bill from ${partyName(purchase.vendorPartyId)}`,
            increase: purchase.supplierAmountNPR,
            payment: 0,
            remarks: purchase.remarks,
          })
        })
    }

    if (isCustomAgentCategory(selectedLedgerParty)) {
      sortedPurchases
        .filter((purchase) => purchase.customAgentPartyId === selectedLedgerParty.id)
        .forEach((purchase) => {
          if (purchase.debitNoteTotalNPR > 0) {
            rows.push({
              date: purchase.debitNoteDate || purchase.billDate,
              type: 'Pragapanpatra Charges',
              reference: purchase.debitNoteNumber,
              description: `Pragapanpatra charges for bill ${purchase.vendorBillNumber}`,
              increase: purchase.debitNoteTotalNPR,
              payment: 0,
              remarks: purchase.remarks,
            })
          }

          if (purchase.agentServiceTotalNPR > 0) {
            rows.push({
              date: purchase.agentServiceBillDate || purchase.billDate,
              type: 'Agent Service Bill',
              reference: purchase.agentServiceBillNumber,
              description: `Service bill for ${partyName(purchase.vendorPartyId)}`,
              increase: purchase.agentServiceTotalNPR,
              payment: 0,
              remarks: purchase.remarks,
            })
          }
        })
    }

    if (selectedLedgerParty.category === 'Local Suppliers') {
      sortedLocalExpenses
        .filter((localExpense) => localExpense.partyId === selectedLedgerParty.id)
        .forEach((localExpense) => {
          rows.push({
            date: localExpense.billDate,
            type: 'Local Purchase / Expense',
            reference: localExpense.billNumber,
            description: localExpenseDescription(localExpense),
            increase: localExpense.totalAmountNPR,
            payment: 0,
            remarks: localExpense.remarks,
          })
        })
    }

    if (isIndianTransportCategory(selectedLedgerParty)) {
      sortedPurchases
        .filter(
          (purchase) =>
            purchase.freightIndiaPartyId === selectedLedgerParty.id &&
            shouldCreditIndianTransport(purchase.freightIndiaStatus),
        )
        .forEach((purchase) => {
          rows.push({
            date: purchase.debitNoteDate || purchase.billDate,
            type: 'Freight Bill',
            reference: purchase.debitNoteNumber || purchase.vendorBillNumber,
            description: `${partyName(purchase.vendorPartyId)} - bill ${purchase.vendorBillNumber}`,
            increase: purchase.freightIndiaAmountNPR,
            payment: 0,
            remarks: purchase.remarks,
          })
        })
    }

    sortedPayments
      .filter((payment) => payment.partyId === selectedLedgerParty.id)
      .forEach((payment) => {
        rows.push({
          date: payment.paymentDate,
          type: 'Payment',
          reference: payment.referenceNumber,
          description: payment.paymentMethod,
          increase: 0,
          payment: payment.amountNPR,
          remarks: payment.remarks,
        })
      })

    return rows
      .sort(ledgerDateFirst)
      .reduce(
        (result, row) => {
          const running = result.running + row.increase - row.payment
          return {
            running,
            rows: [
              ...result.rows,
              {
                ...row,
                running,
              },
            ],
          }
        },
        {
          running: 0,
          rows: [] as Array<(typeof rows)[number] & { running: number }>,
        },
      ).rows
  }, [localExpenseDescription, partyName, selectedLedgerParty, sortedLocalExpenses, sortedPayments, sortedPurchases])

  const vatRows = useMemo(() => {
    const importVatRows = sortedPurchases.flatMap((purchase) => {
      const pragapanpatraDate = purchase.debitNoteDate || purchase.billDate
      const terminalVat =
        purchase.terminalVatNPR || n(purchase.terminalChargeWithoutVatNPR * configuredVatRate)
      const base = {
        vendor: partyName(purchase.vendorPartyId),
        vendorBillNumber: purchase.vendorBillNumber,
        customAgent: partyName(purchase.customAgentPartyId),
      }

      return [
        {
          ...base,
          date: pragapanpatraDate,
          source: 'Import VAT',
          reference: purchase.debitNoteNumber,
          amount: purchase.importVatNPR,
        },
        {
          ...base,
          date: pragapanpatraDate,
          source: 'Terminal VAT',
          reference: purchase.debitNoteNumber,
          amount: terminalVat,
        },
        {
          ...base,
          date: purchase.agentServiceBillDate || purchase.billDate,
          source: 'Custom agent service VAT',
          reference: purchase.agentServiceBillNumber,
          amount: purchase.agentServiceVatNPR,
        },
      ]
    })
    const localVatRows = sortedLocalExpenses.map((localExpense) => ({
      vendor: partyName(localExpense.partyId),
      vendorBillNumber: localExpense.billNumber,
      customAgent: partyName(localExpense.partyId),
      date: localExpense.billDate,
      source: 'Local supplier VAT',
      reference: localExpense.billNumber,
      amount: localExpense.vatNPR,
    }))
    const rows = [...importVatRows, ...localVatRows]

    return rows
      .filter((row) => row.amount > 0)
      .filter((row) => !vatFilters.month || bsMonthFromDate(row.date) === vatFilters.month)
      .sort((a, b) => latestDateFirst(a.date, b.date))
  }, [configuredVatRate, partyName, sortedLocalExpenses, sortedPurchases, vatFilters.month])

  const totalVat = vatRows.reduce((sum, row) => sum + row.amount, 0)

  const filteredParties = data.parties.filter((party) => {
    const matchesSearch =
      !partySearch ||
      [party.name, party.phone, party.panVatNo, party.country]
        .join(' ')
        .toLowerCase()
        .includes(partySearch.toLowerCase())
    const matchesCategory =
      partyCategoryFilter === 'All' || party.category === partyCategoryFilter
    return matchesSearch && matchesCategory
  })
  const displayedParties = partySort.key
    ? [...filteredParties].sort((left, right) =>
        comparePurchaseParties(left, right, partySort.key as PurchasePartySortKey, partySort.direction) ||
        compareText(left.name, right.name, 'asc'),
      )
    : filteredParties

  const updatePartyField = <K extends keyof PartyForm>(key: K, value: PartyForm[K]) => {
    setPartyForm((current) => ({ ...current, [key]: value }))
  }

  const updatePurchaseField = <K extends keyof ImportPurchase>(
    key: K,
    value: ImportPurchase[K],
  ) => {
    setPurchaseValidationErrors((current) => current.filter((error) => error.field !== key))
    setPurchaseValidationWarnings((current) => current.filter((error) => error.field !== key))
    setPurchaseForm((current) => ({ ...current, [key]: value }))
  }

  const updateSupplierCurrency = (value: SupplierCurrency) => {
    setPurchaseForm((current) => ({
      ...current,
      supplierCurrency: value,
      supplierExchangeRate:
        value === 'INR'
          ? data.settings.defaultExchangeRate
          : current.supplierCurrency === 'USD'
            ? current.supplierExchangeRate
            : 0,
    }))
  }

  function resetSupplierPaymentCurrency() {
    setSupplierPaymentCurrency('INR')
    setSupplierPaymentExchangeRate(data.settings.defaultExchangeRate)
  }

  const updatePaymentField = <K extends keyof Payment>(key: K, value: Payment[K]) => {
    setPaymentValidationErrors((current) => current.filter((error) => error.field !== key))
    setPaymentForm((current) => ({ ...current, [key]: value }))
  }

  const updateLocalExpenseField = <K extends keyof LocalPurchaseExpense>(
    key: K,
    value: LocalPurchaseExpense[K],
  ) => {
    setLocalExpenseForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'expenseType' && value === 'Stock' ? { expenseHead: '' } : {}),
    }))
  }

  const updateQuickLocalSupplierField = <K extends keyof QuickLocalSupplierForm>(
    key: K,
    value: QuickLocalSupplierForm[K],
  ) => {
    setQuickLocalSupplierForm((current) => ({ ...current, [key]: value }))
  }

  const updateSettingsField = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettingsForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const focusFirstInvalidField = (errors: FieldError[]) => {
    const firstError = errors[0]
    if (!firstError) {
      return
    }

    window.requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(`[name="${firstError.field}"]`)
      field?.focus()
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const saveSettings = (event: FormEvent) => {
    event.preventDefault()

    const savedSettings = {
      ...settingsForm,
      agentServiceVatRate: n(settingsForm.agentServiceVatRate),
      supplierPurchaseCurrency: normalizeSupplierCurrency(settingsForm.supplierPurchaseCurrency),
    }

    setDataWithLog(
      { ...data, settings: savedSettings },
      'Updated settings',
      `${savedSettings.companyName} - FY ${savedSettings.fiscalYear}`,
    )
    setSettingsForm(savedSettings)

    setPurchaseForm((current) => ({
      ...current,
      supplierCurrency: savedSettings.supplierPurchaseCurrency,
      supplierExchangeRate:
        savedSettings.supplierPurchaseCurrency === 'INR'
          ? savedSettings.defaultExchangeRate
          : current.supplierCurrency === 'USD'
            ? current.supplierExchangeRate
            : 0,
      freightIndiaExchangeRate: savedSettings.defaultExchangeRate,
    }))
    setPaymentForm((current) =>
      current.id || current.currency === 'NPR'
        ? current
        : { ...current, exchangeRate: savedSettings.defaultExchangeRate },
    )
  }

  const downloadPartyTemplate = async () => {
    const rows = [
      ['name', 'address', 'phone', 'panVatNo', 'country', 'category', 'openingPayable', 'isActive'],
      ['ANG Minerals', 'India', '', '', 'India', 'Indian Suppliers', '0', 'yes'],
      ['Sunrise Custom Agent', 'Nepal', '', '', 'Nepal', 'Custom Agent', '0', 'yes'],
      ['Indian Transport', 'India', '', '', 'India', 'Indian Transport', '0', 'yes'],
      ['Sample Local Supplier', 'Nepal', '', '', 'Nepal', 'Local Suppliers', '0', 'yes'],
    ]

    await saveBlobWithPicker(
      `party-master-template_${todayForFileName()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      'CSV file',
    )
  }

  const downloadPurchaseTemplate = async () => {
    const rows = [
      [
        'vendorName',
        'vendorBillNumber',
        'billDateAD',
        'supplierCurrency',
        'supplierExchangeRate',
        'amountIC',
        'customAgentName',
        'pragapanpatraNumber',
        'pragapanpatraDateBS',
        'importDutyNPR',
        'customServiceNPR',
        'importVatNPR',
        'terminalChargeWithoutVatNPR',
        'freightIndiaStatus',
        'freightIndiaPartyName',
        'freightIndiaAmountIC',
        'totalKg',
        'loadingUnloadingChargePerKg',
        'otherChargesNPR',
        'agentServiceBillNumber',
        'agentServiceBillDateBS',
        'agentServiceAmountBeforeVatNPR',
        'remarks',
      ],
      [
        'ANG Minerals',
        '2025-26-63',
        '2082/01/01',
        'INR',
        '1.6015',
        '412700',
        'Sunrise Custom Agent',
        'PP-001',
        '2082/01/02',
        '83898',
        '565',
        '119974',
        '3424',
        'Paid by custom agent',
        '',
        '102900',
        '0',
        '0',
        '0',
        'ASB-001',
        '2082/01/03',
        '79706',
        'Sample import',
      ],
    ]

    await saveBlobWithPicker(
      `import-purchase-template_${todayForFileName()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      'CSV file',
    )
  }

  const downloadIndianSupplierPaymentTemplate = async () => {
    const rows = [
      [
        'partyName',
        'paymentDateBS',
        'amountIC',
        'paymentMethod',
        'billYear',
        'bankOutflowNPR',
        'billNumber',
        'remarks',
      ],
      [
        'ANG Minerals',
        '2082/01/05',
        '100000',
        'Nabil Bank',
        'Current',
        '160500',
        'BILL-001',
        'Supplier payment',
      ],
      [
        'Indian Transport',
        '2082/01/05',
        '10000',
        'Nabil Bank',
        'Current',
        '16000',
        'FREIGHT-001',
        'Indian transport payment',
      ],
    ]

    await saveBlobWithPicker(
      `indian-supplier-payment-template_${todayForFileName()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      'CSV file',
    )
  }

  const downloadOtherPaymentTemplate = async () => {
    const rows = [
      [
        'partyName',
        'paymentDateBS',
        'amountNPR',
        'paymentMethod',
        'referenceNumber',
        'remarks',
      ],
      [
        'Sunrise Custom Agent',
        '2082/01/06',
        '25000',
        'Nabil Bank',
        'DN-001',
        'Custom/local payment',
      ],
      [
        'Sample Local Supplier',
        '2082/01/06',
        '15000',
        'Nabil Bank',
        'LP-001',
        'Local supplier payment',
      ],
    ]

    await saveBlobWithPicker(
      `custom-agent-local-payment-template_${todayForFileName()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      'CSV file',
    )
  }

  const importParties = async () => {
    if (!partyImportFile) {
      window.alert('Select a party master CSV file first.')
      return
    }

    const rows = rowsToObjects(parseCsv(await partyImportFile.text()))
    let imported = 0
    const importedDetails: PartyImportResult[] = []
    const existingByName = new Map(data.parties.map((party) => [normalizeKey(party.name), party]))
    const nextParties = [...data.parties]

    rows.forEach((row) => {
      const name = getCsvValue(row, 'name', 'partyName', 'party name')

      if (!name) {
        return
      }

      const category = normalizePartyCategory(getCsvValue(row, 'category', 'partyCategory', 'party category'))
      const countryValue = getCsvValue(row, 'country')
      const country = countries.includes(countryValue) ? countryValue : 'India'
      const openingPayable = n(getCsvValue(row, 'openingPayable', 'opening payable', 'openingBalance', 'opening balance', 'opening'))
      const existing = existingByName.get(normalizeKey(name))

      if (existing) {
        const updated = withUpdatedParty({
          ...existing,
          name,
          address: getCsvValue(row, 'address'),
          phone: getCsvValue(row, 'phone'),
          panVatNo: getCsvValue(row, 'panVatNo', 'pan vat no', 'panVatNumber', 'pan vat number', 'vatNo', 'vat no'),
          country,
          category,
          openingPayable,
          isActive: parseBoolean(getCsvValue(row, 'isActive', 'active', 'status')),
        })
        const index = nextParties.findIndex((party) => party.id === existing.id)
        nextParties[index] = updated
        existingByName.set(normalizeKey(name), updated)
        importedDetails.push({
          action: 'Updated',
          name: updated.name,
          category: updated.category,
          country: updated.country,
          openingPayable: updated.openingPayable,
          status: updated.isActive ? 'Active' : 'Inactive',
        })
      } else {
        const created = withNewParty({
          name,
          address: getCsvValue(row, 'address'),
          phone: getCsvValue(row, 'phone'),
          panVatNo: getCsvValue(row, 'panVatNo', 'pan vat no', 'panVatNumber', 'pan vat number', 'vatNo', 'vat no'),
          country,
          category,
          openingPayable,
          isActive: parseBoolean(getCsvValue(row, 'isActive', 'active', 'status')),
        })
        nextParties.unshift(created)
        existingByName.set(normalizeKey(name), created)
        importedDetails.push({
          action: 'Imported',
          name: created.name,
          category: created.category,
          country: created.country,
          openingPayable: created.openingPayable,
          status: created.isActive ? 'Active' : 'Inactive',
        })
      }

      imported += 1
    })

    setDataWithLog(
      { ...data, parties: nextParties },
      'Imported parties',
      `${imported} party record${imported === 1 ? '' : 's'}`,
    )
    setPartyImportFile(null)
    setPartyImportResults(importedDetails)
    setPurchaseImportResults([])
    setPaymentImportResults([])
    setImportMessage(`Imported/updated ${imported} party record${imported === 1 ? '' : 's'}.`)
  }

  const importPurchases = async () => {
    if (!purchaseImportFile) {
      window.alert('Select an import purchase CSV file first.')
      return
    }

    setPartyImportResults([])
    setPaymentImportResults([])
    const rows = rowsToObjects(parseCsv(await purchaseImportFile.text()))
    const partiesByName = new Map(data.parties.map((party) => [normalizeKey(party.name), party]))
    const errors: string[] = []
    const importedPurchases: ImportPurchase[] = []
    const importedDetails: PurchaseImportResult[] = []

    rows.forEach((row, index) => {
      const line = index + 2
      const vendorName = getCsvValue(row, 'vendorName')
      const customAgentName = getCsvValue(row, 'customAgentName')
      const vendorBillNumber = getCsvValue(row, 'vendorBillNumber')
      const billDate = normalizeImportedDate(getCsvValue(row, 'billDate', 'billDateAD', 'billDateBS'), true)
      const pragapanpatraNumber = getCsvValue(row, 'pragapanpatraNumber')
      const pragapanpatraDate = normalizeImportedDate(getCsvValue(row, 'pragapanpatraDate', 'pragapanpatraDateBS'))
      const agentServiceBillDate = normalizeImportedDate(getCsvValue(row, 'agentServiceBillDate', 'agentServiceBillDateBS'))
      const vendor = partiesByName.get(normalizeKey(vendorName))
      const customAgent = partiesByName.get(normalizeKey(customAgentName))
      const freightStatusValue = getCsvValue(row, 'freightIndiaStatus')
      const freightIndiaStatus = resolveFreightStatus(freightStatusValue) ?? 'Paid by custom agent'
      const indianTransportName = getCsvValue(
        row,
        'freightIndiaPartyName',
        'indianTransportName',
        'transportName',
        'freightPartyName',
      )
      const indianTransportParty = partiesByName.get(normalizeKey(indianTransportName))

      if (!vendor) {
        const reason = `Vendor not found (${vendorName || 'blank'}).`
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          status: 'Skipped',
          line,
          vendor: vendorName || '-',
          billNumber: vendorBillNumber,
          billDate,
          supplierAmountNPR: 0,
          customAgent: customAgentName || '-',
          indianTransport: indianTransportName || '-',
          pragapanpatraNumber,
          debitNoteTotalNPR: 0,
          agentServiceTotalNPR: 0,
          totalInputVatNPR: 0,
          landedCostNPR: 0,
          remarks: reason,
        })
        return
      }

      if (!vendorBillNumber || !billDate) {
        const reason = 'Vendor bill number and bill date are required.'
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          status: 'Skipped',
          line,
          vendor: vendorName,
          billNumber: vendorBillNumber,
          billDate,
          supplierAmountNPR: 0,
          customAgent: customAgentName || '-',
          indianTransport: indianTransportName || '-',
          pragapanpatraNumber,
          debitNoteTotalNPR: 0,
          agentServiceTotalNPR: 0,
          totalInputVatNPR: 0,
          landedCostNPR: 0,
          remarks: reason,
        })
        return
      }

      if (customAgentName && !customAgent) {
        const reason = `Custom agent not found (${customAgentName}).`
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          status: 'Skipped',
          line,
          vendor: vendorName,
          billNumber: vendorBillNumber,
          billDate,
          supplierAmountNPR: 0,
          customAgent: customAgentName,
          indianTransport: indianTransportName || '-',
          pragapanpatraNumber,
          debitNoteTotalNPR: 0,
          agentServiceTotalNPR: 0,
          totalInputVatNPR: 0,
          landedCostNPR: 0,
          remarks: reason,
        })
        return
      }

      if (shouldCreditIndianTransport(freightIndiaStatus)) {
        if (!indianTransportParty) {
          const reason = `Indian transport party not found (${indianTransportName || 'blank'}).`
          errors.push(`Line ${line}: ${reason}`)
          importedDetails.push({
            status: 'Skipped',
            line,
            vendor: vendorName,
            billNumber: vendorBillNumber,
            billDate,
            supplierAmountNPR: 0,
            customAgent: customAgentName || '-',
            indianTransport: indianTransportName || '-',
            pragapanpatraNumber,
            debitNoteTotalNPR: 0,
            agentServiceTotalNPR: 0,
            totalInputVatNPR: 0,
            landedCostNPR: 0,
            remarks: reason,
          })
          return
        }

        if (!isIndianTransportCategory(indianTransportParty)) {
          const reason = 'Freight party must be in Indian Transport category.'
          errors.push(`Line ${line}: ${reason}`)
          importedDetails.push({
            status: 'Skipped',
            line,
            vendor: vendorName,
            billNumber: vendorBillNumber,
            billDate,
            supplierAmountNPR: 0,
            customAgent: customAgentName || '-',
            indianTransport: indianTransportParty.name,
            pragapanpatraNumber,
            debitNoteTotalNPR: 0,
            agentServiceTotalNPR: 0,
            totalInputVatNPR: 0,
            landedCostNPR: 0,
            remarks: reason,
          })
          return
        }
      }

      const draft = createEmptyPurchase(data.settings)
      const importedSupplierCurrency = normalizeSupplierCurrency(
        getCsvValue(row, 'supplierCurrency', 'currency') || data.settings.supplierPurchaseCurrency,
      )
      const supplierCurrency = data.settings.supplierPurchaseCurrency === 'USD'
        ? importedSupplierCurrency
        : 'INR'
      const importedSupplierRate = n(getCsvValue(row, 'supplierExchangeRate', 'exchangeRate', 'rate'))
      const importSupplierExchangeRate = supplierCurrency === 'USD'
        ? importedSupplierRate
        : data.settings.defaultExchangeRate

      if (supplierCurrency === 'USD' && importSupplierExchangeRate <= 0) {
        const reason = 'USD supplier exchange rate is required and must be greater than zero.'
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          status: 'Skipped',
          line,
          vendor: vendorName,
          billNumber: vendorBillNumber,
          billDate,
          supplierAmountNPR: 0,
          customAgent: customAgentName || '-',
          indianTransport: indianTransportName || '-',
          pragapanpatraNumber,
          debitNoteTotalNPR: 0,
          agentServiceTotalNPR: 0,
          totalInputVatNPR: 0,
          landedCostNPR: 0,
          remarks: reason,
        })
        return
      }

      const importFiscalDate = pragapanpatraDate || agentServiceBillDate
      if (importFiscalDate) {
        const validation = validateDateInFiscalYear(importFiscalDate, activeFiscalYear, 'Pragapanpatra/service date')
        if (!validation.valid) {
          const reason = validation.error ?? `Date is outside fiscal year ${activeFiscalYear.code}.`
          errors.push(`Line ${line}: ${reason}`)
          importedDetails.push({
            status: 'Skipped',
            line,
            vendor: vendorName,
            billNumber: vendorBillNumber,
            billDate,
            supplierAmountNPR: 0,
            customAgent: customAgentName || '-',
            indianTransport: indianTransportName || '-',
            pragapanpatraNumber,
            debitNoteTotalNPR: 0,
            agentServiceTotalNPR: 0,
            totalInputVatNPR: 0,
            landedCostNPR: 0,
            remarks: reason,
          })
          return
        }
      }

      const purchase = {
        ...draft,
        fiscalYearId: activeFiscalYear.id,
        vendorPartyId: vendor.id,
        vendorBillNumber,
        billDate,
        supplierCurrency,
        amountIC: n(getCsvValue(row, 'amountIC')),
        supplierExchangeRate: importSupplierExchangeRate,
        customAgentPartyId: customAgent?.id ?? '',
        debitNoteNumber: pragapanpatraNumber,
        debitNoteDate: pragapanpatraDate,
        importDutyNPR: n(getCsvValue(row, 'importDutyNPR')),
        customServiceNPR: n(getCsvValue(row, 'customServiceNPR')),
        importVatNPR: n(getCsvValue(row, 'importVatNPR')),
        terminalChargeWithoutVatNPR: n(getCsvValue(row, 'terminalChargeWithoutVatNPR')),
        freightIndiaStatus,
        freightIndiaPartyId: shouldCreditIndianTransport(freightIndiaStatus)
          ? indianTransportParty?.id ?? ''
          : '',
        freightIndiaAmountIC: n(getCsvValue(row, 'freightIndiaAmountIC')),
        freightIndiaExchangeRate: data.settings.defaultExchangeRate,
        totalKg: n(getCsvValue(row, 'totalKg', 'kg', 'totalWeightKg')),
        loadingUnloadingChargePerKg: n(getCsvValue(row, 'loadingUnloadingChargePerKg', 'loadingUnloadingPerKg', 'loadingChargePerKg')),
        otherChargesNPR: n(getCsvValue(row, 'otherChargesNPR')),
        agentServiceBillNumber: getCsvValue(row, 'agentServiceBillNumber'),
        agentServiceBillDate,
        agentServiceAmountBeforeVatNPR: n(getCsvValue(row, 'agentServiceAmountBeforeVatNPR')),
        remarks: getCsvValue(row, 'remarks'),
      }
      const totals = calculatePurchaseComputedTotals(purchase, purchasePolicy)

      if (hasAgentValues(purchase) && !purchase.customAgentPartyId) {
        const reason = 'Custom agent is required for Pragapanpatra/service values.'
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          status: 'Skipped',
          line,
          vendor: vendorName,
          billNumber: purchase.vendorBillNumber,
          billDate: purchase.billDate,
          supplierAmountNPR: totals.supplierAmountNPR,
          customAgent: '-',
          indianTransport: indianTransportParty?.name ?? '-',
          pragapanpatraNumber: purchase.debitNoteNumber,
          debitNoteTotalNPR: totals.debitNoteTotalNPR,
          agentServiceTotalNPR: totals.agentServiceTotalNPR,
          totalInputVatNPR: totals.totalInputVatNPR,
          landedCostNPR: totals.landedCostNPR,
          remarks: reason,
        })
        return
      }

      importedPurchases.push(withNewPurchase({
        ...purchase,
        ...totals,
        appliedVatRate: purchasePolicy.vatRatePercent,
        appliedExchangeRate: importSupplierExchangeRate,
        calculationVersion: purchasePolicy.calculationVersion,
        calculatedAt: new Date().toISOString(),
      }))
      importedDetails.push({
        status: 'Imported',
        line,
        vendor: vendor.name,
        billNumber: purchase.vendorBillNumber,
        billDate: purchase.billDate,
        supplierAmountNPR: totals.supplierAmountNPR,
        customAgent: customAgent?.name ?? '-',
        indianTransport: indianTransportParty?.name ?? '-',
        pragapanpatraNumber: purchase.debitNoteNumber,
        debitNoteTotalNPR: totals.debitNoteTotalNPR,
        agentServiceTotalNPR: totals.agentServiceTotalNPR,
        totalInputVatNPR: totals.totalInputVatNPR,
        landedCostNPR: totals.landedCostNPR,
        remarks: purchase.remarks || '-',
      })
    })

    if (!importedPurchases.length) {
      setPurchaseImportResults(importedDetails)
      setImportMessage(errors.length ? errors.join(' ') : 'No valid purchase records found.')
      return
    }

    setDataWithLog(
      { ...data, purchases: [...importedPurchases, ...data.purchases] },
      'Imported import purchases',
      `${importedPurchases.length} purchase record${importedPurchases.length === 1 ? '' : 's'}`,
    )
    setPurchaseImportFile(null)
    setPurchaseImportResults(importedDetails)
    setImportMessage(
      [
        `Imported ${importedPurchases.length} purchase record${importedPurchases.length === 1 ? '' : 's'}.`,
        errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped: ${errors.join(' ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const importIndianSupplierPayments = async () => {
    if (!indianSupplierPaymentImportFile) {
      window.alert('Select an Indian supplier payment CSV file first.')
      return
    }

    setPartyImportResults([])
    setPurchaseImportResults([])
    const rows = rowsToObjects(parseCsv(await indianSupplierPaymentImportFile.text()))
    const partiesByName = new Map(data.parties.map((party) => [normalizeKey(party.name), party]))
    const errors: string[] = []
    const importedPayments: Payment[] = []
    const importedDetails: PaymentImportResult[] = []

    rows.forEach((row, index) => {
      const line = index + 2
      const partyNameValue = getCsvValue(row, 'partyName', 'party', 'name')
      const party = partiesByName.get(normalizeKey(partyNameValue))
      const paymentDate = normalizeImportedDate(getCsvValue(row, 'paymentDate', 'paymentDateBS', 'date'))
      const amount = n(getCsvValue(row, 'amountIC', 'amount', 'amountLC'))
      const paymentMethodText = getCsvValue(row, 'paymentMethod', 'bank', 'method')
      const paymentMethodValue = resolvePaymentMethod(paymentMethodText)
      const billYearValue = getCsvValue(row, 'billYear', 'year') || 'Current'
      const bankOutflow = n(getCsvValue(row, 'bankOutflowNPR', 'bankOutflow', 'amountWithCommission'))
      const referenceNumber = getCsvValue(row, 'billNumber', 'referenceNumber', 'reference')
      const importedRemarks = getCsvValue(row, 'remarks')
      const resultBase = {
        line,
        mode: 'Indian Supplier',
        party: partyNameValue || '-',
        paymentDate,
        amount,
        paymentMethod: paymentMethodValue || paymentMethodText || '-',
        referenceNumber,
      }

      const skip = (reason: string) => {
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          ...resultBase,
          status: 'Skipped',
          paymentType: '-',
          currency: '-',
          amountNPR: 0,
          remarks: reason,
        })
      }

      if (!party) {
        skip(`Party not found (${partyNameValue || 'blank'}).`)
        return
      }

      if (!isIndianSupplierCategory(party) && !isIndianTransportCategory(party)) {
        skip('Party must be an Indian supplier or Indian Transport.')
        return
      }

      if (!paymentDate) {
        skip('Payment date is required.')
        return
      }

      {
        const validation = validateDateInFiscalYear(paymentDate, activeFiscalYear, 'Payment date')
        if (!validation.valid) {
          skip(validation.error ?? `Payment date is outside fiscal year ${activeFiscalYear.code}.`)
          return
        }
      }

      if (amount <= 0) {
        skip('Amount IC/LC is required.')
        return
      }

      if (!referenceNumber) {
        skip('Bill number is required.')
        return
      }

      if (!paymentMethodValue) {
        skip('Payment method is required and must match an available bank.')
        return
      }

      if (billYearValue !== 'Current' && billYearValue !== 'Last year') {
        skip('Bill year must be Current or Last year.')
        return
      }

      const amountNPR = amount * data.settings.defaultExchangeRate
      if (!isIndianTransportCategory(party) && (bankOutflow <= 0 || bankOutflow < amountNPR)) {
        skip('Bank outflow NPR is required and cannot be less than converted supplier payment NPR.')
        return
      }

      const remarks = [
        `Bill year: ${billYearValue}`,
        bankOutflow > 0 ? `Bank outflow NPR: ${fmt(bankOutflow)}` : '',
        bankOutflow > 0 ? `Commission expense NPR: ${fmt(Math.max(0, bankOutflow - amountNPR))}` : '',
        importedRemarks,
      ]
        .filter(Boolean)
        .join('; ')
      const created = withNewPayment({
        fiscalYearId: activeFiscalYear.id,
        partyId: party.id,
        paymentDate,
        paymentType: 'Indian Supplier Payment',
        currency: 'INR/IC',
        amount,
        exchangeRate: data.settings.defaultExchangeRate,
        amountNPR,
        paymentMethod: paymentMethodValue,
        referenceNumber,
        remarks,
      })

      importedPayments.push(created)
      importedDetails.push({
        ...resultBase,
        status: 'Imported',
        party: party.name,
        paymentMethod: paymentMethodValue,
        paymentType: created.paymentType,
        currency: created.currency,
        amountNPR: created.amountNPR,
        remarks: created.remarks || '-',
      })
    })

    if (!importedPayments.length) {
      setPaymentImportResults(importedDetails)
      setImportMessage(errors.length ? errors.join(' ') : 'No valid Indian supplier payment records found.')
      return
    }

    setDataWithLog(
      { ...data, payments: [...importedPayments, ...data.payments] },
      'Imported Indian supplier payments',
      `${importedPayments.length} payment record${importedPayments.length === 1 ? '' : 's'}`,
    )
    setIndianSupplierPaymentImportFile(null)
    setPaymentImportResults(importedDetails)
    setImportMessage(
      [
        `Imported ${importedPayments.length} Indian supplier payment record${importedPayments.length === 1 ? '' : 's'}.`,
        errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped: ${errors.join(' ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const importOtherPayments = async () => {
    if (!otherPaymentImportFile) {
      window.alert('Select a custom agent/local payment CSV file first.')
      return
    }

    setPartyImportResults([])
    setPurchaseImportResults([])
    const rows = rowsToObjects(parseCsv(await otherPaymentImportFile.text()))
    const partiesByName = new Map(data.parties.map((party) => [normalizeKey(party.name), party]))
    const errors: string[] = []
    const importedPayments: Payment[] = []
    const importedDetails: PaymentImportResult[] = []

    rows.forEach((row, index) => {
      const line = index + 2
      const partyNameValue = getCsvValue(row, 'partyName', 'party', 'name')
      const party = partiesByName.get(normalizeKey(partyNameValue))
      const paymentDate = normalizeImportedDate(getCsvValue(row, 'paymentDate', 'paymentDateBS', 'date'))
      const amount = n(getCsvValue(row, 'amountNPR', 'amount'))
      const paymentMethodText = getCsvValue(row, 'paymentMethod', 'bank', 'method')
      const paymentMethodValue = resolvePaymentMethod(paymentMethodText)
      const referenceNumber = getCsvValue(row, 'referenceNumber', 'reference', 'billNumber')
      const importedRemarks = getCsvValue(row, 'remarks')
      const resultBase = {
        line,
        mode: 'Custom Agent / Local',
        party: partyNameValue || '-',
        paymentDate,
        amount,
        paymentMethod: paymentMethodValue || paymentMethodText || '-',
        referenceNumber,
      }

      const skip = (reason: string) => {
        errors.push(`Line ${line}: ${reason}`)
        importedDetails.push({
          ...resultBase,
          status: 'Skipped',
          paymentType: '-',
          currency: '-',
          amountNPR: 0,
          remarks: reason,
        })
      }

      if (!party) {
        skip(`Party not found (${partyNameValue || 'blank'}).`)
        return
      }

      if (isIndianSupplierCategory(party)) {
        skip('Party cannot be an Indian supplier. Use Indian Supplier Payment Import instead.')
        return
      }

      if (!paymentDate) {
        skip('Payment date is required.')
        return
      }

      {
        const validation = validateDateInFiscalYear(paymentDate, activeFiscalYear, 'Payment date')
        if (!validation.valid) {
          skip(validation.error ?? `Payment date is outside fiscal year ${activeFiscalYear.code}.`)
          return
        }
      }

      if (amount <= 0) {
        skip('Amount NPR is required.')
        return
      }

      if (!paymentMethodValue) {
        skip('Payment method is required and must match an available bank.')
        return
      }

      const created = withNewPayment({
        fiscalYearId: activeFiscalYear.id,
        partyId: party.id,
        paymentDate,
        paymentType: paymentTypeForNonSupplierParty(party),
        currency: 'NPR',
        amount,
        exchangeRate: 1,
        amountNPR: amount,
        paymentMethod: paymentMethodValue,
        referenceNumber,
        remarks: importedRemarks,
      })

      importedPayments.push(created)
      importedDetails.push({
        ...resultBase,
        status: 'Imported',
        party: party.name,
        paymentMethod: paymentMethodValue,
        paymentType: created.paymentType,
        currency: created.currency,
        amountNPR: created.amountNPR,
        remarks: created.remarks || '-',
      })
    })

    if (!importedPayments.length) {
      setPaymentImportResults(importedDetails)
      setImportMessage(errors.length ? errors.join(' ') : 'No valid custom agent/local payment records found.')
      return
    }

    setDataWithLog(
      { ...data, payments: [...importedPayments, ...data.payments] },
      'Imported custom agent/local payments',
      `${importedPayments.length} payment record${importedPayments.length === 1 ? '' : 's'}`,
    )
    setOtherPaymentImportFile(null)
    setPaymentImportResults(importedDetails)
    setImportMessage(
      [
        `Imported ${importedPayments.length} custom agent/local payment record${importedPayments.length === 1 ? '' : 's'}.`,
        errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped: ${errors.join(' ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const saveParty = (event: FormEvent) => {
    event.preventDefault()

    if (!partyForm.name.trim()) {
      window.alert('Party name is required.')
      return
    }

    if (partyForm.id && !canEditOrDelete) {
      window.alert('Account user cannot edit existing parties.')
      return
    }

    if (partyForm.id) {
      const previous = data.parties.find((party) => party.id === partyForm.id)
      const updated = withUpdatedParty({
        ...(partyForm as Party),
        createdAt: partyForm.createdAt || new Date().toISOString(),
        updatedAt: partyForm.updatedAt || new Date().toISOString(),
      })
      const next = {
        ...data,
        parties: data.parties.map((party) => (party.id === updated.id ? updated : party)),
      }
      setDataWithLog(next, 'Updated party', updated.name, auditValue(previous), auditValue(updated))
    } else {
      const created = withNewParty({
        name: partyForm.name.trim(),
        address: partyForm.address,
        phone: partyForm.phone,
        panVatNo: partyForm.panVatNo,
        country: partyForm.country,
        category: partyForm.category,
        openingPayable: partyForm.openingPayable,
        isActive: partyForm.isActive,
      })
      setDataWithLog(
        { ...data, parties: [created, ...data.parties] },
        'Created party',
        created.name,
      )
    }

    setPartyForm(emptyParty)
  }

  const editParty = (party: Party) => {
    setPartyForm(party)
    navigateToView('Party Master')
  }

  const hardDeleteParty = (party: Party) => {
    const linkedPurchases = data.purchases.filter(
      (purchase) =>
        purchase.vendorPartyId === party.id ||
        purchase.customAgentPartyId === party.id ||
        purchase.freightIndiaPartyId === party.id,
    )
    const linkedPayments = data.payments.filter((payment) => payment.partyId === party.id)
    const linkedLocalExpenses = data.localExpenses.filter(
      (localExpense) => localExpense.partyId === party.id,
    )
    const message = [
      `Delete ${party.name} permanently?`,
      `This will remove opening balance and party master record.`,
      `${linkedPurchases.length} import purchase record(s), ${linkedLocalExpenses.length} local purchase/expense record(s), and ${linkedPayments.length} payment record(s) will also be deleted.`,
    ].join('\n')

    if (!window.confirm(message)) {
      return
    }

    const next = {
      ...data,
      parties: data.parties.filter((item) => item.id !== party.id),
      purchases: data.purchases.filter(
        (purchase) =>
          purchase.vendorPartyId !== party.id &&
          purchase.customAgentPartyId !== party.id &&
          purchase.freightIndiaPartyId !== party.id,
      ),
      localExpenses: data.localExpenses.filter(
        (localExpense) => localExpense.partyId !== party.id,
      ),
      payments: data.payments.filter((payment) => payment.partyId !== party.id),
    }

    setDataWithLog(
      next,
      'Hard deleted party',
      `${party.name} with ${linkedPurchases.length} import purchase(s), ${linkedLocalExpenses.length} local expense(s), ${linkedPayments.length} payment(s)`,
      auditValue({
        party,
        linkedPurchases,
        linkedLocalExpenses,
        linkedPayments,
      }),
      'Deleted',
    )

    if (partyForm.id === party.id) {
      setPartyForm(emptyParty)
    }
    if (
      purchaseForm.vendorPartyId === party.id ||
      purchaseForm.customAgentPartyId === party.id ||
      purchaseForm.freightIndiaPartyId === party.id
    ) {
      setPurchaseForm(createEmptyPurchase(data.settings))
    }
    if (paymentForm.partyId === party.id) {
      setPaymentForm(createEmptyPayment())
    }
    if (localExpenseForm.partyId === party.id) {
      setLocalExpenseForm(createEmptyLocalExpense())
    }
    if (ledgerPartyId === party.id) {
      setLedgerPartyId('')
    }
  }

  const savePurchase = async (event: FormEvent) => {
    event.preventDefault()
    const operationId = `PURCHASE-SAVE-${createId()}`
    console.info('[purchase-persistence]', {
      operationId,
      action: purchaseForm.id ? 'update-import-purchase' : 'create-import-purchase',
      companyId: getActiveCompanyId() || 'default',
      fiscalYearId: activeFiscalYear.id,
      fiscalYear: activeFiscalYear.code,
      databaseUrl: getActivePurchaseDatabaseUrl(),
      billNumber: purchaseForm.vendorBillNumber,
    })

    try {
      ensureFiscalYearEditable(activeFiscalYear)
    } catch (error) {
      const errors = [{ field: 'billDate', message: errorMessage(error) }]
      setPurchaseValidationErrors(errors)
      focusFirstInvalidField(errors)
      return
    }

    if (purchaseForm.id && !canEditPurchase) {
      const errors = [{ field: 'vendorBillNumber', message: 'This purchase cannot be edited in the current role or year.' }]
      setPurchaseValidationErrors(errors)
      focusFirstInvalidField(errors)
      return
    }

    const fiscalDate =
      normalizeBsDate(purchaseForm.debitNoteDate) ||
      normalizeBsDate(purchaseForm.agentServiceBillDate)
    const transactionFiscalYear = activeFiscalYear
    const manualErrors: FieldError[] = []

    if (fiscalDate) {
      const fiscalDateValidation = validateDateInFiscalYear(fiscalDate, activeFiscalYear, 'Pragapanpatra/service date')
      if (!fiscalDateValidation.valid) {
        manualErrors.push({
          field: purchaseForm.debitNoteDate ? 'debitNoteDate' : 'agentServiceBillDate',
          message: fiscalDateValidation.error ?? `Date is outside fiscal year ${activeFiscalYear.code}.`,
        })
      }
    }

    if (!purchaseForm.billDate) {
      manualErrors.push({ field: 'billDate', message: 'Bill date is required.' })
    }

    if (hasAgentValues(purchaseForm) && !purchaseForm.customAgentPartyId) {
      manualErrors.push({
        field: 'customAgentPartyId',
        message: 'Custom agent is required when Pragapanpatra or service bill values are entered.',
      })
    }

    if (!purchaseForm.freightIndiaStatus) {
      manualErrors.push({ field: 'freightIndiaStatus', message: 'Freight India status is required.' })
    }

    if (supplierExchangeRate <= 0) {
      manualErrors.push({
        field: 'supplierExchangeRate',
        message: `${selectedSupplierCurrency} exchange rate must be greater than zero.`,
      })
    }

    const purchaseValidation = validatePurchaseFormForUi({
      purchase: {
        ...purchaseForm,
        billDate: fiscalDate || transactionFiscalYear.startBs,
        supplierExchangeRate,
      },
      fiscalYear: transactionFiscalYear,
      vendorCategory: partyById.get(purchaseForm.vendorPartyId)?.category,
      vatRatePercent: purchasePolicy.vatRatePercent,
      existingPurchases: data.purchases,
    })
    const validationErrors = [
      ...manualErrors,
      ...purchaseValidation.errors,
      ...purchaseValidation.warnings,
    ]
    setPurchaseValidationErrors(validationErrors)
    setPurchaseValidationWarnings([])

    if (validationErrors.length) {
      console.warn('[purchase-persistence]', {
        operationId,
        action: 'validation-failed',
        errors: validationErrors,
      })
      focusFirstInvalidField(validationErrors)
      return
    }

    const fixedRatePurchase = {
      ...purchaseForm,
      fiscalYearId: transactionFiscalYear.id,
      debitNoteDate: normalizeBsDate(purchaseForm.debitNoteDate),
      agentServiceBillDate: normalizeBsDate(purchaseForm.agentServiceBillDate),
      supplierCurrency: selectedSupplierCurrency,
      supplierExchangeRate,
      freightIndiaPartyId: shouldCreditIndianTransport(purchaseForm.freightIndiaStatus)
        ? purchaseForm.freightIndiaPartyId
        : '',
      freightIndiaExchangeRate: data.settings.defaultExchangeRate,
    }
    const totalsForSave = calculatePurchaseComputedTotals(fixedRatePurchase, purchasePolicy)
    const purchaseToSave = {
      ...fixedRatePurchase,
      ...totalsForSave,
      agentServiceVatNPR: totalsForSave.agentServiceVatNPR,
      appliedVatRate: purchasePolicy.vatRatePercent,
      appliedExchangeRate: supplierExchangeRate,
      calculationVersion: purchasePolicy.calculationVersion,
      calculatedAt: new Date().toISOString(),
    }
    const purchaseReview = [
      purchaseForm.id ? 'Review purchase update before save:' : 'Review purchase before save:',
      `Vendor: ${partyName(purchaseToSave.vendorPartyId)}`,
      `Bill number: ${purchaseToSave.vendorBillNumber}`,
      `Supplier currency: ${purchaseToSave.supplierCurrency}`,
      `Supplier amount: ${supplierMoney(purchaseToSave.amountIC, purchaseToSave.supplierCurrency)}`,
      `Supplier exchange rate: ${rateFmt(purchaseToSave.supplierExchangeRate)}`,
      `Supplier payable: ${npr(purchaseToSave.supplierAmountNPR)}`,
      `Indian transport: ${purchaseToSave.freightIndiaPartyId ? partyName(purchaseToSave.freightIndiaPartyId) : '-'}`,
      `Agent payable: ${npr(purchaseToSave.totalAgentPayableNPR)}`,
      `VAT: ${npr(purchaseToSave.totalInputVatNPR)}`,
      `Landed cost: ${npr(purchaseToSave.landedCostNPR)}`,
      `Remarks: ${purchaseToSave.remarks || '-'}`,
      '',
      'Save this purchase?',
    ].join('\n')

    if (!window.confirm(purchaseReview)) {
      return
    }

    if (purchaseForm.id) {
      const previous = data.purchases.find((purchase) => purchase.id === purchaseForm.id)
      const updated = withUpdatedPurchase(purchaseToSave)
      let ledgerEntries: LedgerEntry[]

      try {
        ledgerEntries = buildImportPurchaseLedgerEntries(updated)
      } catch (error) {
        console.error('[purchase-persistence]', {
          operationId,
          action: 'posting-update-failed',
          error: errorMessage(error),
        })
        const errors = [{ field: 'vendorBillNumber', message: errorMessage(error) }]
        setPurchaseValidationErrors(errors)
        focusFirstInvalidField(errors)
        return
      }

      const next = {
        ...data,
        purchases: data.purchases.map((purchase) =>
          purchase.id === updated.id ? updated : purchase,
        ),
        ledgerEntries: replaceLedgerEntriesForSource('PURCHASE', updated.id, ledgerEntries),
      }
      const saved = await persistDataWithLog(next, 'Updated import purchase', updated.vendorBillNumber, {
        operationId,
        oldValue: auditValue(previous),
        newValue: auditValue(updated),
        importPurchaseId: updated.id,
      })
      if (!saved) {
        return
      }
    } else {
      const created = withNewPurchase({
        ...purchaseToSave,
        lifecycleStatus: 'POSTED',
        postedAt: new Date().toISOString(),
        postedBy: userRole ?? 'Unknown',
      })
      let ledgerEntries: LedgerEntry[]

      try {
        console.info('[purchase-persistence]', {
          operationId,
          action: 'posting-import-purchase',
          landedCostNPR: created.landedCostNPR,
          supplierAmountNPR: created.supplierAmountNPR,
          totalAgentPayableNPR: created.totalAgentPayableNPR,
          totalInputVatNPR: created.totalInputVatNPR,
        })
        ledgerEntries = buildImportPurchaseLedgerEntries(created)
      } catch (error) {
        console.error('[purchase-persistence]', {
          operationId,
          action: 'posting-failed',
          error: errorMessage(error),
        })
        const errors = [{ field: 'vendorBillNumber', message: errorMessage(error) }]
        setPurchaseValidationErrors(errors)
        focusFirstInvalidField(errors)
        return
      }

      const saved = await persistDataWithLog(
        { ...data, purchases: [created, ...data.purchases], ledgerEntries: replaceLedgerEntriesForSource('PURCHASE', created.id, ledgerEntries) },
        'Created import purchase',
        `${partyName(created.vendorPartyId)} - ${created.vendorBillNumber}`,
        { operationId, importPurchaseId: created.id },
      )
      if (!saved) {
        return
      }
    }

    setPurchaseValidationErrors([])
    setPurchaseValidationWarnings([])
    purchaseAutosave.clearDraft()
    setPurchaseForm(createEmptyPurchase(data.settings))
  }

  const editPurchase = (purchase: ImportPurchase) => {
    setPurchaseForm(purchase)
    navigateToView('Import Purchase Entry')
  }

  const isStockEntryReadOnly = (status?: ImportPurchase['lifecycleStatus']) =>
    isReadOnly || isClosedFiscalYear || ['VOID', 'REVERSED'].includes(status ?? 'POSTED')

  const cleanupLinkedPurchaseStock = async (
    documentId: string,
    sourceType: 'Import Purchase' | 'Local Purchase',
    label: string,
  ) => {
    if (!inventoryEnabled) {
      return
    }

    try {
      await deleteStockPurchaseLinesForDocument(documentId, sourceType)
      await refreshPurchaseStock()
    } catch (error) {
      console.error('Could not delete linked inventory lines.', error)
      setDashboardEntryMessage(`Deleted ${label}, but linked inventory lines could not be removed.`)
    }
  }

  const openStockEntryForPurchase = (purchase: ImportPurchase) => {
    if (!onOpenStockLineEntry || !activeCompanyProfile) {
      setDashboardEntryMessage('Inventory module is not available for this company.')
      return
    }

    onOpenStockLineEntry(buildStockEntryTarget({
      amount: purchase.amountIC,
      amountCurrency: purchase.supplierCurrency,
      amountNpr: purchase.supplierAmountNPR,
      billNo: purchase.vendorBillNumber,
      calculatedAt: purchase.calculatedAt,
      calculationVersion: purchase.calculationVersion,
      companyId: activeCompanyProfile.id,
      date: purchase.debitNoteDate || purchase.billDate || purchase.agentServiceBillDate,
      documentId: purchase.id,
      exchangeRate: purchase.supplierExchangeRate,
      fiscalYear: activeCompanyProfile.fiscalYear,
      fiscalYearId: purchase.fiscalYearId || activeFiscalYear.id,
      grandTotal: purchase.amountIC,
      landedCostNpr: purchase.landedCostNPR,
      lifecycleStatus: purchase.lifecycleStatus,
      partyName: partyName(purchase.vendorPartyId),
      readOnly: isStockEntryReadOnly(purchase.lifecycleStatus),
      referenceNo: purchase.debitNoteNumber,
      remarks: purchase.remarks,
      source: 'Importation',
      type: 'Import Purchase',
      vatAmount: 0,
    }))
  }

  const openStockEntryForLocalExpense = (localExpense: LocalPurchaseExpense) => {
    if (!isLocalPurchaseStock(localExpense)) {
      setDashboardEntryMessage('Only local purchase entries with Stock heading can use inventory line entry.')
      return
    }

    if (!onOpenStockLineEntry || !activeCompanyProfile) {
      setDashboardEntryMessage('Inventory module is not available for this company.')
      return
    }

    onOpenStockLineEntry(buildStockEntryTarget({
      amount: localExpense.amountBeforeVatNPR,
      amountCurrency: 'NPR',
      amountNpr: localExpense.amountBeforeVatNPR,
      billNo: localExpense.billNumber,
      companyId: activeCompanyProfile.id,
      date: localExpense.billDate,
      documentId: localExpense.id,
      exchangeRate: 1,
      fiscalYear: activeCompanyProfile.fiscalYear,
      fiscalYearId: localExpense.fiscalYearId || activeFiscalYear.id,
      grandTotal: localExpense.totalAmountNPR,
      landedCostNpr: localExpense.amountBeforeVatNPR,
      lifecycleStatus: localExpense.lifecycleStatus,
      partyName: partyName(localExpense.partyId),
      readOnly: isStockEntryReadOnly(localExpense.lifecycleStatus),
      referenceNo: localExpense.expenseHead,
      remarks: localExpense.remarks,
      source: 'Local Purchase',
      type: 'Local Purchase',
      vatAmount: localExpense.vatNPR,
    }))
  }

  const deletePurchase = async (purchase: ImportPurchase) => {
    if (!window.confirm(`Delete purchase bill ${purchase.vendorBillNumber}?`)) {
      return
    }

    const next = {
      ...data,
      purchases: data.purchases.filter((item) => item.id !== purchase.id),
    }
    const saved = await persistDataWithLog(next, 'Deleted import purchase', purchase.vendorBillNumber, {
      oldValue: auditValue(purchase),
      newValue: 'Deleted',
      deletedImportPurchaseId: purchase.id,
    })
    if (!saved) {
      return
    }
    void cleanupLinkedPurchaseStock(purchase.id, 'Import Purchase', `purchase bill ${purchase.vendorBillNumber}`)
  }

  const otherPaymentTypeForParty = (party: Party | undefined): Payment['paymentType'] => {
    return paymentTypeForNonSupplierParty(party)
  }

  const savePayment = (event: FormEvent) => {
    event.preventDefault()

    try {
      ensureFiscalYearEditable(activeFiscalYear)
    } catch (error) {
      const errors = [{ field: 'paymentDate', message: errorMessage(error) }]
      setPaymentValidationErrors(errors)
      focusFirstInvalidField(errors)
      return
    }

    const selectedParty = partyById.get(paymentForm.partyId)
    const isIndianTransportPayment = selectedParty ? isIndianTransportCategory(selectedParty) : false
    const paymentToSave =
      paymentMode === 'Indian Supplier'
        ? {
          ...paymentForm,
          fiscalYearId: activeFiscalYear.id,
          paymentDate: normalizeBsDate(paymentForm.paymentDate),
          paymentType: 'Indian Supplier Payment' as const,
            currency: selectedSupplierPaymentCurrency,
            amount: paymentForm.amount,
            exchangeRate: selectedSupplierPaymentExchangeRate,
            amountNPR: indianSupplierPaymentNPR,
            remarks: [
              `Bill year: ${paymentBillYear}`,
              bankOutflowNPR > 0 ? `Bank outflow NPR: ${fmt(bankOutflowNPR)}` : '',
              bankOutflowNPR > 0 ? `Commission expense NPR: ${fmt(commissionExpenseNPR)}` : '',
            ].filter(Boolean).join('; '),
          }
        : {
            ...paymentForm,
            fiscalYearId: activeFiscalYear.id,
            paymentDate: normalizeBsDate(paymentForm.paymentDate),
            paymentType: otherPaymentTypeForParty(selectedParty),
            currency: 'NPR' as const,
            amount: paymentForm.amount,
            exchangeRate: 1,
            amountNPR: paymentForm.amount,
            referenceNumber: '',
            remarks: '',
          }

    const paymentManualErrors: FieldError[] = []

    if (!paymentForm.partyId) {
      paymentManualErrors.push({ field: 'partyId', message: 'Party is required.' })
    }

    if (!paymentForm.paymentDate) {
      paymentManualErrors.push({ field: 'paymentDate', message: 'Payment date is required.' })
    }

    if (paymentMode === 'Indian Supplier' && paymentForm.amount <= 0) {
      paymentManualErrors.push({ field: 'amount', message: 'Amount in IC/LC is required.' })
    }

    if (paymentMode === 'Indian Supplier' && selectedSupplierPaymentExchangeRate <= 0) {
      paymentManualErrors.push({
        field: 'exchangeRate',
        message: `${selectedSupplierPaymentCurrency} exchange rate must be greater than zero.`,
      })
    }

    if (paymentMode === 'Indian Supplier' && !paymentForm.referenceNumber.trim()) {
      paymentManualErrors.push({ field: 'referenceNumber', message: 'Bill number is required.' })
    }

    if (paymentMode === 'Indian Supplier' && !isIndianTransportPayment && bankOutflowNPR < indianSupplierPaymentNPR) {
      paymentManualErrors.push({
        field: 'bankOutflowNPR',
        message: 'Amount in NC with commission cannot be less than converted supplier payment NPR.',
      })
    }

    if (paymentMode === 'Other Party' && paymentForm.amount <= 0) {
      paymentManualErrors.push({ field: 'amount', message: 'Payment amount is required.' })
    }

    const paymentValidation = validatePaymentDomain({
      payment: paymentToSave,
      fiscalYear: activeFiscalYear,
    })
    const validationErrors = [
      ...paymentManualErrors,
      ...paymentValidation.errors,
    ]
    setPaymentValidationErrors(validationErrors)

    if (validationErrors.length) {
      focusFirstInvalidField(validationErrors)
      return
    }

    if (paymentForm.id && !canEditOrDelete) {
      const errors = [{ field: 'partyId', message: 'Account user cannot edit existing payments.' }]
      setPaymentValidationErrors(errors)
      focusFirstInvalidField(errors)
      return
    }
    const paymentReview = [
      paymentForm.id ? 'Review payment update before save:' : 'Review payment before save:',
      `Party: ${partyName(paymentToSave.partyId)}`,
      `Reference: ${paymentToSave.referenceNumber || '-'}`,
      `Supplier payable impact: ${isSupplierPayment(paymentToSave) ? npr(-paymentToSave.amountNPR) : npr(0)}`,
      `Agent payable impact: ${isAgentPayment(paymentToSave) ? npr(-paymentToSave.amountNPR) : npr(0)}`,
      `VAT: ${npr(0)}`,
      `Landed cost: ${npr(0)}`,
      `Remarks: ${paymentToSave.remarks || '-'}`,
      '',
      'Save this payment?',
    ].join('\n')

    if (!window.confirm(paymentReview)) {
      return
    }

    if (paymentForm.id) {
      const previous = data.payments.find((payment) => payment.id === paymentForm.id)
      const updated = withUpdatedPayment(paymentToSave)
      const next = {
        ...data,
        payments: data.payments.map((payment) =>
          payment.id === updated.id ? updated : payment,
        ),
      }
      setDataWithLog(
        next,
        'Updated payment',
        `${partyName(updated.partyId)} - ${npr(updated.amountNPR)}`,
        auditValue(previous),
        auditValue(updated),
      )
    } else {
      const created = withNewPayment({
        ...paymentToSave,
        lifecycleStatus: 'POSTED',
        postedAt: new Date().toISOString(),
        postedBy: userRole ?? 'Unknown',
      })
      const ledgerEntries = postSupplierPayment({
        id: created.id,
        lifecycleStatus: 'DRAFT',
        fiscalYearId: created.fiscalYearId,
        date: created.paymentDate,
        partyId: created.partyId,
        paymentType: created.paymentType,
        amountNPR: created.amountNPR,
        reference: created.referenceNumber || created.id,
      }, postingContext(created.fiscalYearId))
      setDataWithLog(
        {
          ...data,
          payments: [created, ...data.payments],
          ledgerEntries: appendLedgerEntries(ledgerEntries),
        },
        'Created payment',
        `${partyName(created.partyId)} - ${npr(created.amountNPR)}`,
      )
    }

    setPaymentForm(createEmptyPayment())
    setPaymentValidationErrors([])
    setPaymentBillYear('Current')
    resetSupplierPaymentCurrency()
    setBankOutflowNPR(0)
  }

  const editPayment = (payment: Payment) => {
    setPaymentForm(payment)
    setPaymentMode(isSupplierPayment(payment) ? 'Indian Supplier' : 'Other Party')
    setSupplierPaymentCurrency(normalizeSupplierCurrency(payment.currency))
    setSupplierPaymentExchangeRate(payment.exchangeRate || data.settings.defaultExchangeRate)
    setPaymentBillYear(payment.remarks.includes('Last year') ? 'Last year' : 'Current')
    setBankOutflowNPR(payment.amountNPR)
    navigateToView('Payment Entry')
  }

  const deletePayment = (payment: Payment) => {
    if (!window.confirm(`Delete payment ${payment.referenceNumber || payment.id}?`)) {
      return
    }

    const next = {
      ...data,
      payments: data.payments.filter((item) => item.id !== payment.id),
      paymentAllocations: data.paymentAllocations.filter((allocation) => allocation.paymentId !== payment.id),
    }
    setDataWithLog(
      next,
      'Deleted payment',
      `${partyName(payment.partyId)} - ${npr(payment.amountNPR)}`,
      auditValue(payment),
      'Deleted',
    )
  }

  const saveLocalExpense = async (event: FormEvent) => {
    event.preventDefault()

    try {
      ensureFiscalYearEditable(activeFiscalYear)
    } catch (error) {
      window.alert(errorMessage(error))
      return
    }

    if (!localExpenseForm.partyId || !localExpenseForm.billNumber.trim() || !localExpenseForm.billDate) {
      window.alert('Local supplier, bill number, and bill date are required.')
      return
    }

    if (localExpenseForm.id && !canEditOrDelete) {
      window.alert('Account user cannot edit existing local purchase/expense entries.')
      return
    }

    const dateValidation = validateDateInFiscalYear(localExpenseForm.billDate, activeFiscalYear, 'Bill date')
    if (!dateValidation.valid) {
      window.alert(dateValidation.error ?? 'Bill date is outside the fiscal year.')
      return
    }

    const localExpenseToSave = {
      ...localExpenseForm,
      expenseHead: isLocalPurchaseStock(localExpenseForm) ? '' : localExpenseForm.expenseHead,
      fiscalYearId: activeFiscalYear.id,
      billDate: normalizeBsDate(localExpenseForm.billDate),
      vatNPR: localExpenseVatNPR,
      totalAmountNPR: localExpenseTotalNPR,
    }

    if (localExpenseForm.id) {
      const previous = data.localExpenses.find((localExpense) => localExpense.id === localExpenseForm.id)
      const updated = withUpdatedLocalExpense(localExpenseToSave)
      const next = {
        ...data,
        localExpenses: data.localExpenses.map((localExpense) =>
          localExpense.id === updated.id ? updated : localExpense,
        ),
      }
      const saved = await persistDataWithLog(
        next,
        'Updated local purchase/expense',
        updated.billNumber,
        {
          oldValue: auditValue(previous),
          newValue: auditValue(updated),
          localExpenseId: updated.id,
        },
      )
      if (!saved) {
        return
      }
    } else {
      const created = withNewLocalExpense({
        ...localExpenseToSave,
        lifecycleStatus: 'POSTED',
        postedAt: new Date().toISOString(),
        postedBy: userRole ?? 'Unknown',
      })
      let ledgerEntries: LedgerEntry[]

      try {
        ledgerEntries = postLocalExpense({
          id: created.id,
          lifecycleStatus: 'DRAFT',
          fiscalYearId: created.fiscalYearId,
          date: created.billDate,
          partyId: created.partyId,
          expenseType: created.expenseType,
          amountBeforeVatNPR: created.amountBeforeVatNPR,
          vatNPR: created.vatNPR,
          totalAmountNPR: created.totalAmountNPR,
          reference: created.billNumber,
        }, postingContext(created.fiscalYearId))
      } catch (error) {
        window.alert(errorMessage(error))
        return
      }

      const saved = await persistDataWithLog(
        { ...data, localExpenses: [created, ...data.localExpenses], ledgerEntries: appendLedgerEntries(ledgerEntries) },
        'Created local purchase/expense',
        `${partyName(created.partyId)} - ${created.billNumber}`,
        { localExpenseId: created.id },
      )
      if (!saved) {
        return
      }
    }

    setLocalExpenseForm(createEmptyLocalExpense())
  }

  const createQuickLocalSupplier = (event: FormEvent) => {
    event.preventDefault()

    const name = quickLocalSupplierForm.name.trim()
    if (!name) {
      window.alert('Party name is required.')
      return
    }

    const existing = data.parties.find(
      (party) => party.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      setLocalExpenseForm((current) => ({ ...current, partyId: existing.id }))
      setQuickLocalSupplierForm(emptyQuickLocalSupplier)
      return
    }

    const created = withNewParty({
      name,
      address: '',
      phone: quickLocalSupplierForm.phone,
      panVatNo: quickLocalSupplierForm.panVatNo,
      country: 'Nepal',
      category: 'Local Suppliers',
      openingPayable: quickLocalSupplierForm.openingPayable,
      isActive: true,
    })
    setDataWithLog(
      { ...data, parties: [created, ...data.parties] },
      'Created local supplier',
      created.name,
    )
    setLocalExpenseForm((current) => ({ ...current, partyId: created.id }))
    setQuickLocalSupplierForm(emptyQuickLocalSupplier)
  }

  const editLocalExpense = (localExpense: LocalPurchaseExpense) => {
    setLocalExpenseForm(localExpense)
    navigateToView('Local Purchase / Expense')
  }

  const deleteLocalExpense = async (localExpense: LocalPurchaseExpense) => {
    if (!window.confirm(`Delete local purchase/expense ${localExpense.billNumber}?`)) {
      return
    }

    const next = {
      ...data,
      localExpenses: data.localExpenses.filter((item) => item.id !== localExpense.id),
    }
    const saved = await persistDataWithLog(
      next,
      'Deleted local purchase/expense',
      `${partyName(localExpense.partyId)} - ${localExpense.billNumber}`,
      {
        oldValue: auditValue(localExpense),
        newValue: 'Deleted',
        deletedLocalExpenseId: localExpense.id,
      },
    )
    if (!saved) {
      return
    }
    void cleanupLinkedPurchaseStock(localExpense.id, 'Local Purchase', `local purchase/expense ${localExpense.billNumber}`)
  }

  const openGlobalSearchResult = (result: (typeof globalSearchResults)[number]) => {
    if (result.type === 'Party') {
      const party = data.parties.find((item) => item.id === result.id)
      if (party) {
        editParty(party)
      }
      return
    }

    if (result.type === 'Purchase') {
      const purchase = data.purchases.find((item) => item.id === result.id)
      if (purchase) {
        editPurchase(purchase)
      }
      return
    }

    const payment = data.payments.find((item) => item.id === result.id)
    if (payment) {
      editPayment(payment)
    }
  }

  const exportPartyLedgerPdf = async () => {
    if (!selectedLedgerParty) {
      window.alert('Select a party first.')
      return
    }

    const fileName = `${sanitizeFileName(selectedLedgerParty.name)}_${todayForFileName()}.pdf`
    await saveBlobWithPicker(
      fileName,
      makeLedgerPdf({
        companyName: data.settings.companyName,
        fiscalYear: data.settings.fiscalYear || '-',
        partyName: selectedLedgerParty.name,
        category: selectedLedgerParty.category,
        generatedDate: todayForFileName(),
        rows: ledgerRows.map((row) => ({
          date: row.date ? dateText(row.date) : '-',
          particulars: [row.type, row.reference].filter(Boolean).join(' - '),
          debit: row.payment ? fmt(row.payment) : '-',
          credit: row.increase ? fmt(row.increase) : '-',
          balance: fmt(row.running),
        })),
      }),
      'PDF file',
    )
  }

  const exportFilteredPurchaseSummaryCsv = async () => {
    const rows = [
      [
        'Fiscal year',
        'Custom bill date',
        'Vendor',
        'Bill number',
        'Supplier currency',
        'Supplier amount',
        'Supplier amount NPR',
        'Custom agent',
        'Pragapanpatra number',
        'Import duty NPR',
        'Import VAT NPR',
        'Terminal charge NPR',
        'Freight India NPR',
        'Total KG',
        'Loading unloading per KG',
        'Loading unloading NPR',
        'Debit note total NPR',
        'Agent service total NPR',
        'Total input VAT NPR',
        'Landed cost NPR',
        'Status',
      ],
      ...filteredPurchases.map((purchase) => [
        activeFiscalYear.code,
        importPurchaseSortDate(purchase),
        partyName(purchase.vendorPartyId),
        purchase.vendorBillNumber,
        purchase.supplierCurrency,
        String(purchase.amountIC),
        String(purchase.supplierAmountNPR),
        partyName(purchase.customAgentPartyId),
        purchase.debitNoteNumber,
        String(purchase.importDutyNPR),
        String(purchase.importVatNPR),
        String(purchase.totalTerminalChargeNPR),
        String(purchase.freightIndiaAmountNPR),
        String(purchase.totalKg ?? 0),
        String(purchase.loadingUnloadingChargePerKg ?? 0),
        String(purchase.loadingUnloadingChargeNPR ?? 0),
        String(purchase.debitNoteTotalNPR),
        String(purchase.agentServiceTotalNPR),
        String(purchase.totalInputVatNPR),
        String(purchase.landedCostNPR),
        purchase.lifecycleStatus ?? 'POSTED',
      ]),
    ]

    await saveBlobWithPicker(
      `import_purchase_summary_${activeFiscalYear.code.replace('/', '-')}_${todayForFileName()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      'CSV file',
    )
  }

  const togglePartySort = (key: PurchasePartySortKey) => {
    setPartySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const toggleImportPurchaseSort = (key: ImportPurchaseSortKey) => {
    setImportPurchaseSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const togglePaymentSort = (key: PaymentSortKey) => {
    setPaymentSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const toggleLocalExpenseSort = (key: LocalExpenseSortKey) => {
    setLocalExpenseSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const renderSortableHeader = <T extends string,>(
    sort: SortState<T>,
    key: T,
    label: string,
    onToggle: (key: T) => void,
  ) => {
    const isActive = sort.key === key
    const marker = isActive ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'

    return (
      <button type="button" className="sortable-table-header" onClick={() => onToggle(key)}>
        <span>{label}</span>
        <span aria-hidden="true">{marker}</span>
        <span className="sr-only">
          {isActive ? `Sorted ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${label}`}
        </span>
      </button>
    )
  }

  const renderDashboard = () => (
    <div className="stack">
      <Panel title="New Entry">
        {dashboardEntryMessage && <p className="status-message">{dashboardEntryMessage}</p>}
        <div className="quick-actions">
          <button type="button" onClick={openNewPurchaseEntry}>
            New import purchase
          </button>
          <button type="button" onClick={openNewPaymentEntry}>
            New payment
          </button>
          <button type="button" onClick={openNewLocalExpenseEntry}>
            New local purchase / expense
          </button>
        </div>
      </Panel>

      <div className="metric-grid">
        <Metric label="Total payable" value={npr(dashboard.totalPayable)} />
        <Metric label="Supplier payable" value={npr(dashboard.supplierPayable)} />
        <Metric label="Custom agent payable" value={npr(dashboard.agentPayable)} />
        <Metric label="Local supplier payable" value={npr(dashboard.localSupplierPayable)} />
        <Metric label="Total input VAT" value={npr(dashboard.inputVat)} />
        <Metric label="Total landed cost" value={npr(dashboard.landedCost)} />
      </div>

      <Panel title="Landed Cost by Month">
        <BarChart
          rows={monthlyLandedCost}
          emptyText="No landed cost data by agent bill date yet."
          onSelect={(row) => {
            setVatFilters({ month: row.month })
            setReportView('Input VAT')
            navigateToView('Reports')
          }}
        />
      </Panel>

      <Panel title="Purchase by Major Indian Supplier">
        <PieChart
          slices={purchaseBySupplier}
          emptyText="No Indian supplier purchase data yet."
          onSelect={(slice) => {
            if (!slice.id) return
            setLedgerPartyId(slice.id)
            setReportView('Party Ledger')
            navigateToView('Reports')
          }}
        />
      </Panel>

      <div className="two-column">
        <Panel title="Recent Purchases">
          <Table
            headers={['Agent bill date', 'Indian vendor', 'Bill number', 'INR supplier amount']}
            rows={dashboard.recentPurchases.map((purchase) => [
              dateText(purchase.agentServiceBillDate || importPurchaseSortDate(purchase)),
              partyName(purchase.vendorPartyId),
              purchase.vendorBillNumber,
              supplierMoney(purchase.amountIC, purchase.supplierCurrency),
            ])}
          />
        </Panel>
        <Panel title="Recent Payments">
          <Table
            headers={['Date', 'Party', 'Bank', 'Amount NPR']}
            rows={dashboard.recentPayments.map((payment) => [
              dateText(payment.paymentDate),
              partyName(payment.partyId),
              payment.paymentMethod,
              npr(payment.amountNPR),
            ])}
          />
        </Panel>
      </div>
    </div>
  )

  const renderPartyMaster = () => (
    <div className="stack">
      <Panel title={partyForm.id ? 'Edit Party' : 'Add Party'}>
        <form className="form-grid" onSubmit={saveParty}>
          <Field label="Name">
            <input value={partyForm.name} onChange={(event) => updatePartyField('name', event.target.value)} />
          </Field>
          <Field label="Category">
            <select
              value={partyForm.category}
              onChange={(event) => updatePartyField('category', event.target.value as PartyCategory)}
            >
              {partyCategories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </Field>
          <Field label="Address">
            <input value={partyForm.address} onChange={(event) => updatePartyField('address', event.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={partyForm.phone} onChange={(event) => updatePartyField('phone', event.target.value)} />
          </Field>
          <Field label="PAN/VAT number">
            <input value={partyForm.panVatNo} onChange={(event) => updatePartyField('panVatNo', event.target.value)} />
          </Field>
          <Field label="Country">
            <select
              value={partyForm.country}
              onChange={(event) => updatePartyField('country', event.target.value)}
            >
              {countries.map((country) => (
                <option key={country}>{country}</option>
              ))}
            </select>
          </Field>
          <NumberField
            label="Opening payable"
            value={partyForm.openingPayable}
            onChange={(value) => updatePartyField('openingPayable', value)}
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={partyForm.isActive}
              onChange={(event) => updatePartyField('isActive', event.target.checked)}
            />
            Active
          </label>
          <div className="form-actions">
            <button type="submit">{partyForm.id ? 'Update party' : 'Add party'}</button>
            <button type="button" className="ghost" onClick={() => setPartyForm(emptyParty)}>
              Clear
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Parties">
        <div className="toolbar">
          <input
            placeholder="Search parties"
            value={partySearch}
            onChange={(event) => setPartySearch(event.target.value)}
          />
          <select
            value={partyCategoryFilter}
            onChange={(event) => setPartyCategoryFilter(event.target.value as PartyCategory | 'All')}
          >
            <option>All</option>
            {partyCategories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{renderSortableHeader(partySort, 'name', 'Name', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'category', 'Category', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'country', 'Country', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'phone', 'Phone', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'panVatNo', 'PAN/VAT', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'openingPayable', 'Opening', togglePartySort)}</th>
                <th>{renderSortableHeader(partySort, 'status', 'Status', togglePartySort)}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedParties.map((party) => (
                <tr key={party.id}>
                  <td>{party.name}</td>
                  <td>{party.category}</td>
                  <td>{party.country}</td>
                  <td>{party.phone || '-'}</td>
                  <td>{party.panVatNo || '-'}</td>
                  <td>{npr(party.openingPayable)}</td>
                  <td>{party.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="row-actions">
                    {canEditOrDelete ? (
                      <>
                        <button type="button" className="small" onClick={() => editParty(party)}>
                          Edit
                        </button>
                        <button type="button" className="small danger" onClick={() => hardDeleteParty(party)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {!displayedParties.length && <EmptyRow columns={8} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const renderPurchaseEntry = () => (
    <div className="stack">
      {isClosedFiscalYear && (
        <section className="read-only-banner" role="status">
          This company fiscal year is closed. Purchase entry is available for viewing only.
        </section>
      )}
      <form onSubmit={savePurchase} className="stack">
        <ValidationSummary errors={purchaseValidationErrors} warnings={purchaseValidationWarnings} />
        <Panel title="Section A: Supplier Invoice">
          <div className="form-grid">
            <Field label="Vendor party">
              <select
                name="vendorPartyId"
                value={purchaseForm.vendorPartyId}
                onChange={(event) => updatePurchaseField('vendorPartyId', event.target.value)}
              >
                <option value="">Select vendor</option>
                {vendorOptions.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
              <InlineMessages errors={purchaseErrorMessages.vendorPartyId} />
            </Field>
            <Field label="Vendor bill number">
              <input
                name="vendorBillNumber"
                value={purchaseForm.vendorBillNumber}
                onChange={(event) => updatePurchaseField('vendorBillNumber', event.target.value)}
              />
              <InlineMessages
                errors={purchaseErrorMessages.vendorBillNumber}
                warnings={purchaseWarningMessages.vendorBillNumber}
              />
            </Field>
            <CalendarDateField
              label="Bill date (AD)"
              name="billDate"
              value={purchaseForm.billDate}
              errorMessages={purchaseErrorMessages.billDate}
              onChange={(value) => updatePurchaseField('billDate', value)}
            />
            {isUsdSupplierMode && (
              <Field label="Supplier currency">
                <select
                  value={selectedSupplierCurrency}
                  onChange={(event) => updateSupplierCurrency(event.target.value as SupplierCurrency)}
                >
                  {supplierCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <NumberField
              label={`Amount ${selectedSupplierCurrency}`}
              name="amountIC"
              value={purchaseForm.amountIC}
              errorMessages={purchaseErrorMessages.amountIC}
              onChange={(value) => updatePurchaseField('amountIC', value)}
            />
            {selectedSupplierCurrency === 'USD' ? (
              <NumberField
                label="USD exchange rate"
                name="supplierExchangeRate"
                value={purchaseForm.supplierExchangeRate}
                step="0.0001"
                errorMessages={purchaseErrorMessages.supplierExchangeRate}
                onChange={(value) => updatePurchaseField('supplierExchangeRate', value)}
              />
            ) : (
              <ReadOnly label="Fixed INR exchange rate" value={rateFmt(data.settings.defaultExchangeRate)} />
            )}
            <ReadOnly label="Amount NPR" value={npr(purchaseTotals.supplierAmountNPR)} />
            <NumberField
              label="Total KG"
              name="totalKg"
              value={purchaseForm.totalKg}
              onChange={(value) => updatePurchaseField('totalKg', value)}
            />
            <NumberField
              label="Loading & unloading charge per KG"
              name="loadingUnloadingChargePerKg"
              value={purchaseForm.loadingUnloadingChargePerKg}
              onChange={(value) => updatePurchaseField('loadingUnloadingChargePerKg', value)}
            />
            <ReadOnly label="Loading & unloading charge NPR" value={npr(purchaseTotals.loadingUnloadingChargeNPR)} />
            <Field label="Remarks">
              <input
                value={purchaseForm.remarks}
                onChange={(event) => updatePurchaseField('remarks', event.target.value)}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Section B: Pragapanpatra / Customs Charges">
          <div className="form-grid">
            <Field label="Custom agent party">
              <select
                name="customAgentPartyId"
                value={purchaseForm.customAgentPartyId}
                onChange={(event) => updatePurchaseField('customAgentPartyId', event.target.value)}
              >
                <option value="">Select custom agent</option>
                {agentOptions.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
              <InlineMessages errors={purchaseErrorMessages.customAgentPartyId} />
            </Field>
            <TextField label="Pragapanpatra number" value={purchaseForm.debitNoteNumber} onChange={(value) => updatePurchaseField('debitNoteNumber', value)} />
            <DateField label="Pragapanpatra date" value={purchaseForm.debitNoteDate} onChange={(value) => updatePurchaseField('debitNoteDate', value)} />
            <NumberField label="Import duty NPR" value={purchaseForm.importDutyNPR} onChange={(value) => updatePurchaseField('importDutyNPR', value)} />
            <NumberField label="Custom service NPR" value={purchaseForm.customServiceNPR} onChange={(value) => updatePurchaseField('customServiceNPR', value)} />
            <NumberField label="Import VAT NPR" value={purchaseForm.importVatNPR} onChange={(value) => updatePurchaseField('importVatNPR', value)} />
            <NumberField label="Terminal charge without VAT NPR" value={purchaseForm.terminalChargeWithoutVatNPR} onChange={(value) => updatePurchaseField('terminalChargeWithoutVatNPR', value)} />
            <ReadOnly label={`VAT on terminal NPR (${vatRateLabel(data.settings)}%)`} value={npr(purchaseTotals.terminalVatNPR)} />
            <ReadOnly label="Total terminal charge NPR" value={npr(purchaseTotals.totalTerminalChargeNPR)} />
            <Field label="Freight India status">
              <select
                name="freightIndiaStatus"
                value={purchaseForm.freightIndiaStatus}
                onChange={(event) => {
                  const nextStatus = event.target.value as FreightIndiaStatus
                  setPurchaseForm((current) => ({
                    ...current,
                    freightIndiaStatus: nextStatus,
                    freightIndiaPartyId: shouldCreditIndianTransport(nextStatus)
                      ? current.freightIndiaPartyId
                      : '',
                  }))
                }}
              >
                {freightIndiaStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <InlineMessages errors={purchaseErrorMessages.freightIndiaStatus} />
            </Field>
            {shouldCreditIndianTransport(purchaseForm.freightIndiaStatus) && (
              <Field label="Indian transport company">
                <select
                  name="freightIndiaPartyId"
                  value={purchaseForm.freightIndiaPartyId}
                  onChange={(event) => updatePurchaseField('freightIndiaPartyId', event.target.value)}
                >
                  <option value="">Select Indian transport company</option>
                  {transportOptions.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </select>
                <InlineMessages errors={purchaseErrorMessages.freightIndiaPartyId} />
              </Field>
            )}
            <FreightTreatmentExplanation status={purchaseForm.freightIndiaStatus} />
            <NumberField label="Freight India amount IC" value={purchaseForm.freightIndiaAmountIC} onChange={(value) => updatePurchaseField('freightIndiaAmountIC', value)} />
            <ReadOnly label="Fixed freight exchange rate" value={rateFmt(data.settings.defaultExchangeRate)} />
            <ReadOnly label="Freight India amount NPR" value={npr(purchaseTotals.freightIndiaAmountNPR)} />
            <NumberField label="Other charges NPR" value={purchaseForm.otherChargesNPR} onChange={(value) => updatePurchaseField('otherChargesNPR', value)} />
            <ReadOnly label="Debit note total NPR" value={npr(purchaseTotals.debitNoteTotalNPR)} />
          </div>
        </Panel>

        <Panel title="Section C: Agent Service Bill">
          <div className="form-grid">
            <TextField label="Agent service bill number" value={purchaseForm.agentServiceBillNumber} onChange={(value) => updatePurchaseField('agentServiceBillNumber', value)} />
            <DateField label="Agent service bill date" value={purchaseForm.agentServiceBillDate} onChange={(value) => updatePurchaseField('agentServiceBillDate', value)} />
            <NumberField label="Service amount before VAT" value={purchaseForm.agentServiceAmountBeforeVatNPR} onChange={(value) => updatePurchaseField('agentServiceAmountBeforeVatNPR', value)} />
            <ReadOnly label={`Agent service VAT (${vatRateLabel(data.settings)}%)`} value={npr(purchaseTotals.agentServiceVatNPR)} />
            <ReadOnly label="Service bill total" value={npr(purchaseTotals.agentServiceTotalNPR)} />
          </div>
        </Panel>

        <Panel title="Section D: Calculated Summary">
          <PurchaseCalculationSummary totals={purchaseTotals} formatMoney={npr} />
          <p className="autosave-status">
            {purchaseAutosave.status === 'saved' ? 'Saved' : purchaseAutosave.status === 'unsaved' ? 'Unsaved changes' : purchaseAutosave.status === 'error' ? 'Autosave failed' : 'Draft ready'}
          </p>
          <div className="form-actions">
            <button type="submit" data-primary-submit="true" disabled={isClosedFiscalYear}>
              {purchaseForm.id ? 'Update purchase' : 'Review and save purchase'}
            </button>
            <button type="button" className="ghost" onClick={() => setPurchaseForm(createEmptyPurchase(data.settings))}>
              Clear form
            </button>
          </div>
        </Panel>
      </form>

      <Panel title="Saved Purchases">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{renderSortableHeader(importPurchaseSort, 'vendor', 'Vendor', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'bill', 'Bill', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'supplierAmount', 'Supplier Amount', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'pragapanpatra', 'Pragapanpatra', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'inputVat', 'Input VAT', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'landedCost', 'Landed Cost', toggleImportPurchaseSort)}</th>
                <th>{renderSortableHeader(importPurchaseSort, 'status', 'Status', toggleImportPurchaseSort)}</th>
                {inventoryEnabled && <th>{renderSortableHeader(importPurchaseSort, 'inventory', 'Inventory', toggleImportPurchaseSort)}</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedPurchases.map((purchase) => {
                const purchaseStockKey = stockPurchaseKey(purchase.id, 'Import Purchase')
                const stockBill = stockPurchaseBillByKey.get(purchaseStockKey)
                const stockStatus = stockPurchaseStatusByKey.get(purchaseStockKey)
                const actions = availableTransactionActions({
                  status: purchase.lifecycleStatus ?? 'POSTED',
                  fiscalYearStatus: activeFiscalYear.status,
                  canEditDraft: canEditPurchase,
                  canDeleteDraft: canEditOrDelete,
                  canReversePosted: canEditOrDelete,
                })
                const canEditOpenYearPurchase =
                  canEditPurchase &&
                  activeFiscalYear.status === 'OPEN' &&
                  !['VOID', 'REVERSED'].includes(purchase.lifecycleStatus ?? 'POSTED')
                const canDeleteOpenYearPurchase =
                  canEditOrDelete &&
                  activeFiscalYear.status === 'OPEN' &&
                  !['VOID', 'REVERSED'].includes(purchase.lifecycleStatus ?? 'POSTED')
                const showEditPurchase = actions.includes('EDIT') || canEditOpenYearPurchase
                const showDeletePurchase = actions.includes('DELETE') || canDeleteOpenYearPurchase

                return (
                  <tr key={purchase.id}>
                    <td>{partyName(purchase.vendorPartyId)}</td>
                    <td>{purchase.vendorBillNumber}</td>
                    <td>{supplierMoney(purchase.amountIC, purchase.supplierCurrency)}</td>
                    <td>{purchase.debitNoteNumber || '-'}</td>
                    <td className="money-cell">{npr(purchase.totalInputVatNPR)}</td>
                    <td className="money-cell">{npr(purchase.landedCostNPR)}</td>
                    <td>
                      <TransactionStatusBadge status={purchase.lifecycleStatus} fiscalYearStatus={activeFiscalYear.status} />
                    </td>
                    {inventoryEnabled && (
                      <td>
                        <InventoryRegisterCell
                          isReadOnly={isStockEntryReadOnly(purchase.lifecycleStatus)}
                          onAdd={() => openStockEntryForPurchase(purchase)}
                          onPreview={() => setPreviewStockPurchase({ documentId: purchase.id, sourceType: 'Import Purchase' })}
                          status={stockStatus}
                          stockBill={stockBill}
                        />
                      </td>
                    )}
                    <td className="row-actions">
                      {showEditPurchase && (
                        <button type="button" className="small" onClick={() => editPurchase(purchase)}>
                          Edit
                        </button>
                      )}
                      {showDeletePurchase && (
                        <button type="button" className="small danger" onClick={() => deletePurchase(purchase)}>
                          Delete
                        </button>
                      )}
                      {!showEditPurchase && !showDeletePurchase && '-'}
                    </td>
                  </tr>
                )
              })}
              {!displayedPurchases.length && <EmptyRow columns={inventoryEnabled ? 9 : 8} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const renderPaymentEntry = () => (
    <div className="stack">
      <div className="tabs">
        <button
          type="button"
          className={paymentMode === 'Indian Supplier' ? 'active' : ''}
          onClick={() => {
            setPaymentMode('Indian Supplier')
            setPaymentForm(createEmptyPayment())
            setPaymentBillYear('Current')
            resetSupplierPaymentCurrency()
            setBankOutflowNPR(0)
          }}
        >
          Indian supplier payment
        </button>
        <button
          type="button"
          className={paymentMode === 'Other Party' ? 'active' : ''}
          onClick={() => {
            setPaymentMode('Other Party')
            setPaymentForm({ ...createEmptyPayment(), paymentType: 'Custom Agent Payment' })
            setPaymentBillYear('Current')
            resetSupplierPaymentCurrency()
            setBankOutflowNPR(0)
          }}
        >
          Custom agent / local payment
        </button>
      </div>

      <Panel title={paymentMode === 'Indian Supplier' ? 'Indian Supplier Payment' : 'Custom Agent / Local Payment'}>
        {isClosedFiscalYear && (
          <section className="read-only-banner" role="status">
            This company fiscal year is closed. Payment entry is available for viewing only.
          </section>
        )}
        <form className="stack" onSubmit={savePayment}>
          <ValidationSummary errors={paymentValidationErrors} />
          <div className="form-grid">
            <Field label="Party">
              <select
                name="partyId"
                value={paymentForm.partyId}
                onChange={(event) => {
                  updatePaymentField('partyId', event.target.value)
                  setBankOutflowNPR(0)
                }}
              >
                <option value="">Select party</option>
                {(paymentMode === 'Indian Supplier' ? indianSupplierPaymentPartyOptions : otherPaymentPartyOptions).map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name} - {party.category}
                  </option>
                ))}
              </select>
              <InlineMessages errors={paymentErrorMessages.partyId} />
            </Field>
            <DateField
              label="Payment date"
              name="paymentDate"
              value={paymentForm.paymentDate}
              errorMessages={paymentErrorMessages.paymentDate}
              onChange={(value) => updatePaymentField('paymentDate', value)}
            />
            {paymentMode === 'Indian Supplier' && (
              <>
              <Field label="Bill year">
                <select
                  value={paymentBillYear}
                  onChange={(event) => setPaymentBillYear(event.target.value as 'Current' | 'Last year')}
                >
                  <option>Current</option>
                  <option>Last year</option>
                </select>
              </Field>
              {isUsdSupplierPaymentMode && (
                <Field label="Payment currency">
                  <select
                    value={selectedSupplierPaymentCurrency}
                    onChange={(event) => {
                      const currency = event.target.value as SupplierCurrency
                      setSupplierPaymentCurrency(currency)
                      setSupplierPaymentExchangeRate(currency === 'INR' ? data.settings.defaultExchangeRate : 0)
                    }}
                  >
                    {supplierCurrencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                  ))}
                </select>
              </Field>
            )}
              <NumberField
                label={`Amount ${selectedSupplierPaymentCurrency}`}
                name="amount"
                value={paymentForm.amount}
                errorMessages={paymentErrorMessages.amount}
                onChange={(value) => updatePaymentField('amount', value)}
              />
              {selectedSupplierPaymentCurrency === 'USD' ? (
                <NumberField
                  label="USD exchange rate"
                  name="exchangeRate"
                  value={supplierPaymentExchangeRate}
                  step="0.0001"
                  errorMessages={paymentErrorMessages.exchangeRate}
                  onChange={setSupplierPaymentExchangeRate}
                />
              ) : (
                <ReadOnly label="Fixed INR exchange rate" value={rateFmt(data.settings.defaultExchangeRate)} />
              )}
              <ReadOnly label="Converted supplier debit NPR" value={npr(indianSupplierPaymentNPR)} />
              <NumberField
                label="Amount in NC with commission"
                name="bankOutflowNPR"
                value={bankOutflowNPR}
                errorMessages={paymentErrorMessages.bankOutflowNPR}
                onChange={setBankOutflowNPR}
              />
              <ReadOnly label="Commission expense" value={npr(commissionExpenseNPR)} />
              <TextField
                label="Bill number"
                name="referenceNumber"
                value={paymentForm.referenceNumber}
                errorMessages={paymentErrorMessages.referenceNumber}
                onChange={(value) => updatePaymentField('referenceNumber', value)}
              />
            </>
          )}
          {paymentMode === 'Other Party' && (
            <NumberField
              label="Amount NPR"
              name="amount"
              value={paymentForm.amount}
              errorMessages={paymentErrorMessages.amount}
              onChange={(value) => updatePaymentField('amount', value)}
            />
          )}
          <Field label="Payment method">
            <select value={paymentForm.paymentMethod} onChange={(event) => updatePaymentField('paymentMethod', event.target.value as PaymentMethod)}>
              {paymentMethods.map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </Field>
          </div>
          <div className="form-actions">
            <button type="submit" data-primary-submit="true" disabled={isClosedFiscalYear}>
              {paymentForm.id ? 'Update payment' : 'Review and save payment'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPaymentForm(createEmptyPayment())
                resetSupplierPaymentCurrency()
                setPaymentBillYear('Current')
                setBankOutflowNPR(0)
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </Panel>

      <Panel title={paymentMode === 'Indian Supplier' ? 'Saved Indian Supplier Payments' : 'Saved Custom Agent / Local Payments'}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{renderSortableHeader(paymentSort, 'date', 'Date', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'party', 'Party', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'currency', 'Currency', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'amount', 'Amount', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'amountNpr', 'Amount NPR', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'bank', 'Bank', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'reference', 'Bill / Reference', togglePaymentSort)}</th>
                <th>{renderSortableHeader(paymentSort, 'status', 'Status', togglePaymentSort)}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedPayments.map((payment) => (
                <tr key={payment.id}>
                  <td>{dateText(payment.paymentDate)}</td>
                  <td>{partyName(payment.partyId)}</td>
                  <td>{payment.currency}</td>
                  <td>{payment.currency === 'NPR' ? npr(payment.amount) : supplierMoney(payment.amount, normalizeSupplierCurrency(payment.currency))}</td>
                  <td>{npr(payment.amountNPR)}</td>
                  <td>{payment.paymentMethod}</td>
                  <td>{payment.referenceNumber || '-'}</td>
                  <td>
                    <TransactionStatusBadge status={payment.lifecycleStatus} fiscalYearStatus={activeFiscalYear.status} />
                  </td>
                  <td className="row-actions">
                    {canEditOrDelete ? (
                      <>
                        <button type="button" className="small" onClick={() => editPayment(payment)}>
                          Edit
                        </button>
                        <button type="button" className="small danger" onClick={() => deletePayment(payment)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {!displayedPayments.length && <EmptyRow columns={9} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const renderLocalExpenseEntry = () => (
    <div className="stack">
      <Panel title="Create Local Supplier">
        <form className="form-grid" onSubmit={createQuickLocalSupplier}>
          <TextField
            label="Party name"
            value={quickLocalSupplierForm.name}
            onChange={(value) => updateQuickLocalSupplierField('name', value)}
          />
          <TextField
            label="Phone number"
            value={quickLocalSupplierForm.phone}
            onChange={(value) => updateQuickLocalSupplierField('phone', value)}
          />
          <TextField
            label="PAN/VAT number"
            value={quickLocalSupplierForm.panVatNo}
            onChange={(value) => updateQuickLocalSupplierField('panVatNo', value)}
          />
          <NumberField
            label="Opening payable NPR"
            value={quickLocalSupplierForm.openingPayable}
            onChange={(value) => updateQuickLocalSupplierField('openingPayable', value)}
          />
          <div className="form-actions">
            <button type="submit">Add party</button>
          </div>
        </form>
      </Panel>

      <Panel title={localExpenseForm.id ? 'Edit Local Purchase / Expense' : 'Local Purchase / Expense Entry'}>
        <form className="form-grid" onSubmit={saveLocalExpense}>
          <Field label="Local supplier">
            <select
              value={localExpenseForm.partyId}
              onChange={(event) => updateLocalExpenseField('partyId', event.target.value)}
            >
              <option value="">Select local supplier</option>
              {localSupplierOptions.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
          </Field>
          <TextField
            label="Bill number"
            value={localExpenseForm.billNumber}
            onChange={(value) => updateLocalExpenseField('billNumber', value)}
          />
          <DateField
            label="Bill date"
            value={localExpenseForm.billDate}
            onChange={(value) => updateLocalExpenseField('billDate', value)}
          />
          <Field label="Heading">
            <select
              value={localExpenseForm.expenseType ?? 'Expense'}
              onChange={(event) =>
                updateLocalExpenseField(
                  'expenseType',
                  event.target.value as LocalPurchaseExpense['expenseType'],
                )
              }
            >
              {localExpenseTypes.map((expenseType) => (
                <option key={expenseType} value={expenseType}>
                  {expenseType}
                </option>
              ))}
            </select>
          </Field>
          {!isLocalPurchaseStock(localExpenseForm) && (
            <TextField
              label="Kind of expense / fixed asset"
              value={localExpenseForm.expenseHead}
              onChange={(value) => updateLocalExpenseField('expenseHead', value)}
            />
          )}
          <NumberField
            label="Amount before VAT NPR"
            value={localExpenseForm.amountBeforeVatNPR}
            onChange={(value) => updateLocalExpenseField('amountBeforeVatNPR', value)}
          />
          <ReadOnly label={`VAT NPR (${vatRateLabel(data.settings)}%)`} value={npr(localExpenseVatNPR)} />
          <ReadOnly label="Total amount NPR" value={npr(localExpenseTotalNPR)} />
          <TextField
            label="Remarks"
            value={localExpenseForm.remarks}
            onChange={(value) => updateLocalExpenseField('remarks', value)}
          />
          <div className="form-actions">
            <button type="submit">{localExpenseForm.id ? 'Update local entry' : 'Save local entry'}</button>
            <button type="button" className="ghost" onClick={() => setLocalExpenseForm(createEmptyLocalExpense())}>
              Clear
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Saved Local Purchase / Expense">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{renderSortableHeader(localExpenseSort, 'date', 'Date', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'supplier', 'Supplier', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'bill', 'Bill', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'heading', 'Heading', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'kind', 'Kind', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'beforeVat', 'Before VAT', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'vat', 'VAT', toggleLocalExpenseSort)}</th>
                <th>{renderSortableHeader(localExpenseSort, 'total', 'Total', toggleLocalExpenseSort)}</th>
                {inventoryEnabled && <th>{renderSortableHeader(localExpenseSort, 'inventory', 'Inventory', toggleLocalExpenseSort)}</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedLocalExpenses.map((localExpense) => {
                const localStockKey = stockPurchaseKey(localExpense.id, 'Local Purchase')
                const stockBill = stockPurchaseBillByKey.get(localStockKey)
                const stockStatus = stockPurchaseStatusByKey.get(localStockKey)
                const isStockLocalExpense = isLocalPurchaseStock(localExpense)

                return (
                  <tr key={localExpense.id}>
                    <td>{dateText(localExpense.billDate)}</td>
                    <td>{partyName(localExpense.partyId)}</td>
                    <td>{localExpense.billNumber}</td>
                    <td>{localExpense.expenseType ?? 'Expense'}</td>
                    <td>{localExpense.expenseHead || '-'}</td>
                    <td>{npr(localExpense.amountBeforeVatNPR)}</td>
                    <td>{npr(localExpense.vatNPR)}</td>
                    <td>{npr(localExpense.totalAmountNPR)}</td>
                    {inventoryEnabled && (
                      <td>
                        {isStockLocalExpense ? (
                          <InventoryRegisterCell
                            isReadOnly={isStockEntryReadOnly(localExpense.lifecycleStatus)}
                            onAdd={() => openStockEntryForLocalExpense(localExpense)}
                            onPreview={() => setPreviewStockPurchase({ documentId: localExpense.id, sourceType: 'Local Purchase' })}
                            status={stockStatus}
                            stockBill={stockBill}
                          />
                        ) : (
                          '-'
                        )}
                      </td>
                    )}
                    <td className="row-actions">
                      {canEditOrDelete ? (
                        <>
                          <button type="button" className="small" onClick={() => editLocalExpense(localExpense)}>
                            Edit
                          </button>
                          <button type="button" className="small danger" onClick={() => deleteLocalExpense(localExpense)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                )
              })}
              {!displayedLocalExpenses.length && <EmptyRow columns={inventoryEnabled ? 10 : 9} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const renderDataImportation = () => (
    <div className="stack">
      <Panel title="Party Master Import">
        <div className="form-grid">
          <ReadOnly label="Template format" value="CSV file opens in Excel" />
          <div className="form-actions">
            <button type="button" onClick={downloadPartyTemplate}>
              Download party template
            </button>
          </div>
          <Field label="Select party CSV file">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(event) => setPartyImportFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="form-actions">
            <button type="button" onClick={importParties}>
              Import party master
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Import Purchase Entry Import">
        <div className="form-grid">
          <ReadOnly label="Template format" value="CSV file opens in Excel" />
          <div className="form-actions">
            <button type="button" onClick={downloadPurchaseTemplate}>
              Download purchase template
            </button>
          </div>
          <Field label="Select import purchase CSV file">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(event) => setPurchaseImportFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="form-actions">
            <button type="button" onClick={importPurchases}>
              Import purchases
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Indian Supplier Payment Import">
        <div className="form-grid">
          <ReadOnly label="Template format" value="CSV file opens in Excel" />
          <div className="form-actions">
            <button type="button" onClick={downloadIndianSupplierPaymentTemplate}>
              Download Indian supplier payment template
            </button>
          </div>
          <Field label="Select Indian supplier payment CSV file">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(event) => setIndianSupplierPaymentImportFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="form-actions">
            <button type="button" onClick={importIndianSupplierPayments}>
              Import Indian supplier payments
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Custom Agent / Local Payment Import">
        <div className="form-grid">
          <ReadOnly label="Template format" value="CSV file opens in Excel" />
          <div className="form-actions">
            <button type="button" onClick={downloadOtherPaymentTemplate}>
              Download custom agent/local payment template
            </button>
          </div>
          <Field label="Select custom agent/local payment CSV file">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(event) => setOtherPaymentImportFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="form-actions">
            <button type="button" onClick={importOtherPayments}>
              Import custom agent/local payments
            </button>
          </div>
        </div>
      </Panel>

      {importMessage && (
        <Panel title="Import Result">
          <p>{importMessage}</p>
          {!!partyImportResults.length && (
            <Table
              headers={['Action', 'Party name', 'Category', 'Country', 'Opening payable', 'Status']}
              rows={partyImportResults.map((row) => [
                row.action,
                row.name,
                row.category,
                row.country,
                npr(row.openingPayable),
                row.status,
              ])}
            />
          )}
          {!!purchaseImportResults.length && (
            <Table
              headers={[
                'Status',
                'Line',
                'Vendor',
                'Bill',
                'Bill date',
                'Supplier NPR',
                'Custom agent',
                'Indian transport',
                'Pragapanpatra',
                'Debit note total',
                'Service total',
                'Input VAT',
                'Landed cost',
                'Remarks',
              ]}
              rows={purchaseImportResults.map((row) => [
                row.status,
                row.line.toString(),
                row.vendor,
                row.billNumber || '-',
                row.billDate || '-',
                npr(row.supplierAmountNPR),
                row.customAgent,
                row.indianTransport,
                row.pragapanpatraNumber || '-',
                npr(row.debitNoteTotalNPR),
                npr(row.agentServiceTotalNPR),
                npr(row.totalInputVatNPR),
                npr(row.landedCostNPR),
                row.remarks,
              ])}
            />
          )}
          {!!paymentImportResults.length && (
            <Table
              headers={[
                'Status',
                'Line',
                'Mode',
                'Party',
                'Payment date',
                'Payment type',
                'Currency',
                'Amount',
                'Amount NPR',
                'Bank',
                'Bill / Reference',
                'Remarks',
              ]}
              rows={paymentImportResults.map((row) => [
                row.status,
                row.line.toString(),
                row.mode,
                row.party,
                row.paymentDate || '-',
                row.paymentType,
                row.currency,
                row.currency === 'INR/IC' ? ic(row.amount) : npr(row.amount),
                npr(row.amountNPR),
                row.paymentMethod,
                row.referenceNumber || '-',
                row.remarks,
              ])}
            />
          )}
        </Panel>
      )}
    </div>
  )

  const renderReports = () => (
    <div className="stack">
      <div className="tabs">
        {reportItems.map((item) => (
          <button
            key={item}
            type="button"
            className={reportView === item ? 'active' : ''}
            onClick={() => setReportView(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {reportView === 'Import Purchase Summary' && renderPurchaseSummary()}
      {reportView === 'Payables' && renderPayables()}
      {reportView === 'Party Ledger' && renderPartyLedger()}
      {reportView === 'Input VAT' && renderInputVat()}
      {reportView === 'Landed Cost' && renderLandedCost()}
    </div>
  )

  const renderPurchaseSummary = () => (
    <Panel title="Import Purchase Summary Report">
      <div className="toolbar wrap">
        <input placeholder="From YYYY-MM-DD" value={summaryFilters.from} onChange={(event) => setSummaryFilters((current) => ({ ...current, from: event.target.value }))} />
        <input placeholder="To YYYY-MM-DD" value={summaryFilters.to} onChange={(event) => setSummaryFilters((current) => ({ ...current, to: event.target.value }))} />
        <select value={summaryFilters.vendorPartyId} onChange={(event) => setSummaryFilters((current) => ({ ...current, vendorPartyId: event.target.value }))}>
          <option value="">All vendors</option>
          {data.parties.filter(isIndianSupplierCategory).map((party) => (
            <option key={party.id} value={party.id}>{party.name}</option>
          ))}
        </select>
        <select value={summaryFilters.customAgentPartyId} onChange={(event) => setSummaryFilters((current) => ({ ...current, customAgentPartyId: event.target.value }))}>
          <option value="">All agents</option>
          {data.parties.filter(isCustomAgentCategory).map((party) => (
            <option key={party.id} value={party.id}>{party.name}</option>
          ))}
        </select>
        <input placeholder="Bill number" value={summaryFilters.billNumber} onChange={(event) => setSummaryFilters((current) => ({ ...current, billNumber: event.target.value }))} />
        <input placeholder="Pragapanpatra number" value={summaryFilters.debitNoteNumber} onChange={(event) => setSummaryFilters((current) => ({ ...current, debitNoteNumber: event.target.value }))} />
        <button type="button" className="ghost" onClick={() => setSummaryFilters({ from: '', to: '', vendorPartyId: '', customAgentPartyId: '', billNumber: '', debitNoteNumber: '' })}>
          Reset filters
        </button>
        <button type="button" onClick={exportFilteredPurchaseSummaryCsv}>
          Export filtered CSV
        </button>
      </div>
      <div className="summary-grid">
        <Metric label="Filtered rows" value={String(purchaseSummaryTotals.outstandingRows)} />
        <Metric label="Supplier NPR" value={npr(purchaseSummaryTotals.supplierAmountNPR)} />
        <Metric label="Input VAT" value={npr(purchaseSummaryTotals.inputVatNPR)} />
        <Metric label="Landed cost" value={npr(purchaseSummaryTotals.landedCostNPR)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Custom bill date</th>
              <th>Vendor</th>
              <th>Bill number</th>
              <th>Supplier amount</th>
              <th>Supplier NPR</th>
              <th>Custom agent</th>
              <th>Pragapanpatra</th>
              <th>Import duty</th>
              <th>Import VAT</th>
              <th>Terminal charge</th>
              <th>Freight NPR</th>
              <th>Loading & unloading</th>
              <th>Other</th>
              <th>Pragapanpatra total</th>
              <th>Service total</th>
              <th>Agent payable</th>
              <th>Input VAT</th>
              <th>Landed cost</th>
            </tr>
          </thead>
          <tbody>
            {filteredPurchases.map((purchase) => (
              <tr key={purchase.id}>
                <td>{dateText(importPurchaseSortDate(purchase))}</td>
                <td>{partyName(purchase.vendorPartyId)}</td>
                <td>{purchase.vendorBillNumber}</td>
                <td>{supplierMoney(purchase.amountIC, purchase.supplierCurrency)}</td>
                <td>{npr(purchase.supplierAmountNPR)}</td>
                <td>{partyName(purchase.customAgentPartyId)}</td>
                <td>{purchase.debitNoteNumber || '-'}</td>
                <td>{npr(purchase.importDutyNPR)}</td>
                <td>{npr(purchase.importVatNPR)}</td>
                <td>{npr(purchase.totalTerminalChargeNPR)}</td>
                <td>{npr(purchase.freightIndiaAmountNPR)}</td>
                <td>{npr(purchase.loadingUnloadingChargeNPR ?? 0)}</td>
                <td>{npr(purchase.otherChargesNPR)}</td>
                <td>{npr(purchase.debitNoteTotalNPR)}</td>
                <td>{npr(purchase.agentServiceTotalNPR)}</td>
                <td>{npr(purchase.totalAgentPayableNPR)}</td>
                <td>{npr(purchase.totalInputVatNPR)}</td>
                <td>{npr(purchase.landedCostNPR)}</td>
              </tr>
            ))}
            {!filteredPurchases.length && <EmptyRow columns={18} />}
          </tbody>
        </table>
      </div>
    </Panel>
  )

  const renderPayables = () => (
    <Panel title="Payables Report">
      <Table
        headers={['Party', 'Category', 'Opening payable', 'Bills / charges', 'Payments', 'Outstanding payable']}
        rows={payableRows.map((row) => {
          const billsAndCharges =
            row.purchaseOrBillTotal + row.debitNoteTotal + row.serviceBillTotal + row.freightTotal

          return [
            row.partyName,
            row.category,
            npr(row.openingPayable),
            npr(billsAndCharges),
            npr(row.payments),
            npr(row.outstanding),
          ]
        })}
      />
    </Panel>
  )

  const renderPartyLedger = () => (
    <Panel title="Party Ledger">
      <div className="toolbar">
        <select value={ledgerPartyId} onChange={(event) => setLedgerPartyId(event.target.value)}>
          <option value="">Select party</option>
          {data.parties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name} - {party.category}
            </option>
          ))}
        </select>
        <button type="button" onClick={exportPartyLedgerPdf}>
          Download PDF
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Reference</th>
              <th>Description</th>
              <th>Increase payable</th>
              <th>Payment</th>
              <th>Running balance</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((row, index) => (
              <tr key={`${row.type}-${row.reference}-${index}`}>
                <td>{row.date ? dateText(row.date) : '-'}</td>
                <td>{row.type}</td>
                <td>{row.reference || '-'}</td>
                <td>{row.description}</td>
                <td>{npr(row.increase)}</td>
                <td>{npr(row.payment)}</td>
                <td>{npr(row.running)}</td>
                <td>{row.remarks || '-'}</td>
              </tr>
            ))}
            {!ledgerRows.length && <EmptyRow columns={8} />}
          </tbody>
        </table>
      </div>
    </Panel>
  )

  const renderInputVat = () => (
    <Panel title="Input VAT Report">
      <div className="toolbar">
        <select
          value={vatFilters.month}
          onChange={(event) => setVatFilters({ month: event.target.value })}
        >
          {bsMonths.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
      <div className="summary-grid">
        <Metric label="Total input VAT" value={npr(totalVat)} />
      </div>
      <Table
        headers={['Month', 'Date', 'VAT source', 'Reference', 'Vendor / bill', 'Linked party', 'VAT amount']}
        rows={vatRows.map((row) => [
          bsMonthLabel(row.date),
          dateText(row.date),
          row.source,
          row.reference || '-',
          `${row.vendor} / ${row.vendorBillNumber}`,
          row.customAgent,
          npr(row.amount),
        ])}
      />
    </Panel>
  )

  const renderLandedCost = () => (
    <Panel title="Landed Cost Report">
      <Table
        headers={['Custom bill date', 'Vendor', 'Bill number', 'Supplier bill NPR', 'Import duty', 'Custom service', 'Terminal without VAT', 'Freight India NPR', 'Loading & unloading', 'Other charges', 'Service before VAT', 'Landed cost']}
        rows={filteredPurchases.map((purchase) => [
          dateText(importPurchaseSortDate(purchase)),
          partyName(purchase.vendorPartyId),
          purchase.vendorBillNumber,
          npr(purchase.supplierAmountNPR),
          npr(purchase.importDutyNPR),
          npr(purchase.customServiceNPR),
          npr(purchase.terminalChargeWithoutVatNPR),
          npr(purchase.freightIndiaAmountNPR),
          npr(purchase.loadingUnloadingChargeNPR ?? 0),
          npr(purchase.otherChargesNPR),
          npr(purchase.agentServiceAmountBeforeVatNPR),
          npr(purchase.landedCostNPR),
        ])}
      />
    </Panel>
  )

  const renderSettings = () => (
    <form className="stack" onSubmit={saveSettings}>
      <Panel title="Company Settings">
        <div className="form-grid">
          <TextField
            label="Company name"
            value={settingsForm.companyName}
            onChange={(value) => updateSettingsField('companyName', value)}
          />
          <TextField
            label="Fiscal year"
            value={settingsForm.fiscalYear}
            onChange={(value) => updateSettingsField('fiscalYear', value)}
          />
          <TextField
            label="PAN/VAT number"
            value={settingsForm.panVatNo}
            onChange={(value) => updateSettingsField('panVatNo', value)}
          />
          <TextField
            label="Address"
            value={settingsForm.address}
            onChange={(value) => updateSettingsField('address', value)}
          />
          <TextField
            label="Phone"
            value={settingsForm.phone}
            onChange={(value) => updateSettingsField('phone', value)}
          />
        </div>
      </Panel>

      <Panel title="Transaction Defaults">
        <div className="form-grid">
          <NumberField
            label="Fixed INR exchange rate"
            value={settingsForm.defaultExchangeRate}
            step="0.0001"
            onChange={(value) => updateSettingsField('defaultExchangeRate', value)}
          />
          <Field label="Supplier purchase currency mode">
            <select
              value={settingsForm.supplierPurchaseCurrency}
              onChange={(event) => updateSettingsField('supplierPurchaseCurrency', event.target.value as SupplierCurrency)}
            >
              <option value="INR">INR only</option>
              <option value="USD">INR and USD</option>
            </select>
          </Field>
          <ReadOnly label="VAT rate" value={`${vatRateLabel(data.settings)}%`} />
        </div>
      </Panel>
      <div className="form-actions">
        <button type="submit">Save changes</button>
        <button type="button" className="ghost" onClick={() => setSettingsForm(data.settings)}>
          Reset
        </button>
      </div>
    </form>
  )

  const renderActivityLogs = () => (
    <Panel title="Edit History">
      <Table
        headers={['Created at', 'User', 'Action', 'Details', 'Old value', 'New value']}
        rows={data.activityLogs.map((log) => [
          new Date(log.createdAt).toLocaleString(),
          log.userName || 'Unknown',
          log.action,
          log.details,
          log.oldValue || '-',
          log.newValue || '-',
        ])}
      />
    </Panel>
  )

  const renderLogin = () => (
    <main className="login-page" onKeyDown={moveEnterToNextField}>
      <section className="login-brand">
        <p className="company-name-display">{data.settings.companyName || 'Company'}</p>
        <h1>Import Purchase</h1>
        <p>Supplier bills, Pragapanpatra charges, VAT, landed cost, payables, and payments in one workspace.</p>
        <p className="login-credit">Vibecoded by Kanchan Dahal</p>
      </section>
      <section className="login-card">
        <p className="eyebrow">Secure access</p>
        <h2>Select user</h2>
        <p className="login-note">Choose your workspace role to continue.</p>

        <div className="login-actions">
          <button type="button" onClick={loginAsAccount}>
            Continue as Account
          </button>
        </div>

        <form className="login-form" onSubmit={loginAsMaster}>
          <Field label="Master password">
            <input
              type="password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
            />
          </Field>
          <button type="submit">Unlock Master</button>
          {loginError && <p className="form-error">{loginError}</p>}
        </form>
      </section>
    </main>
  )

  if (!userRole) {
    return renderLogin()
  }

  const allowedViewItems = isReadOnly
    ? userRole === 'Master'
      ? (['Dashboard', 'Reports', 'Party Master', 'Activity Logs'] as View[])
      : (['Dashboard', 'Reports', 'Party Master'] as View[])
    : userRole === 'Master'
      ? viewItems
      : accountViewItems
  const currentView = allowedViewItems.includes(view) ? view : 'Dashboard'
  const previewStockBill = previewStockPurchase
    ? stockPurchaseBillByKey.get(stockPurchaseKey(previewStockPurchase.documentId, previewStockPurchase.sourceType))
    : null
  const previewImportPurchase = previewStockPurchase?.sourceType === 'Import Purchase'
    ? data.purchases.find((purchase) => purchase.id === previewStockPurchase.documentId) ?? null
    : null
  const previewLocalExpense = previewStockPurchase?.sourceType === 'Local Purchase'
    ? data.localExpenses.find((localExpense) => localExpense.id === previewStockPurchase.documentId) ?? null
    : null
  const previewPurchaseCurrency = previewImportPurchase?.supplierCurrency ?? 'NPR'
  const previewPurchaseExchangeRate = previewImportPurchase?.supplierExchangeRate ?? 1
  const previewPurchaseBillAmount = previewImportPurchase
    ? previewImportPurchase.amountIC
    : previewLocalExpense?.amountBeforeVatNPR ?? 0
  const previewPurchaseVatAmount = previewLocalExpense?.vatNPR ?? 0
  const previewPurchaseGrandTotal = previewLocalExpense?.totalAmountNPR
  const previewCounterpartyName = previewImportPurchase
    ? partyName(previewImportPurchase.vendorPartyId)
    : previewLocalExpense
      ? partyName(previewLocalExpense.partyId)
      : previewStockBill?.supplierName ?? '-'
  const previewPurchaseDate = previewImportPurchase
    ? previewImportPurchase.debitNoteDate || previewImportPurchase.billDate || previewImportPurchase.agentServiceBillDate
    : previewLocalExpense?.billDate ?? previewStockBill?.dateBs ?? ''

  return (
    <div className="app-shell" onKeyDown={moveEnterToNextField}>
      {previewStockBill && (
        <LineItemPreviewModal
          billAmount={previewPurchaseBillAmount}
          billNumber={previewImportPurchase?.vendorBillNumber ?? previewLocalExpense?.billNumber ?? previewStockBill.billNo}
          companyName={activeCompanyProfile?.name || data.settings.companyName || 'Company'}
          counterpartyLabel="Supplier"
          counterpartyName={previewCounterpartyName}
          currency={previewPurchaseCurrency}
          date={previewPurchaseDate}
          documentKind="purchase"
          exchangeRate={previewPurchaseExchangeRate}
          fiscalYear={activeFiscalYear.code || activeCompanyProfile?.fiscalYear || ''}
          grandTotal={previewPurchaseGrandTotal}
          items={stockItems}
          lines={previewStockBill.items}
          onClose={() => setPreviewStockPurchase(null)}
          title={`${previewStockPurchase?.sourceType ?? 'Purchase'} Inventory Lines`}
          vatAmount={previewPurchaseVatAmount}
        />
      )}
      <aside className="sidebar">
        <div>
          <p className="company-name-display compact inverse">{data.settings.companyName || 'Company'}</p>
          <h1>Import Purchase</h1>
          <p className="sidebar-note">Supplier bills, Pragapanpatra charges, VAT, landed cost, payables, and payments.</p>
          <p className="sidebar-note">User: {userRole}</p>
          {isReadOnly && <p className="sidebar-note">Locked fiscal year: view only</p>}
        </div>
        <nav>
          {allowedViewItems.map((item) => (
            <button
              type="button"
              key={item}
              className={currentView === item ? 'active' : ''}
              onClick={() => navigateToView(item)}
            >
              {item}
            </button>
          ))}
          {onBackToModules && (
            <button type="button" onClick={onBackToModules}>
              Switch Module
            </button>
          )}
          <button type="button" className="logout-button" onClick={logout}>
            Logout
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="page-header">
          <div>
            <p className="company-name-display compact">
              {data.settings.companyName} {activeFiscalYear.code ? `- FY ${activeFiscalYear.code}` : ''}
            </p>
            <h2>{currentView}</h2>
          </div>
          <div className="global-search">
            <input
              data-global-search="true"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search party, bill, debit note, payment ref, PAN/VAT"
              aria-label="Global search"
            />
          </div>
          <button type="button" className="ghost" onClick={logout}>
            Logout
          </button>
          {onBackToModules && (
            <button type="button" className="ghost" onClick={onBackToModules}>
              Switch Module
            </button>
          )}
        </header>

        {!isStorageReady && (
          <section className="panel">
            <h3>Loading storage</h3>
            <p>Opening the import purchase database...</p>
          </section>
        )}

        <AppContextBar
          companyName={data.settings.companyName}
          fiscalYears={fiscalYearOptions}
          selectedFiscalYearId={activeFiscalYear.id}
          onFiscalYearChange={(id) => {
            setSelectedFiscalYearId(id)
            setPurchaseForm(createEmptyPurchase(data.settings))
            setPaymentForm(createEmptyPayment())
            setPaymentBillYear('Current')
            setLocalExpenseForm(createEmptyLocalExpense())
            scrollToPageTop()
          }}
        />
        {isClosedFiscalYear && (
          <section className="read-only-banner" role="status">
            Fiscal year {activeFiscalYear.code} is closed. Reports remain available; entries are view and print only.
          </section>
        )}

        {currentView === 'Dashboard' && renderDashboard()}
        {currentView === 'Party Master' && renderPartyMaster()}
        {currentView === 'Import Purchase Entry' && renderPurchaseEntry()}
        {currentView === 'Payment Entry' && renderPaymentEntry()}
        {currentView === 'Local Purchase / Expense' && renderLocalExpenseEntry()}
        {userRole === 'Master' && currentView === 'Data Importation' && renderDataImportation()}
        {currentView === 'Reports' && renderReports()}
        {userRole === 'Master' && currentView === 'Settings' && renderSettings()}
        {currentView === 'Activity Logs' && renderActivityLogs()}
        {globalSearch.trim() && (
          <section className="panel global-search-panel">
            <h3>Search Results</h3>
            <Table
              headers={['Type', 'Primary', 'Details', 'Amount', 'Action']}
              rows={globalSearchResults.map((result) => [
                result.type,
                result.primary,
                result.secondary,
                result.amount,
                'Open',
              ])}
            />
            <div className="global-search-actions">
              {globalSearchResults.map((result) => (
                <button key={`${result.type}-${result.id}`} type="button" className="small" onClick={() => openGlobalSearchResult(result)}>
                  Open {result.type}: {result.primary}
                </button>
              ))}
              {!globalSearchResults.length && <p className="muted">No matching records found.</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function TextField({
  errorMessages = [],
  label,
  name,
  value,
  warningMessages = [],
  onChange,
}: {
  errorMessages?: string[]
  label: string
  name?: string
  value: string
  warningMessages?: string[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input name={name} value={value} onChange={(event) => onChange(event.target.value)} />
      <InlineMessages errors={errorMessages} warnings={warningMessages} />
    </Field>
  )
}

function DateField({
  errorMessages = [],
  label,
  name,
  value,
  warningMessages = [],
  onChange,
}: {
  errorMessages?: string[]
  label: string
  name?: string
  value: string
  warningMessages?: string[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={`${label} (YYYY/MM/DD in BS)`}>
      <input
        name={name}
        type="text"
        value={value}
        placeholder="YYYY/MM/DD in BS"
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(normalizeBsDate(event.target.value))}
      />
      <InlineMessages errors={errorMessages} warnings={warningMessages} />
    </Field>
  )
}

function CalendarDateField({
  errorMessages = [],
  label,
  name,
  value,
  warningMessages = [],
  onChange,
}: {
  errorMessages?: string[]
  label: string
  name?: string
  value: string
  warningMessages?: string[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <InlineMessages errors={errorMessages} warnings={warningMessages} />
    </Field>
  )
}

function NumberField({
  errorMessages = [],
  label,
  name,
  value,
  step = '0.01',
  readOnly = false,
  warningMessages = [],
  onChange,
}: {
  errorMessages?: string[]
  label: string
  name?: string
  value: number
  step?: string
  readOnly?: boolean
  warningMessages?: string[]
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        min="0"
        step={step}
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        readOnly={readOnly}
        onChange={(event) => onChange(Math.max(0, n(event.target.value)))}
        onWheel={(event) => event.currentTarget.blur()}
      />
      <InlineMessages errors={errorMessages} warnings={warningMessages} />
    </Field>
  )
}

function InlineMessages({
  errors = [],
  warnings = [],
}: {
  errors?: string[]
  warnings?: string[]
}) {
  if (!errors.length && !warnings.length) {
    return null
  }

  return (
    <span className="field-messages">
      {errors.map((message) => (
        <em key={message} className="field-error">
          {message}
        </em>
      ))}
      {warnings.map((message) => (
        <em key={message} className="field-warning">
          {message}
        </em>
      ))}
    </span>
  )
}

function InventoryRegisterCell({
  isReadOnly,
  onAdd,
  onPreview,
  status,
  stockBill,
}: {
  isReadOnly: boolean
  onAdd: () => void
  onPreview: () => void
  status?: StockDocumentStatus
  stockBill?: StockPurchaseBill
}) {
  if (status?.status === 'Mismatch') {
    return (
      <div className="inventory-register-cell">
        <span className="inventory-mismatch" title={status.statusReason || 'Inventory lines need review.'}>
          Mismatch
        </span>
        {!isReadOnly && (
          <button type="button" className="small danger" onClick={onAdd}>
            Fix
          </button>
        )}
      </div>
    )
  }

  if (stockBill) {
    return (
      <div className="inventory-register-cell">
        <button type="button" className="small" onClick={onPreview}>
          Preview
        </button>
      </div>
    )
  }

  return (
    <div className="inventory-register-cell">
      <span>Pending</span>
      {isReadOnly ? (
        <span className="muted">No inventory</span>
      ) : (
        <button type="button" className="small danger" onClick={onAdd}>
          Add
        </button>
      )}
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <label className="field readonly">
      <span>{label}</span>
      <strong>{value}</strong>
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function BarChart({
  emptyText,
  onSelect,
  rows,
}: {
  emptyText: string
  onSelect?: (row: { label: string; amount: number; month: string }) => void
  rows: { label: string; amount: number; month: string }[]
}) {
  const maxAmount = Math.max(...rows.map((row) => row.amount), 0)

  if (!rows.length || maxAmount <= 0) {
    return <p className="muted">{emptyText}</p>
  }

  return (
    <div
      className="vertical-bar-chart"
      style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="vertical-bar-item"
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={() => onSelect?.(row)}
          onKeyDown={(event) => {
            if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            onSelect(row)
          }}
        >
          <div className="vertical-bar-value">{npr(row.amount)}</div>
          <div className="vertical-bar-track">
            <div className="vertical-bar-fill" style={{ height: `${Math.max(4, (row.amount / maxAmount) * 100)}%` }} />
          </div>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  )
}

function PieChart({
  emptyText,
  onSelect,
  slices,
}: {
  emptyText: string
  onSelect?: (slice: { id?: string; name: string; amount: number; color: string }) => void
  slices: { id?: string; name: string; amount: number; color: string }[]
}) {
  const [activeSliceName, setActiveSliceName] = useState(slices[0]?.name ?? '')
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0)

  if (!slices.length || total <= 0) {
    return <p className="muted">{emptyText}</p>
  }

  const activeSlice =
    slices.find((slice) => slice.name === activeSliceName) ?? slices[0]
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="pie-layout">
      <svg
        className="pie-chart"
        viewBox="0 0 100 100"
        role="img"
        aria-label="Purchase by major Indian supplier"
        onMouseLeave={() => setActiveSliceName(slices[0]?.name ?? '')}
      >
        <circle className="pie-chart-base" cx="50" cy="50" r={radius} />
        {slices.map((slice) => {
          const length = (slice.amount / total) * circumference
          const dashOffset = -offset
          offset += length

          return (
            <circle
              key={slice.name}
              className={slice.name === activeSlice.name ? 'pie-chart-segment active' : 'pie-chart-segment'}
              cx="50"
              cy="50"
              r={radius}
              stroke={slice.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
              onMouseEnter={() => setActiveSliceName(slice.name)}
              onClick={() => onSelect?.(slice)}
            />
          )
        })}
        <text x="50" y="48" textAnchor="middle" className="pie-total-label">
          Total
        </text>
        <text x="50" y="60" textAnchor="middle" className="pie-total-value">
          {formatCompact(total)}
        </text>
      </svg>
      <div className="pie-legend">
        {slices.map((slice) => (
          <button
            key={slice.name}
            type="button"
            className={slice.name === activeSlice.name ? 'pie-legend-row active' : 'pie-legend-row'}
            onMouseEnter={() => setActiveSliceName(slice.name)}
            onFocus={() => setActiveSliceName(slice.name)}
            onClick={() => onSelect?.(slice)}
          >
            <span style={{ background: slice.color }} />
            <strong>{slice.name}</strong>
            <em>{npr(slice.amount)}</em>
          </button>
        ))}
        <div className="pie-detail">
          <strong>{activeSlice.name}</strong>
          <span>{npr(activeSlice.amount)}</span>
          <em>{((activeSlice.amount / total) * 100).toFixed(1)}% of total</em>
        </div>
      </div>
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table>
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
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell || '-'}</td>
              ))}
            </tr>
          ))}
          {!rows.length && <EmptyRow columns={headers.length} />}
        </tbody>
      </table>
    </div>
  )
}

function EmptyRow({ columns }: { columns: number }) {
  return (
    <tr>
      <td colSpan={columns} className="empty">
        No records yet.
      </td>
    </tr>
  )
}

function makeMonthlyRows(items: { date: string; amount: number }[]) {
  const buckets = new Map<string, { label: string; amount: number; month: string }>()

  items.forEach((item) => {
    const month = monthBucket(item.date)

    if (!month) {
      return
    }

    const existing = buckets.get(month.key)
    buckets.set(month.key, {
      label: month.label,
      amount: (existing?.amount ?? 0) + item.amount,
      month: month.month,
    })
  })

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([, row]) => row)
}

function monthBucket(value: string) {
  const match = String(value ?? '').trim().match(/^(\d{4})[/-](\d{1,2})/)

  if (!match) {
    return null
  }

  const year = match[1]
  const month = Number(match[2])

  if (month < 1 || month > 12) {
    return null
  }

  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: `${bsMonthName(month)} ${year}`,
    month: String(month).padStart(2, '0'),
  }
}

function bsMonthName(month: number) {
  const names = [
    'Baisakh',
    'Jestha',
    'Ashadh',
    'Shrawan',
    'Bhadra',
    'Ashwin',
    'Kartik',
    'Mangsir',
    'Poush',
    'Magh',
    'Falgun',
    'Chaitra',
  ]

  return names[month - 1] ?? ''
}

function makePartySlices(items: { id?: string; name: string; amount: number }[]) {
  const colors = ['#245477', '#16a34a', '#f97316', '#7c3aed', '#0891b2', '#64748b']
  const buckets = new Map<string, { id?: string; amount: number }>()

  items.forEach((item) => {
    if (item.amount <= 0) {
      return
    }

    const existing = buckets.get(item.name)
    buckets.set(item.name, {
      id: existing?.id ?? item.id,
      amount: (existing?.amount ?? 0) + item.amount,
    })
  })

  const sorted = Array.from(buckets.entries()).sort((left, right) => right[1].amount - left[1].amount)
  const top = sorted.slice(0, 5)
  const otherAmount = sorted.slice(5).reduce((sum, [, row]) => sum + row.amount, 0)
  const rows = otherAmount > 0
    ? [...top, ['Other', { amount: otherAmount }] as [string, { id?: string; amount: number }]]
    : top

  return rows.map(([name, row], index) => ({
    id: row.id,
    name,
    amount: row.amount,
    color: colors[index % colors.length],
  }))
}

export default App

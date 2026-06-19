import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import './App.css'
import {
  calculatePurchaseTotals,
  hasAgentValues,
  isAgentPayment,
  isSupplierPayment,
} from './calculations'
import {
  countries,
  defaultSettings,
  freightIndiaStatuses,
  localExpenseTypes,
  normalizeFreightIndiaStatus,
  normalizePartyCategory,
  partyCategories,
  paymentMethods,
  type AppData,
  type AppSettings,
  type FreightIndiaStatus,
  type ImportPurchase,
  type LocalPurchaseExpense,
  type Party,
  type PartyCategory,
  type Payment,
  type PaymentMethod,
} from './domain'
import {
  createDataRepository,
  getEmptyData,
  type DataRepository,
} from './repository'
import {
  createActivity,
  withNewLocalExpense,
  withNewParty,
  withNewPayment,
  withNewPurchase,
  withUpdatedLocalExpense,
  withUpdatedParty,
  withUpdatedPayment,
  withUpdatedPurchase,
} from './storage'

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
  vendorPartyId: '',
  vendorBillNumber: '',
  billDate: '',
  amountIC: 0,
  supplierExchangeRate: settings.defaultExchangeRate,
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
  freightIndiaAmountIC: 0,
  freightIndiaExchangeRate: settings.defaultExchangeRate,
  freightIndiaAmountNPR: 0,
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
  remarks: '',
  createdAt: '',
  updatedAt: '',
})

const createEmptyPayment = (): Payment => ({
  id: '',
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
  createdAt: '',
  updatedAt: '',
})

const createEmptyLocalExpense = (): LocalPurchaseExpense => ({
  id: '',
  partyId: '',
  billNumber: '',
  billDate: '',
  expenseType: 'Expense',
  expenseHead: '',
  amountBeforeVatNPR: 0,
  vatNPR: 0,
  totalAmountNPR: 0,
  remarks: '',
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
  status === 'To be paid by us'

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
  onBackToModules?: () => void;
  onLogout?: () => void;
};

function App({
  initialUserRole,
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
  const [partyForm, setPartyForm] = useState<PartyForm>(emptyParty)
  const [partySearch, setPartySearch] = useState('')
  const [partyCategoryFilter, setPartyCategoryFilter] = useState<'All' | PartyCategory>('All')
  const [purchaseForm, setPurchaseForm] = useState<ImportPurchase>(() => createEmptyPurchase())
  const [paymentForm, setPaymentForm] = useState<Payment>(() => createEmptyPayment())
  const [paymentMode, setPaymentMode] = useState<'Indian Supplier' | 'Other Party'>('Indian Supplier')
  const [paymentBillYear, setPaymentBillYear] = useState<'Current' | 'Last year'>('Current')
  const [selectedSupplierBillIds, setSelectedSupplierBillIds] = useState<string[]>([])
  const [reconciliationPaymentId, setReconciliationPaymentId] = useState('')
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

  useEffect(() => {
    if (initialUserRole) {
      setUserRole(initialUserRole)
    }
  }, [initialUserRole])

  useEffect(() => {
    let cancelled = false

    createDataRepository()
      .then(async (nextRepository) => {
        const loadedData = await nextRepository.loadData()

        if (!cancelled) {
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

    repository.saveData(data).catch((error) => {
      console.error('Could not save app data.', error)
      window.alert(`Could not save data: ${errorMessage(error)}`)
    })
  }, [data, isStorageReady, repository])

  const activeParties = data.parties.filter((party) => party.isActive)
  const indianSuppliers = activeParties.filter(isIndianSupplierCategory)
  const customAgents = activeParties.filter(isCustomAgentCategory)
  const indianTransportParties = activeParties.filter(isIndianTransportCategory)
  const indianSupplierPaymentParties = [...indianSuppliers, ...indianTransportParties]
  const localSuppliers = activeParties.filter((party) => party.category === 'Local Suppliers')
  const otherPaymentParties = activeParties.filter((party) => !isIndianSupplierCategory(party))
  const canEditOrDelete = userRole === 'Master'
  const effectivePurchaseForm = {
    ...purchaseForm,
    supplierExchangeRate: data.settings.defaultExchangeRate,
    freightIndiaExchangeRate: data.settings.defaultExchangeRate,
  }
  const configuredVatRate = vatRateDecimal(data.settings)
  const purchaseTotals = calculatePurchaseTotals(
    effectivePurchaseForm,
    data.settings.agentServiceVatRate,
  )
  const currentYearSupplierPayments = data.payments.filter(
    (payment) => isSupplierPayment(payment) && payment.remarks.includes('Bill year: Current'),
  )
  const selectedReconciliationPayment = data.payments.find(
    (payment) => payment.id === reconciliationPaymentId,
  )
  const paidSupplierBillNumbers = new Set(
    data.payments
      .filter(
        (payment) =>
          isSupplierPayment(payment) &&
          payment.id !== reconciliationPaymentId,
      )
      .flatMap((payment) =>
        payment.referenceNumber
          .split(',')
          .map((billNumber) => billNumber.trim())
          .filter(Boolean),
      ),
  )
  const supplierBillOptions = selectedReconciliationPayment
    ? data.purchases.filter(
        (purchase) =>
          purchase.vendorPartyId === selectedReconciliationPayment.partyId &&
          (!paidSupplierBillNumbers.has(purchase.vendorBillNumber) ||
            selectedSupplierBillIds.includes(purchase.id)),
      )
    : []
  const selectedSupplierBills = supplierBillOptions.filter((purchase) =>
    selectedSupplierBillIds.includes(purchase.id),
  )
  const selectedSupplierBillAmountIC = selectedSupplierBills.reduce(
    (sum, purchase) => sum + purchase.amountIC,
    0,
  )
  const selectedSupplierBillAmountNPR = selectedSupplierBills.reduce(
    (sum, purchase) => sum + purchase.supplierAmountNPR,
    0,
  )
  const indianSupplierPaymentNPR = paymentForm.amount * data.settings.defaultExchangeRate
  const commissionExpenseNPR = Math.max(0, bankOutflowNPR - indianSupplierPaymentNPR)
  const reconciliationDifferenceNPR =
    (selectedReconciliationPayment?.amountNPR ?? 0) - selectedSupplierBillAmountNPR
  const localExpenseVatNPR = n(localExpenseForm.amountBeforeVatNPR * configuredVatRate)
  const localExpenseTotalNPR = localExpenseForm.amountBeforeVatNPR + localExpenseVatNPR

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
  const sortedPurchases = useMemo(
    () => [...data.purchases].sort(latestImportPurchaseFirst),
    [data.purchases],
  )
  const sortedPayments = useMemo(
    () => [...data.payments].sort((left, right) => latestDateFirst(left.paymentDate, right.paymentDate)),
    [data.payments],
  )
  const filteredPayments = useMemo(
    () =>
      sortedPayments.filter((payment) =>
        paymentMode === 'Indian Supplier' ? isSupplierPayment(payment) : !isSupplierPayment(payment),
      ),
    [paymentMode, sortedPayments],
  )
  const sortedLocalExpenses = useMemo(
    () => [...data.localExpenses].sort((left, right) => latestDateFirst(left.billDate, right.billDate)),
    [data.localExpenses],
  )
  const vendorOptions = includeSelectedParty(indianSuppliers, purchaseForm.vendorPartyId, partyById)
  const agentOptions = includeSelectedParty(customAgents, purchaseForm.customAgentPartyId, partyById)
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

    data.purchases.forEach((purchase) => {
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

    data.payments.forEach((payment) => {
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
  }, [data.parties, data.payments, data.purchases, globalSearch, partyName])

  const setDataWithLog = (
    next: AppData,
    action: string,
    details: string,
    oldValue = '',
    newValue = '',
  ) => {
    setData({
      ...next,
      activityLogs: [createActivity(action, details, userRole ?? 'Unknown', oldValue, newValue), ...next.activityLogs],
    })
  }

  const loginAsAccount = () => {
    setUserRole('Account')
    setLoginError('')
    setView('Dashboard')
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
    setView('Dashboard')
  }

  const logout = () => {
    if (onLogout) {
      onLogout()
      return
    }

    setUserRole(null)
    setMasterPassword('')
    setLoginError('')
    setView('Dashboard')
  }

  const openNewPurchaseEntry = () => {
    setPurchaseForm(createEmptyPurchase(data.settings))
    setView('Import Purchase Entry')
  }

  const openNewPaymentEntry = () => {
    setPaymentForm(createEmptyPayment())
    setPaymentMode('Indian Supplier')
    setPaymentBillYear('Current')
    setSelectedSupplierBillIds([])
    setBankOutflowNPR(0)
    setView('Payment Entry')
  }

  const openNewLocalExpenseEntry = () => {
    setLocalExpenseForm(createEmptyLocalExpense())
    setView('Local Purchase / Expense')
  }

  const dashboard = useMemo(() => {
    const supplierOpening = data.parties
      .filter(isIndianSupplierCategory)
      .reduce((sum, party) => sum + party.openingPayable, 0)
    const agentOpening = data.parties
      .filter(isCustomAgentCategory)
      .reduce((sum, party) => sum + party.openingPayable, 0)
    const supplierBills = data.purchases.reduce(
      (sum, purchase) => sum + purchase.supplierAmountNPR,
      0,
    )
    const agentBills = data.purchases.reduce(
      (sum, purchase) => sum + purchase.totalAgentPayableNPR,
      0,
    )
    const supplierPayments = data.payments
      .filter(isSupplierPayment)
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const agentPayments = data.payments
      .filter(isAgentPayment)
      .reduce((sum, payment) => sum + payment.amountNPR, 0)
    const transportParties = data.parties.filter(isIndianTransportCategory)
    const transportPartyIds = new Set(transportParties.map((party) => party.id))
    const transportOpening = transportParties.reduce(
      (sum, party) => sum + party.openingPayable,
      0,
    )
    const transportCredits = data.purchases
      .filter((purchase) => shouldCreditIndianTransport(purchase.freightIndiaStatus))
      .reduce((sum, purchase) => sum + purchase.freightIndiaAmountNPR, 0)
    const transportPayments = data.payments
      .filter(
        (payment) =>
          payment.paymentType === 'Freight Payment' || transportPartyIds.has(payment.partyId),
      )
      .reduce((sum, payment) => sum + payment.amountNPR, 0)

    return {
      supplierPayable: supplierOpening + supplierBills - supplierPayments,
      agentPayable: agentOpening + agentBills - agentPayments,
      transportPayable: transportOpening + transportCredits - transportPayments,
      inputVat: data.purchases.reduce((sum, purchase) => sum + purchase.totalInputVatNPR, 0),
      landedCost: data.purchases.reduce((sum, purchase) => sum + purchase.landedCostNPR, 0),
      recentPurchases: sortedPurchases.slice(0, 5),
      recentPayments: sortedPayments.slice(0, 5),
    }
  }, [data, sortedPayments, sortedPurchases])

  const monthlyLandedCost = useMemo(
    () =>
      makeMonthlyRows(
        data.purchases.map((purchase) => ({
          date: purchase.agentServiceBillDate,
          amount: purchase.landedCostNPR,
        })),
      ),
    [data.purchases],
  )
  const purchaseBySupplier = useMemo(
    () =>
      makePartySlices(
        data.purchases.map((purchase) => ({
          name: partyName(purchase.vendorPartyId),
          amount: purchase.supplierAmountNPR,
        })),
      ),
    [data.purchases, partyName],
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

  const supplierPayables = useMemo(() => {
    return data.parties
      .filter(isIndianSupplierCategory)
      .map((party) => {
        const totalBills = data.purchases
          .filter((purchase) => purchase.vendorPartyId === party.id)
          .reduce((sum, purchase) => sum + purchase.supplierAmountNPR, 0)
        const totalPayments = data.payments
          .filter((payment) => payment.partyId === party.id && isSupplierPayment(payment))
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          party,
          totalBills,
          totalPayments,
          outstanding: party.openingPayable + totalBills - totalPayments,
        }
      })
  }, [data.parties, data.payments, data.purchases])

  const agentPayables = useMemo(() => {
    return data.parties
      .filter(isCustomAgentCategory)
      .map((party) => {
        const agentPurchases = data.purchases.filter(
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
        const totalPayments = data.payments
          .filter((payment) => payment.partyId === party.id && isAgentPayment(payment))
          .reduce((sum, payment) => sum + payment.amountNPR, 0)

        return {
          party,
          totalDebitNotes,
          totalServiceBills,
          totalPayments,
          outstanding:
            party.openingPayable + totalDebitNotes + totalServiceBills - totalPayments,
        }
      })
  }, [data.parties, data.payments, data.purchases])

  const indianTransportReport = useMemo(() => {
    const transportParties = data.parties.filter(isIndianTransportCategory)
    const openingPayable = transportParties.reduce(
      (sum, party) => sum + party.openingPayable,
      0,
    )
    const transportPartyIds = new Set(transportParties.map((party) => party.id))
    const creditedPurchases = data.purchases.filter(
      (purchase) =>
        shouldCreditIndianTransport(purchase.freightIndiaStatus) &&
        purchase.freightIndiaAmountNPR > 0,
    )
    const freightCredits = creditedPurchases.reduce(
      (sum, purchase) => sum + purchase.freightIndiaAmountNPR,
      0,
    )
    const transportPayments = data.payments.filter(
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
  }, [data.parties, data.payments, data.purchases, partyName])

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
        const totalBills = data.localExpenses
          .filter((localExpense) => localExpense.partyId === party.id)
          .reduce((sum, localExpense) => sum + localExpense.totalAmountNPR, 0)
        const totalPayments = data.payments
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

    const transportRow = {
      partyName: 'Indian Transport',
      category: 'Indian Transport',
      openingPayable: indianTransportReport.openingPayable,
      purchaseOrBillTotal: 0,
      debitNoteTotal: 0,
      serviceBillTotal: 0,
      freightTotal: indianTransportReport.freightCredits,
      payments: indianTransportReport.totalPayments,
      outstanding: indianTransportReport.outstanding,
    }

    return [...supplierRows, ...agentRows, transportRow, ...localSupplierRows].filter(
      (row) =>
        row.openingPayable ||
        row.purchaseOrBillTotal ||
        row.debitNoteTotal ||
        row.serviceBillTotal ||
        row.freightTotal ||
        row.payments ||
        row.outstanding,
    )
  }, [agentPayables, data.localExpenses, data.parties, data.payments, indianTransportReport, supplierPayables])

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
      data.purchases
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
      data.purchases
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
      data.localExpenses
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

    data.payments
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
  }, [data.localExpenses, data.payments, data.purchases, localExpenseDescription, selectedLedgerParty, partyName])

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
  }, [partyName, sortedLocalExpenses, sortedPurchases, vatFilters.month])

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

  const updatePartyField = <K extends keyof PartyForm>(key: K, value: PartyForm[K]) => {
    setPartyForm((current) => ({ ...current, [key]: value }))
  }

  const updatePurchaseField = <K extends keyof ImportPurchase>(
    key: K,
    value: ImportPurchase[K],
  ) => {
    setPurchaseForm((current) => ({ ...current, [key]: value }))
  }

  const updatePaymentField = <K extends keyof Payment>(key: K, value: Payment[K]) => {
    setPaymentForm((current) => ({ ...current, [key]: value }))
  }

  const updateLocalExpenseField = <K extends keyof LocalPurchaseExpense>(
    key: K,
    value: LocalPurchaseExpense[K],
  ) => {
    setLocalExpenseForm((current) => ({ ...current, [key]: value }))
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

  const saveSettings = (event: FormEvent) => {
    event.preventDefault()

    const savedSettings = {
      ...settingsForm,
      agentServiceVatRate: n(settingsForm.agentServiceVatRate),
    }

    setDataWithLog(
      { ...data, settings: savedSettings },
      'Updated settings',
      `${savedSettings.companyName} - FY ${savedSettings.fiscalYear}`,
    )
    setSettingsForm(savedSettings)

    setPurchaseForm((current) => ({
      ...current,
      supplierExchangeRate: savedSettings.defaultExchangeRate,
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
      ['Dhaulagiri Local Supplier', 'Nepal', '', '', 'Nepal', 'Local Suppliers', '0', 'yes'],
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
        'amountIC',
        'customAgentName',
        'pragapanpatraNumber',
        'pragapanpatraDateBS',
        'importDutyNPR',
        'customServiceNPR',
        'importVatNPR',
        'terminalChargeWithoutVatNPR',
        'freightIndiaStatus',
        'freightIndiaAmountIC',
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
        '412700',
        'Sunrise Custom Agent',
        'PP-001',
        '2082/01/02',
        '83898',
        '565',
        '119974',
        '3424',
        'Paid by custom agent',
        '102900',
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
        'Dhaulagiri Local Supplier',
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
          pragapanpatraNumber,
          debitNoteTotalNPR: 0,
          agentServiceTotalNPR: 0,
          totalInputVatNPR: 0,
          landedCostNPR: 0,
          remarks: reason,
        })
        return
      }

      const draft = createEmptyPurchase(data.settings)
      const purchase = {
        ...draft,
        vendorPartyId: vendor.id,
        vendorBillNumber,
        billDate,
        amountIC: n(getCsvValue(row, 'amountIC')),
        supplierExchangeRate: data.settings.defaultExchangeRate,
        customAgentPartyId: customAgent?.id ?? '',
        debitNoteNumber: pragapanpatraNumber,
        debitNoteDate: pragapanpatraDate,
        importDutyNPR: n(getCsvValue(row, 'importDutyNPR')),
        customServiceNPR: n(getCsvValue(row, 'customServiceNPR')),
        importVatNPR: n(getCsvValue(row, 'importVatNPR')),
        terminalChargeWithoutVatNPR: n(getCsvValue(row, 'terminalChargeWithoutVatNPR')),
        freightIndiaStatus,
        freightIndiaAmountIC: n(getCsvValue(row, 'freightIndiaAmountIC')),
        freightIndiaExchangeRate: data.settings.defaultExchangeRate,
        otherChargesNPR: n(getCsvValue(row, 'otherChargesNPR')),
        agentServiceBillNumber: getCsvValue(row, 'agentServiceBillNumber'),
        agentServiceBillDate,
        agentServiceAmountBeforeVatNPR: n(getCsvValue(row, 'agentServiceAmountBeforeVatNPR')),
        remarks: getCsvValue(row, 'remarks'),
      }
      const totals = calculatePurchaseTotals(purchase, data.settings.agentServiceVatRate)

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
          pragapanpatraNumber: purchase.debitNoteNumber,
          debitNoteTotalNPR: totals.debitNoteTotalNPR,
          agentServiceTotalNPR: totals.agentServiceTotalNPR,
          totalInputVatNPR: totals.totalInputVatNPR,
          landedCostNPR: totals.landedCostNPR,
          remarks: reason,
        })
        return
      }

      importedPurchases.push(withNewPurchase({ ...purchase, ...totals }))
      importedDetails.push({
        status: 'Imported',
        line,
        vendor: vendor.name,
        billNumber: purchase.vendorBillNumber,
        billDate: purchase.billDate,
        supplierAmountNPR: totals.supplierAmountNPR,
        customAgent: customAgent?.name ?? '-',
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
      const billYearValue = getCsvValue(row, 'billYear', 'year')
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
        skip('Bill year is required and must be Current or Last year.')
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

      if (amount <= 0) {
        skip('Amount NPR is required.')
        return
      }

      if (!paymentMethodValue) {
        skip('Payment method is required and must match an available bank.')
        return
      }

      const created = withNewPayment({
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
    setView('Party Master')
  }

  const hardDeleteParty = (party: Party) => {
    const linkedPurchases = data.purchases.filter(
      (purchase) =>
        purchase.vendorPartyId === party.id || purchase.customAgentPartyId === party.id,
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
          purchase.vendorPartyId !== party.id && purchase.customAgentPartyId !== party.id,
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
    if (purchaseForm.vendorPartyId === party.id || purchaseForm.customAgentPartyId === party.id) {
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

  const savePurchase = (event: FormEvent) => {
    event.preventDefault()

    if (!purchaseForm.vendorPartyId || !purchaseForm.vendorBillNumber.trim() || !purchaseForm.billDate) {
      window.alert('Vendor, bill number, and bill date are required.')
      return
    }

    if (hasAgentValues(purchaseForm) && !purchaseForm.customAgentPartyId) {
      window.alert('Custom agent is required when Pragapanpatra or service bill values are entered.')
      return
    }

    if (!purchaseForm.freightIndiaStatus) {
      window.alert('Freight India status is required.')
      return
    }

    if (purchaseForm.id && !canEditOrDelete) {
      window.alert('Account user cannot edit existing purchases.')
      return
    }

    const fixedRatePurchase = {
      ...purchaseForm,
      debitNoteDate: normalizeBsDate(purchaseForm.debitNoteDate),
      agentServiceBillDate: normalizeBsDate(purchaseForm.agentServiceBillDate),
      supplierExchangeRate: data.settings.defaultExchangeRate,
      freightIndiaExchangeRate: data.settings.defaultExchangeRate,
    }
    const totalsForSave = calculatePurchaseTotals(fixedRatePurchase, data.settings.agentServiceVatRate)
    const purchaseToSave = {
      ...fixedRatePurchase,
      ...totalsForSave,
      agentServiceVatNPR: totalsForSave.agentServiceVatNPR,
    }
    const purchaseReview = [
      purchaseForm.id ? 'Review purchase update before save:' : 'Review purchase before save:',
      `Vendor: ${partyName(purchaseToSave.vendorPartyId)}`,
      `Bill number: ${purchaseToSave.vendorBillNumber}`,
      `Supplier payable: ${npr(purchaseToSave.supplierAmountNPR)}`,
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
      const next = {
        ...data,
        purchases: data.purchases.map((purchase) =>
          purchase.id === updated.id ? updated : purchase,
        ),
      }
      setDataWithLog(next, 'Updated import purchase', updated.vendorBillNumber, auditValue(previous), auditValue(updated))
    } else {
      const created = withNewPurchase({
        ...purchaseToSave,
      })
      setDataWithLog(
        { ...data, purchases: [created, ...data.purchases] },
        'Created import purchase',
        `${partyName(created.vendorPartyId)} - ${created.vendorBillNumber}`,
      )
    }

    setPurchaseForm(createEmptyPurchase(data.settings))
  }

  const editPurchase = (purchase: ImportPurchase) => {
    setPurchaseForm(purchase)
    setView('Import Purchase Entry')
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  const deletePurchase = (purchase: ImportPurchase) => {
    if (!window.confirm(`Delete purchase bill ${purchase.vendorBillNumber}?`)) {
      return
    }

    const next = {
      ...data,
      purchases: data.purchases.filter((item) => item.id !== purchase.id),
    }
    setDataWithLog(next, 'Deleted import purchase', purchase.vendorBillNumber, auditValue(purchase), 'Deleted')
  }

  const otherPaymentTypeForParty = (party: Party | undefined): Payment['paymentType'] => {
    return paymentTypeForNonSupplierParty(party)
  }

  const savePayment = (event: FormEvent) => {
    event.preventDefault()

    if (!paymentForm.partyId || !paymentForm.paymentDate) {
      window.alert('Party and payment date are required.')
      return
    }

    const selectedParty = partyById.get(paymentForm.partyId)
    const isIndianTransportPayment = selectedParty ? isIndianTransportCategory(selectedParty) : false
    const paymentToSave =
      paymentMode === 'Indian Supplier'
        ? {
          ...paymentForm,
          paymentDate: normalizeBsDate(paymentForm.paymentDate),
          paymentType: 'Indian Supplier Payment' as const,
            currency: 'INR/IC' as const,
            amount: paymentForm.amount,
            exchangeRate: data.settings.defaultExchangeRate,
            amountNPR: indianSupplierPaymentNPR,
            remarks: [
              `Bill year: ${paymentBillYear}`,
              bankOutflowNPR > 0 ? `Bank outflow NPR: ${fmt(bankOutflowNPR)}` : '',
              bankOutflowNPR > 0 ? `Commission expense NPR: ${fmt(commissionExpenseNPR)}` : '',
            ].filter(Boolean).join('; '),
          }
        : {
            ...paymentForm,
            paymentDate: normalizeBsDate(paymentForm.paymentDate),
            paymentType: otherPaymentTypeForParty(selectedParty),
            currency: 'NPR' as const,
            amount: paymentForm.amount,
            exchangeRate: 1,
            amountNPR: paymentForm.amount,
            referenceNumber: '',
            remarks: '',
          }

    if (paymentMode === 'Indian Supplier' && paymentForm.amount <= 0) {
      window.alert('Amount in IC/LC is required.')
      return
    }

    if (paymentMode === 'Indian Supplier' && !paymentForm.referenceNumber.trim()) {
      window.alert('Bill number is required.')
      return
    }

    if (paymentMode === 'Indian Supplier' && !isIndianTransportPayment && bankOutflowNPR < indianSupplierPaymentNPR) {
      window.alert('Amount in NC with commission cannot be less than converted supplier payment NPR.')
      return
    }

    if (paymentMode === 'Other Party' && paymentForm.amount <= 0) {
      window.alert('Payment amount is required.')
      return
    }

    if (paymentForm.id && !canEditOrDelete) {
      window.alert('Account user cannot edit existing payments.')
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
      const created = withNewPayment(paymentToSave)
      setDataWithLog(
        { ...data, payments: [created, ...data.payments] },
        'Created payment',
        `${partyName(created.partyId)} - ${npr(created.amountNPR)}`,
      )
    }

    setPaymentForm(createEmptyPayment())
    setPaymentBillYear('Current')
    setBankOutflowNPR(0)
  }

  const editPayment = (payment: Payment) => {
    setPaymentForm(payment)
    setPaymentMode(isSupplierPayment(payment) ? 'Indian Supplier' : 'Other Party')
    setPaymentBillYear(payment.remarks.includes('Last year') ? 'Last year' : 'Current')
    setBankOutflowNPR(payment.amountNPR)
    setView('Payment Entry')
  }

  const deletePayment = (payment: Payment) => {
    if (!window.confirm(`Delete payment ${payment.referenceNumber || payment.id}?`)) {
      return
    }

    const next = {
      ...data,
      payments: data.payments.filter((item) => item.id !== payment.id),
    }
    setDataWithLog(
      next,
      'Deleted payment',
      `${partyName(payment.partyId)} - ${npr(payment.amountNPR)}`,
      auditValue(payment),
      'Deleted',
    )
  }

  const reconcileSupplierPayment = () => {
    if (!selectedReconciliationPayment) {
      window.alert('Select a current year Indian supplier payment first.')
      return
    }

    if (!selectedSupplierBills.length) {
      window.alert('Select one or more unpaid bills to link.')
      return
    }

    const billNumbers = selectedSupplierBills
      .map((purchase) => purchase.vendorBillNumber)
      .join(', ')
    const updated = withUpdatedPayment({
      ...selectedReconciliationPayment,
      referenceNumber: billNumbers,
      remarks: [
        selectedReconciliationPayment.remarks
          .split('; ')
          .filter((part) => !part.startsWith('Matched bills NPR:'))
          .join('; '),
        `Matched bills NPR: ${fmt(selectedSupplierBillAmountNPR)}`,
      ]
        .filter(Boolean)
        .join('; '),
    })
    const next = {
      ...data,
      payments: data.payments.map((payment) =>
        payment.id === updated.id ? updated : payment,
      ),
    }

    setDataWithLog(
      next,
      'Reconciled supplier payment',
      `${partyName(updated.partyId)} - ${billNumbers}`,
      auditValue(selectedReconciliationPayment),
      auditValue(updated),
    )
    setSelectedSupplierBillIds([])
    setReconciliationPaymentId('')
  }

  const saveLocalExpense = (event: FormEvent) => {
    event.preventDefault()

    if (!localExpenseForm.partyId || !localExpenseForm.billNumber.trim() || !localExpenseForm.billDate) {
      window.alert('Local supplier, bill number, and bill date are required.')
      return
    }

    if (localExpenseForm.id && !canEditOrDelete) {
      window.alert('Account user cannot edit existing local purchase/expense entries.')
      return
    }

    const localExpenseToSave = {
      ...localExpenseForm,
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
      setDataWithLog(
        next,
        'Updated local purchase/expense',
        updated.billNumber,
        auditValue(previous),
        auditValue(updated),
      )
    } else {
      const created = withNewLocalExpense(localExpenseToSave)
      setDataWithLog(
        { ...data, localExpenses: [created, ...data.localExpenses] },
        'Created local purchase/expense',
        `${partyName(created.partyId)} - ${created.billNumber}`,
      )
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
    setView('Local Purchase / Expense')
  }

  const deleteLocalExpense = (localExpense: LocalPurchaseExpense) => {
    if (!window.confirm(`Delete local purchase/expense ${localExpense.billNumber}?`)) {
      return
    }

    const next = {
      ...data,
      localExpenses: data.localExpenses.filter((item) => item.id !== localExpense.id),
    }
    setDataWithLog(
      next,
      'Deleted local purchase/expense',
      `${partyName(localExpense.partyId)} - ${localExpense.billNumber}`,
      auditValue(localExpense),
      'Deleted',
    )
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

  const renderDashboard = () => (
    <div className="stack">
      <Panel title="New Entry">
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
        <Metric label="Total supplier payable" value={npr(dashboard.supplierPayable)} />
        <Metric label="Total custom agent payable" value={npr(dashboard.agentPayable)} />
        <Metric label="Total input VAT" value={npr(dashboard.inputVat)} />
        <Metric label="Total landed cost" value={npr(dashboard.landedCost)} />
      </div>

      <Panel title="Landed Cost by Month">
        <BarChart rows={monthlyLandedCost} emptyText="No landed cost data by agent bill date yet." />
      </Panel>

      <Panel title="Purchase by Major Indian Supplier">
        <PieChart slices={purchaseBySupplier} emptyText="No Indian supplier purchase data yet." />
      </Panel>

      <div className="two-column">
        <Panel title="Recent Purchases">
          <Table
            headers={['Agent bill date', 'Indian vendor', 'Bill number', 'INR supplier amount']}
            rows={dashboard.recentPurchases.map((purchase) => [
              dateText(purchase.agentServiceBillDate || importPurchaseSortDate(purchase)),
              partyName(purchase.vendorPartyId),
              purchase.vendorBillNumber,
              ic(purchase.amountIC),
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
                <th>Name</th>
                <th>Category</th>
                <th>Country</th>
                <th>Phone</th>
                <th>PAN/VAT</th>
                <th>Opening</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredParties.map((party) => (
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
              {!filteredParties.length && <EmptyRow columns={8} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const renderPurchaseEntry = () => (
    <div className="stack">
      <form onSubmit={savePurchase} className="stack">
        <Panel title="Section A: Supplier Invoice">
          <div className="form-grid">
            <Field label="Vendor party">
              <select
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
            </Field>
            <Field label="Vendor bill number">
              <input
                value={purchaseForm.vendorBillNumber}
                onChange={(event) => updatePurchaseField('vendorBillNumber', event.target.value)}
              />
            </Field>
            <CalendarDateField label="Bill date (AD)" value={purchaseForm.billDate} onChange={(value) => updatePurchaseField('billDate', value)} />
            <NumberField label="Amount IC/INR" value={purchaseForm.amountIC} onChange={(value) => updatePurchaseField('amountIC', value)} />
            <ReadOnly label="Fixed exchange rate" value={rateFmt(data.settings.defaultExchangeRate)} />
            <ReadOnly label="Amount NPR" value={npr(purchaseTotals.supplierAmountNPR)} />
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
                value={purchaseForm.freightIndiaStatus}
                onChange={(event) => updatePurchaseField('freightIndiaStatus', event.target.value as FreightIndiaStatus)}
              >
                {freightIndiaStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </Field>
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
          <div className="summary-grid">
            <Metric label="Supplier bill NPR" value={npr(purchaseTotals.supplierAmountNPR)} />
            <Metric label="Pragapanpatra charges" value={npr(purchaseTotals.debitNoteTotalNPR)} />
            <Metric label="Agent service total" value={npr(purchaseTotals.agentServiceTotalNPR)} />
            <Metric label="Custom agent payable" value={npr(purchaseTotals.totalAgentPayableNPR)} />
            <Metric label="Total input VAT" value={npr(purchaseTotals.totalInputVatNPR)} />
            <Metric label="Landed cost" value={npr(purchaseTotals.landedCostNPR)} />
          </div>
          <div className="form-actions">
            <button type="submit">{purchaseForm.id ? 'Update purchase' : 'Save purchase'}</button>
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
                <th>Vendor</th>
                <th>Bill</th>
                <th>Supplier INR</th>
                <th>Pragapanpatra</th>
                <th>Input VAT</th>
                <th>Landed Cost</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPurchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{partyName(purchase.vendorPartyId)}</td>
                  <td>{purchase.vendorBillNumber}</td>
                  <td>{ic(purchase.amountIC)}</td>
                  <td>{purchase.debitNoteNumber || '-'}</td>
                  <td>{npr(purchase.totalInputVatNPR)}</td>
                  <td>{npr(purchase.landedCostNPR)}</td>
                  <td className="row-actions">
                    {canEditOrDelete ? (
                      <>
                        <button type="button" className="small" onClick={() => editPurchase(purchase)}>
                          Edit
                        </button>
                        <button type="button" className="small danger" onClick={() => deletePurchase(purchase)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {!data.purchases.length && <EmptyRow columns={7} />}
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
            setSelectedSupplierBillIds([])
            setReconciliationPaymentId('')
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
            setSelectedSupplierBillIds([])
            setReconciliationPaymentId('')
            setBankOutflowNPR(0)
          }}
        >
          Custom agent / local payment
        </button>
      </div>

      <Panel title={paymentMode === 'Indian Supplier' ? 'Indian Supplier Payment' : 'Custom Agent / Local Payment'}>
        <form className="form-grid" onSubmit={savePayment}>
          <Field label="Party">
            <select
              value={paymentForm.partyId}
              onChange={(event) => {
                updatePaymentField('partyId', event.target.value)
                setSelectedSupplierBillIds([])
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
          </Field>
          <DateField label="Payment date" value={paymentForm.paymentDate} onChange={(value) => updatePaymentField('paymentDate', value)} />
          {paymentMode === 'Indian Supplier' && (
            <>
              <Field label="Bill year">
                <select value={paymentBillYear} onChange={(event) => setPaymentBillYear(event.target.value as 'Current' | 'Last year')}>
                  <option>Current</option>
                  <option>Last year</option>
                </select>
              </Field>
              <NumberField label="Amount IC/LC" value={paymentForm.amount} onChange={(value) => updatePaymentField('amount', value)} />
              <ReadOnly label="Converted supplier debit NPR" value={npr(indianSupplierPaymentNPR)} />
              <NumberField label="Amount in NC with commission" value={bankOutflowNPR} onChange={setBankOutflowNPR} />
              <ReadOnly label="Commission expense" value={npr(commissionExpenseNPR)} />
              <TextField label="Bill number" value={paymentForm.referenceNumber} onChange={(value) => updatePaymentField('referenceNumber', value)} />
            </>
          )}
          {paymentMode === 'Other Party' && (
            <NumberField label="Amount NPR" value={paymentForm.amount} onChange={(value) => updatePaymentField('amount', value)} />
          )}
          <Field label="Payment method">
            <select value={paymentForm.paymentMethod} onChange={(event) => updatePaymentField('paymentMethod', event.target.value as PaymentMethod)}>
              {paymentMethods.map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </Field>
          <div className="form-actions">
            <button type="submit">{paymentForm.id ? 'Update payment' : 'Save payment'}</button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPaymentForm(createEmptyPayment())
                setPaymentBillYear('Current')
                setSelectedSupplierBillIds([])
                setReconciliationPaymentId('')
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
                <th>Date</th>
                <th>Party</th>
                <th>Currency</th>
                <th>Amount</th>
                <th>Amount NPR</th>
                <th>Bank</th>
                <th>Bill / Reference</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => (
                <tr key={payment.id}>
                  <td>{dateText(payment.paymentDate)}</td>
                  <td>{partyName(payment.partyId)}</td>
                  <td>{payment.currency}</td>
                  <td>{payment.currency === 'NPR' ? npr(payment.amount) : ic(payment.amount)}</td>
                  <td>{npr(payment.amountNPR)}</td>
                  <td>{payment.paymentMethod}</td>
                  <td>{payment.referenceNumber || '-'}</td>
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
              {!filteredPayments.length && <EmptyRow columns={8} />}
            </tbody>
          </table>
        </div>
      </Panel>

      {paymentMode === 'Indian Supplier' && (
        <Panel title="Current Year Supplier Payment Reconciliation">
          <div className="form-grid">
            <Field label="Select current year payment">
              <select
                value={reconciliationPaymentId}
                onChange={(event) => {
                  const paymentId = event.target.value
                  const payment = data.payments.find((item) => item.id === paymentId)
                  setReconciliationPaymentId(paymentId)
                  setSelectedSupplierBillIds(
                    payment
                      ? data.purchases
                          .filter(
                            (purchase) =>
                              purchase.vendorPartyId === payment.partyId &&
                              payment.referenceNumber
                                .split(',')
                                .map((billNumber) => billNumber.trim())
                                .includes(purchase.vendorBillNumber),
                          )
                          .map((purchase) => purchase.id)
                      : [],
                  )
                }}
              >
                <option value="">Select payment</option>
                {currentYearSupplierPayments.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {dateText(payment.paymentDate)} - {partyName(payment.partyId)} - {ic(payment.amount)} / {npr(payment.amountNPR)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Match unpaid bills">
              <select
                multiple
                value={selectedSupplierBillIds}
                onChange={(event) =>
                  setSelectedSupplierBillIds(
                    Array.from(event.target.selectedOptions).map((option) => option.value),
                  )
                }
              >
                {supplierBillOptions.map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.vendorBillNumber} - {ic(purchase.amountIC)} / {npr(purchase.supplierAmountNPR)}
                  </option>
                ))}
              </select>
            </Field>
            <ReadOnly label="Selected bills IC" value={ic(selectedSupplierBillAmountIC)} />
            <ReadOnly label="Selected bills NPR" value={npr(selectedSupplierBillAmountNPR)} />
            <ReadOnly label="Payment NPR" value={npr(selectedReconciliationPayment?.amountNPR ?? 0)} />
            <ReadOnly label="Difference" value={npr(reconciliationDifferenceNPR)} />
            <div className="form-actions">
              <button type="button" onClick={reconcileSupplierPayment}>
                Link selected bills
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setReconciliationPaymentId('')
                  setSelectedSupplierBillIds([])
                }}
              >
                Clear reconciliation
              </button>
            </div>
          </div>
        </Panel>
      )}
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
          <TextField
            label="Kind of expense / fixed asset"
            value={localExpenseForm.expenseHead}
            onChange={(value) => updateLocalExpenseField('expenseHead', value)}
          />
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
                <th>Date</th>
                <th>Supplier</th>
                <th>Bill</th>
                <th>Heading</th>
                <th>Kind</th>
                <th>Before VAT</th>
                <th>VAT</th>
                <th>Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedLocalExpenses.map((localExpense) => (
                <tr key={localExpense.id}>
                  <td>{dateText(localExpense.billDate)}</td>
                  <td>{partyName(localExpense.partyId)}</td>
                  <td>{localExpense.billNumber}</td>
                  <td>{localExpense.expenseType ?? 'Expense'}</td>
                  <td>{localExpense.expenseHead || '-'}</td>
                  <td>{npr(localExpense.amountBeforeVatNPR)}</td>
                  <td>{npr(localExpense.vatNPR)}</td>
                  <td>{npr(localExpense.totalAmountNPR)}</td>
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
              ))}
              {!data.localExpenses.length && <EmptyRow columns={9} />}
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
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Custom bill date</th>
              <th>Vendor</th>
              <th>Bill number</th>
              <th>Amount IC</th>
              <th>Supplier NPR</th>
              <th>Custom agent</th>
              <th>Pragapanpatra</th>
              <th>Import duty</th>
              <th>Import VAT</th>
              <th>Terminal charge</th>
              <th>Freight NPR</th>
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
                <td>{ic(purchase.amountIC)}</td>
                <td>{npr(purchase.supplierAmountNPR)}</td>
                <td>{partyName(purchase.customAgentPartyId)}</td>
                <td>{purchase.debitNoteNumber || '-'}</td>
                <td>{npr(purchase.importDutyNPR)}</td>
                <td>{npr(purchase.importVatNPR)}</td>
                <td>{npr(purchase.totalTerminalChargeNPR)}</td>
                <td>{npr(purchase.freightIndiaAmountNPR)}</td>
                <td>{npr(purchase.otherChargesNPR)}</td>
                <td>{npr(purchase.debitNoteTotalNPR)}</td>
                <td>{npr(purchase.agentServiceTotalNPR)}</td>
                <td>{npr(purchase.totalAgentPayableNPR)}</td>
                <td>{npr(purchase.totalInputVatNPR)}</td>
                <td>{npr(purchase.landedCostNPR)}</td>
              </tr>
            ))}
            {!filteredPurchases.length && <EmptyRow columns={17} />}
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
        headers={['Custom bill date', 'Vendor', 'Bill number', 'Supplier bill NPR', 'Import duty', 'Custom service', 'Terminal without VAT', 'Freight India NPR', 'Other charges', 'Service before VAT', 'Landed cost']}
        rows={filteredPurchases.map((purchase) => [
          dateText(importPurchaseSortDate(purchase)),
          partyName(purchase.vendorPartyId),
          purchase.vendorBillNumber,
          npr(purchase.supplierAmountNPR),
          npr(purchase.importDutyNPR),
          npr(purchase.customServiceNPR),
          npr(purchase.terminalChargeWithoutVatNPR),
          npr(purchase.freightIndiaAmountNPR),
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
            label="Fixed IC/INR exchange rate"
            value={settingsForm.defaultExchangeRate}
            step="0.0001"
            onChange={(value) => updateSettingsField('defaultExchangeRate', value)}
          />
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
        <p className="eyebrow">Dhaulagiri</p>
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

  const allowedViewItems = userRole === 'Master' ? viewItems : accountViewItems
  const currentView = allowedViewItems.includes(view) ? view : 'Dashboard'

  return (
    <div className="app-shell" onKeyDown={moveEnterToNextField}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Dhaulagiri</p>
          <h1>Import Purchase</h1>
          <p className="sidebar-note">Supplier bills, Pragapanpatra charges, VAT, landed cost, payables, and payments.</p>
          <p className="sidebar-note">User: {userRole}</p>
        </div>
        <nav>
          {allowedViewItems.map((item) => (
            <button
              type="button"
              key={item}
              className={currentView === item ? 'active' : ''}
              onClick={() => setView(item)}
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
            <p className="eyebrow">
              {data.settings.companyName} {data.settings.fiscalYear ? `- FY ${data.settings.fiscalYear}` : ''}
            </p>
            <h2>{currentView}</h2>
          </div>
          <div className="global-search">
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search party, bill, debit note, payment ref, PAN/VAT"
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
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={`${label} (YYYY/MM/DD in BS)`}>
      <input
        type="text"
        value={value}
        placeholder="YYYY/MM/DD in BS"
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(normalizeBsDate(event.target.value))}
      />
    </Field>
  )
}

function CalendarDateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function NumberField({
  label,
  value,
  step = '0.01',
  readOnly = false,
  onChange,
}: {
  label: string
  value: number
  step?: string
  readOnly?: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min="0"
        step={step}
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        readOnly={readOnly}
        onChange={(event) => onChange(Math.max(0, n(event.target.value)))}
        onWheel={(event) => event.currentTarget.blur()}
      />
    </Field>
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
  rows,
}: {
  emptyText: string
  rows: { label: string; amount: number }[]
}) {
  const maxAmount = Math.max(...rows.map((row) => row.amount), 0)

  if (!rows.length || maxAmount <= 0) {
    return <p className="muted">{emptyText}</p>
  }

  return (
    <div className="vertical-bar-chart">
      {rows.map((row) => (
        <div key={row.label} className="vertical-bar-item">
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
  slices,
}: {
  emptyText: string
  slices: { name: string; amount: number; color: string }[]
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
  const buckets = new Map<string, { label: string; amount: number }>()

  items.forEach((item) => {
    const month = monthBucket(item.date)

    if (!month) {
      return
    }

    const existing = buckets.get(month.key)
    buckets.set(month.key, {
      label: month.label,
      amount: (existing?.amount ?? 0) + item.amount,
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

function makePartySlices(items: { name: string; amount: number }[]) {
  const colors = ['#245477', '#16a34a', '#f97316', '#7c3aed', '#0891b2', '#64748b']
  const buckets = new Map<string, number>()

  items.forEach((item) => {
    if (item.amount <= 0) {
      return
    }

    buckets.set(item.name, (buckets.get(item.name) ?? 0) + item.amount)
  })

  const sorted = Array.from(buckets.entries()).sort((left, right) => right[1] - left[1])
  const top = sorted.slice(0, 5)
  const otherAmount = sorted.slice(5).reduce((sum, [, amount]) => sum + amount, 0)
  const rows = otherAmount > 0 ? [...top, ['Other', otherAmount] as [string, number]] : top

  return rows.map(([name, amount], index) => ({
    name,
    amount,
    color: colors[index % colors.length],
  }))
}

export default App

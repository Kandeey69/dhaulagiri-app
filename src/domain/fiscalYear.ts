export type FiscalYearStatus = 'OPEN' | 'SOFT_CLOSED' | 'CLOSED'

export type FiscalYear = {
  id: string
  companyId: string
  code: string
  startBs: string
  endBs: string
  startAd?: string
  endAd?: string
  status: FiscalYearStatus
  createdAt: string
  updatedAt: string
}

export type FiscalYearValidationResult = {
  valid: boolean
  normalizedDate?: string
  fiscalYear?: FiscalYear
  error?: string
}

const FISCAL_YEAR_CODE_PATTERN = /^(\d{4})\s*\/\s*(\d{2})$/

export function normalizeBsDate(value: string) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }

  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (!match) {
    return ''
  }

  const [, year, monthText, dayText] = match
  const month = Number(monthText)
  const day = Number(dayText)

  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 32) {
    return ''
  }

  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
}

export function compareBsDates(left: string, right: string) {
  const normalizedLeft = normalizeBsDate(left)
  const normalizedRight = normalizeBsDate(right)

  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft.localeCompare(normalizedRight)
  }

  return normalizedLeft.localeCompare(normalizedRight)
}

export function fiscalYearId(companyId: string, code: string) {
  const companyPart = (companyId || 'default').replace(/[^a-zA-Z0-9_-]+/g, '-')
  const codePart = (code || 'legacy').replace(/[^a-zA-Z0-9]+/g, '-')
  return `${companyPart}-${codePart}`
}

export function createFiscalYearFromCode(
  companyId: string,
  code: string,
  status: FiscalYearStatus = 'OPEN',
  timestamp = new Date().toISOString(),
): FiscalYear {
  const match = code.trim().match(FISCAL_YEAR_CODE_PATTERN)
  const startYear = match ? Number(match[1]) : 2082
  const normalizedCode = match ? `${match[1]}/${match[2]}` : '2082/83'

  return {
    id: fiscalYearId(companyId, normalizedCode),
    companyId,
    code: normalizedCode,
    startBs: `${startYear}/04/01`,
    endBs: `${startYear + 1}/03/32`,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function isBsDateInFiscalYear(value: string, fiscalYear: FiscalYear) {
  const normalizedDate = normalizeBsDate(value)

  if (!normalizedDate) {
    return false
  }

  return (
    compareBsDates(normalizedDate, fiscalYear.startBs) >= 0 &&
    compareBsDates(normalizedDate, fiscalYear.endBs) <= 0
  )
}

export function findFiscalYearByBsDate(value: string, fiscalYears: FiscalYear[]) {
  const normalizedDate = normalizeBsDate(value)
  if (!normalizedDate) {
    return undefined
  }

  return fiscalYears.find((fiscalYear) => isBsDateInFiscalYear(normalizedDate, fiscalYear))
}

export function getActiveFiscalYear(companyId: string, fiscalYears: FiscalYear[]) {
  return fiscalYears.find(
    (fiscalYear) => fiscalYear.companyId === companyId && fiscalYear.status === 'OPEN',
  )
}

export function ensureFiscalYearEditable(fiscalYear: FiscalYear) {
  if (fiscalYear.status === 'CLOSED') {
    throw new Error(`Fiscal year ${fiscalYear.code} is closed.`)
  }
}

export function validateDateInFiscalYear(
  value: string,
  fiscalYear: FiscalYear,
  fieldName = 'Date BS',
): FiscalYearValidationResult {
  const normalizedDate = normalizeBsDate(value)

  if (!normalizedDate) {
    return {
      valid: false,
      error: `${fieldName} must be in YYYY/MM/DD or YYYY-MM-DD format.`,
    }
  }

  if (!isBsDateInFiscalYear(normalizedDate, fiscalYear)) {
    return {
      valid: false,
      normalizedDate,
      fiscalYear,
      error: `${fieldName} ${normalizedDate} is outside fiscal year ${fiscalYear.code}.`,
    }
  }

  return { valid: true, normalizedDate, fiscalYear }
}

export function getOrCreateMigrationFiscalYear(
  companyId: string,
  fiscalYears: FiscalYear[],
  code = '2082/83',
) {
  return (
    fiscalYears.find((fiscalYear) => fiscalYear.companyId === companyId && fiscalYear.code === code) ??
    createFiscalYearFromCode(companyId, code)
  )
}

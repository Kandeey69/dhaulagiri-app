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

export function parseFiscalYear(code: string) {
  const match = String(code ?? '').trim().match(/^(\d{4})\s*\/\s*(\d{2})$/)
  if (!match || Number(match[1]) < 1000 || Number(match[1]) >= 9999 || (Number(match[1]) + 1) % 100 !== Number(match[2])) {
    throw new Error('Fiscal year must be consecutive, for example 2082/83.')
  }
  return { startYear: Number(match[1]), code: `${match[1]}/${match[2]}` }
}

export function getSuccessorFiscalYear(code: string) {
  const { startYear } = parseFiscalYear(code)
  return parseFiscalYear(`${startYear + 1}/${String((startYear + 2) % 100).padStart(2, '0')}`).code
}

export type FiscalYearLink = { id: string; fiscalYear: string; previousCompanyId: string; nextCompanyId: string }
export function validateFiscalYearTransition(source: FiscalYearLink, target: FiscalYearLink, profiles: FiscalYearLink[]) {
  if (source.id === target.id) throw new Error('A fiscal year cannot carry into itself.')
  for (const row of [source, target]) if (row.previousCompanyId === row.id || row.nextCompanyId === row.id) throw new Error('Fiscal year has a self-link.')
  if (parseFiscalYear(target.fiscalYear).code !== getSuccessorFiscalYear(source.fiscalYear)) throw new Error('Carry-forward requires the exact next fiscal year.')
  if (source.nextCompanyId && source.nextCompanyId !== target.id) throw new Error('Source already has a different successor.')
  if (target.previousCompanyId && target.previousCompanyId !== source.id) throw new Error('Target already has a different predecessor.')
  const byId = new Map([...profiles, source, target].map(row => [row.id, row]))
  const visited = new Set([source.id])
  let current: FiscalYearLink | undefined = target
  while (current) {
    if (visited.has(current.id)) throw new Error('Fiscal-year links would form a cycle.')
    visited.add(current.id)
    if (current.previousCompanyId === current.id) throw new Error('Fiscal year has a self-link.')
    const next: FiscalYearLink | undefined = byId.get(current.nextCompanyId)
    if (current.nextCompanyId && !next) throw new Error("Linked successor is missing.")
    if (next && parseFiscalYear(next.fiscalYear).code !== getSuccessorFiscalYear(current.fiscalYear)) throw new Error("Existing successor chain is not consecutive.")
    current = next
  }
}


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
  const { startYear, code: normalizedCode } = parseFiscalYear(code)

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

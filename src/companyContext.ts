export type CompanyProfile = {
  companyGroupId: string
  createdAt: string
  fiscalYear: string
  id: string
  isLocked: boolean
  lastCarryForwardAt: string
  lockedAt: string
  name: string
  nextCompanyId: string
  previousCompanyId: string
  updatedAt: string
}

const ACTIVE_COMPANY_KEY = 'suite-active-company-id'
const COMPANY_PROFILES_KEY = 'suite-company-profiles'

const isBrowser = () => typeof window !== 'undefined' && Boolean(window.localStorage)

const normalizeProfile = (value: unknown): CompanyProfile | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<CompanyProfile>
  const id = String(row.id ?? '').trim()
  const name = String(row.name ?? '').trim()

  if (!id || !name) {
    return null
  }

  const now = new Date().toISOString()

  return {
    companyGroupId: String(row.companyGroupId ?? id),
    id,
    isLocked: Boolean(row.isLocked),
    lastCarryForwardAt: String(row.lastCarryForwardAt ?? ''),
    lockedAt: String(row.lockedAt ?? ''),
    name,
    nextCompanyId: String(row.nextCompanyId ?? ''),
    previousCompanyId: String(row.previousCompanyId ?? ''),
    fiscalYear: String(row.fiscalYear ?? ''),
    createdAt: String(row.createdAt ?? now),
    updatedAt: String(row.updatedAt ?? row.createdAt ?? now),
  }
}

export function getCompanyProfiles(): CompanyProfile[] {
  if (!isBrowser()) {
    return []
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(COMPANY_PROFILES_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.map(normalizeProfile).filter((profile): profile is CompanyProfile => Boolean(profile))
      : []
  } catch {
    return []
  }
}

export function saveCompanyProfiles(profiles: CompanyProfile[]) {
  if (!isBrowser()) {
    return
  }

  localStorage.setItem(COMPANY_PROFILES_KEY, JSON.stringify(profiles))
}

export function getActiveCompanyId() {
  if (!isBrowser()) {
    return ''
  }

  return localStorage.getItem(ACTIVE_COMPANY_KEY) ?? ''
}

export function setActiveCompanyId(companyId: string) {
  if (!isBrowser()) {
    return
  }

  if (companyId) {
    localStorage.setItem(ACTIVE_COMPANY_KEY, companyId)
  } else {
    localStorage.removeItem(ACTIVE_COMPANY_KEY)
  }
}

export function getActiveCompanyProfile() {
  const activeCompanyId = getActiveCompanyId()
  return getCompanyProfiles().find((profile) => profile.id === activeCompanyId) ?? null
}

export function createCompanyId(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'company'
  const existingIds = new Set(getCompanyProfiles().map((profile) => profile.id))
  let id = base
  let counter = 2

  while (existingIds.has(id)) {
    id = `${base}-${counter}`
    counter += 1
  }

  return id
}

export function createCompanyYearId(name: string, fiscalYear: string) {
  const fiscalYearSlug = fiscalYear
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return createCompanyId([name, fiscalYearSlug].filter(Boolean).join(' '))
}

export function upsertCompanyProfile(profile: Pick<CompanyProfile, 'id' | 'name'> & Partial<CompanyProfile>) {
  const now = new Date().toISOString()
  const profiles = getCompanyProfiles()
  const index = profiles.findIndex((item) => item.id === profile.id)
  const nextProfile: CompanyProfile = {
    companyGroupId: profile.companyGroupId ?? profiles[index]?.companyGroupId ?? profile.id,
    createdAt: profile.createdAt ?? profiles[index]?.createdAt ?? now,
    fiscalYear: profile.fiscalYear ?? profiles[index]?.fiscalYear ?? '',
    id: profile.id,
    isLocked: profile.isLocked ?? profiles[index]?.isLocked ?? false,
    lastCarryForwardAt: profile.lastCarryForwardAt ?? profiles[index]?.lastCarryForwardAt ?? '',
    lockedAt: profile.lockedAt ?? profiles[index]?.lockedAt ?? '',
    name: profile.name.trim(),
    nextCompanyId: profile.nextCompanyId ?? profiles[index]?.nextCompanyId ?? '',
    previousCompanyId: profile.previousCompanyId ?? profiles[index]?.previousCompanyId ?? '',
    updatedAt: now,
  }

  if (index >= 0) {
    profiles[index] = nextProfile
  } else {
    profiles.push(nextProfile)
  }

  saveCompanyProfiles(profiles)
  return nextProfile
}

export function removeCompanyProfile(companyId: string) {
  saveCompanyProfiles(getCompanyProfiles().filter((profile) => profile.id !== companyId))

  if (getActiveCompanyId() === companyId) {
    setActiveCompanyId(getCompanyProfiles()[0]?.id ?? '')
  }
}

export function companyStorageKey(key: string, companyId = getActiveCompanyId()) {
  return companyId && companyId !== 'default' ? `${key}:${companyId}` : key
}

export function getCompanySetting(key: string, fallback = '') {
  if (!isBrowser()) {
    return fallback
  }

  return localStorage.getItem(companyStorageKey(key)) ?? fallback
}

export function setCompanySetting(key: string, value: string) {
  if (!isBrowser()) {
    return
  }

  localStorage.setItem(companyStorageKey(key), value)
}

export function removeCompanySetting(key: string) {
  if (!isBrowser()) {
    return
  }

  localStorage.removeItem(companyStorageKey(key))
}

export function getActiveAccountsDatabaseUrl() {
  const companyId = getActiveCompanyId()
  return companyId && companyId !== 'default'
    ? `sqlite:accounts-${companyId}.db`
    : 'sqlite:accounts.db'
}

export function getActivePurchaseDatabaseUrl() {
  const companyId = getActiveCompanyId()
  return companyId && companyId !== 'default'
    ? `sqlite:import-purchases-${companyId}.db`
    : 'sqlite:import-purchases.db'
}

export const LEGACY_STOCK_DATABASE_URL = 'sqlite:inventorytracked-stock.db'

export function encodeCompanyIdForStockFilename(companyId: string) {
  const normalized = String(companyId ?? '').trim()

  if (!normalized || normalized === 'default') {
    return ''
  }

  return Array.from(normalized)
    .map((character) => character.codePointAt(0)?.toString(16).padStart(4, '0') ?? '')
    .join('-')
}

export function getStockDatabaseUrlForCompanyId(companyId: string) {
  const encodedCompanyId = encodeCompanyIdForStockFilename(companyId)

  // The unscoped stock database remains the intentional legacy/default fallback.
  return encodedCompanyId
    ? `sqlite:inventorytracked-stock-${encodedCompanyId}.db`
    : LEGACY_STOCK_DATABASE_URL
}

export function getActiveStockDatabaseUrl() {
  return getStockDatabaseUrlForCompanyId(getActiveCompanyId())
}

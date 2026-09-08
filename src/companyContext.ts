import { assertRecoveryAvailable } from "./application/recovery";
import { assertReopenDependencies } from "./application/openingReconciliation";
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

const profileFiscalYearFromId = (id: string) => {
  const match = id.match(/(?:^|-)(\d{4})-(\d{2})$/)
  return match ? `${match[1]}/${match[2]}` : ''
}

const profileNameFromId = (id: string) => {
  const fiscalYear = profileFiscalYearFromId(id)
  const fiscalYearSuffix = fiscalYear ? `-${fiscalYear.replace('/', '-')}` : ''
  const nameSlug = fiscalYearSuffix && id.endsWith(fiscalYearSuffix)
    ? id.slice(0, -fiscalYearSuffix.length)
    : id

  return nameSlug
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (part === 'pvt') return 'Pvt'
      if (part === 'ltd') return 'Ltd'
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

const normalizeProfile = (value: unknown): CompanyProfile | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<CompanyProfile>
  const id = String(row.id ?? '').trim()
  const name = String(row.name ?? '').trim() || profileNameFromId(id)
  const fiscalYearFromId = profileFiscalYearFromId(id)
  const fiscalYear = fiscalYearFromId || String(row.fiscalYear ?? '').trim()

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
    fiscalYear,
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

export function mergeCompanyProfiles(
  persistedProfiles: unknown[],
  seedProfiles: unknown[],
): CompanyProfile[] {
  const merged: CompanyProfile[] = []
  const seenIds = new Set<string>()

  const append = (profile: unknown) => {
    const normalized = normalizeProfile(profile)

    if (!normalized || seenIds.has(normalized.id)) {
      return
    }

    seenIds.add(normalized.id)
    merged.push(normalized)
  }

  persistedProfiles.forEach(append)
  seedProfiles.forEach(append)

  return merged
}

export function parseCompanyProfiles(value: string): CompanyProfile[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown
    return Array.isArray(parsed) ? parsed.map(normalizeProfile).filter((profile): profile is CompanyProfile => Boolean(profile)) : []
  } catch {
    return []
  }
}

export function resolveActiveCompanyId(
  profiles: CompanyProfile[],
  storedCompanyId: string,
  preferredCompanyId = '',
) {
  const ids = new Set(profiles.map((profile) => profile.id))

  if (storedCompanyId && ids.has(storedCompanyId)) {
    return storedCompanyId
  }

  if (preferredCompanyId && ids.has(preferredCompanyId)) {
    return preferredCompanyId
  }

  if (storedCompanyId && profiles.length > 0) {
    return profiles[0].id
  }

  return profiles.length === 1 ? profiles[0].id : ''
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

  const storedCompanyId = localStorage.getItem(ACTIVE_COMPANY_KEY) ?? ''
  return resolveActiveCompanyId(getCompanyProfiles(), storedCompanyId)
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

export function getCompanyProfile(companyId: string) {
  const normalizedCompanyId = String(companyId ?? '').trim()
  return getCompanyProfiles().find((profile) => profile.id === normalizedCompanyId) ?? null
}

export function assertCompanyWritable(companyId: string) {
  assertRecoveryAvailable();
  const profile = getCompanyProfile(companyId)

  assertReopenDependencies(companyId, getCompanyProfiles());
  if (profile?.isLocked) {
    throw new Error(
      `${profile.name}${profile.fiscalYear ? ` FY ${profile.fiscalYear}` : ''} is closed. Entries cannot be added, edited, or deleted in a closed fiscal year.`,
    )
  }
}

export function assertActiveCompanyWritable() {
  const activeCompanyId = getActiveCompanyId()

  if (activeCompanyId) {
    assertCompanyWritable(activeCompanyId)
  }
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
  const fallbackProfile = profiles[index]
  const id = String(profile.id ?? '').trim()
  const name = String(profile.name ?? '').trim() || fallbackProfile?.name || profileNameFromId(id)
  const fiscalYearFromId = profileFiscalYearFromId(id)
  const fiscalYear =
    fiscalYearFromId || String(profile.fiscalYear ?? fallbackProfile?.fiscalYear ?? '').trim()

  if (!id || !name) {
    throw new Error('Company profile requires a company name.')
  }

  const nextProfile: CompanyProfile = {
    companyGroupId: profile.companyGroupId ?? fallbackProfile?.companyGroupId ?? id,
    createdAt: profile.createdAt ?? fallbackProfile?.createdAt ?? now,
    fiscalYear,
    id,
    isLocked: profile.isLocked ?? fallbackProfile?.isLocked ?? false,
    lastCarryForwardAt: profile.lastCarryForwardAt ?? fallbackProfile?.lastCarryForwardAt ?? '',
    lockedAt: profile.lockedAt ?? fallbackProfile?.lockedAt ?? '',
    name,
    nextCompanyId: profile.nextCompanyId ?? fallbackProfile?.nextCompanyId ?? '',
    previousCompanyId: profile.previousCompanyId ?? fallbackProfile?.previousCompanyId ?? '',
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

export function getCompanySetting(key: string, fallback = '', companyId = getActiveCompanyId()) {
  if (!isBrowser()) {
    return fallback
  }

  return localStorage.getItem(companyStorageKey(key, companyId)) ?? fallback
}

export function setCompanySetting(key: string, value: string, companyId = getActiveCompanyId()) {
  if (!isBrowser()) {
    return
  }

  localStorage.setItem(companyStorageKey(key, companyId), value)
}

export function copyCompanySettings(sourceCompanyId: string, targetCompanyId: string, keys: string[]) {
  if (!isBrowser() || !sourceCompanyId || !targetCompanyId) {
    return
  }

  keys.forEach((key) => {
    const value = localStorage.getItem(companyStorageKey(key, sourceCompanyId))

    if (value !== null) {
      localStorage.setItem(companyStorageKey(key, targetCompanyId), value)
    }
  })
}
/** Seed data is a one-time bootstrap; persisted profiles and settings remain authoritative. */
export function applyCompanySeed(seedText: string, initializeSettings: (profile: CompanyProfile, raw: Record<string, unknown>) => void) {
  if (localStorage.getItem('suite-seed-import-v1')) return getCompanyProfiles();
  const raw: unknown = JSON.parse(seedText || '[]');
  if (!Array.isArray(raw)) throw new Error('Company seed must be an array.');
  const persisted = getCompanyProfiles();
  const seeds = parseCompanyProfiles(seedText);
  for (const profile of seeds) if (!persisted.some(row => row.id === profile.id)) {
    initializeSettings(profile, raw.find(row => row && row.id === profile.id) ?? {});
  }
  const merged = mergeCompanyProfiles(persisted, seeds);
  saveCompanyProfiles(merged);
  localStorage.setItem('suite-seed-import-v1', 'done');
  return merged;
}

export function removeCompanySetting(key: string) {
  if (!isBrowser()) {
    return
  }

  localStorage.removeItem(companyStorageKey(key))
}

export function removeCompanyScopedSettings(companyId: string) {
  if (!isBrowser() || !companyId) {
    return
  }

  const suffix = `:${companyId}`
  const keysToRemove: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.endsWith(suffix)) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key))
}

export function getActiveAccountsDatabaseUrl(companyId = getActiveCompanyId()) {
  return companyId && companyId !== 'default'
    ? `sqlite:accounts-${companyId}.db`
    : 'sqlite:accounts.db'
}

export function getActivePurchaseDatabaseUrl(companyId = getActiveCompanyId()) {
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

export function stockDatabaseSafeCompanyId(companyId: string) {
  const normalized = String(companyId ?? '').trim()

  if (!normalized || normalized === 'default') {
    return ''
  }

  const slug =
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'company'
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (const character of normalized) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * prime) & mask
  }

  return `${slug}-${hash.toString(16).padStart(16, '0')}`
}

export function getStockDatabaseFilenameForCompanyId(companyId: string) {
  const safeCompanyId = stockDatabaseSafeCompanyId(companyId)
  return safeCompanyId ? `inventorytracked-stock-${safeCompanyId}.db` : 'inventorytracked-stock.db'
}

export function getLegacyStockDatabaseFilenameForCompanyId(companyId: string) {
  const encodedCompanyId = encodeCompanyIdForStockFilename(companyId)
  return encodedCompanyId ? `inventorytracked-stock-${encodedCompanyId}.db` : 'inventorytracked-stock.db'
}

export function getStockDatabaseUrlForCompanyId(companyId: string) {
  return companyId && companyId !== 'default'
    ? `sqlite:${getStockDatabaseFilenameForCompanyId(companyId)}`
    : LEGACY_STOCK_DATABASE_URL
}

export function getActiveStockDatabaseUrl() {
  return getStockDatabaseUrlForCompanyId(getActiveCompanyId())
}

export type CompanyDatabaseContext = Readonly<{
  companyId: string; fiscalYear: string; accountsUrl: string; purchaseUrl: string; stockUrl: string
}>
export function companyDatabaseContext(companyId = getActiveCompanyId() || 'default'): CompanyDatabaseContext {
  const profile = getCompanyProfile(companyId)
  return Object.freeze({
    companyId, fiscalYear: profile?.fiscalYear || '2082/83',
    accountsUrl: getActiveAccountsDatabaseUrl(companyId),
    purchaseUrl: getActivePurchaseDatabaseUrl(companyId),
    stockUrl: getStockDatabaseUrlForCompanyId(companyId),
  })
}

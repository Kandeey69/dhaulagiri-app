import schemaSql from './db/schema.sql?raw'
import {
  defaultSettings,
  normalizeFreightIndiaStatus,
  normalizePartyCategory,
  normalizePaymentMethod,
  normalizeSupplierCurrency,
  type AppData,
  type AppSettings,
  type ImportPurchase,
  type LocalPurchaseExpense,
  type Party,
  type Payment,
  type PaymentAllocation,
} from './domain'
import { mapImportPurchaseRowFromDb } from './repositoryMapping'
import { loadData as loadLocalData, saveData as saveLocalData } from './storage'
import {
  assertActiveCompanyWritable,
  getActiveCompanyId,
  getActiveCompanyProfile,
  getActivePurchaseDatabaseUrl,
} from '../companyContext'
import {
  createFiscalYearFromCode,
  findFiscalYearByBsDate,
  getOrCreateMigrationFiscalYear,
  type FiscalYear,
} from '../domain/fiscalYear'
import type { LedgerEntry } from '../domain/ledger'
import type { TransactionLifecycleStatus } from '../domain/lifecycle'

type SqlDatabase = {
  execute: (query: string, bindValues?: unknown[]) => Promise<unknown>
  select: <T>(query: string, bindValues?: unknown[]) => Promise<T>
}

const sqliteSaveQueues = new Map<string, Promise<void>>()
const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

function isDatabaseLockedError(error: unknown) {
  return String(error instanceof Error ? error.message : error).toLowerCase().includes('database is locked')
}

async function beginImmediateTransaction(db: SqlDatabase) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await db.execute('BEGIN IMMEDIATE TRANSACTION')
      return
    } catch (error) {
      if (!isDatabaseLockedError(error) || attempt === 11) {
        throw error
      }
      await wait(350 * (attempt + 1))
    }
  }
}

export type DataRepository = {
  kind: 'sqlite' | 'localStorage'
  loadData: () => Promise<AppData>
  saveData: (data: AppData) => Promise<void>
}

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

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const splitSql = (sql: string) =>
  sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

const boolFromDb = (value: unknown) => value === 1 || value === true

const activeCompanyId = () => getActiveCompanyId() || 'default'

const activeFiscalYearCode = (settings?: AppSettings) =>
  getActiveCompanyProfile()?.fiscalYear || settings?.fiscalYear || defaultSettings.fiscalYear

const fiscalYearForDate = (
  date: string,
  fiscalYears: FiscalYear[],
  settings?: AppSettings,
) =>
  (date ? findFiscalYearByBsDate(date, fiscalYears) : undefined) ??
  getOrCreateMigrationFiscalYear(activeCompanyId(), fiscalYears, activeFiscalYearCode(settings))

const importPurchaseFiscalDateFromDb = (row: Record<string, unknown>) =>
  String(row.debitNoteDate ?? '') || String(row.agentServiceBillDate ?? '')

const importPurchaseFiscalYearId = (
  purchase: Pick<ImportPurchase, 'debitNoteDate' | 'agentServiceBillDate'>,
  fiscalYears: FiscalYear[],
  settings?: AppSettings,
) => fiscalYearForDate(purchase.debitNoteDate || purchase.agentServiceBillDate, fiscalYears, settings).id

const fiscalYearFromDb = (row: Record<string, unknown>): FiscalYear => ({
  id: String(row.id ?? ''),
  companyId: String(row.companyId ?? activeCompanyId()),
  code: String(row.code ?? defaultSettings.fiscalYear),
  startBs: String(row.startBs ?? ''),
  endBs: String(row.endBs ?? ''),
  startAd: String(row.startAd ?? ''),
  endAd: String(row.endAd ?? ''),
  status: (row.status as FiscalYear['status']) ?? 'OPEN',
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const partyFromDb = (row: Record<string, unknown>): Party => ({
  id: String(row.id ?? ''),
  name: String(row.name ?? ''),
  address: String(row.address ?? ''),
  phone: String(row.phone ?? ''),
  panVatNo: String(row.panVatNo ?? ''),
  country: String(row.country ?? ''),
  category: normalizePartyCategory(row.category),
  openingPayable: Number(row.openingPayable ?? 0),
  isActive: boolFromDb(row.isActive),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const purchaseFromDb = (
  row: Record<string, unknown>,
  fiscalYears: FiscalYear[],
  settings: AppSettings,
): ImportPurchase => mapImportPurchaseRowFromDb(
  row,
  settings,
  (date) => fiscalYearForDate(date || importPurchaseFiscalDateFromDb(row), fiscalYears, settings).id,
)

const paymentFromDb = (
  row: Record<string, unknown>,
  fiscalYears: FiscalYear[],
  settings: AppSettings,
): Payment => ({
  id: String(row.id ?? ''),
  fiscalYearId: String(row.fiscalYearId ?? '') || fiscalYearForDate(String(row.paymentDate ?? ''), fiscalYears, settings).id,
  lifecycleStatus: lifecycleStatusFromDb(row.lifecycleStatus),
  partyId: String(row.partyId ?? ''),
  paymentDate: String(row.paymentDate ?? ''),
  paymentType: row.paymentType as Payment['paymentType'],
  currency: row.currency as Payment['currency'],
  amount: Number(row.amount ?? 0),
  exchangeRate: Number(row.exchangeRate ?? 1),
  amountNPR: Number(row.amountNPR ?? 0),
  paymentMethod: normalizePaymentMethod(row.paymentMethod),
  referenceNumber: String(row.referenceNumber ?? ''),
  remarks: String(row.remarks ?? ''),
  postedAt: String(row.postedAt ?? row.createdAt ?? ''),
  postedBy: String(row.postedBy ?? ''),
  voidedAt: String(row.voidedAt ?? ''),
  reversedAt: String(row.reversedAt ?? ''),
  reversalReason: String(row.reversalReason ?? ''),
  replacementTransactionId: String(row.replacementTransactionId ?? ''),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const paymentAllocationFromDb = (row: Record<string, unknown>): PaymentAllocation => ({
  id: String(row.id ?? ''),
  paymentId: String(row.paymentId ?? ''),
  purchaseId: String(row.purchaseId ?? ''),
  amountNPR: Number(row.amountNPR ?? 0),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const lifecycleStatusFromDb = (value: unknown): TransactionLifecycleStatus => {
  const status = String(value ?? 'POSTED')
  return status === 'DRAFT' || status === 'VOID' || status === 'REVERSED' ? status : 'POSTED'
}

const ledgerEntryFromDb = (row: Record<string, unknown>): LedgerEntry => ({
  id: String(row.id ?? ''),
  batchId: String(row.batchId ?? ''),
  companyId: String(row.companyId ?? ''),
  fiscalYearId: String(row.fiscalYearId ?? ''),
  transactionDate: String(row.transactionDate ?? ''),
  accountCode: row.accountCode as LedgerEntry['accountCode'],
  partyId: String(row.partyId ?? '') || undefined,
  sourceType: row.sourceType as LedgerEntry['sourceType'],
  sourceId: String(row.sourceId ?? ''),
  postingVersion: String(row.postingVersion ?? 'v1'),
  debit: Number(row.debit ?? 0),
  credit: Number(row.credit ?? 0),
  narration: String(row.narration ?? ''),
  status: row.status === 'REVERSED' ? 'REVERSED' : 'ACTIVE',
  reversalOfEntryId: String(row.reversalOfEntryId ?? '') || undefined,
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const localExpenseFromDb = (
  row: Record<string, unknown>,
  fiscalYears: FiscalYear[],
  settings: AppSettings,
): LocalPurchaseExpense => ({
  id: String(row.id ?? ''),
  fiscalYearId: String(row.fiscalYearId ?? '') || fiscalYearForDate(String(row.billDate ?? ''), fiscalYears, settings).id,
  lifecycleStatus: lifecycleStatusFromDb(row.lifecycleStatus),
  partyId: String(row.partyId ?? ''),
  billNumber: String(row.billNumber ?? ''),
  billDate: String(row.billDate ?? ''),
  expenseType: (row.expenseType as LocalPurchaseExpense['expenseType']) ?? 'Expense',
  expenseHead: String(row.expenseHead ?? ''),
  amountBeforeVatNPR: Number(row.amountBeforeVatNPR ?? 0),
  vatNPR: Number(row.vatNPR ?? 0),
  totalAmountNPR: Number(row.totalAmountNPR ?? 0),
  remarks: String(row.remarks ?? ''),
  postedAt: String(row.postedAt ?? row.createdAt ?? ''),
  postedBy: String(row.postedBy ?? ''),
  voidedAt: String(row.voidedAt ?? ''),
  reversedAt: String(row.reversedAt ?? ''),
  reversalReason: String(row.reversalReason ?? ''),
  replacementTransactionId: String(row.replacementTransactionId ?? ''),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const settingsFromDb = (row?: Record<string, unknown>): AppSettings => ({
  ...defaultSettings,
  companyName: String(row?.companyName ?? defaultSettings.companyName),
  fiscalYear: String(row?.fiscalYear ?? defaultSettings.fiscalYear),
  defaultExchangeRate: Number(row?.defaultExchangeRate ?? defaultSettings.defaultExchangeRate),
  supplierPurchaseCurrency: normalizeSupplierCurrency(row?.supplierPurchaseCurrency),
  panVatNo: String(row?.panVatNo ?? defaultSettings.panVatNo),
  address: String(row?.address ?? defaultSettings.address),
  phone: String(row?.phone ?? defaultSettings.phone),
  agentServiceVatRate: Number(row?.agentServiceVatRate ?? defaultSettings.agentServiceVatRate),
})

async function initializeSchema(db: SqlDatabase) {
  for (const statement of splitSql(schemaSql)) {
    await db.execute(statement)
  }
}

async function ensureLocalExpenseColumns(db: SqlDatabase) {
  const columns = await db.select<Record<string, unknown>[]>(
    'PRAGMA table_info(local_expenses)',
  )
  const hasExpenseType = columns.some((column) => String(column.name ?? '') === 'expenseType')

  if (!hasExpenseType) {
    await db.execute("ALTER TABLE local_expenses ADD COLUMN expenseType TEXT NOT NULL DEFAULT 'Expense'")
  }
}

async function ensureActivityLogColumns(db: SqlDatabase) {
  const columns = await db.select<Record<string, unknown>[]>(
    'PRAGMA table_info(activity_logs)',
  )
  const hasUserName = columns.some((column) => String(column.name ?? '') === 'userName')
  const hasOldValue = columns.some((column) => String(column.name ?? '') === 'oldValue')
  const hasNewValue = columns.some((column) => String(column.name ?? '') === 'newValue')

  if (!hasUserName) {
    await db.execute("ALTER TABLE activity_logs ADD COLUMN userName TEXT NOT NULL DEFAULT ''")
  }
  if (!hasOldValue) {
    await db.execute("ALTER TABLE activity_logs ADD COLUMN oldValue TEXT NOT NULL DEFAULT ''")
  }
  if (!hasNewValue) {
    await db.execute("ALTER TABLE activity_logs ADD COLUMN newValue TEXT NOT NULL DEFAULT ''")
  }
}

async function ensureSupplierCurrencyColumns(db: SqlDatabase) {
  const purchaseColumns = await db.select<Record<string, unknown>[]>(
    'PRAGMA table_info(import_purchases)',
  )
  const hasSupplierCurrency = purchaseColumns.some(
    (column) => String(column.name ?? '') === 'supplierCurrency',
  )

  if (!hasSupplierCurrency) {
    await db.execute("ALTER TABLE import_purchases ADD COLUMN supplierCurrency TEXT NOT NULL DEFAULT 'INR'")
  }

  const settingsColumns = await db.select<Record<string, unknown>[]>(
    'PRAGMA table_info(app_settings)',
  )
  const hasSupplierPurchaseCurrency = settingsColumns.some(
    (column) => String(column.name ?? '') === 'supplierPurchaseCurrency',
  )

  if (!hasSupplierPurchaseCurrency) {
    await db.execute("ALTER TABLE app_settings ADD COLUMN supplierPurchaseCurrency TEXT NOT NULL DEFAULT 'INR'")
  }
}

async function ensureFreightIndiaPartyColumn(db: SqlDatabase) {
  const purchaseColumns = await db.select<Record<string, unknown>[]>(
    'PRAGMA table_info(import_purchases)',
  )
  const hasFreightIndiaPartyId = purchaseColumns.some(
    (column) => String(column.name ?? '') === 'freightIndiaPartyId',
  )

  if (!hasFreightIndiaPartyId) {
    await db.execute("ALTER TABLE import_purchases ADD COLUMN freightIndiaPartyId TEXT NOT NULL DEFAULT ''")
  }
}

async function ensureColumn(
  db: SqlDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const columns = await db.select<Record<string, unknown>[]>(
    `PRAGMA table_info(${tableName})`,
  )
  const normalizedColumnName = columnName.toLowerCase()
  const hasColumn = columns.some((column) => String(column.name ?? '').toLowerCase() === normalizedColumnName)

  if (!hasColumn) {
    try {
      await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`)
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }
  }
}

function isDuplicateColumnError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .includes('duplicate column name')
}

async function ensureAccountingModel(db: SqlDatabase) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fiscal_years (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      code TEXT NOT NULL,
      startBs TEXT NOT NULL,
      endBs TEXT NOT NULL,
      startAd TEXT NOT NULL DEFAULT '',
      endAd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(companyId, code)
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      paymentId TEXT NOT NULL,
      purchaseId TEXT NOT NULL,
      amountNPR REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (paymentId) REFERENCES payments(id),
      FOREIGN KEY (purchaseId) REFERENCES import_purchases(id)
    )
  `)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(paymentId)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase ON payment_allocations(purchaseId)')

  await ensureColumn(db, 'import_purchases', 'fiscalYearId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'lifecycleStatus', "TEXT NOT NULL DEFAULT 'POSTED'")
  await ensureColumn(db, 'import_purchases', 'appliedVatRate', 'REAL NOT NULL DEFAULT 13')
  await ensureColumn(db, 'import_purchases', 'appliedExchangeRate', 'REAL NOT NULL DEFAULT 1.6015')
  await ensureColumn(db, 'import_purchases', 'calculationVersion', "TEXT NOT NULL DEFAULT 'legacy-migrated-v1'")
  await ensureColumn(db, 'import_purchases', 'calculatedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'postedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'postedBy', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'voidedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'reversedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'reversalReason', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'replacementTransactionId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'import_purchases', 'totalKg', 'REAL NOT NULL DEFAULT 0')
  await ensureColumn(db, 'import_purchases', 'loadingUnloadingChargePerKg', 'REAL NOT NULL DEFAULT 0')
  await ensureColumn(db, 'import_purchases', 'loadingUnloadingChargeNPR', 'REAL NOT NULL DEFAULT 0')
  await ensureColumn(db, 'payments', 'fiscalYearId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'lifecycleStatus', "TEXT NOT NULL DEFAULT 'POSTED'")
  await ensureColumn(db, 'payments', 'postedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'postedBy', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'voidedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'reversedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'reversalReason', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'payments', 'replacementTransactionId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'fiscalYearId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'lifecycleStatus', "TEXT NOT NULL DEFAULT 'POSTED'")
  await ensureColumn(db, 'local_expenses', 'postedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'postedBy', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'voidedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'reversedAt', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'reversalReason', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'local_expenses', 'replacementTransactionId', "TEXT NOT NULL DEFAULT ''")
  await ensureColumn(db, 'activity_logs', 'metadata', "TEXT NOT NULL DEFAULT ''")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      batchId TEXT NOT NULL,
      companyId TEXT NOT NULL,
      fiscalYearId TEXT NOT NULL,
      transactionDate TEXT NOT NULL,
      accountCode TEXT NOT NULL,
      partyId TEXT,
      sourceType TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      postingVersion TEXT NOT NULL DEFAULT 'v1',
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      narration TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      reversalOfEntryId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_source ON ledger_entries(sourceType, sourceId, postingVersion)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_fiscal_year ON ledger_entries(fiscalYearId)')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(partyId)')

  const companyId = activeCompanyId()
  const code = activeFiscalYearCode()
  const fiscalYear = createFiscalYearFromCode(companyId, code)
  await db.execute(
    `INSERT OR IGNORE INTO fiscal_years (
      id, companyId, code, startBs, endBs, startAd, endAd, status, createdAt, updatedAt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      fiscalYear.id,
      fiscalYear.companyId,
      fiscalYear.code,
      fiscalYear.startBs,
      fiscalYear.endBs,
      fiscalYear.startAd ?? '',
      fiscalYear.endAd ?? '',
      fiscalYear.status,
      fiscalYear.createdAt,
      fiscalYear.updatedAt,
    ],
  )
  await db.execute("UPDATE import_purchases SET fiscalYearId = $1 WHERE fiscalYearId = ''", [fiscalYear.id])
  await db.execute("UPDATE payments SET fiscalYearId = $1 WHERE fiscalYearId = ''", [fiscalYear.id])
  await db.execute("UPDATE local_expenses SET fiscalYearId = $1 WHERE fiscalYearId = ''", [fiscalYear.id])
  await db.execute("UPDATE import_purchases SET calculatedAt = COALESCE(NULLIF(updatedAt, ''), createdAt) WHERE calculatedAt = ''")
}

async function createSqliteRepository(): Promise<DataRepository> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const databaseUrl = getActivePurchaseDatabaseUrl()
  const db = await Database.load(databaseUrl)

  await db.execute('PRAGMA busy_timeout = 10000')
  await db.execute('PRAGMA journal_mode = WAL')
  await db.execute('PRAGMA synchronous = NORMAL')
  await initializeSchema(db)
  await ensureLocalExpenseColumns(db)
  await ensureActivityLogColumns(db)
  await ensureSupplierCurrencyColumns(db)
  await ensureFreightIndiaPartyColumn(db)
  await ensureAccountingModel(db)

  const saveSnapshot = async (data: AppData) => {
    await beginImmediateTransaction(db)
    try {
      const fiscalYears = data.fiscalYears.length
        ? data.fiscalYears
        : [createFiscalYearFromCode(activeCompanyId(), activeFiscalYearCode(data.settings))]

      await db.execute('DELETE FROM payment_allocations')
      await db.execute('DELETE FROM ledger_entries')
      await db.execute('DELETE FROM payments')
      await db.execute('DELETE FROM local_expenses')
      await db.execute('DELETE FROM import_purchases')
      await db.execute('DELETE FROM parties')
      await db.execute('DELETE FROM activity_logs')
      await db.execute('DELETE FROM app_settings')
      await db.execute('DELETE FROM fiscal_years')

      for (const fiscalYear of fiscalYears) {
        await db.execute(
          `INSERT INTO fiscal_years (
            id, companyId, code, startBs, endBs, startAd, endAd, status, createdAt, updatedAt
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            fiscalYear.id,
            fiscalYear.companyId,
            fiscalYear.code,
            fiscalYear.startBs,
            fiscalYear.endBs,
            fiscalYear.startAd ?? '',
            fiscalYear.endAd ?? '',
            fiscalYear.status,
            fiscalYear.createdAt,
            fiscalYear.updatedAt,
          ],
        )
      }

      await db.execute(
      `INSERT INTO app_settings (
        id, companyName, fiscalYear, defaultExchangeRate, supplierPurchaseCurrency,
        panVatNo, address, phone, agentServiceVatRate
      ) VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.settings.companyName,
        data.settings.fiscalYear,
        data.settings.defaultExchangeRate,
        normalizeSupplierCurrency(data.settings.supplierPurchaseCurrency),
        data.settings.panVatNo,
        data.settings.address,
        data.settings.phone,
        data.settings.agentServiceVatRate,
      ],
    )

    for (const party of data.parties) {
      await db.execute(
        `INSERT INTO parties (
          id, name, address, phone, panVatNo, country, category,
          openingPayable, isActive, createdAt, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          party.id,
          party.name,
          party.address,
          party.phone,
          party.panVatNo,
          party.country,
          normalizePartyCategory(party.category),
          party.openingPayable,
          party.isActive ? 1 : 0,
          party.createdAt,
          party.updatedAt,
        ],
      )
    }

    for (const purchase of data.purchases) {
      await db.execute(
        `INSERT INTO import_purchases (
          id, fiscalYearId, lifecycleStatus, vendorPartyId, vendorBillNumber, billDate, supplierCurrency,
          amountIC, supplierExchangeRate, supplierAmountNPR, customAgentPartyId,
          debitNoteNumber, debitNoteDate, importDutyNPR, customServiceNPR,
          importVatNPR, terminalChargeWithoutVatNPR, terminalVatNPR,
          totalTerminalChargeNPR, freightIndiaStatus, freightIndiaAmountIC,
          freightIndiaPartyId, freightIndiaExchangeRate, freightIndiaAmountNPR,
          totalKg, loadingUnloadingChargePerKg, loadingUnloadingChargeNPR, otherChargesNPR,
          debitNoteTotalNPR, agentServiceBillNumber, agentServiceBillDate,
          agentServiceAmountBeforeVatNPR, agentServiceVatNPR,
          agentServiceTotalNPR, totalAgentPayableNPR, totalInputVatNPR,
          landedCostNPR, appliedVatRate, appliedExchangeRate, calculationVersion,
          calculatedAt, postedAt, postedBy, voidedAt, reversedAt, reversalReason,
          replacementTransactionId, remarks, createdAt, updatedAt
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
          $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47,
          $48, $49, $50
        )`,
        [
          purchase.id,
          purchase.fiscalYearId || importPurchaseFiscalYearId(purchase, fiscalYears, data.settings),
          purchase.lifecycleStatus ?? 'POSTED',
          purchase.vendorPartyId,
          purchase.vendorBillNumber,
          purchase.billDate,
          normalizeSupplierCurrency(purchase.supplierCurrency),
          purchase.amountIC,
          purchase.supplierExchangeRate,
          purchase.supplierAmountNPR,
          purchase.customAgentPartyId,
          purchase.debitNoteNumber,
          purchase.debitNoteDate,
          purchase.importDutyNPR,
          purchase.customServiceNPR,
          purchase.importVatNPR,
          purchase.terminalChargeWithoutVatNPR,
          purchase.terminalVatNPR,
          purchase.totalTerminalChargeNPR,
          normalizeFreightIndiaStatus(purchase.freightIndiaStatus),
          purchase.freightIndiaAmountIC,
          purchase.freightIndiaPartyId,
          purchase.freightIndiaExchangeRate,
          purchase.freightIndiaAmountNPR,
          Number(purchase.totalKg ?? 0),
          Number(purchase.loadingUnloadingChargePerKg ?? 0),
          Number(purchase.loadingUnloadingChargeNPR ?? 0),
          purchase.otherChargesNPR,
          purchase.debitNoteTotalNPR,
          purchase.agentServiceBillNumber,
          purchase.agentServiceBillDate,
          purchase.agentServiceAmountBeforeVatNPR,
          purchase.agentServiceVatNPR,
          purchase.agentServiceTotalNPR,
          purchase.totalAgentPayableNPR,
          purchase.totalInputVatNPR,
          purchase.landedCostNPR,
          Number(purchase.appliedVatRate ?? data.settings.agentServiceVatRate ?? defaultSettings.agentServiceVatRate),
          Number(purchase.appliedExchangeRate ?? purchase.supplierExchangeRate ?? data.settings.defaultExchangeRate),
          purchase.calculationVersion || 'legacy-migrated-v1',
          purchase.calculatedAt || purchase.updatedAt || purchase.createdAt || new Date().toISOString(),
          purchase.postedAt ?? '',
          purchase.postedBy ?? '',
          purchase.voidedAt ?? '',
          purchase.reversedAt ?? '',
          purchase.reversalReason ?? '',
          purchase.replacementTransactionId ?? '',
          purchase.remarks,
          purchase.createdAt,
          purchase.updatedAt,
        ],
      )
    }

    for (const payment of data.payments) {
      await db.execute(
        `INSERT INTO payments (
          id, fiscalYearId, lifecycleStatus, partyId, paymentDate, paymentType, currency, amount,
          exchangeRate, amountNPR, paymentMethod, referenceNumber,
          remarks, postedAt, postedBy, voidedAt, reversedAt, reversalReason,
          replacementTransactionId, createdAt, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          payment.id,
          payment.fiscalYearId || fiscalYearForDate(payment.paymentDate, fiscalYears, data.settings).id,
          payment.lifecycleStatus ?? 'POSTED',
          payment.partyId,
          payment.paymentDate,
          payment.paymentType,
          payment.currency,
          payment.amount,
          payment.exchangeRate,
          payment.amountNPR,
          normalizePaymentMethod(payment.paymentMethod),
          payment.referenceNumber,
          payment.remarks,
          payment.postedAt ?? '',
          payment.postedBy ?? '',
          payment.voidedAt ?? '',
          payment.reversedAt ?? '',
          payment.reversalReason ?? '',
          payment.replacementTransactionId ?? '',
          payment.createdAt,
          payment.updatedAt,
        ],
      )
    }

    for (const allocation of data.paymentAllocations) {
      await db.execute(
        `INSERT INTO payment_allocations (
          id, paymentId, purchaseId, amountNPR, createdAt, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          allocation.id,
          allocation.paymentId,
          allocation.purchaseId,
          allocation.amountNPR,
          allocation.createdAt,
          allocation.updatedAt,
        ],
      )
    }

    for (const localExpense of data.localExpenses) {
      await db.execute(
        `INSERT INTO local_expenses (
          id, fiscalYearId, lifecycleStatus, partyId, billNumber, billDate, expenseType, expenseHead,
          amountBeforeVatNPR, vatNPR, totalAmountNPR, remarks, createdAt,
          postedAt, postedBy, voidedAt, reversedAt, reversalReason,
          replacementTransactionId, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          localExpense.id,
          localExpense.fiscalYearId || fiscalYearForDate(localExpense.billDate, fiscalYears, data.settings).id,
          localExpense.lifecycleStatus ?? 'POSTED',
          localExpense.partyId,
          localExpense.billNumber,
          localExpense.billDate,
          localExpense.expenseType ?? 'Expense',
          localExpense.expenseHead,
          localExpense.amountBeforeVatNPR,
          localExpense.vatNPR,
          localExpense.totalAmountNPR,
          localExpense.remarks,
          localExpense.createdAt,
          localExpense.postedAt ?? '',
          localExpense.postedBy ?? '',
          localExpense.voidedAt ?? '',
          localExpense.reversedAt ?? '',
          localExpense.reversalReason ?? '',
          localExpense.replacementTransactionId ?? '',
          localExpense.updatedAt,
        ],
      )
    }

    for (const entry of data.ledgerEntries) {
      await db.execute(
        `INSERT INTO ledger_entries (
          id, batchId, companyId, fiscalYearId, transactionDate, accountCode,
          partyId, sourceType, sourceId, postingVersion, debit, credit,
          narration, status, reversalOfEntryId, createdAt, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          entry.id,
          entry.batchId,
          entry.companyId,
          entry.fiscalYearId,
          entry.transactionDate,
          entry.accountCode,
          entry.partyId ?? '',
          entry.sourceType,
          entry.sourceId,
          entry.postingVersion,
          entry.debit,
          entry.credit,
          entry.narration,
          entry.status,
          entry.reversalOfEntryId ?? '',
          entry.createdAt,
          entry.updatedAt,
        ],
      )
    }

    for (const log of data.activityLogs) {
      await db.execute(
        'INSERT INTO activity_logs (id, action, details, userName, oldValue, newValue, metadata, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          log.id,
          log.action,
          log.details,
          log.userName ?? 'Unknown',
          log.oldValue ?? '',
          log.newValue ?? '',
          log.metadata ?? '',
          log.createdAt,
        ],
      )
    }

      await db.execute('COMMIT')
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  const saveSnapshotWithRetry = async (data: AppData) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await saveSnapshot(data)
        return
      } catch (error) {
        if (!isDatabaseLockedError(error) || attempt === 7) {
          throw error
        }
        await wait(500 * (attempt + 1))
      }
    }
  }

  return {
    kind: 'sqlite',
    loadData: async () => {
      const parties = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM parties ORDER BY createdAt DESC',
      )
      const purchases = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM import_purchases ORDER BY COALESCE(NULLIF(debitNoteDate, ''), billDate) DESC, createdAt DESC",
      )
      const payments = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM payments ORDER BY paymentDate DESC, createdAt DESC',
      )
      const localExpenses = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM local_expenses ORDER BY billDate DESC, createdAt DESC',
      )
      const activityLogs = await db.select<AppData['activityLogs']>(
        'SELECT * FROM activity_logs ORDER BY createdAt DESC',
      )
      const fiscalYearRows = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM fiscal_years ORDER BY startBs DESC',
      )
      const settingsRows = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM app_settings WHERE id = 'default'",
      )
      const settings = settingsFromDb(settingsRows[0])
      const fiscalYears = fiscalYearRows.map(fiscalYearFromDb)
      const migrationFiscalYear = getOrCreateMigrationFiscalYear(
        activeCompanyId(),
        fiscalYears,
        activeFiscalYearCode(settings),
      )
      const normalizedFiscalYears = fiscalYears.some((item) => item.id === migrationFiscalYear.id)
        ? fiscalYears
        : [migrationFiscalYear, ...fiscalYears]
      const paymentAllocations = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM payment_allocations ORDER BY createdAt ASC',
      )
      const ledgerEntries = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM ledger_entries ORDER BY transactionDate ASC, createdAt ASC',
      )

      return {
        settings,
        parties: parties.map(partyFromDb),
        fiscalYears: normalizedFiscalYears,
        purchases: purchases.map((row) => purchaseFromDb(row, normalizedFiscalYears, settings)),
        localExpenses: localExpenses.map((row) => localExpenseFromDb(row, normalizedFiscalYears, settings)),
        payments: payments.map((row) => paymentFromDb(row, normalizedFiscalYears, settings)),
        paymentAllocations: paymentAllocations.map(paymentAllocationFromDb),
        ledgerEntries: ledgerEntries.map(ledgerEntryFromDb),
        activityLogs,
      }
    },
    saveData: async (data) => {
      assertActiveCompanyWritable()
      const previousSave = sqliteSaveQueues.get(databaseUrl) ?? Promise.resolve()
      const nextSave = previousSave.catch(() => undefined).then(() => saveSnapshotWithRetry(data))
      sqliteSaveQueues.set(databaseUrl, nextSave.catch(() => undefined))
      return nextSave
    },
  }
}

function createLocalRepository(): DataRepository {
  return {
    kind: 'localStorage',
    loadData: async () => loadLocalData(),
    saveData: async (data) => {
      assertActiveCompanyWritable()
      return saveLocalData(data)
    },
  }
}

export async function createDataRepository(): Promise<DataRepository> {
  if (!isTauriRuntime()) {
    return createLocalRepository()
  }

  try {
    return await createSqliteRepository()
  } catch (error) {
    console.error('SQLite storage failed to initialize, using localStorage fallback.', error)
    return createLocalRepository()
  }
}

export function getEmptyData(): AppData {
  return emptyData
}

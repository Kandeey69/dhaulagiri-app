import schemaSql from './db/schema.sql?raw'
import {
  defaultSettings,
  normalizeFreightIndiaStatus,
  normalizePartyCategory,
  normalizePaymentMethod,
  type AppData,
  type AppSettings,
  type ImportPurchase,
  type LocalPurchaseExpense,
  type Party,
  type Payment,
} from './domain'
import { loadData as loadLocalData, saveData as saveLocalData } from './storage'

type SqlDatabase = {
  execute: (query: string, bindValues?: unknown[]) => Promise<unknown>
  select: <T>(query: string, bindValues?: unknown[]) => Promise<T>
}

export type DataRepository = {
  kind: 'sqlite' | 'localStorage'
  loadData: () => Promise<AppData>
  saveData: (data: AppData) => Promise<void>
}

const emptyData: AppData = {
  settings: defaultSettings,
  parties: [],
  purchases: [],
  localExpenses: [],
  payments: [],
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

const purchaseFromDb = (row: Record<string, unknown>): ImportPurchase => ({
  id: String(row.id ?? ''),
  vendorPartyId: String(row.vendorPartyId ?? ''),
  vendorBillNumber: String(row.vendorBillNumber ?? ''),
  billDate: String(row.billDate ?? ''),
  amountIC: Number(row.amountIC ?? 0),
  supplierExchangeRate: Number(row.supplierExchangeRate ?? 0),
  supplierAmountNPR: Number(row.supplierAmountNPR ?? 0),
  customAgentPartyId: String(row.customAgentPartyId ?? ''),
  debitNoteNumber: String(row.debitNoteNumber ?? ''),
  debitNoteDate: String(row.debitNoteDate ?? ''),
  importDutyNPR: Number(row.importDutyNPR ?? 0),
  customServiceNPR: Number(row.customServiceNPR ?? 0),
  importVatNPR: Number(row.importVatNPR ?? 0),
  terminalChargeWithoutVatNPR: Number(row.terminalChargeWithoutVatNPR ?? 0),
  terminalVatNPR: Number(row.terminalVatNPR ?? 0),
  totalTerminalChargeNPR: Number(row.totalTerminalChargeNPR ?? 0),
  freightIndiaStatus: normalizeFreightIndiaStatus(row.freightIndiaStatus),
  freightIndiaAmountIC: Number(row.freightIndiaAmountIC ?? 0),
  freightIndiaExchangeRate: Number(row.freightIndiaExchangeRate ?? 0),
  freightIndiaAmountNPR: Number(row.freightIndiaAmountNPR ?? 0),
  otherChargesNPR: Number(row.otherChargesNPR ?? 0),
  debitNoteTotalNPR: Number(row.debitNoteTotalNPR ?? 0),
  agentServiceBillNumber: String(row.agentServiceBillNumber ?? ''),
  agentServiceBillDate: String(row.agentServiceBillDate ?? ''),
  agentServiceAmountBeforeVatNPR: Number(row.agentServiceAmountBeforeVatNPR ?? 0),
  agentServiceVatNPR: Number(row.agentServiceVatNPR ?? 0),
  agentServiceTotalNPR: Number(row.agentServiceTotalNPR ?? 0),
  totalAgentPayableNPR: Number(row.totalAgentPayableNPR ?? 0),
  totalInputVatNPR: Number(row.totalInputVatNPR ?? 0),
  landedCostNPR: Number(row.landedCostNPR ?? 0),
  remarks: String(row.remarks ?? ''),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const paymentFromDb = (row: Record<string, unknown>): Payment => ({
  id: String(row.id ?? ''),
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
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const localExpenseFromDb = (row: Record<string, unknown>): LocalPurchaseExpense => ({
  id: String(row.id ?? ''),
  partyId: String(row.partyId ?? ''),
  billNumber: String(row.billNumber ?? ''),
  billDate: String(row.billDate ?? ''),
  expenseType: (row.expenseType as LocalPurchaseExpense['expenseType']) ?? 'Expense',
  expenseHead: String(row.expenseHead ?? ''),
  amountBeforeVatNPR: Number(row.amountBeforeVatNPR ?? 0),
  vatNPR: Number(row.vatNPR ?? 0),
  totalAmountNPR: Number(row.totalAmountNPR ?? 0),
  remarks: String(row.remarks ?? ''),
  createdAt: String(row.createdAt ?? ''),
  updatedAt: String(row.updatedAt ?? ''),
})

const settingsFromDb = (row?: Record<string, unknown>): AppSettings => ({
  ...defaultSettings,
  companyName: String(row?.companyName ?? defaultSettings.companyName),
  fiscalYear: String(row?.fiscalYear ?? defaultSettings.fiscalYear),
  defaultExchangeRate: Number(row?.defaultExchangeRate ?? defaultSettings.defaultExchangeRate),
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

async function createSqliteRepository(): Promise<DataRepository> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const db = await Database.load('sqlite:import-purchases.db')
  let saveQueue = Promise.resolve()

  await initializeSchema(db)
  await ensureLocalExpenseColumns(db)
  await ensureActivityLogColumns(db)

  const saveSnapshot = async (data: AppData) => {
    await db.execute('DELETE FROM payments')
    await db.execute('DELETE FROM local_expenses')
    await db.execute('DELETE FROM import_purchases')
    await db.execute('DELETE FROM parties')
    await db.execute('DELETE FROM activity_logs')
    await db.execute('DELETE FROM app_settings')

    await db.execute(
      `INSERT INTO app_settings (
        id, companyName, fiscalYear, defaultExchangeRate, panVatNo,
        address, phone, agentServiceVatRate
      ) VALUES ('default', $1, $2, $3, $4, $5, $6, $7)`,
      [
        data.settings.companyName,
        data.settings.fiscalYear,
        data.settings.defaultExchangeRate,
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
          id, vendorPartyId, vendorBillNumber, billDate, amountIC,
          supplierExchangeRate, supplierAmountNPR, customAgentPartyId,
          debitNoteNumber, debitNoteDate, importDutyNPR, customServiceNPR,
          importVatNPR, terminalChargeWithoutVatNPR, terminalVatNPR,
          totalTerminalChargeNPR, freightIndiaStatus, freightIndiaAmountIC,
          freightIndiaExchangeRate, freightIndiaAmountNPR, otherChargesNPR,
          debitNoteTotalNPR, agentServiceBillNumber, agentServiceBillDate,
          agentServiceAmountBeforeVatNPR, agentServiceVatNPR,
          agentServiceTotalNPR, totalAgentPayableNPR, totalInputVatNPR,
          landedCostNPR, remarks, createdAt, updatedAt
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29, $30, $31, $32, $33
        )`,
        [
          purchase.id,
          purchase.vendorPartyId,
          purchase.vendorBillNumber,
          purchase.billDate,
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
          purchase.freightIndiaExchangeRate,
          purchase.freightIndiaAmountNPR,
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
          purchase.remarks,
          purchase.createdAt,
          purchase.updatedAt,
        ],
      )
    }

    for (const payment of data.payments) {
      await db.execute(
        `INSERT INTO payments (
          id, partyId, paymentDate, paymentType, currency, amount,
          exchangeRate, amountNPR, paymentMethod, referenceNumber,
          remarks, createdAt, updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          payment.id,
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
          payment.createdAt,
          payment.updatedAt,
        ],
      )
    }

    for (const localExpense of data.localExpenses) {
      await db.execute(
        `INSERT INTO local_expenses (
          id, partyId, billNumber, billDate, expenseType, expenseHead,
          amountBeforeVatNPR, vatNPR, totalAmountNPR, remarks, createdAt,
          updatedAt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          localExpense.id,
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
          localExpense.updatedAt,
        ],
      )
    }

    for (const log of data.activityLogs) {
      await db.execute(
        'INSERT INTO activity_logs (id, action, details, userName, oldValue, newValue, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          log.id,
          log.action,
          log.details,
          log.userName ?? 'Unknown',
          log.oldValue ?? '',
          log.newValue ?? '',
          log.createdAt,
        ],
      )
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
      const settingsRows = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM app_settings WHERE id = 'default'",
      )

      return {
        settings: settingsFromDb(settingsRows[0]),
        parties: parties.map(partyFromDb),
        purchases: purchases.map(purchaseFromDb),
        localExpenses: localExpenses.map(localExpenseFromDb),
        payments: payments.map(paymentFromDb),
        activityLogs,
      }
    },
    saveData: async (data) => {
      const nextSave = saveQueue.catch(() => undefined).then(() => saveSnapshot(data))
      saveQueue = nextSave.catch(() => undefined)
      return nextSave
    },
  }
}

function createLocalRepository(): DataRepository {
  return {
    kind: 'localStorage',
    loadData: async () => loadLocalData(),
    saveData: async (data) => saveLocalData(data),
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

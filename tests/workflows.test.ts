import { buildStockRows as exportedStockRows } from '../src/stock/storage'
import { assertOperationalCorrection } from '../src/domain/lifecycle'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { buildStockRows, buildStockRegisterRows } from '../src/stock/services/stockLedger'
import { buildStockCarryForwardPlan, assessYearEndReadiness } from '../src/stock/services/stockCarryForward'
import { reconcileOpening, assertReopenDependencies } from '../src/application/openingReconciliation'
import { runRecoverable, setRecoveryBlocked, assertRecoveryAvailable } from '../src/application/recovery'
import { flushPendingWrites, acknowledgeRecoveredWrites } from '../src/application/persistence'
import { applyCompanySeed, companyDatabaseContext, saveCompanyProfiles, setActiveCompanyId, getActiveCompanyId, upsertCompanyProfile } from '../src/companyContext'
import { saveParty, updateParty, saveSale, updateSale, deleteSale, saveCollection, updateCollection, saveCreditNote, getAccountsBackupData, restoreAccountsBackupData, getOutstanding, upsertPartiesForCarryForward } from '../src/accounts/data/storage'

const values = new Map<string, string>()
globalThis.localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, String(value)), removeItem: (key: string) => values.delete(key), key: (index: number) => [...values.keys()][index], get length() { return values.size } } as Storage
globalThis.window = { localStorage } as Window & typeof globalThis
const databases = new Map<string, DatabaseSync>()
let failSql = ''
globalThis.__auditDatabaseLoader = async (url: string) => {
  if (!databases.has(url)) databases.set(url, new DatabaseSync(':memory:'))
  const sqlite = databases.get(url)!
  const statement = (sql: string, params: unknown[]) => {
    if (failSql && sql.includes(failSql)) throw new Error('Injected database failure')
    const stmt = sqlite.prepare(sql)
    const bindings = Object.fromEntries(params.map((value, i) => ['$' + (i + 1), typeof value === 'boolean' ? Number(value) : value ?? null]))
    return { stmt, bindings }
  }
  return {
    select: async (sql: string, params: unknown[] = []) => { const { stmt, bindings } = statement(sql, params); return stmt.all(bindings) },
    execute: async (sql: string, params: unknown[] = []) => { const { stmt, bindings } = statement(sql, params); const result = stmt.run(bindings); return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) } },
  }
}

const item = { id: 'item', code: 'APPLE', name: 'Apple', unit: 'KG', openingQty: 10, openingRate: 100, reorderLevel: 0, isActive: true, createdAt: '' }
function history(opening: [number, number], movements: [string, number, number][]) {
  const purchases = [], sales = []
  movements.forEach(([type, quantity, rate], i) => {
    const row = { id: String(i), billNo: String(i), dateBs: `2082/04/${String(i + 2).padStart(2, '0')}`, createdAt: String(i), source: 'Local Purchase', sourceType: 'Local Purchase', items: [{ id: `line-${i}`, itemId: item.id, quantity, rate, amount: quantity * rate }] }
    ;(type === 'p' ? purchases : sales).push(row)
  })
  const items = [{ ...item, openingQty: opening[0], openingRate: opening[1] }]
  const docs = [...purchases.map(row => ({ ...row, type: 'Local Purchase' })), ...sales.map(row => ({ ...row, type: 'Sale' }))].map(row => ({ documentId: row.id, billNo: row.billNo, date: row.dateBs, type: row.type, fiscalYearId: 'fy', lifecycleStatus: 'POSTED', amount: row.items[0].amount, grandTotal: row.items[0].amount, vatAmount: 0 }))
  return { items, purchaseBills: purchases, salesBills: sales, docs }
}
const cases: [string, [number, number], [string, number, number][], [number, number, number]][] = [
  ['A full depletion', [10, 100], [['s', 10, 150], ['p', 10, 200]], [10, 200, 2000]],
  ['B normal average', [10, 100], [['p', 10, 200], ['s', 4, 300]], [16, 150, 2400]],
  ['C subsequent purchase', [16, 150], [['p', 4, 250], ['s', 2, 300]], [18, 170, 3060]],
  ['D zero reset', [5, 80], [['s', 5, 100], ['p', 3, 120]], [3, 120, 360]],
  ['E partial depletion', [10, 100], [['s', 5, 150], ['p', 5, 200]], [10, 150, 1500]],
  ['F multiple recalculations', [10, 100], [['p', 10, 200], ['s', 10, 200], ['p', 10, 300], ['s', 2, 400]], [18, 225, 4050]],
]
for (const [name, opening, movements, expected] of cases) test(`moving average ${name}: register, summary and carry agree`, () => {
  const h = history(opening, movements)
  assert.equal(exportedStockRows, buildStockRows)
  const summary = buildStockRows(h.items, h.purchaseBills, h.salesBills)[0]
  const last = buildStockRegisterRows(h.items, h.purchaseBills, h.salesBills).at(-1)!
  const plan = buildStockCarryForwardPlan({ asOnDate: '2083/03/32', sourceFiscalYearId: 'fy', sourceDocs: h.docs, sourceStock: h, targetItems: [] })
  assert.deepEqual([summary.closingQty, summary.averageRate, summary.closingValue], expected)
  assert.equal(last.balanceAmount, expected[2])
  assert.equal(plan.totalClosingValue, expected[2])
  assert.equal(plan.totalClosingQty, expected[0])
})
test('same-day ordering uses persisted sequence consistently across reversed input arrays', () => {
  const h = history([10, 100], [['s', 10, 150], ['p', 10, 200], ['p', 5, 300]])
  for (const row of [...h.purchaseBills, ...h.salesBills]) row.dateBs = '2082/04/02'
  const a = buildStockRegisterRows(h.items, h.purchaseBills, h.salesBills)
  const b = buildStockRegisterRows(h.items, [...h.purchaseBills].reverse(), [...h.salesBills].reverse())
  assert.deepEqual(a, b)
  assert.equal(a.at(-1)!.balanceAmount, 3500)
})
test('negative stock and missing source lines block year end', () => {
  const h = history([10, 100], [['s', 11, 150]])
  const input = { sourceFiscalYearId: 'fy', asOnDate: '2083/03/32', sourceDocs: h.docs, sourceStock: h, targetItems: [] }
  assert.equal(assessYearEndReadiness(input).ready, false)
  assert.equal(assessYearEndReadiness({ ...input, sourceStock: { ...h, salesBills: [] } }).ready, false)
})
test('derived openings clear removed sources and preserve manual overrides', () => {
  const first = reconcileOpening(undefined, 100)
  assert.equal(reconcileOpening(100, 0, first.state).value, 0)
  const manual = reconcileOpening(140, 200, first.state)
  assert.equal(manual.value, 140)
  assert.equal(reconcileOpening(140, 0, manual.state).value, 140)
})
test('cross-store failure restores all stores; failed recovery retains original snapshot', async () => {
  let state = { accounts: ['sale'], purchase: ['payment'], stock: ['item'] }
  const snapshot = structuredClone(state)
  let payload: string | null = null
  const journal = { read: async () => payload, write: async (value: string | null) => { payload = value } }
  await assert.rejects(runRecoverable(snapshot, async () => { state.accounts = []; throw new Error('purchase failed') }, async original => { state = structuredClone(original) }, journal), /restored/)
  assert.deepEqual(state, snapshot)
  assert.equal(payload, null)
  await assert.rejects(runRecoverable(snapshot, async () => { state.accounts = []; throw new Error('failure') }, async () => { throw new Error('recovery failure') }, journal), /retained/)
  assert.deepEqual(JSON.parse(payload!), snapshot)
  assert.throws(() => assertRecoveryAvailable(), /recovery is required/)
  setRecoveryBlocked(false)
})
test('real SQLite: durable saves, allocation guards, journal rollback, complete backup replacement and three-year receivables', async () => {
  saveCompanyProfiles([])
  const years = ['2082/83', '2083/84', '2084/85'].map((fiscalYear, i) => upsertCompanyProfile({ id: `integration-${i}`, name: 'Isolated', fiscalYear, companyGroupId: 'integration' }))
  setActiveCompanyId(years[0].id)
  const party = await saveParty({ name: 'Buyer', openingBalance: 100, isActive: true })
  await updateParty({ ...party, address: 'Updated safely' })
  const other = await saveParty({ name: 'Other buyer', openingBalance: 0, isActive: true })
  const pending = saveSale({ billNo: '1', partyId: party.id, dateBs: '2082/04/02', salesAmount: 1000, vatAmount: 0, totalAmount: 1000 })
  await flushPendingWrites()
  const sale = await pending
  await saveCollection({ receiptNo: '1', partyId: party.id, dateBs: '2082/04/03', bankName: 'Cash', amount: 800 })
  await updateSale(sale)
  const context = companyDatabaseContext(years[0].id)
  const before = await getAccountsBackupData(context)
  assert.ok(before.rawTables!.ledger_entries.length > 0)
  assert.ok(before.rawTables!.receipt_allocations.length > 0)
  failSql = 'INSERT INTO activity_logs'
  await assert.rejects(updateCollection({ ...before.collections[0], amount: 700 }), /Injected/)
  failSql = 'INSERT INTO ledger_entries'
  await assert.rejects(saveCreditNote({ creditNoteNo: '1', partyId: party.id, dateBs: '2082/04/04', amount: 100, vatAmount: 0, totalAmount: 100 }), /Injected/)
  failSql = ''
  acknowledgeRecoveredWrites()
  assert.deepEqual((await getAccountsBackupData(context)).rawTables, before.rawTables)
  await assert.rejects(restoreAccountsBackupData({ ...before, rawTables: undefined, sales: before.sales.map(row => ({ ...row, lifecycleStatus: 'REVERSED' })) }, { context }), /Legacy backup/)
  await assert.rejects(updateSale({ ...sale, salesAmount: 500 }), /allocations/)
  await assert.rejects(updateSale({ ...sale, partyId: other.id }), /allocations/)
  failSql = 'INSERT INTO ledger_entries'
  await assert.rejects(updateSale({ ...sale, salesAmount: 1200 }), /Injected/)
  failSql = ''
  acknowledgeRecoveredWrites()
  assert.deepEqual((await getAccountsBackupData(context)).rawTables, before.rawTables)
  await restoreAccountsBackupData(before, { context })
  assert.deepEqual((await getAccountsBackupData(context)).rawTables, before.rawTables)
  failSql = 'INSERT INTO sales'
  await assert.rejects(restoreAccountsBackupData(before, { context }), /Injected/)
  failSql = ''
  acknowledgeRecoveredWrites()
  assert.deepEqual((await getAccountsBackupData(context)).rawTables, before.rawTables)
  for (let i = 0; i < 2; i++) {
    const source = companyDatabaseContext(years[i].id), target = companyDatabaseContext(years[i + 1].id)
    const closing = (await getOutstanding(source)).find(row => row.partyId === party.id)!.outstanding
    await upsertPartiesForCarryForward([{ ...party, openingBalance: closing }], {}, target)
    assert.equal(getActiveCompanyId(), years[0].id)
    assert.equal((await getOutstanding(target))[0].openingBalance, closing)
    years[i] = { ...years[i], isLocked: true, nextCompanyId: years[i + 1].id }
    years[i + 1] = { ...years[i + 1], previousCompanyId: years[i].id }
  }
  assert.throws(() => assertReopenDependencies(years[0].id, years), /newest to oldest/)
  years[1].isLocked = false
  assert.doesNotThrow(() => assertReopenDependencies(years[0].id, years))
  const clone = upsertCompanyProfile({ id: 'empty-restore', name: 'Restore', fiscalYear: '2082/83' })
  await restoreAccountsBackupData(before, { context: companyDatabaseContext(clone.id) })
  assert.deepEqual((await getAccountsBackupData(companyDatabaseContext(clone.id))).rawTables, before.rawTables)
  setActiveCompanyId(clone.id)
  failSql = 'INSERT INTO activity_logs'
  await assert.rejects(deleteSale(sale.id), /Injected/)
  failSql = ''
  acknowledgeRecoveredWrites()
  assert.deepEqual((await getAccountsBackupData(companyDatabaseContext(clone.id))).rawTables, before.rawTables)
  await deleteSale(sale.id)
  const deleted = await getAccountsBackupData(companyDatabaseContext(clone.id))
  assert.equal(deleted.sales.length, 0)
  assert.equal(deleted.receiptAllocations!.length, 0)
  assert.equal(deleted.rawTables!.ledger_entries.filter(row => row.source_type === 'SALE').length, 0)
})
test('operational corrections allow posted open-year edits and preserve reversed history', () => {
  assert.doesNotThrow(() => assertOperationalCorrection('POSTED', { status: 'OPEN' }))
  for (const status of ['VOID', 'REVERSED'] as const) assert.throws(() => assertOperationalCorrection(status, { status: 'OPEN' }))
  assert.throws(() => assertOperationalCorrection('POSTED', { status: 'CLOSED' }))
})
test('one-time seed bootstrap preserves deletion and explicit settings across restart', () => {
  values.delete('suite-seed-import-v1')
  saveCompanyProfiles([])
  const seed = JSON.stringify([{ id: 'seed', name: 'Seed', fiscalYear: '2082/83' }])
  const setting = 'suite-track-inventory:seed'
  assert.equal(applyCompanySeed(seed, () => localStorage.setItem(setting, 'yes')).length, 1)
  localStorage.setItem(setting, 'no')
  saveCompanyProfiles([])
  assert.equal(applyCompanySeed(seed, () => { throw new Error('Seed settings reapplied') }).length, 0)
  assert.equal(localStorage.getItem(setting), 'no')
})

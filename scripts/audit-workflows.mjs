// Read-only audit reproductions: actual source functions, isolated dependencies.
// Run from MERGED APP: node scripts/audit-workflows.mjs
// No application databases or browser storage are accessed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
function findNode(file, predicate) {
  const source = parse(file)
  let found
  function visit(node) {
    if (!found && predicate(node)) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, `Source node exists in ${file}`)
  return found.getText(source)
}
function sourceFunction(file, name, dependencies = {}) {
  const source = findNode(file, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
  return new Function(...Object.keys(dependencies), `${compile(source).replace(/^export /gm, '')}; return ${name}`)(...Object.values(dependencies))
}
function sourceModule(file, names, dependencies = {}) {
  const js = compile(read(file))
  const ast = ts.createSourceFile('module.js', js, ts.ScriptTarget.Latest, true)
  const body = ast.statements.filter((node) => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map((node) => node.getText(ast)).join('\n').replace(/^export /gm, '')
  return new Function(...Object.keys(dependencies), `${body}; return {${names.join(',')}}`)(...Object.values(dependencies))
}
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage }
const company = sourceModule('src/companyContext.ts', ['getCompanyProfiles', 'saveCompanyProfiles', 'upsertCompanyProfile', 'getCompanyProfile', 'setActiveCompanyId', 'getActiveCompanyId', 'createCompanyYearId', 'mergeCompanyProfiles'])
const ledger = sourceModule('src/stock/services/stockLedger.ts', ['buildStockRows', 'buildStockRegisterRows'])
const stockDocs = sourceModule('src/stock/services/stockDocuments.ts', ['isStockDocumentEligible'])
const stockCalc = sourceModule('src/stock/services/stockCalculations.ts', ['validStockBillsForSourceDocs'], stockDocs)
const carry = sourceModule('src/stock/services/stockCarryForward.ts', ['buildStockCarryForwardPlan', 'carryForwardStockOpenings'], { ...stockDocs, ...stockCalc, ...ledger })
const fiscal = sourceModule('src/domain/fiscalYear.ts', ['createFiscalYearFromCode'])
const results = []
const record = (scenario, observed) => results.push({ scenario, observed })

// 1. Execute the actual year-end handler, stubbing only persistence and UI.
const original = company.upsertCompanyProfile({ id: 'audit-2082-83', name: 'Audit', fiscalYear: '2082/83' })
company.setActiveCompanyId(original.id)
let carryTarget
const noop = () => {}
const lock = sourceFunction('src/App.tsx', 'lockCompany', {
  ...company, company: original, companies: [original], linkedNextCompany: null,
  carryForward: true, nextYear: '2082/83', lockPassword: 'test', YEAR_END_PASSWORD: 'test',
  setMessage: noop, setIsBusy: noop, setLockPassword: noop, onCompaniesChanged: noop,
  readSuiteSettings: () => ({}), writeSuiteSettings: noop,
  carryForwardOpenings: async (source, target) => {
    carryTarget = { source: source.id, target: target.id }
    return { accountParties: 1, purchaseParties: 1, inventory: { status: 'skipped', warnings: [] } }
  },
})
await lock()
assert.equal(carryTarget.source, carryTarget.target)
assert.equal(company.getCompanyProfile(original.id).isLocked, false)
record('Year-end accepts current year', { ...carryTarget, finalProfile: company.getCompanyProfile(original.id) })

// 2. Stock summary uses periodic average; register uses moving average.
const item = { id: 'item', code: 'APPLE', name: 'Apple', unit: 'KG', openingQty: 10, openingRate: 100, reorderLevel: 0, isActive: true, createdAt: '' }
const purchase = { id: 'purchase', billNo: '2', dateBs: '2082/04/03', source: 'Local Purchase', items: [{ id: 'p-line', itemId: item.id, quantity: 10, rate: 200, amount: 2000 }] }
const sale = { id: 'sale', billNo: '1', dateBs: '2082/04/02', items: [{ id: 's-line', itemId: item.id, quantity: 10, rate: 150, amount: 1500 }] }
const summary = ledger.buildStockRows([item], [purchase], [sale])[0]
const register = ledger.buildStockRegisterRows([item], [purchase], [sale]).at(-1)
assert.equal(summary.closingValue, 1500)
assert.equal(register.balanceAmount, 2000)
record('Same stock movements produce different closing values', { summary: summary.closingValue, register: register.balanceAmount })

// 3. Previously carried item becomes inactive with zero closing stock.
const plan = carry.buildStockCarryForwardPlan({ asOnDate: '2083/03/32', sourceDocs: [], sourceFiscalYearId: 'fy', sourceStock: { items: [{ ...item, openingQty: 0, isActive: false }], purchaseBills: [], salesBills: [] }, targetItems: [{ ...item, openingQty: 10 }] })
assert.equal(plan.items.length, 0)
assert.equal(plan.skippedInactiveZero, 1)
record('Refresh does not clear previously carried opening when source becomes inactive zero', { targetOpeningBefore: 10, writes: plan.items })

// 4. Fiscal year codes are accepted without semantic validation.
const invalid = fiscal.createFiscalYearFromCode('audit', '2083/99')
const fallback = fiscal.createFiscalYearFromCode('audit', 'nonsense')
assert.equal(invalid.code, '2083/99')
assert.equal(fallback.code, '2082/83')
record('Invalid fiscal-year input is accepted or silently defaulted', { invalid, fallback })

// 5. Execute the actual purchase autosave effect and its unmount cleanup.
const effectSource = findNode('src/purchase/App.tsx', (node) => ts.isCallExpression(node) && node.expression.getText() === 'useEffect' && node.arguments[0]?.getText().includes('const saveTimer'))
let cleanup
let pendingTimer
let saves = 0
const fakeWindow = { setTimeout: (callback) => { pendingTimer = callback; return 1 }, clearTimeout: () => { pendingTimer = undefined } }
new Function('useEffect', 'window', 'repository', 'isStorageReady', 'data', 'lastSavedSnapshotRef', compile(effectSource))(
  (callback) => { cleanup = callback() }, fakeWindow, { saveData: async () => { saves++ } }, true, { payments: ['new payment'] }, { current: '{}' },
)
assert.equal(typeof pendingTimer, 'function')
cleanup()
if (pendingTimer) await pendingTimer()
assert.equal(saves, 0)
record('Leaving purchase module before autosave loses pending change', { saveCalls: saves })

// 6. Company deletion has no compensating data restore on second-store failure.
let accountsRows = ['sale']
company.upsertCompanyProfile({ ...original, isLocked: true })
const clearCompany = sourceFunction('src/App.tsx', 'clearCompanyData', {
  ...company,
  withActiveCompany: async (_id, operation) => operation(),
  restoreAccountsBackupData: async () => { accountsRows = [] },
  emptyAccountsBackupData: {}, getEmptyData: () => ({}),
  createDataRepository: async () => ({ saveData: async () => { throw new Error('Injected purchase write failure') } }),
  replaceStockBackupDataForCompany: noop, emptyStockBackupData: {}, writeInventoryTrackingSettingForCompany: noop,
})
await assert.rejects(clearCompany(original), /Injected/)
assert.deepEqual(accountsRows, [])
assert.equal(company.getCompanyProfile(original.id).isLocked, true)
record('Failed company deletion restores profile but leaves accounts empty', { accountsRows, profileStillPresent: Boolean(company.getCompanyProfile(original.id)) })

// 7. Execute actual restore against an isolated statement-recording adapter.
const statements = []
const restore = sourceFunction('src/accounts/data/storage.ts', 'restoreAccountsBackupData', {
  assertActiveCompanyWritable: noop,
  getDb: async () => ({ execute: async (sql) => { statements.push(sql.trim()) } }),
  logActivity: async () => {},
})
await restore({})
assert.ok(statements.includes('DELETE FROM sales'))
assert.ok(!statements.some((sql) => /ledger_entries/i.test(sql)))
record('Accounts reset leaves old journal entries untouched', { statements })

// 8. Deleted seed companies are reintroduced by the startup merge.
const merged = company.mergeCompanyProfiles([], [original])
assert.equal(merged[0].id, original.id)
record('Startup seed merge reintroduces a removed seeded company', { restoredId: merged[0].id })

// 9. Temporary company selection is visible to every concurrent operation.
company.setActiveCompanyId(original.id)
const target = company.upsertCompanyProfile({ id: 'audit-2083-84', name: 'Audit', fiscalYear: '2083/84' })
let release
const gate = new Promise((resolve) => { release = resolve })
const withActiveCompany = sourceFunction('src/App.tsx', 'withActiveCompany', company)
const background = withActiveCompany(target.id, async () => gate)
assert.equal(company.getActiveCompanyId(), target.id)
record('Awaiting background operation exposes temporary company globally', { displayedCompany: original.id, storageCompany: company.getActiveCompanyId() })
release()
await background
assert.equal(company.getActiveCompanyId(), original.id)

// 10. A pending inventory document does not prevent completed carry-forward.
let inventoryWrites = 0
const incompleteCarry = await carry.carryForwardStockOpenings({
  asOnDate: '2083/03/32', sourceFiscalYearId: 'fy',
  sourceDocs: [{ documentId: 'missing-lines', type: 'Sale', fiscalYearId: 'fy', lifecycleStatus: 'POSTED', amount: 500, grandTotal: 565, vatAmount: 65, date: '2082/04/02' }],
  sourceStock: { items: [item], purchaseBills: [], salesBills: [] },
  targetStock: { items: [], purchaseBills: [], salesBills: [] },
  writeOpenings: async () => { inventoryWrites++; return { created: 1, updated: 0 } },
})
assert.equal(incompleteCarry.status, 'completed')
assert.equal(inventoryWrites, 1)
assert.equal(incompleteCarry.warnings.length, 0)
record('Pending sale inventory lines still allow successful closing-stock carry', { status: incompleteCarry.status, warnings: incompleteCarry.warnings, carriedQty: incompleteCarry.totalClosingQty })

// 11-12. Run the actual sale update against an in-memory SQLite database.
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`CREATE TABLE sales (id TEXT PRIMARY KEY, bill_no TEXT, fiscal_year_id TEXT, date_bs TEXT, date_ad TEXT, party_id TEXT, quantity REAL, rate REAL, amount REAL, sales_amount REAL, vat_amount REAL, total_amount REAL, remarks TEXT);
CREATE TABLE receipt_allocations (sale_id TEXT, amount_npr REAL);
CREATE TABLE ledger_entries (source_type TEXT, source_id TEXT, status TEXT);
INSERT INTO sales (id, bill_no, total_amount, party_id) VALUES ('s1', '1', 1000, 'customer-a');
INSERT INTO receipt_allocations VALUES ('s1', 800);
INSERT INTO ledger_entries VALUES ('SALE', 's1', 'ACTIVE');`)
const db = {
  select: async (sql, parameters = []) => sqlite.prepare(sql.replace(/\$\d+/g, '?')).all(...parameters),
  execute: async (sql, parameters = []) => sqlite.prepare(sql.replace(/\$\d+/g, '?')).run(...parameters),
}
let failLedger = false
const replacePosting = sourceFunction('src/accounts/data/storage.ts', 'replaceLedgerPosting', {
  insertLedgerEntries: async () => {
    if (failLedger) throw new Error('Injected ledger insert failure')
    sqlite.exec("INSERT INTO ledger_entries VALUES ('SALE', 's1', 'ACTIVE')")
  },
})
const updateSale = sourceFunction('src/accounts/data/storage.ts', 'updateSale', {
  assertActiveCompanyWritable: noop, getDb: async () => db,
  normalizeWholeNumber: (value) => value, normalizeDateInput: (value) => value,
  resolveFiscalYearId: async () => 'fy', calculateVatAmount: () => 0,
  replaceLedgerPosting: replacePosting, postSale: () => [], accountPostingContext: () => ({}), logActivity: async () => {},
})
await updateSale({ id: 's1', billNo: '1', dateBs: '2082/04/01', partyId: 'customer-b', salesAmount: 500 })
const changedSale = sqlite.prepare('SELECT total_amount, party_id FROM sales').get()
const allocation = sqlite.prepare('SELECT amount_npr FROM receipt_allocations').get()
assert.equal(changedSale.total_amount, 500)
assert.equal(changedSale.party_id, 'customer-b')
assert.equal(allocation.amount_npr, 800)
record('Sale amount and customer edit leave previous receipt allocation intact', { sale: changedSale, allocation })
failLedger = true
await assert.rejects(updateSale({ id: 's1', billNo: '1', dateBs: '2082/04/01', partyId: 'customer-b', salesAmount: 300 }), /Injected/)
const partiallySaved = sqlite.prepare('SELECT total_amount FROM sales').get()
const remainingJournal = sqlite.prepare('SELECT COUNT(*) AS count FROM ledger_entries').get().count
assert.equal(partiallySaved.total_amount, 300)
assert.equal(remainingJournal, 0)
record('Failed sale journal replacement leaves edited sale and no journal', { sale: partiallySaved, journalRows: remainingJournal })
sqlite.close()

console.log(JSON.stringify({ reproduced: results.length, results }, null, 2))

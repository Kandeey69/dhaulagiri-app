// Read-only audit reproductions: actual source functions, isolated dependencies.
// Run from MERGED APP: node scripts/audit-workflows.mjs
// No application databases or browser storage are accessed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { spawnSync } from 'node:child_process'

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
const company = sourceModule('src/companyContext.ts', ['companyDatabaseContext', 'companyStorageKey', 'applyCompanySeed', 'getCompanyProfiles', 'saveCompanyProfiles', 'upsertCompanyProfile', 'getCompanyProfile', 'setActiveCompanyId', 'getActiveCompanyId', 'createCompanyYearId', 'mergeCompanyProfiles'])
const ledger = sourceModule('src/stock/services/stockLedger.ts', ['buildStockRows', 'buildStockRegisterRows'])
const stockDocs = sourceModule('src/stock/services/stockDocuments.ts', ['isStockDocumentEligible'])
const stockCalc = sourceModule('src/stock/services/stockCalculations.ts', ['validStockBillsForSourceDocs', 'buildSourceDocs'], stockDocs)
const carry = sourceModule('src/stock/services/stockCarryForward.ts', ['buildStockCarryForwardPlan', 'carryForwardStockOpenings', 'assessYearEndReadiness'], { ...stockDocs, ...stockCalc, ...ledger })
const fiscal = sourceModule('src/domain/fiscalYear.ts', ['createFiscalYearFromCode', 'parseFiscalYear', 'getSuccessorFiscalYear', 'validateFiscalYearTransition'])

const results = []
const record = scenario => results.push({ scenario, passed: true })
const persistence = sourceModule('src/application/persistence.ts', ['persistBusinessAction', 'flushPendingWrites', 'acknowledgeRecoveredWrites'])
const reconciliation = sourceModule('src/application/openingReconciliation.ts', ['reconcileOpening', 'assertReopenDependencies'])
const recovery = sourceModule('src/application/recovery.ts', ['runRecoverable'], persistence)
const original = company.upsertCompanyProfile({ id: 'audit-2082-83', name: 'Audit', fiscalYear: '2082/83' })
company.setActiveCompanyId(original.id)
const before = JSON.stringify(company.getCompanyProfiles())
let carryWrites = 0
let message = ''
const lock = sourceFunction('src/App.tsx', 'lockCompany', {
  ...company, ...fiscal, ...persistence, ...reconciliation,
  company: original, linkedNextCompany: null, carryForward: true, nextYear: '2082/83',
  lockPassword: 'test', YEAR_END_PASSWORD: 'test', legacyOpeningPolicy: '',
  setMessage: value => { message = value }, setIsBusy: () => {}, setLockPassword: () => {},
  onCompaniesChanged: () => {}, validateCompanyYearEnd: async () => {},
  recoverableCompanyOperation: async (_companies, work) => work(),
  carryForwardOpenings: async () => { carryWrites++; return {} },
})
await lock()
assert.match(message, /exact next/)
assert.equal(carryWrites, 0)
assert.equal(JSON.stringify(company.getCompanyProfiles()), before)
record('Self-carry rejects before any profile or opening mutation')

const item = { id: 'item', code: 'APPLE', name: 'Apple', unit: 'KG', openingQty: 10, openingRate: 100, reorderLevel: 0, isActive: true, createdAt: '' }
const purchase = { id: 'purchase', billNo: '2', dateBs: '2082/04/03', source: 'Local Purchase', items: [{ id: 'p', itemId: item.id, quantity: 10, rate: 200, amount: 2000 }] }
const sale = { id: 'sale', billNo: '1', dateBs: '2082/04/02', items: [{ id: 's', itemId: item.id, quantity: 10, rate: 150, amount: 1500 }] }
assert.equal(ledger.buildStockRows([item], [purchase], [sale])[0].closingValue, 2000)
assert.equal(ledger.buildStockRegisterRows([item], [purchase], [sale]).at(-1).balanceAmount, 2000)
record('Full depletion then purchase closes at NPR 2000 in every calculation')

const plan = carry.buildStockCarryForwardPlan({ asOnDate: '2083/03/32', sourceDocs: [], sourceFiscalYearId: 'fy', sourceStock: { items: [{ ...item, openingQty: 0, isActive: false }], purchaseBills: [], salesBills: [] }, targetItems: [{ ...item, openingQty: 10 }] })
assert.equal(plan.items[0].openingQty, 0)
record('Inactive zero item explicitly clears derived target opening')

for (const code of ['2083/99', 'nonsense']) assert.throws(() => fiscal.createFiscalYearFromCode('audit', code))
record('Malformed fiscal-year codes fail instead of falling back')

let release
const gate = new Promise(resolve => { release = resolve })
let saved = false, navigated = false
const saving = persistence.persistBusinessAction('audit', async () => { await gate; saved = true })
const leaving = persistence.flushPendingWrites().then(() => { navigated = true })
await Promise.resolve()
assert.equal(navigated, false)
release()
await Promise.all([saving, leaving])
assert.equal(saved, true)
record('Immediate navigation awaits durable business save')

let state = { accounts: ['sale'], purchase: ['payment'] }, journal = null
const snapshot = structuredClone(state)
await assert.rejects(recovery.runRecoverable(snapshot, async () => { state.accounts = []; throw new Error('Injected') }, async original => { state = original }, { read: async () => journal, write: async value => { journal = value } }), /restored/)
assert.deepEqual(state, snapshot)
assert.equal(journal, null)
record('Second-store deletion failure restores all original data')

company.applyCompanySeed(JSON.stringify([original]), () => {})
company.saveCompanyProfiles([])
company.applyCompanySeed(JSON.stringify([original]), () => { throw new Error('Settings must not be reapplied') })
assert.equal(company.getCompanyProfiles().length, 0)
record('Seed deletion survives repeated startup')

company.upsertCompanyProfile(original)
const target = company.upsertCompanyProfile({ id: 'audit-2083-84', name: 'Audit', fiscalYear: '2083/84' })
company.setActiveCompanyId(original.id)
let continueRefresh
const paused = new Promise(resolve => { continueRefresh = resolve })
const withContext = sourceFunction('src/App.tsx', 'withCompanyContext', company)
const refresh = withContext(target.id, async context => { assert.equal(context.companyId, target.id); await paused })
assert.equal(company.getActiveCompanyId(), original.id)
company.setActiveCompanyId(target.id)
continueRefresh()
await refresh
assert.equal(company.getActiveCompanyId(), target.id)
record('Paused background work neither changes nor restores visible company selection')

let writes = 0
await assert.rejects(carry.carryForwardStockOpenings({
  asOnDate: '2083/03/32', sourceFiscalYearId: 'fy',
  sourceDocs: [{ documentId: 'missing', type: 'Sale', fiscalYearId: 'fy', lifecycleStatus: 'POSTED', amount: 500, grandTotal: 500, vatAmount: 0, date: '2082/04/02' }],
  sourceStock: { items: [item], purchaseBills: [], salesBills: [] },
  targetStock: { items: [], purchaseBills: [], salesBills: [] },
  writeOpenings: async () => { writes++; return { created: 1, updated: 0 } },
}), /not ready/)
assert.equal(writes, 0)
record('Missing stock lines block year end before writes')

assert.equal(reconciliation.reconcileOpening(120, 200, { derived: 100, override: false }).value, 120)
record('Manual target opening remains independent of recalculated source')

let localFallbacks = 0
const failedRepository = sourceFunction('src/purchase/repository.ts', 'createDataRepository', {
  isTauriRuntime: () => true,
  createSqliteRepository: async () => { throw new Error('Injected SQLite initialization failure') },
  createLocalRepository: () => { localFallbacks++; return {} },
})
await assert.rejects(failedRepository({ companyId: 'isolated' }), /database unavailable/)
assert.equal(localFallbacks, 0)
record('Desktop SQLite initialization failure never opens browser fallback')

const suite = spawnSync(process.execPath, ['scripts/run-tests.mjs'], { cwd: root, encoding: 'utf8' })
assert.equal(suite.status, 0, suite.stdout + suite.stderr)
assert.match(suite.stdout, /real SQLite: durable saves/)
record('In-memory SQLite sale amount and party changes enforce existing allocations')
record('In-memory SQLite journal and restore failures roll back; backup lifecycle and journals round-trip')

const partySync = sourceModule('src/application/carryForwardPartySync.ts', ['deletedPartyIdsFromCarryForwardSourceLogs', 'removableDeletedCarryForwardPartyIds'])
const domain = sourceModule('src/purchase/domain.ts', ['normalizeFreightIndiaStatus'])
const payable = sourceModule('src/application/purchaseCarryForward.ts', ['purchaseClosingParties'], domain)
const accounts = new Map(), purchases = new Map(), stocks = new Map()
company.saveCompanyProfiles([])
const chain = ['2082/83', '2083/84', '2084/85'].map((fiscalYear, i) => company.upsertCompanyProfile({ id: 'chain-' + i, name: 'Chain', fiscalYear, companyGroupId: 'chain' }))
for (const year of chain) {
  accounts.set(year.id, { parties: [], sales: [], collections: [], creditNotes: [], activityLogs: [] })
  purchases.set(year.id, { settings: { companyName: year.name, fiscalYear: year.fiscalYear }, parties: [], purchases: [], payments: [], localExpenses: [], ledgerEntries: [], activityLogs: [] })
  stocks.set(year.id, { items: [], purchaseBills: [], salesBills: [] })
}
const buyer = { id: 'buyer', name: 'Buyer', openingBalance: 100, isActive: true }
const vendor = { id: 'vendor', name: 'Vendor', openingPayable: 100, isActive: true }
accounts.get(chain[0].id).parties.push(buyer)
purchases.get(chain[0].id).parties.push(vendor)
stocks.get(chain[0].id).items.push(structuredClone(item))
function addActivity(year, saleQty, salePrice, purchaseQty, purchasePrice, payment) {
  const id = year.id, code = year.fiscalYear.slice(0, 4), fy = fiscal.createFiscalYearFromCode(id, year.fiscalYear).id
  const saleId = id + '-sale', purchaseId = id + '-local'
  accounts.get(id).sales.push({ id: saleId, fiscalYearId: fy, lifecycleStatus: 'POSTED', dateBs: code + '/04/02', billNo: '1', partyId: 'buyer', salesAmount: saleQty * salePrice, vatAmount: 0, totalAmount: saleQty * salePrice })
  accounts.get(id).collections.push({ id: id + '-receipt', partyId: 'buyer', amount: payment })
  purchases.get(id).localExpenses.push({ id: purchaseId, fiscalYearId: fy, lifecycleStatus: 'POSTED', partyId: 'vendor', billNumber: '2', billDate: code + '/04/03', expenseType: 'Stock', expenseHead: 'Stock', amountBeforeVatNPR: purchaseQty * purchasePrice, vatNPR: 0, totalAmountNPR: purchaseQty * purchasePrice })
  purchases.get(id).payments.push({ id: id + '-payment', fiscalYearId: fy, partyId: 'vendor', amountNPR: payment })
  stocks.get(id).salesBills.push({ ...sale, id: saleId, customerName: 'Buyer', dateBs: code + '/04/02', items: [{ ...sale.items[0], itemId: stocks.get(id).items[0].id, quantity: saleQty, rate: salePrice, amount: saleQty * salePrice }] })
  stocks.get(id).purchaseBills.push({ ...purchase, id: purchaseId, supplierName: 'Vendor', sourceType: 'Local Purchase', dateBs: code + '/04/03', items: [{ ...purchase.items[0], itemId: stocks.get(id).items[0].id, quantity: purchaseQty, rate: purchasePrice, amount: purchaseQty * purchasePrice }] })
}
addActivity(chain[0], 10, 150, 10, 200, 300)
const orchestration = sourceFunction('src/App.tsx', 'carryForwardOpenings', {
  ...company, ...fiscal, ...reconciliation, ...partySync, ...payable, ...stockCalc, ...carry,
  getAccountsBackupData: async context => structuredClone(accounts.get(context.companyId)),
  getAccountOutstanding: async context => {
    const data = accounts.get(context.companyId)
    return data.parties.map(party => ({ partyId: party.id, outstanding: party.openingBalance + data.sales.filter(row => row.partyId === party.id).reduce((sum, row) => sum + row.totalAmount, 0) - data.collections.filter(row => row.partyId === party.id).reduce((sum, row) => sum + row.amount, 0) }))
  },
  createDataRepository: async context => ({ loadData: async () => structuredClone(purchases.get(context.companyId)), saveData: async value => purchases.set(context.companyId, structuredClone(value)) }),
  isInventoryTrackingEnabledForCompany: () => true,
  getStockBackupDataForCompany: async id => structuredClone(stocks.get(id)),
  purchaseReferencedPartyIds: sourceFunction('src/App.tsx', 'purchaseReferencedPartyIds'),
  writeSuiteSettings: () => {}, writeInventoryTrackingSettingForCompany: () => {},
  upsertPartiesForCarryForward: async (parties, _options, context) => {
    const data = accounts.get(context.companyId)
    for (const party of parties) {
      const existing = data.parties.find(row => row.id === party.id)
      if (existing) existing.openingBalance = party.openingBalance
      else data.parties.push(structuredClone(party))
    }
    return { upserted: parties.length, removed: 0, skippedRemoval: 0 }
  },
  upsertStockOpeningItemsForCompany: async (id, items) => {
    const data = stocks.get(id)
    let created = 0, updated = 0
    for (const item of items) {
      const old = data.items.find(row => row.code === item.code)
      if (old) { Object.assign(old, item); updated++ }
      else { data.items.push({ ...item, id: id + '-' + item.code }); created++ }
    }
    return { created, updated }
  },
})
company.setActiveCompanyId(chain[0].id)
await orchestration(chain[0], chain[1])
assert.equal(stocks.get(chain[1].id).items[0].openingQty * stocks.get(chain[1].id).items[0].openingRate, 2000)
assert.equal(purchases.get(chain[1].id).parties[0].openingPayable, 1800)
assert.equal(accounts.get(chain[1].id).parties[0].openingBalance, 1300)
chain[0] = company.upsertCompanyProfile({ ...chain[0], nextCompanyId: chain[1].id, isLocked: true })
chain[1] = company.upsertCompanyProfile({ ...chain[1], previousCompanyId: chain[0].id })
addActivity(chain[1], 2, 300, 2, 400, 100)
await orchestration(chain[1], chain[2])
assert.equal(stocks.get(chain[2].id).items[0].openingQty * stocks.get(chain[2].id).items[0].openingRate, 2400)
assert.equal(purchases.get(chain[2].id).parties[0].openingPayable, 2500)
assert.equal(accounts.get(chain[2].id).parties[0].openingBalance, 1800)
chain[1] = company.upsertCompanyProfile({ ...chain[1], nextCompanyId: chain[2].id, isLocked: true })
assert.throws(() => reconciliation.assertReopenDependencies(chain[0].id, company.getCompanyProfiles()), /newest to oldest/)
chain[1] = company.upsertCompanyProfile({ ...chain[1], isLocked: false })
chain[0] = company.upsertCompanyProfile({ ...chain[0], isLocked: false })
accounts.get(chain[1].id).parties[0].openingBalance = 999
accounts.get(chain[1].id).parties[0].name = 'Renamed target buyer'
accounts.set(chain[0].id, { parties: [], sales: [], collections: [], creditNotes: [], activityLogs: [] })
purchases.set(chain[0].id, { ...purchases.get(chain[0].id), parties: [], purchases: [], payments: [], localExpenses: [] })
stocks.set(chain[0].id, { items: [], purchaseBills: [], salesBills: [] })
await orchestration(chain[0], chain[1])
assert.equal(accounts.get(chain[1].id).parties[0].openingBalance, 999)
assert.equal(accounts.get(chain[1].id).parties[0].name, 'Renamed target buyer')
assert.equal(accounts.get(chain[1].id).sales.length, 1)
assert.equal(purchases.get(chain[1].id).parties[0].openingPayable, 0)
assert.equal(purchases.get(chain[1].id).localExpenses.length, 1)
assert.equal(stocks.get(chain[1].id).items[0].openingQty, 0)
assert.equal(stocks.get(chain[1].id).salesBills.length, 1)
assert.equal(company.getActiveCompanyId(), chain[0].id)
record('Actual carry orchestration across three years: receivables, payables, moving inventory, dependency guards, deleted sources and protected target activity')

let closeMessage = ''
const closeActualYear = sourceFunction('src/App.tsx', 'lockCompany', {
  ...company, ...fiscal, ...persistence, ...reconciliation,
  company: chain[0], linkedNextCompany: chain[1], carryForward: true, nextYear: chain[1].fiscalYear,
  lockPassword: 'test', YEAR_END_PASSWORD: 'test', legacyOpeningPolicy: '',
  setMessage: value => { closeMessage = value }, setIsBusy: () => {}, setLockPassword: () => {}, onCompaniesChanged: () => {},
  validateCompanyYearEnd: async () => {}, setStoredFiscalYearStatus: async (_company, status) => { assert.equal(status, 'CLOSED') },
  recoverableCompanyOperation: async (_companies, work) => work(), carryForwardOpenings: orchestration,
})
await closeActualYear()
assert.equal(company.getCompanyProfile(chain[0].id).isLocked, true, closeMessage)
assert.equal(company.getCompanyProfile(chain[0].id).nextCompanyId, chain[1].id)
assert.equal(company.getCompanyProfile(chain[1].id).isLocked, false)
record('Successful close keeps the source locked after writing its successor link')

chain[0] = company.upsertCompanyProfile({ ...chain[0], isLocked: false })
accounts.get(chain[0].id).parties = [structuredClone(buyer)]
purchases.get(chain[0].id).parties = [structuredClone(vendor)]
stocks.get(chain[0].id).items = [structuredClone(item)]
addActivity(chain[0], 10, 150, 10, 200, 300)
const legacyKey = company.companyStorageKey('suite-opening-provenance', chain[1].id)
localStorage.removeItem(legacyKey)
stocks.get(chain[1].id).items[0].openingQty = 10
stocks.get(chain[1].id).items[0].openingRate = 150
const untouched = JSON.stringify([accounts.get(chain[1].id), purchases.get(chain[1].id), stocks.get(chain[1].id)])
await assert.rejects(orchestration(chain[0], chain[1]), /existing openings without carry history/)
assert.equal(JSON.stringify([accounts.get(chain[1].id), purchases.get(chain[1].id), stocks.get(chain[1].id)]), untouched)
await orchestration(chain[0], chain[1], 'derived')
assert.equal(stocks.get(chain[1].id).items[0].openingQty * stocks.get(chain[1].id).items[0].openingRate, 2000)
localStorage.removeItem(legacyKey)
stocks.get(chain[1].id).items[0].openingRate = 150
const manualResult = await orchestration(chain[0], chain[1], 'manual')
assert.equal(stocks.get(chain[1].id).items[0].openingQty * stocks.get(chain[1].id).items[0].openingRate, 1500)
assert.ok(manualResult.manualOverrides > 0)
record('Legacy opening ownership requires an explicit decision: repair NPR 1500 to 2000, or preserve a confirmed manual figure')
console.log(JSON.stringify({ accepted: results.length, results }, null, 2))

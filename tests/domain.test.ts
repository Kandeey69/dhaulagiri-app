import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFiscalYearFromCode,
  ensureFiscalYearEditable,
  findFiscalYearByBsDate,
  getOrCreateMigrationFiscalYear,
  isBsDateInFiscalYear,
  normalizeBsDate,
  validateDateInFiscalYear,
} from '../src/domain/fiscalYear.ts'
import {
  LEGACY_STOCK_DATABASE_URL,
  getActiveStockDatabaseUrl,
  getStockDatabaseUrlForCompanyId,
  setActiveCompanyId,
} from '../src/companyContext.ts'
import {
  createSequentialAllocations,
  targetOutstandingBalance,
  unallocatedPaymentBalance,
  validateAllocations,
} from '../src/domain/allocations.ts'
import {
  createPurchaseCalculationPolicy,
  freightTreatmentForStatus,
} from '../src/domain/accountingPolicy.ts'
import { detectDuplicateSupplierBill } from '../src/domain/validation.ts'
import { calculatePurchaseComputedTotals } from '../src/purchase/calculations.ts'
import {
  assertNoDuplicatePosting,
  ledgerPartyBalance,
  postCustomerReceipt,
  postPurchase,
  postSale,
  postSupplierPayment,
  reverseLedgerEntries,
} from '../src/domain/ledger.ts'
import {
  canModifyFinancialFields,
  transitionFiscalYearStatus,
  validateTransactionTransition,
} from '../src/domain/lifecycle.ts'
import {
  reconcileAllocationBalance,
  reconcileLedgerBalance,
  reconcilePostingBatches,
  reconcileReversal,
} from '../src/domain/reconciliation.ts'
import {
  allocationDraftTotals,
  autoAllocateOldestFirst,
  buildPaymentAllocationRows,
  validatePaymentAllocationDraft,
} from '../src/application/paymentAllocationUi.ts'
import { createDraftKey, createDraftSnapshot, shouldRestoreDraft } from '../src/application/draftAutosave.ts'
import { filterByFiscalYear, reportMovementTotals, textMatchesSearch } from '../src/application/reportFilters.ts'
import { validatePurchaseFormForUi } from '../src/application/purchaseFormValidation.ts'
import { availableTransactionActions, transactionActionLabels } from '../src/application/transactionActions.ts'
import {
  inventoryTrackingLegacyMigrationKey,
  inventoryTrackingStorageKey,
  isInventoryTrackingEnabled,
  TRACK_INVENTORY_KEY,
  writeInventoryTrackingSetting,
} from '../src/stock/settings.ts'
import {
  buildStockRegisterRows,
  buildStockRows,
} from '../src/stock/services/stockLedger.ts'
import {
  billEntryTotal,
  buildSourceDocs,
  buildStatuses,
  formatRate,
  linesForDoc,
  validStockBillsForSourceDocs,
} from '../src/stock/services/stockCalculations.ts'
import {
  buildStockCarryForwardPlan,
} from '../src/stock/services/stockCarryForward.ts'
import {
  buildStockEntryTarget,
  isStockDocumentEligible,
} from '../src/stock/services/stockDocuments.ts'
import {
  prepareStockPurchaseLinesForDocument,
} from '../src/stock/services/stockLandedCost.ts'
import {
  runStockDbTransaction,
} from '../src/stock/services/stockTransactions.ts'

const fiscalYear = createFiscalYearFromCode('company-a', '2083/84')

function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })

  return localStorage
}

test('normalizes and resolves BS fiscal-year dates without arbitrary ranges', () => {
  assert.equal(normalizeBsDate('2083-4-2'), '2083/04/02')
  assert.equal(isBsDateInFiscalYear('2083/04/01', fiscalYear), true)
  assert.equal(isBsDateInFiscalYear('2084/03/32', fiscalYear), true)
  assert.equal(isBsDateInFiscalYear('2084/04/01', fiscalYear), false)
  assert.equal(findFiscalYearByBsDate('2083-05-03', [fiscalYear])?.id, fiscalYear.id)
  assert.equal(validateDateInFiscalYear('2082/12/30', fiscalYear).valid, false)

  const fy2082 = createFiscalYearFromCode('company-a', '2082/83')
  assert.equal(fy2082.startBs, '2082/04/01')
  assert.equal(fy2082.endBs, '2083/03/32')
  assert.equal(isBsDateInFiscalYear('2082/04/01', fy2082), true)
  assert.equal(isBsDateInFiscalYear('2083/03/32', fy2082), true)
  assert.equal(isBsDateInFiscalYear('2082/03/32', fy2082), false)
  assert.equal(isBsDateInFiscalYear('2083/04/01', fy2082), false)
})

test('prevents edits to closed fiscal years', () => {
  const closed = { ...fiscalYear, status: 'CLOSED' as const }
  assert.throws(() => ensureFiscalYearEditable(closed), /closed/)
})

test('creates a deterministic legacy migration fiscal year', () => {
  const migrated = getOrCreateMigrationFiscalYear('legacy-company', [], '2082/83')
  assert.equal(migrated.id, 'legacy-company-2082-83')
  assert.equal(migrated.startBs, '2082/04/01')
  assert.equal(migrated.endBs, '2083/03/32')
})

test('supports partial and multiple payment allocations', () => {
  const allocations = createSequentialAllocations({
    idFactory: () => `a-${Math.random()}`,
    sourceId: 'payment-1',
    sourceAmountNPR: 700,
    targetType: 'PURCHASE',
    targets: [
      { id: 'bill-1', totalNPR: 500 },
      { id: 'bill-2', totalNPR: 500 },
    ],
    timestamp: '2026-01-01T00:00:00.000Z',
  })

  assert.equal(allocations.length, 2)
  assert.equal(allocations[0].amountNPR, 500)
  assert.equal(allocations[1].amountNPR, 200)
  assert.equal(unallocatedPaymentBalance(700, allocations), 0)
  assert.equal(targetOutstandingBalance(500, [allocations[1]]), 300)
})

test('rejects over-allocation against source payment and target balance', () => {
  const sourceValidation = validateAllocations({
    sourceAmountNPR: 500,
    allocations: [
      {
        id: 'allocation-1',
        sourceId: 'payment-1',
        targetId: 'bill-1',
        targetType: 'PURCHASE',
        amountNPR: 700,
        createdAt: '',
        updatedAt: '',
      },
    ],
    targets: [{ id: 'bill-1', totalNPR: 1000 }],
  })
  assert.equal(sourceValidation.valid, false)

  const targetValidation = validateAllocations({
    sourceAmountNPR: 500,
    allocations: [
      {
        id: 'allocation-2',
        sourceId: 'payment-2',
        targetId: 'bill-1',
        targetType: 'PURCHASE',
        amountNPR: 200,
        createdAt: '',
        updatedAt: '',
      },
    ],
    targets: [{ id: 'bill-1', totalNPR: 500 }],
    existingAllocations: [
      {
        id: 'allocation-existing',
        sourceId: 'payment-1',
        targetId: 'bill-1',
        targetType: 'PURCHASE',
        amountNPR: 400,
        createdAt: '',
        updatedAt: '',
      },
    ],
  })
  assert.equal(targetValidation.valid, false)
})

test('detects duplicate supplier bill inside a fiscal year only', () => {
  const duplicate = detectDuplicateSupplierBill({
    purchases: [
      { id: 'purchase-1', vendorPartyId: 'supplier-1', vendorBillNumber: 'A-1', fiscalYearId: 'fy-1' },
    ],
    vendorPartyId: 'supplier-1',
    vendorBillNumber: 'a-1',
    fiscalYearId: 'fy-1',
  })
  assert.equal(duplicate.valid, false)

  const nextYear = detectDuplicateSupplierBill({
    purchases: [
      { id: 'purchase-1', vendorPartyId: 'supplier-1', vendorBillNumber: 'A-1', fiscalYearId: 'fy-1' },
    ],
    vendorPartyId: 'supplier-1',
    vendorBillNumber: 'A-1',
    fiscalYearId: 'fy-2',
  })
  assert.equal(nextYear.valid, true)
})

test('applies VAT policy without mutating historical totals', () => {
  const policy13 = createPurchaseCalculationPolicy({ agentServiceVatRate: 13, defaultExchangeRate: 1.6015 })
  const policy10 = createPurchaseCalculationPolicy({ agentServiceVatRate: 10, defaultExchangeRate: 1.6015 })
  const input = {
    amountIC: 100,
    supplierExchangeRate: 1.6015,
    importDutyNPR: 0,
    customServiceNPR: 0,
    importVatNPR: 0,
    terminalChargeWithoutVatNPR: 1000,
    freightIndiaStatus: 'Paid by custom agent' as const,
    freightIndiaAmountIC: 0,
    freightIndiaExchangeRate: 1.6015,
    totalKg: 0,
    loadingUnloadingChargePerKg: 0,
    otherChargesNPR: 0,
    agentServiceAmountBeforeVatNPR: 1000,
  }

  assert.equal(calculatePurchaseComputedTotals(input, policy13).totalInputVatNPR, 260)
  assert.equal(calculatePurchaseComputedTotals(input, policy10).totalInputVatNPR, 200)
})

test('adds loading and unloading charge to purchase landed cost', () => {
  const policy = createPurchaseCalculationPolicy({ agentServiceVatRate: 13, defaultExchangeRate: 1.6015 })
  const totals = calculatePurchaseComputedTotals({
    amountIC: 100,
    supplierExchangeRate: 1.6015,
    importDutyNPR: 10,
    customServiceNPR: 5,
    importVatNPR: 0,
    terminalChargeWithoutVatNPR: 20,
    freightIndiaStatus: 'Paid by custom agent',
    freightIndiaAmountIC: 0,
    freightIndiaExchangeRate: 1.6015,
    totalKg: 250,
    loadingUnloadingChargePerKg: 2.5,
    otherChargesNPR: 0,
    agentServiceAmountBeforeVatNPR: 0,
  }, policy)

  assert.equal(totals.loadingUnloadingChargeNPR, 625)
  assert.equal(totals.landedCostNPR, 820.15)
})

test('centralizes freight treatment rules', () => {
  assert.equal(freightTreatmentForStatus('Paid by custom agent').createsCustomAgentPayable, true)
  assert.equal(freightTreatmentForStatus('Paid by custom agent').createsTransporterPayable, false)
  assert.equal(freightTreatmentForStatus('To be paid by us').createsCustomAgentPayable, false)
  assert.equal(freightTreatmentForStatus('To be paid by us').createsTransporterPayable, true)
})

test('simulates atomic rollback for multi-record writes', async () => {
  const writes: string[] = []
  async function transaction() {
    const before = [...writes]
    try {
      writes.push('payment')
      writes.push('allocation')
      throw new Error('activity log failed')
    } catch (error) {
      writes.length = 0
      writes.push(...before)
      throw error
    }
  }

  await assert.rejects(transaction, /activity log failed/)
  assert.deepEqual(writes, [])
})

test('validates transaction lifecycle transitions', () => {
  assert.equal(validateTransactionTransition('DRAFT', 'POSTED', fiscalYear).valid, true)
  assert.equal(validateTransactionTransition('DRAFT', 'VOID', fiscalYear).valid, true)
  assert.equal(validateTransactionTransition('POSTED', 'REVERSED', fiscalYear).valid, true)
  assert.equal(validateTransactionTransition('POSTED', 'VOID', fiscalYear).valid, false)
  assert.equal(validateTransactionTransition('REVERSED', 'POSTED', fiscalYear).valid, false)
})

test('blocks financial edits in posted and closed years', () => {
  assert.equal(canModifyFinancialFields('DRAFT', fiscalYear), true)
  assert.equal(canModifyFinancialFields('POSTED', fiscalYear), false)
  assert.equal(canModifyFinancialFields('DRAFT', { ...fiscalYear, status: 'CLOSED' }), false)
})

test('posts balanced purchase, sales, supplier payment, and customer receipt batches', () => {
  const context = {
    companyId: 'company-a',
    fiscalYearId: fiscalYear.id,
    fiscalYear,
    idFactory: (() => {
      let counter = 0
      return () => `id-${counter += 1}`
    })(),
    timestamp: '2026-01-01T00:00:00.000Z',
    userName: 'Master',
  }
  const purchaseEntries = postPurchase({
    id: 'purchase-1',
    lifecycleStatus: 'DRAFT',
    fiscalYearId: fiscalYear.id,
    date: '2083/04/02',
    vendorPartyId: 'supplier-1',
    customAgentPartyId: 'agent-1',
    freightIndiaPartyId: 'transport-1',
    freightIndiaStatus: 'To be paid by us',
    supplierAmountNPR: 160.15,
    totalAgentPayableNPR: 113,
    freightIndiaAmountNPR: 50,
    landedCostNPR: 210.15,
    totalInputVatNPR: 113,
    reference: 'PI-1',
  }, context)
  assert.deepEqual(reconcileLedgerBalance(purchaseEntries), [])

  const saleEntries = postSale({
    id: 'sale-1',
    lifecycleStatus: 'DRAFT',
    fiscalYearId: fiscalYear.id,
    date: '2083/04/03',
    partyId: 'customer-1',
    salesAmount: 1000,
    vatAmount: 130,
    totalAmount: 1130,
    reference: '1',
  }, context)
  assert.deepEqual(reconcileLedgerBalance(saleEntries), [])

  const paymentEntries = postSupplierPayment({
    id: 'payment-1',
    lifecycleStatus: 'DRAFT',
    fiscalYearId: fiscalYear.id,
    date: '2083/04/04',
    partyId: 'supplier-1',
    paymentType: 'Indian Supplier Payment',
    amountNPR: 160.15,
    reference: 'PAY-1',
  }, context)
  assert.deepEqual(reconcileLedgerBalance(paymentEntries), [])

  const receiptEntries = postCustomerReceipt({
    id: 'receipt-1',
    lifecycleStatus: 'DRAFT',
    fiscalYearId: fiscalYear.id,
    date: '2083/04/05',
    partyId: 'customer-1',
    amountNPR: 1130,
    reference: 'R-1',
  }, context)
  assert.deepEqual(reconcileLedgerBalance(receiptEntries), [])
  assert.equal(ledgerPartyBalance([...saleEntries, ...receiptEntries], 'customer-1'), 0)
})

test('enforces posting idempotency', () => {
  const existing = [{
    id: 'entry-1',
    batchId: 'batch-1',
    companyId: 'company-a',
    fiscalYearId: fiscalYear.id,
    transactionDate: '2083/04/02',
    accountCode: '1100' as const,
    sourceType: 'SALE' as const,
    sourceId: 'sale-1',
    postingVersion: 'v1',
    debit: 1130,
    credit: 0,
    narration: '',
    status: 'ACTIVE' as const,
    createdAt: '',
    updatedAt: '',
  }]

  assert.throws(() => assertNoDuplicatePosting(existing, 'SALE', 'sale-1', 'v1'), /already has/)
})

test('generates linked reversal entries and rejects duplicate reversal', () => {
  const context = {
    companyId: 'company-a',
    fiscalYearId: fiscalYear.id,
    fiscalYear,
    idFactory: (() => {
      let counter = 100
      return () => `rid-${counter += 1}`
    })(),
    timestamp: '2026-01-02T00:00:00.000Z',
    userName: 'Master',
  }
  const original = postSale({
    id: 'sale-rev',
    lifecycleStatus: 'DRAFT',
    fiscalYearId: fiscalYear.id,
    date: '2083/04/03',
    partyId: 'customer-1',
    salesAmount: 1000,
    vatAmount: 130,
    totalAmount: 1130,
    reference: '2',
  }, context)
  const reversal = reverseLedgerEntries({
    originalEntries: original,
    context,
    sourceId: 'sale-rev',
    sourceType: 'SALE',
    reason: 'Correction',
  })

  assert.deepEqual(reconcileLedgerBalance(reversal.reversalEntries), [])
  assert.deepEqual(reconcileReversal({
    sourceEntries: reversal.originalEntries,
    reversalEntries: reversal.reversalEntries,
    sourceId: 'sale-rev',
  }), [])
  assert.throws(() => reverseLedgerEntries({
    originalEntries: reversal.originalEntries,
    context,
    sourceId: 'sale-rev',
    sourceType: 'SALE',
    reason: 'Duplicate',
  }), /active posted/)
})

test('enforces fiscal-year state transitions and closed-year posting restrictions', () => {
  const closedTransition = transitionFiscalYearStatus({
    fiscalYear,
    newStatus: 'SOFT_CLOSED',
    reason: 'Review complete',
    userName: 'Master',
    timestamp: '2026-01-01T00:00:00.000Z',
  })

  assert.equal(closedTransition.fiscalYear.status, 'SOFT_CLOSED')
  assert.equal(validateTransactionTransition('DRAFT', 'POSTED', closedTransition.fiscalYear).valid, false)
  assert.throws(() => transitionFiscalYearStatus({
    fiscalYear: { ...fiscalYear, status: 'CLOSED' },
    newStatus: 'OPEN',
    reason: 'Unauthorized reopen',
    userName: 'Master',
    timestamp: '2026-01-01T00:00:00.000Z',
  }), /cannot move/)
})

test('runs reconciliation checks for allocation and posting batches', () => {
  assert.equal(reconcileAllocationBalance({
    sourceId: 'payment-1',
    sourceAmountNPR: 100,
    sourceLabel: 'Payment',
    allocations: [{ amountNPR: 110 }],
  }).length, 1)

  assert.equal(reconcilePostingBatches({
    entries: [],
    sourceType: 'SALE',
    sourceId: 'missing',
  }).length, 1)
})

test('filters reports and transactions by selected fiscal year context', () => {
  const rows = [
    { id: 'purchase-1', fiscalYearId: 'fy-1', amount: 100 },
    { id: 'purchase-2', fiscalYearId: 'fy-2', amount: 250 },
  ]

  assert.deepEqual(filterByFiscalYear(rows, 'fy-1').map((row) => row.id), ['purchase-1'])
  assert.equal(textMatchesSearch(['Bill 22', 'Aarati Paints'], 'aarati'), true)
  assert.deepEqual(reportMovementTotals([{ debit: 100 }, { credit: 40 }, { amount: 12 }]), {
    debit: 100,
    credit: 40,
    amount: 12,
  })
})

test('returns status-aware transaction actions for open and closed years', () => {
  assert.deepEqual(
    transactionActionLabels(
      availableTransactionActions({
        status: 'DRAFT',
        fiscalYearStatus: 'OPEN',
        canEditDraft: true,
        canDeleteDraft: true,
        canReversePosted: true,
      }),
    ),
    ['View', 'Edit', 'Delete', 'Post'],
  )
  assert.deepEqual(
    transactionActionLabels(
      availableTransactionActions({
        status: 'POSTED',
        fiscalYearStatus: 'CLOSED',
        canEditDraft: true,
        canDeleteDraft: true,
        canReversePosted: true,
      }),
    ),
    ['View', 'Print'],
  )
  assert.equal(
    buildStockEntryTarget({
      companyId: 'company-a',
      documentId: 'sale-closed',
      fiscalYearId: fiscalYear.id,
      readOnly: true,
      type: 'Sale',
    }).readOnly,
    true,
  )
})

test('validates purchase form with inline-ready errors and duplicate-bill warning', () => {
  const purchase = {
    id: '',
    fiscalYearId: fiscalYear.id,
    lifecycleStatus: 'DRAFT',
    vendorPartyId: 'supplier-1',
    vendorBillNumber: 'PI-1',
    billDate: '2026-08-01',
    supplierCurrency: 'INR',
    amountIC: 100,
    supplierExchangeRate: 1.6015,
    supplierAmountNPR: 0,
    customAgentPartyId: '',
    debitNoteNumber: '',
    debitNoteDate: '2083/04/02',
    importDutyNPR: 0,
    customServiceNPR: 0,
    importVatNPR: 0,
    terminalChargeWithoutVatNPR: 0,
    terminalVatNPR: 0,
    totalTerminalChargeNPR: 0,
    freightIndiaStatus: 'To be paid by us',
    freightIndiaPartyId: '',
    freightIndiaAmountIC: 0,
    freightIndiaExchangeRate: 1.6015,
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
    appliedVatRate: 13,
    appliedExchangeRate: 1.6015,
    calculationVersion: 'purchase-policy-v1',
    calculatedAt: '',
    postedAt: '',
    postedBy: '',
    voidedAt: '',
    reversedAt: '',
    reversalReason: '',
    replacementTransactionId: '',
    remarks: '',
    createdAt: '',
    updatedAt: '',
  } as const
  const result = validatePurchaseFormForUi({
    purchase,
    fiscalYear,
    vendorCategory: 'Indian Suppliers',
    vatRatePercent: 13,
    existingPurchases: [
      {
        ...purchase,
        id: 'purchase-existing',
        lifecycleStatus: 'POSTED',
        vendorBillNumber: 'pi-1',
      },
    ],
  })

  assert.equal(result.errors.some((error) => error.field === 'freightIndiaPartyId'), true)
  assert.equal(result.warnings.some((warning) => warning.field === 'vendorBillNumber'), true)
})

test('builds payment allocation rows, auto allocates oldest, and rejects over-allocation', () => {
  const rows = buildPaymentAllocationRows({
    bills: [
      {
        id: 'bill-new',
        fiscalYearId: fiscalYear.id,
        vendorPartyId: 'supplier-1',
        vendorBillNumber: '2',
        billDate: '2083/04/05',
        supplierAmountNPR: 500,
      },
      {
        id: 'bill-old',
        fiscalYearId: fiscalYear.id,
        vendorPartyId: 'supplier-1',
        vendorBillNumber: '1',
        billDate: '2083/04/01',
        supplierAmountNPR: 500,
      },
    ],
    allocations: [
      {
        id: 'allocation-existing',
        paymentId: 'payment-existing',
        purchaseId: 'bill-old',
        amountNPR: 200,
        createdAt: '',
        updatedAt: '',
      },
    ],
    partyId: 'supplier-1',
    fiscalYearId: fiscalYear.id,
    draftAllocations: {},
  })
  assert.deepEqual(rows.map((row) => row.billNumber), ['1', '2'])

  const draft = autoAllocateOldestFirst(rows, 450)
  assert.equal(draft['bill-old'], 300)
  assert.equal(draft['bill-new'], 150)

  const rowsWithDraft = rows.map((row) => ({
    ...row,
    allocationNPR: row.purchaseId === 'bill-old' ? 400 : 0,
  }))
  assert.equal(allocationDraftTotals(rowsWithDraft, 350).unallocatedNPR, -50)
  assert.equal(
    validatePaymentAllocationDraft({
      paymentId: 'payment-new',
      paymentAmountNPR: 350,
      rows: rowsWithDraft,
      existingAllocations: [],
    }).valid,
    false,
  )
})

test('creates and restores compatible draft autosave snapshots only', () => {
  const key = createDraftKey(['purchase-entry', 'company a', fiscalYear.id, 'Master'])
  const snapshot = createDraftSnapshot(key, 'purchase-v1', { vendorBillNumber: 'PI-9' })

  assert.equal(key, 'purchase-entry:company-a:company-a-2083-84:Master')
  assert.equal(snapshot.value.vendorBillNumber, 'PI-9')
  assert.equal(shouldRestoreDraft(snapshot.version, 'purchase-v1'), true)
  assert.equal(shouldRestoreDraft(snapshot.version, 'purchase-v2'), false)
})

test('resolves stock database URLs per active company without filename collisions', () => {
  const storage = installLocalStorage()

  assert.equal(getStockDatabaseUrlForCompanyId(''), LEGACY_STOCK_DATABASE_URL)
  assert.equal(getStockDatabaseUrlForCompanyId('default'), LEGACY_STOCK_DATABASE_URL)
  assert.match(getStockDatabaseUrlForCompanyId('company-a'), /^sqlite:inventorytracked-stock-[0-9a-f-]+\.db$/)
  assert.notEqual(getStockDatabaseUrlForCompanyId('A B'), getStockDatabaseUrlForCompanyId('A-B'))
  assert.notEqual(getStockDatabaseUrlForCompanyId('Company'), getStockDatabaseUrlForCompanyId('company'))

  setActiveCompanyId('company-a')
  const companyAUrl = getActiveStockDatabaseUrl()
  setActiveCompanyId('company-b')
  const companyBUrl = getActiveStockDatabaseUrl()
  assert.notEqual(companyAUrl, companyBUrl)
  assert.equal(storage.getItem('suite-active-company-id'), 'company-b')
})

test('keeps inventory tracking setting scoped by company', () => {
  installLocalStorage()

  setActiveCompanyId('company-a')
  writeInventoryTrackingSetting(true)
  assert.equal(isInventoryTrackingEnabled(), true)
  assert.equal(localStorage.getItem(inventoryTrackingStorageKey('company-a')), 'yes')

  setActiveCompanyId('company-b')
  assert.equal(isInventoryTrackingEnabled(), false)
  writeInventoryTrackingSetting(false)
  assert.equal(localStorage.getItem(inventoryTrackingStorageKey('company-b')), 'no')

  setActiveCompanyId('company-a')
  assert.equal(isInventoryTrackingEnabled(), true)
})

test('migrates legacy global inventory setting once without overwriting company choice', () => {
  installLocalStorage({ [TRACK_INVENTORY_KEY]: 'yes' })

  setActiveCompanyId('company-c')
  assert.equal(isInventoryTrackingEnabled(), true)
  assert.equal(localStorage.getItem(inventoryTrackingStorageKey('company-c')), 'yes')
  assert.equal(localStorage.getItem(inventoryTrackingLegacyMigrationKey('company-c')), 'yes')

  writeInventoryTrackingSetting(false)
  localStorage.setItem(TRACK_INVENTORY_KEY, 'yes')
  assert.equal(isInventoryTrackingEnabled(), false)
  assert.equal(localStorage.getItem(inventoryTrackingStorageKey('company-c')), 'no')
})

test('builds stock summary and register rows from opening, purchase, and sales movements', () => {
  const items = [{
    id: 'item-1',
    code: 'STL',
    name: 'Steel Rod',
    unit: 'MT',
    openingQty: 10,
    openingRate: 100,
    reorderLevel: 2,
    isActive: true,
    createdAt: '',
  }]
  const purchaseBills = [
    {
      id: 'purchase-local',
      billNo: 'LP-1',
      dateBs: '2083/04/02',
      supplierName: 'Local Supplier',
      source: 'Local Purchase' as const,
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{ id: 'line-local', billId: 'purchase-local', itemId: 'item-1', quantity: 5, rate: 120, amount: 600 }],
    },
    {
      id: 'purchase-import',
      billNo: 'IP-1',
      dateBs: '2083/04/03',
      supplierName: 'Import Supplier',
      source: 'Importation' as const,
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{
        id: 'line-import',
        billId: 'purchase-import',
        itemId: 'item-1',
        quantity: 5,
        rate: 160,
        amount: 800,
        entryRate: 100,
        entryAmount: 500,
      }],
    },
  ]
  const salesBills = [{
    id: 'sale-1',
    billNo: 'S-1',
    dateBs: '2083/04/04',
    customerName: 'Customer',
    remarks: '',
    createdAt: '',
    items: [{ id: 'sales-line', billId: 'sale-1', itemId: 'item-1', quantity: 8, rate: 200, amount: 1600 }],
  }]

  const rows = buildStockRows(items, purchaseBills, salesBills)
  assert.equal(rows[0].openingValue, 1000)
  assert.equal(rows[0].localPurchaseValue, 600)
  assert.equal(rows[0].importationValue, 800)
  assert.equal(rows[0].closingQty, 12)
  assert.equal(rows[0].averageRate, 120)
  assert.equal(rows[0].closingValue, 1440)

  const registerRows = buildStockRegisterRows(items, purchaseBills, salesBills)
  assert.deepEqual(registerRows.map((row) => row.id), ['opening-item-1', 'line-local', 'line-import', 'sales-line'])
  assert.equal(registerRows[3].issuedRate, 120)
  assert.equal(registerRows[3].balanceQty, 12)
})

test('builds stock entry targets and excludes ineligible source documents', () => {
  const target = buildStockEntryTarget({
    billNo: '42',
    companyId: 'company-a',
    date: '2083/04/05',
    documentId: 'sale-42',
    fiscalYear: '2083/84',
    fiscalYearId: fiscalYear.id,
    partyName: 'Customer',
    readOnly: true,
    type: 'Sale',
  })

  assert.deepEqual(target, {
    billNo: '42',
    companyId: 'company-a',
    date: '2083/04/05',
    documentId: 'sale-42',
    fiscalYear: '2083/84',
    fiscalYearId: fiscalYear.id,
    partyName: 'Customer',
    readOnly: true,
    type: 'Sale',
  })
  assert.equal(isStockDocumentEligible({ fiscalYearId: fiscalYear.id, lifecycleStatus: 'POSTED' }, fiscalYear.id), true)
  assert.equal(isStockDocumentEligible({ fiscalYearId: 'other-fy', lifecycleStatus: 'POSTED' }, fiscalYear.id), false)
  assert.equal(isStockDocumentEligible({ fiscalYearId: fiscalYear.id, lifecycleStatus: 'VOID' }, fiscalYear.id), false)
  assert.equal(isStockDocumentEligible({ fiscalYearId: fiscalYear.id, lifecycleStatus: 'REVERSED' }, fiscalYear.id), false)
})

test('only stock-headed local purchases become stock source documents', () => {
  const localExpenses = [
    {
      id: 'local-stock',
      fiscalYearId: fiscalYear.id,
      lifecycleStatus: 'POSTED' as const,
      partyId: 'local-supplier',
      billNumber: 'LP-STOCK',
      billDate: '2083/04/02',
      expenseType: 'Stock' as const,
      expenseHead: '',
      amountBeforeVatNPR: 100,
      vatNPR: 13,
      totalAmountNPR: 113,
      remarks: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'local-expense',
      fiscalYearId: fiscalYear.id,
      lifecycleStatus: 'POSTED' as const,
      partyId: 'local-supplier',
      billNumber: 'LP-EXP',
      billDate: '2083/04/03',
      expenseType: 'Expense' as const,
      expenseHead: 'Repairs',
      amountBeforeVatNPR: 200,
      vatNPR: 26,
      totalAmountNPR: 226,
      remarks: '',
      createdAt: '',
      updatedAt: '',
    },
  ]

  const docs = buildSourceDocs({
    accountParties: [],
    fiscalYearId: fiscalYear.id,
    localExpenses,
    purchaseParties: [{
      id: 'local-supplier',
      name: 'Local Supplier',
      address: '',
      phone: '',
      panVatNo: '',
      country: 'Nepal',
      category: 'Local Suppliers',
      openingPayable: 0,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    }],
    purchases: [],
    sales: [],
  })

  assert.deepEqual(docs.map((doc) => [doc.documentId, doc.type, doc.billNo]), [
    ['local-stock', 'Local Purchase', 'LP-STOCK'],
  ])
})

test('keeps purchase stock identity by source document type, not bill number alone', () => {
  const sourceDocs = [
    {
      amount: 100,
      billNo: 'DUP-1',
      date: '2083/04/02',
      documentId: 'shared-doc',
      partyName: 'Import Supplier',
      type: 'Import Purchase' as const,
    },
    {
      amount: 200,
      billNo: 'DUP-1',
      date: '2083/04/03',
      documentId: 'shared-doc',
      partyName: 'Local Supplier',
      type: 'Local Purchase' as const,
    },
  ]
  const purchaseBills = [
    {
      id: 'shared-doc',
      billNo: 'DUP-1',
      dateBs: '2083/04/02',
      supplierName: 'Import Supplier',
      source: 'Importation' as const,
      sourceType: 'Import Purchase' as const,
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{ id: 'import-line', billId: 'shared-doc', itemId: 'item-1', quantity: 1, rate: 100, amount: 100 }],
    },
    {
      id: 'shared-doc',
      billNo: 'DUP-1',
      dateBs: '2083/04/03',
      supplierName: 'Local Supplier',
      source: 'Local Purchase' as const,
      sourceType: 'Local Purchase' as const,
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{ id: 'local-line', billId: 'shared-doc', itemId: 'item-2', quantity: 2, rate: 100, amount: 200 }],
    },
  ]

  const statuses = buildStatuses(sourceDocs, purchaseBills, [])
  assert.deepEqual(statuses.map((status) => [status.type, status.lineCount, status.lineValue]), [
    ['Import Purchase', 1, 100],
    ['Local Purchase', 1, 200],
  ])
  assert.deepEqual(linesForDoc(statuses[0], purchaseBills, []), [{ itemId: 'item-1', quantity: 1, rate: 100 }])
  assert.deepEqual(linesForDoc(statuses[1], purchaseBills, []), [{ itemId: 'item-2', quantity: 2, rate: 100 }])
})

test('marks sales stock lines mismatched when the source sale amount changes', () => {
  const sourceDocs = [{
    amount: 120,
    amountNpr: 120,
    billNo: 'S-1',
    date: '2083/04/02',
    documentId: 'sale-1',
    fiscalYearId: fiscalYear.id,
    partyName: 'Customer',
    type: 'Sale' as const,
  }]
  const salesBills = [{
    id: 'sale-1',
    billNo: 'S-1',
    dateBs: '2083/04/02',
    customerName: 'Customer',
    sourceSnapshot: {
      sourceAmount: 100,
      sourceAmountNpr: 100,
      sourceCurrency: 'NPR',
      sourceFiscalYearId: fiscalYear.id,
    },
    remarks: '',
    createdAt: '',
    items: [{ id: 'sales-line', billId: 'sale-1', itemId: 'item-1', quantity: 1, rate: 100, amount: 100 }],
  }]

  const [status] = buildStatuses(sourceDocs, [], salesBills)
  assert.equal(status.status, 'Mismatch')
  assert.equal(status.isFinal, false)
})

test('marks import and local purchase stock mismatched when source values change', () => {
  const sourceDocs = [
    {
      amount: 100,
      amountCurrency: 'INR' as const,
      amountNpr: 160,
      billNo: 'IP-1',
      date: '2083/04/02',
      documentId: 'import-1',
      exchangeRate: 1.6,
      fiscalYearId: fiscalYear.id,
      landedCostNpr: 250,
      partyName: 'Import Supplier',
      type: 'Import Purchase' as const,
    },
    {
      amount: 120,
      amountCurrency: 'NPR' as const,
      amountNpr: 120,
      billNo: 'LP-1',
      date: '2083/04/03',
      documentId: 'local-1',
      exchangeRate: 1,
      fiscalYearId: fiscalYear.id,
      landedCostNpr: 120,
      partyName: 'Local Supplier',
      type: 'Local Purchase' as const,
    },
  ]
  const purchaseBills = [
    {
      id: 'import-1',
      billNo: 'IP-1',
      dateBs: '2083/04/02',
      supplierName: 'Import Supplier',
      source: 'Importation' as const,
      sourceType: 'Import Purchase' as const,
      sourceSnapshot: {
        sourceAmount: 100,
        sourceAmountNpr: 160,
        sourceCurrency: 'INR',
        sourceExchangeRate: 1.6,
        sourceFiscalYearId: fiscalYear.id,
        sourceLandedCostNpr: 300,
      },
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{ id: 'import-line', billId: 'import-1', itemId: 'item-1', quantity: 1, rate: 300, amount: 300, entryRate: 100, entryAmount: 100 }],
    },
    {
      id: 'local-1',
      billNo: 'LP-1',
      dateBs: '2083/04/03',
      supplierName: 'Local Supplier',
      source: 'Local Purchase' as const,
      sourceType: 'Local Purchase' as const,
      sourceSnapshot: {
        sourceAmount: 100,
        sourceAmountNpr: 100,
        sourceCurrency: 'NPR',
        sourceFiscalYearId: fiscalYear.id,
        sourceLandedCostNpr: 100,
      },
      referenceNo: '',
      remarks: '',
      createdAt: '',
      items: [{ id: 'local-line', billId: 'local-1', itemId: 'item-2', quantity: 1, rate: 100, amount: 100 }],
    },
  ]

  const statuses = buildStatuses(sourceDocs, purchaseBills, [])
  assert.deepEqual(statuses.map((status) => [status.type, status.status, status.isFinal]), [
    ['Import Purchase', 'Mismatch', false],
    ['Local Purchase', 'Mismatch', false],
  ])
})

test('excludes mismatched stock documents from export-ready and carry-forward stock', () => {
  const sourceDocs = [
    {
      amount: 100,
      amountNpr: 100,
      billNo: 'S-1',
      date: '2083/04/02',
      documentId: 'sale-valid',
      fiscalYearId: fiscalYear.id,
      partyName: 'Customer',
      type: 'Sale' as const,
    },
    {
      amount: 150,
      amountNpr: 150,
      billNo: 'S-2',
      date: '2083/04/03',
      documentId: 'sale-mismatch',
      fiscalYearId: fiscalYear.id,
      partyName: 'Customer',
      type: 'Sale' as const,
    },
  ]
  const salesBills = [
    {
      id: 'sale-valid',
      billNo: 'S-1',
      dateBs: '2083/04/02',
      customerName: 'Customer',
      sourceSnapshot: { sourceAmount: 100, sourceAmountNpr: 100, sourceFiscalYearId: fiscalYear.id },
      remarks: '',
      createdAt: '',
      items: [{ id: 'valid-line', billId: 'sale-valid', itemId: 'item-1', quantity: 1, rate: 100, amount: 100 }],
    },
    {
      id: 'sale-mismatch',
      billNo: 'S-2',
      dateBs: '2083/04/03',
      customerName: 'Customer',
      sourceSnapshot: { sourceAmount: 100, sourceAmountNpr: 100, sourceFiscalYearId: fiscalYear.id },
      remarks: '',
      createdAt: '',
      items: [{ id: 'mismatch-line', billId: 'sale-mismatch', itemId: 'item-1', quantity: 1, rate: 100, amount: 100 }],
    },
  ]
  const valid = validStockBillsForSourceDocs(sourceDocs, [], salesBills)
  assert.deepEqual(valid.salesBills.map((bill) => bill.id), ['sale-valid'])

  const plan = buildStockCarryForwardPlan({
    asOnDate: '2083/04/30',
    sourceDocs,
    sourceFiscalYearId: fiscalYear.id,
    sourceStock: {
      items: [{
        id: 'item-1',
        code: 'ITM',
        name: 'Item',
        unit: 'KG',
        openingQty: 10,
        openingRate: 10,
        reorderLevel: 0,
        isActive: true,
        createdAt: '',
      }],
      purchaseBills: [],
      salesBills,
    },
  })
  assert.equal(plan.items[0].openingQty, 9)
  assert.match(plan.warnings[0], /excluded/)
})

test('portable stock backup payload preserves sale, import purchase, and local purchase lines', () => {
  const stockPayload = {
    items: [{
      id: 'item-1',
      code: 'ITM',
      name: 'Item',
      unit: 'KG',
      openingQty: 0,
      openingRate: 0,
      reorderLevel: 0,
      isActive: true,
      createdAt: '',
    }],
    purchaseBills: [
      {
        id: 'import-1',
        billNo: 'IP-1',
        dateBs: '2083/04/02',
        supplierName: 'Import Supplier',
        source: 'Importation' as const,
        sourceType: 'Import Purchase' as const,
        sourceSnapshot: { sourceAmount: 100, sourceLandedCostNpr: 160, sourceFiscalYearId: fiscalYear.id },
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'import-line', billId: 'import-1', itemId: 'item-1', quantity: 1, rate: 160, amount: 160, entryRate: 100, entryAmount: 100 }],
      },
      {
        id: 'local-1',
        billNo: 'LP-1',
        dateBs: '2083/04/03',
        supplierName: 'Local Supplier',
        source: 'Local Purchase' as const,
        sourceType: 'Local Purchase' as const,
        sourceSnapshot: { sourceAmount: 75, sourceLandedCostNpr: 75, sourceFiscalYearId: fiscalYear.id },
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'local-line', billId: 'local-1', itemId: 'item-1', quantity: 1, rate: 75, amount: 75 }],
      },
    ],
    salesBills: [{
      id: 'sale-1',
      billNo: 'S-1',
      dateBs: '2083/04/04',
      customerName: 'Customer',
      sourceSnapshot: { sourceAmount: 90, sourceFiscalYearId: fiscalYear.id },
      remarks: '',
      createdAt: '',
      items: [{ id: 'sale-line', billId: 'sale-1', itemId: 'item-1', quantity: 1, rate: 90, amount: 90 }],
    }],
  }

  const restored = JSON.parse(JSON.stringify(stockPayload))
  assert.deepEqual(restored.purchaseBills.map((bill: { sourceType: string }) => bill.sourceType), ['Import Purchase', 'Local Purchase'])
  assert.deepEqual(restored.purchaseBills.map((bill: { items: unknown[] }) => bill.items.length), [1, 1])
  assert.equal(restored.salesBills[0].items[0].id, 'sale-line')
  assert.equal(restored.purchaseBills[0].sourceSnapshot.sourceLandedCostNpr, 160)
})

test('allocates import stock value to landed cost while preserving entered purchase amounts', () => {
  let id = 0
  const lines = prepareStockPurchaseLinesForDocument(
    [
      { itemId: 'item-a', quantity: 2, rate: 100 },
      { itemId: 'item-b', quantity: 1, rate: 200 },
    ],
    'purchase-1',
    'Importation',
    900,
    () => `line-${++id}`,
  )

  assert.deepEqual(lines.map((line) => line.entryAmount), [200, 200])
  assert.deepEqual(lines.map((line) => line.amount), [450, 450])
  assert.deepEqual(lines.map((line) => line.rate), [225, 450])
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 900)

  id = 0
  const replacedLines = prepareStockPurchaseLinesForDocument(
    [
      { itemId: 'item-a', quantity: 2, rate: 100 },
      { itemId: 'item-b', quantity: 1, rate: 200 },
    ],
    'purchase-1',
    'Importation',
    900,
    () => `line-${++id}`,
  )
  assert.deepEqual(replacedLines, lines)
})

test('keeps foreign purchase entry totals independent from NPR valuation display', () => {
  const lines = prepareStockPurchaseLinesForDocument(
    [
      {
        amount: 448625.06,
        entryAmount: 281280,
        entryRate: 6.697142857142857,
        itemId: 'item-a',
        quantity: 42000,
        rate: 10.681549,
      },
    ],
    'purchase-foreign',
    'Importation',
    500000,
    () => 'line-1',
  )
  const draftLines = linesForDoc({
    amount: 281280,
    amountCurrency: 'INR',
    amountNpr: 448625.06,
    billNo: 'IP-1',
    date: '2082/04/01',
    documentId: 'purchase-foreign',
    fiscalYearId: fiscalYear.id,
    isFinal: true,
    lineCount: 1,
    lineValue: 281280,
    partyName: 'Supplier',
    status: 'Entered',
    type: 'Import Purchase',
  }, [{
    id: 'purchase-foreign',
    billNo: 'IP-1',
    dateBs: '2082/04/01',
    supplierName: 'Supplier',
    source: 'Importation',
    sourceType: 'Import Purchase',
    referenceNo: '',
    remarks: '',
    createdAt: '',
    items: lines,
  }], [])

  assert.equal(billEntryTotal(draftLines), 281280)
  assert.equal(draftLines[0].entryAmount, 281280)
  assert.equal(draftLines[0].entryRate, 6.697142857142857)
  assert.equal(Number((draftLines[0].quantity * draftLines[0].rate).toFixed(2)), 500000)
})

test('uses six-decimal stock rates for valuation and display', () => {
  const lines = prepareStockPurchaseLinesForDocument(
    [{ itemId: 'item-a', quantity: 100, rate: 1.123456 }],
    'purchase-six-decimal-rate',
    'Local Purchase',
    0,
    () => 'line-1',
  )

  assert.equal(lines[0].rate, 1.123456)
  assert.equal(lines[0].amount, 112.35)
  assert.equal(formatRate(lines[0].rate, 'NPR'), 'NPR 1.123456')
})

test('plans stock carry-forward from eligible closing stock into target openings idempotently', () => {
  const sourceStock = {
    items: [
      {
        id: 'item-active',
        code: 'iron',
        name: 'Iron Rod',
        unit: 'MT',
        openingQty: 10,
        openingRate: 100,
        reorderLevel: 2,
        isActive: true,
        createdAt: '',
      },
      {
        id: 'item-inactive-zero',
        code: 'old',
        name: 'Old Item',
        unit: 'KG',
        openingQty: 0,
        openingRate: 0,
        reorderLevel: 0,
        isActive: false,
        createdAt: '',
      },
      {
        id: 'item-fallback',
        code: 'mix',
        name: 'Fallback Rate',
        unit: 'PCS',
        openingQty: 0,
        openingRate: 0,
        reorderLevel: 1,
        isActive: true,
        createdAt: '',
      },
    ],
    purchaseBills: [
      {
        id: 'purchase-import',
        billNo: 'IP-1',
        dateBs: '2083/04/10',
        supplierName: 'Supplier',
        source: 'Importation',
        sourceType: 'Import Purchase',
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'import-line', billId: 'purchase-import', itemId: 'item-active', quantity: 5, rate: 180, amount: 900, entryRate: 100, entryAmount: 500 }],
      },
      {
        id: 'purchase-after-end',
        billNo: 'IP-2',
        dateBs: '2084/04/02',
        supplierName: 'Supplier',
        source: 'Importation',
        sourceType: 'Import Purchase',
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'future-line', billId: 'purchase-after-end', itemId: 'item-active', quantity: 99, rate: 1, amount: 99, entryRate: 1, entryAmount: 99 }],
      },
      {
        id: 'purchase-void',
        billNo: 'LP-VOID',
        dateBs: '2083/04/11',
        supplierName: 'Supplier',
        source: 'Local Purchase',
        sourceType: 'Local Purchase',
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'void-line', billId: 'purchase-void', itemId: 'item-active', quantity: 99, rate: 1, amount: 99 }],
      },
      {
        id: 'purchase-fallback',
        billNo: 'LP-1',
        dateBs: '2083/04/12',
        supplierName: 'Supplier',
        source: 'Local Purchase',
        sourceType: 'Local Purchase',
        referenceNo: '',
        remarks: '',
        createdAt: '',
        items: [{ id: 'fallback-line', billId: 'purchase-fallback', itemId: 'item-fallback', quantity: 3, rate: 0, amount: 150 }],
      },
    ],
    salesBills: [
      {
        id: 'sale-1',
        billNo: 'S-1',
        dateBs: '2083/05/01',
        customerName: 'Customer',
        remarks: '',
        createdAt: '',
        items: [{ id: 'sale-line', billId: 'sale-1', itemId: 'item-active', quantity: 4, rate: 250, amount: 1000 }],
      },
    ],
  }
  const sourceDocs = [
    { amount: 500, billNo: 'IP-1', date: '2083/04/10', documentId: 'purchase-import', fiscalYearId: fiscalYear.id, landedCostNpr: 900, partyName: 'Supplier', type: 'Import Purchase' },
    { amount: 99, billNo: 'IP-2', date: '2084/04/02', documentId: 'purchase-after-end', fiscalYearId: fiscalYear.id, partyName: 'Supplier', type: 'Import Purchase' },
    { amount: 99, billNo: 'LP-VOID', date: '2083/04/11', documentId: 'purchase-void', fiscalYearId: fiscalYear.id, lifecycleStatus: 'VOID', partyName: 'Supplier', type: 'Local Purchase' },
    { amount: 150, billNo: 'LP-1', date: '2083/04/12', documentId: 'purchase-fallback', fiscalYearId: fiscalYear.id, partyName: 'Supplier', type: 'Local Purchase' },
    { amount: 1000, billNo: 'S-1', date: '2083/05/01', documentId: 'sale-1', fiscalYearId: fiscalYear.id, partyName: 'Customer', type: 'Sale' },
  ]

  const firstRun = buildStockCarryForwardPlan({
    asOnDate: fiscalYear.endBs,
    sourceDocs,
    sourceFiscalYearId: fiscalYear.id,
    sourceStock,
    targetItems: [],
  })

  assert.equal(firstRun.eligibleItemCount, 2)
  assert.equal(firstRun.created, 2)
  assert.equal(firstRun.updated, 0)
  assert.equal(firstRun.skippedInactiveZero, 1)
  assert.equal(firstRun.totalClosingQty, 14)
  assert.equal(Number(firstRun.totalClosingValue.toFixed(2)), 1543.33)
  assert.deepEqual(firstRun.items.map((item) => item.code), ['IRON', 'MIX'])
  assert.equal(firstRun.items[0].openingQty, 11)
  assert.equal(Number(firstRun.items[0].openingRate.toFixed(6)), 126.666667)
  assert.equal(Number(firstRun.items[0].sourceClosingValue.toFixed(2)), 1393.33)
  assert.equal(firstRun.items[1].openingQty, 3)
  assert.equal(firstRun.items[1].openingRate, 50)
  assert.equal(firstRun.items[1].sourceClosingValue, 150)

  const secondRun = buildStockCarryForwardPlan({
    asOnDate: fiscalYear.endBs,
    sourceDocs,
    sourceFiscalYearId: fiscalYear.id,
    sourceStock,
    targetItems: firstRun.items.map((item) => ({
      id: `target-${item.code}`,
      code: item.code,
      name: item.name,
      unit: item.unit,
      openingQty: item.openingQty,
      openingRate: item.openingRate,
      reorderLevel: item.reorderLevel,
      isActive: item.isActive,
      createdAt: '',
    })),
  })

  assert.equal(secondRun.created, 0)
  assert.equal(secondRun.updated, 2)
  assert.deepEqual(secondRun.items.map((item) => [item.code, item.openingQty, item.openingRate]), [
    ['IRON', 11, firstRun.items[0].openingRate],
    ['MIX', 3, 50],
  ])
})

test('rolls back stock document replacement transaction when insertion fails', async () => {
  const statements: string[] = []
  const fakeDb = {
    async execute(statement: string) {
      statements.push(statement)
      if (statement === 'insert-fails') {
        throw new Error('insert failed')
      }
    },
  }

  await assert.rejects(
    () => runStockDbTransaction(fakeDb, async () => {
      await fakeDb.execute('delete-old-lines')
      await fakeDb.execute('insert-fails')
    }),
    /insert failed/,
  )

  assert.equal(statements[0], 'BEGIN IMMEDIATE TRANSACTION')
  assert.equal(statements.includes('COMMIT'), false)
  assert.equal(statements.at(-1), 'ROLLBACK')
})

test('serializes concurrent stock transactions on the same database connection', async () => {
  const statements: string[] = []
  let releaseFirstWrite = () => undefined
  let transactionOpen = false
  const firstWriteCanFinish = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })
  const fakeDb = {
    async execute(statement: string) {
      if (statement === 'BEGIN IMMEDIATE TRANSACTION') {
        if (transactionOpen) {
          throw new Error('cannot start a transaction within a transaction')
        }
        transactionOpen = true
      }

      statements.push(statement)

      if (statement === 'hold-first-write') {
        await firstWriteCanFinish
      }

      if (statement === 'COMMIT' || statement === 'ROLLBACK') {
        transactionOpen = false
      }
    },
  }

  const first = runStockDbTransaction(fakeDb, async () => {
    await fakeDb.execute('hold-first-write')
    return 'first'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const second = runStockDbTransaction(fakeDb, async () => {
    await fakeDb.execute('second-write')
    return 'second'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(statements.includes('second-write'), false)
  releaseFirstWrite()

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(statements, [
    'BEGIN IMMEDIATE TRANSACTION',
    'hold-first-write',
    'COMMIT',
    'BEGIN IMMEDIATE TRANSACTION',
    'second-write',
    'COMMIT',
  ])
})

test('serializes stock transactions by database URL across connection objects', async () => {
  const statements: string[] = []
  let releaseFirstWrite = () => undefined
  let transactionOpen = false
  const firstWriteCanFinish = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })
  const createFakeDb = (name: string) => ({
    async execute(statement: string) {
      if (statement === 'BEGIN IMMEDIATE TRANSACTION') {
        if (transactionOpen) {
          throw new Error(`${name}: cannot start a transaction within a transaction`)
        }
        transactionOpen = true
      }
      statements.push(`${name}:${statement}`)
      if (statement === 'hold-first-write') {
        await firstWriteCanFinish
      }
      if (statement === 'COMMIT' || statement === 'ROLLBACK') {
        transactionOpen = false
      }
    },
  })
  const firstDb = createFakeDb('first-db')
  const secondDb = createFakeDb('second-db')

  const first = runStockDbTransaction(firstDb, async () => {
    await firstDb.execute('hold-first-write')
    return 'first'
  }, { queueKey: 'sqlite:company-stock.db' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const second = runStockDbTransaction(secondDb, async () => {
    await secondDb.execute('second-write')
    return 'second'
  }, { queueKey: 'sqlite:company-stock.db' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(statements.includes('second-db:second-write'), false)
  releaseFirstWrite()

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(statements, [
    'first-db:BEGIN IMMEDIATE TRANSACTION',
    'first-db:hold-first-write',
    'first-db:COMMIT',
    'second-db:BEGIN IMMEDIATE TRANSACTION',
    'second-db:second-write',
    'second-db:COMMIT',
  ])
})

test('recovers a leaked stock transaction before retrying begin', async () => {
  const statements: string[] = []
  let beginAttempts = 0
  let transactionOpen = true
  const fakeDb = {
    async execute(statement: string) {
      statements.push(statement)
      if (statement === 'BEGIN IMMEDIATE TRANSACTION') {
        beginAttempts += 1
        if (transactionOpen) {
          throw new Error('error returned from database: (code: 1) cannot start a transaction within a transaction')
        }
        transactionOpen = true
      }
      if (statement === 'ROLLBACK') {
        transactionOpen = false
      }
      if (statement === 'COMMIT') {
        transactionOpen = false
      }
    },
  }

  await runStockDbTransaction(fakeDb, async () => {
    await fakeDb.execute('safe-write')
  }, { queueKey: 'sqlite:leaked-stock.db' })

  assert.equal(beginAttempts, 2)
  assert.deepEqual(statements, [
    'BEGIN IMMEDIATE TRANSACTION',
    'ROLLBACK',
    'BEGIN IMMEDIATE TRANSACTION',
    'safe-write',
    'COMMIT',
  ])
})

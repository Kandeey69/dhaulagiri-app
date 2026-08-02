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

const fiscalYear = createFiscalYearFromCode('company-a', '2083/84')

test('normalizes and resolves BS fiscal-year dates without arbitrary ranges', () => {
  assert.equal(normalizeBsDate('2083-4-2'), '2083/04/02')
  assert.equal(isBsDateInFiscalYear('2083/04/01', fiscalYear), true)
  assert.equal(isBsDateInFiscalYear('2084/03/32', fiscalYear), true)
  assert.equal(isBsDateInFiscalYear('2084/04/01', fiscalYear), false)
  assert.equal(findFiscalYearByBsDate('2083-05-03', [fiscalYear])?.id, fiscalYear.id)
  assert.equal(validateDateInFiscalYear('2082/12/30', fiscalYear).valid, false)
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

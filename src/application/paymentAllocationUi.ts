import { sumAllocations, targetOutstandingBalance, validateAllocations } from '../domain/allocations'
import type { PaymentAllocation } from '../purchase/domain'

export type AllocationBill = {
  id: string
  fiscalYearId?: string
  vendorPartyId: string
  vendorBillNumber: string
  billDate: string
  supplierAmountNPR: number
}

export type PaymentAllocationRow = {
  purchaseId: string
  billNumber: string
  billDate: string
  supplierId: string
  originalAmountNPR: number
  previouslyPaidNPR: number
  outstandingNPR: number
  allocationNPR: number
}

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function buildPaymentAllocationRows(input: {
  bills: AllocationBill[]
  allocations: PaymentAllocation[]
  partyId: string
  fiscalYearId: string
  editingPaymentId?: string
  draftAllocations: Record<string, number>
}) {
  return input.bills
    .filter((bill) => bill.vendorPartyId === input.partyId && bill.fiscalYearId === input.fiscalYearId)
    .map((bill) => {
      const previousAllocations = input.allocations
        .filter((allocation) => allocation.purchaseId === bill.id && allocation.paymentId !== input.editingPaymentId)
        .map((allocation) => ({
          ...allocation,
          sourceId: allocation.paymentId,
          targetId: allocation.purchaseId,
          targetType: 'PURCHASE' as const,
        }))
      const previouslyPaidNPR = sumAllocations(previousAllocations)
      const outstandingNPR = targetOutstandingBalance(bill.supplierAmountNPR, previousAllocations)
      return {
        purchaseId: bill.id,
        billNumber: bill.vendorBillNumber,
        billDate: bill.billDate,
        supplierId: bill.vendorPartyId,
        originalAmountNPR: bill.supplierAmountNPR,
        previouslyPaidNPR,
        outstandingNPR,
        allocationNPR: money(input.draftAllocations[bill.id] ?? 0),
      }
    })
    .filter((row) => row.outstandingNPR > 0 || row.allocationNPR > 0)
    .sort((left, right) => (left.billDate || '').localeCompare(right.billDate || ''))
}

export function allocationDraftTotals(rows: PaymentAllocationRow[], paymentAmountNPR: number) {
  const allocatedNPR = money(rows.reduce((sum, row) => sum + row.allocationNPR, 0))
  return {
    allocatedNPR,
    unallocatedNPR: money(paymentAmountNPR - allocatedNPR),
  }
}

export function autoAllocateOldestFirst(rows: PaymentAllocationRow[], paymentAmountNPR: number) {
  let remaining = money(paymentAmountNPR)
  const draft: Record<string, number> = {}

  for (const row of rows) {
    if (remaining <= 0) break
    const amount = money(Math.min(remaining, row.outstandingNPR))
    if (amount > 0) {
      draft[row.purchaseId] = amount
      remaining = money(remaining - amount)
    }
  }

  return draft
}

export function validatePaymentAllocationDraft(input: {
  paymentId: string
  paymentAmountNPR: number
  rows: PaymentAllocationRow[]
  existingAllocations?: PaymentAllocation[]
}) {
  const allocations = input.rows
    .filter((row) => row.allocationNPR > 0)
    .map((row) => ({
      id: `${input.paymentId}-${row.purchaseId}`,
      sourceId: input.paymentId,
      targetId: row.purchaseId,
      targetType: 'PURCHASE' as const,
      amountNPR: row.allocationNPR,
      createdAt: '',
      updatedAt: '',
    }))

  return validateAllocations({
    sourceAmountNPR: input.paymentAmountNPR,
    allocations,
    targets: input.rows.map((row) => ({
      id: row.purchaseId,
      totalNPR: money(row.previouslyPaidNPR + row.outstandingNPR),
    })),
    existingAllocations: (input.existingAllocations ?? []).map((allocation) => ({
      ...allocation,
      sourceId: allocation.paymentId,
      targetId: allocation.purchaseId,
      targetType: 'PURCHASE' as const,
    })),
  })
}


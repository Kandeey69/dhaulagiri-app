import type { Allocation } from './allocations'
import { sumAllocations } from './allocations'
import type { LedgerEntry, LedgerSourceType } from './ledger'
import { isBalanced } from './ledger'

export type ReconciliationIssue = {
  code: string
  message: string
  sourceId?: string
}

export function reconcileLedgerBalance(entries: LedgerEntry[]): ReconciliationIssue[] {
  return isBalanced(entries)
    ? []
    : [{ code: 'UNBALANCED_LEDGER', message: 'Total ledger debit does not equal total ledger credit.' }]
}

export function reconcileAllocationBalance(input: {
  sourceId: string
  sourceAmountNPR: number
  allocations: Pick<Allocation, 'amountNPR'>[]
  sourceLabel: string
}): ReconciliationIssue[] {
  const allocated = sumAllocations(input.allocations)

  if (allocated > input.sourceAmountNPR) {
    return [{
      code: 'OVER_ALLOCATED',
      message: `${input.sourceLabel} allocations exceed the source amount.`,
      sourceId: input.sourceId,
    }]
  }

  return []
}

export function reconcilePostingBatches(input: {
  entries: LedgerEntry[]
  sourceType: LedgerSourceType
  sourceId: string
}) {
  const activeBatchIds = new Set(
    input.entries
      .filter(
        (entry) =>
          entry.sourceType === input.sourceType &&
          entry.sourceId === input.sourceId &&
          entry.status === 'ACTIVE',
      )
      .map((entry) => entry.batchId),
  )

  if (activeBatchIds.size !== 1) {
    return [{
      code: 'POSTING_BATCH_COUNT',
      message: `Expected exactly one active posting batch for ${input.sourceType} ${input.sourceId}.`,
      sourceId: input.sourceId,
    }]
  }

  return []
}

export function reconcileReversal(input: {
  sourceEntries: LedgerEntry[]
  reversalEntries: LedgerEntry[]
  sourceId: string
}) {
  const sourceEntryIds = new Set(input.sourceEntries.map((entry) => entry.id))
  const reversedEntryIds = new Set(
    input.reversalEntries
      .map((entry) => entry.reversalOfEntryId)
      .filter((entryId): entryId is string => Boolean(entryId)),
  )

  for (const entryId of sourceEntryIds) {
    if (!reversedEntryIds.has(entryId)) {
      return [{
        code: 'MISSING_REVERSAL_ENTRY',
        message: 'Reversed source transaction does not have matching reversal entries.',
        sourceId: input.sourceId,
      }]
    }
  }

  return []
}

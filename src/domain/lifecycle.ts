import type { FiscalYear, FiscalYearStatus } from './fiscalYear'

export type TransactionLifecycleStatus = 'DRAFT' | 'POSTED' | 'VOID' | 'REVERSED'

export type LifecycleTransition = {
  from: TransactionLifecycleStatus
  to: TransactionLifecycleStatus
  reason?: string
  userName: string
  timestamp: string
}

export type FiscalYearStatusTransition = {
  fiscalYearId: string
  previousStatus: FiscalYearStatus
  newStatus: FiscalYearStatus
  reason: string
  userName: string
  timestamp: string
}

export type LifecycleValidationResult = {
  valid: boolean
  error?: string
}

const transactionTransitions: Record<TransactionLifecycleStatus, TransactionLifecycleStatus[]> = {
  DRAFT: ['POSTED', 'VOID'],
  POSTED: ['REVERSED'],
  VOID: [],
  REVERSED: [],
}

const fiscalYearTransitions: Record<FiscalYearStatus, FiscalYearStatus[]> = {
  OPEN: ['SOFT_CLOSED', 'CLOSED'],
  SOFT_CLOSED: ['OPEN', 'CLOSED'],
  CLOSED: [],
}

export function canTransitionTransaction(
  from: TransactionLifecycleStatus,
  to: TransactionLifecycleStatus,
  fiscalYear: Pick<FiscalYear, 'status'>,
) {
  if (fiscalYear.status === 'CLOSED') {
    return false
  }

  if (fiscalYear.status === 'SOFT_CLOSED' && to === 'POSTED') {
    return false
  }

  return transactionTransitions[from].includes(to)
}

export function validateTransactionTransition(
  from: TransactionLifecycleStatus,
  to: TransactionLifecycleStatus,
  fiscalYear: Pick<FiscalYear, 'code' | 'status'>,
): LifecycleValidationResult {
  if (canTransitionTransaction(from, to, fiscalYear)) {
    return { valid: true }
  }

  if (fiscalYear.status === 'CLOSED') {
    return { valid: false, error: `Fiscal year ${fiscalYear.code} is closed.` }
  }

  if (fiscalYear.status === 'SOFT_CLOSED' && to === 'POSTED') {
    return { valid: false, error: `Fiscal year ${fiscalYear.code} is soft closed. Normal posting is blocked.` }
  }

  return { valid: false, error: `Transaction cannot move from ${from} to ${to}.` }
}

export function assertTransactionTransition(
  from: TransactionLifecycleStatus,
  to: TransactionLifecycleStatus,
  fiscalYear: Pick<FiscalYear, 'code' | 'status'>,
) {
  const validation = validateTransactionTransition(from, to, fiscalYear)
  if (!validation.valid) {
    throw new Error(validation.error ?? `Invalid lifecycle transition ${from} to ${to}.`)
  }
}

export function canModifyFinancialFields(status: TransactionLifecycleStatus, fiscalYear: Pick<FiscalYear, 'status'>) {
  return fiscalYear.status !== 'CLOSED' && status === 'DRAFT'
}

export function canTransitionFiscalYear(
  previousStatus: FiscalYearStatus,
  newStatus: FiscalYearStatus,
  controlledReopen = false,
) {
  if (previousStatus === 'CLOSED' && newStatus === 'OPEN') {
    return controlledReopen
  }

  return fiscalYearTransitions[previousStatus].includes(newStatus)
}

export function transitionFiscalYearStatus(input: {
  fiscalYear: FiscalYear
  newStatus: FiscalYearStatus
  reason: string
  userName: string
  timestamp: string
  controlledReopen?: boolean
}) {
  if (!input.reason.trim()) {
    throw new Error('Fiscal-year status change reason is required.')
  }

  if (!canTransitionFiscalYear(input.fiscalYear.status, input.newStatus, input.controlledReopen)) {
    throw new Error(`Fiscal year cannot move from ${input.fiscalYear.status} to ${input.newStatus}.`)
  }

  return {
    fiscalYear: {
      ...input.fiscalYear,
      status: input.newStatus,
      updatedAt: input.timestamp,
    },
    log: {
      fiscalYearId: input.fiscalYear.id,
      previousStatus: input.fiscalYear.status,
      newStatus: input.newStatus,
      reason: input.reason,
      userName: input.userName,
      timestamp: input.timestamp,
    } satisfies FiscalYearStatusTransition,
  }
}

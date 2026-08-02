import type { FiscalYearStatus } from '../domain/fiscalYear'
import type { TransactionLifecycleStatus } from '../domain/lifecycle'

export type TransactionAction = 'VIEW' | 'EDIT' | 'DELETE' | 'POST' | 'REVERSE' | 'PRINT'

export type TransactionActionContext = {
  status: TransactionLifecycleStatus
  fiscalYearStatus: FiscalYearStatus
  canEditDraft: boolean
  canDeleteDraft: boolean
  canReversePosted: boolean
}

export function transactionActionLabels(actions: TransactionAction[]) {
  return actions.map((action) => {
    if (action === 'VIEW') return 'View'
    if (action === 'EDIT') return 'Edit'
    if (action === 'DELETE') return 'Delete'
    if (action === 'POST') return 'Post'
    if (action === 'REVERSE') return 'Reverse'
    return 'Print'
  })
}

export function availableTransactionActions(context: TransactionActionContext): TransactionAction[] {
  if (context.fiscalYearStatus === 'CLOSED') {
    return ['VIEW', 'PRINT']
  }

  if (context.status === 'DRAFT') {
    return [
      'VIEW',
      ...(context.canEditDraft ? ['EDIT' as const] : []),
      ...(context.canDeleteDraft ? ['DELETE' as const] : []),
      ...(context.fiscalYearStatus === 'OPEN' ? ['POST' as const] : []),
    ]
  }

  if (context.status === 'POSTED') {
    return [
      'VIEW',
      ...(context.canReversePosted && context.fiscalYearStatus === 'OPEN' ? ['REVERSE' as const] : []),
      'PRINT',
    ]
  }

  return ['VIEW', 'PRINT']
}


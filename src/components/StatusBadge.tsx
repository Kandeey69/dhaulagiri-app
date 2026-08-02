import type { FiscalYearStatus } from '../domain/fiscalYear'
import type { TransactionLifecycleStatus } from '../domain/lifecycle'

export function TransactionStatusBadge({
  status,
  fiscalYearStatus,
}: {
  status?: TransactionLifecycleStatus
  fiscalYearStatus?: FiscalYearStatus
}) {
  const label = fiscalYearStatus === 'CLOSED'
    ? 'Closed-year read only'
    : status ?? 'POSTED'

  return <span className={`status-badge ${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{label}</span>
}


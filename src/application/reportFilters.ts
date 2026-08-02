export type ReportFilterState = {
  fiscalYearId: string
  fromBs: string
  toBs: string
  partyId: string
  category: string
  status: string
  paymentStatus: string
  search: string
  asOfBs: string
}

export const emptyReportFilters: ReportFilterState = {
  fiscalYearId: '',
  fromBs: '',
  toBs: '',
  partyId: '',
  category: '',
  status: '',
  paymentStatus: '',
  search: '',
  asOfBs: '',
}

export function resetReportFilters(fiscalYearId = ''): ReportFilterState {
  return { ...emptyReportFilters, fiscalYearId }
}

export function textMatchesSearch(values: unknown[], search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return values.join(' ').toLowerCase().includes(query)
}

export function filterByFiscalYear<T extends { fiscalYearId?: string }>(
  rows: T[],
  fiscalYearId: string,
) {
  return fiscalYearId ? rows.filter((row) => row.fiscalYearId === fiscalYearId) : rows
}

export function reportMovementTotals(rows: { debit?: number; credit?: number; amount?: number }[]) {
  return rows.reduce<{ debit: number; credit: number; amount: number }>(
    (totals, row) => ({
      debit: totals.debit + Number(row.debit || 0),
      credit: totals.credit + Number(row.credit || 0),
      amount: totals.amount + Number(row.amount || 0),
    }),
    { debit: 0, credit: 0, amount: 0 },
  )
}

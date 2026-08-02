import type { FiscalYear } from '../domain/fiscalYear'

export function AppContextBar({
  companyName,
  fiscalYears,
  selectedFiscalYearId,
  onFiscalYearChange,
}: {
  companyName: string
  fiscalYears: FiscalYear[]
  selectedFiscalYearId: string
  onFiscalYearChange: (id: string) => void
}) {
  const selected = fiscalYears.find((fiscalYear) => fiscalYear.id === selectedFiscalYearId) ?? fiscalYears[0]

  return (
    <section className={selected?.status === 'CLOSED' ? 'context-bar closed' : 'context-bar'}>
      <div>
        <span>Company</span>
        <strong>{companyName || 'Company'}</strong>
      </div>
      <label>
        <span>Fiscal year</span>
        <select
          value={selectedFiscalYearId}
          onChange={(event) => onFiscalYearChange(event.target.value)}
          aria-label="Select fiscal year"
        >
          {fiscalYears.map((fiscalYear) => (
            <option key={fiscalYear.id} value={fiscalYear.id}>
              {fiscalYear.code} - {fiscalYear.status.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span>Status</span>
        <strong>{selected?.status.replace('_', ' ') ?? 'OPEN'}</strong>
      </div>
    </section>
  )
}


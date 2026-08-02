import type { PurchaseComputedTotals } from '../../domain/accountingPolicy'

export function PurchaseCalculationSummary({
  totals,
  formatMoney,
}: {
  totals: PurchaseComputedTotals
  formatMoney: (value: number) => string
}) {
  const rows = [
    ['Supplier value in NPR', totals.supplierAmountNPR, 'Amount payable to supplier and included in costing.'],
    ['Customs and import charges', totals.debitNoteTotalNPR, 'Debit-note charges tracked before recoverable VAT split.'],
    ['Terminal cost', totals.totalTerminalChargeNPR, 'Terminal charges plus recoverable terminal VAT.'],
    ['Loading & unloading', totals.loadingUnloadingChargeNPR, 'Total KG multiplied by loading and unloading charge per KG.'],
    ['Recoverable input VAT', totals.totalInputVatNPR, 'Input VAT tracked separately from landed cost.'],
    ['Custom-agent payable', totals.totalAgentPayableNPR, 'Amount payable to custom agent based on freight treatment.'],
    ['Landed cost', totals.landedCostNPR, 'Cost total used for import purchase reporting.'],
  ] as const

  return (
    <div className="calculation-summary">
      {rows.map(([label, amount, help]) => (
        <div key={label} className="summary-line">
          <span>{label}</span>
          <strong>{formatMoney(amount)}</strong>
          <em>{help}</em>
        </div>
      ))}
    </div>
  )
}

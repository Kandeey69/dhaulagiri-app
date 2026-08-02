import type { PaymentAllocationRow } from '../../application/paymentAllocationUi'

export function PaymentAllocationTable({
  rows,
  paymentAmountNPR,
  allocatedNPR,
  unallocatedNPR,
  formatMoney,
  onAllocationChange,
  onAutoAllocate,
  onClearAllocations,
}: {
  rows: PaymentAllocationRow[]
  paymentAmountNPR: number
  allocatedNPR: number
  unallocatedNPR: number
  formatMoney: (value: number) => string
  onAllocationChange: (purchaseId: string, amountNPR: number) => void
  onAutoAllocate: () => void
  onClearAllocations: () => void
}) {
  return (
    <div className="allocation-box">
      <div className="allocation-header">
        <div>
          <strong>Bill allocation</strong>
          <span>Allocate this payment to outstanding supplier bills.</span>
        </div>
        <div className="form-actions">
          <button type="button" className="small" onClick={onAutoAllocate}>
            Auto-allocate oldest
          </button>
          <button type="button" className="small ghost" onClick={onClearAllocations}>
            Clear allocations
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bill number</th>
              <th>Bill date</th>
              <th>Original amount</th>
              <th>Previously paid</th>
              <th>Outstanding</th>
              <th>Allocate NPR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.purchaseId}>
                <td>{row.billNumber}</td>
                <td>{row.billDate || '-'}</td>
                <td className="money-cell">{formatMoney(row.originalAmountNPR)}</td>
                <td className="money-cell">{formatMoney(row.previouslyPaidNPR)}</td>
                <td className="money-cell">{formatMoney(row.outstandingNPR)}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.allocationNPR === 0 ? '' : String(row.allocationNPR)}
                    aria-label={`Allocate amount for bill ${row.billNumber}`}
                    onChange={(event) => onAllocationChange(row.purchaseId, Number(event.target.value || 0))}
                    onWheel={(event) => event.currentTarget.blur()}
                  />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="empty">
                  No outstanding bills for the selected supplier and fiscal year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="allocation-totals">
        <span>Payment {formatMoney(paymentAmountNPR)}</span>
        <span>Allocated {formatMoney(allocatedNPR)}</span>
        <strong>Unallocated {formatMoney(unallocatedNPR)}</strong>
      </div>
    </div>
  )
}


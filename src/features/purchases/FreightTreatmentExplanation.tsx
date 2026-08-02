import { freightTreatmentForStatus } from '../../domain/accountingPolicy'
import type { FreightIndiaStatus } from '../../purchase/domain'

export function FreightTreatmentExplanation({ status }: { status: FreightIndiaStatus }) {
  const treatment = freightTreatmentForStatus(status)

  const rows = [
    treatment.includedInLandedCost ? 'Included in landed cost' : 'Not included in landed cost',
    treatment.createsCustomAgentPayable ? 'Payable to customs agent' : 'No custom-agent freight payable',
    treatment.createsTransporterPayable ? 'Payable to transporter' : 'No transporter payable',
    treatment.alreadySettled ? 'Already settled by customs agent' : 'Separate payment remains open',
  ]

  return (
    <div className="effect-box" aria-label="Freight accounting effect">
      <strong>Freight accounting effect</strong>
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  )
}


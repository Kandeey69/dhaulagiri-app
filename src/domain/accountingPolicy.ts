import type { FreightIndiaStatus } from '../purchase/domain'

export type PurchaseCalculationPolicy = {
  vatRatePercent: number
  defaultExchangeRate: number
  calculationVersion: string
}

export type PurchaseInputs = {
  amountIC: number
  supplierExchangeRate: number
  importDutyNPR: number
  customServiceNPR: number
  importVatNPR: number
  terminalChargeWithoutVatNPR: number
  freightIndiaStatus: FreightIndiaStatus
  freightIndiaAmountIC: number
  freightIndiaExchangeRate: number
  totalKg: number
  loadingUnloadingChargePerKg: number
  otherChargesNPR: number
  agentServiceAmountBeforeVatNPR: number
}

export type PurchaseComputedTotals = {
  supplierAmountNPR: number
  terminalVatNPR: number
  totalTerminalChargeNPR: number
  freightIndiaAmountNPR: number
  loadingUnloadingChargeNPR: number
  agentServiceVatNPR: number
  debitNoteTotalNPR: number
  agentServiceTotalNPR: number
  totalAgentPayableNPR: number
  totalInputVatNPR: number
  landedCostNPR: number
}

export type FreightStatusCode = 'PAID_BY_CUSTOM_AGENT' | 'TO_BE_PAID_BY_US'

export type FreightTreatment = {
  code: FreightStatusCode
  label: FreightIndiaStatus
  includedInLandedCost: boolean
  payableParty: 'CUSTOM_AGENT' | 'TRANSPORTER'
  alreadySettled: boolean
  createsCustomAgentPayable: boolean
  createsTransporterPayable: boolean
}

export const freightTreatmentByStatus: Record<FreightStatusCode, FreightTreatment> = {
  PAID_BY_CUSTOM_AGENT: {
    code: 'PAID_BY_CUSTOM_AGENT',
    label: 'Paid by custom agent',
    includedInLandedCost: true,
    payableParty: 'CUSTOM_AGENT',
    alreadySettled: true,
    createsCustomAgentPayable: true,
    createsTransporterPayable: false,
  },
  TO_BE_PAID_BY_US: {
    code: 'TO_BE_PAID_BY_US',
    label: 'To be paid by us',
    includedInLandedCost: true,
    payableParty: 'TRANSPORTER',
    alreadySettled: false,
    createsCustomAgentPayable: false,
    createsTransporterPayable: true,
  },
}

export function freightStatusLabelToCode(status: FreightIndiaStatus): FreightStatusCode {
  return status === 'To be paid by us' ? 'TO_BE_PAID_BY_US' : 'PAID_BY_CUSTOM_AGENT'
}

export function freightTreatmentForStatus(status: FreightIndiaStatus) {
  return freightTreatmentByStatus[freightStatusLabelToCode(status)]
}

export function freightCreatesTransporterPayable(status: FreightIndiaStatus) {
  return freightTreatmentForStatus(status).createsTransporterPayable
}

export function freightCreatesCustomAgentPayable(status: FreightIndiaStatus) {
  return freightTreatmentForStatus(status).createsCustomAgentPayable
}

export function createPurchaseCalculationPolicy(input: {
  agentServiceVatRate: number
  defaultExchangeRate: number
}): PurchaseCalculationPolicy {
  return {
    vatRatePercent: Math.max(0, Number(input.agentServiceVatRate || 0)),
    defaultExchangeRate: Math.max(0, Number(input.defaultExchangeRate || 0)),
    calculationVersion: 'purchase-policy-v1',
  }
}

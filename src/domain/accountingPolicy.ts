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

export type ImportLandedCostBreakdown = {
  supplierAmountNPR: number
  customsNPR: number
  customServiceNPR: number
  terminalCostNPR: number
  terminalVatNPR: number
  totalTerminalChargeNPR: number
  freightNPR: number
  freightCustomAgentPayableNPR: number
  freightTransporterPayableNPR: number
  loadingUnloadingNPR: number
  otherCostsNPR: number
  agentServiceAmountBeforeVatNPR: number
  agentServiceVatNPR: number
  agentServiceTotalNPR: number
  debitNoteTotalNPR: number
  customsAgentPayableNPR: number
  transporterPayableNPR: number
  recoverableInputVatNPR: number
  totalAdditionalCostsNPR: number
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

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function calculateImportLandedCostBreakdown(
  input: PurchaseInputs,
  policy: PurchaseCalculationPolicy,
): ImportLandedCostBreakdown {
  const vatRate = Math.max(0, policy.vatRatePercent) / 100
  const freightTreatment = freightTreatmentForStatus(input.freightIndiaStatus)
  const supplierAmountNPR = money(input.amountIC * input.supplierExchangeRate)
  const terminalVatNPR = money(input.terminalChargeWithoutVatNPR * vatRate)
  const totalTerminalChargeNPR = money(input.terminalChargeWithoutVatNPR + terminalVatNPR)
  const freightNPR = money(input.freightIndiaAmountIC * input.freightIndiaExchangeRate)
  const loadingUnloadingNPR = money(input.totalKg * input.loadingUnloadingChargePerKg)
  const agentServiceVatNPR = money(input.agentServiceAmountBeforeVatNPR * vatRate)
  const freightCustomAgentPayableNPR = freightTreatment.createsCustomAgentPayable ? freightNPR : 0
  const freightTransporterPayableNPR = freightTreatment.createsTransporterPayable ? freightNPR : 0
  const landedFreightNPR = freightTreatment.includedInLandedCost ? freightNPR : 0
  const debitNoteTotalNPR = money(
    input.importDutyNPR +
      input.customServiceNPR +
      input.importVatNPR +
      totalTerminalChargeNPR +
      freightCustomAgentPayableNPR +
      input.otherChargesNPR,
  )
  const agentServiceTotalNPR = money(
    input.agentServiceAmountBeforeVatNPR + agentServiceVatNPR,
  )
  const customsAgentPayableNPR = money(debitNoteTotalNPR + agentServiceTotalNPR)
  const recoverableInputVatNPR = money(
    input.importVatNPR + terminalVatNPR + agentServiceVatNPR,
  )
  const landedCostNPR = money(
    supplierAmountNPR +
      input.importDutyNPR +
      input.customServiceNPR +
      input.terminalChargeWithoutVatNPR +
      landedFreightNPR +
      loadingUnloadingNPR +
      input.otherChargesNPR +
      input.agentServiceAmountBeforeVatNPR,
  )

  return {
    supplierAmountNPR,
    customsNPR: money(input.importDutyNPR),
    customServiceNPR: money(input.customServiceNPR),
    terminalCostNPR: money(input.terminalChargeWithoutVatNPR),
    terminalVatNPR,
    totalTerminalChargeNPR,
    freightNPR,
    freightCustomAgentPayableNPR,
    freightTransporterPayableNPR,
    loadingUnloadingNPR,
    otherCostsNPR: money(input.otherChargesNPR),
    agentServiceAmountBeforeVatNPR: money(input.agentServiceAmountBeforeVatNPR),
    agentServiceVatNPR,
    agentServiceTotalNPR,
    debitNoteTotalNPR,
    customsAgentPayableNPR,
    transporterPayableNPR: freightTransporterPayableNPR,
    recoverableInputVatNPR,
    totalAdditionalCostsNPR: money(landedCostNPR - supplierAmountNPR),
    landedCostNPR,
  }
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

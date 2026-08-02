import type { Currency, FreightIndiaStatus, ImportPurchase, Payment } from './domain'
import {
  createPurchaseCalculationPolicy,
  freightCreatesCustomAgentPayable,
  freightTreatmentForStatus,
  type PurchaseCalculationPolicy,
  type PurchaseComputedTotals,
  type PurchaseInputs,
} from '../domain/accountingPolicy'

export type PurchaseCalculationInput = Pick<
  ImportPurchase,
  | 'amountIC'
  | 'supplierExchangeRate'
  | 'importDutyNPR'
  | 'customServiceNPR'
  | 'importVatNPR'
  | 'terminalChargeWithoutVatNPR'
  | 'terminalVatNPR'
  | 'freightIndiaStatus'
  | 'freightIndiaAmountIC'
  | 'freightIndiaExchangeRate'
  | 'totalKg'
  | 'loadingUnloadingChargePerKg'
  | 'otherChargesNPR'
  | 'agentServiceAmountBeforeVatNPR'
  | 'agentServiceVatNPR'
>

export type PurchaseTotals = PurchaseComputedTotals

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function calculatePurchaseTotals(
  input: PurchaseCalculationInput,
  vatRatePercent = 13,
): PurchaseTotals {
  return calculatePurchaseComputedTotals(input, {
    ...createPurchaseCalculationPolicy({
      agentServiceVatRate: vatRatePercent,
      defaultExchangeRate: input.supplierExchangeRate,
    }),
    vatRatePercent,
  })
}

export function calculatePurchaseComputedTotals(
  input: PurchaseInputs,
  policy: PurchaseCalculationPolicy,
): PurchaseComputedTotals {
  const vatRate = Math.max(0, policy.vatRatePercent) / 100
  const freightTreatment = freightTreatmentForStatus(input.freightIndiaStatus)
  const supplierAmountNPR = money(input.amountIC * input.supplierExchangeRate)
  const terminalVatNPR = money(input.terminalChargeWithoutVatNPR * vatRate)
  const totalTerminalChargeNPR = money(input.terminalChargeWithoutVatNPR + terminalVatNPR)
  const freightIndiaAmountNPR = money(input.freightIndiaAmountIC * input.freightIndiaExchangeRate)
  const loadingUnloadingChargeNPR = money(input.totalKg * input.loadingUnloadingChargePerKg)
  const agentServiceVatNPR = money(input.agentServiceAmountBeforeVatNPR * vatRate)
  const debitFreight = freightTreatment.createsCustomAgentPayable ? freightIndiaAmountNPR : 0
  const landedFreight = freightTreatment.includedInLandedCost ? freightIndiaAmountNPR : 0

  const debitNoteTotalNPR = money(
    input.importDutyNPR +
      input.customServiceNPR +
      input.importVatNPR +
      totalTerminalChargeNPR +
      debitFreight +
      input.otherChargesNPR,
  )
  const agentServiceTotalNPR = money(
    input.agentServiceAmountBeforeVatNPR + agentServiceVatNPR,
  )
  const totalAgentPayableNPR = money(debitNoteTotalNPR + agentServiceTotalNPR)
  const totalInputVatNPR = money(
    input.importVatNPR + terminalVatNPR + agentServiceVatNPR,
  )
  const landedCostNPR = money(
    supplierAmountNPR +
      input.importDutyNPR +
      input.customServiceNPR +
      input.terminalChargeWithoutVatNPR +
      landedFreight +
      loadingUnloadingChargeNPR +
      input.otherChargesNPR +
      input.agentServiceAmountBeforeVatNPR,
  )

  return {
    supplierAmountNPR,
    terminalVatNPR,
    totalTerminalChargeNPR,
    freightIndiaAmountNPR,
    loadingUnloadingChargeNPR,
    agentServiceVatNPR,
    debitNoteTotalNPR,
    agentServiceTotalNPR,
    totalAgentPayableNPR,
    totalInputVatNPR,
    landedCostNPR,
  }
}

export function calculatePaymentNpr(currency: Currency, amount: number, exchangeRate: number) {
  return money(currency === 'NPR' ? amount : amount * exchangeRate)
}

export function hasAgentValues(purchase: Partial<ImportPurchase>) {
  const fields = [
    purchase.importDutyNPR,
    purchase.customServiceNPR,
    purchase.importVatNPR,
    purchase.terminalChargeWithoutVatNPR,
    purchase.terminalVatNPR,
    purchase.freightIndiaAmountIC,
    purchase.otherChargesNPR,
    purchase.agentServiceAmountBeforeVatNPR,
    purchase.agentServiceVatNPR,
  ]

  return fields.some((value) => Number(value ?? 0) > 0)
}

export function isSupplierPayment(payment: Payment) {
  return payment.paymentType === 'Indian Supplier Payment'
}

export function isAgentPayment(payment: Payment) {
  return payment.paymentType === 'Custom Agent Payment'
}

export function shouldFreightAffectDebitNote(status: FreightIndiaStatus) {
  return freightCreatesCustomAgentPayable(status)
}

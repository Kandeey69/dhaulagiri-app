import type { Currency, FreightIndiaStatus, ImportPurchase, Payment } from './domain'
import {
  calculateImportLandedCostBreakdown,
  createPurchaseCalculationPolicy,
  freightCreatesCustomAgentPayable,
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
  const breakdown = calculateImportLandedCostBreakdown(input, policy)

  return {
    supplierAmountNPR: breakdown.supplierAmountNPR,
    terminalVatNPR: breakdown.terminalVatNPR,
    totalTerminalChargeNPR: breakdown.totalTerminalChargeNPR,
    freightIndiaAmountNPR: breakdown.freightNPR,
    loadingUnloadingChargeNPR: breakdown.loadingUnloadingNPR,
    agentServiceVatNPR: breakdown.agentServiceVatNPR,
    debitNoteTotalNPR: breakdown.debitNoteTotalNPR,
    agentServiceTotalNPR: breakdown.agentServiceTotalNPR,
    totalAgentPayableNPR: breakdown.customsAgentPayableNPR,
    totalInputVatNPR: breakdown.recoverableInputVatNPR,
    landedCostNPR: breakdown.landedCostNPR,
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
    money(Number(purchase.totalKg ?? 0) * Number(purchase.loadingUnloadingChargePerKg ?? 0)),
    purchase.loadingUnloadingChargeNPR,
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

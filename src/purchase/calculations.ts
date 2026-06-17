import type { Currency, FreightIndiaStatus, ImportPurchase, Payment } from './domain'

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
  | 'otherChargesNPR'
  | 'agentServiceAmountBeforeVatNPR'
  | 'agentServiceVatNPR'
>

export type PurchaseTotals = {
  supplierAmountNPR: number
  terminalVatNPR: number
  totalTerminalChargeNPR: number
  freightIndiaAmountNPR: number
  agentServiceVatNPR: number
  debitNoteTotalNPR: number
  agentServiceTotalNPR: number
  totalAgentPayableNPR: number
  totalInputVatNPR: number
  landedCostNPR: number
}

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function calculatePurchaseTotals(input: PurchaseCalculationInput): PurchaseTotals {
  const supplierAmountNPR = money(input.amountIC * input.supplierExchangeRate)
  const terminalVatNPR = money(input.terminalChargeWithoutVatNPR * 0.13)
  const totalTerminalChargeNPR = money(input.terminalChargeWithoutVatNPR + terminalVatNPR)
  const freightIndiaAmountNPR = money(input.freightIndiaAmountIC * input.freightIndiaExchangeRate)
  const agentServiceVatNPR = money(input.agentServiceAmountBeforeVatNPR * 0.13)
  const debitFreight =
    input.freightIndiaStatus === 'Paid by custom agent' ? freightIndiaAmountNPR : 0
  const landedFreight =
    input.freightIndiaStatus === 'Paid by custom agent' ||
    input.freightIndiaStatus === 'To be paid by us' ||
    input.freightIndiaStatus === 'Paid directly by us'
      ? freightIndiaAmountNPR
      : 0

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
      input.otherChargesNPR +
      input.agentServiceAmountBeforeVatNPR,
  )

  return {
    supplierAmountNPR,
    terminalVatNPR,
    totalTerminalChargeNPR,
    freightIndiaAmountNPR,
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
  return status === 'Paid by custom agent'
}

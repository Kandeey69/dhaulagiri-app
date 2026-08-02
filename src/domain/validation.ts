import type { FiscalYear } from './fiscalYear'
import { validateDateInFiscalYear } from './fiscalYear'
import type { Allocation, AllocationTarget } from './allocations'
import { validateAllocations } from './allocations'

export type FieldError = {
  field: string
  message: string
}

export type ValidationResult = {
  valid: boolean
  errors: FieldError[]
}

const ok = (): ValidationResult => ({ valid: true, errors: [] })

const result = (errors: FieldError[]): ValidationResult => ({
  valid: errors.length === 0,
  errors,
})

export function mergeValidationResults(...items: ValidationResult[]) {
  return result(items.flatMap((item) => item.errors))
}

export function validatePositiveAmount(field: string, value: number) {
  return Number(value || 0) > 0
    ? ok()
    : result([{ field, message: 'Amount must be greater than zero.' }])
}

export function validateExchangeRate(field: string, value: number) {
  return Number(value || 0) > 0
    ? ok()
    : result([{ field, message: 'Exchange rate must be greater than zero.' }])
}

export function validateConfiguredTaxRate(field: string, value: number) {
  return Number(value) >= 0 && Number.isFinite(Number(value))
    ? ok()
    : result([{ field, message: 'Configured tax rate must be zero or greater.' }])
}

export function validateTransactionDate(field: string, value: string, fiscalYear: FiscalYear) {
  const dateValidation = validateDateInFiscalYear(value, fiscalYear, field)
  return dateValidation.valid ? ok() : result([{ field, message: dateValidation.error ?? 'Invalid fiscal year date.' }])
}

export function validateRequired(field: string, value: unknown, label: string) {
  return String(value ?? '').trim()
    ? ok()
    : result([{ field, message: `${label} is required.` }])
}

export function detectDuplicateSupplierBill(input: {
  purchases: { id: string; vendorPartyId: string; vendorBillNumber: string; fiscalYearId?: string }[]
  vendorPartyId: string
  vendorBillNumber: string
  fiscalYearId: string
  excludeId?: string
}) {
  const duplicate = input.purchases.find(
    (purchase) =>
      purchase.id !== input.excludeId &&
      purchase.vendorPartyId === input.vendorPartyId &&
      purchase.fiscalYearId === input.fiscalYearId &&
      purchase.vendorBillNumber.trim().toLowerCase() === input.vendorBillNumber.trim().toLowerCase(),
  )

  return duplicate
    ? result([{ field: 'vendorBillNumber', message: 'Supplier bill already exists for this supplier and fiscal year.' }])
    : ok()
}

export function validatePurchaseDomain(input: {
  purchase: {
    vendorPartyId: string
    vendorBillNumber: string
    billDate: string
    supplierExchangeRate: number
    amountIC: number
    freightIndiaPartyId?: string
  }
  fiscalYear: FiscalYear
  vendorCategory?: string
  requiresTransportParty: boolean
  vatRatePercent: number
}) {
  return mergeValidationResults(
    validateRequired('vendorPartyId', input.purchase.vendorPartyId, 'Vendor'),
    validateRequired('vendorBillNumber', input.purchase.vendorBillNumber, 'Supplier bill number'),
    validateTransactionDate('billDate', input.purchase.billDate, input.fiscalYear),
    validatePositiveAmount('amountIC', input.purchase.amountIC),
    validateExchangeRate('supplierExchangeRate', input.purchase.supplierExchangeRate),
    validateConfiguredTaxRate('vatRatePercent', input.vatRatePercent),
    input.vendorCategory === 'Indian Suppliers'
      ? ok()
      : result([{ field: 'vendorPartyId', message: 'Vendor must be an Indian supplier.' }]),
    input.requiresTransportParty
      ? validateRequired('freightIndiaPartyId', input.purchase.freightIndiaPartyId, 'Indian transport party')
      : ok(),
  )
}

export function validateSalesDomain(input: {
  sale: { billNo: string; partyId: string; dateBs: string; salesAmount: number }
  fiscalYear: FiscalYear
}) {
  return mergeValidationResults(
    validateRequired('partyId', input.sale.partyId, 'Party'),
    validateRequired('billNo', input.sale.billNo, 'Bill number'),
    validateTransactionDate('dateBs', input.sale.dateBs, input.fiscalYear),
    validatePositiveAmount('salesAmount', input.sale.salesAmount),
  )
}

export function validatePaymentDomain(input: {
  payment: { partyId: string; paymentDate: string; amountNPR: number; exchangeRate: number }
  fiscalYear: FiscalYear
}) {
  return mergeValidationResults(
    validateRequired('partyId', input.payment.partyId, 'Party'),
    validateTransactionDate('paymentDate', input.payment.paymentDate, input.fiscalYear),
    validatePositiveAmount('amountNPR', input.payment.amountNPR),
    validateExchangeRate('exchangeRate', input.payment.exchangeRate),
  )
}

export function validateReceiptDomain(input: {
  receipt: { partyId: string; dateBs: string; amount: number; receiptNo?: string }
  fiscalYear: FiscalYear
}) {
  return mergeValidationResults(
    validateRequired('partyId', input.receipt.partyId, 'Party'),
    validateRequired('receiptNo', input.receipt.receiptNo, 'Receipt number'),
    validateTransactionDate('dateBs', input.receipt.dateBs, input.fiscalYear),
    validatePositiveAmount('amount', input.receipt.amount),
  )
}

export function validateAllocationDomain(input: {
  sourceAmountNPR: number
  allocations: Allocation[]
  targets: AllocationTarget[]
  existingAllocations?: Allocation[]
}) {
  const allocationResult = validateAllocations(input)
  return result(allocationResult.errors)
}

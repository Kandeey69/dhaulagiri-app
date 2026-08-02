import { freightCreatesTransporterPayable } from '../domain/accountingPolicy'
import type { FiscalYear } from '../domain/fiscalYear'
import { normalizeBsDate } from '../domain/fiscalYear'
import { detectDuplicateSupplierBill, validatePurchaseDomain, type FieldError } from '../domain/validation'
import type { ImportPurchase } from '../purchase/domain'

export type PurchaseFormValidationInput = {
  purchase: ImportPurchase
  fiscalYear: FiscalYear
  vendorCategory?: string
  vatRatePercent: number
  existingPurchases: ImportPurchase[]
}

export type PurchaseFormValidationResult = {
  errors: FieldError[]
  warnings: FieldError[]
}

export function validatePurchaseFormForUi(input: PurchaseFormValidationInput): PurchaseFormValidationResult {
  const fiscalDate =
    normalizeBsDate(input.purchase.debitNoteDate) ||
    normalizeBsDate(input.purchase.agentServiceBillDate) ||
    normalizeBsDate(input.purchase.billDate)

  const purchaseValidation = validatePurchaseDomain({
    purchase: {
      ...input.purchase,
      billDate: fiscalDate || input.fiscalYear.startBs,
    },
    fiscalYear: input.fiscalYear,
    vendorCategory: input.vendorCategory,
    requiresTransportParty: freightCreatesTransporterPayable(input.purchase.freightIndiaStatus),
    vatRatePercent: input.vatRatePercent,
  })
  const duplicateValidation = detectDuplicateSupplierBill({
    purchases: input.existingPurchases,
    vendorPartyId: input.purchase.vendorPartyId,
    vendorBillNumber: input.purchase.vendorBillNumber,
    fiscalYearId: input.fiscalYear.id,
    excludeId: input.purchase.id || undefined,
  })

  return {
    errors: purchaseValidation.errors,
    warnings: duplicateValidation.errors,
  }
}

export function validationMessagesByField(errors: FieldError[]) {
  return errors.reduce<Record<string, string[]>>((messages, error) => {
    messages[error.field] = [...(messages[error.field] ?? []), error.message]
    return messages
  }, {})
}


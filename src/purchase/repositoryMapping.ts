import {
  normalizeFreightIndiaStatus,
  normalizeSupplierCurrency,
  type AppSettings,
  type ImportPurchase,
} from './domain'
import type { TransactionLifecycleStatus } from '../domain/lifecycle'

const lifecycleStatusFromDb = (value: unknown): TransactionLifecycleStatus => {
  const status = String(value ?? 'POSTED')
  return status === 'DRAFT' || status === 'VOID' || status === 'REVERSED' ? status : 'POSTED'
}

export function mapImportPurchaseRowFromDb(
  row: Record<string, unknown>,
  settings: AppSettings,
  resolveFiscalYearId: (date: string) => string,
): ImportPurchase {
  const fiscalDate = String(row.debitNoteDate ?? '') || String(row.agentServiceBillDate ?? '')

  return {
    id: String(row.id ?? ''),
    fiscalYearId: String(row.fiscalYearId ?? '') || resolveFiscalYearId(fiscalDate),
    lifecycleStatus: lifecycleStatusFromDb(row.lifecycleStatus),
    vendorPartyId: String(row.vendorPartyId ?? ''),
    vendorBillNumber: String(row.vendorBillNumber ?? ''),
    billDate: String(row.billDate ?? ''),
    supplierCurrency: normalizeSupplierCurrency(row.supplierCurrency),
    amountIC: Number(row.amountIC ?? 0),
    supplierExchangeRate: Number(row.supplierExchangeRate ?? 0),
    supplierAmountNPR: Number(row.supplierAmountNPR ?? 0),
    customAgentPartyId: String(row.customAgentPartyId ?? ''),
    debitNoteNumber: String(row.debitNoteNumber ?? ''),
    debitNoteDate: String(row.debitNoteDate ?? ''),
    importDutyNPR: Number(row.importDutyNPR ?? 0),
    customServiceNPR: Number(row.customServiceNPR ?? 0),
    importVatNPR: Number(row.importVatNPR ?? 0),
    terminalChargeWithoutVatNPR: Number(row.terminalChargeWithoutVatNPR ?? 0),
    terminalVatNPR: Number(row.terminalVatNPR ?? 0),
    totalTerminalChargeNPR: Number(row.totalTerminalChargeNPR ?? 0),
    freightIndiaStatus: normalizeFreightIndiaStatus(row.freightIndiaStatus),
    freightIndiaPartyId: String(row.freightIndiaPartyId ?? ''),
    freightIndiaAmountIC: Number(row.freightIndiaAmountIC ?? 0),
    freightIndiaExchangeRate: Number(row.freightIndiaExchangeRate ?? 0),
    freightIndiaAmountNPR: Number(row.freightIndiaAmountNPR ?? 0),
    totalKg: Number(row.totalKg ?? 0),
    loadingUnloadingChargePerKg: Number(row.loadingUnloadingChargePerKg ?? 0),
    loadingUnloadingChargeNPR: Number(row.loadingUnloadingChargeNPR ?? 0),
    otherChargesNPR: Number(row.otherChargesNPR ?? 0),
    debitNoteTotalNPR: Number(row.debitNoteTotalNPR ?? 0),
    agentServiceBillNumber: String(row.agentServiceBillNumber ?? ''),
    agentServiceBillDate: String(row.agentServiceBillDate ?? ''),
    agentServiceAmountBeforeVatNPR: Number(row.agentServiceAmountBeforeVatNPR ?? 0),
    agentServiceVatNPR: Number(row.agentServiceVatNPR ?? 0),
    agentServiceTotalNPR: Number(row.agentServiceTotalNPR ?? 0),
    totalAgentPayableNPR: Number(row.totalAgentPayableNPR ?? 0),
    totalInputVatNPR: Number(row.totalInputVatNPR ?? 0),
    landedCostNPR: Number(row.landedCostNPR ?? 0),
    appliedVatRate: Number(row.appliedVatRate ?? settings.agentServiceVatRate),
    appliedExchangeRate: Number(row.appliedExchangeRate ?? row.supplierExchangeRate ?? settings.defaultExchangeRate),
    calculationVersion: String(row.calculationVersion ?? 'legacy-migrated-v1'),
    calculatedAt: String(row.calculatedAt ?? row.updatedAt ?? row.createdAt ?? ''),
    postedAt: String(row.postedAt ?? row.createdAt ?? ''),
    postedBy: String(row.postedBy ?? ''),
    voidedAt: String(row.voidedAt ?? ''),
    reversedAt: String(row.reversedAt ?? ''),
    reversalReason: String(row.reversalReason ?? ''),
    replacementTransactionId: String(row.replacementTransactionId ?? ''),
    remarks: String(row.remarks ?? ''),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  }
}

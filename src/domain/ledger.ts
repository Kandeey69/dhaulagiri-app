import type { AccountCode } from './chartOfAccounts'
import type { TransactionLifecycleStatus } from './lifecycle'
import { assertTransactionTransition } from './lifecycle'
import { freightCreatesTransporterPayable } from './accountingPolicy'
import type { FiscalYear } from './fiscalYear'

export type LedgerSourceType =
  | 'PURCHASE'
  | 'SALE'
  | 'SUPPLIER_PAYMENT'
  | 'CUSTOMER_RECEIPT'
  | 'LOCAL_EXPENSE'
  | 'CREDIT_NOTE'
  | 'REVERSAL'

export type LedgerEntryStatus = 'ACTIVE' | 'REVERSED'

export type LedgerEntry = {
  id: string
  batchId: string
  companyId: string
  fiscalYearId: string
  transactionDate: string
  accountCode: AccountCode
  partyId?: string
  sourceType: LedgerSourceType
  sourceId: string
  postingVersion: string
  debit: number
  credit: number
  narration: string
  status: LedgerEntryStatus
  reversalOfEntryId?: string
  createdAt: string
  updatedAt: string
}

export type PostingContext = {
  companyId: string
  fiscalYearId: string
  fiscalYear: FiscalYear
  idFactory: () => string
  timestamp: string
  userName: string
}

type PostingLine = {
  accountCode: AccountCode
  partyId?: string
  debit?: number
  credit?: number
  narration: string
}

export type PurchasePostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  vendorPartyId: string
  customAgentPartyId: string
  freightIndiaPartyId?: string
  freightIndiaStatus: 'Paid by custom agent' | 'To be paid by us'
  supplierAmountNPR: number
  totalAgentPayableNPR: number
  freightIndiaAmountNPR: number
  landedCostAdjustmentNPR?: number
  landedCostNPR: number
  totalInputVatNPR: number
  reference: string
}

export type SalePostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  partyId: string
  salesAmount: number
  vatAmount: number
  totalAmount: number
  reference: string
}

export type PaymentPostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  partyId: string
  paymentType: string
  amountNPR: number
  reference: string
}

export type ReceiptPostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  partyId: string
  amountNPR: number
  reference: string
}

export type LocalExpensePostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  partyId: string
  expenseType: string
  amountBeforeVatNPR: number
  vatNPR: number
  totalAmountNPR: number
  reference: string
}

export type CreditNotePostingInput = {
  id: string
  lifecycleStatus: TransactionLifecycleStatus
  fiscalYearId: string
  date: string
  partyId: string
  amount: number
  vatAmount: number
  totalAmount: number
  reference: string
}

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function ledgerTotals(entries: Pick<LedgerEntry, 'debit' | 'credit'>[]) {
  return entries.reduce(
    (totals, entry) => ({
      debit: money(totals.debit + Number(entry.debit || 0)),
      credit: money(totals.credit + Number(entry.credit || 0)),
    }),
    { debit: 0, credit: 0 },
  )
}

export function isBalanced(entries: Pick<LedgerEntry, 'debit' | 'credit'>[]) {
  const totals = ledgerTotals(entries)
  return totals.debit === totals.credit
}

export function assertBalanced(entries: Pick<LedgerEntry, 'debit' | 'credit'>[]) {
  if (!isBalanced(entries)) {
    const totals = ledgerTotals(entries)
    throw new Error(`Posting batch is unbalanced: debit ${totals.debit}, credit ${totals.credit}.`)
  }
}

export function assertNoDuplicatePosting(
  existingEntries: LedgerEntry[],
  sourceType: LedgerSourceType,
  sourceId: string,
  postingVersion: string,
) {
  const existingBatchIds = new Set(
    existingEntries
      .filter(
        (entry) =>
          entry.sourceType === sourceType &&
          entry.sourceId === sourceId &&
          entry.postingVersion === postingVersion &&
          entry.status === 'ACTIVE',
      )
      .map((entry) => entry.batchId),
  )

  if (existingBatchIds.size > 0) {
    throw new Error(`${sourceType} ${sourceId} already has an active posting batch.`)
  }
}

function makeEntries(
  context: PostingContext,
  sourceType: LedgerSourceType,
  sourceId: string,
  date: string,
  reference: string,
  lines: PostingLine[],
  postingVersion = 'v1',
) {
  const batchId = context.idFactory()
  const entries = lines
    .map((line) => ({
      id: context.idFactory(),
      batchId,
      companyId: context.companyId,
      fiscalYearId: context.fiscalYearId,
      transactionDate: date,
      accountCode: line.accountCode,
      partyId: line.partyId,
      sourceType,
      sourceId,
      postingVersion,
      debit: money(line.debit ?? 0),
      credit: money(line.credit ?? 0),
      narration: line.narration || reference,
      status: 'ACTIVE' as const,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    }))
    .filter((entry) => entry.debit > 0 || entry.credit > 0)

  assertBalanced(entries)
  return entries
}

function assertCanPost(status: TransactionLifecycleStatus, fiscalYear: FiscalYear) {
  assertTransactionTransition(status, 'POSTED', fiscalYear)
}

export function postPurchase(input: PurchasePostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  const freightPayable = freightCreatesTransporterPayable(input.freightIndiaStatus)
    ? input.freightIndiaAmountNPR
    : 0
  const landedCostAdjustmentNPR = money(
    input.landedCostAdjustmentNPR ??
      Math.max(
        0,
        input.landedCostNPR +
          input.totalInputVatNPR -
          input.supplierAmountNPR -
          input.totalAgentPayableNPR -
          freightPayable,
      ),
  )
  return makeEntries(context, 'PURCHASE', input.id, input.date, input.reference, [
    { accountCode: '1200', debit: input.landedCostNPR, narration: `Landed cost ${input.reference}` },
    { accountCode: '1300', debit: input.totalInputVatNPR, narration: `Input VAT ${input.reference}` },
    { accountCode: '2000', partyId: input.vendorPartyId, credit: input.supplierAmountNPR, narration: `Supplier payable ${input.reference}` },
    { accountCode: '2100', partyId: input.customAgentPartyId, credit: input.totalAgentPayableNPR, narration: `Customs agent payable ${input.reference}` },
    { accountCode: '2200', partyId: input.freightIndiaPartyId, credit: freightPayable, narration: `Indian transport payable ${input.reference}` },
    { accountCode: '2600', credit: landedCostAdjustmentNPR, narration: `Landed cost clearing ${input.reference}` },
  ])
}

export function postSale(input: SalePostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  return makeEntries(context, 'SALE', input.id, input.date, input.reference, [
    { accountCode: '1100', partyId: input.partyId, debit: input.totalAmount, narration: `Sales invoice ${input.reference}` },
    { accountCode: '4000', credit: input.salesAmount, narration: `Sales revenue ${input.reference}` },
    { accountCode: '2400', credit: input.vatAmount, narration: `Output VAT ${input.reference}` },
  ])
}

export function postSupplierPayment(input: PaymentPostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  const payableAccount: AccountCode =
    input.paymentType === 'Custom Agent Payment'
      ? '2100'
      : input.paymentType === 'Freight Payment'
        ? '2200'
        : input.paymentType === 'Other Supplier Payment'
          ? '2300'
          : '2000'
  return makeEntries(context, 'SUPPLIER_PAYMENT', input.id, input.date, input.reference, [
    { accountCode: payableAccount, partyId: input.partyId, debit: input.amountNPR, narration: `Payment ${input.reference}` },
    { accountCode: '1000', credit: input.amountNPR, narration: `Bank payment ${input.reference}` },
  ])
}

export function postCustomerReceipt(input: ReceiptPostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  return makeEntries(context, 'CUSTOMER_RECEIPT', input.id, input.date, input.reference, [
    { accountCode: '1000', debit: input.amountNPR, narration: `Receipt ${input.reference}` },
    { accountCode: '1100', partyId: input.partyId, credit: input.amountNPR, narration: `Customer receipt ${input.reference}` },
  ])
}

export function postLocalExpense(input: LocalExpensePostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  return makeEntries(context, 'LOCAL_EXPENSE', input.id, input.date, input.reference, [
    { accountCode: input.expenseType === 'Fixed Asset' ? '1400' : '5000', debit: input.amountBeforeVatNPR, narration: `Local ${input.expenseType} ${input.reference}` },
    { accountCode: '1300', debit: input.vatNPR, narration: `Input VAT ${input.reference}` },
    { accountCode: '2300', partyId: input.partyId, credit: input.totalAmountNPR, narration: `Local supplier payable ${input.reference}` },
  ])
}

export function postCreditNote(input: CreditNotePostingInput, context: PostingContext) {
  assertCanPost(input.lifecycleStatus, context.fiscalYear)
  return makeEntries(context, 'CREDIT_NOTE', input.id, input.date, input.reference, [
    { accountCode: '4100', debit: input.amount, narration: `Credit note ${input.reference}` },
    { accountCode: '2400', debit: input.vatAmount, narration: `Output VAT reversal ${input.reference}` },
    { accountCode: '1100', partyId: input.partyId, credit: input.totalAmount, narration: `Receivable reduction ${input.reference}` },
  ])
}

export function reverseLedgerEntries(input: {
  originalEntries: LedgerEntry[]
  context: PostingContext
  sourceId: string
  sourceType: LedgerSourceType
  reason: string
}) {
  if (!input.reason.trim()) {
    throw new Error('Reversal reason is required.')
  }

  if (!input.originalEntries.length) {
    throw new Error('Posted ledger entries are required before reversal.')
  }

  if (input.originalEntries.some((entry) => entry.status !== 'ACTIVE')) {
    throw new Error('Only active posted ledger entries can be reversed.')
  }

  const existingReversal = input.originalEntries.some((entry) => entry.reversalOfEntryId)
  if (existingReversal) {
    throw new Error('Source transaction already has a reversal.')
  }

  const batchId = input.context.idFactory()
  const reversalEntries = input.originalEntries.map((entry) => ({
    ...entry,
    id: input.context.idFactory(),
    batchId,
    sourceType: 'REVERSAL' as const,
    sourceId: input.sourceId,
    debit: entry.credit,
    credit: entry.debit,
    narration: `Reversal: ${input.reason}`,
    status: 'ACTIVE' as const,
    reversalOfEntryId: entry.id,
    createdAt: input.context.timestamp,
    updatedAt: input.context.timestamp,
  }))

  assertBalanced(reversalEntries)

  return {
    originalEntries: input.originalEntries.map((entry) => ({
      ...entry,
      status: 'REVERSED' as const,
      updatedAt: input.context.timestamp,
    })),
    reversalEntries,
  }
}

export function ledgerPartyBalance(entries: LedgerEntry[], partyId: string, asOfDate = '') {
  return entries
    .filter(
      (entry) =>
        entry.status === 'ACTIVE' &&
        entry.partyId === partyId &&
        (!asOfDate || entry.transactionDate <= asOfDate),
    )
    .reduce((balance, entry) => money(balance + entry.debit - entry.credit), 0)
}

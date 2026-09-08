import type { AppData } from "../purchase/domain"
export const ACCOUNT_TABLES = ['fiscal_years', 'parties', 'sales', 'collections', 'credit_notes', 'receipt_allocations', 'ledger_entries', 'activity_logs'] as const
export type RawAccountTables = Record<string, Record<string, unknown>[]>

export function validateRawAccounts(tables: RawAccountTables) {
  for (const name of ACCOUNT_TABLES) {
    if (!Array.isArray(tables[name])) throw new Error(`Backup requires accounts table ${name}.`)
    const ids = new Set<string>()
    for (const row of tables[name]) {
      if (!row.id || ids.has(String(row.id))) throw new Error(`Missing/duplicate ID in ${name}.`)
      ids.add(String(row.id))
      for (const value of Object.values(row)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite value in ${name}.`)
    }
  }
  const parties = new Set(tables.parties.map(row => row.id))
  const years = new Set(tables.fiscal_years.map(row => row.id))
  for (const name of ['sales', 'collections', 'credit_notes']) for (const row of tables[name]) {
    if (!['DRAFT', 'POSTED', 'VOID', 'REVERSED'].includes(String(row.lifecycle_status))) throw new Error(`Invalid lifecycle state in ${name}.`);
    if (!parties.has(row.party_id) || !years.has(row.fiscal_year_id)) throw new Error(`Invalid party/year reference in ${name}: ${row.id}.`)
  }
  const sales = new Map(tables.sales.map(row => [row.id, row]))
  const receipts = new Map(tables.collections.map(row => [row.id, row]))
  const allocatedSales = new Map<unknown, number>(), allocatedReceipts = new Map<unknown, number>()
  for (const allocation of tables.receipt_allocations) {
    const sale = sales.get(allocation.sale_id), receipt = receipts.get(allocation.receipt_id)
    const amount = Number(allocation.amount_npr)
    if (!sale || !receipt || sale.party_id !== receipt.party_id || !Number.isFinite(amount) || amount <= 0) throw new Error('Invalid receipt allocation in backup.')
    allocatedSales.set(sale.id, (allocatedSales.get(sale.id) ?? 0) + amount)
    allocatedReceipts.set(receipt.id, (allocatedReceipts.get(receipt.id) ?? 0) + amount)
  }
  for (const [id, amount] of allocatedSales) if (amount > Number(sales.get(id)!.total_amount) + 0.000001) throw new Error('Backup over-allocates a sale.')
  for (const [id, amount] of allocatedReceipts) if (amount > Number(receipts.get(id)!.amount) + 0.000001) throw new Error('Backup over-allocates a receipt.')
  const batchBalances = new Map<string, number>()
  for (const row of tables.ledger_entries) {
    const key = String(row.batch_id)
    batchBalances.set(key, (batchBalances.get(key) ?? 0) + Number(row.debit) - Number(row.credit))
    if (!years.has(row.fiscal_year_id)) throw new Error('Journal fiscal year is missing.')
    const source = row.source_type === 'SALE' ? sales : row.source_type === 'CUSTOMER_RECEIPT' ? receipts : row.source_type === 'CREDIT_NOTE' ? new Map(tables.credit_notes.map(row => [row.id,row])) : null
    if (source && !source.has(row.source_id)) throw new Error(`Orphan journal source ${row.source_id}.`)
  }
  for (const [batch, balance] of batchBalances) if (!Number.isFinite(balance) || Math.abs(balance) >= 0.005) throw new Error(`Unbalanced journal batch ${batch}.`)
}
export function validatePurchaseBackup(data: AppData) {
  for (const key of ['parties', 'fiscalYears', 'purchases', 'payments', 'localExpenses', 'paymentAllocations', 'ledgerEntries', 'activityLogs'] as const) {
    if (!Array.isArray(data[key])) throw new Error(`Purchase backup requires ${key}.`);
    const ids = new Set<string>();
    for (const row of data[key]) {
      if (!row.id || ids.has(row.id)) throw new Error(`Missing/duplicate ID in purchase ${key}.`);
      ids.add(row.id);
      for (const value of Object.values(row)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Invalid number in ${key}.`);
    }
  }
  const parties = new Set(data.parties.map(row => row.id)), years = new Set(data.fiscalYears.map(row => row.id));
  for (const row of [...data.purchases, ...data.payments, ...data.localExpenses]) {
    if (!years.has(row.fiscalYearId)) throw new Error('Purchase backup has an unknown fiscal year.');
  }
  for (const row of data.purchases) for (const id of [row.vendorPartyId, row.customAgentPartyId, row.freightIndiaPartyId]) if (id && !parties.has(id)) throw new Error('Purchase backup has an unknown party.');
  for (const row of [...data.payments, ...data.localExpenses]) if (!parties.has(row.partyId)) throw new Error('Payment/expense backup has an unknown party.');
  const purchases = new Map(data.purchases.map(row => [row.id, row])), payments = new Map(data.payments.map(row => [row.id, row]));
  const paid = new Map<string, number>(), allocated = new Map<string, number>();
  for (const row of data.paymentAllocations) {
    const payment = payments.get(row.paymentId), purchase = purchases.get(row.purchaseId);
    if (!payment || !purchase || payment.partyId !== purchase.vendorPartyId || payment.fiscalYearId !== purchase.fiscalYearId || !Number.isFinite(row.amountNPR) || row.amountNPR <= 0) throw new Error('Purchase backup contains an incompatible allocation.');
    paid.set(row.paymentId, (paid.get(row.paymentId) ?? 0) + row.amountNPR);
    allocated.set(row.purchaseId, (allocated.get(row.purchaseId) ?? 0) + row.amountNPR);
  }
  for (const [id, sum] of paid) if (sum > payments.get(id)!.amountNPR + 0.000001) throw new Error('Purchase backup over-allocates a payment.');
  for (const [id, sum] of allocated) if (sum > purchases.get(id)!.supplierAmountNPR + 0.000001) throw new Error('Purchase backup over-allocates a bill.');
  const batches = new Map<string, number>();
  for (const entry of data.ledgerEntries) {
    if (!years.has(entry.fiscalYearId)) throw new Error('Purchase journal has an unknown fiscal year.');
    const sources = entry.sourceType === 'PURCHASE' ? data.purchases : entry.sourceType === 'SUPPLIER_PAYMENT' ? data.payments : entry.sourceType === 'LOCAL_EXPENSE' ? data.localExpenses : null;
    if (sources && !sources.some(row => row.id === entry.sourceId)) throw new Error('Purchase journal source is missing.');
    batches.set(entry.batchId, (batches.get(entry.batchId) ?? 0) + entry.debit - entry.credit);
  }
  for (const [id, balance] of batches) if (!Number.isFinite(balance) || Math.abs(balance) >= 0.005) throw new Error(`Unbalanced purchase journal batch ${id}.`);
}

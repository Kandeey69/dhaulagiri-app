CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  panVatNo TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  openingPayable REAL NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL,
  code TEXT NOT NULL,
  startBs TEXT NOT NULL,
  endBs TEXT NOT NULL,
  startAd TEXT NOT NULL DEFAULT '',
  endAd TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(companyId, code)
);

CREATE TABLE IF NOT EXISTS import_purchases (
  id TEXT PRIMARY KEY,
  fiscalYearId TEXT NOT NULL DEFAULT '',
  lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED',
  vendorPartyId TEXT NOT NULL,
  vendorBillNumber TEXT NOT NULL,
  billDate TEXT NOT NULL,
  supplierCurrency TEXT NOT NULL DEFAULT 'INR',
  amountIC REAL NOT NULL DEFAULT 0,
  supplierExchangeRate REAL NOT NULL DEFAULT 0,
  supplierAmountNPR REAL NOT NULL DEFAULT 0,
  customAgentPartyId TEXT NOT NULL DEFAULT '',
  debitNoteNumber TEXT NOT NULL DEFAULT '',
  debitNoteDate TEXT NOT NULL DEFAULT '',
  importDutyNPR REAL NOT NULL DEFAULT 0,
  customServiceNPR REAL NOT NULL DEFAULT 0,
  importVatNPR REAL NOT NULL DEFAULT 0,
  terminalChargeWithoutVatNPR REAL NOT NULL DEFAULT 0,
  terminalVatNPR REAL NOT NULL DEFAULT 0,
  totalTerminalChargeNPR REAL NOT NULL DEFAULT 0,
  freightIndiaStatus TEXT NOT NULL DEFAULT 'Paid by custom agent',
  freightIndiaPartyId TEXT NOT NULL DEFAULT '',
  freightIndiaAmountIC REAL NOT NULL DEFAULT 0,
  freightIndiaExchangeRate REAL NOT NULL DEFAULT 0,
  freightIndiaAmountNPR REAL NOT NULL DEFAULT 0,
  totalKg REAL NOT NULL DEFAULT 0,
  loadingUnloadingChargePerKg REAL NOT NULL DEFAULT 0,
  loadingUnloadingChargeNPR REAL NOT NULL DEFAULT 0,
  otherChargesNPR REAL NOT NULL DEFAULT 0,
  debitNoteTotalNPR REAL NOT NULL DEFAULT 0,
  agentServiceBillNumber TEXT NOT NULL DEFAULT '',
  agentServiceBillDate TEXT NOT NULL DEFAULT '',
  agentServiceAmountBeforeVatNPR REAL NOT NULL DEFAULT 0,
  agentServiceVatNPR REAL NOT NULL DEFAULT 0,
  agentServiceTotalNPR REAL NOT NULL DEFAULT 0,
  totalAgentPayableNPR REAL NOT NULL DEFAULT 0,
  totalInputVatNPR REAL NOT NULL DEFAULT 0,
  landedCostNPR REAL NOT NULL DEFAULT 0,
  appliedVatRate REAL NOT NULL DEFAULT 13,
  appliedExchangeRate REAL NOT NULL DEFAULT 1.6015,
  calculationVersion TEXT NOT NULL DEFAULT 'legacy-migrated-v1',
  calculatedAt TEXT NOT NULL DEFAULT '',
  postedAt TEXT NOT NULL DEFAULT '',
  postedBy TEXT NOT NULL DEFAULT '',
  voidedAt TEXT NOT NULL DEFAULT '',
  reversedAt TEXT NOT NULL DEFAULT '',
  reversalReason TEXT NOT NULL DEFAULT '',
  replacementTransactionId TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (vendorPartyId) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  fiscalYearId TEXT NOT NULL DEFAULT '',
  lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED',
  partyId TEXT NOT NULL,
  paymentDate TEXT NOT NULL,
  paymentType TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  exchangeRate REAL NOT NULL DEFAULT 1,
  amountNPR REAL NOT NULL DEFAULT 0,
  paymentMethod TEXT NOT NULL,
  referenceNumber TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  postedAt TEXT NOT NULL DEFAULT '',
  postedBy TEXT NOT NULL DEFAULT '',
  voidedAt TEXT NOT NULL DEFAULT '',
  reversedAt TEXT NOT NULL DEFAULT '',
  reversalReason TEXT NOT NULL DEFAULT '',
  replacementTransactionId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (partyId) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  paymentId TEXT NOT NULL,
  purchaseId TEXT NOT NULL,
  amountNPR REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (paymentId) REFERENCES payments(id),
  FOREIGN KEY (purchaseId) REFERENCES import_purchases(id)
);

CREATE TABLE IF NOT EXISTS local_expenses (
  id TEXT PRIMARY KEY,
  fiscalYearId TEXT NOT NULL DEFAULT '',
  lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED',
  partyId TEXT NOT NULL,
  billNumber TEXT NOT NULL,
  billDate TEXT NOT NULL,
  expenseType TEXT NOT NULL DEFAULT 'Expense',
  expenseHead TEXT NOT NULL DEFAULT '',
  amountBeforeVatNPR REAL NOT NULL DEFAULT 0,
  vatNPR REAL NOT NULL DEFAULT 0,
  totalAmountNPR REAL NOT NULL DEFAULT 0,
  remarks TEXT NOT NULL DEFAULT '',
  postedAt TEXT NOT NULL DEFAULT '',
  postedBy TEXT NOT NULL DEFAULT '',
  voidedAt TEXT NOT NULL DEFAULT '',
  reversedAt TEXT NOT NULL DEFAULT '',
  reversalReason TEXT NOT NULL DEFAULT '',
  replacementTransactionId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (partyId) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  companyId TEXT NOT NULL,
  fiscalYearId TEXT NOT NULL,
  transactionDate TEXT NOT NULL,
  accountCode TEXT NOT NULL,
  partyId TEXT,
  sourceType TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  postingVersion TEXT NOT NULL DEFAULT 'v1',
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  narration TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  reversalOfEntryId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  userName TEXT NOT NULL DEFAULT '',
  oldValue TEXT NOT NULL DEFAULT '',
  newValue TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  companyName TEXT NOT NULL DEFAULT '',
  fiscalYear TEXT NOT NULL DEFAULT '',
  defaultExchangeRate REAL NOT NULL DEFAULT 1.6015,
  supplierPurchaseCurrency TEXT NOT NULL DEFAULT 'INR',
  panVatNo TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  agentServiceVatRate REAL NOT NULL DEFAULT 13
);

CREATE INDEX IF NOT EXISTS idx_parties_category ON parties(category);
CREATE INDEX IF NOT EXISTS idx_purchases_bill_date ON import_purchases(billDate);
CREATE INDEX IF NOT EXISTS idx_purchases_fiscal_year ON import_purchases(fiscalYearId);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON import_purchases(vendorPartyId);
CREATE INDEX IF NOT EXISTS idx_purchases_agent ON import_purchases(customAgentPartyId);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(partyId);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paymentDate);
CREATE INDEX IF NOT EXISTS idx_payments_fiscal_year ON payments(fiscalYearId);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(paymentId);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase ON payment_allocations(purchaseId);
CREATE INDEX IF NOT EXISTS idx_local_expenses_party ON local_expenses(partyId);
CREATE INDEX IF NOT EXISTS idx_local_expenses_date ON local_expenses(billDate);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON ledger_entries(sourceType, sourceId, postingVersion);
CREATE INDEX IF NOT EXISTS idx_ledger_fiscal_year ON ledger_entries(fiscalYearId);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(partyId);

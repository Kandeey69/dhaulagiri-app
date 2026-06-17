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

CREATE TABLE IF NOT EXISTS import_purchases (
  id TEXT PRIMARY KEY,
  vendorPartyId TEXT NOT NULL,
  vendorBillNumber TEXT NOT NULL,
  billDate TEXT NOT NULL,
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
  freightIndiaStatus TEXT NOT NULL DEFAULT 'Not applicable',
  freightIndiaAmountIC REAL NOT NULL DEFAULT 0,
  freightIndiaExchangeRate REAL NOT NULL DEFAULT 0,
  freightIndiaAmountNPR REAL NOT NULL DEFAULT 0,
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
  remarks TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (vendorPartyId) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
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
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (partyId) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parties_category ON parties(category);
CREATE INDEX IF NOT EXISTS idx_purchases_bill_date ON import_purchases(billDate);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON import_purchases(vendorPartyId);
CREATE INDEX IF NOT EXISTS idx_purchases_agent ON import_purchases(customAgentPartyId);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(partyId);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paymentDate);

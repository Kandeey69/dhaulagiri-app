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

ALTER TABLE import_purchases ADD COLUMN fiscalYearId TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN appliedVatRate REAL NOT NULL DEFAULT 13;
ALTER TABLE import_purchases ADD COLUMN appliedExchangeRate REAL NOT NULL DEFAULT 1.6015;
ALTER TABLE import_purchases ADD COLUMN calculationVersion TEXT NOT NULL DEFAULT 'legacy-migrated-v1';
ALTER TABLE import_purchases ADD COLUMN calculatedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN fiscalYearId TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN fiscalYearId TEXT NOT NULL DEFAULT '';

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

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(paymentId);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase ON payment_allocations(purchaseId);
CREATE INDEX IF NOT EXISTS idx_purchases_fiscal_year ON import_purchases(fiscalYearId);
CREATE INDEX IF NOT EXISTS idx_payments_fiscal_year ON payments(fiscalYearId);

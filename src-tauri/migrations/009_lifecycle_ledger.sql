ALTER TABLE import_purchases ADD COLUMN lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE import_purchases ADD COLUMN postedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN postedBy TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN voidedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN reversedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN reversalReason TEXT NOT NULL DEFAULT '';
ALTER TABLE import_purchases ADD COLUMN replacementTransactionId TEXT NOT NULL DEFAULT '';

ALTER TABLE payments ADD COLUMN lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE payments ADD COLUMN postedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN postedBy TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN voidedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN reversedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN reversalReason TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN replacementTransactionId TEXT NOT NULL DEFAULT '';

ALTER TABLE local_expenses ADD COLUMN lifecycleStatus TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE local_expenses ADD COLUMN postedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN postedBy TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN voidedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN reversedAt TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN reversalReason TEXT NOT NULL DEFAULT '';
ALTER TABLE local_expenses ADD COLUMN replacementTransactionId TEXT NOT NULL DEFAULT '';

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unique_source_batch
ON ledger_entries(sourceType, sourceId, postingVersion, batchId);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON ledger_entries(sourceType, sourceId, postingVersion);
CREATE INDEX IF NOT EXISTS idx_ledger_fiscal_year ON ledger_entries(fiscalYearId);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(partyId);

ALTER TABLE activity_logs ADD COLUMN metadata TEXT NOT NULL DEFAULT '';

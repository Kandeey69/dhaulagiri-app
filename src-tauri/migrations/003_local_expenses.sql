CREATE TABLE IF NOT EXISTS local_expenses (
  id TEXT PRIMARY KEY,
  partyId TEXT NOT NULL,
  billNumber TEXT NOT NULL,
  billDate TEXT NOT NULL,
  expenseHead TEXT NOT NULL DEFAULT '',
  amountBeforeVatNPR REAL NOT NULL DEFAULT 0,
  vatNPR REAL NOT NULL DEFAULT 0,
  totalAmountNPR REAL NOT NULL DEFAULT 0,
  remarks TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (partyId) REFERENCES parties(id)
);

CREATE INDEX IF NOT EXISTS idx_local_expenses_party ON local_expenses(partyId);
CREATE INDEX IF NOT EXISTS idx_local_expenses_date ON local_expenses(billDate);

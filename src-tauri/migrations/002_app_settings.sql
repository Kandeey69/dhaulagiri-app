CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  companyName TEXT NOT NULL DEFAULT '',
  fiscalYear TEXT NOT NULL DEFAULT '',
  defaultExchangeRate REAL NOT NULL DEFAULT 1.6,
  panVatNo TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  agentServiceVatRate REAL NOT NULL DEFAULT 13
);

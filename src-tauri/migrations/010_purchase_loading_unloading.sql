ALTER TABLE import_purchases ADD COLUMN totalKg REAL NOT NULL DEFAULT 0;
ALTER TABLE import_purchases ADD COLUMN loadingUnloadingChargePerKg REAL NOT NULL DEFAULT 0;
ALTER TABLE import_purchases ADD COLUMN loadingUnloadingChargeNPR REAL NOT NULL DEFAULT 0;

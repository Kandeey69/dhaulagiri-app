ALTER TABLE import_purchases
ADD COLUMN supplierCurrency TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE app_settings
ADD COLUMN supplierPurchaseCurrency TEXT NOT NULL DEFAULT 'INR';

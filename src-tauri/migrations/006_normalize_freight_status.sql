UPDATE import_purchases
SET freightIndiaStatus = 'To be paid by us'
WHERE freightIndiaStatus = 'Paid directly by us';

UPDATE import_purchases
SET freightIndiaStatus = 'Paid by custom agent'
WHERE freightIndiaStatus IN ('Not applicable', 'Included in supplier bill')
  OR TRIM(freightIndiaStatus) = '';

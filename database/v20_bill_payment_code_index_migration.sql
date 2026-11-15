-- Add an index for bill lookup from payment provider webhooks.

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bills'
    AND INDEX_NAME = 'idx_bills_payment_code'
);
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_bills_payment_code ON bills(payment_code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

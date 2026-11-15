-- Add an index for reservation deposit lookup from payment provider webhooks.

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'deposits'
    AND INDEX_NAME = 'idx_deposits_transaction_code'
);
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_deposits_transaction_code ON deposits(transaction_code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

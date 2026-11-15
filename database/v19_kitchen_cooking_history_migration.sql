-- Record when a kitchen item becomes ready for service.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_items'
    AND column_name = 'ready_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_items ADD COLUMN ready_at DATETIME NULL AFTER accepted_by_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

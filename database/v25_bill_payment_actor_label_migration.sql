SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bills'
    AND COLUMN_NAME = 'paid_by_label'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE bills ADD COLUMN paid_by_label VARCHAR(120) NULL AFTER paid_by',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE bills
SET paid_by_label = 'SePay (tự động)'
WHERE status = 'da_thanh_toan'
  AND payment_method = 'online'
  AND paid_by IS NULL
  AND paid_by_label IS NULL;

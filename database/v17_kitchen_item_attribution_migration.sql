-- Run once to record the kitchen employee who first accepts each bill item.

SET @user_id_type = (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_items' AND column_name = 'accepted_by'
);
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE bill_items ADD COLUMN accepted_by ', @user_id_type, ' NULL AFTER status'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_items' AND column_name = 'accepted_by_name'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_items ADD COLUMN accepted_by_name VARCHAR(120) NULL AFTER accepted_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_items'
    AND COLUMN_NAME = 'accepted_by' AND REFERENCED_TABLE_NAME = 'users'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE bill_items ADD CONSTRAINT fk_bill_items_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

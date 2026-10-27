-- Run once on an existing database to support Phase 8 cancellations and refunds.

ALTER TABLE reservations
  MODIFY COLUMN cancelled_by ENUM('customer','staff') NULL;

SET @deposit_status_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'deposits'
    AND column_name = 'status'
);
SET @sql = IF(LOCATE("'da_huy'", @deposit_status_type) = 0,
  "ALTER TABLE deposits MODIFY COLUMN status ENUM('cho_thanh_toan','da_coc','dang_hoan','da_hoan','hoan_that_bai','mat_coc','da_tru_bill','da_huy') NOT NULL DEFAULT 'cho_thanh_toan'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @user_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'deposits' AND column_name = 'refunded_by'
);
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE deposits ADD COLUMN refunded_by ', @user_id_type, ' NULL AFTER refunded_at'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @refunded_by_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'deposits' AND column_name = 'refunded_by'
);
SET @sql = IF(@refunded_by_type <> @user_id_type,
  CONCAT('ALTER TABLE deposits MODIFY COLUMN refunded_by ', @user_id_type, ' NULL'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'deposits' AND column_name = 'forfeited_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE deposits ADD COLUMN forfeited_at DATETIME NULL AFTER refunded_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deposits'
    AND COLUMN_NAME = 'refunded_by' AND REFERENCED_TABLE_NAME = 'users'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE deposits ADD CONSTRAINT fk_deposits_refunded_by FOREIGN KEY (refunded_by) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

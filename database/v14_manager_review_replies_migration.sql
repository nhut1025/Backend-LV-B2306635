-- Run once to allow managers to reply to customer bill reviews.

SET @user_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'manager_reply'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_reviews ADD COLUMN manager_reply TEXT NULL AFTER comment',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'replied_by'
);
SET @sql = IF(@col_exists = 0,
  CONCAT('ALTER TABLE bill_reviews ADD COLUMN replied_by ', @user_id_type, ' NULL AFTER manager_reply'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'replied_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_reviews ADD COLUMN replied_at DATETIME NULL AFTER replied_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_reviews'
    AND COLUMN_NAME = 'replied_by' AND REFERENCED_TABLE_NAME = 'users'
);
SET @replied_by_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'replied_by'
);
SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_reviews'
    AND COLUMN_NAME = 'replied_by' AND REFERENCED_TABLE_NAME = 'users'
  LIMIT 1
);
SET @sql = IF(@fk_exists > 0 AND @replied_by_type <> @user_id_type,
  CONCAT('ALTER TABLE bill_reviews DROP FOREIGN KEY `', @fk_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(@replied_by_type <> @user_id_type,
  CONCAT('ALTER TABLE bill_reviews MODIFY COLUMN replied_by ', @user_id_type, ' NULL'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_reviews'
    AND COLUMN_NAME = 'replied_by' AND REFERENCED_TABLE_NAME = 'users'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE bill_reviews ADD CONSTRAINT fk_bill_reviews_replied_by FOREIGN KEY (replied_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

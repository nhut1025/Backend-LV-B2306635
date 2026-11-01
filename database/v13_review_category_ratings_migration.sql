-- Run once to add service, food, and ambience ratings to bill reviews.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'food_rating'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_reviews ADD COLUMN food_rating TINYINT UNSIGNED NULL AFTER rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'service_rating'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_reviews ADD COLUMN service_rating TINYINT UNSIGNED NULL AFTER food_rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_reviews' AND column_name = 'ambience_rating'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bill_reviews ADD COLUMN ambience_rating TINYINT UNSIGNED NULL AFTER service_rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @constraint_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'bill_reviews'
    AND constraint_name = 'chk_bill_reviews_category_ratings'
);
SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE bill_reviews ADD CONSTRAINT chk_bill_reviews_category_ratings CHECK ((food_rating IS NULL OR food_rating BETWEEN 1 AND 5) AND (service_rating IS NULL OR service_rating BETWEEN 1 AND 5) AND (ambience_rating IS NULL OR ambience_rating BETWEEN 1 AND 5))',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

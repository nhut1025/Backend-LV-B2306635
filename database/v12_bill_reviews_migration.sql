-- Run once on an existing database to support one editable review per paid bill.

SET @bill_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bills' AND column_name = 'id'
);
SET @user_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'
);
SET @bill_item_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bill_items' AND column_name = 'id'
);

SET @sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS bill_reviews (',
  'id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ',
  'bill_id ', @bill_id_type, ' NOT NULL UNIQUE, ',
  'user_id ', @user_id_type, ' NOT NULL, ',
  'rating TINYINT UNSIGNED NOT NULL, ',
  'comment TEXT NOT NULL, ',
  'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ',
  'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, ',
  'CONSTRAINT chk_bill_reviews_rating CHECK (rating BETWEEN 1 AND 5), ',
  'FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE, ',
  'FOREIGN KEY (user_id) REFERENCES users(id)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS bill_review_items (',
  'id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ',
  'bill_review_id INT UNSIGNED NOT NULL, ',
  'bill_item_id ', @bill_item_id_type, ' NOT NULL, ',
  'sentiment ENUM(''like'',''dislike'') NOT NULL, ',
  'UNIQUE KEY uq_bill_review_item (bill_review_id, bill_item_id), ',
  'FOREIGN KEY (bill_review_id) REFERENCES bill_reviews(id) ON DELETE CASCADE, ',
  'FOREIGN KEY (bill_item_id) REFERENCES bill_items(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

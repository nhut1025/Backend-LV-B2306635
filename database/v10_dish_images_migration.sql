-- Run once on an existing database to add multiple images per dish.
-- Existing primary images are copied into the image gallery.

-- Match the existing dishes.id type exactly (including UNSIGNED) for the FK.
SET @dish_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dishes'
    AND COLUMN_NAME = 'id'
);

SET @create_dish_images_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS dish_images (',
  'id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ',
  'dish_id ', @dish_id_type, ' NOT NULL, ',
  'image_url VARCHAR(500) NOT NULL, ',
  'sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0, ',
  'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ',
  'UNIQUE KEY uq_dish_images_dish_url (dish_id, image_url), ',
  'INDEX idx_dish_images_dish_sort (dish_id, sort_order), ',
  'FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

PREPARE create_dish_images_stmt FROM @create_dish_images_sql;
EXECUTE create_dish_images_stmt;
DEALLOCATE PREPARE create_dish_images_stmt;

INSERT IGNORE INTO dish_images (dish_id, image_url, sort_order)
SELECT id, image_url, 0
FROM dishes
WHERE image_url IS NOT NULL AND TRIM(image_url) <> '';

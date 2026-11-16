-- Adds Dish tags for dietary and warning badges.
CREATE TABLE IF NOT EXISTS dish_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  slug VARCHAR(120) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO dish_tags (name, slug, sort_order) VALUES
  ('Chay', 'chay', 1),
  ('Ăn kiêng', 'an-kieng', 2),
  ('Nhiều đạm', 'nhieu-dam', 3),
  ('Cay', 'cay', 4),
  ('Chứa hải sản', 'chua-hai-san', 5),
  ('Dinh dưỡng', 'dinh-duong', 6),
  ('Giàu protein', 'giau-protein', 7);

-- Match the existing dishes.id type exactly, including UNSIGNED.
SET @dish_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dishes'
    AND COLUMN_NAME = 'id'
);

SET @create_dish_tag_map_sql = CONCAT(
  'CREATE TABLE IF NOT EXISTS dish_tag_map (',
  'dish_id ', @dish_id_type, ' NOT NULL, ',
  'tag_id INT UNSIGNED NOT NULL, ',
  'PRIMARY KEY (dish_id, tag_id), ',
  'FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE, ',
  'FOREIGN KEY (tag_id) REFERENCES dish_tags(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

PREPARE create_dish_tag_map_stmt FROM @create_dish_tag_map_sql;
EXECUTE create_dish_tag_map_stmt;
DEALLOCATE PREPARE create_dish_tag_map_stmt;

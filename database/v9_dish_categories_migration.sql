-- Run once on an existing database to move dish categories into a managed table.
-- Existing category names are migrated without changing dish data.

CREATE TABLE IF NOT EXISTS dish_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO dish_categories (name)
SELECT DISTINCT TRIM(category)
FROM dishes
WHERE category IS NOT NULL AND TRIM(category) <> '';

INSERT IGNORE INTO dish_categories (name) VALUES
  ('Khai vị'),
  ('Món chính'),
  ('Món ăn kèm'),
  ('Đồ uống'),
  ('Tráng miệng'),
  ('Khác');

ALTER TABLE dishes
  ADD COLUMN category_id INT UNSIGNED NULL AFTER category,
  ADD INDEX idx_dishes_category_id (category_id),
  ADD CONSTRAINT fk_dishes_category
    FOREIGN KEY (category_id) REFERENCES dish_categories(id) ON DELETE RESTRICT;

UPDATE dishes d
JOIN dish_categories c
  ON c.name COLLATE utf8mb4_unicode_ci = TRIM(d.category) COLLATE utf8mb4_unicode_ci
SET d.category_id = c.id
WHERE d.category IS NOT NULL AND TRIM(d.category) <> '';
